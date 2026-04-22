-- ============================================================
-- Marketplace mapping configuration
-- ============================================================
-- Stores deterministic marketplace source accounts plus explicit
-- decode/routing rules from marketplace identifiers into
-- Scalev stores and catalog entities.
-- ============================================================

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

CREATE TABLE IF NOT EXISTS marketplace_upload_sources (
  id BIGSERIAL PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  source_label TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('shopee', 'tiktok', 'lazada', 'blibli')),
  business_id INT NOT NULL REFERENCES scalev_webhook_businesses(id) ON DELETE CASCADE,
  business_code TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE marketplace_upload_sources IS
  'Deterministic marketplace source accounts (future uploader boxes), each bound to one Scalev business.';
COMMENT ON COLUMN marketplace_upload_sources.source_key IS
  'Stable internal key, e.g. shopee_rlt or tiktok_jhn.';

CREATE TABLE IF NOT EXISTS marketplace_upload_source_stores (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES marketplace_upload_sources(id) ON DELETE CASCADE,
  store_name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, store_name),
  UNIQUE (id, source_id)
);

COMMENT ON TABLE marketplace_upload_source_stores IS
  'Allowed target Scalev store names for each deterministic marketplace source account.';

CREATE TABLE IF NOT EXISTS marketplace_store_mapping_rules (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES marketplace_upload_sources(id) ON DELETE CASCADE,
  source_store_id BIGINT NOT NULL,
  business_id INT NOT NULL REFERENCES scalev_webhook_businesses(id) ON DELETE CASCADE,
  business_code TEXT NOT NULL,
  match_field TEXT NOT NULL CHECK (match_field IN ('sku', 'product_name')),
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'prefix', 'contains')),
  match_value TEXT NOT NULL,
  match_value_normalized TEXT NOT NULL,
  target_entity_type TEXT NULL CHECK (target_entity_type IN ('product', 'variant', 'bundle')),
  target_entity_key TEXT,
  scalev_product_id INT,
  scalev_variant_id INT,
  scalev_bundle_id INT,
  target_entity_label TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, match_field, match_type, match_value_normalized),
  CONSTRAINT marketplace_mapping_rule_store_fk
    FOREIGN KEY (source_store_id, source_id)
    REFERENCES marketplace_upload_source_stores(id, source_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE marketplace_store_mapping_rules IS
  'Explicit deterministic rules to route marketplace identifiers into a Scalev store and optional decoded catalog entity.';
COMMENT ON COLUMN marketplace_store_mapping_rules.match_field IS
  'Marketplace field to evaluate first, currently SKU or product_name.';
COMMENT ON COLUMN marketplace_store_mapping_rules.target_entity_key IS
  'Stable catalog entity key in the shape variant:123, bundle:456, or product:789.';

CREATE INDEX IF NOT EXISTS idx_marketplace_upload_sources_platform
  ON marketplace_upload_sources (platform, business_code);
CREATE INDEX IF NOT EXISTS idx_marketplace_upload_source_stores_source
  ON marketplace_upload_source_stores (source_id, sort_order, store_name);
CREATE INDEX IF NOT EXISTS idx_marketplace_store_mapping_rules_source
  ON marketplace_store_mapping_rules (source_id, is_active, match_field, match_type);
CREATE INDEX IF NOT EXISTS idx_marketplace_store_mapping_rules_business
  ON marketplace_store_mapping_rules (business_id, source_store_id);

ALTER TABLE marketplace_upload_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_upload_source_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_store_mapping_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketplace_upload_sources_read" ON marketplace_upload_sources;
CREATE POLICY "marketplace_upload_sources_read" ON marketplace_upload_sources
  FOR SELECT TO authenticated
  USING (dashboard_has_permission('tab:business-settings'));

DROP POLICY IF EXISTS "marketplace_upload_sources_manage" ON marketplace_upload_sources;
CREATE POLICY "marketplace_upload_sources_manage" ON marketplace_upload_sources
  FOR ALL TO authenticated
  USING (dashboard_has_permission('tab:business-settings'))
  WITH CHECK (dashboard_has_permission('tab:business-settings'));

DROP POLICY IF EXISTS "marketplace_upload_source_stores_read" ON marketplace_upload_source_stores;
CREATE POLICY "marketplace_upload_source_stores_read" ON marketplace_upload_source_stores
  FOR SELECT TO authenticated
  USING (dashboard_has_permission('tab:business-settings'));

DROP POLICY IF EXISTS "marketplace_upload_source_stores_manage" ON marketplace_upload_source_stores;
CREATE POLICY "marketplace_upload_source_stores_manage" ON marketplace_upload_source_stores
  FOR ALL TO authenticated
  USING (dashboard_has_permission('tab:business-settings'))
  WITH CHECK (dashboard_has_permission('tab:business-settings'));

DROP POLICY IF EXISTS "marketplace_store_mapping_rules_read" ON marketplace_store_mapping_rules;
CREATE POLICY "marketplace_store_mapping_rules_read" ON marketplace_store_mapping_rules
  FOR SELECT TO authenticated
  USING (dashboard_has_permission('tab:business-settings'));

DROP POLICY IF EXISTS "marketplace_store_mapping_rules_manage" ON marketplace_store_mapping_rules;
CREATE POLICY "marketplace_store_mapping_rules_manage" ON marketplace_store_mapping_rules
  FOR ALL TO authenticated
  USING (dashboard_has_permission('tab:business-settings'))
  WITH CHECK (dashboard_has_permission('tab:business-settings'));

DROP TRIGGER IF EXISTS set_updated_at_marketplace_upload_sources ON marketplace_upload_sources;
CREATE TRIGGER set_updated_at_marketplace_upload_sources
  BEFORE UPDATE ON marketplace_upload_sources
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_marketplace_upload_source_stores ON marketplace_upload_source_stores;
CREATE TRIGGER set_updated_at_marketplace_upload_source_stores
  BEFORE UPDATE ON marketplace_upload_source_stores
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_marketplace_store_mapping_rules ON marketplace_store_mapping_rules;
CREATE TRIGGER set_updated_at_marketplace_store_mapping_rules
  BEFORE UPDATE ON marketplace_store_mapping_rules
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

WITH source_rows(source_key, source_label, platform, business_code, description) AS (
  VALUES
    ('shopee_rlt', 'Shopee RLT', 'shopee', 'RLT', 'Akun Shopee milik entitas RLT'),
    ('shopee_jhn', 'Shopee JHN', 'shopee', 'JHN', 'Akun Shopee milik entitas JHN'),
    ('tiktok_rti', 'TikTok RTI', 'tiktok', 'RTI', 'Akun TikTok Shop milik entitas RTI'),
    ('tiktok_jhn', 'TikTok JHN', 'tiktok', 'JHN', 'Akun TikTok Shop milik entitas JHN'),
    ('lazada_rlt', 'Lazada RLT', 'lazada', 'RLT', 'Akun Lazada milik entitas RLT'),
    ('blibli_rti', 'BliBli RTI', 'blibli', 'RTI', 'Akun BliBli milik entitas RTI')
)
INSERT INTO marketplace_upload_sources (
  source_key,
  source_label,
  platform,
  business_id,
  business_code,
  description,
  is_active
)
SELECT
  source_rows.source_key,
  source_rows.source_label,
  source_rows.platform,
  businesses.id,
  source_rows.business_code,
  source_rows.description,
  true
FROM source_rows
JOIN scalev_webhook_businesses businesses
  ON businesses.business_code = source_rows.business_code
ON CONFLICT (source_key) DO UPDATE SET
  source_label = EXCLUDED.source_label,
  platform = EXCLUDED.platform,
  business_id = EXCLUDED.business_id,
  business_code = EXCLUDED.business_code,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

WITH store_rows(source_key, store_name, sort_order) AS (
  VALUES
    ('shopee_rlt', 'Roove Main Store - Marketplace', 10),
    ('shopee_rlt', 'Globite Store - Marketplace', 20),
    ('shopee_rlt', 'Pluve Main Store - Marketplace', 30),
    ('shopee_rlt', 'Purvu Store - Marketplace', 40),
    ('shopee_rlt', 'Purvu The Secret Store - Markerplace', 50),
    ('shopee_rlt', 'YUV Deodorant Serum Store - Marketplace', 60),
    ('shopee_rlt', 'Osgard Oil Store', 70),
    ('shopee_rlt', 'drHyun Main Store - Marketplace', 80),
    ('shopee_rlt', 'Calmara Main Store - Marketplace', 90),

    ('tiktok_rti', 'Roove Main Store - Marketplace', 10),
    ('tiktok_rti', 'Globite Store - Marketplace', 20),
    ('tiktok_rti', 'Pluve Main Store - Marketplace', 30),
    ('tiktok_rti', 'Purvu Store - Marketplace', 40),
    ('tiktok_rti', 'Purvu The Secret Store - Markerplace', 50),
    ('tiktok_rti', 'YUV Deodorant Serum Store - Marketplace', 60),
    ('tiktok_rti', 'Osgard Oil Store - Marketplace', 70),
    ('tiktok_rti', 'drHyun Main Store - Marketplace', 80),

    ('shopee_jhn', 'Purvu Store', 10),
    ('shopee_jhn', 'Purvu The Secret Store', 20),
    ('shopee_jhn', 'drHyun Main Store', 30),
    ('shopee_jhn', 'Calmara Main Store', 40),

    ('tiktok_jhn', 'Purvu Store', 10),
    ('tiktok_jhn', 'Purvu The Secret Store', 20),
    ('tiktok_jhn', 'drHyun Main Store', 30),
    ('tiktok_jhn', 'Calmara Main Store', 40),

    ('blibli_rti', 'Roove Main Store - Marketplace', 10),
    ('blibli_rti', 'Globite Store - Marketplace', 20),
    ('blibli_rti', 'Pluve Main Store - Marketplace', 30),
    ('blibli_rti', 'Purvu Store - Marketplace', 40),
    ('blibli_rti', 'Purvu The Secret Store - Markerplace', 50),

    ('lazada_rlt', 'Roove Main Store - Marketplace', 10),
    ('lazada_rlt', 'Globite Store - Marketplace', 20),
    ('lazada_rlt', 'Pluve Main Store - Marketplace', 30),
    ('lazada_rlt', 'Purvu Store - Marketplace', 40),
    ('lazada_rlt', 'Purvu The Secret Store - Markerplace', 50),
    ('lazada_rlt', 'Osgard Oil Store', 60)
)
INSERT INTO marketplace_upload_source_stores (
  source_id,
  store_name,
  sort_order
)
SELECT
  sources.id,
  store_rows.store_name,
  store_rows.sort_order
FROM store_rows
JOIN marketplace_upload_sources sources
  ON sources.source_key = store_rows.source_key
ON CONFLICT (source_id, store_name) DO UPDATE SET
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();
