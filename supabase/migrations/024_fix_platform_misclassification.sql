-- ============================================================
-- 024: Fix platform misclassification for non-marketplace-named stores
-- ============================================================
-- Bug: derivePlatformFromStore() in the webhook handler only checked
-- financial_entity.code inside the "marketplace" store name branch.
-- Stores without "marketplace" in their name (e.g. "Osgard Oil Store",
-- "Purvu The Secret Store") defaulted to platform='scalev' even when
-- they were marketplace orders with valid financial_entity.code.
--
-- This migration:
-- 1. Fixes 140 existing misclassified orders
-- 2. Fixes corresponding order_lines sales_channel
--
-- The webhook handler fix is in app/api/scalev-webhook/route.ts
-- (derivePlatformFromStore now checks financial_entity.code before
-- defaulting to 'scalev').
-- ============================================================

-- Fix scalev_orders.platform using financial_entity.code from raw_data
UPDATE scalev_orders
SET platform = LOWER(raw_data->'financial_entity'->>'code')
WHERE source = 'webhook'
  AND platform = 'scalev'
  AND payment_method = 'marketplace'
  AND raw_data->'financial_entity'->>'code' IS NOT NULL
  AND LOWER(raw_data->'financial_entity'->>'code') IN (
    'shopee', 'tiktokshop', 'lazada', 'blibli', 'tokopedia'
  );

-- Fix scalev_order_lines.sales_channel for affected orders
UPDATE scalev_order_lines
SET sales_channel = CASE
  WHEN fo.platform = 'shopee'     THEN 'Shopee'
  WHEN fo.platform = 'tiktokshop' THEN 'TikTok Shop'
  WHEN fo.platform = 'lazada'     THEN 'Lazada'
  WHEN fo.platform = 'blibli'     THEN 'Blibli'
  WHEN fo.platform = 'tokopedia'  THEN 'Tokopedia'
  ELSE scalev_order_lines.sales_channel
END
FROM (
  SELECT order_id, platform
  FROM scalev_orders
  WHERE source = 'webhook'
    AND payment_method = 'marketplace'
    AND platform IN ('shopee', 'tiktokshop', 'lazada', 'blibli', 'tokopedia')
) fo
WHERE scalev_order_lines.order_id = fo.order_id
  AND scalev_order_lines.sales_channel = 'Organik';
