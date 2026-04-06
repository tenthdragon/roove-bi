-- ============================================================
-- Vendors table — daftar vendor/supplier
-- ============================================================

CREATE TABLE IF NOT EXISTS warehouse_vendors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  pic_name TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name)
);

COMMENT ON TABLE warehouse_vendors IS 'Daftar vendor/supplier untuk warehouse products';

-- RLS
ALTER TABLE warehouse_vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_warehouse_vendors" ON warehouse_vendors
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "manage_warehouse_vendors" ON warehouse_vendors
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','finance','admin','direktur_operasional')));

-- Trigger updated_at
CREATE TRIGGER set_updated_at_warehouse_vendors
  BEFORE UPDATE ON warehouse_vendors
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Change warehouse_products.vendor from TEXT to FK
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS vendor_id INT REFERENCES warehouse_vendors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wp_vendor ON warehouse_products(vendor_id);

-- Migrate existing vendor text to vendor table (if any have vendor text)
INSERT INTO warehouse_vendors (name)
SELECT DISTINCT vendor FROM warehouse_products WHERE vendor IS NOT NULL AND vendor != ''
ON CONFLICT (name) DO NOTHING;

UPDATE warehouse_products wp
SET vendor_id = wv.id
FROM warehouse_vendors wv
WHERE wp.vendor = wv.name AND wp.vendor IS NOT NULL AND wp.vendor != '';
