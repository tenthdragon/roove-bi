-- ============================================================
-- Phase 1: Configuration Tables for Materialized Views
-- ============================================================

-- 1. Ads store → brand mapping
-- Maps daily_ads_spend.store to canonical brand name
CREATE TABLE ads_store_brand_mapping (
  id SERIAL PRIMARY KEY,
  store_pattern TEXT NOT NULL UNIQUE,
  brand TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO ads_store_brand_mapping (store_pattern, brand) VALUES
  ('Roove', 'Roove'),
  ('Purvu Store', 'Purvu'),
  ('Plume', 'Pluve'),
  ('Osgard', 'Osgard'),
  ('Calmara', 'Calmara'),
  ('DrHyun', 'DrHyun');

-- 2. Marketplace commission rates
-- Commission rates per marketplace channel
CREATE TABLE marketplace_commission_rates (
  id SERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  rate NUMERIC NOT NULL,
  effective_from DATE NOT NULL DEFAULT '2024-01-01',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel, effective_from)
);

INSERT INTO marketplace_commission_rates (channel, rate) VALUES
  ('TikTok', 0.19),
  ('Shopee', 0.21),
  ('Lazada', 0.1324),
  ('BliBli', 0.10);

-- RLS
ALTER TABLE ads_store_brand_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_commission_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read ads_store_brand_mapping" ON ads_store_brand_mapping
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Read marketplace_commission_rates" ON marketplace_commission_rates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Owner manage ads_store_brand_mapping" ON ads_store_brand_mapping
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
CREATE POLICY "Owner manage marketplace_commission_rates" ON marketplace_commission_rates
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));
