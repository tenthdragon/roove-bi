-- ============================================================
-- 155: Allow stock reclassification requests for any category
-- Removes FG/BONUS-only constraint from requested target category.
-- ============================================================

ALTER TABLE warehouse_stock_reclass_requests
  DROP CONSTRAINT IF EXISTS warehouse_stock_reclass_requests_requested_target_category_check;

ALTER TABLE warehouse_stock_reclass_requests
  ADD CONSTRAINT warehouse_stock_reclass_requests_requested_target_category_check
  CHECK (
    requested_target_category IS NULL
    OR char_length(btrim(requested_target_category)) > 0
  );
