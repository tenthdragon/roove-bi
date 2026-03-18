-- ============================================================================
-- Migration 041: Fix incorrect dpp_nilai_lain tax formula → divisor
-- ============================================================================
-- The dpp_nilai_lain formula (price × 11/12) was a misinterpretation of
-- the DJP DPP Nilai Lain regulation. The correct before-tax calculation
-- is always price ÷ 1.11 (divisor), regardless of method.
--
-- DJP formula: PPN = DPP × 11/12 × 12% = DPP × 11%
-- So: Harga incl PPN = DPP × 1.11 → DPP = Harga / 1.11
--
-- Affected: scalev_order_lines from webhook/sync (not CSV uploads)
-- where the order is non-marketplace and has tax_rate = 11 (PPN).
-- These were stored as price × 11/12 instead of price / 1.11.
--
-- Correction factor: new_bt = old_bt × (12/11) / 1.11 = old_bt × 12/12.21
--
-- NOT affected (already correct):
--   - ops_upload: uses price / 1.11 (divisor)
--   - csv_upload: uses _bt values directly from Scalev CSV
--   - marketplace orders: already used divisor formula
--   - tax_rate = 0 orders (NONE/JHN): no tax applied
-- ============================================================================

BEGIN;

-- Step 1: Update tax_formula_config to use divisor for all store types
UPDATE tax_formula_config SET formula = 'divisor', updated_at = NOW();

-- Step 2: Recalculate _bt fields for affected lines
-- Only webhook/sync orders (source IS NULL or source = 'webhook')
-- Exclude ops_upload and csv_upload which already used correct formula
UPDATE scalev_order_lines sol
SET
  product_price_bt = ROUND(product_price_bt * 12.0 / 12.21, 2),
  discount_bt      = ROUND(discount_bt * 12.0 / 12.21, 2),
  cogs_bt          = ROUND(cogs_bt * 12.0 / 12.21, 2)
FROM scalev_orders so
WHERE sol.scalev_order_id = so.id
  AND sol.tax_rate = 11
  AND so.platform NOT IN ('shopee', 'tiktokshop', 'tiktok', 'lazada', 'tokopedia', 'blibli')
  AND (so.source IS NULL OR so.source = 'webhook')
  AND sol.product_price_bt > 0;

COMMIT;
