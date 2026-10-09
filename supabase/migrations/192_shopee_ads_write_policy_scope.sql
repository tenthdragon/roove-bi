-- Keep read access for Shopee Ads tables behind tab:marketing. PostgreSQL RLS
-- policies are permissive, so a FOR ALL admin policy would otherwise also
-- grant SELECT and bypass that dedicated read gate.

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

DO $$
DECLARE
  table_name text;
  legacy_policy text;
  policy_prefix text;
  select_policy text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'shopee_ad_campaigns',
    'shopee_ad_campaign_daily_metrics',
    'shopee_gms_campaign_period_metrics',
    'shopee_gms_item_period_metrics'
  ]
  LOOP
    legacy_policy := CASE table_name
      WHEN 'shopee_ad_campaigns' THEN 'shopee_ad_campaigns_workspace_write'
      WHEN 'shopee_ad_campaign_daily_metrics' THEN 'shopee_ad_campaign_metrics_workspace_write'
      WHEN 'shopee_gms_campaign_period_metrics' THEN 'shopee_gms_campaign_period_workspace_write'
      ELSE 'shopee_gms_item_period_workspace_write'
    END;
    policy_prefix := CASE table_name
      WHEN 'shopee_ad_campaigns' THEN 'shopee_ad_campaigns_workspace'
      WHEN 'shopee_ad_campaign_daily_metrics' THEN 'shopee_ad_campaign_metrics_workspace'
      WHEN 'shopee_gms_campaign_period_metrics' THEN 'shopee_gms_campaign_period_workspace'
      ELSE 'shopee_gms_item_period_workspace'
    END;
    select_policy := policy_prefix || '_select';

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', select_policy, table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', legacy_policy, table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_prefix || '_insert', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_prefix || '_update', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_prefix || '_delete', table_name);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.workspace_can_access(workspace_id) AND public.dashboard_has_workspace_permission(workspace_id, ''tab:marketing''))',
      select_policy,
      table_name
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.workspace_can_access(workspace_id) AND public.dashboard_has_workspace_permission(workspace_id, ''admin:meta''))',
      policy_prefix || '_insert',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.workspace_can_access(workspace_id) AND public.dashboard_has_workspace_permission(workspace_id, ''admin:meta'')) WITH CHECK (public.workspace_can_access(workspace_id) AND public.dashboard_has_workspace_permission(workspace_id, ''admin:meta''))',
      policy_prefix || '_update',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.workspace_can_access(workspace_id) AND public.dashboard_has_workspace_permission(workspace_id, ''admin:meta''))',
      policy_prefix || '_delete',
      table_name
    );
  END LOOP;
END
$$;

ALTER TABLE public.shopee_gms_campaign_period_metrics
  DROP CONSTRAINT IF EXISTS shopee_gms_campaign_period_valid;
ALTER TABLE public.shopee_gms_campaign_period_metrics
  ADD CONSTRAINT shopee_gms_campaign_period_valid
  CHECK (period_end > period_start);

ALTER TABLE public.shopee_gms_item_period_metrics
  DROP CONSTRAINT IF EXISTS shopee_gms_item_period_valid;
ALTER TABLE public.shopee_gms_item_period_metrics
  ADD CONSTRAINT shopee_gms_item_period_valid
  CHECK (period_end > period_start);

-- The generic workspace-parent trigger validates the tenant but not the
-- denormalized Shopee shop id. Keep all three identifiers aligned, including
-- for service-role writes that bypass RLS.
CREATE OR REPLACE FUNCTION public.enforce_shopee_ads_shop_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.shopee_shops shop
    WHERE shop.id = NEW.shop_config_id
      AND shop.workspace_id = NEW.workspace_id
      AND shop.shop_id = NEW.shop_id
  ) THEN
    RAISE EXCEPTION 'Shopee Ads row does not match its workspace and shop';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_shopee_ads_shop_reference() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_tenant_parent_shopee_ad_campaigns
  ON public.shopee_ad_campaigns;
CREATE TRIGGER enforce_tenant_parent_shopee_ad_campaigns
  BEFORE INSERT OR UPDATE OF workspace_id, shop_config_id, shop_id
  ON public.shopee_ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.enforce_shopee_ads_shop_reference();

DROP TRIGGER IF EXISTS enforce_tenant_parent_shopee_ad_campaign_metrics
  ON public.shopee_ad_campaign_daily_metrics;
CREATE TRIGGER enforce_tenant_parent_shopee_ad_campaign_metrics
  BEFORE INSERT OR UPDATE OF workspace_id, shop_config_id, shop_id
  ON public.shopee_ad_campaign_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION public.enforce_shopee_ads_shop_reference();

DROP TRIGGER IF EXISTS enforce_tenant_parent_shopee_gms_campaign
  ON public.shopee_gms_campaign_period_metrics;
CREATE TRIGGER enforce_tenant_parent_shopee_gms_campaign
  BEFORE INSERT OR UPDATE OF workspace_id, shop_config_id, shop_id
  ON public.shopee_gms_campaign_period_metrics
  FOR EACH ROW EXECUTE FUNCTION public.enforce_shopee_ads_shop_reference();

DROP TRIGGER IF EXISTS enforce_tenant_parent_shopee_gms_item
  ON public.shopee_gms_item_period_metrics;
CREATE TRIGGER enforce_tenant_parent_shopee_gms_item
  BEFORE INSERT OR UPDATE OF workspace_id, shop_config_id, shop_id
  ON public.shopee_gms_item_period_metrics
  FOR EACH ROW EXECUTE FUNCTION public.enforce_shopee_ads_shop_reference();

CREATE OR REPLACE FUNCTION public.replace_shopee_gms_period_snapshot(
  p_workspace_id UUID,
  p_shop_config_id INT,
  p_shop_id BIGINT,
  p_period_start DATE,
  p_period_end DATE,
  p_sync_batch_id UUID,
  p_campaign_rows JSONB,
  p_item_rows JSONB
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campaign_count INT := 0;
  v_item_count INT := 0;
BEGIN
  IF p_period_end <= p_period_start THEN
    RAISE EXCEPTION 'Shop GMV Max snapshot requires at least two dates';
  END IF;
  IF jsonb_typeof(COALESCE(p_campaign_rows, '[]'::JSONB)) <> 'array'
     OR jsonb_typeof(COALESCE(p_item_rows, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'Shop GMV Max snapshot rows must be JSON arrays';
  END IF;
  IF jsonb_array_length(COALESCE(p_campaign_rows, '[]'::JSONB)) = 0 THEN
    RAISE EXCEPTION 'Shop GMV Max snapshot requires a campaign row';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.shopee_shops shop
    WHERE shop.id = p_shop_config_id
      AND shop.workspace_id = p_workspace_id
      AND shop.shop_id = p_shop_id
  ) THEN
    RAISE EXCEPTION 'Shopee shop does not match the requested workspace';
  END IF;

  DELETE FROM public.shopee_gms_item_period_metrics
  WHERE workspace_id = p_workspace_id
    AND shop_config_id = p_shop_config_id
    AND period_start = p_period_start
    AND period_end = p_period_end;

  DELETE FROM public.shopee_gms_campaign_period_metrics
  WHERE workspace_id = p_workspace_id
    AND shop_config_id = p_shop_config_id
    AND period_start = p_period_start
    AND period_end = p_period_end;

  INSERT INTO public.shopee_gms_campaign_period_metrics (
    workspace_id,
    shop_config_id,
    shop_id,
    campaign_id,
    period_start,
    period_end,
    impressions,
    clicks,
    expense,
    broad_gmv,
    broad_order,
    broad_order_amount,
    broad_roas,
    broad_acos,
    conversion_rate,
    cost_per_conversion,
    direct_order,
    direct_order_amount,
    direct_roas,
    direct_acos,
    direct_conversion_rate,
    cost_per_direct_conversion,
    raw_payload,
    sync_batch_id,
    updated_at
  )
  SELECT
    p_workspace_id,
    p_shop_config_id,
    p_shop_id,
    row.campaign_id,
    p_period_start,
    p_period_end,
    COALESCE(row.impressions, 0),
    COALESCE(row.clicks, 0),
    COALESCE(row.expense, 0),
    COALESCE(row.broad_gmv, 0),
    COALESCE(row.broad_order, 0),
    COALESCE(row.broad_order_amount, 0),
    COALESCE(row.broad_roas, 0),
    COALESCE(row.broad_acos, 0),
    COALESCE(row.conversion_rate, 0),
    COALESCE(row.cost_per_conversion, 0),
    COALESCE(row.direct_order, 0),
    COALESCE(row.direct_order_amount, 0),
    COALESCE(row.direct_roas, 0),
    COALESCE(row.direct_acos, 0),
    COALESCE(row.direct_conversion_rate, 0),
    COALESCE(row.cost_per_direct_conversion, 0),
    COALESCE(row.raw_payload, '{}'::JSONB),
    p_sync_batch_id,
    NOW()
  FROM jsonb_to_recordset(COALESCE(p_campaign_rows, '[]'::JSONB)) AS row(
    campaign_id BIGINT,
    impressions NUMERIC,
    clicks BIGINT,
    expense NUMERIC,
    broad_gmv NUMERIC,
    broad_order BIGINT,
    broad_order_amount BIGINT,
    broad_roas NUMERIC,
    broad_acos NUMERIC,
    conversion_rate NUMERIC,
    cost_per_conversion NUMERIC,
    direct_order BIGINT,
    direct_order_amount BIGINT,
    direct_roas NUMERIC,
    direct_acos NUMERIC,
    direct_conversion_rate NUMERIC,
    cost_per_direct_conversion NUMERIC,
    raw_payload JSONB
  )
  WHERE row.campaign_id > 0;
  GET DIAGNOSTICS v_campaign_count = ROW_COUNT;

  INSERT INTO public.shopee_gms_item_period_metrics (
    workspace_id,
    shop_config_id,
    shop_id,
    campaign_id,
    item_id,
    period_start,
    period_end,
    impressions,
    clicks,
    expense,
    broad_gmv,
    broad_order,
    broad_order_amount,
    broad_roas,
    broad_acos,
    conversion_rate,
    cost_per_conversion,
    direct_order,
    direct_order_amount,
    direct_roas,
    direct_acos,
    direct_conversion_rate,
    cost_per_direct_conversion,
    raw_payload,
    sync_batch_id,
    updated_at
  )
  SELECT
    p_workspace_id,
    p_shop_config_id,
    p_shop_id,
    row.campaign_id,
    row.item_id,
    p_period_start,
    p_period_end,
    COALESCE(row.impressions, 0),
    COALESCE(row.clicks, 0),
    COALESCE(row.expense, 0),
    COALESCE(row.broad_gmv, 0),
    COALESCE(row.broad_order, 0),
    COALESCE(row.broad_order_amount, 0),
    COALESCE(row.broad_roas, 0),
    COALESCE(row.broad_acos, 0),
    COALESCE(row.conversion_rate, 0),
    COALESCE(row.cost_per_conversion, 0),
    COALESCE(row.direct_order, 0),
    COALESCE(row.direct_order_amount, 0),
    COALESCE(row.direct_roas, 0),
    COALESCE(row.direct_acos, 0),
    COALESCE(row.direct_conversion_rate, 0),
    COALESCE(row.cost_per_direct_conversion, 0),
    COALESCE(row.raw_payload, '{}'::JSONB),
    p_sync_batch_id,
    NOW()
  FROM jsonb_to_recordset(COALESCE(p_item_rows, '[]'::JSONB)) AS row(
    campaign_id BIGINT,
    item_id BIGINT,
    impressions BIGINT,
    clicks BIGINT,
    expense NUMERIC,
    broad_gmv NUMERIC,
    broad_order BIGINT,
    broad_order_amount BIGINT,
    broad_roas NUMERIC,
    broad_acos NUMERIC,
    conversion_rate NUMERIC,
    cost_per_conversion NUMERIC,
    direct_order BIGINT,
    direct_order_amount BIGINT,
    direct_roas NUMERIC,
    direct_acos NUMERIC,
    direct_conversion_rate NUMERIC,
    cost_per_direct_conversion NUMERIC,
    raw_payload JSONB
  )
  WHERE row.campaign_id > 0
    AND row.item_id > 0
    AND EXISTS (
      SELECT 1
      FROM public.shopee_gms_campaign_period_metrics campaign
      WHERE campaign.workspace_id = p_workspace_id
        AND campaign.shop_config_id = p_shop_config_id
        AND campaign.campaign_id = row.campaign_id
        AND campaign.period_start = p_period_start
        AND campaign.period_end = p_period_end
        AND campaign.sync_batch_id = p_sync_batch_id
    );
  GET DIAGNOSTICS v_item_count = ROW_COUNT;

  IF v_campaign_count <> jsonb_array_length(p_campaign_rows)
     OR v_item_count <> jsonb_array_length(p_item_rows) THEN
    RAISE EXCEPTION 'Shop GMV Max snapshot contains invalid campaign or item identifiers';
  END IF;

  RETURN v_campaign_count + v_item_count;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_shopee_gms_period_snapshot(
  UUID, INT, BIGINT, DATE, DATE, UUID, JSONB, JSONB
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_shopee_gms_period_snapshot(
  UUID, INT, BIGINT, DATE, DATE, UUID, JSONB, JSONB
) TO service_role;
