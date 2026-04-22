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

CREATE TABLE IF NOT EXISTS scalev_catalog_bundle_store_links (
  id BIGSERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES scalev_webhook_businesses(id) ON DELETE CASCADE,
  business_code TEXT NOT NULL,
  scalev_bundle_id INT NOT NULL,
  scalev_store_id INT,
  store_unique_id TEXT,
  store_name TEXT NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT false,
  availability_source TEXT NOT NULL DEFAULT 'scalev.store_bundle_detail',
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, scalev_bundle_id, store_name)
);

COMMENT ON TABLE scalev_catalog_bundle_store_links IS
  'Exact cache of bundle availability per marketplace store, sourced from Scalev store-specific bundle detail endpoints.';

CREATE INDEX IF NOT EXISTS idx_scbsl_business_bundle
  ON scalev_catalog_bundle_store_links (business_id, scalev_bundle_id);

CREATE INDEX IF NOT EXISTS idx_scbsl_business_store
  ON scalev_catalog_bundle_store_links (business_id, store_name);

ALTER TABLE scalev_catalog_bundle_store_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scalev_catalog_bundle_store_links_read" ON scalev_catalog_bundle_store_links;
CREATE POLICY "scalev_catalog_bundle_store_links_read" ON scalev_catalog_bundle_store_links
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "scalev_catalog_bundle_store_links_manage" ON scalev_catalog_bundle_store_links;
CREATE POLICY "scalev_catalog_bundle_store_links_manage" ON scalev_catalog_bundle_store_links
  FOR ALL TO authenticated
  USING (dashboard_has_permission('whs:mapping'))
  WITH CHECK (dashboard_has_permission('whs:mapping'));

DROP TRIGGER IF EXISTS set_updated_at_scalev_catalog_bundle_store_links ON scalev_catalog_bundle_store_links;
CREATE TRIGGER set_updated_at_scalev_catalog_bundle_store_links
  BEFORE UPDATE ON scalev_catalog_bundle_store_links
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
