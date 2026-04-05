-- ============================================================
-- Warehouse Redesign — Phase 1: Schema Foundation
-- ============================================================
-- Adds ledger-based stock tracking with batch/expiry support,
-- product master with ScaleV SKU mapping, PO tracking, and
-- inter-company transfer logging.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. warehouse_products — Master product list + ScaleV mapping
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT,
  category TEXT NOT NULL DEFAULT 'fg'
    CHECK (category IN ('fg','sachet','kemasan','bonus','packaging','other')),
  unit TEXT NOT NULL DEFAULT 'pcs',
  price_list NUMERIC DEFAULT 0,
  reorder_threshold NUMERIC DEFAULT 0,
  entity TEXT NOT NULL DEFAULT 'RTI'
    CHECK (entity IN ('RTI','RLB','JHN','RLT')),
  warehouse TEXT NOT NULL DEFAULT 'BTN',
  scalev_product_names TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, entity, warehouse)
);

COMMENT ON TABLE warehouse_products IS 'Master product list for warehouse. scalev_product_names maps to ScaleV order line product names.';
COMMENT ON COLUMN warehouse_products.scalev_product_names IS 'Array of ScaleV product_name values that map to this warehouse product (e.g. {"Roove Blueberry - 20 Sc","ROOVE BLUEBERI 20"})';

-- ────────────────────────────────────────────────────────────
-- 2. warehouse_batches — Track stock per batch + expiry date
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_batches (
  id SERIAL PRIMARY KEY,
  warehouse_product_id INT NOT NULL REFERENCES warehouse_products(id) ON DELETE CASCADE,
  batch_code TEXT NOT NULL,
  expired_date DATE,
  initial_qty NUMERIC NOT NULL DEFAULT 0,
  current_qty NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(warehouse_product_id, batch_code)
);

COMMENT ON TABLE warehouse_batches IS 'Tracks stock quantities per production batch with expiry dates. FIFO deduction uses expired_date ordering.';

-- ────────────────────────────────────────────────────────────
-- 3. warehouse_stock_ledger — Every stock movement as a ledger entry
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_stock_ledger (
  id BIGSERIAL PRIMARY KEY,
  warehouse_product_id INT NOT NULL REFERENCES warehouse_products(id) ON DELETE CASCADE,
  batch_id INT REFERENCES warehouse_batches(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL
    CHECK (movement_type IN ('IN','OUT','ADJUST','TRANSFER_IN','TRANSFER_OUT','DISPOSE')),
  quantity NUMERIC NOT NULL,
  running_balance NUMERIC NOT NULL DEFAULT 0,
  reference_type TEXT
    CHECK (reference_type IN ('scalev_order','manual','purchase_order','transfer','dispose','opname','rts')),
  reference_id TEXT,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE warehouse_stock_ledger IS 'Immutable ledger of all stock movements. quantity is positive for IN, negative for OUT/DISPOSE/TRANSFER_OUT. running_balance is product-level cumulative.';

-- ────────────────────────────────────────────────────────────
-- 4. warehouse_purchase_orders — PO tracking for PPIC
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_purchase_orders (
  id SERIAL PRIMARY KEY,
  warehouse_product_id INT NOT NULL REFERENCES warehouse_products(id) ON DELETE CASCADE,
  quantity_requested NUMERIC NOT NULL DEFAULT 0,
  quantity_received NUMERIC NOT NULL DEFAULT 0,
  vendor TEXT,
  po_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_date DATE,
  received_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','partial','completed','cancelled')),
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE warehouse_purchase_orders IS 'Purchase order tracking for PPIC. Linked to warehouse_products for demand planning.';

-- ────────────────────────────────────────────────────────────
-- 5. warehouse_transfers — Inter-company/warehouse transfers
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_transfers (
  id SERIAL PRIMARY KEY,
  from_entity TEXT NOT NULL,
  to_entity TEXT NOT NULL,
  from_warehouse TEXT NOT NULL DEFAULT 'BTN',
  to_warehouse TEXT NOT NULL DEFAULT 'BTN',
  warehouse_product_id INT NOT NULL REFERENCES warehouse_products(id) ON DELETE CASCADE,
  batch_id INT REFERENCES warehouse_batches(id) ON DELETE SET NULL,
  quantity NUMERIC NOT NULL,
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE warehouse_transfers IS 'Log of stock transfers between entities (RTI/RLB/JHN/RLT) or warehouses.';

-- ────────────────────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────────────────────
CREATE INDEX idx_wp_entity ON warehouse_products(entity);
CREATE INDEX idx_wp_category ON warehouse_products(category);
CREATE INDEX idx_wp_scalev ON warehouse_products USING GIN(scalev_product_names);

CREATE INDEX idx_wb_product ON warehouse_batches(warehouse_product_id);
CREATE INDEX idx_wb_expiry ON warehouse_batches(expired_date);
CREATE INDEX idx_wb_active ON warehouse_batches(warehouse_product_id) WHERE is_active = true;

CREATE INDEX idx_wsl_product ON warehouse_stock_ledger(warehouse_product_id);
CREATE INDEX idx_wsl_batch ON warehouse_stock_ledger(batch_id);
CREATE INDEX idx_wsl_type ON warehouse_stock_ledger(movement_type);
CREATE INDEX idx_wsl_ref ON warehouse_stock_ledger(reference_type, reference_id);
CREATE INDEX idx_wsl_created ON warehouse_stock_ledger(created_at DESC);

CREATE INDEX idx_wpo_product ON warehouse_purchase_orders(warehouse_product_id);
CREATE INDEX idx_wpo_status ON warehouse_purchase_orders(status);
CREATE INDEX idx_wpo_date ON warehouse_purchase_orders(po_date);

CREATE INDEX idx_wt_date ON warehouse_transfers(transfer_date);
CREATE INDEX idx_wt_entities ON warehouse_transfers(from_entity, to_entity);

-- ────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────
ALTER TABLE warehouse_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_transfers ENABLE ROW LEVEL SECURITY;

-- Read: all authenticated users
CREATE POLICY "read_warehouse_products" ON warehouse_products
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_warehouse_batches" ON warehouse_batches
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_warehouse_stock_ledger" ON warehouse_stock_ledger
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_warehouse_purchase_orders" ON warehouse_purchase_orders
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_warehouse_transfers" ON warehouse_transfers
  FOR SELECT TO authenticated USING (true);

-- Write: owner/finance/admin only
CREATE POLICY "manage_warehouse_products" ON warehouse_products
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','finance','admin')));
CREATE POLICY "manage_warehouse_batches" ON warehouse_batches
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','finance','admin')));
CREATE POLICY "manage_warehouse_stock_ledger" ON warehouse_stock_ledger
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','finance','admin')));
CREATE POLICY "manage_warehouse_purchase_orders" ON warehouse_purchase_orders
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','finance','admin')));
CREATE POLICY "manage_warehouse_transfers" ON warehouse_transfers
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','finance','admin')));

-- ────────────────────────────────────────────────────────────
-- VIEWS
-- ────────────────────────────────────────────────────────────

-- Real-time stock balance per product (from ledger sum)
CREATE OR REPLACE VIEW v_warehouse_stock_balance AS
SELECT
  wp.id AS product_id,
  wp.name AS product_name,
  wp.sku,
  wp.category,
  wp.entity,
  wp.warehouse,
  wp.unit,
  wp.price_list,
  wp.reorder_threshold,
  COALESCE(SUM(sl.quantity), 0) AS current_stock,
  COALESCE(SUM(sl.quantity), 0) * wp.price_list AS stock_value,
  CASE
    WHEN wp.reorder_threshold > 0
      AND COALESCE(SUM(sl.quantity), 0) <= wp.reorder_threshold
    THEN true ELSE false
  END AS needs_reorder
FROM warehouse_products wp
LEFT JOIN warehouse_stock_ledger sl ON sl.warehouse_product_id = wp.id
WHERE wp.is_active = true
GROUP BY wp.id, wp.name, wp.sku, wp.category, wp.entity, wp.warehouse,
         wp.unit, wp.price_list, wp.reorder_threshold;

-- Stock per batch with expiry status
CREATE OR REPLACE VIEW v_warehouse_batch_stock AS
SELECT
  wb.id AS batch_id,
  wb.batch_code,
  wb.expired_date,
  wb.current_qty,
  wp.id AS product_id,
  wp.name AS product_name,
  wp.category,
  wp.entity,
  wp.warehouse,
  CASE
    WHEN wb.expired_date IS NULL THEN 'no_expiry'
    WHEN wb.expired_date < CURRENT_DATE THEN 'expired'
    WHEN wb.expired_date < CURRENT_DATE + INTERVAL '30 days' THEN 'critical'
    WHEN wb.expired_date < CURRENT_DATE + INTERVAL '90 days' THEN 'warning'
    ELSE 'safe'
  END AS expiry_status,
  CASE
    WHEN wb.expired_date IS NOT NULL
    THEN (wb.expired_date - CURRENT_DATE)
    ELSE NULL
  END AS days_remaining
FROM warehouse_batches wb
JOIN warehouse_products wp ON wp.id = wb.warehouse_product_id
WHERE wb.is_active = true AND wb.current_qty > 0
ORDER BY wb.expired_date ASC NULLS LAST;

-- ────────────────────────────────────────────────────────────
-- RPC: FIFO stock deduction (used by ScaleV auto-deduct)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION warehouse_deduct_fifo(
  p_product_id INT,
  p_quantity NUMERIC,
  p_reference_type TEXT DEFAULT 'scalev_order',
  p_reference_id TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE(batch_id INT, deducted NUMERIC) AS $$
DECLARE
  remaining NUMERIC := p_quantity;
  batch RECORD;
  deduct_qty NUMERIC;
  new_balance NUMERIC;
BEGIN
  -- Loop through batches FIFO (oldest expiry first)
  FOR batch IN
    SELECT wb.id, wb.current_qty
    FROM warehouse_batches wb
    WHERE wb.warehouse_product_id = p_product_id
      AND wb.current_qty > 0
      AND wb.is_active = true
    ORDER BY wb.expired_date ASC NULLS LAST, wb.created_at ASC
  LOOP
    EXIT WHEN remaining <= 0;

    deduct_qty := LEAST(batch.current_qty, remaining);

    -- Update batch qty
    UPDATE warehouse_batches
    SET current_qty = current_qty - deduct_qty
    WHERE id = batch.id;

    -- Calculate running balance
    SELECT COALESCE(SUM(sl.quantity), 0) - deduct_qty
    INTO new_balance
    FROM warehouse_stock_ledger sl
    WHERE sl.warehouse_product_id = p_product_id;

    -- Insert ledger entry
    INSERT INTO warehouse_stock_ledger (
      warehouse_product_id, batch_id, movement_type, quantity,
      running_balance, reference_type, reference_id, notes
    ) VALUES (
      p_product_id, batch.id, 'OUT', -deduct_qty,
      new_balance, p_reference_type, p_reference_id, p_notes
    );

    remaining := remaining - deduct_qty;
    batch_id := batch.id;
    deducted := deduct_qty;
    RETURN NEXT;
  END LOOP;

  -- If remaining > 0, stock insufficient — still record it as negative
  IF remaining > 0 THEN
    SELECT COALESCE(SUM(sl.quantity), 0) - remaining
    INTO new_balance
    FROM warehouse_stock_ledger sl
    WHERE sl.warehouse_product_id = p_product_id;

    INSERT INTO warehouse_stock_ledger (
      warehouse_product_id, batch_id, movement_type, quantity,
      running_balance, reference_type, reference_id, notes
    ) VALUES (
      p_product_id, NULL, 'OUT', -remaining,
      new_balance, p_reference_type, p_reference_id,
      COALESCE(p_notes, '') || ' [STOCK INSUFFICIENT: ' || remaining || ' units short]'
    );

    batch_id := NULL;
    deducted := remaining;
    RETURN NEXT;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────
-- RPC: Lookup warehouse product by ScaleV product_name
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION warehouse_find_product_by_scalev_name(p_scalev_name TEXT)
RETURNS SETOF warehouse_products AS $$
  SELECT *
  FROM warehouse_products
  WHERE p_scalev_name = ANY(scalev_product_names)
    AND is_active = true
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ────────────────────────────────────────────────────────────
-- Trigger: auto-update updated_at
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_warehouse_products
  BEFORE UPDATE ON warehouse_products
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER set_updated_at_warehouse_purchase_orders
  BEFORE UPDATE ON warehouse_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
