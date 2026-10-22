-- Disposable fixture for migrations 237 (reader) and 238 (dimensions).
-- Builds only the columns the migration references, applies the migration twice
-- (idempotency), then exercises the role the way PostgREST would: SET ROLE plus
-- the request.jwt.claims setting.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator NOINHERIT; END IF;
END $$;
CREATE TABLE public.workspaces (id uuid PRIMARY KEY, slug text, name text);
INSERT INTO public.workspaces VALUES ('00000000-0000-4000-8000-000000000101'), ('00000000-0000-4000-8000-000000000102');
CREATE TABLE public.daily_ads_spend (
  id bigserial PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.workspaces(id), date date NOT NULL,
  source text, store text, ad_account text, spent numeric(14,2) DEFAULT 0, data_source text,
  impressions bigint DEFAULT 0, cpm numeric(12,2) DEFAULT 0, objective text, advertiser text,
  business_code text, import_id text, secret_note text, brand_id integer
);
CREATE TABLE public.meta_ad_accounts (
  id serial PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.workspaces(id), account_id text NOT NULL,
  account_name text, store text, default_source text, default_advertiser text, default_brand_id integer,
  is_active boolean DEFAULT true, access_token text
);
CREATE TABLE public.brands (id serial PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.workspaces(id), name text NOT NULL, keywords text, is_active boolean DEFAULT true);
CREATE TABLE public.scalev_webhook_businesses (id serial PRIMARY KEY, workspace_id uuid, business_code text, business_name text, is_active boolean DEFAULT true, api_key text, webhook_secret text);
CREATE TABLE public.scalev_store_channels (id serial PRIMARY KEY, workspace_id uuid, business_id integer, store_name text, is_active boolean DEFAULT true);
CREATE TABLE public.business_brand_roles (id serial PRIMARY KEY, workspace_id uuid, brand_id integer, business_id integer, role text, is_active boolean DEFAULT true);
CREATE TABLE public.brand_aliases (id serial PRIMARY KEY, workspace_id uuid, brand_id integer, provider text, alias_type text, alias text, alias_normalized text, is_active boolean DEFAULT true, notes text);
CREATE TABLE public.meta_ad_funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  brand_id integer, config jsonb NOT NULL DEFAULT '{}'::jsonb, version integer NOT NULL DEFAULT 1,
  archived boolean NOT NULL DEFAULT false, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.meta_ad_report_versions (workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id), revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
-- Out-of-scope data that must stay unreachable.
CREATE TABLE public.financial_pl_monthly (workspace_id uuid, month date, laba_rugi numeric);
INSERT INTO public.financial_pl_monthly VALUES ('00000000-0000-4000-8000-000000000101', '2026-09-01', 123);
-- Stand-in for the real report RPC: echoes who ran it and for which workspace.
CREATE FUNCTION public.get_meta_ad_report(
  p_workspace_id uuid, p_from date, p_to date, p_config jsonb DEFAULT '{}'::jsonb,
  p_filters jsonb DEFAULT '{}'::jsonb, p_brand text DEFAULT NULL, p_group_by text DEFAULT 'landing_page',
  p_view text DEFAULT 'overview', p_period text DEFAULT 'week', p_group_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('workspace', p_workspace_id, 'ran_as', current_user, 'spend',
    (SELECT coalesce(sum(spent), 0) FROM public.daily_ads_spend WHERE workspace_id = p_workspace_id AND date BETWEEN p_from AND p_to))
$$;
ALTER TABLE public.daily_ads_spend ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ad_accounts ENABLE ROW LEVEL SECURITY;

INSERT INTO public.daily_ads_spend (workspace_id, date, source, store, ad_account, spent, data_source, secret_note) VALUES
  ('00000000-0000-4000-8000-000000000101', '2026-10-01', 'meta', 'Roove', 'act_1', 100, 'meta_api', 'hidden'),
  ('00000000-0000-4000-8000-000000000101', '2026-10-02', 'meta', 'Roove', 'act_1', 50, 'meta_api', 'hidden'),
  ('00000000-0000-4000-8000-000000000102', '2026-10-01', 'meta', 'Other', 'act_9', 999, 'meta_api', 'hidden');
INSERT INTO public.meta_ad_accounts (workspace_id, account_id, account_name, access_token) VALUES
  ('00000000-0000-4000-8000-000000000101', 'act_1', 'Roove Main', 'tok'),
  ('00000000-0000-4000-8000-000000000102', 'act_9', 'Foreign', 'tok');
INSERT INTO public.brands (workspace_id, name) VALUES ('00000000-0000-4000-8000-000000000101', 'Roove'), ('00000000-0000-4000-8000-000000000102', 'Foreign');
INSERT INTO public.scalev_webhook_businesses (workspace_id, business_code, business_name, api_key, webhook_secret) VALUES
  ('00000000-0000-4000-8000-000000000101', 'RTI', 'Seller', 'hidden', 'hidden'),
  ('00000000-0000-4000-8000-000000000102', 'X', 'Foreign', 'hidden', 'hidden');
INSERT INTO public.scalev_store_channels (workspace_id, business_id, store_name) VALUES
  ('00000000-0000-4000-8000-000000000101', 1, 'Roove Main Store'),
  ('00000000-0000-4000-8000-000000000102', 2, 'Foreign'),
  ('00000000-0000-4000-8000-000000000101', 2, 'Inconsistent cross-tenant FK');
INSERT INTO public.business_brand_roles (workspace_id, brand_id, business_id, role) VALUES
  ('00000000-0000-4000-8000-000000000101', 1, 1, 'seller'),
  ('00000000-0000-4000-8000-000000000102', 2, 2, 'owner'),
  ('00000000-0000-4000-8000-000000000101', 2, 1, 'seller');
INSERT INTO public.brand_aliases (workspace_id, brand_id, alias) VALUES
  ('00000000-0000-4000-8000-000000000101', 1, 'Roove'),
  ('00000000-0000-4000-8000-000000000102', 2, 'Foreign'),
  ('00000000-0000-4000-8000-000000000101', 2, 'Invalid');
INSERT INTO public.meta_ad_funnels (workspace_id, brand_id) VALUES ('00000000-0000-4000-8000-000000000101', 1);
INSERT INTO public.meta_ad_report_versions VALUES ('00000000-0000-4000-8000-000000000101', 7, now());

-- MIGRATION (applied twice by the runner)

CREATE FUNCTION public.expect_error(q text, fragment text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE q;
  RAISE EXCEPTION 'Expected failure containing "%" for: %', fragment, q;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%Expected failure%' THEN RAISE; END IF;
  IF position(fragment IN SQLERRM) = 0 THEN RAISE EXCEPTION 'Wrong error for %: %', q, SQLERRM; END IF;
END $$;

-- As the reader, bound to workspace 101.
SET ROLE mcp_marketing_reader;
SELECT set_config('request.jwt.claims', '{"role":"mcp_marketing_reader","workspace_id":"00000000-0000-4000-8000-000000000101"}', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_marketing.workspaces) <> 1
     OR (SELECT count(*) FROM mcp_marketing.scalev_webhook_businesses) <> 1
     OR (SELECT count(*) FROM mcp_marketing.scalev_store_channels) <> 1
     OR (SELECT count(*) FROM mcp_marketing.business_brand_roles) <> 1
     OR (SELECT count(*) FROM mcp_marketing.brand_aliases) <> 1 THEN
    RAISE EXCEPTION 'Dimension views leak tenants or invalid relations';
  END IF;
  IF (SELECT sum(spent) FROM mcp_marketing.daily_ads_spend) <> 150 THEN RAISE EXCEPTION 'Spend view leaks or misses rows'; END IF;
  IF (SELECT count(*) FROM mcp_marketing.meta_ad_accounts) <> 1 OR (SELECT count(*) FROM mcp_marketing.brands) <> 1
     OR (SELECT count(*) FROM mcp_marketing.meta_ad_funnels) <> 1 OR (SELECT revision FROM mcp_marketing.meta_ad_report_versions) <> 7 THEN
    RAISE EXCEPTION 'Catalog views are not workspace-scoped';
  END IF;
  IF (mcp_marketing.get_meta_ad_report('00000000-0000-4000-8000-000000000101', '2026-10-01', '2026-10-31') ->> 'spend')::numeric <> 150 THEN
    RAISE EXCEPTION 'Report wrapper returned wrong data';
  END IF;
END $$;
SELECT expect_error('SELECT * FROM public.daily_ads_spend', 'permission denied');
SELECT expect_error('SELECT * FROM public.financial_pl_monthly', 'permission denied');
SELECT expect_error('SELECT * FROM public.meta_ad_accounts', 'permission denied');
SELECT expect_error('SELECT public.get_meta_ad_report(''00000000-0000-4000-8000-000000000102'', ''2026-10-01'', ''2026-10-31'')', 'permission denied');
SELECT expect_error('SELECT mcp_marketing.get_meta_ad_report(''00000000-0000-4000-8000-000000000102'', ''2026-10-01'', ''2026-10-31'')', 'tidak sesuai');
SELECT expect_error('SELECT secret_note FROM mcp_marketing.daily_ads_spend', 'does not exist');
SELECT expect_error('SELECT access_token FROM mcp_marketing.meta_ad_accounts', 'does not exist');
SELECT expect_error('SELECT api_key FROM mcp_marketing.scalev_webhook_businesses', 'does not exist');
SELECT expect_error('SELECT webhook_secret FROM mcp_marketing.scalev_webhook_businesses', 'does not exist');
SELECT expect_error('SELECT notes FROM mcp_marketing.brand_aliases', 'does not exist');
SELECT expect_error('SELECT * FROM public.scalev_webhook_businesses', 'permission denied');
SELECT expect_error('UPDATE mcp_marketing.scalev_store_channels SET store_name = ''x''', 'cannot update view');
SELECT expect_error('UPDATE mcp_marketing.scalev_webhook_businesses SET business_name = ''x''', 'permission denied');
SELECT expect_error('INSERT INTO mcp_marketing.brands (workspace_id, id, name) VALUES (''00000000-0000-4000-8000-000000000101'', 99, ''x'')', 'permission denied');
SELECT expect_error('DELETE FROM mcp_marketing.daily_ads_spend', 'permission denied');
SELECT expect_error('CREATE TABLE mcp_marketing.scratch (id int)', 'permission denied');

-- Same role, token for workspace 102: only that workspace is visible.
SELECT set_config('request.jwt.claims', '{"role":"mcp_marketing_reader","workspace_id":"00000000-0000-4000-8000-000000000102"}', false);
DO $$ BEGIN
  IF (SELECT sum(spent) FROM mcp_marketing.daily_ads_spend) <> 999 THEN RAISE EXCEPTION 'Workspace switch via claim failed'; END IF;
END $$;
SELECT expect_error('SELECT mcp_marketing.get_meta_ad_report(''00000000-0000-4000-8000-000000000101'', ''2026-10-01'', ''2026-10-31'')', 'tidak sesuai');

-- No claim at all: nothing is visible and the wrapper refuses.
SELECT set_config('request.jwt.claims', '', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM mcp_marketing.daily_ads_spend) <> 0 THEN RAISE EXCEPTION 'Rows visible without a workspace claim'; END IF;
  IF (SELECT count(*) FROM mcp_marketing.workspaces) <> 0
     OR (SELECT count(*) FROM mcp_marketing.scalev_webhook_businesses) <> 0
     OR (SELECT count(*) FROM mcp_marketing.scalev_store_channels) <> 0
     OR (SELECT count(*) FROM mcp_marketing.business_brand_roles) <> 0
     OR (SELECT count(*) FROM mcp_marketing.brand_aliases) <> 0 THEN
    RAISE EXCEPTION 'Dimensions visible without a workspace claim';
  END IF;
END $$;
SELECT expect_error('SELECT mcp_marketing.get_meta_ad_report(''00000000-0000-4000-8000-000000000101'', ''2026-10-01'', ''2026-10-31'')', 'tidak sesuai');
RESET ROLE;

DO $$ BEGIN
  IF NOT pg_has_role('authenticator', 'mcp_marketing_reader', 'MEMBER') THEN RAISE EXCEPTION 'authenticator cannot switch to the reader role'; END IF;
  IF has_function_privilege('mcp_marketing_reader', 'public.get_meta_ad_report(uuid,date,date,jsonb,jsonb,text,text,text,text,text)', 'EXECUTE')
     AND has_schema_privilege('mcp_marketing_reader', 'public', 'USAGE') THEN
    RAISE NOTICE 'public functions remain callable through PUBLIC grants; see MCP_USAGE.md hardening note';
  END IF;
END $$;
SELECT 'mcp_marketing_reader: OK' AS result;
