BEGIN;

ALTER TABLE IF EXISTS public.scalev_orders
  ADD COLUMN IF NOT EXISTS shipping_discount NUMERIC NULL;

ALTER TABLE IF EXISTS public.scalev_orders
  ADD COLUMN IF NOT EXISTS discount_code_discount NUMERIC NULL;

COMMENT ON COLUMN public.scalev_orders.gross_revenue IS
  'Raw header revenue from the ScaleV payload, stored as-is for audit/reconciliation.';

COMMENT ON COLUMN public.scalev_orders.net_revenue IS
  'Final authoritative header revenue from the ScaleV payload. This value is treated as already processed by ScaleV and must not be reduced again by shipping_discount, discount_code_discount, or other order-level discounts in the app.';

COMMENT ON COLUMN public.scalev_orders.shipping_discount IS
  'Header-level shipping discount from the ScaleV payload. NULL means unavailable or unknown for this source.';

COMMENT ON COLUMN public.scalev_orders.discount_code_discount IS
  'Header-level promo-code or voucher discount from the ScaleV payload. NULL means unavailable or unknown for this source.';

CREATE OR REPLACE VIEW public.v_scalev_order_financials_v2 AS
WITH line_rollup AS (
  SELECT
    sol.scalev_order_id,
    COUNT(*)::BIGINT AS line_count,
    SUM(sol.product_price_bt) AS line_product_gross_amount,
    SUM(sol.discount_bt) AS line_product_discount_amount,
    SUM(sol.product_price_bt - sol.discount_bt) AS line_product_net_amount
  FROM public.scalev_order_lines sol
  GROUP BY sol.scalev_order_id
)
SELECT
  so.id AS scalev_order_id,
  so.order_id,
  so.business_code,
  so.source,
  so.status,
  so.payment_method,
  so.shipped_time,
  so.completed_time,
  so.gross_revenue AS scalev_gross_revenue,
  so.net_revenue AS scalev_final_net_revenue,
  lr.line_product_gross_amount,
  lr.line_product_discount_amount,
  lr.line_product_net_amount,
  COALESCE(so.shipping_cost, 0) AS shipping_gross_amount,
  so.shipping_discount AS shipping_discount_amount,
  CASE
    WHEN COALESCE(so.shipping_cost, 0) = 0 THEN 0::NUMERIC
    WHEN so.shipping_discount IS NULL THEN NULL::NUMERIC
    ELSE GREATEST(COALESCE(so.shipping_cost, 0) - so.shipping_discount, 0::NUMERIC)
  END AS shipping_net_amount,
  COALESCE(so.unique_code_discount, 0) AS unique_code_discount_amount,
  so.discount_code_discount AS discount_code_discount_amount,
  COALESCE(so.unique_code_discount, 0) + COALESCE(so.discount_code_discount, 0) AS order_level_discount_amount,
  (COALESCE(so.shipping_cost, 0) = 0 OR so.shipping_discount IS NOT NULL) AS shipping_discount_known,
  (so.discount_code_discount IS NOT NULL) AS discount_code_discount_known,
  (COALESCE(lr.line_count, 0) > 0) AS has_lines,
  CASE
    WHEN COALESCE(lr.line_count, 0) > 0
      AND so.net_revenue IS NOT NULL
      AND lr.line_product_net_amount IS NOT NULL
      THEN so.net_revenue - lr.line_product_net_amount
    ELSE NULL::NUMERIC
  END AS audit_header_minus_line_product_net,
  CASE
    WHEN so.gross_revenue IS NOT NULL AND so.net_revenue IS NOT NULL
      THEN so.gross_revenue - so.net_revenue
    ELSE NULL::NUMERIC
  END AS audit_header_gross_minus_header_net
FROM public.scalev_orders so
LEFT JOIN line_rollup lr
  ON lr.scalev_order_id = so.id;

COMMENT ON VIEW public.v_scalev_order_financials_v2 IS
  'Canonical shadow read model for ScaleV header-vs-line financial audit. net_revenue remains authoritative and is never re-reduced by shipping_discount or discount_code_discount here.';

CREATE OR REPLACE VIEW public.v_scalev_order_financials_v2_reconciliation AS
SELECT
  COUNT(*)::BIGINT AS total_orders,
  COUNT(*) FILTER (WHERE NOT shipping_discount_known)::BIGINT AS shipping_discount_unknown_orders,
  COUNT(*) FILTER (WHERE NOT discount_code_discount_known)::BIGINT AS discount_code_discount_unknown_orders,
  COUNT(*) FILTER (
    WHERE has_lines
      AND audit_header_minus_line_product_net IS NOT NULL
      AND audit_header_minus_line_product_net = 0
  )::BIGINT AS header_net_matches_line_product_net_orders,
  COUNT(*) FILTER (
    WHERE has_lines
      AND audit_header_minus_line_product_net IS NOT NULL
      AND audit_header_minus_line_product_net <> 0
  )::BIGINT AS header_net_differs_from_line_product_net_orders,
  COUNT(*) FILTER (
    WHERE shipping_gross_amount > 0
      AND shipping_discount_amount IS NULL
  )::BIGINT AS shipping_discount_missing_with_shipping_orders
FROM public.v_scalev_order_financials_v2;

COMMENT ON VIEW public.v_scalev_order_financials_v2_reconciliation IS
  'Aggregate reconciliation metrics for the ScaleV financial shadow rollout.';

CREATE OR REPLACE VIEW public.v_scalev_order_financials_v2_gap_distribution AS
SELECT
  audit_header_minus_line_product_net AS gap_amount,
  COUNT(*)::BIGINT AS order_count
FROM public.v_scalev_order_financials_v2
WHERE has_lines
  AND audit_header_minus_line_product_net IS NOT NULL
GROUP BY audit_header_minus_line_product_net
ORDER BY audit_header_minus_line_product_net;

COMMENT ON VIEW public.v_scalev_order_financials_v2_gap_distribution IS
  'Grouped distribution of header net revenue versus line-level product net revenue gaps.';

COMMIT;
