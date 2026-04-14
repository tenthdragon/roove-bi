-- ============================================================
-- Stage 1: Scalev upstream catalog cache for Warehouse Settings
-- ============================================================
-- Stores Scalev products, variants, bundles, and identifiers per
-- connected business. This is read-only foundation data for manual
-- refresh and future mapping improvements.
-- ============================================================

CREATE TABLE IF NOT EXISTS scalev_catalog_products (
  id BIGSERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES scalev_webhook_businesses(id) ON DELETE CASCADE,
  business_code TEXT NOT NULL,
  scalev_product_id INT NOT NULL,
  scalev_product_uuid TEXT,
  slug TEXT,
  name TEXT NOT NULL,
  public_name TEXT,
  display TEXT,
  item_type TEXT,
  is_inventory BOOLEAN NOT NULL DEFAULT false,
  is_multiple BOOLEAN NOT NULL DEFAULT false,
  is_listed_at_marketplace BOOLEAN NOT NULL DEFAULT false,
  variants_count INT NOT NULL DEFAULT 0,
  scalev_created_at TIMESTAMPTZ,
  scalev_last_updated_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, scalev_product_id)
);

COMMENT ON TABLE scalev_catalog_products IS
  'Cached Scalev products per business, refreshed manually from Warehouse Settings.';

CREATE TABLE IF NOT EXISTS scalev_catalog_variants (
  id BIGSERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES scalev_webhook_businesses(id) ON DELETE CASCADE,
  business_code TEXT NOT NULL,
  scalev_product_id INT NOT NULL,
  scalev_variant_id INT NOT NULL,
  scalev_variant_unique_id TEXT,
  scalev_variant_uuid TEXT,
  product_name TEXT,
  name TEXT NOT NULL,
  sku TEXT,
  option1_value TEXT,
  option2_value TEXT,
  option3_value TEXT,
  item_type TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, scalev_variant_id)
);

COMMENT ON TABLE scalev_catalog_variants IS
  'Cached Scalev variants per business. Variants are the stable product-level unit for future mapping.';

CREATE TABLE IF NOT EXISTS scalev_catalog_bundles (
  id BIGSERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES scalev_webhook_businesses(id) ON DELETE CASCADE,
  business_code TEXT NOT NULL,
  scalev_bundle_id INT NOT NULL,
  name TEXT NOT NULL,
  public_name TEXT,
  display TEXT,
  custom_id TEXT,
  weight_bump NUMERIC,
  is_bundle_sharing BOOLEAN NOT NULL DEFAULT false,
  price_options_count INT NOT NULL DEFAULT 0,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, scalev_bundle_id)
);

COMMENT ON TABLE scalev_catalog_bundles IS
  'Cached Scalev bundle catalog per business, sourced from bundles/simplified.';

CREATE TABLE IF NOT EXISTS scalev_catalog_identifiers (
  id BIGSERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES scalev_webhook_businesses(id) ON DELETE CASCADE,
  business_code TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('product', 'variant', 'bundle')),
  entity_key TEXT NOT NULL,
  entity_label TEXT NOT NULL,
  scalev_product_id INT,
  scalev_variant_id INT,
  scalev_bundle_id INT,
  identifier TEXT NOT NULL,
  identifier_normalized TEXT NOT NULL,
  source TEXT NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, identifier_normalized, entity_type, source, entity_key)
);

COMMENT ON TABLE scalev_catalog_identifiers IS
  'Normalized identifier registry for Scalev catalog entities (names, slugs, SKUs, custom IDs, unique IDs).';

CREATE TABLE IF NOT EXISTS scalev_catalog_sync_state (
  business_id INT PRIMARY KEY REFERENCES scalev_webhook_businesses(id) ON DELETE CASCADE,
  business_code TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (sync_status IN ('idle', 'running', 'success', 'failed')),
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  products_count INT NOT NULL DEFAULT 0,
  variants_count INT NOT NULL DEFAULT 0,
  bundles_count INT NOT NULL DEFAULT 0,
  identifiers_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE scalev_catalog_sync_state IS
  'Last manual Scalev catalog sync outcome per business for Warehouse Settings.';

CREATE INDEX IF NOT EXISTS idx_scp_business_name
  ON scalev_catalog_products (business_id, name);
CREATE INDEX IF NOT EXISTS idx_scp_business_slug
  ON scalev_catalog_products (business_id, slug);
CREATE INDEX IF NOT EXISTS idx_scv_business_sku
  ON scalev_catalog_variants (business_id, sku);
CREATE INDEX IF NOT EXISTS idx_scv_business_name
  ON scalev_catalog_variants (business_id, name);
CREATE INDEX IF NOT EXISTS idx_scb_business_name
  ON scalev_catalog_bundles (business_id, name);
CREATE INDEX IF NOT EXISTS idx_scb_business_custom_id
  ON scalev_catalog_bundles (business_id, custom_id);
CREATE INDEX IF NOT EXISTS idx_sci_business_identifier
  ON scalev_catalog_identifiers (business_id, identifier_normalized);
CREATE INDEX IF NOT EXISTS idx_sci_business_entity
  ON scalev_catalog_identifiers (business_id, entity_type, entity_key);

ALTER TABLE scalev_catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE scalev_catalog_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE scalev_catalog_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE scalev_catalog_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE scalev_catalog_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scalev_catalog_products_read" ON scalev_catalog_products
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "scalev_catalog_products_manage" ON scalev_catalog_products
  FOR ALL TO authenticated
  USING (dashboard_has_permission('whs:mapping'))
  WITH CHECK (dashboard_has_permission('whs:mapping'));

CREATE POLICY "scalev_catalog_variants_read" ON scalev_catalog_variants
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "scalev_catalog_variants_manage" ON scalev_catalog_variants
  FOR ALL TO authenticated
  USING (dashboard_has_permission('whs:mapping'))
  WITH CHECK (dashboard_has_permission('whs:mapping'));

CREATE POLICY "scalev_catalog_bundles_read" ON scalev_catalog_bundles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "scalev_catalog_bundles_manage" ON scalev_catalog_bundles
  FOR ALL TO authenticated
  USING (dashboard_has_permission('whs:mapping'))
  WITH CHECK (dashboard_has_permission('whs:mapping'));

CREATE POLICY "scalev_catalog_identifiers_read" ON scalev_catalog_identifiers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "scalev_catalog_identifiers_manage" ON scalev_catalog_identifiers
  FOR ALL TO authenticated
  USING (dashboard_has_permission('whs:mapping'))
  WITH CHECK (dashboard_has_permission('whs:mapping'));

CREATE POLICY "scalev_catalog_sync_state_read" ON scalev_catalog_sync_state
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "scalev_catalog_sync_state_manage" ON scalev_catalog_sync_state
  FOR ALL TO authenticated
  USING (dashboard_has_permission('whs:mapping'))
  WITH CHECK (dashboard_has_permission('whs:mapping'));

DROP TRIGGER IF EXISTS set_updated_at_scalev_catalog_products ON scalev_catalog_products;
CREATE TRIGGER set_updated_at_scalev_catalog_products
  BEFORE UPDATE ON scalev_catalog_products
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_scalev_catalog_variants ON scalev_catalog_variants;
CREATE TRIGGER set_updated_at_scalev_catalog_variants
  BEFORE UPDATE ON scalev_catalog_variants
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_scalev_catalog_bundles ON scalev_catalog_bundles;
CREATE TRIGGER set_updated_at_scalev_catalog_bundles
  BEFORE UPDATE ON scalev_catalog_bundles
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_scalev_catalog_identifiers ON scalev_catalog_identifiers;
CREATE TRIGGER set_updated_at_scalev_catalog_identifiers
  BEFORE UPDATE ON scalev_catalog_identifiers
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_scalev_catalog_sync_state ON scalev_catalog_sync_state;
CREATE TRIGGER set_updated_at_scalev_catalog_sync_state
  BEFORE UPDATE ON scalev_catalog_sync_state
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
