-- 028_store_channels.sql
-- Multi-business API keys + store-to-channel mapping

-- A. Add api_key to scalev_webhook_businesses
ALTER TABLE scalev_webhook_businesses ADD COLUMN IF NOT EXISTS api_key TEXT;

-- B. Create scalev_store_channels table
CREATE TABLE IF NOT EXISTS scalev_store_channels (
  id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES scalev_webhook_businesses(id) ON DELETE CASCADE,
  store_name TEXT NOT NULL,
  default_channel TEXT NOT NULL,
  fb_ads_channel TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id, store_name)
);

CREATE INDEX IF NOT EXISTS idx_ssc_business ON scalev_store_channels (business_id);
CREATE INDEX IF NOT EXISTS idx_ssc_store_name ON scalev_store_channels (store_name);

-- C. Pre-populate from existing order data
INSERT INTO scalev_store_channels (business_id, store_name, default_channel, fb_ads_channel)
SELECT DISTINCT
  b.id,
  o.store_name,
  CASE
    WHEN LOWER(o.store_name) LIKE '%marketplace%'
      OR LOWER(o.store_name) LIKE '%markerplace%' THEN 'Marketplace'
    WHEN LOWER(o.store_name) LIKE '%shopee%' THEN 'Shopee'
    WHEN LOWER(o.store_name) LIKE '%tiktok%' THEN 'TikTok Shop'
    WHEN LOWER(o.store_name) LIKE '%lazada%' THEN 'Lazada'
    WHEN LOWER(o.store_name) LIKE '%blibli%' THEN 'BliBli'
    WHEN LOWER(o.store_name) LIKE '%tokopedia%' THEN 'Tokopedia'
    WHEN LOWER(o.store_name) IN (
      'drhyun reseller store', 'purvu dropship',
      'reseller - dropship', 'reseller - mitra offline seller'
    ) THEN 'Reseller'
    ELSE 'CS Manual'
  END,
  CASE
    WHEN LOWER(o.store_name) LIKE '%marketplace%'
      OR LOWER(o.store_name) LIKE '%markerplace%' THEN NULL
    WHEN LOWER(o.store_name) NOT LIKE '%shopee%'
     AND LOWER(o.store_name) NOT LIKE '%tiktok%'
     AND LOWER(o.store_name) NOT LIKE '%lazada%'
     AND LOWER(o.store_name) NOT LIKE '%blibli%'
     AND LOWER(o.store_name) NOT LIKE '%tokopedia%'
     AND LOWER(o.store_name) NOT IN (
       'drhyun reseller store', 'purvu dropship',
       'reseller - dropship', 'reseller - mitra offline seller'
     )
    THEN 'Scalev Ads'
    ELSE NULL
  END
FROM scalev_orders o
JOIN scalev_webhook_businesses b ON b.business_code = o.business_code
WHERE o.store_name IS NOT NULL
  AND o.business_code IS NOT NULL
ON CONFLICT (business_id, store_name) DO NOTHING;

-- D. Backfill business_code on orders that don't have it
-- Match via store_name from orders that already have business_code
UPDATE scalev_orders o
SET business_code = matched.business_code
FROM (
  SELECT DISTINCT o2.store_name, o2.business_code
  FROM scalev_orders o2
  WHERE o2.business_code IS NOT NULL
    AND o2.store_name IS NOT NULL
) matched
WHERE o.business_code IS NULL
  AND o.store_name IS NOT NULL
  AND o.store_name = matched.store_name;
