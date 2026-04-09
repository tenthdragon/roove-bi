-- ============================================================
-- Add WIP categories & seed WIP products for RLB BTN
-- ============================================================
-- Source: KARTU STOCK FG RLB BTN - APRIL 2026.xlsx
-- Sheet "9 - Kamis" (9 April 2026) — stok akhir terbaru
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Update CHECK constraint — add 'wip' and 'wip_material'
-- ────────────────────────────────────────────────────────────

ALTER TABLE warehouse_products DROP CONSTRAINT IF EXISTS warehouse_products_category_check;
ALTER TABLE warehouse_products ADD CONSTRAINT warehouse_products_category_check
  CHECK (category IN ('fg','sachet','packaging','bonus','other','wip','wip_material'));

-- ────────────────────────────────────────────────────────────
-- 2. Insert WIP products (sachet bulk belum siap jual)
-- ────────────────────────────────────────────────────────────

INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('Sachet Roove Blueberry - FG', 'wip', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Strawberry - FG', 'wip', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Coffee - FG',     'wip', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Roove Kurma - FG',      'wip', 'pcs', 20000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet Pluve - FG',            'wip', 'pcs', 0,     'RLB', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. Insert WIP material products (packaging/material konversi)
-- ────────────────────────────────────────────────────────────

INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('Selongsong - Roove Kurma 20',       'wip_material', 'pcs', 8900, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Selongsong - Roove 10',             'wip_material', 'pcs', 6000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Selongsong - Roove 7',              'wip_material', 'pcs', 3950, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Selongsong - Roove 3',              'wip_material', 'pcs', 3100, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Pouch - Roove 20 (STIKER)',         'wip_material', 'pcs', 2800, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Pouch - Roove 20 (Non STIKER)',     'wip_material', 'pcs', 2800, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Pouch - Roove 10',                  'wip_material', 'pcs', 3000, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Pouch - Roove Strawberry 20',       'wip_material', 'pcs', 4300, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Pouch - Roove Coffee 20',           'wip_material', 'pcs', 4300, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Pouch - Roove Kurma 20',            'wip_material', 'pcs', 4300, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Pouch - Pluve 20',                  'wip_material', 'pcs', 4300, 'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Plastik Shrink - R50 (25 x 42, 19)','wip_material', 'pcs', 175,  'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Plastik Shrink - R20 (24 x 35, 19)','wip_material', 'pcs', 140,  'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Plastik Shrink - R10 (20 x 32, 19)','wip_material', 'pcs', 110,  'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Plastik Shrink - R7 (13 x 30, 19)', 'wip_material', 'pcs', 65,   'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Plastik Shrink - R3 (11 x 26, 19)', 'wip_material', 'pcs', 50,   'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Kartu Gift Roove',                  'wip_material', 'pcs', 50,   'RLB', 'BTN', ARRAY[]::TEXT[]),
  ('Hologram',                          'wip_material', 'pcs', 200,  'RLB', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 4. Seed initial stock — helper function
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _seed_wip_stock(
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
  ) VALUES (v_pid, v_bid, 'IN', p_qty, v_bal, 'manual', 'Initial WIP stock from Kartu Stock FG RLB BTN Apr 2026');
END;
$$ LANGUAGE plpgsql;

-- ────────────────────────────────────────────────────────────
-- 5. WIP Sachet — per batch (sheet "9 - Kamis", stok akhir)
-- ────────────────────────────────────────────────────────────

-- Sachet Roove Blueberry - FG
SELECT _seed_wip_stock('Sachet Roove Blueberry - FG', 'RLB', 'BTN', 'RVB6 09.03.2026 (anticonterfit)', '2028-02-01', 12695);

-- Sachet Roove Strawberry - FG
SELECT _seed_wip_stock('Sachet Roove Strawberry - FG', 'RLB', 'BTN', 'RVS2 03.03.2026', '2028-02-01', 3035);

-- Sachet Roove Coffee - FG
SELECT _seed_wip_stock('Sachet Roove Coffee - FG', 'RLB', 'BTN', 'RVC2 13.03.2026', '2028-02-01', 4578);

-- Sachet Roove Kurma - FG (2 batch)
SELECT _seed_wip_stock('Sachet Roove Kurma - FG', 'RLB', 'BTN', 'RVK2 17.02.2026', '2028-02-01', 3202);
SELECT _seed_wip_stock('Sachet Roove Kurma - FG', 'RLB', 'BTN', 'RVK2 25.02.2026', '2028-02-01', 2848);

-- Sachet Pluve - FG (2 batch, no expiry)
SELECT _seed_wip_stock('Sachet Pluve - FG', 'RLB', 'BTN', 'PLV3 03.02.2026', NULL, 974);
SELECT _seed_wip_stock('Sachet Pluve - FG', 'RLB', 'BTN', 'PLV3 04.03.2026', NULL, 7340);

-- ────────────────────────────────────────────────────────────
-- 6. WIP Material — single batch INIT-APR2026 (no expiry)
--    Skip Kartu Gift Roove (qty=0)
-- ────────────────────────────────────────────────────────────

SELECT _seed_wip_stock('Selongsong - Roove Kurma 20',        'RLB', 'BTN', 'INIT-APR2026', NULL, 40);
SELECT _seed_wip_stock('Selongsong - Roove 10',              'RLB', 'BTN', 'INIT-APR2026', NULL, 99);
SELECT _seed_wip_stock('Selongsong - Roove 7',               'RLB', 'BTN', 'INIT-APR2026', NULL, 2300);
SELECT _seed_wip_stock('Selongsong - Roove 3',               'RLB', 'BTN', 'INIT-APR2026', NULL, 2028);
SELECT _seed_wip_stock('Pouch - Roove 20 (STIKER)',          'RLB', 'BTN', 'INIT-APR2026', NULL, 41542);
SELECT _seed_wip_stock('Pouch - Roove 20 (Non STIKER)',      'RLB', 'BTN', 'INIT-APR2026', NULL, 56247);
SELECT _seed_wip_stock('Pouch - Roove 10',                   'RLB', 'BTN', 'INIT-APR2026', NULL, 14933);
SELECT _seed_wip_stock('Pouch - Roove Strawberry 20',        'RLB', 'BTN', 'INIT-APR2026', NULL, 12901);
SELECT _seed_wip_stock('Pouch - Roove Coffee 20',            'RLB', 'BTN', 'INIT-APR2026', NULL, 9825);
SELECT _seed_wip_stock('Pouch - Roove Kurma 20',             'RLB', 'BTN', 'INIT-APR2026', NULL, 5229);
SELECT _seed_wip_stock('Pouch - Pluve 20',                   'RLB', 'BTN', 'INIT-APR2026', NULL, 4391);
SELECT _seed_wip_stock('Plastik Shrink - R50 (25 x 42, 19)', 'RLB', 'BTN', 'INIT-APR2026', NULL, 14784);
SELECT _seed_wip_stock('Plastik Shrink - R20 (24 x 35, 19)', 'RLB', 'BTN', 'INIT-APR2026', NULL, 25391);
SELECT _seed_wip_stock('Plastik Shrink - R10 (20 x 32, 19)', 'RLB', 'BTN', 'INIT-APR2026', NULL, 156);
SELECT _seed_wip_stock('Plastik Shrink - R7 (13 x 30, 19)',  'RLB', 'BTN', 'INIT-APR2026', NULL, 600);
SELECT _seed_wip_stock('Plastik Shrink - R3 (11 x 26, 19)',  'RLB', 'BTN', 'INIT-APR2026', NULL, 598);
SELECT _seed_wip_stock('Hologram',                           'RLB', 'BTN', 'INIT-APR2026', NULL, 120401);

-- Cleanup
DROP FUNCTION _seed_wip_stock;
