-- ============================================================
-- Shopee Ads campaign-level settings and daily performance
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shopee_ad_campaigns (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  shop_config_id INT NOT NULL REFERENCES public.shopee_shops(id) ON DELETE CASCADE,
  shop_id BIGINT NOT NULL,
  shop_name TEXT NOT NULL,
  campaign_id BIGINT NOT NULL,
  campaign_type TEXT NOT NULL DEFAULT 'product',
  ad_type TEXT,
  ad_name TEXT NOT NULL DEFAULT '',
  campaign_status TEXT,
  bidding_method TEXT,
  campaign_placement TEXT,
  campaign_budget NUMERIC,
  roas_target NUMERIC,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  item_ids JSONB NOT NULL DEFAULT '[]'::JSONB,
  products JSONB NOT NULL DEFAULT '[]'::JSONB,
  selected_keywords JSONB NOT NULL DEFAULT '[]'::JSONB,
  raw_setting JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shopee_ad_campaigns_type_check
    CHECK (campaign_type IN ('product', 'shop_gmv_max')),
  UNIQUE (workspace_id, shop_config_id, campaign_type, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_shopee_ad_campaigns_workspace_status
  ON public.shopee_ad_campaigns (workspace_id, campaign_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_shopee_ad_campaigns_shop
  ON public.shopee_ad_campaigns (workspace_id, shop_config_id, campaign_id);

CREATE TABLE IF NOT EXISTS public.shopee_ad_campaign_daily_metrics (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  shop_config_id INT NOT NULL REFERENCES public.shopee_shops(id) ON DELETE CASCADE,
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  campaign_type TEXT NOT NULL DEFAULT 'product',
  metric_date DATE NOT NULL,
  ad_type TEXT,
  ad_name TEXT NOT NULL DEFAULT '',
  campaign_placement TEXT,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  ctr NUMERIC NOT NULL DEFAULT 0,
  expense NUMERIC NOT NULL DEFAULT 0,
  broad_gmv NUMERIC NOT NULL DEFAULT 0,
  broad_order INT NOT NULL DEFAULT 0,
  broad_order_amount INT NOT NULL DEFAULT 0,
  broad_roas NUMERIC NOT NULL DEFAULT 0,
  broad_acos NUMERIC NOT NULL DEFAULT 0,
  conversion_rate NUMERIC NOT NULL DEFAULT 0,
  cost_per_conversion NUMERIC NOT NULL DEFAULT 0,
  direct_gmv NUMERIC NOT NULL DEFAULT 0,
  direct_order INT NOT NULL DEFAULT 0,
  direct_order_amount INT NOT NULL DEFAULT 0,
  direct_roas NUMERIC NOT NULL DEFAULT 0,
  direct_acos NUMERIC NOT NULL DEFAULT 0,
  direct_conversion_rate NUMERIC NOT NULL DEFAULT 0,
  cost_per_direct_conversion NUMERIC NOT NULL DEFAULT 0,
  raw_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shopee_ad_campaign_daily_metrics_type_check
    CHECK (campaign_type IN ('product', 'shop_gmv_max')),
  UNIQUE (workspace_id, shop_config_id, campaign_type, campaign_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_shopee_ad_campaign_metrics_workspace_date
  ON public.shopee_ad_campaign_daily_metrics (workspace_id, metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_shopee_ad_campaign_metrics_campaign_date
  ON public.shopee_ad_campaign_daily_metrics
  (workspace_id, shop_config_id, campaign_id, metric_date DESC);

ALTER TABLE public.shopee_ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopee_ad_campaign_daily_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopee_ad_campaigns_workspace_select
  ON public.shopee_ad_campaigns;
CREATE POLICY shopee_ad_campaigns_workspace_select
  ON public.shopee_ad_campaigns
  FOR SELECT TO authenticated
  USING (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_permission('tab:marketing')
  );

DROP POLICY IF EXISTS shopee_ad_campaigns_workspace_write
  ON public.shopee_ad_campaigns;
CREATE POLICY shopee_ad_campaigns_workspace_write
  ON public.shopee_ad_campaigns
  FOR ALL TO authenticated
  USING (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_permission('admin:meta')
  )
  WITH CHECK (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_permission('admin:meta')
  );

DROP POLICY IF EXISTS shopee_ad_campaign_metrics_workspace_select
  ON public.shopee_ad_campaign_daily_metrics;
CREATE POLICY shopee_ad_campaign_metrics_workspace_select
  ON public.shopee_ad_campaign_daily_metrics
  FOR SELECT TO authenticated
  USING (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_permission('tab:marketing')
  );

DROP POLICY IF EXISTS shopee_ad_campaign_metrics_workspace_write
  ON public.shopee_ad_campaign_daily_metrics;
CREATE POLICY shopee_ad_campaign_metrics_workspace_write
  ON public.shopee_ad_campaign_daily_metrics
  FOR ALL TO authenticated
  USING (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_permission('admin:meta')
  )
  WITH CHECK (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_permission('admin:meta')
  );

COMMENT ON TABLE public.shopee_ad_campaigns IS
  'Latest Shopee product-ad campaign settings, including target ROAS, products, and configured keywords.';

COMMENT ON TABLE public.shopee_ad_campaign_daily_metrics IS
  'Daily Shopee product-ad performance used to compare attributed ROAS against campaign target ROAS.';

COMMENT ON COLUMN public.shopee_ad_campaigns.selected_keywords IS
  'Configured keywords for manual product campaigns. This is campaign configuration, not keyword-level performance.';

COMMENT ON COLUMN public.shopee_ad_campaign_daily_metrics.broad_gmv IS
  'Shopee-attributed shop GMV within seven days after an ad click.';
