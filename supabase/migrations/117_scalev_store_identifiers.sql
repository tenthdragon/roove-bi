-- 117: Persist Scalev store identifiers for outbound order creation

ALTER TABLE scalev_store_channels
  ADD COLUMN IF NOT EXISTS scalev_store_id INT,
  ADD COLUMN IF NOT EXISTS store_unique_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ssc_scalev_store_id
  ON scalev_store_channels (scalev_store_id)
  WHERE scalev_store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ssc_store_unique_id
  ON scalev_store_channels (store_unique_id)
  WHERE store_unique_id IS NOT NULL;
