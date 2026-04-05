-- ============================================================
-- Warehouse Redesign — Phase 2: Seed Product Master + SKU Mapping
-- ============================================================
-- Sources:
--   1. Kartu Stock RTI BTN (Fikry) — 14 products, Dr Hyun line
--   2. Summary PPIC (Jati) — 65+ products, all brands
--   3. product_mapping (migration 062) — bonus item names from ScaleV
--
-- scalev_product_names are best-guess mappings. Editable via app.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- ROOVE BLUEBERRY line
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('ROOVE BLUEBERI 50 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Blueberry - 50 Sc','Roove Blueberry - 50 Sachet']),
  ('ROOVE BLUEBERI 20 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Blueberry - 20 Sc','Roove Blueberry - 20 Sachet']),
  ('ROOVE BLUEBERI 20 RFID', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Blueberry - 20 Sc RFID']),
  ('ROOVE BLUEBERI 10 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Blueberry - 10 Sc','Roove Blueberry - 10 Sachet']),
  ('ROOVE BLUEBERI 7 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Blueberry - 7 Sc','Roove Blueberry - 7 Sachet']),
  ('ROOVE BLUEBERI 5 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Blueberry - 5 Sc','Roove Blueberry - 5 Sachet']),
  ('ROOVE BLUEBERI 3 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Blueberry - 3 Sc','Roove Blueberry - 3 Sachet']),
  ('ROOVE BLUEBERI BONUS', 'fg', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('ROOVE BLUEBERI FG', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- ROOVE STRAWBERRY line
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('ROOVE STROBERI 20 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Strawberry - 20 Sc','Roove Strawberry - 20 Sachet']),
  ('ROOVE STROBERI BONUS', 'fg', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('ROOVE STROBERI FG', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- ROOVE KOPI line
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('ROOVE KOPI 20 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Coffee - 20 Sc','Roove Coffee - 20 Sachet','Roove Kopi - 20 Sc']),
  ('ROOVE KOPI BONUS', 'fg', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('ROOVE KOPI FG', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- ROOVE VANILA line
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('ROOVE VANILA 20 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Vanilla - 20 Sc','Roove Vanilla - 20 Sachet']),
  ('ROOVE VANILA 1 SC', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- ROOVE MIXBERIES line
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('ROOVE MIXBERIES 20 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Mixberries - 20 Sc','Roove Mixberies - 20 Sc']),
  ('ROOVE MIXBERIES 1 SC', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- ROOVE COKELAT line
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('ROOVE COKELAT 20 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Chocolate - 20 Sc','Roove Cokelat - 20 Sc']),
  ('ROOVE COKELAT 1 SC', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- ROOVE KURMA line
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('ROOVE KURMA 20 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Kurma - 20 Sc','Roove Kurma - 20 Sachet']),
  ('ROOVE KURMA BONUS', 'fg', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('ROOVE KURMA FG', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- ROOVE MIX line
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('ROOVE MIX 20 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Roove Mix - 20 Sc'])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- DR HYUN line (from Kartu Stock RTI BTN)
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('DRHYUN HIGH FIBER 30 SC', 'fg', 'box', 295000, 'RTI', 'BTN', ARRAY['Dr Hyun High Fiber - 30 Sc','Drhyun High Fiber - 30 Sc','Dr Hyun','DrHyun']),
  ('Sachet DRHYUN', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet DRHYUN - FG', 'sachet', 'pcs', 2800, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('KEMASAN CUBE DR.HYUN 30 SC', 'packaging', 'pcs', 9000, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- ALMONA line
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('ALMONA 15 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Almona - 15 Sc','Almona - 15 Sachet']),
  ('ALMONA 1 SC', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- PLUVE line
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('PLUVE 20 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Pluve - 20 Sc','Pluve - 20 Sachet']),
  ('PLUVE BONUS', 'fg', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('PLUVE FG', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- VERAZUI line
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('VERAZUI 20 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Verazui - 20 Sc','Verazui - 20 Sachet'])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- OPTIVOR, YUV, FERIVE, LAFOMY, ORELIF
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('OPTIVOR', 'fg', 'pcs', 0, 'RTI', 'BTN', ARRAY['Optivor']),
  ('YUV POWER', 'fg', 'pcs', 0, 'RTI', 'BTN', ARRAY['Yuv Power']),
  ('YUV DEO FRES', 'fg', 'pcs', 0, 'RTI', 'BTN', ARRAY['Yuv Deo Fres','Yuv Deodorant Fres']),
  ('YUV DEO LUMINANCE', 'fg', 'pcs', 0, 'RTI', 'BTN', ARRAY['Yuv Deo Luminance','Yuv Deodorant Luminance']),
  ('YUV HAIR', 'fg', 'pcs', 0, 'RTI', 'BTN', ARRAY['Yuv Hair']),
  ('FERIVE 14 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Ferive - 14 Sc','Ferive - 14 Sachet']),
  ('FERIVE 1 SC', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('LAFOMY 1 SC', 'fg', 'pcs', 0, 'RTI', 'BTN', ARRAY['Lafomy']),
  ('ORELIF 6 SC', 'fg', 'box', 0, 'RTI', 'BTN', ARRAY['Orelif - 6 Sc','Orelif - 6 Sachet']),
  ('ORELIF 1 SC', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- VEMININE / VEMININCE — MOVED TO JHN (see migration 069, 070)
-- ────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────
-- PARFUM lines — MOVED TO JHN (see migration 069, 070)
-- Kept commented for reference of original RTI seed.
-- ────────────────────────────────────────────────────────────
-- All parfum, veminine, discovery, osgard, globite products removed from RTI.
-- Parfum/Veminine → JHN (migrations 069, 070)
-- Osgard/Globite → RLB (migration 066)

-- ────────────────────────────────────────────────────────────
-- BONUS items (from Kartu Stock + product_mapping)
-- These map to ScaleV bonus product names for warehouse tracking
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('Shaker DR HYUN (HIJAU)', 'bonus', 'pcs', 5400, 'RTI', 'BTN', ARRAY['Shaker Drhyun - Hijau']),
  ('Shaker DR HYUN (PINK)', 'bonus', 'pcs', 5400, 'RTI', 'BTN', ARRAY['Shaker Drhyun - Pink']),
  ('Shaker DR HYUN (BIRU)', 'bonus', 'pcs', 5400, 'RTI', 'BTN', ARRAY['Shaker Drhyun - Biru']),
  ('Shaker DR HYUN (KUNING)', 'bonus', 'pcs', 5400, 'RTI', 'BTN', ARRAY['Shaker Drhyun - Kuning']),
  ('Shaker Mini', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY['Shaker Mini']),
  ('Shaker Roove Bulat', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY['Shaker Roove Bulat']),
  ('Shaker Almona Bulat', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY['Shaker Almona Bulat']),
  ('Shaker Pluve Bulat', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY['Shaker Pluve Bulat']),
  ('Shaker Orlando Ungu', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY['Shaker Orlando ungu']),
  ('Shaker Miami Roove', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY['Shaker Miami Roove - Biru Muda']),
  ('Goddie Bag Dr Hyun', 'bonus', 'pcs', 4300, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('Baby Gold 0,001 gr', 'bonus', 'pcs', 3900, 'RTI', 'BTN', ARRAY['Baby Gold']),
  ('Jam Tangan Roove Bulat', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY['Jam Tangan Roove Bulat']),
  ('Jam Tangan Roove Kotak', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY['Jam Tangan Roove Kotak']),
  ('Brosur Roove', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY['Brosur Roove']),
  ('KORSET M', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('KORSET L', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('KORSET XL', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('KORSET XXL', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;
