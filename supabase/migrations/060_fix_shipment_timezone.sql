-- ============================================================
-- Migration 060: Fix timezone in get_daily_shipment_counts
--
-- Bug: DATE(shipped_time) uses UTC, causing orders shipped at
-- e.g. 2026-03-09 00:00 WIB (= 2026-03-08 17:00 UTC) to be
-- counted on the wrong date in the dashboard.
--
-- Fix: Convert shipped_time to Asia/Jakarta before DATE().
-- Uses timestamptz range filter for index efficiency.
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
DECLARE
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  -- Convert date range to WIB timestamptz for index-friendly filtering
  v_start := (p_from::TEXT || 'T00:00:00+07:00')::TIMESTAMPTZ;
  v_end   := ((p_to + INTERVAL '1 day')::DATE::TEXT || 'T00:00:00+07:00')::TIMESTAMPTZ;

  RETURN QUERY
  WITH eligible_orders AS (
    SELECT o.id, o.order_id, o.shipped_time,
      DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta') AS ship_date
    FROM scalev_orders o
    WHERE o.status IN ('shipped', 'completed')
      AND o.shipped_time IS NOT NULL
      AND o.shipped_time >= v_start
      AND o.shipped_time < v_end
  ),
  primary_line AS (
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
    eo.ship_date AS date,
    pl.product_type AS product,
    pl.sales_channel AS channel,
    COUNT(*) AS order_count
  FROM primary_line pl
  JOIN eligible_orders eo ON pl.scalev_order_id = eo.id
  GROUP BY eo.ship_date, pl.product_type, pl.sales_channel
  ORDER BY date;
END;
$$;
