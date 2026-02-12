-- ============================================================
-- Roove BI Dashboard — Database Schema
-- Run this in Supabase SQL Editor (in order)
-- ============================================================

-- 1. ENUM for user roles
CREATE TYPE user_role AS ENUM ('owner', 'manager', 'brand_manager');

-- 2. User profiles (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role user_role NOT NULL DEFAULT 'manager',
  allowed_tabs TEXT[] DEFAULT '{}', -- for brand_manager: ['marketing','products']
  allowed_products TEXT[] DEFAULT '{}', -- for brand_manager: ['Roove','Purvu']
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Data imports log
CREATE TABLE data_imports (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  period_month INT NOT NULL, -- 1-12
  period_year INT NOT NULL,  -- e.g. 2026
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  imported_by UUID REFERENCES profiles(id),
  row_count INT DEFAULT 0,
  status TEXT DEFAULT 'completed', -- 'completed','failed','processing'
  notes TEXT,
  UNIQUE(period_month, period_year, filename)
);

-- 4. Daily product summary (main dashboard data)
CREATE TABLE daily_product_summary (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  product TEXT NOT NULL,
  net_sales NUMERIC DEFAULT 0,
  gross_profit NUMERIC DEFAULT 0,
  net_after_mkt NUMERIC DEFAULT 0,
  mkt_cost NUMERIC DEFAULT 0,
  import_id INT REFERENCES data_imports(id),
  UNIQUE(date, product)
);

-- 5. Daily channel breakdown
CREATE TABLE daily_channel_data (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  product TEXT NOT NULL,
  channel TEXT NOT NULL,
  gross_sales NUMERIC DEFAULT 0,
  discount NUMERIC DEFAULT 0,
  net_sales NUMERIC DEFAULT 0,
  cogs NUMERIC DEFAULT 0,
  gross_profit NUMERIC DEFAULT 0,
  mkt_cost NUMERIC DEFAULT 0,
  mp_admin_cost NUMERIC DEFAULT 0,
  net_after_mkt NUMERIC DEFAULT 0,
  import_id INT REFERENCES data_imports(id),
  UNIQUE(date, product, channel)
);

-- 6. Daily ads spend
CREATE TABLE daily_ads_spend (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  ad_account TEXT,
  spent NUMERIC DEFAULT 0,
  objective TEXT,
  source TEXT,
  store TEXT,
  advertiser TEXT,
  import_id INT REFERENCES data_imports(id)
);

-- 7. Product summary (monthly aggregated, for quick lookups)
CREATE TABLE monthly_product_summary (
  id SERIAL PRIMARY KEY,
  period_month INT NOT NULL,
  period_year INT NOT NULL,
  product TEXT NOT NULL,
  sales_after_disc NUMERIC DEFAULT 0,
  sales_pct NUMERIC DEFAULT 0,
  gross_profit NUMERIC DEFAULT 0,
  gross_profit_pct NUMERIC DEFAULT 0,
  gross_after_mkt NUMERIC DEFAULT 0,
  gmp_real NUMERIC DEFAULT 0,
  mkt_pct NUMERIC DEFAULT 0,
  mkt_share_pct NUMERIC DEFAULT 0,
  import_id INT REFERENCES data_imports(id),
  UNIQUE(period_month, period_year, product)
);

-- ============================================================
-- INDEXES for query performance
-- ============================================================
CREATE INDEX idx_dps_date ON daily_product_summary(date);
CREATE INDEX idx_dps_product ON daily_product_summary(product);
CREATE INDEX idx_dps_date_product ON daily_product_summary(date, product);
CREATE INDEX idx_dcd_date ON daily_channel_data(date);
CREATE INDEX idx_dcd_product ON daily_channel_data(product);
CREATE INDEX idx_das_date ON daily_ads_spend(date);
CREATE INDEX idx_das_store ON daily_ads_spend(store);
CREATE INDEX idx_mps_period ON monthly_product_summary(period_year, period_month);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_product_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_channel_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_ads_spend ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_product_summary ENABLE ROW LEVEL SECURITY;

-- Policies: all authenticated users can read data
CREATE POLICY "Authenticated users can read profiles" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "Read data_imports" ON data_imports FOR SELECT TO authenticated USING (true);
CREATE POLICY "Read daily_product_summary" ON daily_product_summary FOR SELECT TO authenticated USING (true);
CREATE POLICY "Read daily_channel_data" ON daily_channel_data FOR SELECT TO authenticated USING (true);
CREATE POLICY "Read daily_ads_spend" ON daily_ads_spend FOR SELECT TO authenticated USING (true);
CREATE POLICY "Read monthly_product_summary" ON monthly_product_summary FOR SELECT TO authenticated USING (true);

-- Only owners can insert/update/delete data
CREATE POLICY "Owner insert data_imports" ON data_imports FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "Owner insert dps" ON daily_product_summary FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "Owner insert dcd" ON daily_channel_data FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "Owner insert das" ON daily_ads_spend FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "Owner insert mps" ON monthly_product_summary FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- Owner can delete (for re-imports)
CREATE POLICY "Owner delete dps" ON daily_product_summary FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "Owner delete dcd" ON daily_channel_data FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "Owner delete das" ON daily_ads_spend FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "Owner delete mps" ON monthly_product_summary FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- Owner can manage profiles
CREATE POLICY "Owner manage profiles" ON profiles FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- ============================================================
-- FUNCTION: Auto-create profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE
      WHEN (SELECT COUNT(*) FROM profiles) = 0 THEN 'owner'::user_role
      ELSE 'manager'::user_role
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- USEFUL VIEWS
-- ============================================================
CREATE OR REPLACE VIEW v_daily_totals AS
SELECT
  date,
  SUM(net_sales) as net_sales,
  SUM(gross_profit) as gross_profit,
  SUM(net_after_mkt) as net_after_mkt,
  SUM(mkt_cost) as mkt_cost
FROM daily_product_summary
GROUP BY date
ORDER BY date;

CREATE OR REPLACE VIEW v_channel_totals AS
SELECT
  channel,
  SUM(net_sales) as net_sales,
  SUM(gross_profit) as gross_profit
FROM daily_channel_data
GROUP BY channel
ORDER BY SUM(net_sales) DESC;

CREATE OR REPLACE VIEW v_available_periods AS
SELECT DISTINCT
  period_year,
  period_month,
  MIN(imported_at) as first_import,
  MAX(imported_at) as last_import,
  COUNT(*) as import_count
FROM data_imports
WHERE status = 'completed'
GROUP BY period_year, period_month
ORDER BY period_year DESC, period_month DESC;
