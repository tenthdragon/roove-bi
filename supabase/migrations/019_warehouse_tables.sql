-- ============================================================
-- Warehouse (Gudang) Tables
-- ============================================================

-- 1. Warehouse sheet connections
CREATE TABLE warehouse_sheet_connections (
  id SERIAL PRIMARY KEY,
  spreadsheet_id TEXT NOT NULL,
  label TEXT NOT NULL,
  warehouse_name TEXT NOT NULL DEFAULT 'Gudang',
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  last_synced TIMESTAMPTZ,
  last_sync_status TEXT,
  last_sync_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Monthly stock summary per product
CREATE TABLE warehouse_stock_summary (
  id SERIAL PRIMARY KEY,
  warehouse TEXT NOT NULL,
  period_month INT NOT NULL,
  period_year INT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT,
  first_day_stock NUMERIC DEFAULT 0,
  total_in NUMERIC DEFAULT 0,
  total_out NUMERIC DEFAULT 0,
  last_day_stock NUMERIC DEFAULT 0,
  expired_date DATE,
  price_list NUMERIC DEFAULT 0,
  sub_total_value NUMERIC DEFAULT 0,
  UNIQUE(warehouse, period_month, period_year, product_name)
);

-- 3. Daily stock movements per product
CREATE TABLE warehouse_daily_stock (
  id SERIAL PRIMARY KEY,
  warehouse TEXT NOT NULL,
  date DATE NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT,
  stock_in NUMERIC DEFAULT 0,
  stock_out NUMERIC DEFAULT 0,
  UNIQUE(warehouse, date, product_name)
);

-- 4. Stock opname results
CREATE TABLE warehouse_stock_opname (
  id SERIAL PRIMARY KEY,
  warehouse TEXT NOT NULL,
  opname_date DATE NOT NULL,
  opname_label TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT,
  sebelum_so NUMERIC DEFAULT 0,
  sesudah_so NUMERIC DEFAULT 0,
  selisih NUMERIC DEFAULT 0,
  UNIQUE(warehouse, opname_date, opname_label, product_name)
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_wss_period ON warehouse_stock_summary(period_year, period_month);
CREATE INDEX idx_wss_product ON warehouse_stock_summary(product_name);
CREATE INDEX idx_wss_expired ON warehouse_stock_summary(expired_date);
CREATE INDEX idx_wds_date ON warehouse_daily_stock(date);
CREATE INDEX idx_wds_product ON warehouse_daily_stock(product_name);
CREATE INDEX idx_wso_date ON warehouse_stock_opname(opname_date);
CREATE INDEX idx_wso_product ON warehouse_stock_opname(product_name);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE warehouse_sheet_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_stock_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_daily_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_stock_opname ENABLE ROW LEVEL SECURITY;

-- Read policies (all authenticated)
CREATE POLICY "read_warehouse_sheet_connections" ON warehouse_sheet_connections
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_warehouse_stock_summary" ON warehouse_stock_summary
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_warehouse_daily_stock" ON warehouse_daily_stock
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "read_warehouse_stock_opname" ON warehouse_stock_opname
  FOR SELECT TO authenticated USING (true);

-- Write policies (owner/finance only)
CREATE POLICY "manage_warehouse_sheet_connections" ON warehouse_sheet_connections
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','finance','admin')));
CREATE POLICY "manage_warehouse_stock_summary" ON warehouse_stock_summary
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','finance','admin')));
CREATE POLICY "manage_warehouse_daily_stock" ON warehouse_daily_stock
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','finance','admin')));
CREATE POLICY "manage_warehouse_stock_opname" ON warehouse_stock_opname
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner','finance','admin')));

-- ============================================================
-- VIEWS
-- ============================================================

-- Expired products monitor
CREATE OR REPLACE VIEW v_warehouse_expiring AS
SELECT
  product_name,
  category,
  expired_date,
  last_day_stock,
  price_list,
  sub_total_value,
  warehouse,
  period_year,
  period_month,
  CASE
    WHEN expired_date < CURRENT_DATE THEN 'expired'
    WHEN expired_date < CURRENT_DATE + INTERVAL '30 days' THEN 'critical'
    WHEN expired_date < CURRENT_DATE + INTERVAL '90 days' THEN 'warning'
    ELSE 'safe'
  END AS expiry_status,
  (expired_date - CURRENT_DATE) AS days_remaining
FROM warehouse_stock_summary
WHERE expired_date IS NOT NULL
  AND last_day_stock > 0
ORDER BY expired_date ASC;

-- SO summary aggregated
CREATE OR REPLACE VIEW v_warehouse_so_summary AS
SELECT
  warehouse,
  opname_date,
  opname_label,
  COUNT(*) AS item_count,
  SUM(ABS(selisih)) AS total_abs_selisih,
  SUM(CASE WHEN selisih != 0 THEN 1 ELSE 0 END) AS items_with_selisih,
  SUM(CASE WHEN selisih > 0 THEN selisih ELSE 0 END) AS total_surplus,
  SUM(CASE WHEN selisih < 0 THEN selisih ELSE 0 END) AS total_deficit
FROM warehouse_stock_opname
GROUP BY warehouse, opname_date, opname_label
ORDER BY opname_date DESC;
