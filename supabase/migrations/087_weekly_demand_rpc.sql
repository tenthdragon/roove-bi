-- Migration 087: RPC for weekly demand breakdown from Scalev orders
-- Single query replaces multiple paginated client-side queries

CREATE OR REPLACE FUNCTION ppic_weekly_demand_scalev(
  p_month_start TIMESTAMPTZ,
  p_month_end TIMESTAMPTZ
)
RETURNS TABLE (
  warehouse_product_id INT,
  week_num INT,
  total_out NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    m.warehouse_product_id,
    CASE
      WHEN EXTRACT(DAY FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta') <= 7 THEN 1
      WHEN EXTRACT(DAY FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta') <= 14 THEN 2
      WHEN EXTRACT(DAY FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta') <= 21 THEN 3
      ELSE 4
    END::INT AS week_num,
    SUM(ol.quantity * COALESCE(m.deduct_qty_multiplier, 1)) AS total_out
  FROM scalev_order_lines ol
  JOIN scalev_orders o ON o.id = ol.scalev_order_id
  JOIN warehouse_scalev_mapping m ON m.scalev_product_name = ol.product_name
    AND m.warehouse_product_id IS NOT NULL
    AND m.is_ignored = false
  WHERE o.status IN ('shipped', 'completed')
    AND o.shipped_time IS NOT NULL
    AND o.shipped_time >= p_month_start
    AND o.shipped_time <= p_month_end
  GROUP BY m.warehouse_product_id,
    CASE
      WHEN EXTRACT(DAY FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta') <= 7 THEN 1
      WHEN EXTRACT(DAY FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta') <= 14 THEN 2
      WHEN EXTRACT(DAY FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta') <= 21 THEN 3
      ELSE 4
    END;
END;
$$ LANGUAGE plpgsql STABLE;
