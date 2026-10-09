-- LOCAL ONLY: reconstruct pre-migration tables originally created in SQL Editor.
-- Column types were checked using read-only pg_catalog metadata on 2026-10-08.
-- No production rows, auth users, integration keys, or credentials are copied.
-- Workspace columns and later features are added by the repository migrations.
CREATE TABLE public.brands (
  id serial PRIMARY KEY, name text NOT NULL UNIQUE, sheet_name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.product_mapping (
  id serial PRIMARY KEY, product_name text NOT NULL UNIQUE, product_type text NOT NULL,
  created_at timestamptz DEFAULT now(), sku text, cogs numeric(12,2) DEFAULT 0, brand text
);
CREATE TABLE public.scalev_orders (
  id bigserial PRIMARY KEY, scalev_id bigint UNIQUE, order_id text NOT NULL,
  status text NOT NULL, shipped_time timestamptz, platform text, store_name text,
  utm_source text, financial_entity text, payment_method text,
  unique_code_discount numeric(12,2) DEFAULT 0,
  is_purchase_fb boolean DEFAULT false, is_purchase_tiktok boolean DEFAULT false,
  is_purchase_kwai boolean DEFAULT false, gross_revenue numeric(14,2) DEFAULT 0,
  net_revenue numeric(14,2) DEFAULT 0, shipping_cost numeric(12,2) DEFAULT 0,
  total_quantity integer DEFAULT 0, raw_data jsonb, synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(), customer_name text, customer_phone text,
  customer_email text, customer_type text, province text, city text, subdistrict text,
  handler text, draft_time timestamptz, pending_time timestamptz, confirmed_time timestamptz,
  paid_time timestamptz, canceled_time timestamptz, source text DEFAULT 'api',
  external_id text, completed_time timestamptz
);
CREATE TABLE public.scalev_order_lines (
  id bigserial PRIMARY KEY, scalev_order_id bigint REFERENCES public.scalev_orders(id) ON DELETE CASCADE,
  order_id text NOT NULL, product_name text NOT NULL, product_type text, variant_sku text,
  quantity integer DEFAULT 1, product_price_bt numeric(12,2) DEFAULT 0,
  discount_bt numeric(12,2) DEFAULT 0, cogs_bt numeric(12,2) DEFAULT 0,
  tax_rate numeric(5,2) DEFAULT 11, sales_channel text,
  is_purchase_fb boolean DEFAULT false, is_purchase_tiktok boolean DEFAULT false,
  is_purchase_kwai boolean DEFAULT false, synced_at timestamptz DEFAULT now(),
  shipped_time timestamptz, is_inventory boolean DEFAULT true
);
CREATE TABLE public.scalev_sync_log (
  id serial PRIMARY KEY, started_at timestamptz DEFAULT now(), completed_at timestamptz,
  status text DEFAULT 'running', orders_fetched integer DEFAULT 0,
  orders_inserted integer DEFAULT 0, orders_updated integer DEFAULT 0,
  error_message text, sync_type text DEFAULT 'incremental', uploaded_by text, filename text
);
CREATE TABLE public.scalev_config (
  id serial PRIMARY KEY, api_key text NOT NULL, base_url text DEFAULT 'https://api.scalev.id/v2',
  is_active boolean DEFAULT true, last_sync_id bigint DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.sheet_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), spreadsheet_id text NOT NULL,
  label text NOT NULL, is_active boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id), created_at timestamptz DEFAULT now(),
  last_synced timestamptz, last_sync_status text, last_sync_message text,
  CONSTRAINT unique_spreadsheet_id UNIQUE(spreadsheet_id)
);
CREATE TABLE public.financial_sheet_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), spreadsheet_id text NOT NULL,
  label text NOT NULL, is_active boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id), created_at timestamptz DEFAULT now(),
  last_synced timestamptz, last_sync_status text, last_sync_message text,
  CONSTRAINT unique_financial_spreadsheet_id UNIQUE(spreadsheet_id)
);
CREATE TABLE public.financial_pl_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), month date NOT NULL, line_item text NOT NULL,
  line_item_label text, section text, amount numeric DEFAULT 0, pct_sales numeric,
  pct_net_sales numeric, synced_at timestamptz DEFAULT now(), UNIQUE(month,line_item)
);
CREATE TABLE public.financial_cf_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), month date NOT NULL, section text NOT NULL,
  line_item text NOT NULL, line_item_label text, sub_section text, amount numeric DEFAULT 0,
  synced_at timestamptz DEFAULT now(), UNIQUE(month,section,line_item)
);
CREATE TABLE public.financial_ratios_monthly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), month date NOT NULL, ratio_name text NOT NULL,
  ratio_label text, category text, value numeric, benchmark_min numeric, benchmark_max numeric,
  benchmark_label text, synced_at timestamptz DEFAULT now(), UNIQUE(month,ratio_name)
);
CREATE TABLE public.financial_bs_monthly (
  id bigserial PRIMARY KEY, month date NOT NULL, line_item text NOT NULL, line_item_label text,
  section text NOT NULL, amount double precision NOT NULL DEFAULT 0, pct_of_asset double precision,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(month,line_item)
);
CREATE TABLE public.financial_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), analysis_type text NOT NULL DEFAULT 'executive',
  analysis_data jsonb NOT NULL, health_score integer, generated_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.monthly_cashflow_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), period_month integer NOT NULL,
  period_year integer NOT NULL, is_auto boolean DEFAULT false, captured_at timestamptz DEFAULT now(),
  net_sales numeric DEFAULT 0, cash_received numeric DEFAULT 0, cash_received_orders integer DEFAULT 0,
  spill_over_in numeric DEFAULT 0, spill_over_in_orders integer DEFAULT 0,
  cash_in_progress numeric DEFAULT 0, cash_in_progress_orders integer DEFAULT 0,
  canceled_rts numeric DEFAULT 0, canceled_rts_orders integer DEFAULT 0,
  collection_rate numeric DEFAULT 0, spillover_ratio numeric DEFAULT 0, pending_ratio numeric DEFAULT 0,
  avg_days_to_complete numeric DEFAULT 0, median_days_to_complete numeric DEFAULT 0,
  p90_days_to_complete numeric DEFAULT 0, channel_metrics jsonb DEFAULT '{}',
  triggered_by text DEFAULT 'manual', notes text,
  CONSTRAINT unique_snapshot_per_month UNIQUE(period_month,period_year,is_auto)
);
-- Historical customer views pre-date 026. Migration 040 replaces their old
-- line-level shipped_time dependency and 042 persists the identity column.
CREATE VIEW public.v_order_with_identity AS
SELECT so.id AS order_db_id,so.order_id,so.customer_name,so.customer_phone,
  so.customer_type AS csv_customer_type,so.platform,so.store_name,sol.shipped_time,
  sol.sales_channel,sol.product_type,sol.quantity,sol.product_price_bt,sol.discount_bt,
  sol.cogs_bt,sol.scalev_order_id,
  CASE WHEN so.customer_name IS NULL THEN 'unidentified:'||so.order_id
    WHEN so.platform=ANY(ARRAY['shopee','tiktokshop','tiktok','lazada','tokopedia','blibli'])
      THEN so.platform||':'||so.customer_name
    WHEN coalesce(so.customer_phone,'')<>'' THEN so.customer_phone
    ELSE coalesce(so.platform,'unknown')||':'||coalesce(so.customer_name,'unknown') END AS customer_identifier,
  sol.product_price_bt-sol.discount_bt AS line_revenue,sol.cogs_bt AS line_cogs
FROM public.scalev_order_lines sol JOIN public.scalev_orders so ON sol.scalev_order_id=so.id
WHERE sol.shipped_time IS NOT NULL AND so.status IN ('completed','shipped');
CREATE VIEW public.v_customer_first_order AS
SELECT customer_identifier,min(date(shipped_time)) AS first_order_date
FROM public.v_order_with_identity GROUP BY customer_identifier;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'brands','product_mapping','scalev_orders','scalev_order_lines','scalev_sync_log',
    'scalev_config','sheet_connections','financial_sheet_connections','financial_pl_monthly',
    'financial_cf_monthly','financial_ratios_monthly','financial_bs_monthly',
    'financial_analyses','monthly_cashflow_snapshot'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY local_legacy_read ON public.%I FOR SELECT TO authenticated USING (true)',t);
  END LOOP;
END $$;
