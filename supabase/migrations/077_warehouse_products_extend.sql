-- ============================================================
-- Extend warehouse_products: hpp, vendor, brand_id
-- ============================================================

ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS hpp NUMERIC DEFAULT 0;
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS vendor TEXT;
ALTER TABLE warehouse_products ADD COLUMN IF NOT EXISTS brand_id INT REFERENCES brands(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wp_brand ON warehouse_products(brand_id);

COMMENT ON COLUMN warehouse_products.hpp IS 'Harga Pokok Penjualan (Cost of Goods) per unit';
COMMENT ON COLUMN warehouse_products.vendor IS 'Default vendor/supplier for this product';
COMMENT ON COLUMN warehouse_products.brand_id IS 'Link to brands table for brand grouping';
