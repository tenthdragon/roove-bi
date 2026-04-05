-- ============================================================
-- FULL RESEED: Wipe all warehouse data and re-insert from
-- the 4 Kartu Stock Excel files (RTI, RLB, JHN, RLT).
-- This replaces all previous partial seeds (065, 066, 069, 070, 072).
-- ============================================================

-- Clean slate (order: ledger → batches → products)
DELETE FROM warehouse_stock_ledger;
DELETE FROM warehouse_batches;
DELETE FROM warehouse_products;

-- ============================================================
-- RTI BTN — 14 products (Kartu Stock RTI, Summary Maret 2026)
-- ============================================================
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('DRHYUN HIGH FIBER 30 SC', 'fg', 'box', 295000, 'RTI', 'BTN', ARRAY['Dr Hyun High Fiber - 30 Sc','Drhyun High Fiber - 30 Sc','Dr Hyun','DrHyun']),
  ('Sachet DRHYUN', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet DRHYUN - FG', 'sachet', 'pcs', 2800, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('KEMASAN CUBE DR.HYUN 30 SC', 'packaging', 'pcs', 9000, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('Shaker DR HYUN (HIJAU)', 'bonus', 'pcs', 5400, 'RTI', 'BTN', ARRAY['Shaker Drhyun - Hijau']),
  ('Shaker DR HYUN (PINK)', 'bonus', 'pcs', 5400, 'RTI', 'BTN', ARRAY['Shaker Drhyun - Pink']),
  ('Shaker DR HYUN (BIRU)', 'bonus', 'pcs', 5400, 'RTI', 'BTN', ARRAY['Shaker Drhyun - Biru']),
  ('Shaker DR HYUN (KUNING)', 'bonus', 'pcs', 5400, 'RTI', 'BTN', ARRAY['Shaker Drhyun - Kuning']),
  ('Goddie Bag Dr Hyun', 'bonus', 'pcs', 4300, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('Baby Gold 0,001 gr', 'bonus', 'pcs', 3900, 'RTI', 'BTN', ARRAY['Baby Gold']),
  ('KORSET M', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('KORSET L', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('KORSET XL', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('KORSET XXL', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]);

-- ============================================================
-- RLB BTN — 54 products (Kartu Stock RLB, Summary April 2026)
-- ============================================================
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  -- FG
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
  ('GLOBITE', 'fg', 'box', 135000, 'RLB', 'BTN', ARRAY['Globite - 24','Globite 24']),
  -- Sachet
  ('Sachet Roove Blueberry', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Strawberry', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Vanilla', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Mixberry', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Coffee', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Coklat', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Kurma', 'sachet', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Pluve', 'sachet', 'pcs', 25000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  -- Bonus
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
  ('Facemask Blueberry', 'bonus', 'pcs', 2047, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  -- Packaging
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
  ('Card Free 20sc', 'packaging', 'pcs', 190, 'RLB', 'BTN', ARRAY[]::TEXT[]);

-- ============================================================
-- JHN BTN — 31 products (Kartu Stock JHN, Summary April 2026)
-- ============================================================
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('VEMININE PRIME Serum', 'fg', 'pcs', 150000, 'JHN', 'BTN', ARRAY['Veminine Prime Serum']),
  ('VEMININCE CUSION B', 'fg', 'pcs', 0, 'JHN', 'BTN', ARRAY['Veminince Cushion B','Veminince Cusion B']),
  ('VEMININCE CUSION L', 'fg', 'pcs', 0, 'JHN', 'BTN', ARRAY['Veminince Cushion L','Veminince Cusion L']),
  ('VEMININCE DAILY WEAR', 'fg', 'pcs', 0, 'JHN', 'BTN', ARRAY['Veminince Daily Wear']),
  ('Purvu - Haram Memories 3 ml', 'fg', 'pcs', 45000, 'JHN', 'BTN', ARRAY['Haram Series - 3ml','Haram Series 3','Purvu Haram Memories 3ml']),
  ('Purvu - Haram Memories 10 ml', 'fg', 'pcs', 100000, 'JHN', 'BTN', ARRAY['Haram Series - 10ml','Haram Series 10','Purvu Haram Memories 10ml']),
  ('Purvu - Haram Memories 30 ml', 'fg', 'pcs', 145000, 'JHN', 'BTN', ARRAY['Haram Series - 30ml','Haram Series 30','Purvu Haram Memories 30ml']),
  ('Purvu - Arabian Memories 3 ml', 'fg', 'pcs', 40000, 'JHN', 'BTN', ARRAY['Arabian Memories - 3ml','Arabian Memories 3']),
  ('Purvu - Arabian Memories 30 ml', 'fg', 'pcs', 155000, 'JHN', 'BTN', ARRAY['Arabian Memories - 30ml','Arabian Memories 30']),
  ('Purvu - Mediterranean Sea 3 ml', 'fg', 'pcs', 40000, 'JHN', 'BTN', ARRAY['Arabian Sea - 3ml','Arabian Sea 3','Mediterranean Sea 3ml']),
  ('Purvu - Mediterranean Sea 30 ml', 'fg', 'pcs', 155000, 'JHN', 'BTN', ARRAY['Arabian Sea - 30ml','Arabian Sea 30','Mediterranean Sea 30ml']),
  ('Purvu - TS Aisha 3 ml', 'fg', 'pcs', 40000, 'JHN', 'BTN', ARRAY['Aisha Secret - 3ml','Aisha Secret 3']),
  ('Purvu - TS Adele 3 ml', 'fg', 'pcs', 40000, 'JHN', 'BTN', ARRAY['Adele Secret - 3ml','Adele Secret 3']),
  ('Purvu - TS Ariana 3 ml', 'fg', 'pcs', 40000, 'JHN', 'BTN', ARRAY['Ariana Secret - 3ml','Ariana Secret 3']),
  ('Purvu - TS Arum 3 ml', 'fg', 'pcs', 40000, 'JHN', 'BTN', ARRAY['Arum Secret - 3ml','Arum Secret 3']),
  ('Purvu - TS Aisha 50 ml', 'fg', 'pcs', 250000, 'JHN', 'BTN', ARRAY['Aisha Secret - 50ml','Aisha Secret 50']),
  ('Purvu - TS Adele 50 ml', 'fg', 'pcs', 250000, 'JHN', 'BTN', ARRAY['Adele Secret - 50ml','Adele Secret 50']),
  ('Purvu - TS Ariana 50 ml', 'fg', 'pcs', 250000, 'JHN', 'BTN', ARRAY['Ariana Secret - 50ml','Ariana Secret 50']),
  ('Purvu - TS Arum 50 ml', 'fg', 'pcs', 250000, 'JHN', 'BTN', ARRAY['Arum Secret - 50ml','Arum Secret 50']),
  ('Purvu - Discovery Set TS 5 ml', 'fg', 'pcs', 185000, 'JHN', 'BTN', ARRAY['Discovery Set','Discovery']),
  ('Discovery TS Aisha 5 ml', 'fg', 'pcs', 46250, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('Discovery TS Adele 5 ml', 'fg', 'pcs', 46250, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('Discovery TS Ariana 5 ml', 'fg', 'pcs', 46250, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('Discovery TS Arum 5 ml', 'fg', 'pcs', 46250, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('Calmara Matcha 20 sc', 'fg', 'box', 131000, 'JHN', 'BTN', ARRAY['Calmara Matcha - 20 Sc','Calmara Matcha - 20 Sachet']),
  ('Calmara Matcha 5 sc', 'fg', 'box', 79999, 'JHN', 'BTN', ARRAY['Calmara Matcha - 5 Sc','Calmara Matcha - 5 Sachet']),
  ('Calmara Matcha 1 sc', 'sachet', 'pcs', 16000, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('SACHET CALMARA MATCHA', 'sachet', 'pcs', 0, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('Pouch - Calmara Matcha 20', 'packaging', 'pcs', 0, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('Kardus Kecil JHN (20x15x10)', 'packaging', 'pcs', 1450, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('Kardus Besar 1 JHN (32x22x11)', 'packaging', 'pcs', 2250, 'JHN', 'BTN', ARRAY[]::TEXT[]);

-- ============================================================
-- RLT BTN — 4 products (Kartu Stock RLT, Summary Maret 2026)
-- ============================================================
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('GLOBITE ISI 30', 'fg', 'box', 135000, 'RLT', 'BTN', ARRAY['Globite - 30','Globite 30']),
  ('JAM KA''BAH', 'bonus', 'pcs', 1600000, 'RLT', 'BTN', ARRAY[]::TEXT[]),
  ('PACKAGING VEMININE KECIL', 'packaging', 'pcs', 2900, 'RLT', 'BTN', ARRAY[]::TEXT[]),
  ('PACKAGING VEMININE BESAR', 'packaging', 'pcs', 4600, 'RLT', 'BTN', ARRAY[]::TEXT[]);

-- ============================================================
-- INITIAL STOCK from Kartu Stock first_day values
-- ============================================================

CREATE OR REPLACE FUNCTION _seed_stock(
  p_name TEXT, p_entity TEXT, p_wh TEXT,
  p_batch TEXT, p_exp DATE, p_qty NUMERIC
) RETURNS void AS $$
DECLARE v_pid INT; v_bid INT; v_bal NUMERIC;
BEGIN
  IF p_qty <= 0 OR p_qty IS NULL THEN RETURN; END IF;
  SELECT id INTO v_pid FROM warehouse_products
    WHERE name = p_name AND entity = p_entity AND warehouse = p_wh;
  IF v_pid IS NULL THEN RAISE NOTICE 'NOT FOUND: % [%-%]', p_name, p_wh, p_entity; RETURN; END IF;

  INSERT INTO warehouse_batches (warehouse_product_id, batch_code, expired_date, initial_qty, current_qty)
  VALUES (v_pid, p_batch, p_exp, p_qty, p_qty)
  ON CONFLICT (warehouse_product_id, batch_code) DO NOTHING
  RETURNING id INTO v_bid;
  IF v_bid IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(quantity), 0) + p_qty INTO v_bal
  FROM warehouse_stock_ledger WHERE warehouse_product_id = v_pid;

  INSERT INTO warehouse_stock_ledger (
    warehouse_product_id, batch_id, movement_type, quantity,
    running_balance, reference_type, notes
  ) VALUES (v_pid, v_bid, 'IN', p_qty, v_bal, 'manual', 'Initial stock from Kartu Stock');
END;
$$ LANGUAGE plpgsql;

-- ── RTI BTN (Maret 2026) ──
SELECT _seed_stock('DRHYUN HIGH FIBER 30 SC', 'RTI', 'BTN', 'MAR-2026', '2027-06-01', 209);
SELECT _seed_stock('Sachet DRHYUN', 'RTI', 'BTN', 'MAR-2026', NULL, 25);
SELECT _seed_stock('KEMASAN CUBE DR.HYUN 30 SC', 'RTI', 'BTN', 'MAR-2026', NULL, 2403);
SELECT _seed_stock('Shaker DR HYUN (HIJAU)', 'RTI', 'BTN', 'MAR-2026', NULL, 1519);
SELECT _seed_stock('Shaker DR HYUN (PINK)', 'RTI', 'BTN', 'MAR-2026', NULL, 1281);
SELECT _seed_stock('Shaker DR HYUN (BIRU)', 'RTI', 'BTN', 'MAR-2026', NULL, 1);
SELECT _seed_stock('Shaker DR HYUN (KUNING)', 'RTI', 'BTN', 'MAR-2026', NULL, 8);
SELECT _seed_stock('Goddie Bag Dr Hyun', 'RTI', 'BTN', 'MAR-2026', NULL, 578);
SELECT _seed_stock('Baby Gold 0,001 gr', 'RTI', 'BTN', 'MAR-2026', NULL, 500);
SELECT _seed_stock('KORSET M', 'RTI', 'BTN', 'MAR-2026', NULL, 17);
SELECT _seed_stock('KORSET L', 'RTI', 'BTN', 'MAR-2026', NULL, 12);
SELECT _seed_stock('KORSET XL', 'RTI', 'BTN', 'MAR-2026', NULL, 3);
SELECT _seed_stock('KORSET XXL', 'RTI', 'BTN', 'MAR-2026', NULL, 4);

-- ── RLB BTN (April 2026) ──
SELECT _seed_stock('Roove 20 Sachet', 'RLB', 'BTN', 'APR-2026', '2028-01-01', 8940);
SELECT _seed_stock('Roove Strawberry 20 Sachet', 'RLB', 'BTN', 'APR-2026', '2028-01-01', 1318);
SELECT _seed_stock('Roove Coffee 20 Sachet', 'RLB', 'BTN', 'APR-2026', '2028-01-02', 1092);
SELECT _seed_stock('Roove Kurma 20 Sachet', 'RLB', 'BTN', 'APR-2026', '2027-12-01', 729);
SELECT _seed_stock('Roove MIX 20 Sachet', 'RLB', 'BTN', 'APR-2026', '2027-06-01', 18);
SELECT _seed_stock('Roove 10 Sachet', 'RLB', 'BTN', 'APR-2026', '2028-01-02', 833);
SELECT _seed_stock('Pluve 20 Sachet', 'RLB', 'BTN', 'APR-2026', '2027-05-01', 612);
SELECT _seed_stock('YUV Clola Fresh Defense', 'RLB', 'BTN', 'APR-2026', '2027-04-01', 1);
SELECT _seed_stock('YUV Clola Luminance Boost', 'RLB', 'BTN', 'APR-2026', '2027-04-01', 40);
SELECT _seed_stock('OSGARD Oil 60 ml', 'RLB', 'BTN', 'APR-2026', '2027-08-01', 2154);
SELECT _seed_stock('OSGARD Oil 100 ml', 'RLB', 'BTN', 'APR-2026', '2027-06-01', 1840);
SELECT _seed_stock('GLOBITE', 'RLB', 'BTN', 'APR-2026', '2026-08-08', 8991);
SELECT _seed_stock('Sachet Roove Blueberry', 'RLB', 'BTN', 'APR-2026', '2028-01-02', 31130);
SELECT _seed_stock('Sachet Roove Strawberry', 'RLB', 'BTN', 'APR-2026', '2028-01-03', 5498);
SELECT _seed_stock('Sachet Roove Coffee', 'RLB', 'BTN', 'APR-2026', '2027-12-01', 4216);
SELECT _seed_stock('Sachet Roove Coklat', 'RLB', 'BTN', 'APR-2026', '2026-04-01', 2);
SELECT _seed_stock('Sachet Roove Kurma', 'RLB', 'BTN', 'APR-2026', '2027-12-01', 3830);
SELECT _seed_stock('Sachet Pluve', 'RLB', 'BTN', 'APR-2026', '2027-03-01', 613);
SELECT _seed_stock('Shaker Almona - Florida (HIJAU)', 'RLB', 'BTN', 'APR-2026', NULL, 32);
SELECT _seed_stock('Shaker Pluve - Miami (MERAH)', 'RLB', 'BTN', 'APR-2026', NULL, 370);
SELECT _seed_stock('Shaker Baru (UNGU)', 'RLB', 'BTN', 'APR-2026', NULL, 21253);
SELECT _seed_stock('Shaker Mini (POLOS)', 'RLB', 'BTN', 'APR-2026', NULL, 2620);
SELECT _seed_stock('Dompet Roove - Blue', 'RLB', 'BTN', 'APR-2026', NULL, 11);
SELECT _seed_stock('Dompet Roove - Gray', 'RLB', 'BTN', 'APR-2026', NULL, 18);
SELECT _seed_stock('Dompet Roove - Light Purple', 'RLB', 'BTN', 'APR-2026', NULL, 10);
SELECT _seed_stock('Dompet Roove - Pink', 'RLB', 'BTN', 'APR-2026', NULL, 17);
SELECT _seed_stock('Dompet Roove - Rose Red', 'RLB', 'BTN', 'APR-2026', NULL, 11);
SELECT _seed_stock('Jam Tangan Bulat', 'RLB', 'BTN', 'APR-2026', NULL, 538);
SELECT _seed_stock('Tumbler', 'RLB', 'BTN', 'APR-2026', NULL, 7);
SELECT _seed_stock('Planner Book', 'RLB', 'BTN', 'APR-2026', NULL, 1);
SELECT _seed_stock('Sisir Kayu', 'RLB', 'BTN', 'APR-2026', NULL, 5);
SELECT _seed_stock('Totebag Roove (Ungu)', 'RLB', 'BTN', 'APR-2026', NULL, 148);
SELECT _seed_stock('Totebag Almona (Hijau)', 'RLB', 'BTN', 'APR-2026', NULL, 168);
SELECT _seed_stock('Facemask Blueberry', 'RLB', 'BTN', 'APR-2026', '2026-08-01', 1);
SELECT _seed_stock('Kardus Kecil (20x15x10)', 'RLB', 'BTN', 'APR-2026', NULL, 5834);
SELECT _seed_stock('Kardus Sedang (22x20x11)', 'RLB', 'BTN', 'APR-2026', NULL, 3705);
SELECT _seed_stock('Kardus Besar 1 (32x22x11)', 'RLB', 'BTN', 'APR-2026', NULL, 14144);
SELECT _seed_stock('Brosur Roove (Non Hijab A5)', 'RLB', 'BTN', 'APR-2026', NULL, 60525);
SELECT _seed_stock('Brosur Pluve', 'RLB', 'BTN', 'APR-2026', NULL, 4739);
SELECT _seed_stock('Sticker Klaim', 'RLB', 'BTN', 'APR-2026', NULL, 113062);
SELECT _seed_stock('Card Free 20sc', 'RLB', 'BTN', 'APR-2026', NULL, 60928);

-- ── JHN BTN (April 2026) ──
SELECT _seed_stock('VEMININE PRIME Serum', 'JHN', 'BTN', 'APR-2026', '2026-06-01', 460);
SELECT _seed_stock('Purvu - Haram Memories 10 ml', 'JHN', 'BTN', 'APR-2026', '2029-07-01', 139);
SELECT _seed_stock('Purvu - Arabian Memories 3 ml', 'JHN', 'BTN', 'APR-2026', NULL, 238);
SELECT _seed_stock('Purvu - Arabian Memories 30 ml', 'JHN', 'BTN', 'APR-2026', NULL, 170);
SELECT _seed_stock('Purvu - Mediterranean Sea 3 ml', 'JHN', 'BTN', 'APR-2026', NULL, 218);
SELECT _seed_stock('Purvu - Mediterranean Sea 30 ml', 'JHN', 'BTN', 'APR-2026', NULL, 211);
SELECT _seed_stock('Purvu - TS Aisha 3 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 212);
SELECT _seed_stock('Purvu - TS Adele 3 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 72);
SELECT _seed_stock('Purvu - TS Ariana 3 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 180);
SELECT _seed_stock('Purvu - TS Arum 3 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 169);
SELECT _seed_stock('Purvu - TS Aisha 50 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 185);
SELECT _seed_stock('Purvu - TS Adele 50 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 72);
SELECT _seed_stock('Purvu - TS Ariana 50 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 210);
SELECT _seed_stock('Purvu - TS Arum 50 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 127);
SELECT _seed_stock('Purvu - Discovery Set TS 5 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 9);
SELECT _seed_stock('Discovery TS Aisha 5 ml', 'JHN', 'BTN', 'APR-2026', NULL, 3);
SELECT _seed_stock('Discovery TS Adele 5 ml', 'JHN', 'BTN', 'APR-2026', NULL, 4);
SELECT _seed_stock('Discovery TS Ariana 5 ml', 'JHN', 'BTN', 'APR-2026', NULL, 3);
SELECT _seed_stock('Discovery TS Arum 5 ml', 'JHN', 'BTN', 'APR-2026', NULL, 3);
SELECT _seed_stock('Calmara Matcha 20 sc', 'JHN', 'BTN', 'APR-2026', '2027-09-01', 162);
SELECT _seed_stock('Calmara Matcha 5 sc', 'JHN', 'BTN', 'APR-2026', '2027-09-01', 169);
SELECT _seed_stock('Calmara Matcha 1 sc', 'JHN', 'BTN', 'APR-2026', '2027-09-01', 106);
SELECT _seed_stock('SACHET CALMARA MATCHA', 'JHN', 'BTN', 'APR-2026', NULL, 43042);
SELECT _seed_stock('Pouch - Calmara Matcha 20', 'JHN', 'BTN', 'APR-2026', NULL, 8428);
SELECT _seed_stock('Kardus Besar 1 JHN (32x22x11)', 'JHN', 'BTN', 'APR-2026', NULL, 214);

-- ── RLT BTN (Maret 2026) ──
SELECT _seed_stock('JAM KA''BAH', 'RLT', 'BTN', 'MAR-2026', NULL, 3);

-- Cleanup
DROP FUNCTION _seed_stock;

-- ============================================================
-- VERIFY
-- ============================================================
-- SELECT entity, COUNT(*) as products FROM warehouse_products GROUP BY entity ORDER BY entity;
-- Expected: JHN=31, RLB=54, RLT=4, RTI=14 (total=103)
--
-- SELECT entity, COUNT(*) as batches, SUM(current_qty) as total_stock
-- FROM warehouse_batches wb
-- JOIN warehouse_products wp ON wp.id = wb.warehouse_product_id
-- GROUP BY entity ORDER BY entity;
