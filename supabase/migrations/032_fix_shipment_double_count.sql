-- ============================================================
-- Fix shipment double-counting in get_daily_shipment_counts
--
-- Previously: GROUP BY product_type caused orders with items from
-- multiple brands (e.g. Globite + Roove bundle) to be counted
-- once per brand. Summing order_count across products inflated totals.
--
-- Fix: Assign each order to ONE primary product (highest product_price_bt)
-- so each order = exactly 1 shipment. Product filter still works.
-- ============================================================

DROP FUNCTION IF EXISTS get_daily_shipment_counts(DATE, DATE);

CREATE OR REPLACE FUNCTION get_daily_shipment_counts(p_from DATE, p_to DATE)
RETURNS TABLE(
  date DATE,
  product TEXT,
  channel TEXT,
  order_count BIGINT
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH eligible_orders AS (
    SELECT id, order_id, shipped_time
    FROM scalev_orders
    WHERE status IN ('shipped', 'completed')
      AND shipped_time IS NOT NULL
      AND shipped_time >= p_from
      AND shipped_time < (p_to + INTERVAL '1 day')
  ),
  primary_line AS (
    -- Pick ONE product_type per order: the line with highest product_price_bt
    SELECT DISTINCT ON (l.scalev_order_id)
      l.scalev_order_id,
      l.product_type,
      l.sales_channel
    FROM scalev_order_lines l
    JOIN eligible_orders eo ON l.scalev_order_id = eo.id
    WHERE l.product_type IS NOT NULL
      AND l.product_type != 'Unknown'
    ORDER BY l.scalev_order_id, l.product_price_bt DESC
  )
  SELECT
    DATE(eo.shipped_time) AS date,
    pl.product_type AS product,
    pl.sales_channel AS channel,
    COUNT(*) AS order_count
  FROM primary_line pl
  JOIN eligible_orders eo ON pl.scalev_order_id = eo.id
  GROUP BY DATE(eo.shipped_time), pl.product_type, pl.sales_channel
  ORDER BY date;
END;
$$;
