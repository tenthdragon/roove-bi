-- ============================================================
-- 065 Verification — Run AFTER 065_warehouse_seed_products.sql
-- Delete this file after verification passes.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Total product count
-- ────────────────────────────────────────────────────────────
SELECT COUNT(*) AS total_products FROM warehouse_products;
-- Expected: ~75 products

-- ────────────────────────────────────────────────────────────
-- 2. Count by category
-- ────────────────────────────────────────────────────────────
SELECT category, COUNT(*) AS cnt
FROM warehouse_products
GROUP BY category
ORDER BY cnt DESC;
-- Expected: fg (majority), bonus, sachet, kemasan

-- ────────────────────────────────────────────────────────────
-- 3. Products with ScaleV mapping (non-empty array)
-- ────────────────────────────────────────────────────────────
SELECT COUNT(*) AS products_with_mapping
FROM warehouse_products
WHERE array_length(scalev_product_names, 1) > 0;
-- Expected: ~50+ products have at least 1 ScaleV name

-- ────────────────────────────────────────────────────────────
-- 4. Products WITHOUT ScaleV mapping (empty array)
-- ────────────────────────────────────────────────────────────
SELECT name, category
FROM warehouse_products
WHERE array_length(scalev_product_names, 1) IS NULL
ORDER BY category, name;
-- Expected: sachet mentah, kemasan, some bonus items (korset, goddie bag)

-- ────────────────────────────────────────────────────────────
-- 5. Sample ScaleV lookup — should find Roove Blueberry 20
-- ────────────────────────────────────────────────────────────
SELECT id, name, scalev_product_names
FROM warehouse_find_product_by_scalev_name('Roove Blueberry - 20 Sc');
-- Expected: 1 row → ROOVE BLUEBERI 20 SC

-- ────────────────────────────────────────────────────────────
-- 6. Sample ScaleV lookup — should find Dr Hyun
-- ────────────────────────────────────────────────────────────
SELECT id, name, scalev_product_names
FROM warehouse_find_product_by_scalev_name('Dr Hyun High Fiber - 30 Sc');
-- Expected: 1 row → DRHYUN HIGH FIBER 30 SC

-- ────────────────────────────────────────────────────────────
-- 7. Sample ScaleV lookup — bonus item
-- ────────────────────────────────────────────────────────────
SELECT id, name, scalev_product_names
FROM warehouse_find_product_by_scalev_name('Baby Gold');
-- Expected: 1 row → Baby Gold 0,001 gr

-- ────────────────────────────────────────────────────────────
-- 8. Kartu Stock products all present (14 from Dr Hyun line)
-- ────────────────────────────────────────────────────────────
SELECT name, category, price_list
FROM warehouse_products
WHERE name IN (
  'DRHYUN HIGH FIBER 30 SC',
  'Sachet DRHYUN',
  'Sachet DRHYUN - FG',
  'KEMASAN CUBE DR.HYUN 30 SC',
  'Shaker DR HYUN (HIJAU)',
  'Shaker DR HYUN (PINK)',
  'Shaker DR HYUN (BIRU)',
  'Shaker DR HYUN (KUNING)',
  'Goddie Bag Dr Hyun',
  'Baby Gold 0,001 gr',
  'KORSET M',
  'KORSET L',
  'KORSET XL',
  'KORSET XXL'
)
ORDER BY name;
-- Expected: 14 rows

-- ────────────────────────────────────────────────────────────
-- 9. No duplicate products
-- ────────────────────────────────────────────────────────────
SELECT name, entity, warehouse, COUNT(*) AS cnt
FROM warehouse_products
GROUP BY name, entity, warehouse
HAVING COUNT(*) > 1;
-- Expected: 0 rows (no duplicates)

-- ────────────────────────────────────────────────────────────
-- 10. v_warehouse_stock_balance view works (all products, 0 stock)
-- ────────────────────────────────────────────────────────────
SELECT COUNT(*) AS products_in_view,
       SUM(current_stock) AS total_stock
FROM v_warehouse_stock_balance;
-- Expected: ~75 products, total_stock = 0 (no ledger entries yet)

-- ────────────────────────────────────────────────────────────
-- 11. Full product list for review
-- ────────────────────────────────────────────────────────────
SELECT id, name, category, unit, price_list,
       array_length(scalev_product_names, 1) AS scalev_mappings
FROM warehouse_products
ORDER BY category, name;
