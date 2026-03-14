-- 030_store_type.sql
-- Replace default_channel + fb_ads_channel with store_type enum
-- store_type: 'marketplace' | 'scalev' | 'reseller'

-- 1. Add store_type column (nullable first for migration)
ALTER TABLE scalev_store_channels ADD COLUMN store_type TEXT;

-- 2. Populate from existing data
UPDATE scalev_store_channels SET store_type = CASE
  WHEN default_channel IN ('Marketplace', 'Shopee', 'TikTok Shop', 'Lazada', 'Tokopedia', 'BliBli') THEN 'marketplace'
  WHEN default_channel = 'Reseller' THEN 'reseller'
  ELSE 'scalev'
END;

-- 3. Make NOT NULL + add CHECK constraint
ALTER TABLE scalev_store_channels ALTER COLUMN store_type SET NOT NULL;
ALTER TABLE scalev_store_channels ADD CONSTRAINT chk_store_type
  CHECK (store_type IN ('marketplace', 'scalev', 'reseller'));

-- 4. Drop old columns
ALTER TABLE scalev_store_channels DROP COLUMN default_channel;
ALTER TABLE scalev_store_channels DROP COLUMN fb_ads_channel;
