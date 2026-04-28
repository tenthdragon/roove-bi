BEGIN;

CREATE OR REPLACE FUNCTION public.get_daily_shipping_charge_data(p_from DATE, p_to DATE)
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
  WITH bounds AS (
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
        public.parse_scalev_money_text(so.raw_data::jsonb -> 'message_variables' ->> 'shipping_discount')
      ) AS shipping_discount_resolved
    FROM public.scalev_orders so
    CROSS JOIN bounds b
    WHERE so.status IN ('shipped', 'completed')
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
      SUM(GREATEST(COALESCE(sol.product_price_bt, 0) - COALESCE(sol.discount_bt, 0), 0::NUMERIC)) AS line_net_amount
    FROM public.scalev_order_lines sol
    JOIN filtered_orders fo
      ON fo.id = sol.scalev_order_id
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
    fo.ship_date AS date,
    lr.product,
    lr.channel,
    SUM(
      CASE
        WHEN COALESCE(ot.order_line_net_total, 0) > 0
          THEN fo.shipping_charge_amount * (lr.line_net_amount / ot.order_line_net_total)
        WHEN COALESCE(ot.order_line_count, 0) > 0
          THEN fo.shipping_charge_amount * (lr.line_count::NUMERIC / ot.order_line_count::NUMERIC)
        ELSE 0::NUMERIC
      END
    ) AS shipping_charge
  FROM filtered_orders fo
  JOIN line_rollup lr
    ON lr.scalev_order_id = fo.id
  JOIN order_totals ot
    ON ot.scalev_order_id = fo.id
  GROUP BY fo.ship_date, lr.product, lr.channel
  ORDER BY fo.ship_date, lr.product, lr.channel;
$$;

COMMENT ON FUNCTION public.get_daily_shipping_charge_data(DATE, DATE) IS
  'Returns daily company-borne shipping charges allocated to product and channel by line-level net-sales share, excluding marketplace pass-through shipping such as Shopee and TikTok.';

COMMIT;
