-- ============================================================
-- Seed JHN BTN products + initial stock
-- Source: KARTU STOCK JHN BTN - APRIL 2026.xlsx
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- JHN BTN — Finished Goods
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  -- Veminine
  ('VEMININE PRIME Serum', 'fg', 'pcs', 150000, 'JHN', 'BTN', ARRAY['Veminine Prime Serum']),
  -- Purvu - Haram Memories
  ('Purvu - Haram Memories 3 ml', 'fg', 'pcs', 45000, 'JHN', 'BTN', ARRAY['Haram Series - 3ml','Haram Series 3','Purvu Haram Memories 3ml']),
  ('Purvu - Haram Memories 10 ml', 'fg', 'pcs', 100000, 'JHN', 'BTN', ARRAY['Haram Series - 10ml','Haram Series 10','Purvu Haram Memories 10ml']),
  ('Purvu - Haram Memories 30 ml', 'fg', 'pcs', 145000, 'JHN', 'BTN', ARRAY['Haram Series - 30ml','Haram Series 30','Purvu Haram Memories 30ml']),
  -- Purvu - Arabian Memories
  ('Purvu - Arabian Memories 3 ml', 'fg', 'pcs', 40000, 'JHN', 'BTN', ARRAY['Arabian Memories - 3ml','Arabian Memories 3']),
  ('Purvu - Arabian Memories 30 ml', 'fg', 'pcs', 155000, 'JHN', 'BTN', ARRAY['Arabian Memories - 30ml','Arabian Memories 30']),
  -- Purvu - Mediterranean Sea
  ('Purvu - Mediterranean Sea 3 ml', 'fg', 'pcs', 40000, 'JHN', 'BTN', ARRAY['Arabian Sea - 3ml','Arabian Sea 3','Mediterranean Sea 3ml']),
  ('Purvu - Mediterranean Sea 30 ml', 'fg', 'pcs', 155000, 'JHN', 'BTN', ARRAY['Arabian Sea - 30ml','Arabian Sea 30','Mediterranean Sea 30ml']),
  -- Purvu - The Secret (TS) 3ml
  ('Purvu - TS Aisha 3 ml', 'fg', 'pcs', 40000, 'JHN', 'BTN', ARRAY['Aisha Secret - 3ml','Aisha Secret 3']),
  ('Purvu - TS Adele 3 ml', 'fg', 'pcs', 40000, 'JHN', 'BTN', ARRAY['Adele Secret - 3ml','Adele Secret 3']),
  ('Purvu - TS Ariana 3 ml', 'fg', 'pcs', 40000, 'JHN', 'BTN', ARRAY['Ariana Secret - 3ml','Ariana Secret 3']),
  ('Purvu - TS Arum 3 ml', 'fg', 'pcs', 40000, 'JHN', 'BTN', ARRAY['Arum Secret - 3ml','Arum Secret 3']),
  -- Purvu - The Secret (TS) 50ml
  ('Purvu - TS Aisha 50 ml', 'fg', 'pcs', 250000, 'JHN', 'BTN', ARRAY['Aisha Secret - 50ml','Aisha Secret 50']),
  ('Purvu - TS Adele 50 ml', 'fg', 'pcs', 250000, 'JHN', 'BTN', ARRAY['Adele Secret - 50ml','Adele Secret 50']),
  ('Purvu - TS Ariana 50 ml', 'fg', 'pcs', 250000, 'JHN', 'BTN', ARRAY['Ariana Secret - 50ml','Ariana Secret 50']),
  ('Purvu - TS Arum 50 ml', 'fg', 'pcs', 250000, 'JHN', 'BTN', ARRAY['Arum Secret - 50ml','Arum Secret 50']),
  -- Discovery Sets
  ('Purvu - Discovery Set TS 5 ml', 'fg', 'pcs', 185000, 'JHN', 'BTN', ARRAY['Discovery Set','Discovery']),
  ('Discovery TS Aisha 5 ml', 'fg', 'pcs', 46250, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('Discovery TS Adele 5 ml', 'fg', 'pcs', 46250, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('Discovery TS Ariana 5 ml', 'fg', 'pcs', 46250, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('Discovery TS Arum 5 ml', 'fg', 'pcs', 46250, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  -- Calmara
  ('Calmara Matcha 20 sc', 'fg', 'box', 131000, 'JHN', 'BTN', ARRAY['Calmara Matcha - 20 Sc','Calmara Matcha - 20 Sachet']),
  ('Calmara Matcha 5 sc', 'fg', 'box', 79999, 'JHN', 'BTN', ARRAY['Calmara Matcha - 5 Sc','Calmara Matcha - 5 Sachet']),
  ('Calmara Matcha 1 sc', 'sachet', 'pcs', 16000, 'JHN', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- JHN BTN — Sachet / Kemasan
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('SACHET CALMARA MATCHA', 'sachet', 'pcs', 0, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('Pouch - Calmara Matcha 20', 'packaging', 'pcs', 0, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('Kardus Kecil JHN (20x15x10)', 'packaging', 'pcs', 1450, 'JHN', 'BTN', ARRAY[]::TEXT[]),
  ('Kardus Besar 1 JHN (32x22x11)', 'packaging', 'pcs', 2250, 'JHN', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ============================================================
-- INITIAL STOCK from Kartu Stock April 2026
-- ============================================================

CREATE OR REPLACE FUNCTION _seed_jhn_stock(
  p_name TEXT, p_entity TEXT, p_warehouse TEXT,
  p_batch TEXT, p_exp DATE, p_qty NUMERIC
) RETURNS void AS $$
DECLARE
  v_pid INT; v_bid INT; v_bal NUMERIC;
BEGIN
  IF p_qty <= 0 THEN RETURN; END IF;
  SELECT id INTO v_pid FROM warehouse_products
    WHERE name = p_name AND entity = p_entity AND warehouse = p_warehouse;
  IF v_pid IS NULL THEN RAISE NOTICE 'Not found: %', p_name; RETURN; END IF;

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

-- FG
SELECT _seed_jhn_stock('VEMININE PRIME Serum', 'JHN', 'BTN', 'APR-2026', '2026-06-01', 460);
SELECT _seed_jhn_stock('Purvu - Haram Memories 10 ml', 'JHN', 'BTN', 'APR-2026', '2029-07-01', 139);
SELECT _seed_jhn_stock('Purvu - Arabian Memories 3 ml', 'JHN', 'BTN', 'APR-2026', NULL, 238);
SELECT _seed_jhn_stock('Purvu - Arabian Memories 30 ml', 'JHN', 'BTN', 'APR-2026', NULL, 170);
SELECT _seed_jhn_stock('Purvu - Mediterranean Sea 3 ml', 'JHN', 'BTN', 'APR-2026', NULL, 218);
SELECT _seed_jhn_stock('Purvu - Mediterranean Sea 30 ml', 'JHN', 'BTN', 'APR-2026', NULL, 211);
SELECT _seed_jhn_stock('Purvu - TS Aisha 3 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 212);
SELECT _seed_jhn_stock('Purvu - TS Adele 3 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 72);
SELECT _seed_jhn_stock('Purvu - TS Ariana 3 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 180);
SELECT _seed_jhn_stock('Purvu - TS Arum 3 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 169);
SELECT _seed_jhn_stock('Purvu - TS Aisha 50 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 185);
SELECT _seed_jhn_stock('Purvu - TS Adele 50 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 72);
SELECT _seed_jhn_stock('Purvu - TS Ariana 50 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 210);
SELECT _seed_jhn_stock('Purvu - TS Arum 50 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 127);
SELECT _seed_jhn_stock('Purvu - Discovery Set TS 5 ml', 'JHN', 'BTN', 'APR-2026', '2029-08-01', 9);
SELECT _seed_jhn_stock('Discovery TS Aisha 5 ml', 'JHN', 'BTN', 'APR-2026', NULL, 3);
SELECT _seed_jhn_stock('Discovery TS Adele 5 ml', 'JHN', 'BTN', 'APR-2026', NULL, 4);
SELECT _seed_jhn_stock('Discovery TS Ariana 5 ml', 'JHN', 'BTN', 'APR-2026', NULL, 3);
SELECT _seed_jhn_stock('Discovery TS Arum 5 ml', 'JHN', 'BTN', 'APR-2026', NULL, 3);
-- Calmara
SELECT _seed_jhn_stock('Calmara Matcha 20 sc', 'JHN', 'BTN', 'APR-2026', '2027-09-01', 162);
SELECT _seed_jhn_stock('Calmara Matcha 5 sc', 'JHN', 'BTN', 'APR-2026', '2027-09-01', 169);
SELECT _seed_jhn_stock('Calmara Matcha 1 sc', 'JHN', 'BTN', 'APR-2026', '2027-09-01', 106);
-- Sachet / Packaging
SELECT _seed_jhn_stock('SACHET CALMARA MATCHA', 'JHN', 'BTN', 'APR-2026', NULL, 43042);
SELECT _seed_jhn_stock('Pouch - Calmara Matcha 20', 'JHN', 'BTN', 'APR-2026', NULL, 8428);
SELECT _seed_jhn_stock('Kardus Besar 1 JHN (32x22x11)', 'JHN', 'BTN', 'APR-2026', NULL, 214);

-- Cleanup
DROP FUNCTION _seed_jhn_stock;
