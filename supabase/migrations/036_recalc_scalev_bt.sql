-- Recalculate Scalev platform order lines from divisor (÷1.11) to DPP Nilai Lain (×11/12)
-- Reversal: original_price = old_bt × 1.11, then new_bt = original_price × 11/12
-- Combined: new_bt = old_bt × 1.11 × 11/12

UPDATE scalev_order_lines sol
SET
  product_price_bt = product_price_bt * 1.11 * 11 / 12,
  discount_bt = discount_bt * 1.11 * 11 / 12,
  cogs_bt = cogs_bt * 1.11 * 11 / 12
WHERE EXISTS (
  SELECT 1 FROM scalev_orders so
  WHERE so.id = sol.scalev_order_id
    AND so.store_name NOT ILIKE '%shopee%'
    AND so.store_name NOT ILIKE '%tiktok%'
    AND so.store_name NOT ILIKE '%lazada%'
    AND so.store_name NOT ILIKE '%blibli%'
    AND so.store_name NOT ILIKE '%tokopedia%'
    AND so.store_name NOT ILIKE '%marketplace%'
    AND so.store_name NOT ILIKE '%markerplace%'
)
AND sol.tax_rate > 0;

-- Refresh materialized views to reflect new values
SELECT refresh_order_views();
