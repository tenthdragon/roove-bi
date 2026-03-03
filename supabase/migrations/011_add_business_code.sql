-- 011: Add business_code column to scalev_orders and scalev_sync_log
-- Supports multi-business webhook: RTI, RLB, RLT
-- RTI = Roove Tijara Internasional
-- RLB = Roove Lautan Barat
-- RLT = Roove Lautan Timur

-- Add business_code to scalev_orders
ALTER TABLE scalev_orders ADD COLUMN IF NOT EXISTS business_code TEXT;

-- Add business_code to scalev_sync_log
ALTER TABLE scalev_sync_log ADD COLUMN IF NOT EXISTS business_code TEXT;

-- Index for filtering orders by business
CREATE INDEX IF NOT EXISTS idx_scalev_orders_business_code ON scalev_orders (business_code);

-- Optional: comment for documentation
COMMENT ON COLUMN scalev_orders.business_code IS 'Scalev business identifier: RTI, RLB, or RLT';
COMMENT ON COLUMN scalev_sync_log.business_code IS 'Scalev business identifier: RTI, RLB, or RLT';
