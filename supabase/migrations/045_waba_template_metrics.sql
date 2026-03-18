-- ============================================================
-- WABA Template Materialized Storage
-- ============================================================
-- Caches template metadata and daily performance metrics in Supabase
-- so the WABA Management page loads instantly from DB instead of
-- live Graph API calls on every page load.
-- Synced via /api/waba-template-sync (cron daily + manual).

BEGIN;

-- 1. Template metadata cache
CREATE TABLE waba_templates (
  id TEXT PRIMARY KEY,                             -- Graph API template ID (numeric string)
  waba_id TEXT NOT NULL,                           -- WABA account ID
  name TEXT NOT NULL,
  status TEXT NOT NULL,                            -- APPROVED, PENDING, REJECTED, PAUSED, etc.
  category TEXT NOT NULL,                          -- MARKETING, UTILITY, AUTHENTICATION
  language TEXT NOT NULL,
  components JSONB NOT NULL DEFAULT '[]',          -- Full component data for preview
  is_auto_generated BOOLEAN NOT NULL DEFAULT FALSE, -- Pre-computed from UUID regex at sync
  deleted_at TIMESTAMPTZ,                          -- Soft-delete for templates removed from Graph API
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_waba_templates_waba ON waba_templates(waba_id);
CREATE INDEX idx_waba_templates_status ON waba_templates(status);
CREATE INDEX idx_waba_templates_auto ON waba_templates(is_auto_generated);
CREATE INDEX idx_waba_templates_deleted ON waba_templates(deleted_at) WHERE deleted_at IS NULL;

-- 2. Per-template daily performance metrics
CREATE TABLE waba_template_daily_analytics (
  template_id TEXT NOT NULL,
  date DATE NOT NULL,
  sent INT NOT NULL DEFAULT 0,
  delivered INT NOT NULL DEFAULT 0,
  read INT NOT NULL DEFAULT 0,
  clicked INT NOT NULL DEFAULT 0,
  replied INT NOT NULL DEFAULT 0,
  cost NUMERIC(14,2) NOT NULL DEFAULT 0,           -- amount_spent in IDR (can be large)
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (template_id, date)
);

CREATE INDEX idx_waba_tda_date ON waba_template_daily_analytics(date);

-- 3. Sync execution log
CREATE TABLE waba_template_sync_log (
  id SERIAL PRIMARY KEY,
  sync_type TEXT NOT NULL DEFAULT 'cron',           -- 'cron' or 'manual'
  templates_synced INT DEFAULT 0,
  analytics_rows_upserted INT DEFAULT 0,
  date_range_start DATE,
  date_range_end DATE,
  status TEXT NOT NULL DEFAULT 'running',           -- running, success, partial, failed
  error_message TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_waba_tsl_created ON waba_template_sync_log(created_at DESC);

-- 4. Aggregated view for template list (last 90 days)
CREATE OR REPLACE VIEW v_waba_template_analytics_90d AS
SELECT
  template_id,
  SUM(sent)::INT AS sent,
  SUM(delivered)::INT AS delivered,
  SUM(read)::INT AS read,
  SUM(clicked)::INT AS clicked,
  SUM(replied)::INT AS replied,
  SUM(cost) AS cost
FROM waba_template_daily_analytics
WHERE date >= CURRENT_DATE - 90
GROUP BY template_id;

-- 5. RLS Policies
ALTER TABLE waba_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE waba_template_daily_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE waba_template_sync_log ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "Read waba_templates" ON waba_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Read waba_template_daily_analytics" ON waba_template_daily_analytics
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Read waba_template_sync_log" ON waba_template_sync_log
  FOR SELECT TO authenticated USING (true);

-- Owner/finance can write (for sync via authenticated API calls)
CREATE POLICY "Write waba_templates" ON waba_templates
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'finance')));
CREATE POLICY "Write waba_template_daily_analytics" ON waba_template_daily_analytics
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'finance')));
CREATE POLICY "Write waba_template_sync_log" ON waba_template_sync_log
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('owner', 'finance')));

COMMIT;
