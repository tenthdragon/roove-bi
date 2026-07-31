-- ============================================================================
-- 175: Generic, blank-slate workspace provisioning
-- ============================================================================
-- Workspaces are tenants, not brand-specific code paths. Provisioning creates
-- only the tenant shell, its owner membership, permission matrix and warehouse
-- configuration. Business data, people, integrations, products and stock are
-- deliberately not copied from an existing workspace.
-- ============================================================================

BEGIN;

-- Normalize the two workspaces that pre-date the generic provisioning flow.
-- Roove keeps its established warehouse reconciliation and legacy import/cost
-- behavior. Apurva and every new workspace use the isolated model.
UPDATE public.workspaces
SET settings = (
      COALESCE(settings, '{}'::jsonb)
      - 'rollout_blocked_tabs'
      - 'shared_warehouse_code'
    ) || jsonb_build_object(
      'tenant_model', 'isolated',
      'tenant_schema_version', 1,
      'disabled_modules', '[]'::jsonb,
      'warehouse_mode', 'independent',
      'warehouse_reconcile_mode', CASE
        WHEN id = '00000000-0000-4000-8000-000000000001'::uuid
          THEN 'legacy_attribution'
        ELSE 'strict_mapping'
      END,
      'cost_model', CASE
        WHEN id = '00000000-0000-4000-8000-000000000001'::uuid
          THEN 'legacy_monthly_overhead'
        ELSE 'detailed_fixed_costs'
      END,
      'legacy_order_csv_enabled',
        id = '00000000-0000-4000-8000-000000000001'::uuid,
      'legacy_cashflow_snapshot_enabled',
        id = '00000000-0000-4000-8000-000000000001'::uuid,
      'legacy_product_keywords_enabled',
        id = '00000000-0000-4000-8000-000000000001'::uuid
    ),
    updated_at = NOW()
WHERE id IN (
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000002'::uuid
);

-- Convert Roove's historical process.env fallback into ordinary tenant
-- integration records before the application removes ID-based fallback logic.
INSERT INTO public.workspace_integrations (
  workspace_id,
  provider,
  external_account_id,
  display_name,
  credential_reference,
  config,
  is_active
)
VALUES
  (
    '00000000-0000-4000-8000-000000000001'::uuid,
    'meta',
    'default',
    'Roove Meta',
    'META_ACCESS_TOKEN',
    '{"business_id_reference":"META_BUSINESS_ID"}'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000001'::uuid,
    'whatsapp',
    'default',
    'Roove WhatsApp',
    'WHATSAPP_ACCESS_TOKEN',
    '{}'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000001'::uuid,
    'telegram',
    'default',
    'Roove Telegram',
    'TELEGRAM_BOT_TOKEN',
    '{"chat_id_reference":"TELEGRAM_CHAT_ID","webhook_secret_reference":"TELEGRAM_WEBHOOK_SECRET"}'::jsonb,
    true
  )
ON CONFLICT (workspace_id, provider, external_account_id) DO UPDATE
SET credential_reference = EXCLUDED.credential_reference,
    config = COALESCE(public.workspace_integrations.config, '{}'::jsonb)
      || EXCLUDED.config,
    is_active = true,
    updated_at = NOW();

-- Natural keys on tenant-owned configuration must include workspace_id. The
-- original tables pre-date workspaces, so their global UNIQUE constraints
-- would otherwise make a blank workspace collide with another company.
ALTER TABLE IF EXISTS public.warehouse_business_mapping
  DROP CONSTRAINT IF EXISTS warehouse_business_mapping_business_code_fkey,
  DROP CONSTRAINT IF EXISTS warehouse_business_mapping_workspace_business_fkey;
ALTER TABLE IF EXISTS public.shopee_shops
  DROP CONSTRAINT IF EXISTS shopee_shops_account_business_code_fkey,
  DROP CONSTRAINT IF EXISTS shopee_shops_viewer_business_code_fkey,
  DROP CONSTRAINT IF EXISTS shopee_shops_revenue_business_code_fkey,
  DROP CONSTRAINT IF EXISTS shopee_shops_default_owner_business_code_fkey,
  DROP CONSTRAINT IF EXISTS shopee_shops_default_processor_business_code_fkey,
  DROP CONSTRAINT IF EXISTS shopee_shops_account_workspace_business_fkey,
  DROP CONSTRAINT IF EXISTS shopee_shops_viewer_workspace_business_fkey,
  DROP CONSTRAINT IF EXISTS shopee_shops_revenue_workspace_business_fkey,
  DROP CONSTRAINT IF EXISTS shopee_shops_owner_workspace_business_fkey,
  DROP CONSTRAINT IF EXISTS shopee_shops_processor_workspace_business_fkey;
ALTER TABLE IF EXISTS public.daily_ads_spend
  DROP CONSTRAINT IF EXISTS daily_ads_spend_business_code_fkey,
  DROP CONSTRAINT IF EXISTS daily_ads_spend_workspace_business_fkey;

ALTER TABLE IF EXISTS public.scalev_webhook_businesses
  DROP CONSTRAINT IF EXISTS scalev_webhook_businesses_business_code_key;

DO $$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT c.relname AS table_name, con.conname AS constraint_name
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND con.contype = 'u'
      AND (
        (
          c.relname = 'marketplace_intake_manual_memory'
          AND ARRAY(
            SELECT a.attname::text
            FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
            JOIN pg_attribute a
              ON a.attrelid = con.conrelid
             AND a.attnum = key.attnum
            ORDER BY key.ord
          ) = ARRAY['source_key', 'business_code', 'match_signature']::text[]
        )
        OR (
          c.relname = 'marketplace_intake_source_store_scopes'
          AND ARRAY(
            SELECT a.attname::text
            FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
            JOIN pg_attribute a
              ON a.attrelid = con.conrelid
             AND a.attnum = key.attnum
            ORDER BY key.ord
          ) = ARRAY['source_key', 'store_name']::text[]
        )
        OR (
          c.relname = 'scalev_catalog_bundle_store_links'
          AND ARRAY(
            SELECT a.attname::text
            FROM unnest(con.conkey) WITH ORDINALITY AS key(attnum, ord)
            JOIN pg_attribute a
              ON a.attrelid = con.conrelid
             AND a.attnum = key.attnum
            ORDER BY key.ord
          ) = ARRAY['business_id', 'scalev_bundle_id', 'store_name']::text[]
        )
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT %I',
      v_constraint.table_name,
      v_constraint.constraint_name
    );
  END LOOP;
END
$$;

-- A store label, product alias and WhatsApp template identifier are all
-- tenant-local inputs. Preserve the existing rows while replacing their
-- pre-workspace global keys.
DO $$
DECLARE
  v_table text;
  v_constraint record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'ads_store_brand_mapping',
    'product_mapping'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      CONTINUE;
    END IF;
    FOR v_constraint IN
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = to_regclass('public.' || v_table)
        AND contype = 'u'
    LOOP
      EXECUTE format(
        'ALTER TABLE public.%I DROP CONSTRAINT %I',
        v_table,
        v_constraint.conname
      );
    END LOOP;
  END LOOP;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ads_store_brand_workspace_pattern
  ON public.ads_store_brand_mapping (workspace_id, store_pattern);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_mapping_workspace_name
  ON public.product_mapping (workspace_id, product_name);

ALTER TABLE public.waba_template_daily_analytics
  DROP CONSTRAINT IF EXISTS waba_template_daily_analytics_pkey;
ALTER TABLE public.waba_template_daily_analytics
  ADD PRIMARY KEY (workspace_id, template_id, date);
ALTER TABLE public.waba_templates
  DROP CONSTRAINT IF EXISTS waba_templates_pkey;
ALTER TABLE public.waba_templates
  ADD PRIMARY KEY (workspace_id, id);
ALTER TABLE public.tax_formula_config
  DROP CONSTRAINT IF EXISTS tax_formula_config_pkey;
ALTER TABLE public.tax_formula_config
  ADD PRIMARY KEY (workspace_id, store_type);

DROP INDEX IF EXISTS public.idx_marketplace_intake_batches_unique_fingerprint;
CREATE UNIQUE INDEX idx_marketplace_intake_batches_unique_fingerprint
  ON public.marketplace_intake_batches (
    workspace_id,
    source_key,
    business_code,
    batch_fingerprint
  )
  WHERE batch_fingerprint IS NOT NULL;

-- A parser family is an application capability; a source is tenant
-- configuration. New workspaces therefore receive no source rows. Owners add
-- only the platform/business pairs their company actually operates.
CREATE TABLE IF NOT EXISTS public.marketplace_intake_sources (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  source_label text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('shopee', 'tiktok', 'blibli', 'lazada')),
  business_id bigint NOT NULL REFERENCES public.scalev_webhook_businesses(id) ON DELETE RESTRICT,
  business_code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, source_key),
  UNIQUE (workspace_id, platform, business_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_intake_sources_workspace_active
  ON public.marketplace_intake_sources (workspace_id, is_active, platform);

DROP TRIGGER IF EXISTS set_updated_at_marketplace_intake_sources
  ON public.marketplace_intake_sources;
CREATE TRIGGER set_updated_at_marketplace_intake_sources
  BEFORE UPDATE ON public.marketplace_intake_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_workspace_updated_at();

ALTER TABLE public.marketplace_intake_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS marketplace_intake_sources_read
  ON public.marketplace_intake_sources;
CREATE POLICY marketplace_intake_sources_read
  ON public.marketplace_intake_sources
  FOR SELECT TO authenticated
  USING (public.workspace_can_access(workspace_id));
DROP POLICY IF EXISTS marketplace_intake_sources_manage
  ON public.marketplace_intake_sources;
CREATE POLICY marketplace_intake_sources_manage
  ON public.marketplace_intake_sources
  FOR ALL TO authenticated
  USING (public.workspace_has_role(workspace_id, ARRAY['workspace_owner']))
  WITH CHECK (public.workspace_has_role(workspace_id, ARRAY['workspace_owner']));

WITH legacy_sources(source_key, source_label, platform, business_code) AS (
  VALUES
    ('shopee_rlt', 'Shopee RLT', 'shopee', 'RLT'),
    ('shopee_jhn', 'Shopee JHN', 'shopee', 'JHN'),
    ('tiktok_rti', 'TikTok RTI', 'tiktok', 'RTI'),
    ('tiktok_jhn', 'TikTok JHN', 'tiktok', 'JHN'),
    ('blibli_rti', 'Blibli RTI', 'blibli', 'RTI'),
    ('lazada_rlt', 'Lazada RLT', 'lazada', 'RLT')
)
INSERT INTO public.marketplace_intake_sources (
  workspace_id,
  source_key,
  source_label,
  platform,
  business_id,
  business_code,
  is_active
)
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  legacy_sources.source_key,
  legacy_sources.source_label,
  legacy_sources.platform,
  business.id,
  legacy_sources.business_code,
  true
FROM legacy_sources
JOIN public.scalev_webhook_businesses business
  ON business.workspace_id = '00000000-0000-4000-8000-000000000001'::uuid
 AND business.business_code = legacy_sources.business_code
ON CONFLICT (workspace_id, source_key) DO UPDATE
SET source_label = EXCLUDED.source_label,
    business_id = EXCLUDED.business_id,
    business_code = EXCLUDED.business_code,
    updated_at = NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_scalev_businesses_workspace_code
  ON public.scalev_webhook_businesses (workspace_id, business_code);

ALTER TABLE public.warehouse_business_mapping
  ADD CONSTRAINT warehouse_business_mapping_workspace_business_fkey
  FOREIGN KEY (workspace_id, business_code)
  REFERENCES public.scalev_webhook_businesses (workspace_id, business_code)
  ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.shopee_shops
  ADD CONSTRAINT shopee_shops_account_workspace_business_fkey
    FOREIGN KEY (workspace_id, account_business_code)
    REFERENCES public.scalev_webhook_businesses (workspace_id, business_code)
    ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT shopee_shops_viewer_workspace_business_fkey
    FOREIGN KEY (workspace_id, viewer_business_code)
    REFERENCES public.scalev_webhook_businesses (workspace_id, business_code)
    ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT shopee_shops_revenue_workspace_business_fkey
    FOREIGN KEY (workspace_id, revenue_business_code)
    REFERENCES public.scalev_webhook_businesses (workspace_id, business_code)
    ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT shopee_shops_owner_workspace_business_fkey
    FOREIGN KEY (workspace_id, default_owner_business_code)
    REFERENCES public.scalev_webhook_businesses (workspace_id, business_code)
    ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT shopee_shops_processor_workspace_business_fkey
    FOREIGN KEY (workspace_id, default_processor_business_code)
    REFERENCES public.scalev_webhook_businesses (workspace_id, business_code)
    ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.daily_ads_spend
  ADD CONSTRAINT daily_ads_spend_workspace_business_fkey
  FOREIGN KEY (workspace_id, business_code)
  REFERENCES public.scalev_webhook_businesses (workspace_id, business_code)
  ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_manual_memory_workspace_identity
  ON public.marketplace_intake_manual_memory (
    workspace_id,
    source_key,
    business_code,
    match_signature
  );
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_source_scope_workspace_store
  ON public.marketplace_intake_source_store_scopes (
    workspace_id,
    source_key,
    store_name
  );

-- ScaleV's CSV warehouse label is integration configuration, not application
-- code. It belongs to a workspace source + store and is intentionally blank in
-- every new workspace until that tenant configures it.
ALTER TABLE public.marketplace_intake_source_store_scopes
  ADD COLUMN IF NOT EXISTS scalev_warehouse_name text;

-- Preserve Roove's established export behavior as ordinary tenant data. This
-- is the only compatibility seed; provisioning never copies these rows.
WITH legacy_scope(source_key, business_code, platform, store_name, scalev_warehouse_name) AS (
  VALUES
    ('shopee_rlt', 'RLT', 'shopee', 'Purvu The Secret Store - Markerplace', 'Jejak Herba Nusantara''s Warehouse'),
    ('shopee_rlt', 'RLT', 'shopee', 'Roove Main Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('shopee_rlt', 'RLT', 'shopee', 'Globite Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('shopee_rlt', 'RLT', 'shopee', 'Pluve Main Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('shopee_rlt', 'RLT', 'shopee', 'Purvu Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('shopee_rlt', 'RLT', 'shopee', 'YUV Deodorant Serum Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('shopee_rlt', 'RLT', 'shopee', 'Osgard Oil Store', 'Roove Lautan Barat''s Warehouse'),
    ('shopee_rlt', 'RLT', 'shopee', 'drHyun Main Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('shopee_rlt', 'RLT', 'shopee', 'Calmara Main Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('shopee_jhn', 'JHN', 'shopee', 'Purvu Store', 'Jejak Herba Nusantara''s Warehouse'),
    ('shopee_jhn', 'JHN', 'shopee', 'Purvu The Secret Store', 'Jejak Herba Nusantara''s Warehouse'),
    ('shopee_jhn', 'JHN', 'shopee', 'drHyun Main Store', 'Jejak Herba Nusantara''s Warehouse'),
    ('shopee_jhn', 'JHN', 'shopee', 'Calmara Main Store', 'Jejak Herba Nusantara''s Warehouse'),
    ('tiktok_rti', 'RTI', 'tiktok', 'Purvu The Secret Store - Markerplace', 'Jejak Herba Nusantara''s Warehouse'),
    ('tiktok_rti', 'RTI', 'tiktok', 'Roove Main Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('tiktok_rti', 'RTI', 'tiktok', 'Globite Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('tiktok_rti', 'RTI', 'tiktok', 'Pluve Main Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('tiktok_rti', 'RTI', 'tiktok', 'Purvu Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('tiktok_rti', 'RTI', 'tiktok', 'YUV Deodorant Serum Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('tiktok_rti', 'RTI', 'tiktok', 'Osgard Oil Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('tiktok_rti', 'RTI', 'tiktok', 'drHyun Main Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('tiktok_rti', 'RTI', 'tiktok', 'Osgard Oil Store', 'Roove Lautan Barat''s Warehouse'),
    ('tiktok_jhn', 'JHN', 'tiktok', 'Purvu Store', 'Jejak Herba Nusantara''s Warehouse'),
    ('tiktok_jhn', 'JHN', 'tiktok', 'Purvu The Secret Store', 'Jejak Herba Nusantara''s Warehouse'),
    ('tiktok_jhn', 'JHN', 'tiktok', 'drHyun Main Store', 'Jejak Herba Nusantara''s Warehouse'),
    ('tiktok_jhn', 'JHN', 'tiktok', 'Calmara Main Store', 'Jejak Herba Nusantara''s Warehouse'),
    ('blibli_rti', 'RTI', 'blibli', 'Roove Main Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('blibli_rti', 'RTI', 'blibli', 'Globite Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('blibli_rti', 'RTI', 'blibli', 'Pluve Main Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('blibli_rti', 'RTI', 'blibli', 'Purvu Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('blibli_rti', 'RTI', 'blibli', 'Purvu The Secret Store - Markerplace', 'Jejak Herba Nusantara''s Warehouse'),
    ('lazada_rlt', 'RLT', 'lazada', 'Roove Main Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('lazada_rlt', 'RLT', 'lazada', 'Globite Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('lazada_rlt', 'RLT', 'lazada', 'Pluve Main Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('lazada_rlt', 'RLT', 'lazada', 'Purvu Store - Marketplace', 'Roove Lautan Barat''s Warehouse'),
    ('lazada_rlt', 'RLT', 'lazada', 'Purvu The Secret Store - Markerplace', 'Jejak Herba Nusantara''s Warehouse'),
    ('lazada_rlt', 'RLT', 'lazada', 'Osgard Oil Store', 'Roove Lautan Barat''s Warehouse')
)
INSERT INTO public.marketplace_intake_source_store_scopes (
  workspace_id,
  source_key,
  business_id,
  business_code,
  platform,
  store_name,
  is_enabled,
  scalev_warehouse_name
)
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  legacy_scope.source_key,
  business.id,
  legacy_scope.business_code,
  legacy_scope.platform,
  legacy_scope.store_name,
  true,
  legacy_scope.scalev_warehouse_name
FROM legacy_scope
JOIN public.scalev_webhook_businesses business
  ON business.workspace_id = '00000000-0000-4000-8000-000000000001'::uuid
 AND business.business_code = legacy_scope.business_code
ON CONFLICT (workspace_id, source_key, store_name) DO UPDATE
SET scalev_warehouse_name = COALESCE(
      public.marketplace_intake_source_store_scopes.scalev_warehouse_name,
      EXCLUDED.scalev_warehouse_name
    ),
    updated_at = NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_bundle_store_links_workspace_identity
  ON public.scalev_catalog_bundle_store_links (
    workspace_id,
    business_id,
    scalev_bundle_id,
    store_name
  );

-- Entity codes belong to a workspace configuration. A global CHECK containing
-- today's company codes would force a schema migration for every future tenant.
ALTER TABLE IF EXISTS public.warehouse_products
  DROP CONSTRAINT IF EXISTS warehouse_products_entity_check;
ALTER TABLE IF EXISTS public.warehouse_business_mapping
  DROP CONSTRAINT IF EXISTS warehouse_business_mapping_deduct_entity_check;
ALTER TABLE IF EXISTS public.warehouse_stock_opname_sessions
  DROP CONSTRAINT IF EXISTS warehouse_stock_opname_sessions_entity_check;

-- Demand-plan identity is tenant-local, just like products and stock.
ALTER TABLE IF EXISTS public.warehouse_demand_plans
  DROP CONSTRAINT IF EXISTS warehouse_demand_plans_warehouse_product_id_month_year_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_demand_plans_workspace_period
  ON public.warehouse_demand_plans (
    workspace_id,
    warehouse_product_id,
    month,
    year
  );

-- PO numbering and relationships are tenant-local. Database triggers protect
-- service-role writers in addition to the application validations.
CREATE OR REPLACE FUNCTION public.generate_po_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_sequence int;
BEGIN
  SELECT COALESCE(MAX(
    NULLIF(SUBSTRING(po_number FROM '-(\d+)$'), '')::int
  ), 0) + 1
  INTO v_sequence
  FROM public.warehouse_purchase_orders
  WHERE workspace_id = NEW.workspace_id
    AND po_date = NEW.po_date;

  NEW.po_number := 'PO-' || TO_CHAR(NEW.po_date, 'YYYYMMDD') || '-'
    || LPAD(v_sequence::text, 3, '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_warehouse_po_workspace()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parent_workspace uuid;
  v_related_workspace uuid;
BEGIN
  IF TG_TABLE_NAME = 'warehouse_purchase_orders' THEN
    SELECT workspace_id INTO v_related_workspace
    FROM public.warehouse_vendors
    WHERE id = NEW.vendor_id;
    IF v_related_workspace IS NULL OR v_related_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'PO vendor does not belong to PO workspace';
    END IF;
    RETURN NEW;
  END IF;

  SELECT workspace_id INTO v_parent_workspace
  FROM public.warehouse_purchase_orders
  WHERE id = NEW.po_id;
  SELECT owner_workspace_id INTO v_related_workspace
  FROM public.warehouse_products
  WHERE id = NEW.warehouse_product_id;
  IF v_parent_workspace IS NULL
     OR v_related_workspace IS NULL
     OR NEW.workspace_id <> v_parent_workspace
     OR NEW.workspace_id <> v_related_workspace THEN
    RAISE EXCEPTION 'PO item workspace does not match its PO and product';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_workspace_warehouse_purchase_orders
  ON public.warehouse_purchase_orders;
CREATE TRIGGER enforce_workspace_warehouse_purchase_orders
  BEFORE INSERT OR UPDATE OF workspace_id, vendor_id
  ON public.warehouse_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_warehouse_po_workspace();

DROP TRIGGER IF EXISTS enforce_workspace_warehouse_po_items
  ON public.warehouse_po_items;
CREATE TRIGGER enforce_workspace_warehouse_po_items
  BEFORE INSERT OR UPDATE OF workspace_id, po_id, warehouse_product_id
  ON public.warehouse_po_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_warehouse_po_workspace();

-- Generic parent/child tenant guard. Foreign keys guarantee that a parent
-- exists, but service-role clients bypass RLS; this additionally guarantees
-- that the parent and child belong to the same workspace.
CREATE OR REPLACE FUNCTION public.enforce_workspace_parent_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parent_key text;
  v_parent_exists boolean;
  v_workspace_matches boolean;
BEGIN
  v_parent_key := to_jsonb(NEW) ->> TG_ARGV[1];
  IF v_parent_key IS NULL OR btrim(v_parent_key) = '' THEN
    RETURN NEW;
  END IF;

  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM public.%I WHERE %I::text = $1), EXISTS (SELECT 1 FROM public.%I WHERE %I::text = $1 AND %I = $2)',
    TG_ARGV[2],
    TG_ARGV[3],
    TG_ARGV[2],
    TG_ARGV[3],
    TG_ARGV[4]
  )
  INTO v_parent_exists, v_workspace_matches
  USING v_parent_key, NEW.workspace_id;

  IF NOT v_parent_exists THEN
    RAISE EXCEPTION '% parent % was not found', TG_TABLE_NAME, v_parent_key;
  END IF;
  IF NOT v_workspace_matches THEN
    RAISE EXCEPTION '% workspace does not match its % parent',
      TG_TABLE_NAME,
      TG_ARGV[2];
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_guard record;
  v_trigger_name text;
BEGIN
  FOR v_guard IN
    SELECT *
    FROM (VALUES
      ('scalev_order_lines', 'scalev_order_id', 'scalev_orders', 'id', 'workspace_id'),
      ('scalev_store_channels', 'business_id', 'scalev_webhook_businesses', 'id', 'workspace_id'),
      ('marketplace_intake_sources', 'business_id', 'scalev_webhook_businesses', 'id', 'workspace_id'),
      ('marketplace_intake_source_store_scopes', 'source_key', 'marketplace_intake_sources', 'source_key', 'workspace_id'),
      ('marketplace_intake_source_store_scopes', 'business_id', 'scalev_webhook_businesses', 'id', 'workspace_id'),
      ('scalev_catalog_products', 'business_id', 'scalev_webhook_businesses', 'id', 'workspace_id'),
      ('scalev_catalog_variants', 'business_id', 'scalev_webhook_businesses', 'id', 'workspace_id'),
      ('scalev_catalog_bundles', 'business_id', 'scalev_webhook_businesses', 'id', 'workspace_id'),
      ('scalev_catalog_identifiers', 'business_id', 'scalev_webhook_businesses', 'id', 'workspace_id'),
      ('scalev_catalog_bundle_lines', 'business_id', 'scalev_webhook_businesses', 'id', 'workspace_id'),
      ('scalev_catalog_bundle_store_links', 'business_id', 'scalev_webhook_businesses', 'id', 'workspace_id'),
      ('scalev_catalog_sync_state', 'business_id', 'scalev_webhook_businesses', 'id', 'workspace_id'),
      ('marketplace_intake_batches', 'source_key', 'marketplace_intake_sources', 'source_key', 'workspace_id'),
      ('marketplace_intake_orders', 'batch_id', 'marketplace_intake_batches', 'id', 'workspace_id'),
      ('marketplace_intake_order_lines', 'intake_order_id', 'marketplace_intake_orders', 'id', 'workspace_id'),
      ('shopee_shop_tokens', 'shop_config_id', 'shopee_shops', 'id', 'workspace_id'),
      ('shopee_shop_spend_streams', 'shop_config_id', 'shopee_shops', 'id', 'workspace_id'),
      ('shopee_ads_daily_metrics', 'shop_config_id', 'shopee_shops', 'id', 'workspace_id'),
      ('bank_transactions', 'session_id', 'bank_upload_sessions', 'id', 'workspace_id'),
      ('waba_templates', 'waba_id', 'waba_accounts', 'waba_id', 'workspace_id'),
      ('waba_template_daily_analytics', 'template_id', 'waba_templates', 'id', 'workspace_id'),
      ('warehouse_stock_opname', 'session_id', 'warehouse_stock_opname_sessions', 'id', 'workspace_id'),
      ('warehouse_rts_verifications', 'scalev_order_id', 'scalev_orders', 'id', 'workspace_id'),
      ('warehouse_rts_verification_items', 'verification_id', 'warehouse_rts_verifications', 'id', 'workspace_id')
    ) AS guards(child_table, child_key, parent_table, parent_key, parent_workspace_key)
  LOOP
    IF to_regclass('public.' || v_guard.child_table) IS NULL
       OR to_regclass('public.' || v_guard.parent_table) IS NULL THEN
      CONTINUE;
    END IF;

    v_trigger_name := 'enforce_tenant_parent_'
      || left(v_guard.child_table, 28)
      || '_'
      || left(md5(v_guard.child_key || ':' || v_guard.parent_table), 8);
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON public.%I',
      v_trigger_name,
      v_guard.child_table
    );
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF workspace_id, %I ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_workspace_parent_reference(%L, %L, %L, %L, %L)',
      v_trigger_name,
      v_guard.child_key,
      v_guard.child_table,
      v_guard.child_table,
      v_guard.child_key,
      v_guard.parent_table,
      v_guard.parent_key,
      v_guard.parent_workspace_key
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.provision_workspace(
  p_name text,
  p_slug text,
  p_owner_user_id uuid,
  p_inventory_entity text,
  p_warehouse_code text DEFAULT 'BTN'
)
RETURNS public.workspaces
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_slug text := lower(btrim(COALESCE(p_slug, '')));
  v_entity text := upper(btrim(COALESCE(p_inventory_entity, '')));
  v_warehouse text := upper(btrim(COALESCE(p_warehouse_code, '')));
  v_workspace public.workspaces;
  v_has_default boolean;
BEGIN
  -- This RPC is intentionally service-role only. The application verifies the
  -- authenticated platform owner before invoking it with the service client.
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Workspace provisioning requires the service role';
  END IF;

  IF length(v_name) < 2 OR length(v_name) > 100 THEN
    RAISE EXCEPTION 'Workspace name must contain 2-100 characters';
  END IF;
  IF v_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$' THEN
    RAISE EXCEPTION 'Workspace slug must contain 3-64 lowercase letters, numbers or hyphens';
  END IF;
  IF v_entity !~ '^[A-Z0-9][A-Z0-9_-]{1,15}$' THEN
    RAISE EXCEPTION 'Inventory entity must contain 2-16 letters, numbers, underscores or hyphens';
  END IF;
  IF v_warehouse !~ '^[A-Z0-9][A-Z0-9_-]{1,15}$' THEN
    RAISE EXCEPTION 'Warehouse code must contain 2-16 letters, numbers, underscores or hyphens';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_owner_user_id) THEN
    RAISE EXCEPTION 'Workspace owner user does not exist';
  END IF;

  INSERT INTO public.workspaces (slug, name, status, settings)
  VALUES (
    v_slug,
    v_name,
    'provisioning',
    jsonb_build_object(
      'tenant_model', 'isolated',
      'tenant_schema_version', 1,
      'disabled_modules', '[]'::jsonb,
      'warehouse_mode', 'independent',
      'warehouse_code', v_warehouse,
      'inventory_entity', v_entity,
      'warehouse_reconcile_mode', 'strict_mapping',
      'cost_model', 'detailed_fixed_costs',
      'legacy_order_csv_enabled', false,
      'legacy_cashflow_snapshot_enabled', false,
      'legacy_product_keywords_enabled', false
    )
  )
  RETURNING * INTO v_workspace;

  -- role_permissions is the application-wide template only. Each workspace
  -- receives an independent copy which can subsequently diverge safely.
  INSERT INTO public.workspace_role_permissions (
    workspace_id,
    role,
    permission_key
  )
  SELECT v_workspace.id, role, permission_key
  FROM public.role_permissions
  ON CONFLICT DO NOTHING;

  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships
    WHERE user_id = p_owner_user_id
      AND status = 'active'
      AND is_default = true
  ) INTO v_has_default;

  INSERT INTO public.workspace_memberships (
    workspace_id,
    user_id,
    role,
    status,
    is_default
  )
  VALUES (
    v_workspace.id,
    p_owner_user_id,
    'workspace_owner',
    'active',
    NOT v_has_default
  );

  INSERT INTO public.workspace_warehouse_access (
    workspace_id,
    warehouse_code,
    access_level,
    is_active
  )
  VALUES (v_workspace.id, v_warehouse, 'owner', true);

  UPDATE public.profiles
  SET active_workspace_id = COALESCE(active_workspace_id, v_workspace.id)
  WHERE id = p_owner_user_id;

  UPDATE public.workspaces
  SET status = 'active', updated_at = NOW()
  WHERE id = v_workspace.id
  RETURNING * INTO v_workspace;

  RETURN v_workspace;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_workspace(text, text, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_workspace(text, text, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public.provision_workspace(text, text, uuid, text, text) IS
  'Atomically provisions an empty isolated workspace; callable only by service_role after application owner authorization.';

-- Warehouse/catalog RLS policies call this shared helper. Resolve permissions
-- from the user's active workspace membership, never from the global template.
CREATE OR REPLACE FUNCTION public.dashboard_has_permission(
  p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_owner()
    OR EXISTS (
      SELECT 1
      FROM public.profiles profile
      JOIN public.workspace_memberships membership
        ON membership.workspace_id = profile.active_workspace_id
       AND membership.user_id = profile.id
       AND membership.status = 'active'
      LEFT JOIN public.workspace_role_permissions permission
        ON permission.workspace_id = membership.workspace_id
       AND permission.role = membership.role
       AND permission.permission_key = p_permission_key
      WHERE profile.id = auth.uid()
        AND (
          membership.role = 'workspace_owner'
          OR permission.permission_key IS NOT NULL
        )
    );
$$;

REVOKE ALL ON FUNCTION public.dashboard_has_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_has_permission(text) TO authenticated;

-- Tenant-aware replacements for the legacy Warehouse Settings RPCs. The old
-- zero-argument functions remain temporarily for historical callers, while all
-- application code uses these explicit workspace overloads.
CREATE OR REPLACE FUNCTION public.warehouse_scalev_mapping_frequencies(
  p_workspace_id uuid
)
RETURNS TABLE(product_name text, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT line.product_name, COUNT(*) AS cnt
  FROM public.scalev_order_lines line
  WHERE line.workspace_id = p_workspace_id
    AND line.product_name IS NOT NULL
  GROUP BY line.product_name;
$$;

CREATE OR REPLACE FUNCTION public.warehouse_scalev_price_tiers(
  p_workspace_id uuid
)
RETURNS TABLE(product_name text, price_tier numeric, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    line.product_name,
    ROUND(line.product_price_bt / line.quantity) AS price_tier,
    COUNT(*) AS cnt
  FROM public.scalev_order_lines line
  WHERE line.workspace_id = p_workspace_id
    AND line.product_name IS NOT NULL
    AND line.quantity > 0
    AND line.product_price_bt > 0
  GROUP BY line.product_name, ROUND(line.product_price_bt / line.quantity)
  ORDER BY line.product_name, cnt DESC;
$$;

CREATE OR REPLACE FUNCTION public.warehouse_sync_scalev_names(
  p_workspace_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.warehouse_scalev_mapping (
    workspace_id,
    scalev_product_name
  )
  SELECT DISTINCT p_workspace_id, line.product_name
  FROM public.scalev_order_lines line
  WHERE line.workspace_id = p_workspace_id
    AND line.product_name IS NOT NULL
    AND line.product_name <> ''
  ON CONFLICT (workspace_id, scalev_product_name) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION public.workspace_daily_deduction_summary(
  p_workspace_id uuid,
  p_date date
)
RETURNS TABLE (
  scalev_product text,
  warehouse_product text,
  entity text,
  total_qty numeric,
  order_count bigint,
  business_codes text,
  total_unique_orders bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      (p_date::timestamp AT TIME ZONE 'Asia/Jakarta') AS day_start,
      ((p_date + 1)::timestamp AT TIME ZONE 'Asia/Jakarta') AS day_end
  ), base_rows AS (
    SELECT
      ledger.reference_id,
      ABS(ledger.quantity) AS qty_abs,
      CASE
        WHEN ledger.notes LIKE 'Auto:%'
          OR ledger.notes LIKE 'Backfill:%'
          OR ledger.notes LIKE 'Auto-deduct:%'
          THEN regexp_replace(
            split_part(COALESCE(ledger.notes, ''), ': ', 2),
            ' x[0-9.]+$',
            ''
          )
        ELSE COALESCE(ledger.notes, '-')
      END AS scalev_product,
      product.name AS warehouse_product,
      product.entity,
      order_match.business_code
    FROM public.warehouse_stock_ledger ledger
    JOIN public.warehouse_products product
      ON product.id = ledger.warehouse_product_id
     AND product.owner_workspace_id = p_workspace_id
    CROSS JOIN bounds
    LEFT JOIN LATERAL (
      SELECT orders.business_code
      FROM public.scalev_orders orders
      WHERE orders.workspace_id = p_workspace_id
        AND (
          orders.id = ledger.scalev_order_id
          OR (
            ledger.scalev_order_id IS NULL
            AND orders.order_id = ledger.reference_id
          )
        )
      ORDER BY CASE WHEN orders.id = ledger.scalev_order_id THEN 0 ELSE 1 END
      LIMIT 1
    ) order_match ON TRUE
    WHERE ledger.workspace_id = p_workspace_id
      AND ledger.reference_type = 'scalev_order'
      AND ledger.movement_type = 'OUT'
      AND ledger.created_at >= bounds.day_start
      AND ledger.created_at < bounds.day_end
  ), totals AS (
    SELECT COUNT(DISTINCT reference_id) AS total_unique_orders
    FROM base_rows
  )
  SELECT
    base_rows.scalev_product AS scalev_product,
    base_rows.warehouse_product AS warehouse_product,
    base_rows.entity AS entity,
    COALESCE(SUM(base_rows.qty_abs), 0) AS total_qty,
    COUNT(DISTINCT base_rows.reference_id) AS order_count,
    COALESCE(
      string_agg(
        DISTINCT base_rows.business_code,
        ', ' ORDER BY base_rows.business_code
      ),
      ''
    ) AS business_codes,
    totals.total_unique_orders AS total_unique_orders
  FROM base_rows
  CROSS JOIN totals
  GROUP BY base_rows.scalev_product, base_rows.warehouse_product,
    base_rows.entity, totals.total_unique_orders
  ORDER BY COALESCE(SUM(base_rows.qty_abs), 0) DESC, base_rows.scalev_product,
    base_rows.warehouse_product;
$$;

REVOKE ALL ON FUNCTION public.warehouse_scalev_mapping_frequencies(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.warehouse_scalev_price_tiers(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.warehouse_sync_scalev_names(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_daily_deduction_summary(uuid, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.warehouse_scalev_mapping_frequencies(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.warehouse_scalev_price_tiers(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.warehouse_sync_scalev_names(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_daily_deduction_summary(uuid, date)
  TO service_role;

-- PPIC read models use explicit workspace overloads. Their joins include the
-- tenant key on every fact, mapping and product table so equal product names in
-- two workspaces never merge into one demand signal.
CREATE OR REPLACE FUNCTION public.ppic_monthly_demand(
  p_workspace_id uuid,
  p_months int DEFAULT 6
)
RETURNS TABLE (
  warehouse_product_id int,
  product_name text,
  entity text,
  category text,
  yr int,
  mn int,
  total_qty numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    product.id,
    product.name,
    product.entity,
    product.category,
    EXTRACT(YEAR FROM orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::int,
    EXTRACT(MONTH FROM orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::int,
    SUM(COALESCE(line.quantity, 0) * COALESCE(mapping.deduct_qty_multiplier, 1))
  FROM public.scalev_orders orders
  JOIN public.scalev_order_lines line
    ON line.workspace_id = p_workspace_id
   AND line.scalev_order_id = orders.id
  JOIN public.warehouse_scalev_mapping mapping
    ON mapping.workspace_id = p_workspace_id
   AND mapping.scalev_product_name = line.product_name
   AND mapping.warehouse_product_id IS NOT NULL
   AND mapping.is_ignored = false
  JOIN public.warehouse_products product
    ON product.id = mapping.warehouse_product_id
   AND product.owner_workspace_id = p_workspace_id
  WHERE orders.workspace_id = p_workspace_id
    AND orders.status IN ('shipped', 'completed')
    AND orders.shipped_time IS NOT NULL
    AND (orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::date >= (
      ((NOW() AT TIME ZONE 'Asia/Jakarta')::date)
      - (GREATEST(p_months, 1) || ' months')::interval
    )::date
  GROUP BY product.id, product.name, product.entity, product.category,
    EXTRACT(YEAR FROM orders.shipped_time AT TIME ZONE 'Asia/Jakarta'),
    EXTRACT(MONTH FROM orders.shipped_time AT TIME ZONE 'Asia/Jakarta')
  ORDER BY 5 DESC, 6 DESC, product.name;
$$;

CREATE OR REPLACE FUNCTION public.ppic_avg_daily_demand(
  p_workspace_id uuid,
  p_days int DEFAULT 90
)
RETURNS TABLE (
  warehouse_product_id int,
  product_name text,
  entity text,
  category text,
  total_qty numeric,
  num_days int,
  avg_daily numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      GREATEST(p_days, 1) AS days,
      (NOW() AT TIME ZONE 'Asia/Jakarta')::date AS end_date
  )
  SELECT
    product.id,
    product.name,
    product.entity,
    product.category,
    SUM(COALESCE(line.quantity, 0) * COALESCE(mapping.deduct_qty_multiplier, 1)),
    bounds.days,
    ROUND(
      SUM(COALESCE(line.quantity, 0) * COALESCE(mapping.deduct_qty_multiplier, 1))
      / bounds.days::numeric,
      2
    )
  FROM bounds
  JOIN public.scalev_orders orders
    ON orders.workspace_id = p_workspace_id
   AND orders.status IN ('shipped', 'completed')
   AND orders.shipped_time IS NOT NULL
   AND (orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::date
     BETWEEN bounds.end_date - (bounds.days - 1) AND bounds.end_date
  JOIN public.scalev_order_lines line
    ON line.workspace_id = p_workspace_id
   AND line.scalev_order_id = orders.id
  JOIN public.warehouse_scalev_mapping mapping
    ON mapping.workspace_id = p_workspace_id
   AND mapping.scalev_product_name = line.product_name
   AND mapping.warehouse_product_id IS NOT NULL
   AND mapping.is_ignored = false
  JOIN public.warehouse_products product
    ON product.id = mapping.warehouse_product_id
   AND product.owner_workspace_id = p_workspace_id
  GROUP BY product.id, product.name, product.entity, product.category, bounds.days
  ORDER BY 7 DESC;
$$;

CREATE OR REPLACE FUNCTION public.ppic_weekly_demand_scalev(
  p_workspace_id uuid,
  p_month_start timestamptz,
  p_month_end timestamptz
)
RETURNS TABLE (
  warehouse_product_id int,
  week_num int,
  total_out numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    mapping.warehouse_product_id,
    CASE
      WHEN EXTRACT(DAY FROM orders.shipped_time AT TIME ZONE 'Asia/Jakarta') <= 7 THEN 1
      WHEN EXTRACT(DAY FROM orders.shipped_time AT TIME ZONE 'Asia/Jakarta') <= 14 THEN 2
      WHEN EXTRACT(DAY FROM orders.shipped_time AT TIME ZONE 'Asia/Jakarta') <= 21 THEN 3
      ELSE 4
    END::int,
    SUM(COALESCE(line.quantity, 0) * COALESCE(mapping.deduct_qty_multiplier, 1))
  FROM public.scalev_orders orders
  JOIN public.scalev_order_lines line
    ON line.workspace_id = p_workspace_id
   AND line.scalev_order_id = orders.id
  JOIN public.warehouse_scalev_mapping mapping
    ON mapping.workspace_id = p_workspace_id
   AND mapping.scalev_product_name = line.product_name
   AND mapping.warehouse_product_id IS NOT NULL
   AND mapping.is_ignored = false
  JOIN public.warehouse_products product
    ON product.id = mapping.warehouse_product_id
   AND product.owner_workspace_id = p_workspace_id
  WHERE orders.workspace_id = p_workspace_id
    AND orders.status IN ('shipped', 'completed')
    AND orders.shipped_time IS NOT NULL
    AND (orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::date BETWEEN
      (p_month_start AT TIME ZONE 'Asia/Jakarta')::date
      AND (p_month_end AT TIME ZONE 'Asia/Jakarta')::date
  GROUP BY mapping.warehouse_product_id, 2
  ORDER BY mapping.warehouse_product_id, 2;
$$;

CREATE OR REPLACE FUNCTION public.ppic_monthly_movements(
  p_workspace_id uuid,
  p_months int DEFAULT 6
)
RETURNS TABLE (
  warehouse_product_id int,
  product_name text,
  entity text,
  category text,
  yr int,
  mn int,
  total_in numeric,
  total_out numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    product.id,
    product.name,
    product.entity,
    product.category,
    EXTRACT(YEAR FROM ledger.created_at AT TIME ZONE 'Asia/Jakarta')::int,
    EXTRACT(MONTH FROM ledger.created_at AT TIME ZONE 'Asia/Jakarta')::int,
    SUM(CASE WHEN ledger.movement_type = 'IN' THEN ledger.quantity ELSE 0 END),
    SUM(CASE WHEN ledger.movement_type IN ('OUT', 'DISPOSE', 'TRANSFER_OUT') THEN ABS(ledger.quantity) ELSE 0 END)
  FROM public.warehouse_stock_ledger ledger
  JOIN public.warehouse_products product
    ON product.id = ledger.warehouse_product_id
   AND product.owner_workspace_id = p_workspace_id
  WHERE ledger.workspace_id = p_workspace_id
    AND ledger.created_at >= NOW() - (GREATEST(p_months, 1) || ' months')::interval
  GROUP BY product.id, product.name, product.entity, product.category,
    EXTRACT(YEAR FROM ledger.created_at AT TIME ZONE 'Asia/Jakarta'),
    EXTRACT(MONTH FROM ledger.created_at AT TIME ZONE 'Asia/Jakarta')
  ORDER BY 5 DESC, 6 DESC, product.name;
$$;

CREATE OR REPLACE FUNCTION public.ppic_monthly_movements_scalev(
  p_workspace_id uuid,
  p_months int DEFAULT 6
)
RETURNS TABLE (
  warehouse_product_id int,
  product_name text,
  entity text,
  category text,
  yr int,
  mn int,
  total_in numeric,
  total_out numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    mapping.warehouse_product_id,
    product.name,
    product.entity,
    product.category,
    EXTRACT(YEAR FROM orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::int,
    EXTRACT(MONTH FROM orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::int,
    0::numeric,
    SUM(COALESCE(line.quantity, 0) * COALESCE(mapping.deduct_qty_multiplier, 1))
  FROM public.scalev_orders orders
  JOIN public.scalev_order_lines line
    ON line.workspace_id = p_workspace_id
   AND line.scalev_order_id = orders.id
  JOIN public.warehouse_scalev_mapping mapping
    ON mapping.workspace_id = p_workspace_id
   AND mapping.scalev_product_name = line.product_name
   AND mapping.warehouse_product_id IS NOT NULL
   AND mapping.is_ignored = false
  JOIN public.warehouse_products product
    ON product.id = mapping.warehouse_product_id
   AND product.owner_workspace_id = p_workspace_id
  WHERE orders.workspace_id = p_workspace_id
    AND orders.status IN ('shipped', 'completed')
    AND orders.shipped_time IS NOT NULL
    AND (
      EXTRACT(YEAR FROM orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::int * 100
      + EXTRACT(MONTH FROM orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::int
    ) >= (
      EXTRACT(YEAR FROM NOW() - (GREATEST(p_months, 1) || ' months')::interval)::int * 100
      + EXTRACT(MONTH FROM NOW() - (GREATEST(p_months, 1) || ' months')::interval)::int
    )
  GROUP BY mapping.warehouse_product_id, product.name, product.entity, product.category,
    EXTRACT(YEAR FROM orders.shipped_time AT TIME ZONE 'Asia/Jakarta'),
    EXTRACT(MONTH FROM orders.shipped_time AT TIME ZONE 'Asia/Jakarta')
  ORDER BY 5 DESC, 6 DESC, product.name;
$$;

REVOKE ALL ON FUNCTION public.ppic_monthly_demand(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ppic_avg_daily_demand(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ppic_weekly_demand_scalev(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ppic_monthly_movements(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ppic_monthly_movements_scalev(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ppic_monthly_demand(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.ppic_avg_daily_demand(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.ppic_weekly_demand_scalev(uuid, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.ppic_monthly_movements(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.ppic_monthly_movements_scalev(uuid, int) TO service_role;

-- Customer and brand analytics use one live, tenant-scoped source of truth.
-- The older materialized views remain available to historical reports, but
-- application reads no longer depend on a global cache or its refresh cycle.
CREATE OR REPLACE FUNCTION public.workspace_customer_order_facts(
  p_workspace_id uuid
)
RETURNS TABLE (
  order_db_id bigint,
  external_order_id text,
  customer_identifier text,
  customer_name text,
  customer_phone text,
  platform text,
  shipped_time timestamptz,
  order_date date,
  sales_channel text,
  product_type text,
  line_revenue numeric,
  line_cogs numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  SELECT
    orders.id::bigint,
    orders.order_id,
    orders.customer_identifier,
    orders.customer_name,
    orders.customer_phone,
    orders.platform,
    orders.shipped_time,
    (orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::date,
    COALESCE(NULLIF(btrim(line.sales_channel), ''), 'Unknown'),
    line.product_type,
    COALESCE(line.product_price_bt, 0) - COALESCE(line.discount_bt, 0),
    COALESCE(line.cogs_bt, 0)
  FROM public.scalev_orders orders
  JOIN public.scalev_order_lines line
    ON line.workspace_id = p_workspace_id
   AND line.scalev_order_id = orders.id
  WHERE orders.workspace_id = p_workspace_id
    AND orders.status IN ('shipped', 'completed')
    AND orders.shipped_time IS NOT NULL
    AND line.product_type IS NOT NULL
    AND line.product_type NOT IN ('Unknown', 'Other');
$$;

CREATE OR REPLACE FUNCTION public.get_customer_type_daily_exact(
  p_workspace_id uuid,
  p_from date,
  p_to date,
  p_brand text DEFAULT NULL,
  p_sales_channel text DEFAULT NULL
)
RETURNS TABLE (
  date date,
  customer_type text,
  sales_channel text,
  order_count bigint,
  customer_count bigint,
  revenue numeric,
  cogs numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH facts AS (
    SELECT *
    FROM public.workspace_customer_order_facts(p_workspace_id)
  ), first_orders AS (
    SELECT customer_identifier, MIN(order_date) AS first_order_date
    FROM facts
    WHERE customer_identifier IS NOT NULL
      AND btrim(customer_identifier) <> ''
      AND customer_identifier NOT LIKE 'unidentified:%'
    GROUP BY customer_identifier
  ), order_channel AS (
    SELECT
      fact.order_db_id,
      fact.customer_identifier,
      fact.order_date,
      fact.sales_channel,
      SUM(fact.line_revenue) AS revenue,
      SUM(fact.line_cogs) AS cogs
    FROM facts fact
    WHERE fact.order_date BETWEEN LEAST(p_from, p_to) AND GREATEST(p_from, p_to)
      AND (p_brand IS NULL OR fact.product_type = p_brand)
      AND (p_sales_channel IS NULL OR fact.sales_channel = p_sales_channel)
    GROUP BY fact.order_db_id, fact.customer_identifier, fact.order_date,
      fact.sales_channel
  ), typed AS (
    SELECT
      bucket.*,
      CASE
        WHEN bucket.customer_identifier IS NULL
          OR btrim(bucket.customer_identifier) = ''
          OR bucket.customer_identifier LIKE 'unidentified:%'
          THEN 'unidentified'
        WHEN bucket.order_date = first_order.first_order_date THEN 'new'
        ELSE 'ro'
      END AS resolved_customer_type
    FROM order_channel bucket
    LEFT JOIN first_orders first_order
      ON first_order.customer_identifier = bucket.customer_identifier
  )
  SELECT
    typed.order_date,
    typed.resolved_customer_type,
    typed.sales_channel,
    COUNT(*)::bigint,
    COUNT(DISTINCT typed.customer_identifier)::bigint,
    SUM(typed.revenue)::numeric,
    SUM(typed.cogs)::numeric
  FROM typed
  GROUP BY typed.order_date, typed.resolved_customer_type, typed.sales_channel
  ORDER BY typed.order_date, typed.sales_channel, typed.resolved_customer_type;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_type_period_exact(
  p_workspace_id uuid,
  p_from date,
  p_to date,
  p_brand text DEFAULT NULL
)
RETURNS TABLE (
  channel_group text,
  customer_type text,
  order_count bigint,
  customer_count bigint,
  scope_customer_count bigint,
  revenue numeric,
  cogs numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH facts AS (
    SELECT *
    FROM public.workspace_customer_order_facts(p_workspace_id)
  ), first_orders AS (
    SELECT customer_identifier, MIN(order_date) AS first_order_date
    FROM facts
    WHERE customer_identifier IS NOT NULL
      AND btrim(customer_identifier) <> ''
      AND customer_identifier NOT LIKE 'unidentified:%'
    GROUP BY customer_identifier
  ), order_channel AS (
    SELECT
      fact.order_db_id,
      fact.customer_identifier,
      fact.order_date,
      fact.sales_channel,
      SUM(fact.line_revenue) AS revenue,
      SUM(fact.line_cogs) AS cogs
    FROM facts fact
    WHERE fact.order_date BETWEEN LEAST(p_from, p_to) AND GREATEST(p_from, p_to)
      AND (p_brand IS NULL OR fact.product_type = p_brand)
    GROUP BY fact.order_db_id, fact.customer_identifier, fact.order_date,
      fact.sales_channel
  ), typed AS (
    SELECT
      bucket.*,
      CASE
        WHEN bucket.customer_identifier IS NULL
          OR btrim(bucket.customer_identifier) = ''
          OR bucket.customer_identifier LIKE 'unidentified:%'
          THEN 'unidentified'
        WHEN bucket.order_date = first_order.first_order_date THEN 'new'
        ELSE 'ro'
      END AS resolved_customer_type,
      CASE
        WHEN bucket.sales_channel IN ('Scalev Ads', 'Google Ads') THEN 'Scalev Ads'
        WHEN bucket.sales_channel = 'CS Manual' THEN 'CS Manual'
        WHEN bucket.sales_channel = 'TikTok Shop' THEN 'TikTok Shop'
        WHEN bucket.sales_channel = 'Reseller' THEN 'Reseller'
        WHEN bucket.sales_channel = 'Shopee' THEN 'Shopee'
        ELSE 'Other Marketplaces'
      END AS resolved_channel_group
    FROM order_channel bucket
    LEFT JOIN first_orders first_order
      ON first_order.customer_identifier = bucket.customer_identifier
  ), grouped AS (
    SELECT
      typed.order_db_id,
      typed.customer_identifier,
      typed.resolved_customer_type,
      typed.resolved_channel_group AS channel_group,
      SUM(typed.revenue) AS revenue,
      SUM(typed.cogs) AS cogs
    FROM typed
    GROUP BY typed.order_db_id, typed.customer_identifier,
      typed.resolved_customer_type, typed.resolved_channel_group
  ), scoped AS (
    SELECT * FROM grouped
    UNION ALL
    SELECT
      grouped.order_db_id,
      grouped.customer_identifier,
      grouped.resolved_customer_type,
      'Global'::text,
      SUM(grouped.revenue),
      SUM(grouped.cogs)
    FROM grouped
    GROUP BY grouped.order_db_id, grouped.customer_identifier,
      grouped.resolved_customer_type
  ), totals AS (
    SELECT
      scoped.channel_group,
      COUNT(DISTINCT scoped.customer_identifier) FILTER (
        WHERE scoped.resolved_customer_type <> 'unidentified'
      )::bigint AS scope_customer_count
    FROM scoped
    GROUP BY scoped.channel_group
  )
  SELECT
    scoped.channel_group,
    scoped.resolved_customer_type,
    COUNT(*)::bigint,
    COUNT(DISTINCT scoped.customer_identifier)::bigint,
    totals.scope_customer_count,
    SUM(scoped.revenue)::numeric,
    SUM(scoped.cogs)::numeric
  FROM scoped
  JOIN totals USING (channel_group)
  GROUP BY scoped.channel_group, scoped.resolved_customer_type,
    totals.scope_customer_count
  ORDER BY scoped.channel_group, scoped.resolved_customer_type;
$$;

CREATE OR REPLACE FUNCTION public.workspace_customer_cohort(
  p_workspace_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  customer_phone text,
  first_name text,
  first_channel text,
  total_orders bigint,
  total_revenue numeric,
  avg_order_value numeric,
  first_order_date date,
  last_order_date date,
  is_repeat boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH facts AS (
    SELECT *
    FROM public.workspace_customer_order_facts(p_workspace_id)
    WHERE customer_identifier IS NOT NULL
      AND btrim(customer_identifier) <> ''
  ), customer_totals AS (
    SELECT
      customer_identifier,
      (array_agg(customer_name ORDER BY shipped_time)
        FILTER (WHERE customer_name IS NOT NULL))[1] AS first_name,
      (array_agg(sales_channel ORDER BY shipped_time))[1] AS first_channel,
      COUNT(DISTINCT order_db_id)::bigint AS total_orders,
      SUM(line_revenue)::numeric AS total_revenue,
      MIN(order_date) AS first_order_date,
      MAX(order_date) AS last_order_date
    FROM facts
    GROUP BY customer_identifier
  )
  SELECT
    customer_identifier,
    first_name,
    first_channel,
    total_orders,
    total_revenue,
    ROUND(total_revenue / NULLIF(total_orders, 0), 0),
    first_order_date,
    last_order_date,
    total_orders > 1
  FROM customer_totals
  WHERE (p_from IS NULL OR last_order_date >= p_from)
    AND (p_to IS NULL OR last_order_date <= p_to)
  ORDER BY total_revenue DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000);
$$;

CREATE OR REPLACE FUNCTION public.workspace_monthly_cohort(
  p_workspace_id uuid
)
RETURNS TABLE (
  cohort_month text,
  months_since_first int,
  active_customers bigint,
  orders bigint,
  revenue numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH facts AS (
    SELECT *
    FROM public.workspace_customer_order_facts(p_workspace_id)
    WHERE customer_identifier IS NOT NULL
      AND btrim(customer_identifier) <> ''
      AND customer_identifier NOT LIKE 'unidentified:%'
  ), firsts AS (
    SELECT customer_identifier, MIN(order_date) AS first_order_date
    FROM facts
    GROUP BY customer_identifier
  ), activity AS (
    SELECT
      fact.customer_identifier,
      date_trunc('month', fact.order_date)::date AS activity_month,
      COUNT(DISTINCT fact.order_db_id)::bigint AS order_count,
      SUM(fact.line_revenue)::numeric AS revenue
    FROM facts fact
    GROUP BY fact.customer_identifier, date_trunc('month', fact.order_date)::date
  )
  SELECT
    to_char(firsts.first_order_date, 'YYYY-MM'),
    (
      EXTRACT(YEAR FROM activity.activity_month)::int * 12
      + EXTRACT(MONTH FROM activity.activity_month)::int
      - EXTRACT(YEAR FROM firsts.first_order_date)::int * 12
      - EXTRACT(MONTH FROM firsts.first_order_date)::int
    )::int,
    COUNT(DISTINCT activity.customer_identifier)::bigint,
    SUM(activity.order_count)::bigint,
    SUM(activity.revenue)::numeric
  FROM activity
  JOIN firsts USING (customer_identifier)
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

CREATE OR REPLACE FUNCTION public.workspace_monthly_cohort_channel(
  p_workspace_id uuid
)
RETURNS TABLE (
  channel_group text,
  cohort_month text,
  months_since_first int,
  active_customers bigint,
  orders bigint,
  revenue numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH facts AS (
    SELECT *
    FROM public.workspace_customer_order_facts(p_workspace_id)
    WHERE customer_identifier IS NOT NULL
      AND btrim(customer_identifier) <> ''
      AND customer_identifier NOT LIKE 'unidentified:%'
  ), ranked AS (
    SELECT
      fact.*,
      row_number() OVER (
        PARTITION BY fact.customer_identifier
        ORDER BY fact.shipped_time, fact.order_db_id
      ) AS first_rank
    FROM facts fact
  ), firsts AS (
    SELECT
      customer_identifier,
      MIN(order_date) AS first_order_date,
      MAX(public.get_channel_group(sales_channel))
        FILTER (WHERE first_rank = 1) AS channel_group
    FROM ranked
    GROUP BY customer_identifier
  ), activity AS (
    SELECT
      fact.customer_identifier,
      date_trunc('month', fact.order_date)::date AS activity_month,
      COUNT(DISTINCT fact.order_db_id)::bigint AS order_count,
      SUM(fact.line_revenue)::numeric AS revenue
    FROM facts fact
    GROUP BY fact.customer_identifier, date_trunc('month', fact.order_date)::date
  )
  SELECT
    COALESCE(firsts.channel_group, 'Other'),
    to_char(firsts.first_order_date, 'YYYY-MM'),
    (
      EXTRACT(YEAR FROM activity.activity_month)::int * 12
      + EXTRACT(MONTH FROM activity.activity_month)::int
      - EXTRACT(YEAR FROM firsts.first_order_date)::int * 12
      - EXTRACT(MONTH FROM firsts.first_order_date)::int
    )::int,
    COUNT(DISTINCT activity.customer_identifier)::bigint,
    SUM(activity.order_count)::bigint,
    SUM(activity.revenue)::numeric
  FROM activity
  JOIN firsts USING (customer_identifier)
  GROUP BY 1, 2, 3
  ORDER BY 1, 2, 3;
$$;

CREATE OR REPLACE FUNCTION public.workspace_customer_ltv_rows(
  p_workspace_id uuid
)
RETURNS TABLE (
  customer_phone text,
  brand text,
  channel_group text,
  cohort_month text,
  first_order_date date,
  first_purchase_revenue numeric,
  repeat_90d_revenue numeric,
  after_90d_revenue numeric,
  is_repeater_90d boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH facts AS (
    SELECT *
    FROM public.workspace_customer_order_facts(p_workspace_id)
    WHERE customer_identifier IS NOT NULL
      AND btrim(customer_identifier) <> ''
      AND customer_identifier NOT LIKE 'unidentified:%'
  ), ranked AS (
    SELECT
      fact.*,
      MIN(fact.order_date) OVER (
        PARTITION BY fact.customer_identifier
      ) AS first_order_date,
      row_number() OVER (
        PARTITION BY fact.customer_identifier
        ORDER BY fact.shipped_time, fact.order_db_id
      ) AS first_rank
    FROM facts fact
  ), customers AS (
    SELECT
      customer_identifier,
      MIN(first_order_date) AS first_order_date,
      MAX(public.get_channel_group(sales_channel))
        FILTER (WHERE first_rank = 1) AS channel_group
    FROM ranked
    GROUP BY customer_identifier
  )
  SELECT
    ranked.customer_identifier,
    ranked.product_type,
    COALESCE(customers.channel_group, 'Other'),
    to_char(customers.first_order_date, 'YYYY-MM'),
    customers.first_order_date,
    SUM(ranked.line_revenue) FILTER (
      WHERE ranked.order_date = customers.first_order_date
    )::numeric,
    COALESCE(SUM(ranked.line_revenue) FILTER (
      WHERE ranked.order_date > customers.first_order_date
        AND ranked.order_date <= customers.first_order_date + 90
    ), 0)::numeric,
    COALESCE(SUM(ranked.line_revenue) FILTER (
      WHERE ranked.order_date > customers.first_order_date + 90
    ), 0)::numeric,
    COUNT(DISTINCT ranked.order_db_id) FILTER (
      WHERE ranked.order_date > customers.first_order_date
        AND ranked.order_date <= customers.first_order_date + 90
    ) > 0
  FROM ranked
  JOIN customers USING (customer_identifier)
  GROUP BY ranked.customer_identifier, ranked.product_type,
    customers.channel_group, customers.first_order_date;
$$;

CREATE OR REPLACE FUNCTION public.get_channel_ltv_90d(
  p_workspace_id uuid,
  brand_filter text DEFAULT NULL
)
RETURNS TABLE (
  channel_group text,
  num_customers bigint,
  avg_first_purchase numeric,
  avg_repeat_value numeric,
  avg_ltv_90d numeric,
  avg_ltv_lifetime numeric,
  avg_after_90d numeric,
  repeat_rate numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH base AS (
    SELECT *
    FROM public.workspace_customer_ltv_rows(p_workspace_id) row
    WHERE (brand_filter IS NULL OR row.brand = brand_filter)
      AND row.first_order_date <= CURRENT_DATE - 90
  ), grouped AS (
    SELECT
      base.channel_group,
      COUNT(*)::bigint AS num_customers,
      ROUND(AVG(base.first_purchase_revenue), 0) AS avg_first_purchase,
      ROUND(AVG(base.repeat_90d_revenue), 0) AS avg_repeat_value,
      ROUND(AVG(base.first_purchase_revenue + base.repeat_90d_revenue), 0) AS avg_ltv_90d,
      ROUND(AVG(base.first_purchase_revenue + base.repeat_90d_revenue + base.after_90d_revenue), 0) AS avg_ltv_lifetime,
      ROUND(AVG(base.after_90d_revenue), 0) AS avg_after_90d,
      ROUND(AVG(CASE WHEN base.is_repeater_90d THEN 100 ELSE 0 END), 1) AS repeat_rate,
      1 AS sort_order
    FROM base
    GROUP BY base.channel_group
    UNION ALL
    SELECT
      'Global', COUNT(*)::bigint,
      ROUND(AVG(first_purchase_revenue), 0),
      ROUND(AVG(repeat_90d_revenue), 0),
      ROUND(AVG(first_purchase_revenue + repeat_90d_revenue), 0),
      ROUND(AVG(first_purchase_revenue + repeat_90d_revenue + after_90d_revenue), 0),
      ROUND(AVG(after_90d_revenue), 0),
      ROUND(AVG(CASE WHEN is_repeater_90d THEN 100 ELSE 0 END), 1),
      0
    FROM base
  )
  SELECT
    grouped.channel_group, grouped.num_customers,
    grouped.avg_first_purchase, grouped.avg_repeat_value,
    grouped.avg_ltv_90d, grouped.avg_ltv_lifetime,
    grouped.avg_after_90d, grouped.repeat_rate
  FROM grouped
  ORDER BY grouped.sort_order, grouped.num_customers DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_ltv_trend_by_cohort(
  p_workspace_id uuid,
  brand_filter text DEFAULT NULL
)
RETURNS TABLE (
  cohort_month text,
  channel_group text,
  num_customers bigint,
  avg_first_purchase numeric,
  avg_repeat_value numeric,
  avg_ltv_90d numeric,
  avg_ltv_lifetime numeric,
  avg_after_90d numeric,
  repeat_rate numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH base AS (
    SELECT *
    FROM public.workspace_customer_ltv_rows(p_workspace_id) row
    WHERE (brand_filter IS NULL OR row.brand = brand_filter)
      AND row.first_order_date <= CURRENT_DATE - 90
  ), scoped AS (
    SELECT base.cohort_month, base.channel_group,
      base.first_purchase_revenue, base.repeat_90d_revenue,
      base.after_90d_revenue, base.is_repeater_90d
    FROM base
    UNION ALL
    SELECT base.cohort_month, 'Global', base.first_purchase_revenue,
      base.repeat_90d_revenue, base.after_90d_revenue,
      base.is_repeater_90d
    FROM base
  )
  SELECT
    scoped.cohort_month,
    scoped.channel_group,
    COUNT(*)::bigint,
    ROUND(AVG(scoped.first_purchase_revenue), 0),
    ROUND(AVG(scoped.repeat_90d_revenue), 0),
    ROUND(AVG(scoped.first_purchase_revenue + scoped.repeat_90d_revenue), 0),
    ROUND(AVG(scoped.first_purchase_revenue + scoped.repeat_90d_revenue + scoped.after_90d_revenue), 0),
    ROUND(AVG(scoped.after_90d_revenue), 0),
    ROUND(AVG(CASE WHEN scoped.is_repeater_90d THEN 100 ELSE 0 END), 1)
  FROM scoped
  GROUP BY scoped.cohort_month, scoped.channel_group
  ORDER BY scoped.cohort_month, scoped.channel_group;
$$;

CREATE OR REPLACE FUNCTION public.get_available_brands(
  p_workspace_id uuid
)
RETURNS TABLE (brand text, order_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    line.product_type,
    COUNT(DISTINCT line.scalev_order_id)::bigint
  FROM public.scalev_order_lines line
  JOIN public.scalev_orders orders
    ON orders.id = line.scalev_order_id
   AND orders.workspace_id = p_workspace_id
  WHERE line.workspace_id = p_workspace_id
    AND line.product_type IS NOT NULL
    AND line.product_type NOT IN ('Other', 'Unknown')
  GROUP BY line.product_type
  ORDER BY 2 DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_channel_cac(
  p_workspace_id uuid
)
RETURNS TABLE (
  channel_group text,
  total_spend numeric,
  new_customers bigint,
  cac numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH ads_raw AS (
    SELECT
      CASE
        WHEN ads.source ILIKE '%cpas%' OR ads.source ILIKE '%shopee%' THEN 'Shopee'
        WHEN ads.source ILIKE '%tiktok%' THEN 'TikTok Shop'
        WHEN ads.source ILIKE '%facebook%'
          OR ads.source ILIKE '%whatsapp%'
          OR ads.source ILIKE '%waba%' THEN 'Scalev'
        ELSE NULL
      END AS channel_group,
      ads.date,
      ads.spent
    FROM public.daily_ads_spend ads
    WHERE ads.workspace_id = p_workspace_id
      AND ads.spent > 0
  ), spend AS (
    SELECT
      ads_raw.channel_group,
      SUM(ads_raw.spent) AS total_spend,
      MIN(ads_raw.date) AS spend_from,
      MAX(ads_raw.date) AS spend_to
    FROM ads_raw
    WHERE ads_raw.channel_group IS NOT NULL
    GROUP BY ads_raw.channel_group
  ), facts AS (
    SELECT *
    FROM public.workspace_customer_order_facts(p_workspace_id)
    WHERE customer_identifier IS NOT NULL
      AND customer_identifier NOT LIKE 'unidentified:%'
  ), ranked AS (
    SELECT
      facts.*,
      row_number() OVER (
        PARTITION BY facts.customer_identifier
        ORDER BY facts.shipped_time, facts.order_db_id
      ) AS first_rank
    FROM facts
  ), customers AS (
    SELECT
      ranked.customer_identifier,
      MIN(ranked.order_date) AS first_order_date,
      MAX(public.get_channel_group(ranked.sales_channel))
        FILTER (WHERE ranked.first_rank = 1) AS channel_group
    FROM ranked
    GROUP BY ranked.customer_identifier
  ), new_customers AS (
    SELECT
      customers.channel_group,
      COUNT(*)::bigint AS customer_count
    FROM customers
    JOIN spend
      ON spend.channel_group = customers.channel_group
     AND customers.first_order_date BETWEEN spend.spend_from AND spend.spend_to
    GROUP BY customers.channel_group
  )
  SELECT
    spend.channel_group,
    spend.total_spend,
    COALESCE(new_customers.customer_count, 0),
    CASE
      WHEN COALESCE(new_customers.customer_count, 0) > 0
        THEN ROUND(spend.total_spend / new_customers.customer_count, 0)
      ELSE NULL
    END
  FROM spend
  LEFT JOIN new_customers USING (channel_group)
  ORDER BY spend.total_spend DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_monthly_cac(
  p_workspace_id uuid,
  brand_filter text DEFAULT NULL
)
RETURNS TABLE (
  month text,
  channel_group text,
  ad_spend numeric,
  new_customers bigint,
  cac numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH spend AS (
    SELECT
      to_char(ads.date, 'YYYY-MM') AS month,
      CASE
        WHEN ads.source ILIKE '%cpas%' OR ads.source ILIKE '%shopee%' THEN 'Shopee'
        WHEN ads.source ILIKE '%tiktok%' THEN 'TikTok Shop'
        WHEN ads.source ILIKE '%facebook%'
          OR ads.source ILIKE '%whatsapp%'
          OR ads.source ILIKE '%waba%' THEN 'Scalev'
        ELSE NULL
      END AS channel_group,
      SUM(ads.spent)::numeric AS ad_spend
    FROM public.daily_ads_spend ads
    WHERE ads.workspace_id = p_workspace_id
      AND ads.spent > 0
      AND (brand_filter IS NULL OR ads.store = brand_filter)
    GROUP BY 1, 2
  ), ltv AS (
    SELECT *
    FROM public.workspace_customer_ltv_rows(p_workspace_id) row
    WHERE brand_filter IS NULL OR row.brand = brand_filter
  ), new_customers AS (
    SELECT
      ltv.cohort_month AS month,
      ltv.channel_group,
      COUNT(DISTINCT ltv.customer_phone)::bigint AS customer_count
    FROM ltv
    GROUP BY ltv.cohort_month, ltv.channel_group
  ), keys AS (
    SELECT spend.month, spend.channel_group FROM spend
    WHERE spend.channel_group IS NOT NULL
    UNION
    SELECT new_customers.month, new_customers.channel_group FROM new_customers
    WHERE new_customers.channel_group IS NOT NULL
  )
  SELECT
    keys.month,
    keys.channel_group,
    COALESCE(spend.ad_spend, 0),
    COALESCE(new_customers.customer_count, 0),
    CASE
      WHEN COALESCE(new_customers.customer_count, 0) > 0
        THEN ROUND(COALESCE(spend.ad_spend, 0) / new_customers.customer_count, 0)
      ELSE NULL
    END
  FROM keys
  LEFT JOIN spend USING (month, channel_group)
  LEFT JOIN new_customers USING (month, channel_group)
  ORDER BY keys.month, keys.channel_group;
$$;

CREATE OR REPLACE FUNCTION public.workspace_customer_brand_map(
  p_workspace_id uuid
)
RETURNS TABLE (
  customer_identifier text,
  brand text,
  order_count bigint,
  total_revenue numeric,
  first_purchase_date date,
  last_purchase_date date,
  from_bundle boolean,
  from_separate boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH facts AS (
    SELECT *
    FROM public.workspace_customer_order_facts(p_workspace_id)
    WHERE customer_identifier IS NOT NULL
      AND btrim(customer_identifier) <> ''
      AND customer_identifier NOT LIKE 'unidentified:%'
  ), order_shape AS (
    SELECT
      facts.order_db_id,
      COUNT(DISTINCT facts.product_type) > 1 AS is_bundle
    FROM facts
    GROUP BY facts.order_db_id
  )
  SELECT
    facts.customer_identifier,
    facts.product_type,
    COUNT(DISTINCT facts.order_db_id)::bigint,
    SUM(facts.line_revenue)::numeric,
    MIN(facts.order_date),
    MAX(facts.order_date),
    bool_or(order_shape.is_bundle),
    bool_or(NOT order_shape.is_bundle)
  FROM facts
  JOIN order_shape USING (order_db_id)
  GROUP BY facts.customer_identifier, facts.product_type;
$$;

CREATE OR REPLACE FUNCTION public.workspace_cross_brand_matrix(
  p_workspace_id uuid
)
RETURNS TABLE (
  brand_from text,
  brand_to text,
  shared_customers bigint,
  brand_from_total bigint,
  overlap_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH brand_map AS (
    SELECT * FROM public.workspace_customer_brand_map(p_workspace_id)
  ), totals AS (
    SELECT brand, COUNT(DISTINCT customer_identifier)::bigint AS total_customers
    FROM brand_map
    GROUP BY brand
  )
  SELECT
    source.brand,
    target.brand,
    COUNT(DISTINCT source.customer_identifier)::bigint,
    totals.total_customers,
    ROUND(
      COUNT(DISTINCT source.customer_identifier)::numeric
      / NULLIF(totals.total_customers, 0) * 100,
      1
    )
  FROM brand_map source
  JOIN brand_map target
    ON target.customer_identifier = source.customer_identifier
   AND target.brand <> source.brand
  JOIN totals ON totals.brand = source.brand
  GROUP BY source.brand, target.brand, totals.total_customers
  ORDER BY source.brand, target.brand;
$$;

CREATE OR REPLACE FUNCTION public.workspace_brand_analysis_summary(
  p_workspace_id uuid
)
RETURNS TABLE (
  stat_type text,
  key text,
  value1 text,
  value2 text,
  value3 text,
  value4 text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH brand_map AS (
    SELECT * FROM public.workspace_customer_brand_map(p_workspace_id)
  ), customers AS (
    SELECT
      brand_map.customer_identifier,
      COUNT(DISTINCT brand_map.brand)::int AS brand_count,
      SUM(brand_map.order_count)::bigint AS total_orders,
      SUM(brand_map.total_revenue)::numeric AS total_revenue,
      (array_agg(brand_map.brand ORDER BY brand_map.first_purchase_date, brand_map.brand))[1] AS first_brand,
      bool_and(brand_map.from_bundle) AND NOT bool_or(brand_map.from_separate) AS bundle_only,
      bool_and(brand_map.from_separate) AND NOT bool_or(brand_map.from_bundle) AS separate_only
    FROM brand_map
    GROUP BY brand_map.customer_identifier
  ), classified AS (
    SELECT
      customers.*,
      CASE
        WHEN customers.brand_count = 1 THEN 'single'
        WHEN customers.brand_count = 2 THEN 'dual'
        ELSE 'multi'
      END AS customer_segment,
      CASE
        WHEN customers.brand_count = 1 THEN 'single'
        WHEN customers.bundle_only THEN 'bundle_only'
        WHEN customers.separate_only THEN 'separate_only'
        ELSE 'mixed'
      END AS cross_brand_type
    FROM customers
  ), summary_rows AS (
    SELECT
      'segment'::text AS stat_type,
      customer_segment::text AS key,
      COUNT(*)::text AS value1,
      SUM(total_orders)::text AS value2,
      SUM(total_revenue)::text AS value3,
      ROUND(AVG(total_revenue / NULLIF(total_orders, 0)), 0)::text AS value4
    FROM classified
    GROUP BY customer_segment
    UNION ALL
    SELECT 'distribution', brand_count::text, COUNT(*)::text, NULL, NULL, NULL
    FROM classified GROUP BY brand_count
    UNION ALL
    SELECT 'gateway', first_brand, COUNT(*)::text, NULL, NULL, NULL
    FROM classified GROUP BY first_brand
    UNION ALL
    SELECT 'cross_type', cross_brand_type, COUNT(*)::text, NULL, NULL, NULL
    FROM classified
    WHERE cross_brand_type <> 'single'
    GROUP BY cross_brand_type
  )
  SELECT
    summary_rows.stat_type,
    summary_rows.key,
    summary_rows.value1,
    summary_rows.value2,
    summary_rows.value3,
    summary_rows.value4
  FROM summary_rows;
$$;

CREATE OR REPLACE FUNCTION public.workspace_brand_journey(
  p_workspace_id uuid
)
RETURNS TABLE (
  from_brand text,
  to_brand text,
  customer_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH brand_map AS (
    SELECT * FROM public.workspace_customer_brand_map(p_workspace_id)
  ), ordered AS (
    SELECT
      brand_map.customer_identifier,
      brand_map.brand,
      row_number() OVER (
        PARTITION BY brand_map.customer_identifier
        ORDER BY brand_map.first_purchase_date, brand_map.brand
      ) AS brand_order
    FROM brand_map
  )
  SELECT
    source.brand,
    target.brand,
    COUNT(DISTINCT source.customer_identifier)::bigint
  FROM ordered source
  JOIN ordered target
    ON target.customer_identifier = source.customer_identifier
   AND target.brand_order = source.brand_order + 1
  GROUP BY source.brand, target.brand
  ORDER BY 3 DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_owned_brand_buyer_health(
  p_workspace_id uuid,
  p_weeks int DEFAULT 26
)
RETURNS TABLE (
  brand text,
  week_start date,
  week_end date,
  trailing_active_buyers bigint,
  new_buyers bigint,
  latest_data_date date,
  latest_completed_week_end date,
  owned_purchase_rows bigint,
  unique_buyers bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  WITH latest AS (
    SELECT MAX((orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::date) AS latest_date
    FROM public.scalev_orders orders
    WHERE orders.workspace_id = p_workspace_id
      AND orders.platform = 'scalev'
      AND orders.status IN ('shipped', 'completed')
      AND orders.shipped_time IS NOT NULL
  ), anchors AS (
    SELECT
      latest.latest_date,
      latest.latest_date - EXTRACT(DOW FROM latest.latest_date)::int AS latest_week_end
    FROM latest
    WHERE latest.latest_date IS NOT NULL
  ), weeks AS (
    SELECT
      (anchors.latest_week_end - (series.i * 7) - 6)::date AS week_start,
      (anchors.latest_week_end - (series.i * 7))::date AS week_end,
      anchors.latest_date,
      anchors.latest_week_end
    FROM anchors
    CROSS JOIN generate_series(
      LEAST(GREATEST(COALESCE(p_weeks, 26), 13), 52) - 1,
      0,
      -1
    ) AS series(i)
  ), purchases AS (
    SELECT DISTINCT
      (orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::date AS purchase_date,
      orders.customer_identifier,
      line.product_type AS brand
    FROM public.scalev_orders orders
    JOIN public.scalev_order_lines line
      ON line.workspace_id = p_workspace_id
     AND line.scalev_order_id = orders.id
    WHERE orders.workspace_id = p_workspace_id
      AND orders.platform = 'scalev'
      AND orders.status IN ('shipped', 'completed')
      AND orders.shipped_time IS NOT NULL
      AND orders.customer_identifier IS NOT NULL
      AND orders.customer_phone IS NOT NULL
      AND orders.customer_identifier = orders.customer_phone
      AND orders.customer_identifier ~ '^[0-9]{10,15}$'
      AND line.product_type IS NOT NULL
      AND line.product_type NOT IN ('Unknown', 'Other')
  ), coverage AS (
    SELECT COUNT(*)::bigint AS row_count,
      COUNT(DISTINCT customer_identifier)::bigint AS buyer_count
    FROM purchases
  ), brands AS (
    SELECT DISTINCT purchases.brand FROM purchases
  ), firsts AS (
    SELECT brand, customer_identifier, MIN(purchase_date) AS first_purchase_date
    FROM purchases
    GROUP BY brand, customer_identifier
  ), active AS (
    SELECT weeks.week_start, weeks.week_end, purchases.brand,
      COUNT(DISTINCT purchases.customer_identifier)::bigint AS buyer_count
    FROM weeks
    JOIN purchases
      ON purchases.purchase_date BETWEEN weeks.week_end - 89 AND weeks.week_end
    GROUP BY weeks.week_start, weeks.week_end, purchases.brand
  ), newcomers AS (
    SELECT weeks.week_start, weeks.week_end, firsts.brand,
      COUNT(DISTINCT firsts.customer_identifier)::bigint AS buyer_count
    FROM weeks
    JOIN firsts
      ON firsts.first_purchase_date BETWEEN weeks.week_start AND weeks.week_end
    GROUP BY weeks.week_start, weeks.week_end, firsts.brand
  )
  SELECT
    brands.brand,
    weeks.week_start,
    weeks.week_end,
    COALESCE(active.buyer_count, 0),
    COALESCE(newcomers.buyer_count, 0),
    weeks.latest_date,
    weeks.latest_week_end,
    coverage.row_count,
    coverage.buyer_count
  FROM weeks
  CROSS JOIN brands
  CROSS JOIN coverage
  LEFT JOIN active
    ON active.week_start = weeks.week_start
   AND active.week_end = weeks.week_end
   AND active.brand = brands.brand
  LEFT JOIN newcomers
    ON newcomers.week_start = weeks.week_start
   AND newcomers.week_end = weeks.week_end
   AND newcomers.brand = brands.brand
  ORDER BY brands.brand, weeks.week_end;
$$;

-- Add the tenant key to legacy wrapper views still used by admin diagnostics.
-- It is appended to preserve existing view column order for callers.
CREATE OR REPLACE VIEW public.v_daily_order_summary AS
SELECT
  (orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::date AS date,
  line.product_type AS product,
  SUM((line.product_price_bt - line.discount_bt) * line.quantity::numeric) AS net_sales,
  SUM((line.product_price_bt - line.discount_bt - line.cogs_bt) * line.quantity::numeric) AS gross_profit,
  SUM(line.cogs_bt * line.quantity::numeric) AS total_cogs,
  COUNT(DISTINCT line.order_id) AS order_count,
  SUM(line.quantity) AS units_sold,
  orders.workspace_id
FROM public.scalev_order_lines line
JOIN public.scalev_orders orders
  ON orders.id = line.scalev_order_id
 AND orders.workspace_id = line.workspace_id
WHERE orders.shipped_time IS NOT NULL
  AND orders.status IN ('shipped', 'completed')
  AND line.product_type IS NOT NULL
GROUP BY orders.workspace_id,
  (orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::date,
  line.product_type;

CREATE OR REPLACE VIEW public.v_daily_channel_summary AS
SELECT
  (orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::date AS date,
  line.product_type AS product,
  line.sales_channel AS channel,
  SUM((line.product_price_bt - line.discount_bt) * line.quantity::numeric) AS net_sales,
  SUM((line.product_price_bt - line.discount_bt - line.cogs_bt) * line.quantity::numeric) AS gross_profit,
  COUNT(DISTINCT line.order_id) AS order_count,
  SUM(line.quantity) AS units_sold,
  orders.workspace_id
FROM public.scalev_order_lines line
JOIN public.scalev_orders orders
  ON orders.id = line.scalev_order_id
 AND orders.workspace_id = line.workspace_id
WHERE orders.shipped_time IS NOT NULL
  AND orders.status IN ('shipped', 'completed')
  AND line.product_type IS NOT NULL
  AND line.sales_channel IS NOT NULL
GROUP BY orders.workspace_id,
  (orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::date,
  line.product_type,
  line.sales_channel;

CREATE OR REPLACE VIEW public.v_scalev_order_financials_v2 AS
SELECT
  orders.id AS scalev_order_id,
  orders.order_id,
  orders.business_code,
  orders.source,
  orders.status,
  orders.payment_method,
  orders.shipped_time,
  orders.completed_time,
  orders.gross_revenue AS scalev_gross_revenue,
  orders.net_revenue AS scalev_final_net_revenue,
  SUM(line.product_price_bt) AS line_product_gross_amount,
  SUM(line.discount_bt) AS line_product_discount_amount,
  SUM(line.product_price_bt - line.discount_bt) AS line_product_net_amount,
  COALESCE(orders.shipping_cost, 0) AS shipping_gross_amount,
  orders.shipping_discount AS shipping_discount_amount,
  CASE
    WHEN COALESCE(orders.shipping_cost, 0) = 0 THEN 0::numeric
    WHEN orders.shipping_discount IS NULL THEN NULL::numeric
    ELSE GREATEST(COALESCE(orders.shipping_cost, 0) - orders.shipping_discount, 0::numeric)
  END AS shipping_net_amount,
  COALESCE(orders.unique_code_discount, 0) AS unique_code_discount_amount,
  orders.discount_code_discount AS discount_code_discount_amount,
  COALESCE(orders.unique_code_discount, 0)
    + COALESCE(orders.discount_code_discount, 0) AS order_level_discount_amount,
  (COALESCE(orders.shipping_cost, 0) = 0 OR orders.shipping_discount IS NOT NULL) AS shipping_discount_known,
  (orders.discount_code_discount IS NOT NULL) AS discount_code_discount_known,
  (COUNT(line.scalev_order_id) > 0) AS has_lines,
  CASE
    WHEN COUNT(line.scalev_order_id) > 0
      AND orders.net_revenue IS NOT NULL
      AND SUM(line.product_price_bt - line.discount_bt) IS NOT NULL
      THEN orders.net_revenue - SUM(line.product_price_bt - line.discount_bt)
    ELSE NULL::numeric
  END AS audit_header_minus_line_product_net,
  CASE
    WHEN orders.gross_revenue IS NOT NULL AND orders.net_revenue IS NOT NULL
      THEN orders.gross_revenue - orders.net_revenue
    ELSE NULL::numeric
  END AS audit_header_gross_minus_header_net,
  orders.workspace_id
FROM public.scalev_orders orders
LEFT JOIN public.scalev_order_lines line
  ON line.scalev_order_id = orders.id
 AND line.workspace_id = orders.workspace_id
GROUP BY orders.id, orders.order_id, orders.business_code, orders.source,
  orders.status, orders.payment_method, orders.shipped_time,
  orders.completed_time, orders.gross_revenue, orders.net_revenue,
  orders.shipping_cost, orders.shipping_discount,
  orders.unique_code_discount, orders.discount_code_discount,
  orders.workspace_id;

CREATE OR REPLACE VIEW public.v_scalev_order_financials_v2_reconciliation AS
SELECT
  COUNT(*)::bigint AS total_orders,
  COUNT(*) FILTER (WHERE NOT shipping_discount_known)::bigint AS shipping_discount_unknown_orders,
  COUNT(*) FILTER (WHERE NOT discount_code_discount_known)::bigint AS discount_code_discount_unknown_orders,
  COUNT(*) FILTER (
    WHERE has_lines
      AND audit_header_minus_line_product_net IS NOT NULL
      AND audit_header_minus_line_product_net = 0
  )::bigint AS header_net_matches_line_product_net_orders,
  COUNT(*) FILTER (
    WHERE has_lines
      AND audit_header_minus_line_product_net IS NOT NULL
      AND audit_header_minus_line_product_net <> 0
  )::bigint AS header_net_differs_from_line_product_net_orders,
  COUNT(*) FILTER (
    WHERE shipping_gross_amount > 0
      AND shipping_discount_amount IS NULL
  )::bigint AS shipping_discount_missing_with_shipping_orders,
  workspace_id
FROM public.v_scalev_order_financials_v2
GROUP BY workspace_id;

CREATE OR REPLACE VIEW public.v_scalev_order_financials_v2_gap_distribution AS
SELECT
  audit_header_minus_line_product_net AS gap_amount,
  COUNT(*)::bigint AS order_count,
  workspace_id
FROM public.v_scalev_order_financials_v2
WHERE has_lines
  AND audit_header_minus_line_product_net IS NOT NULL
GROUP BY workspace_id, audit_header_minus_line_product_net;

ALTER VIEW public.v_daily_order_summary SET (security_invoker = true);
ALTER VIEW public.v_daily_channel_summary SET (security_invoker = true);
ALTER VIEW public.v_scalev_order_financials_v2 SET (security_invoker = true);
ALTER VIEW public.v_scalev_order_financials_v2_reconciliation SET (security_invoker = true);
ALTER VIEW public.v_scalev_order_financials_v2_gap_distribution SET (security_invoker = true);

REVOKE ALL ON public.v_daily_order_summary FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_daily_channel_summary FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_scalev_order_financials_v2 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_scalev_order_financials_v2_reconciliation FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.v_scalev_order_financials_v2_gap_distribution FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_daily_order_summary TO service_role;
GRANT SELECT ON public.v_daily_channel_summary TO service_role;
GRANT SELECT ON public.v_scalev_order_financials_v2 TO service_role;
GRANT SELECT ON public.v_scalev_order_financials_v2_reconciliation TO service_role;
GRANT SELECT ON public.v_scalev_order_financials_v2_gap_distribution TO service_role;

-- Refresh logging is tenant-owned even though brand reads are now live.
CREATE TABLE IF NOT EXISTS public.mv_refresh_log (
  id bigserial PRIMARY KEY,
  view_name text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT NOW(),
  triggered_by text
);
ALTER TABLE public.mv_refresh_log
  ADD COLUMN IF NOT EXISTS workspace_id uuid;
UPDATE public.mv_refresh_log
SET workspace_id = '00000000-0000-4000-8000-000000000001'::uuid
WHERE workspace_id IS NULL;
ALTER TABLE public.mv_refresh_log
  ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.mv_refresh_log
  DROP CONSTRAINT IF EXISTS mv_refresh_log_workspace_id_fkey;
ALTER TABLE public.mv_refresh_log
  ADD CONSTRAINT mv_refresh_log_workspace_id_fkey
  FOREIGN KEY (workspace_id)
  REFERENCES public.workspaces(id)
  ON DELETE RESTRICT
  NOT VALID;
CREATE INDEX IF NOT EXISTS idx_mv_refresh_log_workspace_view_time
  ON public.mv_refresh_log (workspace_id, view_name, refreshed_at DESC);
ALTER TABLE public.mv_refresh_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mv_refresh_log_workspace_select ON public.mv_refresh_log;
CREATE POLICY mv_refresh_log_workspace_select
  ON public.mv_refresh_log
  FOR SELECT
  TO authenticated
  USING (public.workspace_has_membership(workspace_id));

-- Source facts need tenant-leading indexes for the live read models.
CREATE INDEX IF NOT EXISTS idx_scalev_orders_workspace_customer_shipped
  ON public.scalev_orders (workspace_id, customer_identifier, shipped_time)
  WHERE status IN ('shipped', 'completed') AND shipped_time IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scalev_order_lines_workspace_order_product
  ON public.scalev_order_lines (workspace_id, scalev_order_id, product_type);
CREATE INDEX IF NOT EXISTS idx_scalev_orders_workspace_draft_completed
  ON public.scalev_orders (workspace_id, draft_time)
  WHERE status IN ('shipped', 'completed')
    AND draft_time IS NOT NULL
    AND shipped_time IS NOT NULL;

-- Legacy Roove-only customer, PPIC and Commercial Moments caches are no
-- longer application read models. Stop maintaining them on every ScaleV
-- write; all active readers below use workspace-aware source facts instead.
DROP TRIGGER IF EXISTS trg_order_customer_summaries
  ON public.scalev_orders;
DROP TRIGGER IF EXISTS zz_trg_customer_first_order_exact_insert_delete
  ON public.scalev_orders;
DROP TRIGGER IF EXISTS zz_trg_customer_first_order_exact_insert
  ON public.scalev_orders;
DROP TRIGGER IF EXISTS zz_trg_customer_first_order_exact_delete
  ON public.scalev_orders;
DROP TRIGGER IF EXISTS zz_trg_customer_first_order_exact_update
  ON public.scalev_orders;
DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_line
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_line_insert
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_line_update
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_line_delete
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_order_status
  ON public.scalev_orders;
DROP TRIGGER IF EXISTS trg_scalev_daily_product_demand_order_delete
  ON public.scalev_orders;
DROP TRIGGER IF EXISTS trg_scalev_monthly_movement_insert
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_commercial_revenue_line
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_commercial_revenue_line_insert
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_commercial_revenue_line_update
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_commercial_revenue_line_delete
  ON public.scalev_order_lines;
DROP TRIGGER IF EXISTS trg_commercial_revenue_order
  ON public.scalev_orders;
DROP TRIGGER IF EXISTS trg_commercial_revenue_order_delete
  ON public.scalev_orders;

CREATE OR REPLACE FUNCTION public.get_daily_shipment_counts(
  p_workspace_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  date date,
  product text,
  channel text,
  order_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eligible_orders AS (
    SELECT
      orders.id,
      (orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::date AS ship_date
    FROM public.scalev_orders orders
    WHERE orders.workspace_id = p_workspace_id
      AND orders.status IN ('shipped', 'completed')
      AND orders.shipped_time >= (p_from::timestamp AT TIME ZONE 'Asia/Jakarta')
      AND orders.shipped_time < ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Jakarta')
  ), primary_line AS (
    SELECT DISTINCT ON (line.scalev_order_id)
      line.scalev_order_id,
      line.product_type,
      line.sales_channel
    FROM public.scalev_order_lines line
    JOIN eligible_orders ON eligible_orders.id = line.scalev_order_id
    WHERE line.workspace_id = p_workspace_id
      AND line.product_type IS NOT NULL
      AND line.product_type <> 'Unknown'
    ORDER BY line.scalev_order_id, line.product_price_bt DESC
  )
  SELECT
    eligible_orders.ship_date,
    primary_line.product_type,
    primary_line.sales_channel,
    COUNT(*)::bigint
  FROM primary_line
  JOIN eligible_orders ON eligible_orders.id = primary_line.scalev_order_id
  GROUP BY eligible_orders.ship_date, primary_line.product_type,
    primary_line.sales_channel
  ORDER BY eligible_orders.ship_date;
$$;

CREATE OR REPLACE FUNCTION public.get_cr_counts(
  p_workspace_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (total_leads bigint, total_shipped bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      (p_from::timestamp AT TIME ZONE 'Asia/Jakarta') AS ts_from,
      ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Jakarta') AS ts_to
  )
  SELECT
    (
      SELECT COUNT(*)
      FROM public.scalev_orders orders, bounds
      WHERE orders.workspace_id = p_workspace_id
        AND orders.draft_time >= bounds.ts_from
        AND orders.draft_time < bounds.ts_to
        AND orders.store_name NOT ILIKE '%marketplace%'
        AND orders.store_name NOT ILIKE '%shopee%'
        AND orders.store_name NOT ILIKE '%tiktok%'
    ),
    (
      SELECT COUNT(*)
      FROM public.scalev_orders orders, bounds
      WHERE orders.workspace_id = p_workspace_id
        AND orders.shipped_time >= bounds.ts_from
        AND orders.shipped_time < bounds.ts_to
        AND orders.status IN ('shipped', 'completed')
        AND orders.store_name NOT ILIKE '%marketplace%'
        AND orders.store_name NOT ILIKE '%shopee%'
        AND orders.store_name NOT ILIKE '%tiktok%'
    );
$$;

CREATE OR REPLACE FUNCTION public.workspace_commercial_order_entry_revenue(
  p_workspace_id uuid,
  p_dates date[]
)
RETURNS TABLE (
  order_date date,
  product text,
  total_net_sales numeric,
  same_day_net_sales numeric,
  carryover_net_sales numeric,
  before_noon_net_sales numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '60s'
AS $$
  SELECT
    (orders.draft_time AT TIME ZONE 'Asia/Jakarta')::date AS order_date,
    BTRIM(lines.product_type) AS product,
    SUM(COALESCE(lines.product_price_bt, 0) - COALESCE(lines.discount_bt, 0)) AS total_net_sales,
    SUM(
      CASE
        WHEN (orders.draft_time AT TIME ZONE 'Asia/Jakarta')::date
          = (orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::date
          THEN COALESCE(lines.product_price_bt, 0) - COALESCE(lines.discount_bt, 0)
        ELSE 0
      END
    ) AS same_day_net_sales,
    SUM(
      CASE
        WHEN (orders.draft_time AT TIME ZONE 'Asia/Jakarta')::date
          <> (orders.shipped_time AT TIME ZONE 'Asia/Jakarta')::date
          AND BTRIM(COALESCE(lines.sales_channel, '')) = 'CS Manual'
          THEN COALESCE(lines.product_price_bt, 0) - COALESCE(lines.discount_bt, 0)
        ELSE 0
      END
    ) AS carryover_net_sales,
    SUM(
      CASE
        WHEN EXTRACT(HOUR FROM orders.draft_time AT TIME ZONE 'Asia/Jakarta') < 12
          THEN COALESCE(lines.product_price_bt, 0) - COALESCE(lines.discount_bt, 0)
        ELSE 0
      END
    ) AS before_noon_net_sales
  FROM public.scalev_orders orders
  JOIN public.scalev_order_lines lines
    ON lines.scalev_order_id = orders.id
   AND lines.workspace_id = p_workspace_id
  WHERE orders.workspace_id = p_workspace_id
    AND orders.status IN ('shipped', 'completed')
    AND orders.draft_time IS NOT NULL
    AND orders.shipped_time IS NOT NULL
    AND COALESCE(BTRIM(lines.product_type), '') NOT IN ('', 'Unknown')
    AND (orders.draft_time AT TIME ZONE 'Asia/Jakarta')::date = ANY(p_dates)
  GROUP BY
    (orders.draft_time AT TIME ZONE 'Asia/Jakarta')::date,
    BTRIM(lines.product_type)
  ORDER BY order_date, product;
$$;

REVOKE ALL ON FUNCTION public.workspace_customer_order_facts(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_customer_type_daily_exact(uuid, date, date, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_customer_type_period_exact(uuid, date, date, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_customer_cohort(uuid, date, date, int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_monthly_cohort(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_monthly_cohort_channel(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_customer_ltv_rows(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_channel_ltv_90d(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_ltv_trend_by_cohort(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_available_brands(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_channel_cac(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_monthly_cac(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_customer_brand_map(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_cross_brand_matrix(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_brand_analysis_summary(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_brand_journey(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_owned_brand_buyer_health(uuid, int)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_daily_shipment_counts(uuid, date, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_cr_counts(uuid, date, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_commercial_order_entry_revenue(uuid, date[])
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.workspace_customer_order_facts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_type_daily_exact(uuid, date, date, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_type_period_exact(uuid, date, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_customer_cohort(uuid, date, date, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_monthly_cohort(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_monthly_cohort_channel(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_customer_ltv_rows(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_channel_ltv_90d(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_ltv_trend_by_cohort(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_available_brands(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_channel_cac(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_monthly_cac(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_customer_brand_map(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_cross_brand_matrix(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_brand_analysis_summary(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_brand_journey(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_owned_brand_buyer_health(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_shipment_counts(uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_cr_counts(uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_commercial_order_entry_revenue(uuid, date[]) TO service_role;

-- Migration 164 temporarily defaulted every missing tenant key to Roove so
-- legacy writers would keep running during rollout. The application now sends
-- tenant keys explicitly. Remove only that compatibility default: a forgotten
-- workspace must fail loudly instead of silently writing into another company.
DO $$
DECLARE
  v_column record;
BEGIN
  FOR v_column IN
    SELECT c.relname AS table_name, a.attname AS column_name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attrdef d
      ON d.adrelid = a.attrelid
     AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND a.attname IN ('workspace_id', 'owner_workspace_id')
      AND NOT a.attisdropped
      AND pg_get_expr(d.adbin, d.adrelid)
        LIKE '%00000000-0000-4000-8000-000000000001%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I DROP DEFAULT',
      v_column.table_name,
      v_column.column_name
    );
  END LOOP;
END
$$;

COMMIT;
