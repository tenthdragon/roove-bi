-- ============================================================
-- Marketplace intake Scalev identity reconciliation metadata
-- ============================================================
-- Menyimpan status penarikan identity order_id/scalev_id dari
-- Scalev untuk batch Marketplace Intake setelah push via API.
-- ============================================================

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_reconcile_status TEXT;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_reconcile_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_reconcile_target_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_reconcile_matched_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_reconcile_updated_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_reconcile_already_linked_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_reconcile_unmatched_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_reconcile_conflict_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_reconcile_error_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_reconcile_error TEXT;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS scalev_last_reconcile_summary JSONB NOT NULL DEFAULT '{}'::JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_intake_batches_scalev_last_reconcile_status_check'
  ) THEN
    ALTER TABLE marketplace_intake_batches
      ADD CONSTRAINT marketplace_intake_batches_scalev_last_reconcile_status_check
      CHECK (
        scalev_last_reconcile_status IS NULL
        OR scalev_last_reconcile_status IN ('success', 'partial', 'failed')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_marketplace_intake_batches_scalev_reconcile
  ON marketplace_intake_batches (scalev_last_reconcile_at DESC, scalev_last_reconcile_status);

COMMENT ON COLUMN marketplace_intake_batches.scalev_last_reconcile_status IS
  'Status terakhir penarikan identity order_id/scalev_id dari Scalev untuk batch intake.';

COMMENT ON COLUMN marketplace_intake_batches.scalev_last_reconcile_summary IS
  'Ringkasan detail terakhir hasil reconcile external_id marketplace ke identity order Scalev.';
