-- ============================================================
-- Business → Warehouse Entity Mapping
-- ============================================================
-- Maps ScaleV business codes to the warehouse entity whose stock
-- gets deducted on order shipped. E.g. RTI orders deduct from RLB stock.
-- Configurable via admin UI.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Mapping table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS warehouse_business_mapping (
  id SERIAL PRIMARY KEY,
  business_code TEXT NOT NULL REFERENCES scalev_webhook_businesses(business_code) ON DELETE CASCADE,
  deduct_entity TEXT NOT NULL CHECK (deduct_entity IN ('RTI','RLB','JHN','RLT')),
  deduct_warehouse TEXT NOT NULL DEFAULT 'BTN',
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(business_code)
);

COMMENT ON TABLE warehouse_business_mapping IS 'Maps ScaleV business_code to warehouse entity for stock deduction. E.g. RTI → RLB means RTI orders deduct RLB stock.';

-- ────────────────────────────────────────────────────────────
-- Seed default mappings
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_business_mapping (business_code, deduct_entity, deduct_warehouse, notes) VALUES
  ('RTI', 'RLB', 'BTN', 'RTI = marketing channel, RLB handles shipment'),
  ('RLB', 'RLB', 'BTN', 'RLB ships own stock'),
  ('RLT', 'RLT', 'BTN', 'RLT ships own stock'),
  ('JHN', 'JHN', 'BTN', 'JHN ships own stock')
ON CONFLICT (business_code) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE warehouse_business_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_warehouse_business_mapping" ON warehouse_business_mapping
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "manage_warehouse_business_mapping" ON warehouse_business_mapping
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','finance','admin')));

-- ────────────────────────────────────────────────────────────
-- RPC: lookup deduction target by business code
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION warehouse_find_product_for_deduction(
  p_scalev_name TEXT,
  p_entity TEXT,
  p_warehouse TEXT DEFAULT 'BTN'
)
RETURNS SETOF warehouse_products AS $$
  SELECT *
  FROM warehouse_products
  WHERE p_scalev_name = ANY(scalev_product_names)
    AND entity = p_entity
    AND warehouse = p_warehouse
    AND is_active = true
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ────────────────────────────────────────────────────────────
-- Trigger: auto-update updated_at
-- ────────────────────────────────────────────────────────────
CREATE TRIGGER set_updated_at_warehouse_business_mapping
  BEFORE UPDATE ON warehouse_business_mapping
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
