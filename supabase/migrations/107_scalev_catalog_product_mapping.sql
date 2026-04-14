-- ============================================================
-- Stage 2: Scalev catalog entity -> warehouse product mapping
-- ============================================================
-- Stores curated mappings between cached Scalev catalog entities
-- (products/variants) and warehouse master products.
-- This complements the legacy warehouse_scalev_mapping table and
-- does not replace it yet.
-- ============================================================

-- Compatibility helpers:
-- Some environments may still miss the shared RBAC helper or
-- updated_at trigger helper. Re-declaring them here is safe.

CREATE OR REPLACE FUNCTION dashboard_has_permission(p_permission_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    LEFT JOIN role_permissions rp
      ON rp.role = p.role::text
     AND rp.permission_key = p_permission_key
    WHERE p.id = auth.uid()
      AND (p.role::text = 'owner' OR rp.permission_key IS NOT NULL)
  );
$$;

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS warehouse_scalev_catalog_mapping (
  id BIGSERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES scalev_webhook_businesses(id) ON DELETE CASCADE,
  business_code TEXT NOT NULL,
  scalev_entity_type TEXT NOT NULL CHECK (scalev_entity_type IN ('product', 'variant')),
  scalev_entity_key TEXT NOT NULL,
  scalev_product_id INT NOT NULL,
  scalev_variant_id INT,
  scalev_entity_label TEXT NOT NULL,
  warehouse_product_id INT REFERENCES warehouse_products(id) ON DELETE SET NULL,
  mapping_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (mapping_source IN ('manual', 'recommendation', 'legacy_seed')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, scalev_entity_key)
);

COMMENT ON TABLE warehouse_scalev_catalog_mapping IS
  'Curated mapping between cached Scalev catalog entities and warehouse master products.';
COMMENT ON COLUMN warehouse_scalev_catalog_mapping.scalev_entity_key IS
  'Stable entity key from cached catalog rows, e.g. product:123 or variant:456.';
COMMENT ON COLUMN warehouse_scalev_catalog_mapping.mapping_source IS
  'How the mapping was created. Manual is the default; recommendation/legacy_seed are reserved for future automation.';

CREATE INDEX IF NOT EXISTS idx_wscm_business_entity
  ON warehouse_scalev_catalog_mapping (business_id, scalev_entity_type);
CREATE INDEX IF NOT EXISTS idx_wscm_scalev_product
  ON warehouse_scalev_catalog_mapping (business_id, scalev_product_id);
CREATE INDEX IF NOT EXISTS idx_wscm_scalev_variant
  ON warehouse_scalev_catalog_mapping (business_id, scalev_variant_id);
CREATE INDEX IF NOT EXISTS idx_wscm_warehouse_product
  ON warehouse_scalev_catalog_mapping (warehouse_product_id);

ALTER TABLE warehouse_scalev_catalog_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouse_scalev_catalog_mapping_read" ON warehouse_scalev_catalog_mapping;
CREATE POLICY "warehouse_scalev_catalog_mapping_read" ON warehouse_scalev_catalog_mapping
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "warehouse_scalev_catalog_mapping_manage" ON warehouse_scalev_catalog_mapping;
CREATE POLICY "warehouse_scalev_catalog_mapping_manage" ON warehouse_scalev_catalog_mapping
  FOR ALL TO authenticated
  USING (dashboard_has_permission('whs:mapping'))
  WITH CHECK (dashboard_has_permission('whs:mapping'));

DROP TRIGGER IF EXISTS set_updated_at_warehouse_scalev_catalog_mapping ON warehouse_scalev_catalog_mapping;
CREATE TRIGGER set_updated_at_warehouse_scalev_catalog_mapping
  BEFORE UPDATE ON warehouse_scalev_catalog_mapping
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
