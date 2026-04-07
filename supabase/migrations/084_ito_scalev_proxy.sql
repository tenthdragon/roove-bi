-- Migration 084: Monthly movements from Scalev orders (proxy for ITO when warehouse ledger is empty)
CREATE OR REPLACE FUNCTION ppic_monthly_movements_scalev(p_months INT DEFAULT 6)
RETURNS TABLE (
  warehouse_product_id INT,
  product_name TEXT,
  entity TEXT,
  category TEXT,
  yr INT,
  mn INT,
  total_in NUMERIC,
  total_out NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    wp.id AS warehouse_product_id,
    wp.name AS product_name,
    wp.entity,
    wp.category,
    EXTRACT(YEAR FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta')::INT AS yr,
    EXTRACT(MONTH FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta')::INT AS mn,
    0::NUMERIC AS total_in,
    SUM(ol.quantity * COALESCE(m.deduct_qty_multiplier, 1)) AS total_out
  FROM scalev_order_lines ol
  JOIN scalev_orders o ON o.id = ol.scalev_order_id
  JOIN warehouse_scalev_mapping m ON m.scalev_product_name = ol.product_name
    AND m.warehouse_product_id IS NOT NULL
    AND m.is_ignored = false
  JOIN warehouse_products wp ON wp.id = m.warehouse_product_id
  WHERE o.status IN ('shipped', 'completed')
    AND o.shipped_time IS NOT NULL
    AND o.shipped_time >= (NOW() - (p_months || ' months')::INTERVAL)
  GROUP BY wp.id, wp.name, wp.entity, wp.category,
    EXTRACT(YEAR FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta'),
    EXTRACT(MONTH FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta')
  ORDER BY yr DESC, mn DESC, wp.name;
END;
$$ LANGUAGE plpgsql STABLE;
