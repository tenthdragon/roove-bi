-- ============================================================================
-- Migration 043: Add WABA sales channel
-- ============================================================================
-- Adds channel_override to scalev_store_channels for store-specific channel
-- mapping. Sets Roove Mitra Store → WABA and reclassifies existing order lines.
-- ============================================================================

-- 1. Add channel_override column
ALTER TABLE scalev_store_channels ADD COLUMN channel_override TEXT;

-- 2. Set WABA override for Roove Mitra Store
UPDATE scalev_store_channels
SET channel_override = 'WABA'
WHERE LOWER(store_name) = 'roove mitra store';

-- 3. Reclassify existing order lines from CS Manual/Scalev Ads → WABA
UPDATE scalev_order_lines sol
SET sales_channel = 'WABA'
FROM scalev_orders so
WHERE sol.scalev_order_id = so.id
  AND LOWER(so.store_name) = 'roove mitra store'
  AND sol.sales_channel IN ('CS Manual', 'Scalev Ads');
