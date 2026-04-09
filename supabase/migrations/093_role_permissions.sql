-- Migrate existing role values to new names
UPDATE profiles SET role = 'direktur_ops'     WHERE role = 'direktur_operasional';
UPDATE profiles SET role = 'direktur_finance'  WHERE role = 'finance';
UPDATE profiles SET role = 'staf_ops'          WHERE role = 'staff';
UPDATE profiles SET role = 'ppic_manager'      WHERE role = 'ppic';

-- Create role_permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
  role            TEXT NOT NULL,
  permission_key  TEXT NOT NULL,
  PRIMARY KEY (role, permission_key)
);

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read permissions (needed for client-side checks)
CREATE POLICY "rp_read" ON role_permissions
  FOR SELECT TO authenticated USING (true);

-- Only owner can modify
CREATE POLICY "rp_owner_write" ON role_permissions
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner')
  );

-- ============================================================
-- Default permissions
-- Keys:
--   tab:*         → sidebar tab access
--   wh:*          → warehouse action buttons
--   whs:*         → warehouse-settings sub-tabs
-- ============================================================

INSERT INTO role_permissions (role, permission_key) VALUES
  -- ── admin (all tabs + all wh) ────────────────────────────
  ('admin', 'tab:overview'),
  ('admin', 'tab:marketing'),
  ('admin', 'tab:channels'),
  ('admin', 'tab:waba-management'),
  ('admin', 'tab:ppic'),
  ('admin', 'tab:warehouse'),
  ('admin', 'tab:warehouse-settings'),
  ('admin', 'tab:pulse'),
  ('admin', 'tab:customers'),
  ('admin', 'tab:brand-analysis'),
  ('admin', 'tab:finance'),
  ('admin', 'wh:stock_masuk'),
  ('admin', 'wh:transfer'),
  ('admin', 'wh:stock_keluar'),
  ('admin', 'wh:dispose'),
  ('admin', 'wh:konversi'),
  ('admin', 'wh:opname_manage'),
  ('admin', 'wh:opname_approve'),
  ('admin', 'wh:mapping_sync'),
  ('admin', 'whs:brands'),
  ('admin', 'whs:vendors'),
  ('admin', 'whs:products'),
  ('admin', 'whs:warehouses'),
  ('admin', 'whs:mapping'),

  -- ── direktur_ops ─────────────────────────────────────────
  ('direktur_ops', 'tab:overview'),
  ('direktur_ops', 'tab:marketing'),
  ('direktur_ops', 'tab:channels'),
  ('direktur_ops', 'tab:waba-management'),
  ('direktur_ops', 'tab:ppic'),
  ('direktur_ops', 'tab:warehouse'),
  ('direktur_ops', 'tab:warehouse-settings'),
  ('direktur_ops', 'tab:pulse'),
  ('direktur_ops', 'tab:customers'),
  ('direktur_ops', 'tab:brand-analysis'),
  ('direktur_ops', 'tab:finance'),
  ('direktur_ops', 'wh:stock_masuk'),
  ('direktur_ops', 'wh:transfer'),
  ('direktur_ops', 'wh:stock_keluar'),
  ('direktur_ops', 'wh:dispose'),
  ('direktur_ops', 'wh:konversi'),
  ('direktur_ops', 'wh:opname_manage'),
  ('direktur_ops', 'wh:opname_approve'),
  ('direktur_ops', 'wh:mapping_sync'),
  ('direktur_ops', 'whs:brands'),
  ('direktur_ops', 'whs:vendors'),
  ('direktur_ops', 'whs:products'),
  ('direktur_ops', 'whs:warehouses'),
  ('direktur_ops', 'whs:mapping'),

  -- ── staf_ops (minimal, user will configure) ───────────────
  ('staf_ops', 'tab:admin'),

  -- ── direktur_finance ─────────────────────────────────────
  ('direktur_finance', 'tab:overview'),
  ('direktur_finance', 'tab:pulse'),
  ('direktur_finance', 'tab:finance'),

  -- ── staf_finance ─────────────────────────────────────────
  ('staf_finance', 'tab:finance'),

  -- ── brand_manager ─────────────────────────────────────────
  ('brand_manager', 'tab:overview'),
  ('brand_manager', 'tab:marketing'),
  ('brand_manager', 'tab:pulse'),
  ('brand_manager', 'tab:customers'),
  ('brand_manager', 'tab:brand-analysis'),

  -- ── sales_manager ─────────────────────────────────────────
  ('sales_manager', 'tab:overview'),
  ('sales_manager', 'tab:marketing'),
  ('sales_manager', 'tab:channels'),
  ('sales_manager', 'tab:waba-management'),
  ('sales_manager', 'tab:pulse'),
  ('sales_manager', 'tab:customers'),

  -- ── warehouse_manager ─────────────────────────────────────
  ('warehouse_manager', 'tab:warehouse'),
  ('warehouse_manager', 'tab:warehouse-settings'),
  ('warehouse_manager', 'wh:stock_masuk'),
  ('warehouse_manager', 'wh:transfer'),
  ('warehouse_manager', 'wh:stock_keluar'),
  ('warehouse_manager', 'wh:dispose'),
  ('warehouse_manager', 'wh:konversi'),
  ('warehouse_manager', 'wh:opname_manage'),
  ('warehouse_manager', 'wh:opname_approve'),
  ('warehouse_manager', 'wh:mapping_sync'),
  ('warehouse_manager', 'whs:brands'),
  ('warehouse_manager', 'whs:vendors'),
  ('warehouse_manager', 'whs:products'),
  ('warehouse_manager', 'whs:warehouses'),
  ('warehouse_manager', 'whs:mapping'),

  -- ── ppic_manager ─────────────────────────────────────────
  ('ppic_manager', 'tab:ppic'),
  ('ppic_manager', 'tab:warehouse'),
  ('ppic_manager', 'wh:stock_masuk'),
  ('ppic_manager', 'wh:opname_manage')

ON CONFLICT DO NOTHING;
