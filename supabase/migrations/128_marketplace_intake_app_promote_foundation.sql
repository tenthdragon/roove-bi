-- ============================================================
-- Marketplace intake direct app promote foundation
-- ============================================================
-- Menyimpan jejak saat batch intake dipromosikan langsung ke
-- scalev_orders/scalev_order_lines sebagai placeholder app-side,
-- sambil tetap membuka jalan bagi enrichment webhook Scalev
-- berdasarkan external_id.
-- ============================================================

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS app_last_promote_status TEXT;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS app_last_promote_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS app_last_promote_order_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS app_last_promote_inserted_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS app_last_promote_updated_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS app_last_promote_skipped_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS marketplace_intake_batches
  ADD COLUMN IF NOT EXISTS app_last_promote_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_intake_batches_app_last_promote_status_check'
  ) THEN
    ALTER TABLE marketplace_intake_batches
      ADD CONSTRAINT marketplace_intake_batches_app_last_promote_status_check
      CHECK (
        app_last_promote_status IS NULL
        OR app_last_promote_status IN ('success', 'failed')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_marketplace_intake_batches_app_promote
  ON marketplace_intake_batches (app_last_promote_at DESC, app_last_promote_status);

ALTER TABLE IF EXISTS scalev_orders
  ADD COLUMN IF NOT EXISTS marketplace_intake_batch_id BIGINT;

ALTER TABLE IF EXISTS scalev_orders
  ADD COLUMN IF NOT EXISTS marketplace_intake_order_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_scalev_orders_marketplace_intake_batch
  ON scalev_orders (marketplace_intake_batch_id, business_code, external_id);

CREATE INDEX IF NOT EXISTS idx_scalev_orders_marketplace_intake_order
  ON scalev_orders (marketplace_intake_order_id);

COMMENT ON COLUMN marketplace_intake_batches.app_last_promote_status IS
  'Status terakhir promosi batch intake langsung ke app read model.';

COMMENT ON COLUMN marketplace_intake_batches.app_last_promote_error IS
  'Error terakhir saat promosi batch intake langsung ke app read model.';

COMMENT ON COLUMN scalev_orders.marketplace_intake_batch_id IS
  'Link balik ke batch intake yang mempromosikan placeholder order ini ke app.';

COMMENT ON COLUMN scalev_orders.marketplace_intake_order_id IS
  'Link balik ke order intake yang mempromosikan placeholder order ini ke app.';
