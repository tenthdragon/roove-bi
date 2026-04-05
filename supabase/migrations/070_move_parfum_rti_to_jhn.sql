-- ============================================================
-- Move misclassified RTI parfum/veminine products to JHN
-- These products have no stock in RTI and belong to JHN entity.
-- Products already exist in JHN (from 069), so just delete RTI duplicates.
-- Veminince Cusion B/L and Daily Wear: add to JHN, then delete from RTI.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Add Veminince products to JHN (not in 069)
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('VEMININCE CUSION B', 'fg', 'pcs', 0, 'JHN', 'BTN', ARRAY['Veminince Cushion B','Veminince Cusion B']),
  ('VEMININCE CUSION L', 'fg', 'pcs', 0, 'JHN', 'BTN', ARRAY['Veminince Cushion L','Veminince Cusion L']),
  ('VEMININCE DAILY WEAR', 'fg', 'pcs', 0, 'JHN', 'BTN', ARRAY['Veminince Daily Wear'])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. Delete misclassified RTI products (no stock, no ledger entries)
--    Clean up: ledger → batches → products (FK order)
-- ────────────────────────────────────────────────────────────
DELETE FROM warehouse_stock_ledger
WHERE warehouse_product_id IN (
  SELECT id FROM warehouse_products
  WHERE entity = 'RTI' AND name IN (
    'HARAM SERIES 3 ML', 'HARAM SERIES 10 ML', 'HARAM SERIES 30 ML',
    'ARABIAN MEMORIES 3 ML', 'ARABIAN MEMORIES 30 ML',
    'ARABIAN SEA 3 ML', 'ARABIAN SEA 30 ML',
    'AISHA SECRET 3 ML', 'AISHA SECRET 30 ML',
    'ADELE SECRET 3 ML', 'ADELE SECRET 30 ML',
    'ARIANA SECRET 3 ML', 'ARIANA SECRET 30 ML',
    'ARUM SECRET 3 ML', 'ARUM SECRET 30 ML',
    'DISCOVERY SET',
    'VEMININE PRIME SERUM',
    'VEMININCE CUSION B', 'VEMININCE CUSION L', 'VEMININCE DAILY WEAR',
    'OSGARD 60 ML', 'OSGARD 100 ML', 'GLOBITE 24 BUTIR'
  )
);

DELETE FROM warehouse_batches
WHERE warehouse_product_id IN (
  SELECT id FROM warehouse_products
  WHERE entity = 'RTI' AND name IN (
    'HARAM SERIES 3 ML', 'HARAM SERIES 10 ML', 'HARAM SERIES 30 ML',
    'ARABIAN MEMORIES 3 ML', 'ARABIAN MEMORIES 30 ML',
    'ARABIAN SEA 3 ML', 'ARABIAN SEA 30 ML',
    'AISHA SECRET 3 ML', 'AISHA SECRET 30 ML',
    'ADELE SECRET 3 ML', 'ADELE SECRET 30 ML',
    'ARIANA SECRET 3 ML', 'ARIANA SECRET 30 ML',
    'ARUM SECRET 3 ML', 'ARUM SECRET 30 ML',
    'DISCOVERY SET',
    'VEMININE PRIME SERUM',
    'VEMININCE CUSION B', 'VEMININCE CUSION L', 'VEMININCE DAILY WEAR',
    'OSGARD 60 ML', 'OSGARD 100 ML', 'GLOBITE 24 BUTIR'
  )
);

DELETE FROM warehouse_products
WHERE entity = 'RTI' AND name IN (
  'HARAM SERIES 3 ML', 'HARAM SERIES 10 ML', 'HARAM SERIES 30 ML',
  'ARABIAN MEMORIES 3 ML', 'ARABIAN MEMORIES 30 ML',
  'ARABIAN SEA 3 ML', 'ARABIAN SEA 30 ML',
  'AISHA SECRET 3 ML', 'AISHA SECRET 30 ML',
  'ADELE SECRET 3 ML', 'ADELE SECRET 30 ML',
  'ARIANA SECRET 3 ML', 'ARIANA SECRET 30 ML',
  'ARUM SECRET 3 ML', 'ARUM SECRET 30 ML',
  'DISCOVERY SET',
  'VEMININE PRIME SERUM',
  'VEMININCE CUSION B', 'VEMININCE CUSION L', 'VEMININCE DAILY WEAR'
);
