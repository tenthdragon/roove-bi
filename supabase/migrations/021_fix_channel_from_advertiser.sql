-- 021: Re-derive is_purchase_fb and sales_channel from raw_data.message_variables.advertiser
--
-- Root cause: webhook never sends is_purchase_fb. All webhook orders default to false.
-- Fix: use message_variables.advertiser from stored raw_data to determine if order
-- came from ads (non-empty advertiser → Facebook Ads / Scalev Ads) or CS manual
-- (empty advertiser → Organik / CS Manual).

-- Step 1: Set is_purchase_fb = true on orders where advertiser is non-empty
UPDATE scalev_orders
SET is_purchase_fb = true
WHERE source = 'webhook'
  AND platform = 'scalev'
  AND is_purchase_fb IS NOT TRUE
  AND TRIM(COALESCE(raw_data->'message_variables'->>'advertiser', '')) != '';

-- Step 2: Set is_purchase_fb = false on orders where advertiser is empty
-- (ensure consistency — these are CS Manual orders)
UPDATE scalev_orders
SET is_purchase_fb = false
WHERE source = 'webhook'
  AND platform = 'scalev'
  AND is_purchase_fb = true
  AND is_purchase_tiktok IS NOT TRUE
  AND TRIM(COALESCE(raw_data->'message_variables'->>'advertiser', '')) = ''
  -- Don't touch orders that were enriched by CSV (they have the correct flag)
  AND raw_data->>'is_purchase_fb' IS NULL;

-- Step 3: Update order lines to match — orders with advertiser → Facebook Ads
UPDATE scalev_order_lines sol
SET sales_channel = 'Facebook Ads',
    is_purchase_fb = true
FROM scalev_orders so
WHERE sol.scalev_order_id = so.id
  AND so.source = 'webhook'
  AND so.platform = 'scalev'
  AND so.is_purchase_fb = true
  AND sol.sales_channel != 'Facebook Ads'
  AND sol.sales_channel NOT IN ('Reseller', 'Shopee', 'TikTok Shop', 'Lazada', 'Tokopedia', 'BliBli');

-- Step 4: Update order lines to match — orders without advertiser → Organik
UPDATE scalev_order_lines sol
SET sales_channel = 'Organik',
    is_purchase_fb = false
FROM scalev_orders so
WHERE sol.scalev_order_id = so.id
  AND so.source = 'webhook'
  AND so.platform = 'scalev'
  AND so.is_purchase_fb IS NOT TRUE
  AND so.is_purchase_tiktok IS NOT TRUE
  AND sol.sales_channel = 'Facebook Ads';

-- Step 5: Refresh materialized views
SELECT refresh_order_views(true);
