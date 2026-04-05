-- ============================================================
-- Phase 2b: Seed RLB BTN products + initial stock for RTI & RLB
-- Source: KARTU STOCK RLB BTN - April 2026.xlsx
--         KARTU STOCK RTI BTN - APRIL 2026.xlsx
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- RLB BTN — Finished Goods
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('Roove 50 Sachet', 'fg', 'box', 620000, 'RLB', 'BTN', ARRAY['Roove Blueberry - 50 Sc','Roove Blueberry - 50 Sachet']),
  ('Roove 20 Sachet', 'fg', 'box', 295000, 'RLB', 'BTN', ARRAY['Roove Blueberry - 20 Sc','Roove Blueberry - 20 Sachet']),
  ('Roove Strawberry 20 Sachet', 'fg', 'box', 295000, 'RLB', 'BTN', ARRAY['Roove Strawberry - 20 Sc','Roove Strawberry - 20 Sachet']),
  ('Roove Coffee 20 Sachet', 'fg', 'box', 295000, 'RLB', 'BTN', ARRAY['Roove Coffee - 20 Sc','Roove Coffee - 20 Sachet','Roove Kopi - 20 Sc']),
  ('Roove Kurma 20 Sachet', 'fg', 'box', 295000, 'RLB', 'BTN', ARRAY['Roove Kurma - 20 Sc','Roove Kurma - 20 Sachet']),
  ('Roove MIX 20 Sachet', 'fg', 'box', 295000, 'RLB', 'BTN', ARRAY['Roove Mix - 20 Sc']),
  ('Roove 10 Sachet', 'fg', 'box', 185000, 'RLB', 'BTN', ARRAY['Roove Blueberry - 10 Sc','Roove Blueberry - 10 Sachet']),
  ('Pluve 20 Sachet', 'fg', 'box', 345000, 'RLB', 'BTN', ARRAY['Pluve - 20 Sc','Pluve - 20 Sachet']),
  ('YUV Clola Fresh Defense', 'fg', 'pcs', 95000, 'RLB', 'BTN', ARRAY['Yuv Deo Fres','Yuv Deodorant Fres','YUV Clola Fresh Defense']),
  ('YUV Clola Luminance Boost', 'fg', 'pcs', 95000, 'RLB', 'BTN', ARRAY['Yuv Deo Luminance','Yuv Deodorant Luminance','YUV Clola Luminance Boost']),
  ('OSGARD Oil 60 ml', 'fg', 'pcs', 75000, 'RLB', 'BTN', ARRAY['Osgard - 60ml','Osgard - 60','Osgard 60']),
  ('OSGARD Oil 100 ml', 'fg', 'pcs', 145000, 'RLB', 'BTN', ARRAY['Osgard - 100ml','Osgard - 100','Osgard 100']),
  ('GLOBITE', 'fg', 'box', 135000, 'RLB', 'BTN', ARRAY['Globite - 24','Globite 24'])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- RLB BTN — Sachet / FG mentah
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('Sachet Roove Blueberry', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Strawberry', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Vanilla', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Mixberry', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Coffee', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Coklat', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Kurma', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Pluve', 'sachet', 'pcs', 25000, 'RLB', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- RLB BTN — Bonus items
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('Shaker Roove - Florida (UNGU)', 'bonus', 'pcs', 13500, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Shaker Roove - Orlando (UNGU)', 'bonus', 'pcs', 14000, 'RLB', 'BTN', ARRAY['Shaker Orlando ungu']),
  ('Shaker Almona - Florida (HIJAU)', 'bonus', 'pcs', 13500, 'RLB', 'BTN', ARRAY['Shaker Almona Bulat']),
  ('Shaker Pluve - Miami (MERAH)', 'bonus', 'pcs', 13500, 'RLB', 'BTN', ARRAY['Shaker Pluve Bulat']),
  ('Shaker Baru (UNGU)', 'bonus', 'pcs', 7000, 'RLB', 'BTN', ARRAY['Shaker Roove Bulat']),
  ('Shaker Mini (POLOS)', 'bonus', 'pcs', 0, 'RLB', 'BTN', ARRAY['Shaker Mini']),
  ('Dompet Roove - Blue', 'bonus', 'pcs', 11000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Dompet Roove - Gray', 'bonus', 'pcs', 11000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Dompet Roove - Light Purple', 'bonus', 'pcs', 11000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Dompet Roove - Pink', 'bonus', 'pcs', 11000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Dompet Roove - Rose Red', 'bonus', 'pcs', 11000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Jam Tangan Kotak', 'bonus', 'pcs', 10770, 'RLB', 'BTN', ARRAY['Jam Tangan Roove Kotak']),
  ('Jam Tangan Bulat', 'bonus', 'pcs', 10770, 'RLB', 'BTN', ARRAY['Jam Tangan Roove Bulat']),
  ('Tumbler', 'bonus', 'pcs', 100000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Planner Book', 'bonus', 'pcs', 75000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sisir Kayu', 'bonus', 'pcs', 6000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Totebag Roove (Ungu)', 'bonus', 'pcs', 14000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Totebag Almona (Hijau)', 'bonus', 'pcs', 14000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Facemask Blueberry', 'bonus', 'pcs', 2047, 'RLB', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- RLB BTN — Packaging / Kemasan
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('Kardus Kecil (20x15x10)', 'packaging', 'pcs', 1450, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Kardus Sedang (22x20x11)', 'packaging', 'pcs', 1800, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Kardus Besar 1 (32x22x11)', 'packaging', 'pcs', 2250, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Kardus Besar 2 (32x27x26)', 'packaging', 'pcs', 8100, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Kardus Besar 3 (60x40x30)', 'packaging', 'pcs', 14000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Brosur Roove (Non Hijab A5)', 'packaging', 'pcs', 500, 'RLB', 'BTN', ARRAY['Brosur Roove']),
  ('Brosur Pluve', 'packaging', 'pcs', 0, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sticker Klaim', 'packaging', 'pcs', 200, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Kartu Ucapan Roove', 'packaging', 'pcs', 190, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Kartu Ucapan Reseller', 'packaging', 'pcs', 190, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Card Free 20sc', 'packaging', 'pcs', 190, 'RLB', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ============================================================
-- INITIAL STOCK: Create batches + ledger entries
-- Source: Kartu Stock first_day values (Maret 2026 for RTI, April 2026 for RLB)
-- ============================================================

-- Helper function for bulk initial stock loading
CREATE OR REPLACE FUNCTION _seed_initial_stock(
  p_product_name TEXT,
  p_entity TEXT,
  p_warehouse TEXT,
  p_batch_code TEXT,
  p_expired_date DATE,
  p_qty NUMERIC
) RETURNS void AS $$
DECLARE
  v_product_id INT;
  v_batch_id INT;
  v_balance NUMERIC;
BEGIN
  IF p_qty <= 0 THEN RETURN; END IF;

  SELECT id INTO v_product_id
  FROM warehouse_products
  WHERE name = p_product_name AND entity = p_entity AND warehouse = p_warehouse;

  IF v_product_id IS NULL THEN
    RAISE NOTICE 'Product not found: % (% %)', p_product_name, p_entity, p_warehouse;
    RETURN;
  END IF;

  -- Create batch
  INSERT INTO warehouse_batches (warehouse_product_id, batch_code, expired_date, initial_qty, current_qty)
  VALUES (v_product_id, p_batch_code, p_expired_date, p_qty, p_qty)
  ON CONFLICT (warehouse_product_id, batch_code) DO NOTHING
  RETURNING id INTO v_batch_id;

  IF v_batch_id IS NULL THEN RETURN; END IF;

  -- Calculate running balance
  SELECT COALESCE(SUM(quantity), 0) + p_qty INTO v_balance
  FROM warehouse_stock_ledger WHERE warehouse_product_id = v_product_id;

  -- Insert ledger entry
  INSERT INTO warehouse_stock_ledger (
    warehouse_product_id, batch_id, movement_type, quantity,
    running_balance, reference_type, notes
  ) VALUES (
    v_product_id, v_batch_id, 'IN', p_qty,
    v_balance, 'manual', 'Initial stock from Kartu Stock'
  );
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────
-- RTI BTN — Initial stock (from Kartu Stock Maret 2026)
-- ────────────────────────────────────────────────────────────
SELECT _seed_initial_stock('DRHYUN HIGH FIBER 30 SC', 'RTI', 'BTN', 'MAR-2026', '2027-06-01', 209);
SELECT _seed_initial_stock('Sachet DRHYUN', 'RTI', 'BTN', 'MAR-2026', NULL, 25);
SELECT _seed_initial_stock('KEMASAN CUBE DR.HYUN 30 SC', 'RTI', 'BTN', 'MAR-2026', NULL, 2403);
SELECT _seed_initial_stock('Shaker DR HYUN (HIJAU)', 'RTI', 'BTN', 'MAR-2026', NULL, 1519);
SELECT _seed_initial_stock('Shaker DR HYUN (PINK)', 'RTI', 'BTN', 'MAR-2026', NULL, 1281);
SELECT _seed_initial_stock('Shaker DR HYUN (BIRU)', 'RTI', 'BTN', 'MAR-2026', NULL, 1);
SELECT _seed_initial_stock('Shaker DR HYUN (KUNING)', 'RTI', 'BTN', 'MAR-2026', NULL, 8);
SELECT _seed_initial_stock('Goddie Bag Dr Hyun', 'RTI', 'BTN', 'MAR-2026', NULL, 578);
SELECT _seed_initial_stock('Baby Gold 0,001 gr', 'RTI', 'BTN', 'MAR-2026', NULL, 500);
SELECT _seed_initial_stock('KORSET M', 'RTI', 'BTN', 'MAR-2026', NULL, 17);
SELECT _seed_initial_stock('KORSET L', 'RTI', 'BTN', 'MAR-2026', NULL, 12);
SELECT _seed_initial_stock('KORSET XL', 'RTI', 'BTN', 'MAR-2026', NULL, 3);
SELECT _seed_initial_stock('KORSET XXL', 'RTI', 'BTN', 'MAR-2026', NULL, 4);

-- ────────────────────────────────────────────────────────────
-- RLB BTN — Initial stock (from Kartu Stock April 2026)
-- ────────────────────────────────────────────────────────────
-- FG
SELECT _seed_initial_stock('Roove 20 Sachet', 'RLB', 'BTN', 'APR-2026', '2028-01-01', 8940);
SELECT _seed_initial_stock('Roove Strawberry 20 Sachet', 'RLB', 'BTN', 'APR-2026', '2028-01-01', 1318);
SELECT _seed_initial_stock('Roove Coffee 20 Sachet', 'RLB', 'BTN', 'APR-2026', '2028-01-02', 1092);
SELECT _seed_initial_stock('Roove Kurma 20 Sachet', 'RLB', 'BTN', 'APR-2026', '2027-12-01', 729);
SELECT _seed_initial_stock('Roove MIX 20 Sachet', 'RLB', 'BTN', 'APR-2026', '2027-06-01', 18);
SELECT _seed_initial_stock('Roove 10 Sachet', 'RLB', 'BTN', 'APR-2026', '2028-01-02', 833);
SELECT _seed_initial_stock('Pluve 20 Sachet', 'RLB', 'BTN', 'APR-2026', '2027-05-01', 612);
SELECT _seed_initial_stock('YUV Clola Fresh Defense', 'RLB', 'BTN', 'APR-2026', '2027-04-01', 1);
SELECT _seed_initial_stock('YUV Clola Luminance Boost', 'RLB', 'BTN', 'APR-2026', '2027-04-01', 40);
SELECT _seed_initial_stock('OSGARD Oil 60 ml', 'RLB', 'BTN', 'APR-2026', '2027-08-01', 2154);
SELECT _seed_initial_stock('OSGARD Oil 100 ml', 'RLB', 'BTN', 'APR-2026', '2027-06-01', 1840);
SELECT _seed_initial_stock('GLOBITE', 'RLB', 'BTN', 'APR-2026', '2026-08-08', 8991);
-- Sachet
SELECT _seed_initial_stock('Sachet Roove Blueberry', 'RLB', 'BTN', 'APR-2026', '2028-01-02', 31130);
SELECT _seed_initial_stock('Sachet Roove Strawberry', 'RLB', 'BTN', 'APR-2026', '2028-01-03', 5498);
SELECT _seed_initial_stock('Sachet Roove Coffee', 'RLB', 'BTN', 'APR-2026', '2027-12-01', 4216);
SELECT _seed_initial_stock('Sachet Roove Coklat', 'RLB', 'BTN', 'APR-2026', '2026-04-01', 2);
SELECT _seed_initial_stock('Sachet Roove Kurma', 'RLB', 'BTN', 'APR-2026', '2027-12-01', 3830);
SELECT _seed_initial_stock('Sachet Pluve', 'RLB', 'BTN', 'APR-2026', '2027-03-01', 613);
-- Bonus
SELECT _seed_initial_stock('Shaker Almona - Florida (HIJAU)', 'RLB', 'BTN', 'APR-2026', NULL, 32);
SELECT _seed_initial_stock('Shaker Pluve - Miami (MERAH)', 'RLB', 'BTN', 'APR-2026', NULL, 370);
SELECT _seed_initial_stock('Shaker Baru (UNGU)', 'RLB', 'BTN', 'APR-2026', NULL, 21253);
SELECT _seed_initial_stock('Shaker Mini (POLOS)', 'RLB', 'BTN', 'APR-2026', NULL, 2620);
SELECT _seed_initial_stock('Dompet Roove - Blue', 'RLB', 'BTN', 'APR-2026', NULL, 11);
SELECT _seed_initial_stock('Dompet Roove - Gray', 'RLB', 'BTN', 'APR-2026', NULL, 18);
SELECT _seed_initial_stock('Dompet Roove - Light Purple', 'RLB', 'BTN', 'APR-2026', NULL, 10);
SELECT _seed_initial_stock('Dompet Roove - Pink', 'RLB', 'BTN', 'APR-2026', NULL, 17);
SELECT _seed_initial_stock('Dompet Roove - Rose Red', 'RLB', 'BTN', 'APR-2026', NULL, 11);
SELECT _seed_initial_stock('Jam Tangan Bulat', 'RLB', 'BTN', 'APR-2026', NULL, 538);
SELECT _seed_initial_stock('Tumbler', 'RLB', 'BTN', 'APR-2026', NULL, 7);
SELECT _seed_initial_stock('Planner Book', 'RLB', 'BTN', 'APR-2026', NULL, 1);
SELECT _seed_initial_stock('Sisir Kayu', 'RLB', 'BTN', 'APR-2026', NULL, 5);
SELECT _seed_initial_stock('Totebag Roove (Ungu)', 'RLB', 'BTN', 'APR-2026', NULL, 148);
SELECT _seed_initial_stock('Totebag Almona (Hijau)', 'RLB', 'BTN', 'APR-2026', NULL, 168);
SELECT _seed_initial_stock('Facemask Blueberry', 'RLB', 'BTN', 'APR-2026', '2026-08-01', 1);
-- Packaging
SELECT _seed_initial_stock('Kardus Kecil (20x15x10)', 'RLB', 'BTN', 'APR-2026', NULL, 5834);
SELECT _seed_initial_stock('Kardus Sedang (22x20x11)', 'RLB', 'BTN', 'APR-2026', NULL, 3705);
SELECT _seed_initial_stock('Kardus Besar 1 (32x22x11)', 'RLB', 'BTN', 'APR-2026', NULL, 14144);
SELECT _seed_initial_stock('Brosur Roove (Non Hijab A5)', 'RLB', 'BTN', 'APR-2026', NULL, 60525);
SELECT _seed_initial_stock('Brosur Pluve', 'RLB', 'BTN', 'APR-2026', NULL, 4739);
SELECT _seed_initial_stock('Sticker Klaim', 'RLB', 'BTN', 'APR-2026', NULL, 113062);
SELECT _seed_initial_stock('Card Free 20sc', 'RLB', 'BTN', 'APR-2026', NULL, 60928);

-- Cleanup helper
DROP FUNCTION _seed_initial_stock;
