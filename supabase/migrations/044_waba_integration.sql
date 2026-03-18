-- ============================================================
-- WhatsApp Business API (WABA) Integration
-- ============================================================
-- Stores WABA account configuration and sync logs.
-- Data pulled from WABA analytics flows into existing daily_ads_spend table
-- with data_source = 'whatsapp_api'.

-- 1. WABA Account configuration
CREATE TABLE waba_accounts (
  id SERIAL PRIMARY KEY,
  waba_id TEXT NOT NULL UNIQUE,                  -- WhatsApp Business Account ID
  waba_name TEXT NOT NULL,                       -- Display name
  store TEXT NOT NULL,                           -- Maps to daily_ads_spend.store
  default_source TEXT NOT NULL DEFAULT 'WhatsApp Marketing',
  default_advertiser TEXT NOT NULL DEFAULT 'WhatsApp Team',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_waba_accounts_active ON waba_accounts(is_active) WHERE is_active = TRUE;

-- 2. WABA sync execution log
CREATE TABLE waba_sync_log (
  id SERIAL PRIMARY KEY,
  sync_date DATE NOT NULL,
  date_range_start DATE NOT NULL,
  date_range_end DATE NOT NULL,
  accounts_synced INT DEFAULT 0,
  rows_inserted INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',        -- running, success, partial, failed
  error_message TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_waba_sync_log_date ON waba_sync_log(sync_date DESC);

-- RLS Policies
ALTER TABLE waba_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE waba_sync_log ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "Read waba_accounts" ON waba_accounts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Read waba_sync_log" ON waba_sync_log
  FOR SELECT TO authenticated USING (true);

-- Only owner can manage accounts
CREATE POLICY "Owner manage waba_accounts" ON waba_accounts
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'owner'));

-- Sync logs written via service role (cron/API)
CREATE POLICY "Insert waba_sync_log" ON waba_sync_log
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'finance')));
CREATE POLICY "Delete waba_sync_log" ON waba_sync_log
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'finance')));
