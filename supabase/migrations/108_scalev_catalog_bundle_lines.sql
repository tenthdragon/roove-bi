-- ============================================================
-- Stage 3: Scalev bundle composition cache
-- ============================================================
-- Stores bundle line composition per business so Scalev bundle
-- identifiers can be expanded into concrete variant/product
-- mappings inside warehouse deduction.
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

CREATE TABLE IF NOT EXISTS scalev_catalog_bundle_lines (
  id BIGSERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES scalev_webhook_businesses(id) ON DELETE CASCADE,
  business_code TEXT NOT NULL,
  scalev_bundle_id INT NOT NULL,
  scalev_bundle_name TEXT NOT NULL,
  scalev_bundle_line_id INT,
  scalev_bundle_line_key TEXT NOT NULL,
  line_position INT NOT NULL DEFAULT 0,
  quantity NUMERIC NOT NULL DEFAULT 1,
  scalev_product_id INT,
  scalev_variant_id INT,
  scalev_variant_unique_id TEXT,
  scalev_variant_uuid TEXT,
  scalev_variant_sku TEXT,
  scalev_variant_name TEXT,
  scalev_variant_product_name TEXT,
  variant_item_type TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, scalev_bundle_id, scalev_bundle_line_key)
);

COMMENT ON TABLE scalev_catalog_bundle_lines IS
  'Cached Scalev bundle composition per business, sourced from bundle detail endpoint.';
COMMENT ON COLUMN scalev_catalog_bundle_lines.scalev_bundle_line_key IS
  'Stable line key for a bundle component, preferring Scalev bundle line id when available.';

CREATE INDEX IF NOT EXISTS idx_scbl_business_bundle
  ON scalev_catalog_bundle_lines (business_id, scalev_bundle_id, line_position);
CREATE INDEX IF NOT EXISTS idx_scbl_business_variant
  ON scalev_catalog_bundle_lines (business_id, scalev_variant_id);
CREATE INDEX IF NOT EXISTS idx_scbl_business_product
  ON scalev_catalog_bundle_lines (business_id, scalev_product_id);

ALTER TABLE scalev_catalog_bundle_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scalev_catalog_bundle_lines_read" ON scalev_catalog_bundle_lines;
CREATE POLICY "scalev_catalog_bundle_lines_read" ON scalev_catalog_bundle_lines
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "scalev_catalog_bundle_lines_manage" ON scalev_catalog_bundle_lines;
CREATE POLICY "scalev_catalog_bundle_lines_manage" ON scalev_catalog_bundle_lines
  FOR ALL TO authenticated
  USING (dashboard_has_permission('whs:mapping'))
  WITH CHECK (dashboard_has_permission('whs:mapping'));

DROP TRIGGER IF EXISTS set_updated_at_scalev_catalog_bundle_lines ON scalev_catalog_bundle_lines;
CREATE TRIGGER set_updated_at_scalev_catalog_bundle_lines
  BEFORE UPDATE ON scalev_catalog_bundle_lines
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
