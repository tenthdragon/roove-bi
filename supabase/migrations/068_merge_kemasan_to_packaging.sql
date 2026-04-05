-- ============================================================
-- Merge 'kemasan' category into 'packaging'
-- ============================================================

-- Update existing data
UPDATE warehouse_products SET category = 'packaging' WHERE category = 'kemasan';

-- Update CHECK constraint to remove 'kemasan'
ALTER TABLE warehouse_products DROP CONSTRAINT IF EXISTS warehouse_products_category_check;
ALTER TABLE warehouse_products ADD CONSTRAINT warehouse_products_category_check
  CHECK (category IN ('fg','sachet','packaging','bonus','other'));
