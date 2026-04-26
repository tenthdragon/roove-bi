CREATE TABLE IF NOT EXISTS marketplace_intake_sku_aliases (
  id BIGSERIAL PRIMARY KEY,
  source_key TEXT NOT NULL,
  business_id BIGINT REFERENCES scalev_webhook_businesses(id) ON DELETE SET NULL,
  business_code TEXT NOT NULL,
  platform TEXT NOT NULL,
  raw_platform_sku_id TEXT,
  raw_seller_sku TEXT,
  raw_product_name TEXT,
  raw_variation TEXT,
  normalized_sku TEXT NOT NULL,
  reason TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    COALESCE(NULLIF(BTRIM(raw_platform_sku_id), ''), NULLIF(BTRIM(raw_seller_sku), ''), NULLIF(BTRIM(raw_product_name), '')) IS NOT NULL
  )
);

COMMENT ON TABLE marketplace_intake_sku_aliases IS
  'Deterministic raw marketplace SKU remaps used by Marketplace Intake before staged/classification.';

COMMENT ON COLUMN marketplace_intake_sku_aliases.normalized_sku IS
  'Operational SKU/custom_id that should replace the raw marketplace SKU for exact matching.';

CREATE INDEX IF NOT EXISTS idx_marketplace_intake_sku_aliases_lookup
  ON marketplace_intake_sku_aliases (source_key, business_code, platform, is_active);

DROP TRIGGER IF EXISTS set_updated_at_marketplace_intake_sku_aliases ON marketplace_intake_sku_aliases;
CREATE TRIGGER set_updated_at_marketplace_intake_sku_aliases
  BEFORE UPDATE ON marketplace_intake_sku_aliases
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_updated_at();

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS raw_platform_sku_id TEXT;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS raw_seller_sku TEXT;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS normalized_sku TEXT;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS sku_normalization_source TEXT;

ALTER TABLE IF EXISTS marketplace_intake_order_lines
  ADD COLUMN IF NOT EXISTS sku_normalization_reason TEXT;

COMMENT ON COLUMN marketplace_intake_order_lines.raw_platform_sku_id IS
  'Raw platform-level SKU identifier from marketplace export, such as TikTok SKU ID.';

COMMENT ON COLUMN marketplace_intake_order_lines.raw_seller_sku IS
  'Raw seller SKU exactly as exported by the marketplace before any normalization/remap.';

COMMENT ON COLUMN marketplace_intake_order_lines.normalized_sku IS
  'SKU used by intake classifier after deterministic alias remap or fallback inference.';

COMMENT ON COLUMN marketplace_intake_order_lines.sku_normalization_source IS
  'How normalized_sku was produced: marketplace value, alias remap, or fallback inference.';

COMMENT ON COLUMN marketplace_intake_order_lines.sku_normalization_reason IS
  'Human-readable explanation for the normalized SKU choice.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM scalev_webhook_businesses
    WHERE business_code = 'RTI'
  ) THEN
    INSERT INTO marketplace_intake_sku_aliases (
      source_key,
      business_id,
      business_code,
      platform,
      raw_seller_sku,
      normalized_sku,
      reason,
      is_active
    )
    SELECT
      'tiktok_rti',
      id,
      business_code,
      'tiktok',
      'SRTARM-250',
      'SRTARM-185',
      'Legacy seller SKU in TikTok seller center; ops uploads Arum as SRTARM-185.',
      TRUE
    FROM scalev_webhook_businesses
    WHERE business_code = 'RTI'
      AND NOT EXISTS (
        SELECT 1
        FROM marketplace_intake_sku_aliases alias
        WHERE alias.source_key = 'tiktok_rti'
          AND alias.business_code = 'RTI'
          AND alias.platform = 'tiktok'
          AND alias.raw_seller_sku = 'SRTARM-250'
          AND alias.normalized_sku = 'SRTARM-185'
      );

    INSERT INTO marketplace_intake_sku_aliases (
      source_key,
      business_id,
      business_code,
      platform,
      raw_seller_sku,
      normalized_sku,
      reason,
      is_active
    )
    SELECT
      'tiktok_rti',
      id,
      business_code,
      'tiktok',
      'PRVHRM30-145',
      'PAM30-155',
      'Legacy seller SKU in TikTok seller center; ops uploads Arabian Memories as PAM30-155.',
      TRUE
    FROM scalev_webhook_businesses
    WHERE business_code = 'RTI'
      AND NOT EXISTS (
        SELECT 1
        FROM marketplace_intake_sku_aliases alias
        WHERE alias.source_key = 'tiktok_rti'
          AND alias.business_code = 'RTI'
          AND alias.platform = 'tiktok'
          AND alias.raw_seller_sku = 'PRVHRM30-145'
          AND alias.normalized_sku = 'PAM30-155'
      );
  END IF;
END $$;
