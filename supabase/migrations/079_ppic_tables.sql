-- ============================================================
-- Phase 6: PPIC Tables — PO Redesign, Demand Planning, ROP
-- ============================================================
-- Redesigns warehouse_purchase_orders from 1-PO-1-product to
-- 1-PO-1-vendor-multi-product. Adds demand planning + ROP fields.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Rename old PO table
-- ────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS warehouse_purchase_orders RENAME TO warehouse_purchase_orders_legacy;
ALTER INDEX IF EXISTS idx_wpo_product RENAME TO idx_wpo_legacy_product;
ALTER INDEX IF EXISTS idx_wpo_status RENAME TO idx_wpo_legacy_status;
ALTER INDEX IF EXISTS idx_wpo_date RENAME TO idx_wpo_legacy_date;

-- ────────────────────────────────────────────────────────────
-- 2. New PO header table (1 PO = 1 vendor, multi products)
-- ────────────────────────────────────────────────────────────
CREATE TABLE warehouse_purchase_orders (
  id SERIAL PRIMARY KEY,
  po_number TEXT NOT NULL,
  vendor_id INT NOT NULL REFERENCES warehouse_vendors(id) ON DELETE RESTRICT,
  entity TEXT NOT NULL DEFAULT 'BTN-RLB',
  po_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','partial','completed','cancelled')),
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE warehouse_purchase_orders IS 'Purchase Order header. 1 PO = 1 vendor + multiple product items.';

-- Auto-generate PO number: PO-YYYYMMDD-NNN
CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TRIGGER AS $$
DECLARE
  seq INT;
BEGIN
  SELECT COALESCE(MAX(
    NULLIF(SUBSTRING(po_number FROM '-(\d+)$'), '')::INT
  ), 0) + 1
  INTO seq
  FROM warehouse_purchase_orders
  WHERE po_date = NEW.po_date;

  NEW.po_number := 'PO-' || TO_CHAR(NEW.po_date, 'YYYYMMDD') || '-' || LPAD(seq::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_po_number
  BEFORE INSERT ON warehouse_purchase_orders
  FOR EACH ROW
  WHEN (NEW.po_number IS NULL OR NEW.po_number = '')
  EXECUTE FUNCTION generate_po_number();

-- Updated_at trigger (reuse existing trg_set_updated_at)
CREATE TRIGGER set_updated_at_wpo
  BEFORE UPDATE ON warehouse_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Indexes
CREATE INDEX idx_wpo_vendor ON warehouse_purchase_orders(vendor_id);
CREATE INDEX idx_wpo_status ON warehouse_purchase_orders(status);
CREATE INDEX idx_wpo_date ON warehouse_purchase_orders(po_date);
CREATE INDEX idx_wpo_entity ON warehouse_purchase_orders(entity);

-- RLS
ALTER TABLE warehouse_purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_wpo" ON warehouse_purchase_orders
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "manage_wpo" ON warehouse_purchase_orders
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('owner','finance','admin','direktur_operasional','ppic')
  ));

-- ────────────────────────────────────────────────────────────
-- 3. PO line items table
-- ────────────────────────────────────────────────────────────
CREATE TABLE warehouse_po_items (
  id SERIAL PRIMARY KEY,
  po_id INT NOT NULL REFERENCES warehouse_purchase_orders(id) ON DELETE CASCADE,
  warehouse_product_id INT NOT NULL REFERENCES warehouse_products(id) ON DELETE CASCADE,
  quantity_requested NUMERIC NOT NULL CHECK (quantity_requested > 0),
  quantity_received NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE warehouse_po_items IS 'Line items within a Purchase Order. Each row = 1 product + qty.';

-- Indexes
CREATE INDEX idx_wpoi_po ON warehouse_po_items(po_id);
CREATE INDEX idx_wpoi_product ON warehouse_po_items(warehouse_product_id);

-- RLS
ALTER TABLE warehouse_po_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_wpoi" ON warehouse_po_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "manage_wpoi" ON warehouse_po_items
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('owner','finance','admin','direktur_operasional','ppic')
  ));

-- ────────────────────────────────────────────────────────────
-- 4. Demand Planning table
-- ────────────────────────────────────────────────────────────
CREATE TABLE warehouse_demand_plans (
  id SERIAL PRIMARY KEY,
  warehouse_product_id INT NOT NULL REFERENCES warehouse_products(id) ON DELETE CASCADE,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INT NOT NULL CHECK (year BETWEEN 2020 AND 2099),
  auto_demand NUMERIC NOT NULL DEFAULT 0,
  manual_demand NUMERIC,  -- NULL means use auto_demand
  actual_in NUMERIC NOT NULL DEFAULT 0,
  actual_out NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(warehouse_product_id, month, year)
);

COMMENT ON TABLE warehouse_demand_plans IS 'Monthly demand plan per product. auto_demand from ScaleV averages, manual_demand for PPIC override.';

-- Indexes
CREATE INDEX idx_wdp_product ON warehouse_demand_plans(warehouse_product_id);
CREATE INDEX idx_wdp_period ON warehouse_demand_plans(year, month);

-- Updated_at trigger
CREATE TRIGGER set_updated_at_wdp
  BEFORE UPDATE ON warehouse_demand_plans
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- RLS
ALTER TABLE warehouse_demand_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_wdp" ON warehouse_demand_plans
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "manage_wdp" ON warehouse_demand_plans
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('owner','finance','admin','direktur_operasional','ppic')
  ));

-- ────────────────────────────────────────────────────────────
-- 5. Add ROP fields to warehouse_products
-- ────────────────────────────────────────────────────────────
ALTER TABLE warehouse_products
  ADD COLUMN IF NOT EXISTS lead_time_days INT NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS safety_stock_days INT NOT NULL DEFAULT 3;

COMMENT ON COLUMN warehouse_products.lead_time_days IS 'Supplier lead time in days for ROP calculation.';
COMMENT ON COLUMN warehouse_products.safety_stock_days IS 'Safety stock buffer in days for ROP calculation.';

-- ────────────────────────────────────────────────────────────
-- 6. RPC: Monthly demand per warehouse product (from ScaleV)
-- ────────────────────────────────────────────────────────────
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
BEGIN
  RETURN QUERY
  SELECT
    wp.id AS warehouse_product_id,
    wp.name AS product_name,
    wp.entity,
    wp.category,
    EXTRACT(YEAR FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta')::INT AS yr,
    EXTRACT(MONTH FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta')::INT AS mn,
    SUM(ol.quantity * COALESCE(m.deduct_qty_multiplier, 1)) AS total_qty
  FROM scalev_order_lines ol
  JOIN scalev_orders o ON o.id = ol.scalev_order_id
  JOIN warehouse_scalev_mapping m ON m.scalev_product_name = ol.product_name
    AND m.warehouse_product_id IS NOT NULL
    AND m.is_ignored = false
  JOIN warehouse_products wp ON wp.id = m.warehouse_product_id
  WHERE o.status IN ('shipped', 'completed')
    AND o.shipped_time >= (NOW() - (p_months || ' months')::INTERVAL)
    AND o.shipped_time IS NOT NULL
  GROUP BY wp.id, wp.name, wp.entity, wp.category,
    EXTRACT(YEAR FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta'),
    EXTRACT(MONTH FROM o.shipped_time AT TIME ZONE 'Asia/Jakarta')
  ORDER BY yr DESC, mn DESC, wp.name;
END;
$$ LANGUAGE plpgsql STABLE;

-- ────────────────────────────────────────────────────────────
-- 7. RPC: Average daily demand per product (for ROP)
-- ────────────────────────────────────────────────────────────
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
BEGIN
  RETURN QUERY
  SELECT
    wp.id AS warehouse_product_id,
    wp.name AS product_name,
    wp.entity,
    wp.category,
    SUM(ol.quantity * COALESCE(m.deduct_qty_multiplier, 1)) AS total_qty,
    p_days AS num_days,
    ROUND(SUM(ol.quantity * COALESCE(m.deduct_qty_multiplier, 1)) / GREATEST(p_days, 1), 2) AS avg_daily
  FROM scalev_order_lines ol
  JOIN scalev_orders o ON o.id = ol.scalev_order_id
  JOIN warehouse_scalev_mapping m ON m.scalev_product_name = ol.product_name
    AND m.warehouse_product_id IS NOT NULL
    AND m.is_ignored = false
  JOIN warehouse_products wp ON wp.id = m.warehouse_product_id
  WHERE o.status IN ('shipped', 'completed')
    AND o.shipped_time >= (NOW() - (p_days || ' days')::INTERVAL)
    AND o.shipped_time IS NOT NULL
  GROUP BY wp.id, wp.name, wp.entity, wp.category
  ORDER BY avg_daily DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- ────────────────────────────────────────────────────────────
-- 8. RPC: Monthly stock movements from ledger
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION ppic_monthly_movements(p_months INT DEFAULT 6)
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
    EXTRACT(YEAR FROM sl.created_at AT TIME ZONE 'Asia/Jakarta')::INT AS yr,
    EXTRACT(MONTH FROM sl.created_at AT TIME ZONE 'Asia/Jakarta')::INT AS mn,
    SUM(CASE WHEN sl.movement_type = 'IN' THEN sl.quantity ELSE 0 END) AS total_in,
    SUM(CASE WHEN sl.movement_type IN ('OUT', 'DISPOSE', 'TRANSFER_OUT') THEN ABS(sl.quantity) ELSE 0 END) AS total_out
  FROM warehouse_stock_ledger sl
  JOIN warehouse_products wp ON wp.id = sl.warehouse_product_id
  WHERE sl.created_at >= (NOW() - (p_months || ' months')::INTERVAL)
  GROUP BY wp.id, wp.name, wp.entity, wp.category,
    EXTRACT(YEAR FROM sl.created_at AT TIME ZONE 'Asia/Jakarta'),
    EXTRACT(MONTH FROM sl.created_at AT TIME ZONE 'Asia/Jakarta')
  ORDER BY yr DESC, mn DESC, wp.name;
END;
$$ LANGUAGE plpgsql STABLE;
