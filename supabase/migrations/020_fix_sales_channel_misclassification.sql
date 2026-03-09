-- 020: Fix sales_channel misclassification on order lines
--
-- Root cause 1: order.updated webhook changed is_purchase_fb on scalev_orders
-- but did NOT update sales_channel on existing scalev_order_lines.
-- This caused orders with is_purchase_fb=false to still have lines with
-- sales_channel='Facebook Ads' (should be 'Organik'), and vice versa.
--
-- Root cause 2: 'mitra' in store_name was incorrectly classified as 'Reseller'.
-- Only stores containing 'reseller' should be classified as Reseller.

-- Case 1: is_purchase_fb is false (and not tiktok) but lines say 'Facebook Ads'
-- These should be 'Organik' for scalev-platform orders.
UPDATE scalev_order_lines sol
SET sales_channel = 'Organik',
    is_purchase_fb = false
FROM scalev_orders so
WHERE sol.scalev_order_id = so.id
  AND so.is_purchase_fb IS NOT TRUE
  AND so.is_purchase_tiktok IS NOT TRUE
  AND so.platform = 'scalev'
  AND sol.sales_channel = 'Facebook Ads';

-- Case 2: is_purchase_fb is true but lines say 'Organik'
-- These should be 'Facebook Ads' for scalev-platform orders.
UPDATE scalev_order_lines sol
SET sales_channel = 'Facebook Ads',
    is_purchase_fb = true
FROM scalev_orders so
WHERE sol.scalev_order_id = so.id
  AND so.is_purchase_fb = true
  AND so.platform = 'scalev'
  AND sol.sales_channel = 'Organik';

-- Case 3: is_purchase_tiktok is true but lines say wrong channel
UPDATE scalev_order_lines sol
SET sales_channel = 'TikTok Ads',
    is_purchase_tiktok = true
FROM scalev_orders so
WHERE sol.scalev_order_id = so.id
  AND so.is_purchase_tiktok = true
  AND so.is_purchase_fb IS NOT TRUE
  AND so.platform = 'scalev'
  AND sol.sales_channel IN ('Organik', 'Facebook Ads');

-- Case 4: 'mitra' stores incorrectly classified as 'Reseller'
-- Re-classify based on actual purchase flags (only 'reseller' stores should be Reseller)
UPDATE scalev_order_lines sol
SET sales_channel = CASE
    WHEN so.is_purchase_fb = true THEN 'Facebook Ads'
    WHEN so.is_purchase_tiktok = true THEN 'TikTok Ads'
    ELSE 'Organik'
  END
FROM scalev_orders so
WHERE sol.scalev_order_id = so.id
  AND so.platform = 'scalev'
  AND LOWER(so.store_name) LIKE '%mitra%'
  AND LOWER(so.store_name) NOT LIKE '%reseller%'
  AND sol.sales_channel = 'Reseller';

-- After fixing the data, refresh materialized views
SELECT refresh_order_views(true);
