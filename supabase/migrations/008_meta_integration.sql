-- ============================================================
-- Meta Marketing API Integration
-- ============================================================
-- Stores Meta Ad Account configuration and sync logs.
-- Data pulled from Meta API flows into existing daily_ads_spend table.

-- 1. Meta Ad Account configuration
-- Maps each Meta ad account to the store/brand in daily_ads_spend
CREATE TABLE meta_ad_accounts (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,            -- Meta Ad Account ID (act_xxx)
  account_name TEXT NOT NULL,                 -- Display name (e.g. "RTI - Meta - Roove")
  store TEXT NOT NULL,                        -- Maps to daily_ads_spend.store → ads_store_brand_mapping
  default_source TEXT NOT NULL DEFAULT 'Facebook Ads', -- daily_ads_spend.source
  default_advertiser TEXT NOT NULL DEFAULT 'Meta Team', -- daily_ads_spend.advertiser
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_meta_accounts_active ON meta_ad_accounts(is_active) WHERE is_active = TRUE;

-- 2. Meta sync execution log
CREATE TABLE meta_sync_log (
  id SERIAL PRIMARY KEY,
  sync_date DATE NOT NULL,
  date_range_start DATE NOT NULL,
  date_range_end DATE NOT NULL,
  accounts_synced INT DEFAULT 0,
  rows_inserted INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',     -- running, success, partial, failed
  error_message TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_meta_sync_log_date ON meta_sync_log(sync_date DESC);

-- RLS Policies
ALTER TABLE meta_ad_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_sync_log ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "Read meta_ad_accounts" ON meta_ad_accounts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Read meta_sync_log" ON meta_sync_log
  FOR SELECT TO authenticated USING (true);

-- Only owner can manage accounts
CREATE POLICY "Owner manage meta_ad_accounts" ON meta_ad_accounts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- Sync logs are written via service role (cron/API). Separate policies for safety.
CREATE POLICY "Insert meta_sync_log" ON meta_sync_log
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'finance')));
CREATE POLICY "Delete meta_sync_log" ON meta_sync_log
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'finance')));
