-- Migration 110: PPIC demand summary read model
-- Purpose:
-- - Make PPIC Reorder Point and Demand Planning reads production-grade.
-- - Avoid large raw joins against scalev_orders + scalev_order_lines on every page load.
-- - Keep warehouse product mapping dynamic by summarizing per ScaleV product_name first.

-- ============================================================================
-- 1. Daily ScaleV demand summary by product_name
-- ============================================================================

CREATE TABLE IF NOT EXISTS summary_scalev_daily_product_demand (
  demand_date DATE NOT NULL,
  scalev_product_name TEXT NOT NULL,
  total_qty NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (demand_date, scalev_product_name)
);

COMMENT ON TABLE summary_scalev_daily_product_demand IS
  'Daily shipped/completed ScaleV demand summarized by raw ScaleV product_name. PPIC joins this to warehouse_scalev_mapping at read time so mapping edits remain immediately effective.';
COMMENT ON COLUMN summary_scalev_daily_product_demand.demand_date IS
  'Order shipped date in Asia/Jakarta time zone.';
COMMENT ON COLUMN summary_scalev_daily_product_demand.total_qty IS
  'Raw summed ScaleV quantity for the given day and product_name before warehouse mapping multiplier.';

CREATE INDEX IF NOT EXISTS idx_ssdpd_product_date
  ON summary_scalev_daily_product_demand (scalev_product_name, demand_date);

CREATE INDEX IF NOT EXISTS idx_ssdpd_updated_at
  ON summary_scalev_daily_product_demand (updated_at DESC);

-- ============================================================================
-- 2. Helper to apply incremental deltas safely
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_apply_scalev_daily_product_demand_delta(
  p_demand_date DATE,
  p_product_name TEXT,
  p_quantity_delta NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_demand_date IS NULL
     OR COALESCE(BTRIM(p_product_name), '') = ''
     OR COALESCE(p_quantity_delta, 0) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO summary_scalev_daily_product_demand (
    demand_date,
    scalev_product_name,
    total_qty,
    updated_at
  )
  VALUES (
    p_demand_date,
    p_product_name,
    p_quantity_delta,
    NOW()
  )
  ON CONFLICT (demand_date, scalev_product_name) DO UPDATE
    SET total_qty = summary_scalev_daily_product_demand.total_qty + EXCLUDED.total_qty,
        updated_at = NOW();

  DELETE FROM summary_scalev_daily_product_demand
  WHERE demand_date = p_demand_date
    AND scalev_product_name = p_product_name
    AND ABS(total_qty) < 0.000001;
END;
$$;

-- ============================================================================
-- 3. Full/partial rebuild helper for operational recovery
-- ============================================================================

CREATE OR REPLACE FUNCTION refresh_scalev_daily_product_demand(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_from DATE;
  v_to DATE;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    TRUNCATE summary_scalev_daily_product_demand;

    INSERT INTO summary_scalev_daily_product_demand (
      demand_date,
      scalev_product_name,
      total_qty,
      updated_at
    )
    SELECT
      DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta') AS demand_date,
      ol.product_name AS scalev_product_name,
      SUM(COALESCE(ol.quantity, 0)) AS total_qty,
      NOW() AS updated_at
    FROM scalev_order_lines ol
    JOIN scalev_orders o
      ON o.id = ol.scalev_order_id
    WHERE o.status IN ('shipped', 'completed')
      AND o.shipped_time IS NOT NULL
      AND COALESCE(BTRIM(ol.product_name), '') <> ''
    GROUP BY
      DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta'),
      ol.product_name;

    RETURN;
  END IF;

  v_from := LEAST(p_from, p_to);
  v_to := GREATEST(p_from, p_to);

  DELETE FROM summary_scalev_daily_product_demand
  WHERE demand_date BETWEEN v_from AND v_to;

  INSERT INTO summary_scalev_daily_product_demand (
    demand_date,
    scalev_product_name,
    total_qty,
    updated_at
  )
  SELECT
    DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta') AS demand_date,
    ol.product_name AS scalev_product_name,
    SUM(COALESCE(ol.quantity, 0)) AS total_qty,
    NOW() AS updated_at
  FROM scalev_order_lines ol
  JOIN scalev_orders o
    ON o.id = ol.scalev_order_id
  WHERE o.status IN ('shipped', 'completed')
    AND o.shipped_time IS NOT NULL
    AND COALESCE(BTRIM(ol.product_name), '') <> ''
    AND DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta') BETWEEN v_from AND v_to
  GROUP BY
    DATE(o.shipped_time AT TIME ZONE 'Asia/Jakarta'),
    ol.product_name;
END;
$$;

COMMENT ON FUNCTION refresh_scalev_daily_product_demand(DATE, DATE) IS
  'Rebuilds the PPIC daily ScaleV demand summary. Pass a date window for targeted repair, or omit both args for a full rebuild.';

-- ============================================================================
-- 4. Incremental maintenance from ScaleV order line writes
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_update_scalev_daily_product_demand()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order scalev_orders%ROWTYPE;
  v_old_order scalev_orders%ROWTYPE;
  v_old_date DATE;
  v_new_date DATE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO v_old_order
    FROM scalev_orders
    WHERE id = OLD.scalev_order_id;

    IF v_old_order.status IN ('shipped', 'completed')
       AND v_old_order.shipped_time IS NOT NULL THEN
      v_old_date := DATE(v_old_order.shipped_time AT TIME ZONE 'Asia/Jakarta');
      PERFORM fn_apply_scalev_daily_product_demand_delta(
        v_old_date,
        OLD.product_name,
        -COALESCE(OLD.quantity, 0)
      );
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO v_order
    FROM scalev_orders
    WHERE id = NEW.scalev_order_id;

    IF v_order.status IN ('shipped', 'completed')
       AND v_order.shipped_time IS NOT NULL THEN
      v_new_date := DATE(v_order.shipped_time AT TIME ZONE 'Asia/Jakarta');
      PERFORM fn_apply_scalev_daily_product_demand_delta(
        v_new_date,
        NEW.product_name,
        COALESCE(NEW.quantity, 0)
      );
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT * INTO v_old_order
    FROM scalev_orders
    WHERE id = OLD.scalev_order_id;

    IF v_old_order.status IN ('shipped', 'completed')
       AND v_old_order.shipped_time IS NOT NULL THEN
      v_old_date := DATE(v_old_order.shipped_time AT TIME ZONE 'Asia/Jakarta');
      PERFORM fn_apply_scalev_daily_product_demand_delta(
        v_old_date,
        OLD.product_name,
        -COALESCE(OLD.quantity, 0)
      );
    END IF;

    SELECT * INTO v_order
    FROM scalev_orders
    WHERE id = NEW.scalev_order_id;

    IF v_order.status IN ('shipped', 'completed')
       AND v_order.shipped_time IS NOT NULL THEN
      v_new_date := DATE(v_order.shipped_time AT TIME ZONE 'Asia/Jakarta');
      PERFORM fn_apply_scalev_daily_product_demand_delta(
        v_new_date,
        NEW.product_name,
        COALESCE(NEW.quantity, 0)
      );
    END IF;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

-- ============================================================================
-- 5. Incremental maintenance from order status/date transitions
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_scalev_daily_product_demand_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_qualifying BOOLEAN;
  v_new_qualifying BOOLEAN;
  v_old_date DATE;
  v_new_date DATE;
  v_line RECORD;
BEGIN
  v_old_qualifying := OLD.status IN ('shipped', 'completed') AND OLD.shipped_time IS NOT NULL;
  v_new_qualifying := NEW.status IN ('shipped', 'completed') AND NEW.shipped_time IS NOT NULL;

  IF v_old_qualifying = v_new_qualifying
     AND OLD.shipped_time IS NOT DISTINCT FROM NEW.shipped_time THEN
    RETURN NEW;
  END IF;

  v_old_date := CASE
    WHEN OLD.shipped_time IS NULL THEN NULL
    ELSE DATE(OLD.shipped_time AT TIME ZONE 'Asia/Jakarta')
  END;

  v_new_date := CASE
    WHEN NEW.shipped_time IS NULL THEN NULL
    ELSE DATE(NEW.shipped_time AT TIME ZONE 'Asia/Jakarta')
  END;

  IF v_old_qualifying THEN
    FOR v_line IN
      SELECT product_name, quantity
      FROM scalev_order_lines
      WHERE scalev_order_id = OLD.id
    LOOP
      PERFORM fn_apply_scalev_daily_product_demand_delta(
        v_old_date,
        v_line.product_name,
        -COALESCE(v_line.quantity, 0)
      );
    END LOOP;
  END IF;

  IF v_new_qualifying THEN
    FOR v_line IN
      SELECT product_name, quantity
      FROM scalev_order_lines
      WHERE scalev_order_id = NEW.id
    LOOP
      PERFORM fn_apply_scalev_daily_product_demand_delta(
        v_new_date,
        v_line.product_name,
        COALESCE(v_line.quantity, 0)
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_scalev_daily_product_demand_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_date DATE;
  v_line RECORD;
BEGIN
  IF OLD.status NOT IN ('shipped', 'completed') OR OLD.shipped_time IS NULL THEN
    RETURN OLD;
  END IF;

  v_old_date := DATE(OLD.shipped_time AT TIME ZONE 'Asia/Jakarta');

  FOR v_line IN
    SELECT product_name, quantity
    FROM scalev_order_lines
    WHERE scalev_order_id = OLD.id
  LOOP
    PERFORM fn_apply_scalev_daily_product_demand_delta(
      v_old_date,
      v_line.product_name,
      -COALESCE(v_line.quantity, 0)
    );
  END LOOP;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_line ON scalev_order_lines;
CREATE TRIGGER trg_scalev_daily_product_demand_line
  AFTER INSERT OR UPDATE OR DELETE
  ON scalev_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_scalev_daily_product_demand();

DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_order_status ON scalev_orders;
CREATE TRIGGER trg_scalev_daily_product_demand_order_status
  AFTER UPDATE OF status, shipped_time
  ON scalev_orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_scalev_daily_product_demand_order_status_change();

DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_order_delete ON scalev_orders;
CREATE TRIGGER trg_scalev_daily_product_demand_order_delete
  BEFORE DELETE
  ON scalev_orders
  FOR EACH ROW
  EXECUTE FUNCTION fn_scalev_daily_product_demand_order_delete();

-- ============================================================================
-- 6. Backfill summary once
-- ============================================================================

SELECT refresh_scalev_daily_product_demand();

-- ============================================================================
-- 7. Replace PPIC RPCs to read from the daily summary
-- ============================================================================

CREATE OR REPLACE FUNCTION ppic_monthly_demand(p_months INT DEFAULT 6)
RETURNS TABLE (
  warehouse_product_id INT,
  product_name TEXT,
  entity TEXT,
  category TEXT,
  yr INT,
  mn INT,
  total_qty NUMERIC
) AS $$
DECLARE
  v_from_date DATE;
BEGIN
  v_from_date := (
    ((NOW() AT TIME ZONE 'Asia/Jakarta')::DATE)
    - (GREATEST(p_months, 1) || ' months')::INTERVAL
  )::DATE;

  RETURN QUERY
  SELECT
    wp.id AS warehouse_product_id,
    wp.name AS product_name,
    wp.entity,
    wp.category,
    EXTRACT(YEAR FROM s.demand_date)::INT AS yr,
    EXTRACT(MONTH FROM s.demand_date)::INT AS mn,
    SUM(s.total_qty * COALESCE(m.deduct_qty_multiplier, 1)) AS total_qty
  FROM summary_scalev_daily_product_demand s
  JOIN warehouse_scalev_mapping m
    ON m.scalev_product_name = s.scalev_product_name
   AND m.warehouse_product_id IS NOT NULL
   AND m.is_ignored = false
  JOIN warehouse_products wp
    ON wp.id = m.warehouse_product_id
  WHERE s.demand_date >= v_from_date
  GROUP BY
    wp.id,
    wp.name,
    wp.entity,
    wp.category,
    EXTRACT(YEAR FROM s.demand_date),
    EXTRACT(MONTH FROM s.demand_date)
  ORDER BY yr DESC, mn DESC, wp.name;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION ppic_avg_daily_demand(p_days INT DEFAULT 90)
RETURNS TABLE (
  warehouse_product_id INT,
  product_name TEXT,
  entity TEXT,
  category TEXT,
  total_qty NUMERIC,
  num_days INT,
  avg_daily NUMERIC
) AS $$
DECLARE
  v_days INT;
  v_end_date DATE;
  v_start_date DATE;
BEGIN
  v_days := GREATEST(p_days, 1);
  v_end_date := (NOW() AT TIME ZONE 'Asia/Jakarta')::DATE;
  v_start_date := v_end_date - (v_days - 1);

  RETURN QUERY
  SELECT
    wp.id AS warehouse_product_id,
    wp.name AS product_name,
    wp.entity,
    wp.category,
    SUM(s.total_qty * COALESCE(m.deduct_qty_multiplier, 1)) AS total_qty,
    v_days AS num_days,
    ROUND(SUM(s.total_qty * COALESCE(m.deduct_qty_multiplier, 1)) / v_days::NUMERIC, 2) AS avg_daily
  FROM summary_scalev_daily_product_demand s
  JOIN warehouse_scalev_mapping m
    ON m.scalev_product_name = s.scalev_product_name
   AND m.warehouse_product_id IS NOT NULL
   AND m.is_ignored = false
  JOIN warehouse_products wp
    ON wp.id = m.warehouse_product_id
  WHERE s.demand_date BETWEEN v_start_date AND v_end_date
  GROUP BY
    wp.id,
    wp.name,
    wp.entity,
    wp.category
  ORDER BY avg_daily DESC;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION ppic_weekly_demand_scalev(
  p_month_start TIMESTAMPTZ,
  p_month_end TIMESTAMPTZ
)
RETURNS TABLE (
  warehouse_product_id INT,
  week_num INT,
  total_out NUMERIC
) AS $$
DECLARE
  v_start_date DATE;
  v_end_date DATE;
BEGIN
  v_start_date := (p_month_start AT TIME ZONE 'Asia/Jakarta')::DATE;
  v_end_date := (p_month_end AT TIME ZONE 'Asia/Jakarta')::DATE;

  RETURN QUERY
  SELECT
    m.warehouse_product_id,
    CASE
      WHEN EXTRACT(DAY FROM s.demand_date) <= 7 THEN 1
      WHEN EXTRACT(DAY FROM s.demand_date) <= 14 THEN 2
      WHEN EXTRACT(DAY FROM s.demand_date) <= 21 THEN 3
      ELSE 4
    END::INT AS week_num,
    SUM(s.total_qty * COALESCE(m.deduct_qty_multiplier, 1)) AS total_out
  FROM summary_scalev_daily_product_demand s
  JOIN warehouse_scalev_mapping m
    ON m.scalev_product_name = s.scalev_product_name
   AND m.warehouse_product_id IS NOT NULL
   AND m.is_ignored = false
  WHERE s.demand_date BETWEEN v_start_date AND v_end_date
  GROUP BY
    m.warehouse_product_id,
    CASE
      WHEN EXTRACT(DAY FROM s.demand_date) <= 7 THEN 1
      WHEN EXTRACT(DAY FROM s.demand_date) <= 14 THEN 2
      WHEN EXTRACT(DAY FROM s.demand_date) <= 21 THEN 3
      ELSE 4
    END
  ORDER BY m.warehouse_product_id, week_num;
END;
$$ LANGUAGE plpgsql STABLE;
