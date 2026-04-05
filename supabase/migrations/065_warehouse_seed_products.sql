-- ============================================================
-- Warehouse Redesign — Phase 2: Seed RTI BTN Products
-- ============================================================
-- Source: Kartu Stock RTI BTN — 14 products, Dr Hyun line ONLY.
-- All other products (Roove, Almona, Pluve, etc.) belong to RLB/JHN/RLT
-- and are seeded in migrations 066, 069, 072.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- RTI BTN — DR HYUN line (Finished Goods + Sachet + Packaging)
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('DRHYUN HIGH FIBER 30 SC', 'fg', 'box', 295000, 'RTI', 'BTN', ARRAY['Dr Hyun High Fiber - 30 Sc','Drhyun High Fiber - 30 Sc','Dr Hyun','DrHyun']),
  ('Sachet DRHYUN', 'sachet', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('Sachet DRHYUN - FG', 'sachet', 'pcs', 2800, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('KEMASAN CUBE DR.HYUN 30 SC', 'packaging', 'pcs', 9000, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- RTI BTN — Bonus items (Dr Hyun specific)
-- ────────────────────────────────────────────────────────────
INSERT INTO warehouse_products (name, category, unit, price_list, entity, warehouse, scalev_product_names) VALUES
  ('Shaker DR HYUN (HIJAU)', 'bonus', 'pcs', 5400, 'RTI', 'BTN', ARRAY['Shaker Drhyun - Hijau']),
  ('Shaker DR HYUN (PINK)', 'bonus', 'pcs', 5400, 'RTI', 'BTN', ARRAY['Shaker Drhyun - Pink']),
  ('Shaker DR HYUN (BIRU)', 'bonus', 'pcs', 5400, 'RTI', 'BTN', ARRAY['Shaker Drhyun - Biru']),
  ('Shaker DR HYUN (KUNING)', 'bonus', 'pcs', 5400, 'RTI', 'BTN', ARRAY['Shaker Drhyun - Kuning']),
  ('Goddie Bag Dr Hyun', 'bonus', 'pcs', 4300, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('Baby Gold 0,001 gr', 'bonus', 'pcs', 3900, 'RTI', 'BTN', ARRAY['Baby Gold']),
  ('KORSET M', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('KORSET L', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('KORSET XL', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[]),
  ('KORSET XXL', 'bonus', 'pcs', 0, 'RTI', 'BTN', ARRAY[]::TEXT[])
ON CONFLICT (name, entity, warehouse) DO NOTHING;
