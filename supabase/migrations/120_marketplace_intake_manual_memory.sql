-- ============================================================
-- Marketplace intake manual memory
-- ============================================================
-- Stores explicit manual confirmations for unresolved marketplace
-- lines so the next preview can preselect them while still
-- showing them for recalibration.
-- ============================================================

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS marketplace_intake_manual_memory (
  id BIGSERIAL PRIMARY KEY,
  source_key TEXT NOT NULL,
  source_label TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('shopee', 'tiktok', 'lazada', 'blibli')),
  business_id INT NOT NULL REFERENCES scalev_webhook_businesses(id) ON DELETE CASCADE,
  business_code TEXT NOT NULL,
  match_signature TEXT NOT NULL,
  mp_sku TEXT,
  mp_product_name TEXT NOT NULL,
  mp_variation TEXT,
  target_entity_type TEXT NOT NULL CHECK (target_entity_type IN ('bundle')),
  target_entity_key TEXT NOT NULL,
  target_entity_label TEXT NOT NULL,
  target_custom_id TEXT,
  scalev_bundle_id INT NOT NULL,
  mapped_store_name TEXT,
  usage_count INT NOT NULL DEFAULT 1,
  created_by_email TEXT,
  updated_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (source_key, business_code, match_signature)
);

COMMENT ON TABLE marketplace_intake_manual_memory IS
  'Remembered manual bundle confirmations for marketplace intake previews.';

CREATE INDEX IF NOT EXISTS idx_marketplace_intake_manual_memory_lookup
  ON marketplace_intake_manual_memory (source_key, business_code, match_signature, is_active);

ALTER TABLE marketplace_intake_manual_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "marketplace_intake_manual_memory_owner_read" ON marketplace_intake_manual_memory;
CREATE POLICY "marketplace_intake_manual_memory_owner_read" ON marketplace_intake_manual_memory
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
  ));

DROP POLICY IF EXISTS "marketplace_intake_manual_memory_owner_manage" ON marketplace_intake_manual_memory;
CREATE POLICY "marketplace_intake_manual_memory_owner_manage" ON marketplace_intake_manual_memory
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
      AND profiles.role = 'owner'
  ));

DROP TRIGGER IF EXISTS set_updated_at_marketplace_intake_manual_memory ON marketplace_intake_manual_memory;
CREATE TRIGGER set_updated_at_marketplace_intake_manual_memory
  BEFORE UPDATE ON marketplace_intake_manual_memory
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
