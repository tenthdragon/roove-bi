-- ============================================================
-- Marketplace intake warehouse workspace
-- ============================================================
-- Upload marketplace intake tetap masuk staging terlebih dahulu.
-- Data baru dianggap valid operasional setelah warehouse memberi
-- shipment_date dan status warehouse yang sesuai.
-- ============================================================

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS shipment_date DATE;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS warehouse_status TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS warehouse_note TEXT;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS warehouse_updated_at TIMESTAMPTZ;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ADD COLUMN IF NOT EXISTS warehouse_updated_by_email TEXT;

UPDATE marketplace_intake_orders
SET warehouse_status = 'staged'
WHERE warehouse_status IS NULL;

ALTER TABLE IF EXISTS marketplace_intake_orders
  ALTER COLUMN warehouse_status SET DEFAULT 'staged';

ALTER TABLE IF EXISTS marketplace_intake_orders
  ALTER COLUMN warehouse_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'marketplace_intake_orders_warehouse_status_check'
  ) THEN
    ALTER TABLE marketplace_intake_orders
      ADD CONSTRAINT marketplace_intake_orders_warehouse_status_check
      CHECK (warehouse_status IN ('staged', 'scheduled', 'hold', 'canceled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_marketplace_intake_orders_warehouse_status
  ON marketplace_intake_orders (warehouse_status, shipment_date, batch_id, external_order_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_intake_orders_shipment_date
  ON marketplace_intake_orders (shipment_date, warehouse_status, batch_id, external_order_id);

COMMENT ON COLUMN marketplace_intake_orders.shipment_date IS
  'Tanggal shipment marketplace yang dipilih warehouse. Selama NULL, order masih staging dan belum valid downstream.';

COMMENT ON COLUMN marketplace_intake_orders.warehouse_status IS
  'Status workspace warehouse: staged, scheduled, hold, canceled.';

COMMENT ON COLUMN marketplace_intake_orders.warehouse_note IS
  'Catatan operasional warehouse untuk order marketplace pada workspace intake.';

COMMENT ON COLUMN marketplace_intake_orders.warehouse_updated_at IS
  'Waktu terakhir status/tanggal shipment order diperbarui oleh warehouse.';

COMMENT ON COLUMN marketplace_intake_orders.warehouse_updated_by_email IS
  'Email pengguna yang terakhir mengubah status/tanggal shipment order di workspace warehouse.';
