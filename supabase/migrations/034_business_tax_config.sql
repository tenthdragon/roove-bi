-- ============================================================
-- Per-business tax configuration
--
-- Not all businesses charge PPN. JHN (Jejak Herba Nusantara)
-- has 0% tax, but buildEnrichedLines was dividing all prices
-- by 1.11 globally. This adds a per-business tax_rate_name
-- column and fixes existing JHN order lines.
-- ============================================================

-- Step 1: Add tax_rate_name column to businesses table
ALTER TABLE scalev_webhook_businesses
  ADD COLUMN tax_rate_name TEXT DEFAULT 'PPN';

COMMENT ON COLUMN scalev_webhook_businesses.tax_rate_name IS
  'Tax rate name from tax_rates table. ''NONE'' = no tax (divisor 1.0).';

-- Step 2: Set JHN to NONE (no PPN)
UPDATE scalev_webhook_businesses
SET tax_rate_name = 'NONE'
WHERE business_code = 'JHN';

-- Step 3: Fix existing JHN order lines — undo incorrect 1.11 division
UPDATE scalev_order_lines l
SET
  product_price_bt = ROUND(l.product_price_bt * 1.11),
  discount_bt      = ROUND(l.discount_bt * 1.11),
  cogs_bt          = ROUND(l.cogs_bt * 1.11),
  tax_rate         = 0
FROM scalev_orders o
WHERE l.scalev_order_id = o.id
  AND o.business_code = 'JHN'
  AND l.tax_rate <> 0;

-- Step 4: Refresh materialized views
SELECT refresh_order_views();
