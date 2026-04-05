-- ============================================================
-- ScaleV → Warehouse Product Mapping Table
-- ============================================================
-- Dedicated mapping table for ScaleV product_name → warehouse product.
-- Auto-populated from existing order lines. Manageable via UI.
-- ============================================================

CREATE TABLE IF NOT EXISTS warehouse_scalev_mapping (
  id SERIAL PRIMARY KEY,
  scalev_product_name TEXT NOT NULL,
  warehouse_product_id INT REFERENCES warehouse_products(id) ON DELETE SET NULL,
  deduct_qty_multiplier NUMERIC NOT NULL DEFAULT 1,
  is_ignored BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(scalev_product_name)
);

COMMENT ON TABLE warehouse_scalev_mapping IS 'Maps ScaleV order line product_name to warehouse product for stock deduction. Managed via warehouse UI.';
COMMENT ON COLUMN warehouse_scalev_mapping.deduct_qty_multiplier IS 'Multiplier for qty deduction. Default 1. For bundles that represent N items, set accordingly.';
COMMENT ON COLUMN warehouse_scalev_mapping.is_ignored IS 'If true, this product_name is skipped during stock deduction (e.g. Test Product, Unknown).';

-- Indexes
CREATE INDEX idx_wsm_product ON warehouse_scalev_mapping(warehouse_product_id);
CREATE INDEX idx_wsm_ignored ON warehouse_scalev_mapping(is_ignored);

-- RLS
ALTER TABLE warehouse_scalev_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_warehouse_scalev_mapping" ON warehouse_scalev_mapping
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "manage_warehouse_scalev_mapping" ON warehouse_scalev_mapping
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','finance','admin','direktur_operasional')));

-- Auto-update trigger
CREATE TRIGGER set_updated_at_warehouse_scalev_mapping
  BEFORE UPDATE ON warehouse_scalev_mapping
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- Auto-populate from existing order lines
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_scalev_mapping (scalev_product_name)
SELECT DISTINCT product_name
FROM scalev_order_lines
WHERE product_name IS NOT NULL AND product_name != ''
ON CONFLICT (scalev_product_name) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- Pre-map known matches (from warehouse_products.scalev_product_names)
-- ────────────────────────────────────────────────────────────
UPDATE warehouse_scalev_mapping wsm
SET warehouse_product_id = wp.id
FROM warehouse_products wp
WHERE wsm.scalev_product_name = ANY(wp.scalev_product_names)
  AND wsm.warehouse_product_id IS NULL;

-- ────────────────────────────────────────────────────────────
-- RPC: Get frequency counts per product_name
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION warehouse_scalev_mapping_frequencies()
RETURNS TABLE(product_name TEXT, cnt BIGINT) AS $$
  SELECT product_name, COUNT(*) as cnt
  FROM scalev_order_lines
  WHERE product_name IS NOT NULL
  GROUP BY product_name;
$$ LANGUAGE sql STABLE;

-- ────────────────────────────────────────────────────────────
-- RPC: Sync new product_names from order_lines into mapping table
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION warehouse_sync_scalev_names()
RETURNS void AS $$
  INSERT INTO warehouse_scalev_mapping (scalev_product_name)
  SELECT DISTINCT product_name
  FROM scalev_order_lines
  WHERE product_name IS NOT NULL AND product_name != ''
  ON CONFLICT (scalev_product_name) DO NOTHING;
$$ LANGUAGE sql;

-- Auto-ignore test/unknown entries
UPDATE warehouse_scalev_mapping
SET is_ignored = true, notes = 'Auto-ignored: test/unknown'
WHERE scalev_product_name IN ('Test Product', 'Testing produk', 'Produk testing', 'Produk Testing Arman', 'Other', 'Unknown', 'Veminine')
  AND warehouse_product_id IS NULL;
