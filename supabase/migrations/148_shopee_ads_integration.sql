-- ============================================================
-- Shopee Ads Integration
-- ============================================================
-- Stores Shopee shop configuration, auth tokens, daily ads metrics,
-- and sync logs. Spend is still projected into daily_ads_spend so
-- existing dashboards continue to work without downstream changes.

CREATE TABLE IF NOT EXISTS shopee_shops (
  id SERIAL PRIMARY KEY,
  shop_id BIGINT NOT NULL UNIQUE,
  shop_name TEXT NOT NULL,
  region TEXT,
  merchant_id BIGINT,
  shop_status TEXT,
  is_cb BOOLEAN NOT NULL DEFAULT FALSE,
  auth_time TIMESTAMPTZ,
  auth_expire_at TIMESTAMPTZ,
  store TEXT,
  default_source TEXT NOT NULL DEFAULT 'Shopee Ads',
  default_advertiser TEXT NOT NULL DEFAULT 'Shopee Shop',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopee_shops_active
  ON shopee_shops (is_active)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS shopee_shop_tokens (
  shop_config_id INT PRIMARY KEY REFERENCES shopee_shops(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shopee_ads_daily_metrics (
  id SERIAL PRIMARY KEY,
  shop_config_id INT NOT NULL REFERENCES shopee_shops(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  shop_id BIGINT NOT NULL,
  shop_name TEXT NOT NULL,
  region TEXT,
  store TEXT,
  source TEXT NOT NULL DEFAULT 'Shopee Ads',
  advertiser TEXT NOT NULL DEFAULT 'Shopee Shop',
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  ctr NUMERIC NOT NULL DEFAULT 0,
  direct_order INT NOT NULL DEFAULT 0,
  broad_order INT NOT NULL DEFAULT 0,
  direct_item_sold INT NOT NULL DEFAULT 0,
  broad_item_sold INT NOT NULL DEFAULT 0,
  direct_gmv NUMERIC NOT NULL DEFAULT 0,
  broad_gmv NUMERIC NOT NULL DEFAULT 0,
  expense NUMERIC NOT NULL DEFAULT 0,
  cost_per_conversion NUMERIC NOT NULL DEFAULT 0,
  direct_roas NUMERIC NOT NULL DEFAULT 0,
  broad_roas NUMERIC NOT NULL DEFAULT 0,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_config_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_shopee_ads_daily_metrics_date
  ON shopee_ads_daily_metrics (metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_shopee_ads_daily_metrics_shop_date
  ON shopee_ads_daily_metrics (shop_id, metric_date DESC);

CREATE TABLE IF NOT EXISTS shopee_sync_log (
  id SERIAL PRIMARY KEY,
  sync_date DATE NOT NULL,
  date_range_start DATE NOT NULL,
  date_range_end DATE NOT NULL,
  shops_synced INT NOT NULL DEFAULT 0,
  rows_inserted INT NOT NULL DEFAULT 0,
  spend_total NUMERIC NOT NULL DEFAULT 0,
  direct_gmv_total NUMERIC NOT NULL DEFAULT 0,
  broad_gmv_total NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  error_message TEXT,
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopee_sync_log_date
  ON shopee_sync_log (sync_date DESC);

COMMENT ON TABLE shopee_shops IS
  'Safe-to-display Shopee shop configuration for the dashboard admin.';

COMMENT ON TABLE shopee_shop_tokens IS
  'Sensitive Shopee OAuth tokens kept separate from the public-facing shop config.';

COMMENT ON TABLE shopee_ads_daily_metrics IS
  'Raw Shopee Ads daily metrics, including ad-attributed GMV from CPC ads.';

COMMENT ON COLUMN shopee_ads_daily_metrics.direct_gmv IS
  'Ad-attributed GMV from direct conversions. Useful as Shopee ads revenue proxy.';

COMMENT ON COLUMN shopee_ads_daily_metrics.broad_gmv IS
  'Ad-attributed GMV from broad conversions. Useful as wider Shopee ads revenue proxy.';

ALTER TABLE shopee_shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopee_shop_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopee_ads_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopee_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Write shopee_shops via admin:meta" ON shopee_shops;
CREATE POLICY "Write shopee_shops via admin:meta" ON shopee_shops
  FOR ALL TO authenticated
  USING (dashboard_has_permission('admin:meta'))
  WITH CHECK (dashboard_has_permission('admin:meta'));

DROP POLICY IF EXISTS "Write shopee_ads_daily_metrics via admin:meta" ON shopee_ads_daily_metrics;
CREATE POLICY "Write shopee_ads_daily_metrics via admin:meta" ON shopee_ads_daily_metrics
  FOR ALL TO authenticated
  USING (dashboard_has_permission('admin:meta'))
  WITH CHECK (dashboard_has_permission('admin:meta'));

DROP POLICY IF EXISTS "Write shopee_sync_log via admin:meta" ON shopee_sync_log;
CREATE POLICY "Write shopee_sync_log via admin:meta" ON shopee_sync_log
  FOR ALL TO authenticated
  USING (dashboard_has_permission('admin:meta'))
  WITH CHECK (dashboard_has_permission('admin:meta'));

COMMENT ON COLUMN daily_ads_spend.data_source IS
  'Origin: google_sheets, meta_api, whatsapp_api, shopee_ads_api, xlsx_upload, etc.';
