-- Migration 086: Incremental summary table for Scalev monthly movements (ITO proxy)
-- Updated by trigger on scalev_order_lines INSERT/UPDATE, always fresh without REFRESH.

-- 1. Summary table
CREATE TABLE IF NOT EXISTS summary_scalev_monthly_movements (
  warehouse_product_id INT NOT NULL,
  yr INT NOT NULL,
  mn INT NOT NULL,
  total_out NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (warehouse_product_id, yr, mn)
);

-- 2. Backfill from existing data
INSERT INTO summary_scalev_monthly_movements (warehouse_product_id, yr, mn, total_out)
SELECT
  wp.id,
  EXTRACT(YEAR FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta')::INT,
  EXTRACT(MONTH FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta')::INT,
  SUM(ol.quantity * COALESCE(m.deduct_qty_multiplier, 1))
FROM scalev_order_lines ol
JOIN scalev_orders o ON o.id = ol.scalev_order_id
JOIN warehouse_scalev_mapping m ON m.scalev_product_name = ol.product_name
  AND m.warehouse_product_id IS NOT NULL AND m.is_ignored = false
JOIN warehouse_products wp ON wp.id = m.warehouse_product_id
WHERE o.status IN ('shipped', 'completed') AND o.shipped_time IS NOT NULL
GROUP BY wp.id,
  EXTRACT(YEAR FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta'),
  EXTRACT(MONTH FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta')
ON CONFLICT (warehouse_product_id, yr, mn) DO UPDATE
  SET total_out = EXCLUDED.total_out, updated_at = NOW();

-- 3. Trigger function: update summary when order line is inserted/updated
CREATE OR REPLACE FUNCTION trg_update_scalev_monthly_movement()
RETURNS TRIGGER AS $$
DECLARE
  v_shipped_time TIMESTAMPTZ;
  v_status TEXT;
  v_wp_id INT;
  v_multiplier NUMERIC;
  v_yr INT;
  v_mn INT;
BEGIN
  -- Get order info
  SELECT shipped_time, status INTO v_shipped_time, v_status
  FROM scalev_orders WHERE id = NEW.scalev_order_id;

  IF v_shipped_time IS NULL OR v_status NOT IN ('shipped', 'completed') THEN
    RETURN NEW;
  END IF;

  -- Get warehouse product mapping
  SELECT warehouse_product_id, deduct_qty_multiplier INTO v_wp_id, v_multiplier
  FROM warehouse_scalev_mapping
  WHERE scalev_product_name = NEW.product_name
    AND warehouse_product_id IS NOT NULL AND is_ignored = false;

  IF v_wp_id IS NULL THEN RETURN NEW; END IF;

  v_yr := EXTRACT(YEAR FROM v_shipped_time AT TIME ZONE 'Asia/Jakarta')::INT;
  v_mn := EXTRACT(MONTH FROM v_shipped_time AT TIME ZONE 'Asia/Jakarta')::INT;

  INSERT INTO summary_scalev_monthly_movements (warehouse_product_id, yr, mn, total_out)
  VALUES (v_wp_id, v_yr, v_mn, NEW.quantity * COALESCE(v_multiplier, 1))
  ON CONFLICT (warehouse_product_id, yr, mn) DO UPDATE
    SET total_out = summary_scalev_monthly_movements.total_out + NEW.quantity * COALESCE(v_multiplier, 1),
        updated_at = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Attach trigger
DROP TRIGGER IF EXISTS trg_scalev_monthly_movement_insert ON scalev_order_lines;
CREATE TRIGGER trg_scalev_monthly_movement_insert
  AFTER INSERT ON scalev_order_lines
  FOR EACH ROW EXECUTE FUNCTION trg_update_scalev_monthly_movement();

-- 5. Replace RPC to read from summary table
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
  SELECT s.warehouse_product_id, wp.name AS product_name, wp.entity, wp.category,
    s.yr, s.mn, 0::NUMERIC AS total_in, s.total_out
  FROM summary_scalev_monthly_movements s
  JOIN warehouse_products wp ON wp.id = s.warehouse_product_id
  WHERE (s.yr * 100 + s.mn) >= (
    EXTRACT(YEAR FROM NOW() - (p_months || ' months')::INTERVAL)::INT * 100 +
    EXTRACT(MONTH FROM NOW() - (p_months || ' months')::INTERVAL)::INT
  )
  ORDER BY s.yr DESC, s.mn DESC, wp.name;
END;
$$ LANGUAGE plpgsql STABLE;
