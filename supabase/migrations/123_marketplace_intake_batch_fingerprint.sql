-- ============================================================
-- Marketplace intake batch fingerprint
-- ============================================================
-- Prevents the exact same marketplace intake file content from
-- being saved repeatedly as duplicate batches.
-- ============================================================

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS batch_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_intake_batches_unique_fingerprint
  ON marketplace_intake_batches (source_key, business_code, batch_fingerprint)
  WHERE batch_fingerprint IS NOT NULL;

COMMENT ON COLUMN marketplace_intake_batches.batch_fingerprint IS
  'Deterministic fingerprint of the marketplace intake file contents to block duplicate saves.';
