BEGIN;

CREATE OR REPLACE FUNCTION public.get_daily_shipping_charge_data(p_from DATE, p_to DATE)
RETURNS TABLE(
  date DATE,
  product TEXT,
  channel TEXT,
  shipping_charge NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  v_start := (p_from::TEXT || 'T00:00:00+07:00')::TIMESTAMPTZ;
  v_end := ((p_to + INTERVAL '1 day')::DATE::TEXT || 'T00:00:00+07:00')::TIMESTAMPTZ;

  RETURN QUERY
  WITH eligible_orders AS (
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
    WHERE so.status IN ('shipped', 'completed')
      AND so.shipped_time IS NOT NULL
      AND so.shipped_time >= v_start
      AND so.shipped_time < v_end
  ),
  order_lines AS (
    SELECT
      eo.ship_date,
      CASE
        WHEN eo.shipping_gross_amount = 0 THEN 0::NUMERIC
        WHEN eo.shipping_discount_resolved IS NULL THEN 0::NUMERIC
        ELSE LEAST(GREATEST(eo.shipping_discount_resolved, 0::NUMERIC), eo.shipping_gross_amount)
      END AS shipping_charge_amount,
      COALESCE(sol.product_type, 'Unknown') AS product,
      COALESCE(sol.sales_channel, 'Unknown') AS channel,
      GREATEST(COALESCE(sol.product_price_bt, 0) - COALESCE(sol.discount_bt, 0), 0::NUMERIC) AS line_net_amount,
      COUNT(*) OVER (PARTITION BY sol.scalev_order_id) AS order_line_count,
      SUM(GREATEST(COALESCE(sol.product_price_bt, 0) - COALESCE(sol.discount_bt, 0), 0::NUMERIC))
        OVER (PARTITION BY sol.scalev_order_id) AS order_line_net_total
    FROM eligible_orders eo
    JOIN public.scalev_order_lines sol
      ON sol.scalev_order_id = eo.id
  ),
  allocated_lines AS (
    SELECT
      ol.ship_date,
      ol.product,
      ol.channel,
      CASE
        WHEN ol.shipping_charge_amount IS NULL THEN 0::NUMERIC
        WHEN COALESCE(ol.order_line_net_total, 0) > 0 THEN ol.shipping_charge_amount * (ol.line_net_amount / ol.order_line_net_total)
        WHEN COALESCE(ol.order_line_count, 0) > 0 THEN ol.shipping_charge_amount / ol.order_line_count
        ELSE 0::NUMERIC
      END AS allocated_shipping_charge
    FROM order_lines ol
  )
  SELECT
    al.ship_date AS date,
    al.product AS product,
    al.channel AS channel,
    SUM(al.allocated_shipping_charge) AS shipping_charge
  FROM allocated_lines al
  GROUP BY al.ship_date, al.product, al.channel
  HAVING SUM(al.allocated_shipping_charge) <> 0::NUMERIC
  ORDER BY al.ship_date, al.product, al.channel;
END;
$$;

COMMENT ON FUNCTION public.get_daily_shipping_charge_data(DATE, DATE) IS
  'Returns daily company-borne shipping charges allocated to product and channel by line-level net-sales share, using ScaleV shipping_discount when available or recoverable from raw_data.';

COMMIT;
