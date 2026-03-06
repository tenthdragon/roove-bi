-- ============================================================
-- Daily Shipment Counts RPC
-- Returns order counts per date × product × channel
-- Used by the "Daily Shipments" table on the Sales Channel page
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
  SELECT
    DATE(o.shipped_time) AS date,
    l.product_type AS product,
    CASE
      WHEN l.sales_channel IN ('TikTok Ads', 'TikTok Shop') THEN 'TikTok'
      ELSE l.sales_channel
    END AS channel,
    COUNT(DISTINCT o.order_id) AS order_count
  FROM scalev_order_lines l
  JOIN scalev_orders o ON l.scalev_order_id = o.id
  WHERE o.status IN ('shipped', 'completed')
    AND o.shipped_time IS NOT NULL
    AND o.shipped_time >= p_from
    AND o.shipped_time < (p_to + INTERVAL '1 day')
    AND l.product_type IS NOT NULL
    AND l.product_type != 'Unknown'
  GROUP BY
    DATE(o.shipped_time),
    l.product_type,
    CASE
      WHEN l.sales_channel IN ('TikTok Ads', 'TikTok Shop') THEN 'TikTok'
      ELSE l.sales_channel
    END
  ORDER BY date;
END;
$$;
