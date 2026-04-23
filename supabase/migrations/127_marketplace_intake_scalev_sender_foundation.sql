-- ============================================================
-- Marketplace intake raw snapshot + Scalev sender foundation
-- ============================================================
-- Menambahkan snapshot batch yang eksplisit dan kolom jejak
-- projection/sender sebelum manifest final dibentuk.
-- ============================================================

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS source_headers JSONB NOT NULL DEFAULT '[]'::JSONB;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS raw_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_projection_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_projection_csv TEXT;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_projection_generated_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_send_status TEXT;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_send_mode TEXT;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_send_shipment_date DATE;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_send_row_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_send_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_send_error TEXT;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_response JSONB NOT NULL DEFAULT '{}'::JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_intake_batches_scalev_last_send_status_check'
  ) THEN
    ALTER TABLE marketplace_intake_batches
      ADD CONSTRAINT marketplace_intake_batches_scalev_last_send_status_check
      CHECK (
        scalev_last_send_status IS NULL
        OR scalev_last_send_status IN ('success', 'failed')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_marketplace_intake_batches_scalev_send
  ON marketplace_intake_batches (scalev_last_send_at DESC, scalev_last_send_status);

COMMENT ON COLUMN marketplace_intake_batches.source_headers IS
  'Daftar header asli dari file marketplace yang dipreview/disimpan.';

COMMENT ON COLUMN marketplace_intake_batches.raw_snapshot IS
  'Snapshot raw intake per batch saat confirm save. Bukan archive event-by-event.';

COMMENT ON COLUMN marketplace_intake_batches.scalev_projection_snapshot IS
  'Snapshot projection operasional yang dibentuk untuk ditiru ke CSV/API Scalev.';

COMMENT ON COLUMN marketplace_intake_batches.scalev_projection_csv IS
  'CSV operasional hasil projection intake yang siap ditiru ke endpoint upload Scalev.';

COMMENT ON COLUMN marketplace_intake_batches.scalev_last_response IS
  'Response terakhir dari Scalev order/upload untuk batch intake ini.';
