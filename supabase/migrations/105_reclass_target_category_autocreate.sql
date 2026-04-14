-- ============================================================
-- 105: Reclassification target category + auto-create variants
-- Allows same product name to exist in different categories
-- within the same warehouse/entity and stores target-category
-- intent on reclassification requests.
-- ============================================================

ALTER TABLE warehouse_products
  DROP CONSTRAINT IF EXISTS warehouse_products_name_entity_warehouse_key;

ALTER TABLE warehouse_products
  DROP CONSTRAINT IF EXISTS warehouse_products_name_entity_warehouse_category_key;

ALTER TABLE warehouse_products
  ADD CONSTRAINT warehouse_products_name_entity_warehouse_category_key
  UNIQUE (name, entity, warehouse, category);

ALTER TABLE warehouse_stock_reclass_requests
  ADD COLUMN IF NOT EXISTS requested_target_category TEXT,
  ADD COLUMN IF NOT EXISTS target_product_auto_created BOOLEAN NOT NULL DEFAULT false;

UPDATE warehouse_stock_reclass_requests
SET requested_target_category = COALESCE(requested_target_category, target_category_snapshot)
WHERE requested_target_category IS NULL;

ALTER TABLE warehouse_stock_reclass_requests
  DROP CONSTRAINT IF EXISTS warehouse_stock_reclass_requests_requested_target_category_check;

ALTER TABLE warehouse_stock_reclass_requests
  ADD CONSTRAINT warehouse_stock_reclass_requests_requested_target_category_check
  CHECK (requested_target_category IN ('fg','bonus'));
