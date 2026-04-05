-- ============================================================
-- Fix: Remove 50 misclassified RTI products + Seed RLT BTN
-- ============================================================
-- RTI should ONLY have 14 Dr Hyun products (from Kartu Stock RTI).
-- All Roove/Almona/Pluve/Verazui/Optivor/YUV/Ferive/Lafomy/Orelif
-- and non-DrHyun bonus items were wrongly seeded under RTI from
-- PPIC summary. They belong to RLB or don't exist in any Kartu Stock.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Delete misclassified RTI products (ledger → batches → products)
-- ────────────────────────────────────────────────────────────

-- Products that should NOT be in RTI (not in Kartu Stock RTI)
DELETE FROM warehouse_stock_ledger
WHERE warehouse_product_id IN (
  SELECT id FROM warehouse_products
  WHERE entity = 'RTI' AND name IN (
    -- Roove line (all belong to RLB)
    'ROOVE BLUEBERI 50 SC', 'ROOVE BLUEBERI 20 SC', 'ROOVE BLUEBERI 20 RFID',
    'ROOVE BLUEBERI 10 SC', 'ROOVE BLUEBERI 7 SC', 'ROOVE BLUEBERI 5 SC',
    'ROOVE BLUEBERI 3 SC', 'ROOVE BLUEBERI BONUS', 'ROOVE BLUEBERI FG',
    'ROOVE STROBERI 20 SC', 'ROOVE STROBERI BONUS', 'ROOVE STROBERI FG',
    'ROOVE KOPI 20 SC', 'ROOVE KOPI BONUS', 'ROOVE KOPI FG',
    'ROOVE VANILA 20 SC', 'ROOVE VANILA 1 SC',
    'ROOVE MIXBERIES 20 SC', 'ROOVE MIXBERIES 1 SC',
    'ROOVE COKELAT 20 SC', 'ROOVE COKELAT 1 SC',
    'ROOVE KURMA 20 SC', 'ROOVE KURMA BONUS', 'ROOVE KURMA FG',
    'ROOVE MIX 20 SC',
    -- Other brands (RLB or no Kartu Stock)
    'ALMONA 15 SC', 'ALMONA 1 SC',
    'PLUVE 20 SC', 'PLUVE BONUS', 'PLUVE FG',
    'VERAZUI 20 SC',
    'OPTIVOR', 'YUV POWER', 'YUV DEO FRES', 'YUV DEO LUMINANCE', 'YUV HAIR',
    'FERIVE 14 SC', 'FERIVE 1 SC', 'LAFOMY 1 SC',
    'ORELIF 6 SC', 'ORELIF 1 SC',
    -- Bonus items that belong to RLB
    'Shaker Mini', 'Shaker Roove Bulat', 'Shaker Almona Bulat', 'Shaker Pluve Bulat',
    'Shaker Orlando Ungu', 'Shaker Miami Roove',
    'Jam Tangan Roove Bulat', 'Jam Tangan Roove Kotak', 'Brosur Roove',
    -- Osgard/Globite (already deleted in 070 but just in case)
    'OSGARD 60 ML', 'OSGARD 100 ML', 'GLOBITE 24 BUTIR'
  )
);

DELETE FROM warehouse_batches
WHERE warehouse_product_id IN (
  SELECT id FROM warehouse_products
  WHERE entity = 'RTI' AND name IN (
    'ROOVE BLUEBERI 50 SC', 'ROOVE BLUEBERI 20 SC', 'ROOVE BLUEBERI 20 RFID',
    'ROOVE BLUEBERI 10 SC', 'ROOVE BLUEBERI 7 SC', 'ROOVE BLUEBERI 5 SC',
    'ROOVE BLUEBERI 3 SC', 'ROOVE BLUEBERI BONUS', 'ROOVE BLUEBERI FG',
    'ROOVE STROBERI 20 SC', 'ROOVE STROBERI BONUS', 'ROOVE STROBERI FG',
    'ROOVE KOPI 20 SC', 'ROOVE KOPI BONUS', 'ROOVE KOPI FG',
    'ROOVE VANILA 20 SC', 'ROOVE VANILA 1 SC',
    'ROOVE MIXBERIES 20 SC', 'ROOVE MIXBERIES 1 SC',
    'ROOVE COKELAT 20 SC', 'ROOVE COKELAT 1 SC',
    'ROOVE KURMA 20 SC', 'ROOVE KURMA BONUS', 'ROOVE KURMA FG',
    'ROOVE MIX 20 SC',
    'ALMONA 15 SC', 'ALMONA 1 SC',
    'PLUVE 20 SC', 'PLUVE BONUS', 'PLUVE FG',
    'VERAZUI 20 SC',
    'OPTIVOR', 'YUV POWER', 'YUV DEO FRES', 'YUV DEO LUMINANCE', 'YUV HAIR',
    'FERIVE 14 SC', 'FERIVE 1 SC', 'LAFOMY 1 SC',
    'ORELIF 6 SC', 'ORELIF 1 SC',
    'Shaker Mini', 'Shaker Roove Bulat', 'Shaker Almona Bulat', 'Shaker Pluve Bulat',
    'Shaker Orlando Ungu', 'Shaker Miami Roove',
    'Jam Tangan Roove Bulat', 'Jam Tangan Roove Kotak', 'Brosur Roove',
    'OSGARD 60 ML', 'OSGARD 100 ML', 'GLOBITE 24 BUTIR'
  )
);

DELETE FROM warehouse_products
WHERE entity = 'RTI' AND name IN (
  'ROOVE BLUEBERI 50 SC', 'ROOVE BLUEBERI 20 SC', 'ROOVE BLUEBERI 20 RFID',
  'ROOVE BLUEBERI 10 SC', 'ROOVE BLUEBERI 7 SC', 'ROOVE BLUEBERI 5 SC',
  'ROOVE BLUEBERI 3 SC', 'ROOVE BLUEBERI BONUS', 'ROOVE BLUEBERI FG',
  'ROOVE STROBERI 20 SC', 'ROOVE STROBERI BONUS', 'ROOVE STROBERI FG',
  'ROOVE KOPI 20 SC', 'ROOVE KOPI BONUS', 'ROOVE KOPI FG',
  'ROOVE VANILA 20 SC', 'ROOVE VANILA 1 SC',
  'ROOVE MIXBERIES 20 SC', 'ROOVE MIXBERIES 1 SC',
  'ROOVE COKELAT 20 SC', 'ROOVE COKELAT 1 SC',
  'ROOVE KURMA 20 SC', 'ROOVE KURMA BONUS', 'ROOVE KURMA FG',
  'ROOVE MIX 20 SC',
  'ALMONA 15 SC', 'ALMONA 1 SC',
  'PLUVE 20 SC', 'PLUVE BONUS', 'PLUVE FG',
  'VERAZUI 20 SC',
  'OPTIVOR', 'YUV POWER', 'YUV DEO FRES', 'YUV DEO LUMINANCE', 'YUV HAIR',
  'FERIVE 14 SC', 'FERIVE 1 SC', 'LAFOMY 1 SC',
  'ORELIF 6 SC', 'ORELIF 1 SC',
  'Shaker Mini', 'Shaker Roove Bulat', 'Shaker Almona Bulat', 'Shaker Pluve Bulat',
  'Shaker Orlando Ungu', 'Shaker Miami Roove',
  'Jam Tangan Roove Bulat', 'Jam Tangan Roove Kotak', 'Brosur Roove',
  'OSGARD 60 ML', 'OSGARD 100 ML', 'GLOBITE 24 BUTIR'
);

-- ────────────────────────────────────────────────────────────
-- 2. Seed RLT BTN (4 products from Kartu Stock RLT Maret 2026)
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('GLOBITE ISI 30', 'fg', 'box', 0, 'RLT', 'BTN', ARRAY['Globite - 30','Globite 30']),
  ('JAM KABAH', 'bonus', 'pcs', 0, 'RLT', 'BTN', ARRAY[]::TEXT[]),
  ('PACKAGING VEMININE KECIL', 'packaging', 'pcs', 0, 'RLT', 'BTN', ARRAY[]::TEXT[]),
  ('PACKAGING VEMININE BESAR', 'packaging', 'pcs', 0, 'RLT', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. Verify: RTI should have exactly 14 products
-- ────────────────────────────────────────────────────────────
-- SELECT entity, COUNT(*) FROM warehouse_products GROUP BY entity ORDER BY entity;
-- Expected: RTI=14, RLB=51+, JHN=31, RLT=4
