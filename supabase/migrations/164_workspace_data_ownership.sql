-- ============================================================================
-- 164: Add workspace ownership to existing private data
-- ============================================================================
-- Existing records are assigned to Roove Workspace. A temporary Roove default
-- keeps the current production writers backward-compatible while application
-- code is migrated. A later hardening migration must remove these defaults
-- after every writer and trigger supplies workspace_id explicitly.
--
-- Performance note:
-- PostgreSQL 11+ can add a column with a constant DEFAULT without rewriting
-- existing rows. Keep the DEFAULT + NOT NULL in the ADD COLUMN statement.
-- Foreign keys are installed NOT VALID so PostgreSQL does not scan every
-- historical table during this migration; new writes are still enforced.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_table TEXT;
  v_column_is_not_null BOOLEAN;
  v_tables TEXT[] := ARRAY[
    -- Commercial facts and configuration
    'brands',
    'data_imports',
    'daily_ads_spend',
    'monthly_product_summary',
    'ads_store_brand_mapping',
    'marketplace_commission_rates',
    'marketplace_fee_estimate_rates',
    'monthly_overhead',
    'tax_rates',
    'tax_formula_config',
    'product_mapping',
    'sheet_connections',
    'summary_daily_order_channel',
    'summary_daily_ads_by_brand',
    'summary_daily_channel_complete',
    'summary_daily_product_complete',
    'summary_customer_first_order',
    'summary_daily_customer_type',
    'summary_customer_cohort',
    'summary_monthly_cohort',
    'summary_monthly_cohort_channel',
    'summary_customer_ltv',
    'summary_scalev_daily_product_demand',
    'summary_scalev_monthly_movements',
    'summary_commercial_order_entry_revenue',

    -- ScaleV source data and configuration
    'scalev_orders',
    'scalev_order_lines',
    'scalev_webhook_businesses',
    'scalev_store_channels',
    'scalev_sync_log',
    'scalev_config',
    'scalev_catalog_products',
    'scalev_catalog_variants',
    'scalev_catalog_bundles',
    'scalev_catalog_identifiers',
    'scalev_catalog_bundle_lines',
    'scalev_catalog_bundle_store_links',
    'scalev_catalog_sync_state',
    'scalev_marketplace_webhook_quarantine',

    -- Marketing integrations
    'meta_ad_accounts',
    'meta_sync_log',
    'waba_accounts',
    'waba_sync_log',
    'waba_templates',
    'waba_template_daily_analytics',
    'waba_template_sync_log',
    'shopee_shops',
    'shopee_shop_tokens',
    'shopee_shop_spend_streams',
    'shopee_ads_daily_metrics',
    'shopee_sync_log',

    -- Marketplace intake
    'marketplace_intake_batches',
    'marketplace_intake_orders',
    'marketplace_intake_order_lines',
    'marketplace_intake_manual_memory',
    'marketplace_intake_sku_aliases',
    'marketplace_intake_source_store_scopes',

    -- Finance and bank
    'bank_accounts',
    'bank_upload_sessions',
    'bank_transactions',
    'financial_sheet_connections',
    'financial_pl_monthly',
    'financial_cf_monthly',
    'financial_ratios_monthly',
    'financial_bs_monthly',
    'financial_analyses',
    'monthly_cashflow_snapshot',

    -- Warehouse configuration and operational records
    'warehouse_sheet_connections',
    'warehouse_stock_summary',
    'warehouse_daily_stock',
    'warehouse_stock_opname',
    'warehouse_vendors',
    'warehouse_purchase_orders',
    'warehouse_po_items',
    'warehouse_demand_plans',
    'warehouse_business_mapping',
    'warehouse_business_directory',
    'warehouse_origin_registry',
    'warehouse_scalev_mapping',
    'warehouse_scalev_catalog_mapping',
    'warehouse_stock_opname_sessions',
    'warehouse_stock_reclass_requests',
    'warehouse_rts_verifications',
    'warehouse_rts_verification_items',
    'warehouse_activity_log',

    -- Async work and audit
    'sync_jobs'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = v_table
        AND c.relkind IN ('r', 'p')
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS workspace_id UUID NOT NULL DEFAULT %L::UUID',
        v_table,
        '00000000-0000-4000-8000-000000000001'
      );
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN workspace_id SET DEFAULT %L::UUID',
        v_table,
        '00000000-0000-4000-8000-000000000001'
      );

      -- The fast ADD COLUMN path above already covers the normal deployment.
      -- Only repair a nullable column when retrying a partially prepared schema.
      SELECT a.attnotnull
      INTO v_column_is_not_null
      FROM pg_attribute a
      WHERE a.attrelid = format('public.%I', v_table)::regclass
        AND a.attname = 'workspace_id'
        AND NOT a.attisdropped;

      IF NOT COALESCE(v_column_is_not_null, FALSE) THEN
        EXECUTE format(
          'UPDATE public.%I SET workspace_id = %L::UUID WHERE workspace_id IS NULL',
          v_table,
          '00000000-0000-4000-8000-000000000001'
        );
        EXECUTE format(
          'ALTER TABLE public.%I ALTER COLUMN workspace_id SET NOT NULL',
          v_table
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = v_table
          AND con.conname = v_table || '_workspace_id_fkey'
      ) THEN
        EXECUTE format(
          'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT NOT VALID',
          v_table,
          v_table || '_workspace_id_fkey'
        );
      END IF;
    END IF;
  END LOOP;
END
$$;

-- Inventory lives in a shared physical warehouse, but every product and all
-- stock derived from it have an explicit owning workspace.
DO $$
DECLARE
  v_column_is_not_null BOOLEAN;
BEGIN
  IF to_regclass('public.warehouse_products') IS NOT NULL THEN
    ALTER TABLE public.warehouse_products
      ADD COLUMN IF NOT EXISTS owner_workspace_id UUID
      NOT NULL
      DEFAULT '00000000-0000-4000-8000-000000000001'::UUID;

    ALTER TABLE public.warehouse_products
      ALTER COLUMN owner_workspace_id
      SET DEFAULT '00000000-0000-4000-8000-000000000001'::UUID;

    SELECT a.attnotnull
    INTO v_column_is_not_null
    FROM pg_attribute a
    WHERE a.attrelid = 'public.warehouse_products'::regclass
      AND a.attname = 'owner_workspace_id'
      AND NOT a.attisdropped;

    IF NOT COALESCE(v_column_is_not_null, FALSE) THEN
      UPDATE public.warehouse_products
      SET owner_workspace_id = '00000000-0000-4000-8000-000000000001'::UUID
      WHERE owner_workspace_id IS NULL;

      ALTER TABLE public.warehouse_products
        ALTER COLUMN owner_workspace_id SET NOT NULL;
    END IF;

    IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = 'public.warehouse_products'::regclass
         AND conname = 'warehouse_products_owner_workspace_id_fkey'
     ) THEN
      ALTER TABLE public.warehouse_products
        ADD CONSTRAINT warehouse_products_owner_workspace_id_fkey
        FOREIGN KEY (owner_workspace_id)
        REFERENCES public.workspaces(id)
        ON DELETE RESTRICT
        NOT VALID;
    END IF;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_warehouse_products_owner_workspace
  ON public.warehouse_products (owner_workspace_id, warehouse, is_active);

-- Preserve historical overhead while allowing the same month in another
-- workspace.
ALTER TABLE IF EXISTS public.monthly_overhead
  DROP CONSTRAINT IF EXISTS monthly_overhead_year_month_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_overhead_workspace_month
  ON public.monthly_overhead (workspace_id, year_month);

ALTER TABLE IF EXISTS public.marketplace_fee_estimate_rates
  DROP CONSTRAINT IF EXISTS marketplace_fee_estimate_rates_setting_key_effective_from_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mp_fee_rates_workspace_key_date
  ON public.marketplace_fee_estimate_rates (
    workspace_id,
    setting_key,
    effective_from
  );

ALTER TABLE IF EXISTS public.marketplace_commission_rates
  DROP CONSTRAINT IF EXISTS marketplace_commission_rates_channel_effective_from_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_commission_rates_workspace_channel_date
  ON public.marketplace_commission_rates (
    workspace_id,
    channel,
    effective_from
  );

ALTER TABLE IF EXISTS public.tax_rates
  DROP CONSTRAINT IF EXISTS tax_rates_name_effective_from_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_rates_workspace_name_date
  ON public.tax_rates (workspace_id, name, effective_from);

-- Imports may use the same source filename in different workspaces.
ALTER TABLE IF EXISTS public.data_imports
  DROP CONSTRAINT IF EXISTS data_imports_period_month_period_year_filename_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_data_imports_workspace_period_file
  ON public.data_imports (workspace_id, period_month, period_year, filename);

-- Bank account uniqueness is tenant-local in the application model.
ALTER TABLE IF EXISTS public.bank_accounts
  DROP CONSTRAINT IF EXISTS bank_accounts_bank_account_no_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_accounts_workspace_bank_number
  ON public.bank_accounts (workspace_id, bank, account_no);

ALTER TABLE IF EXISTS public.meta_ad_accounts
  DROP CONSTRAINT IF EXISTS meta_ad_accounts_account_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_meta_accounts_workspace_account
  ON public.meta_ad_accounts (workspace_id, account_id);

ALTER TABLE IF EXISTS public.waba_accounts
  DROP CONSTRAINT IF EXISTS waba_accounts_waba_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_waba_accounts_workspace_waba
  ON public.waba_accounts (workspace_id, waba_id);

ALTER TABLE IF EXISTS public.shopee_shops
  DROP CONSTRAINT IF EXISTS shopee_shops_shop_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_shopee_shops_workspace_shop
  ON public.shopee_shops (workspace_id, shop_id);

ALTER TABLE IF EXISTS public.scalev_orders
  DROP CONSTRAINT IF EXISTS scalev_orders_order_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scalev_orders_workspace_order
  ON public.scalev_orders (workspace_id, order_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouse_business_mapping_workspace_target
  ON public.warehouse_business_mapping (
    workspace_id,
    business_code,
    deduct_entity,
    deduct_warehouse
  );

ALTER TABLE IF EXISTS public.bank_upload_sessions
  DROP CONSTRAINT IF EXISTS bank_upload_sessions_bank_acct_period_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_sessions_workspace_account_period
  ON public.bank_upload_sessions (
    workspace_id,
    bank,
    account_no,
    period_label
  );

-- Dedupe is tenant-local: two workspaces may run the same sync concurrently.
DROP INDEX IF EXISTS public.idx_sync_jobs_active_dedupe;
CREATE UNIQUE INDEX idx_sync_jobs_active_dedupe
  ON public.sync_jobs (workspace_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'running');

-- All tenant-owned rows are readable only by members of their workspace when
-- accessed with an authenticated client. Service-role workers still need to
-- pass workspace_id explicitly and are guarded in application code.
DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOR v_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a
      ON a.attrelid = c.oid
     AND a.attname = 'workspace_id'
     AND NOT a.attisdropped
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname NOT IN (
        'workspace_memberships',
        'workspace_integrations',
        'workspace_warehouse_access'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'DROP POLICY IF EXISTS workspace_tenant_isolation ON public.%I',
      v_table
    );
    EXECUTE format(
      'CREATE POLICY workspace_tenant_isolation ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.workspace_can_access(workspace_id)) WITH CHECK (public.workspace_can_access(workspace_id))',
      v_table
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.workspace_can_access_inventory_product(
  p_warehouse_product_id INT,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.warehouse_products wp
    WHERE wp.id = p_warehouse_product_id
      AND public.workspace_can_access(wp.owner_workspace_id, p_user_id)
  );
$$;

REVOKE ALL ON FUNCTION public.workspace_can_access_inventory_product(INT, UUID)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workspace_can_access_inventory_product(INT, UUID)
  TO authenticated;

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'warehouse_batches',
    'warehouse_stock_ledger',
    'warehouse_transfers'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a
        ON a.attrelid = c.oid
       AND a.attname = 'warehouse_product_id'
       AND NOT a.attisdropped
      WHERE n.nspname = 'public'
        AND c.relname = v_table
        AND c.relkind IN ('r', 'p')
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
      EXECUTE format(
        'DROP POLICY IF EXISTS workspace_inventory_isolation ON public.%I',
        v_table
      );
      EXECUTE format(
        'CREATE POLICY workspace_inventory_isolation ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.workspace_can_access_inventory_product(warehouse_product_id)) WITH CHECK (public.workspace_can_access_inventory_product(warehouse_product_id))',
        v_table
      );
    END IF;
  END LOOP;
END
$$;

ALTER TABLE public.warehouse_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_inventory_product_isolation
  ON public.warehouse_products;
CREATE POLICY workspace_inventory_product_isolation
  ON public.warehouse_products
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.workspace_can_access(owner_workspace_id))
  WITH CHECK (public.workspace_can_access(owner_workspace_id));

COMMIT;
