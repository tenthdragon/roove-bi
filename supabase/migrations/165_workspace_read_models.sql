-- ============================================================================
-- 165: Workspace-aware read models used by the main dashboard
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.v_warehouse_expiring
WITH (security_invoker = true)
AS
SELECT
  product_name,
  category,
  expired_date,
  last_day_stock,
  price_list,
  sub_total_value,
  warehouse,
  period_year,
  period_month,
  CASE
    WHEN expired_date < CURRENT_DATE THEN 'expired'
    WHEN expired_date < CURRENT_DATE + INTERVAL '30 days' THEN 'critical'
    WHEN expired_date < CURRENT_DATE + INTERVAL '90 days' THEN 'warning'
    ELSE 'safe'
  END AS expiry_status,
  (expired_date - CURRENT_DATE) AS days_remaining,
  workspace_id
FROM public.warehouse_stock_summary
WHERE expired_date IS NOT NULL
  AND last_day_stock > 0;

CREATE OR REPLACE VIEW public.v_warehouse_so_summary
WITH (security_invoker = true)
AS
SELECT
  warehouse,
  opname_date,
  opname_label,
  COUNT(*) AS item_count,
  SUM(ABS(selisih)) AS total_abs_selisih,
  SUM(CASE WHEN selisih != 0 THEN 1 ELSE 0 END) AS items_with_selisih,
  SUM(CASE WHEN selisih > 0 THEN selisih ELSE 0 END) AS total_surplus,
  SUM(CASE WHEN selisih < 0 THEN selisih ELSE 0 END) AS total_deficit,
  workspace_id
FROM public.warehouse_stock_opname
GROUP BY workspace_id, warehouse, opname_date, opname_label;

CREATE OR REPLACE VIEW public.daily_channel_data
WITH (security_invoker = true)
AS
SELECT
  NULL::INT AS id,
  date,
  product,
  channel,
  gross_sales,
  discount,
  net_sales,
  cogs,
  gross_profit,
  mkt_cost,
  mp_admin_cost,
  net_after_mkt,
  NULL::INT AS import_id,
  workspace_id
FROM public.summary_daily_channel_complete;

CREATE OR REPLACE VIEW public.daily_product_summary
WITH (security_invoker = true)
AS
SELECT
  NULL::INT AS id,
  date,
  product,
  net_sales,
  gross_profit,
  mp_admin_cost,
  net_after_mkt,
  mkt_cost,
  NULL::INT AS import_id,
  workspace_id
FROM public.summary_daily_product_complete;

CREATE OR REPLACE VIEW public.v_pl_summary
WITH (security_invoker = true)
AS
SELECT
  month,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'penjualan'), 0) AS penjualan,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'diskon_penjualan'), 0) AS diskon_penjualan,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'penjualan_bersih'), 0) AS penjualan_bersih,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'beban_pokok_pendapatan'), 0) AS cogs,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'laba_bruto'), 0) AS laba_bruto,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'total_beban'), 0) AS total_beban,
  COALESCE(SUM(amount) FILTER (WHERE line_item LIKE 'beban_iklan%'), 0) AS beban_iklan,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'beban_adm_marketplace'), 0) AS beban_mp,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'beban_pengiriman'), 0) AS beban_pengiriman,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'beban_penjualan'), 0) AS beban_penjualan,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'beban_operasional'), 0) AS beban_operasional,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'pendapatan_lain_lain'), 0) AS pendapatan_lainnya,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'laba_rugi'), 0) AS laba_rugi,
  workspace_id
FROM public.financial_pl_monthly
GROUP BY workspace_id, month;

CREATE OR REPLACE VIEW public.v_cf_summary
WITH (security_invoker = true)
AS
SELECT
  month,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'penerimaan_pelanggan'), 0) AS penerimaan_pelanggan,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'penerimaan_reseller'), 0) AS penerimaan_reseller,
  COALESCE(
    MAX(amount) FILTER (WHERE line_item = 'cf_from_operation'),
    SUM(amount) FILTER (WHERE section = 'operasi'),
    0
  ) AS cf_operasi,
  COALESCE(SUM(amount) FILTER (WHERE section = 'investasi'), 0) AS cf_investasi,
  COALESCE(SUM(amount) FILTER (WHERE section = 'pendanaan'), 0) AS cf_pendanaan,
  COALESCE(SUM(amount) FILTER (
    WHERE section IN ('operasi', 'investasi', 'pendanaan')
  ), 0) AS net_cash_change,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'saldo_kas_awal'), 0) AS saldo_kas_awal,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'saldo_kas_akhir'), 0) AS saldo_kas_akhir,
  COALESCE(MAX(amount) FILTER (WHERE line_item = 'free_cash_flow'), 0) AS free_cash_flow,
  workspace_id
FROM public.financial_cf_monthly
GROUP BY workspace_id, month;

CREATE OR REPLACE FUNCTION public.get_workspace_daily_shipment_counts(
  p_workspace_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE(
  date DATE,
  product TEXT,
  channel TEXT,
  order_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.workspace_can_access(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace access denied';
  END IF;

  v_start := (p_from::TEXT || 'T00:00:00+07:00')::TIMESTAMPTZ;
  v_end := ((p_to + INTERVAL '1 day')::DATE::TEXT || 'T00:00:00+07:00')::TIMESTAMPTZ;

  RETURN QUERY
  WITH eligible_orders AS (
    SELECT
      o.id,
      DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta') AS ship_date
    FROM public.scalev_orders o
    WHERE o.workspace_id = p_workspace_id
      AND o.status IN ('shipped', 'completed')
      AND o.shipped_time IS NOT NULL
      AND o.shipped_time >= v_start
      AND o.shipped_time < v_end
  ),
  primary_line AS (
    SELECT DISTINCT ON (l.scalev_order_id)
      l.scalev_order_id,
      l.product_type,
      l.sales_channel
    FROM public.scalev_order_lines l
    JOIN eligible_orders eo
      ON l.scalev_order_id = eo.id
    WHERE l.workspace_id = p_workspace_id
      AND l.product_type IS NOT NULL
      AND l.product_type <> 'Unknown'
    ORDER BY l.scalev_order_id, l.product_price_bt DESC
  )
  SELECT
    eo.ship_date,
    pl.product_type,
    pl.sales_channel,
    COUNT(*)
  FROM primary_line pl
  JOIN eligible_orders eo
    ON pl.scalev_order_id = eo.id
  GROUP BY eo.ship_date, pl.product_type, pl.sales_channel
  ORDER BY eo.ship_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_workspace_daily_shipment_counts(
  UUID,
  DATE,
  DATE
) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_workspace_daily_shipping_charge_data(
  p_workspace_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE(
  date DATE,
  product TEXT,
  channel TEXT,
  shipping_charge NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH access_check AS (
    SELECT
      auth.role() = 'service_role'
      OR public.workspace_can_access(p_workspace_id) AS allowed
  ),
  bounds AS (
    SELECT
      (p_from::TEXT || 'T00:00:00+07:00')::TIMESTAMPTZ AS v_start,
      ((p_to + INTERVAL '1 day')::DATE::TEXT || 'T00:00:00+07:00')::TIMESTAMPTZ AS v_end
  ),
  eligible_orders AS (
    SELECT
      so.id,
      DATE(so.shipped_time AT TIME ZONE 'Asia/Jakarta') AS ship_date,
      COALESCE(so.shipping_cost, 0) AS shipping_gross_amount,
      COALESCE(
        so.shipping_discount,
        public.parse_scalev_money_text(so.raw_data::jsonb ->> 'shipping_discount'),
        public.parse_scalev_money_text(
          so.raw_data::jsonb -> 'message_variables' ->> 'shipping_discount'
        )
      ) AS shipping_discount_resolved
    FROM public.scalev_orders so
    CROSS JOIN bounds b
    CROSS JOIN access_check ac
    WHERE ac.allowed
      AND so.workspace_id = p_workspace_id
      AND so.status IN ('shipped', 'completed')
      AND so.shipped_time IS NOT NULL
      AND so.shipped_time >= b.v_start
      AND so.shipped_time < b.v_end
      AND COALESCE(so.shipping_cost, 0) > 0
      AND NOT (
        COALESCE(so.source_class, '') = 'marketplace'
        OR COALESCE(so.source, '') = 'marketplace_api_upload'
        OR LOWER(COALESCE(so.payment_method, '')) = 'marketplace'
        OR LOWER(COALESCE(so.financial_entity, '')) IN ('shopee', 'tiktok')
        OR LOWER(COALESCE(so.platform, '')) IN ('shopee', 'tiktok')
      )
  ),
  filtered_orders AS (
    SELECT
      eo.id,
      eo.ship_date,
      LEAST(
        GREATEST(COALESCE(eo.shipping_discount_resolved, 0), 0::NUMERIC),
        eo.shipping_gross_amount
      ) AS shipping_charge_amount
    FROM eligible_orders eo
    WHERE COALESCE(eo.shipping_discount_resolved, 0) > 0
  ),
  line_rollup AS (
    SELECT
      sol.scalev_order_id,
      COALESCE(sol.product_type, 'Unknown') AS product,
      COALESCE(sol.sales_channel, 'Unknown') AS channel,
      COUNT(*)::BIGINT AS line_count,
      SUM(
        GREATEST(
          COALESCE(sol.product_price_bt, 0) - COALESCE(sol.discount_bt, 0),
          0::NUMERIC
        )
      ) AS line_net_amount
    FROM public.scalev_order_lines sol
    JOIN filtered_orders fo
      ON fo.id = sol.scalev_order_id
    WHERE sol.workspace_id = p_workspace_id
    GROUP BY
      sol.scalev_order_id,
      COALESCE(sol.product_type, 'Unknown'),
      COALESCE(sol.sales_channel, 'Unknown')
  ),
  order_totals AS (
    SELECT
      lr.scalev_order_id,
      SUM(lr.line_count)::BIGINT AS order_line_count,
      SUM(lr.line_net_amount) AS order_line_net_total
    FROM line_rollup lr
    GROUP BY lr.scalev_order_id
  )
  SELECT
    fo.ship_date,
    lr.product,
    lr.channel,
    SUM(
      CASE
        WHEN COALESCE(ot.order_line_net_total, 0) > 0
          THEN fo.shipping_charge_amount
            * (lr.line_net_amount / ot.order_line_net_total)
        WHEN COALESCE(ot.order_line_count, 0) > 0
          THEN fo.shipping_charge_amount
            * (lr.line_count::NUMERIC / ot.order_line_count::NUMERIC)
        ELSE 0::NUMERIC
      END
    )
  FROM filtered_orders fo
  JOIN line_rollup lr
    ON lr.scalev_order_id = fo.id
  JOIN order_totals ot
    ON ot.scalev_order_id = fo.id
  GROUP BY fo.ship_date, lr.product, lr.channel
  ORDER BY fo.ship_date, lr.product, lr.channel;
$$;

GRANT EXECUTE ON FUNCTION public.get_workspace_daily_shipping_charge_data(
  UUID,
  DATE,
  DATE
) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_workspace_customer_type_daily_exact(
  p_workspace_id UUID,
  p_from DATE,
  p_to DATE,
  p_brand TEXT DEFAULT NULL,
  p_sales_channel TEXT DEFAULT NULL
)
RETURNS TABLE (
  date DATE,
  customer_type TEXT,
  sales_channel TEXT,
  order_count BIGINT,
  customer_count BIGINT,
  revenue NUMERIC,
  cogs NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH access_check AS (
    SELECT
      auth.role() = 'service_role'
      OR public.workspace_can_access(p_workspace_id) AS allowed
  ),
  eligible_orders AS (
    SELECT
      o.id AS order_db_id,
      o.customer_identifier,
      (o.shipped_time AT TIME ZONE 'Asia/Jakarta')::DATE AS order_date
    FROM public.scalev_orders o
    CROSS JOIN access_check ac
    WHERE ac.allowed
      AND o.workspace_id = p_workspace_id
      AND o.status IN ('shipped', 'completed')
      AND o.shipped_time >= (p_from::TIMESTAMP AT TIME ZONE 'Asia/Jakarta')
      AND o.shipped_time < ((p_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Jakarta')
  ),
  order_channel AS (
    SELECT
      eo.order_db_id,
      eo.customer_identifier,
      eo.order_date,
      COALESCE(NULLIF(BTRIM(l.sales_channel), ''), 'Unknown') AS sales_channel,
      SUM(COALESCE(l.product_price_bt, 0) - COALESCE(l.discount_bt, 0)) AS revenue,
      SUM(COALESCE(l.cogs_bt, 0)) AS cogs
    FROM eligible_orders eo
    JOIN public.scalev_order_lines l
      ON l.workspace_id = p_workspace_id
     AND l.scalev_order_id = eo.order_db_id
    WHERE l.product_type IS NOT NULL
      AND l.product_type <> 'Unknown'
      AND (p_brand IS NULL OR l.product_type = p_brand)
      AND (
        p_sales_channel IS NULL
        OR COALESCE(NULLIF(BTRIM(l.sales_channel), ''), 'Unknown') = p_sales_channel
      )
    GROUP BY
      eo.order_db_id,
      eo.customer_identifier,
      eo.order_date,
      COALESCE(NULLIF(BTRIM(l.sales_channel), ''), 'Unknown')
  ),
  first_orders AS (
    SELECT
      ids.customer_identifier,
      (
        SELECT (fo.shipped_time AT TIME ZONE 'Asia/Jakarta')::DATE
        FROM public.scalev_orders fo
        WHERE fo.workspace_id = p_workspace_id
          AND fo.customer_identifier = ids.customer_identifier
          AND fo.status IN ('shipped', 'completed')
          AND fo.shipped_time IS NOT NULL
        ORDER BY fo.shipped_time
        LIMIT 1
      ) AS first_order_date
    FROM (
      SELECT DISTINCT oc.customer_identifier
      FROM order_channel oc
      WHERE oc.customer_identifier IS NOT NULL
        AND BTRIM(oc.customer_identifier) <> ''
        AND oc.customer_identifier NOT LIKE 'unidentified:%'
    ) ids
  ),
  typed AS (
    SELECT
      oc.*,
      CASE
        WHEN oc.customer_identifier IS NULL
          OR BTRIM(oc.customer_identifier) = ''
          OR oc.customer_identifier LIKE 'unidentified:%'
          THEN 'unidentified'
        WHEN oc.order_date = f.first_order_date THEN 'new'
        ELSE 'ro'
      END AS resolved_customer_type
    FROM order_channel oc
    LEFT JOIN first_orders f
      ON f.customer_identifier = oc.customer_identifier
  )
  SELECT
    t.order_date,
    t.resolved_customer_type,
    t.sales_channel,
    COUNT(*)::BIGINT,
    COUNT(DISTINCT t.customer_identifier)::BIGINT,
    SUM(t.revenue)::NUMERIC,
    SUM(t.cogs)::NUMERIC
  FROM typed t
  GROUP BY
    t.order_date,
    t.resolved_customer_type,
    t.sales_channel
  ORDER BY
    t.order_date,
    t.sales_channel,
    t.resolved_customer_type;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_customer_type_daily_exact(
  UUID,
  DATE,
  DATE,
  TEXT,
  TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspace_customer_type_daily_exact(
  UUID,
  DATE,
  DATE,
  TEXT,
  TEXT
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_workspace_channel_sla(
  p_workspace_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE (
  sales_channel TEXT,
  payment_type TEXT,
  orders BIGINT,
  avg_days NUMERIC,
  median_days NUMERIC,
  p90_days NUMERIC,
  min_days NUMERIC,
  max_days NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH access_check AS (
    SELECT
      auth.role() = 'service_role'
      OR public.workspace_can_access(p_workspace_id) AS allowed
  ),
  eligible AS (
    SELECT
      o.id,
      COALESCE(
        NULLIF(BTRIM(channel.sales_channel), ''),
        NULLIF(BTRIM(o.store_name), ''),
        'Unknown'
      ) AS resolved_channel,
      CASE
        WHEN LOWER(COALESCE(o.payment_method, '')) = 'marketplace'
          OR LOWER(COALESCE(o.financial_entity, '')) IN ('shopee', 'tiktok')
          OR LOWER(COALESCE(o.platform, '')) IN ('shopee', 'tiktok', 'tiktokshop')
          THEN 'marketplace'
        WHEN public.is_bank_transfer(o.payment_method) THEN 'bank_transfer'
        WHEN LOWER(COALESCE(o.payment_method, '')) LIKE '%cod%' THEN 'cod'
        WHEN NULLIF(BTRIM(COALESCE(o.payment_method, '')), '') IS NULL THEN 'no_payment'
        ELSE 'unknown'
      END AS resolved_payment_type,
      EXTRACT(EPOCH FROM (o.completed_time - o.shipped_time)) / 86400.0 AS elapsed_days
    FROM public.scalev_orders o
    CROSS JOIN access_check ac
    LEFT JOIN LATERAL (
      SELECT l.sales_channel
      FROM public.scalev_order_lines l
      WHERE l.workspace_id = p_workspace_id
        AND l.scalev_order_id = o.id
        AND NULLIF(BTRIM(l.sales_channel), '') IS NOT NULL
      ORDER BY l.product_price_bt DESC NULLS LAST
      LIMIT 1
    ) channel ON TRUE
    WHERE ac.allowed
      AND o.workspace_id = p_workspace_id
      AND o.shipped_time IS NOT NULL
      AND o.completed_time IS NOT NULL
      AND o.shipped_time >= (p_from::TIMESTAMP AT TIME ZONE 'Asia/Jakarta')
      AND o.shipped_time < ((p_to + 1)::TIMESTAMP AT TIME ZONE 'Asia/Jakarta')
      AND o.completed_time >= o.shipped_time
      AND o.completed_time - o.shipped_time <= INTERVAL '90 days'
      AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned', 'deleted')
  )
  SELECT
    e.resolved_channel,
    e.resolved_payment_type,
    COUNT(*)::BIGINT,
    ROUND(AVG(e.elapsed_days)::NUMERIC, 1),
    ROUND(
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY e.elapsed_days)::NUMERIC,
      1
    ),
    ROUND(
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY e.elapsed_days)::NUMERIC,
      1
    ),
    ROUND(MIN(e.elapsed_days)::NUMERIC, 1),
    ROUND(MAX(e.elapsed_days)::NUMERIC, 1)
  FROM eligible e
  GROUP BY e.resolved_channel, e.resolved_payment_type
  ORDER BY COUNT(*) DESC;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_channel_sla(UUID, DATE, DATE)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_workspace_channel_sla(UUID, DATE, DATE)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_workspace_live_cashflow(
  p_workspace_id UUID,
  p_month INT,
  p_year INT
)
RETURNS TABLE(category TEXT, total NUMERIC, order_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start DATE := make_date(p_year, p_month, 1);
  v_end DATE := (make_date(p_year, p_month, 1) + INTERVAL '1 month')::DATE;
  v_prev_start DATE := (make_date(p_year, p_month, 1) - INTERVAL '1 month')::DATE;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.workspace_can_access(p_workspace_id) THEN
    RAISE EXCEPTION 'Workspace access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 'cash_received'::TEXT, COALESCE(SUM(ABS(o.net_revenue)), 0), COUNT(*)
  FROM public.scalev_orders o
  WHERE o.workspace_id = p_workspace_id
    AND o.shipped_time >= v_start
    AND o.shipped_time < v_end
    AND (
      o.completed_time IS NOT NULL
      OR public.is_bank_transfer(o.payment_method)
    )
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned');

  RETURN QUERY
  SELECT 'spill_over'::TEXT, COALESCE(SUM(ABS(o.net_revenue)), 0), COUNT(*)
  FROM public.scalev_orders o
  WHERE o.workspace_id = p_workspace_id
    AND o.shipped_time >= v_prev_start
    AND o.shipped_time < v_start
    AND o.completed_time >= v_start
    AND o.completed_time < v_end
    AND NOT public.is_bank_transfer(o.payment_method)
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned');

  RETURN QUERY
  SELECT 'in_progress'::TEXT, COALESCE(SUM(ABS(o.net_revenue)), 0), COUNT(*)
  FROM public.scalev_orders o
  WHERE o.workspace_id = p_workspace_id
    AND o.shipped_time >= v_start
    AND o.shipped_time < v_end
    AND o.completed_time IS NULL
    AND NOT public.is_bank_transfer(o.payment_method)
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned');

  RETURN QUERY
  SELECT 'overdue'::TEXT, COALESCE(SUM(ABS(o.net_revenue)), 0), COUNT(*)
  FROM public.scalev_orders o
  WHERE o.workspace_id = p_workspace_id
    AND o.shipped_time >= v_prev_start
    AND o.shipped_time < v_start
    AND o.completed_time IS NULL
    AND NOT public.is_bank_transfer(o.payment_method)
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_live_cashflow_by_channel(
  p_workspace_id UUID,
  p_month INT,
  p_year INT
)
RETURNS TABLE(
  category TEXT,
  platform TEXT,
  is_fb BOOLEAN,
  pay_method TEXT,
  total NUMERIC,
  order_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start DATE := make_date(p_year, p_month, 1);
  v_end DATE := (make_date(p_year, p_month, 1) + INTERVAL '1 month')::DATE;
  v_prev_start DATE := (make_date(p_year, p_month, 1) - INTERVAL '1 month')::DATE;
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.workspace_can_access(p_workspace_id) THEN
    RAISE EXCEPTION 'Workspace access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT 'cash_received'::TEXT, o.platform, o.is_purchase_fb, o.payment_method,
         COALESCE(SUM(ABS(o.net_revenue)), 0)::NUMERIC, COUNT(*)::BIGINT
  FROM public.scalev_orders o
  WHERE o.workspace_id = p_workspace_id
    AND o.shipped_time >= v_start AND o.shipped_time < v_end
    AND (o.completed_time IS NOT NULL OR public.is_bank_transfer(o.payment_method))
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
  GROUP BY o.platform, o.is_purchase_fb, o.payment_method;

  RETURN QUERY
  SELECT 'spill_over'::TEXT, o.platform, o.is_purchase_fb, o.payment_method,
         COALESCE(SUM(ABS(o.net_revenue)), 0)::NUMERIC, COUNT(*)::BIGINT
  FROM public.scalev_orders o
  WHERE o.workspace_id = p_workspace_id
    AND o.shipped_time >= v_prev_start AND o.shipped_time < v_start
    AND o.completed_time >= v_start AND o.completed_time < v_end
    AND NOT public.is_bank_transfer(o.payment_method)
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
  GROUP BY o.platform, o.is_purchase_fb, o.payment_method;

  RETURN QUERY
  SELECT 'in_progress'::TEXT, o.platform, o.is_purchase_fb, o.payment_method,
         COALESCE(SUM(ABS(o.net_revenue)), 0)::NUMERIC, COUNT(*)::BIGINT
  FROM public.scalev_orders o
  WHERE o.workspace_id = p_workspace_id
    AND o.shipped_time >= v_start AND o.shipped_time < v_end
    AND o.completed_time IS NULL
    AND NOT public.is_bank_transfer(o.payment_method)
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
  GROUP BY o.platform, o.is_purchase_fb, o.payment_method;

  RETURN QUERY
  SELECT 'overdue'::TEXT, o.platform, o.is_purchase_fb, o.payment_method,
         COALESCE(SUM(ABS(o.net_revenue)), 0)::NUMERIC, COUNT(*)::BIGINT
  FROM public.scalev_orders o
  WHERE o.workspace_id = p_workspace_id
    AND o.shipped_time >= v_prev_start AND o.shipped_time < v_start
    AND o.completed_time IS NULL
    AND NOT public.is_bank_transfer(o.payment_method)
    AND o.status NOT IN ('canceled', 'cancelled', 'failed', 'returned')
  GROUP BY o.platform, o.is_purchase_fb, o.payment_method;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_shipment_status(
  p_workspace_id UUID,
  p_from DATE,
  p_to DATE
)
RETURNS TABLE(
  sales_channel TEXT,
  completed_orders BIGINT,
  completed_revenue NUMERIC,
  in_transit_orders BIGINT,
  in_transit_revenue NUMERIC,
  returned_orders BIGINT,
  returned_revenue NUMERIC,
  overdue_orders BIGINT,
  overdue_revenue NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role'
     AND NOT public.workspace_can_access(p_workspace_id) THEN
    RAISE EXCEPTION 'Workspace access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH current_period AS (
    SELECT
      COALESCE(l.sales_channel, 'Unknown') AS ch,
      o.completed_time,
      o.status,
      COALESCE(l.line_rev, 0) AS rev
    FROM public.scalev_orders o
    LEFT JOIN LATERAL (
      SELECT
        ol.sales_channel,
        SUM(ol.product_price_bt - ol.discount_bt) AS line_rev
      FROM public.scalev_order_lines ol
      WHERE ol.workspace_id = p_workspace_id
        AND ol.scalev_order_id = o.id
      GROUP BY ol.sales_channel
    ) l ON TRUE
    WHERE o.workspace_id = p_workspace_id
      AND o.shipped_time IS NOT NULL
      AND o.shipped_time >= p_from
      AND o.shipped_time < (p_to + INTERVAL '1 day')
      AND o.status NOT IN ('deleted')
  ),
  overdue AS (
    SELECT
      COALESCE(l.sales_channel, 'Unknown') AS ch,
      COALESCE(l.line_rev, 0) AS rev
    FROM public.scalev_orders o
    LEFT JOIN LATERAL (
      SELECT
        ol.sales_channel,
        SUM(ol.product_price_bt - ol.discount_bt) AS line_rev
      FROM public.scalev_order_lines ol
      WHERE ol.workspace_id = p_workspace_id
        AND ol.scalev_order_id = o.id
      GROUP BY ol.sales_channel
    ) l ON TRUE
    WHERE o.workspace_id = p_workspace_id
      AND o.shipped_time IS NOT NULL
      AND o.shipped_time < p_from
      AND o.completed_time IS NULL
      AND o.status NOT IN (
        'canceled', 'cancelled', 'failed', 'returned', 'rts',
        'shipped_rts', 'deleted'
      )
  ),
  current_agg AS (
    SELECT
      ch AS sales_channel,
      COUNT(*) FILTER (
        WHERE completed_time IS NOT NULL
          AND status NOT IN (
            'canceled', 'cancelled', 'failed', 'returned', 'rts', 'shipped_rts'
          )
      ) AS completed_orders,
      COALESCE(SUM(rev) FILTER (
        WHERE completed_time IS NOT NULL
          AND status NOT IN (
            'canceled', 'cancelled', 'failed', 'returned', 'rts', 'shipped_rts'
          )
      ), 0) AS completed_revenue,
      COUNT(*) FILTER (
        WHERE completed_time IS NULL
          AND status NOT IN (
            'canceled', 'cancelled', 'failed', 'returned', 'rts', 'shipped_rts'
          )
      ) AS in_transit_orders,
      COALESCE(SUM(rev) FILTER (
        WHERE completed_time IS NULL
          AND status NOT IN (
            'canceled', 'cancelled', 'failed', 'returned', 'rts', 'shipped_rts'
          )
      ), 0) AS in_transit_revenue,
      COUNT(*) FILTER (
        WHERE status IN (
          'canceled', 'cancelled', 'failed', 'returned', 'rts', 'shipped_rts'
        )
      ) AS returned_orders,
      COALESCE(SUM(rev) FILTER (
        WHERE status IN (
          'canceled', 'cancelled', 'failed', 'returned', 'rts', 'shipped_rts'
        )
      ), 0) AS returned_revenue
    FROM current_period
    GROUP BY ch
  ),
  overdue_agg AS (
    SELECT
      ch AS sales_channel,
      COUNT(*) AS overdue_orders,
      COALESCE(SUM(rev), 0) AS overdue_revenue
    FROM overdue
    GROUP BY ch
  )
  SELECT
    COALESCE(c.sales_channel, ov.sales_channel),
    COALESCE(c.completed_orders, 0)::BIGINT,
    COALESCE(c.completed_revenue, 0)::NUMERIC,
    COALESCE(c.in_transit_orders, 0)::BIGINT,
    COALESCE(c.in_transit_revenue, 0)::NUMERIC,
    COALESCE(c.returned_orders, 0)::BIGINT,
    COALESCE(c.returned_revenue, 0)::NUMERIC,
    COALESCE(ov.overdue_orders, 0)::BIGINT,
    COALESCE(ov.overdue_revenue, 0)::NUMERIC
  FROM current_agg c
  FULL OUTER JOIN overdue_agg ov
    ON c.sales_channel = ov.sales_channel;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_workspace_live_cashflow(UUID, INT, INT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_live_cashflow_by_channel(
  UUID,
  INT,
  INT
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_shipment_status(UUID, DATE, DATE)
  TO authenticated;

COMMIT;
