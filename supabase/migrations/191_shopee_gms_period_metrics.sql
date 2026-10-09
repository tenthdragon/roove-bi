-- ============================================================
-- Shopee Shop GMV Max (GMS) period-level performance
--
-- The Shopee GMS read APIs return one aggregate report for an
-- arbitrary date range. They do not return a daily breakdown or
-- campaign settings, so these rows intentionally use period grain.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.shopee_gms_campaign_period_metrics (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  shop_config_id INT NOT NULL REFERENCES public.shopee_shops(id) ON DELETE CASCADE,
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  impressions NUMERIC NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  expense NUMERIC NOT NULL DEFAULT 0,
  broad_gmv NUMERIC NOT NULL DEFAULT 0,
  broad_order BIGINT NOT NULL DEFAULT 0,
  broad_order_amount BIGINT NOT NULL DEFAULT 0,
  broad_roas NUMERIC NOT NULL DEFAULT 0,
  broad_acos NUMERIC NOT NULL DEFAULT 0,
  conversion_rate NUMERIC NOT NULL DEFAULT 0,
  cost_per_conversion NUMERIC NOT NULL DEFAULT 0,
  direct_order BIGINT NOT NULL DEFAULT 0,
  direct_order_amount BIGINT NOT NULL DEFAULT 0,
  direct_roas NUMERIC NOT NULL DEFAULT 0,
  direct_acos NUMERIC NOT NULL DEFAULT 0,
  direct_conversion_rate NUMERIC NOT NULL DEFAULT 0,
  cost_per_direct_conversion NUMERIC NOT NULL DEFAULT 0,
  raw_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  sync_batch_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shopee_gms_campaign_period_valid
    CHECK (period_end > period_start),
  UNIQUE (workspace_id, shop_config_id, campaign_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_shopee_gms_campaign_period_workspace
  ON public.shopee_gms_campaign_period_metrics
  (workspace_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS public.shopee_gms_item_period_metrics (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  shop_config_id INT NOT NULL REFERENCES public.shopee_shops(id) ON DELETE CASCADE,
  shop_id BIGINT NOT NULL,
  campaign_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  expense NUMERIC NOT NULL DEFAULT 0,
  broad_gmv NUMERIC NOT NULL DEFAULT 0,
  broad_order BIGINT NOT NULL DEFAULT 0,
  broad_order_amount BIGINT NOT NULL DEFAULT 0,
  broad_roas NUMERIC NOT NULL DEFAULT 0,
  broad_acos NUMERIC NOT NULL DEFAULT 0,
  conversion_rate NUMERIC NOT NULL DEFAULT 0,
  cost_per_conversion NUMERIC NOT NULL DEFAULT 0,
  direct_order BIGINT NOT NULL DEFAULT 0,
  direct_order_amount BIGINT NOT NULL DEFAULT 0,
  direct_roas NUMERIC NOT NULL DEFAULT 0,
  direct_acos NUMERIC NOT NULL DEFAULT 0,
  direct_conversion_rate NUMERIC NOT NULL DEFAULT 0,
  cost_per_direct_conversion NUMERIC NOT NULL DEFAULT 0,
  raw_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  sync_batch_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT shopee_gms_item_period_valid
    CHECK (period_end > period_start),
  UNIQUE (workspace_id, shop_config_id, campaign_id, item_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_shopee_gms_item_period_workspace
  ON public.shopee_gms_item_period_metrics
  (workspace_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_shopee_gms_item_period_campaign
  ON public.shopee_gms_item_period_metrics
  (workspace_id, shop_config_id, campaign_id, period_start, period_end);

ALTER TABLE public.shopee_gms_campaign_period_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopee_gms_item_period_metrics ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.dashboard_has_workspace_permission(
  p_workspace_id UUID,
  p_permission_key TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner()
    OR EXISTS (
      SELECT 1
      FROM public.profiles profile
      JOIN public.workspace_memberships membership
        ON membership.workspace_id = p_workspace_id
       AND membership.user_id = profile.id
       AND membership.status = 'active'
      LEFT JOIN public.workspace_role_permissions permission
        ON permission.workspace_id = membership.workspace_id
       AND permission.role = membership.role
       AND permission.permission_key = p_permission_key
      WHERE profile.id = auth.uid()
        AND profile.active_workspace_id = p_workspace_id
        AND (
          membership.role = 'workspace_owner'
          OR permission.permission_key IS NOT NULL
        )
    );
$$;

REVOKE ALL ON FUNCTION public.dashboard_has_workspace_permission(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_has_workspace_permission(UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS shopee_gms_campaign_period_workspace_select
  ON public.shopee_gms_campaign_period_metrics;
DROP POLICY IF EXISTS shopee_gms_campaign_period_workspace_write
  ON public.shopee_gms_campaign_period_metrics;
DROP POLICY IF EXISTS shopee_gms_campaign_period_workspace_insert
  ON public.shopee_gms_campaign_period_metrics;
DROP POLICY IF EXISTS shopee_gms_campaign_period_workspace_update
  ON public.shopee_gms_campaign_period_metrics;
DROP POLICY IF EXISTS shopee_gms_campaign_period_workspace_delete
  ON public.shopee_gms_campaign_period_metrics;
CREATE POLICY shopee_gms_campaign_period_workspace_select
  ON public.shopee_gms_campaign_period_metrics
  FOR SELECT TO authenticated
  USING (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_workspace_permission(workspace_id, 'tab:marketing')
  );

CREATE POLICY shopee_gms_campaign_period_workspace_insert
  ON public.shopee_gms_campaign_period_metrics
  FOR INSERT TO authenticated
  WITH CHECK (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_workspace_permission(workspace_id, 'admin:meta')
  );

CREATE POLICY shopee_gms_campaign_period_workspace_update
  ON public.shopee_gms_campaign_period_metrics
  FOR UPDATE TO authenticated
  USING (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_workspace_permission(workspace_id, 'admin:meta')
  )
  WITH CHECK (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_workspace_permission(workspace_id, 'admin:meta')
  );

CREATE POLICY shopee_gms_campaign_period_workspace_delete
  ON public.shopee_gms_campaign_period_metrics
  FOR DELETE TO authenticated
  USING (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_workspace_permission(workspace_id, 'admin:meta')
  );

DROP POLICY IF EXISTS shopee_gms_item_period_workspace_select
  ON public.shopee_gms_item_period_metrics;
DROP POLICY IF EXISTS shopee_gms_item_period_workspace_write
  ON public.shopee_gms_item_period_metrics;
DROP POLICY IF EXISTS shopee_gms_item_period_workspace_insert
  ON public.shopee_gms_item_period_metrics;
DROP POLICY IF EXISTS shopee_gms_item_period_workspace_update
  ON public.shopee_gms_item_period_metrics;
DROP POLICY IF EXISTS shopee_gms_item_period_workspace_delete
  ON public.shopee_gms_item_period_metrics;
CREATE POLICY shopee_gms_item_period_workspace_select
  ON public.shopee_gms_item_period_metrics
  FOR SELECT TO authenticated
  USING (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_workspace_permission(workspace_id, 'tab:marketing')
  );

CREATE POLICY shopee_gms_item_period_workspace_insert
  ON public.shopee_gms_item_period_metrics
  FOR INSERT TO authenticated
  WITH CHECK (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_workspace_permission(workspace_id, 'admin:meta')
  );

CREATE POLICY shopee_gms_item_period_workspace_update
  ON public.shopee_gms_item_period_metrics
  FOR UPDATE TO authenticated
  USING (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_workspace_permission(workspace_id, 'admin:meta')
  )
  WITH CHECK (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_workspace_permission(workspace_id, 'admin:meta')
  );

CREATE POLICY shopee_gms_item_period_workspace_delete
  ON public.shopee_gms_item_period_metrics
  FOR DELETE TO authenticated
  USING (
    public.workspace_can_access(workspace_id)
    AND public.dashboard_has_workspace_permission(workspace_id, 'admin:meta')
  );

-- Service-role writes bypass RLS, so enforce that every child row points to a
-- Shopee shop in the same workspace. Migration 190 tables receive the same
-- missing parent guard here.
DROP TRIGGER IF EXISTS enforce_tenant_parent_shopee_gms_campaign
  ON public.shopee_gms_campaign_period_metrics;
CREATE TRIGGER enforce_tenant_parent_shopee_gms_campaign
  BEFORE INSERT OR UPDATE OF workspace_id, shop_config_id
  ON public.shopee_gms_campaign_period_metrics
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_parent_reference(
    'shopee_gms_campaign_period_metrics',
    'shop_config_id',
    'shopee_shops',
    'id',
    'workspace_id'
  );

DROP TRIGGER IF EXISTS enforce_tenant_parent_shopee_gms_item
  ON public.shopee_gms_item_period_metrics;
CREATE TRIGGER enforce_tenant_parent_shopee_gms_item
  BEFORE INSERT OR UPDATE OF workspace_id, shop_config_id
  ON public.shopee_gms_item_period_metrics
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_parent_reference(
    'shopee_gms_item_period_metrics',
    'shop_config_id',
    'shopee_shops',
    'id',
    'workspace_id'
  );

DROP TRIGGER IF EXISTS enforce_tenant_parent_shopee_ad_campaigns
  ON public.shopee_ad_campaigns;
CREATE TRIGGER enforce_tenant_parent_shopee_ad_campaigns
  BEFORE INSERT OR UPDATE OF workspace_id, shop_config_id
  ON public.shopee_ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_parent_reference(
    'shopee_ad_campaigns',
    'shop_config_id',
    'shopee_shops',
    'id',
    'workspace_id'
  );

DROP TRIGGER IF EXISTS enforce_tenant_parent_shopee_ad_campaign_metrics
  ON public.shopee_ad_campaign_daily_metrics;
CREATE TRIGGER enforce_tenant_parent_shopee_ad_campaign_metrics
  BEFORE INSERT OR UPDATE OF workspace_id, shop_config_id
  ON public.shopee_ad_campaign_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_parent_reference(
    'shopee_ad_campaign_daily_metrics',
    'shop_config_id',
    'shopee_shops',
    'id',
    'workspace_id'
  );

COMMENT ON TABLE public.shopee_gms_campaign_period_metrics IS
  'Shop GMV Max campaign performance at the exact requested period grain returned by Shopee Ads API.';

COMMENT ON TABLE public.shopee_gms_item_period_metrics IS
  'Shop GMV Max item performance at the exact requested period grain returned by Shopee Ads API; only items with performance are returned.';

COMMENT ON COLUMN public.shopee_gms_item_period_metrics.broad_gmv IS
  'GMV from any product in the shop attributed within seven days after an ad click; item rows must not be summed as campaign GMV.';
