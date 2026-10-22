BEGIN;
-- MCP marketing reader: a read-only database identity for the remote Roove BI
-- MCP Worker (Basecamp agent). Scope mirrors the app's advertiser role: Meta Ads
-- and marketing spend only.
--
-- Design:
--  * The role never receives privileges on schema public. Everything it can read
--    lives in schema mcp_marketing: workspace-scoped views over five tables and
--    one wrapper around get_meta_ad_report.
--  * The workspace comes from the JWT claim `workspace_id`; a token minted for
--    one workspace cannot read another. Each view and the wrapper enforce it.
--  * Views and the wrapper run as their owner (the migration role), so RLS on the
--    underlying tables does not apply; the explicit column lists and the
--    workspace predicate are the access control.
--  * Nothing here grants INSERT, UPDATE, DELETE, or EXECUTE on anything else.

-- 1. Role --------------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_marketing_reader') THEN
    CREATE ROLE mcp_marketing_reader NOLOGIN NOINHERIT;
  END IF;
END $$;
-- PostgREST switches to the JWT `role`; the role must be a member of authenticator.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    GRANT mcp_marketing_reader TO authenticator;
  END IF;
END $$;

-- 2. Schema ------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS mcp_marketing;
REVOKE ALL ON SCHEMA mcp_marketing FROM PUBLIC;
GRANT USAGE ON SCHEMA mcp_marketing TO mcp_marketing_reader;

-- Workspace bound to the token. NULL (no claim) matches no rows.
CREATE OR REPLACE FUNCTION mcp_marketing.jwt_workspace_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'workspace_id')::uuid
$$;
REVOKE ALL ON FUNCTION mcp_marketing.jwt_workspace_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_marketing.jwt_workspace_id() TO mcp_marketing_reader;

-- 3. Workspace-scoped views (explicit columns only) --------------------------
CREATE OR REPLACE VIEW mcp_marketing.daily_ads_spend AS
  SELECT workspace_id, date, source, store, ad_account, spent, data_source,
         impressions, cpm, objective, advertiser, business_code
  FROM public.daily_ads_spend
  WHERE workspace_id = mcp_marketing.jwt_workspace_id();

CREATE OR REPLACE VIEW mcp_marketing.meta_ad_accounts AS
  SELECT workspace_id, account_id, account_name, store, default_source,
         default_advertiser, default_brand_id, is_active
  FROM public.meta_ad_accounts
  WHERE workspace_id = mcp_marketing.jwt_workspace_id();

CREATE OR REPLACE VIEW mcp_marketing.meta_ad_funnels AS
  SELECT workspace_id, id, brand_id, config, version, archived, created_at, updated_at
  FROM public.meta_ad_funnels
  WHERE workspace_id = mcp_marketing.jwt_workspace_id();

CREATE OR REPLACE VIEW mcp_marketing.brands AS
  SELECT workspace_id, id, name
  FROM public.brands
  WHERE workspace_id = mcp_marketing.jwt_workspace_id();

CREATE OR REPLACE VIEW mcp_marketing.meta_ad_report_versions AS
  SELECT workspace_id, revision, updated_at
  FROM public.meta_ad_report_versions
  WHERE workspace_id = mcp_marketing.jwt_workspace_id();

REVOKE ALL ON ALL TABLES IN SCHEMA mcp_marketing FROM PUBLIC;
GRANT SELECT ON mcp_marketing.daily_ads_spend,
                mcp_marketing.meta_ad_accounts,
                mcp_marketing.meta_ad_funnels,
                mcp_marketing.brands,
                mcp_marketing.meta_ad_report_versions
  TO mcp_marketing_reader;

-- 4. Report wrapper -----------------------------------------------------------
-- Same signature as public.get_meta_ad_report so the MCP client code is unchanged;
-- it only adds the workspace check and runs with the owner's privileges.
CREATE OR REPLACE FUNCTION mcp_marketing.get_meta_ad_report(
  p_workspace_id uuid, p_from date, p_to date, p_config jsonb DEFAULT '{}'::jsonb,
  p_filters jsonb DEFAULT '{}'::jsonb, p_brand text DEFAULT NULL, p_group_by text DEFAULT 'landing_page',
  p_view text DEFAULT 'overview', p_period text DEFAULT 'week', p_group_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_workspace_id IS DISTINCT FROM mcp_marketing.jwt_workspace_id() THEN
    RAISE EXCEPTION 'Workspace tidak sesuai dengan token MCP.' USING ERRCODE = '42501';
  END IF;
  RETURN public.get_meta_ad_report(
    p_workspace_id, p_from, p_to, p_config, p_filters, p_brand, p_group_by, p_view, p_period, p_group_key
  );
END $$;
REVOKE ALL ON FUNCTION mcp_marketing.get_meta_ad_report(uuid, date, date, jsonb, jsonb, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mcp_marketing.get_meta_ad_report(uuid, date, date, jsonb, jsonb, text, text, text, text, text)
  TO mcp_marketing_reader;

-- 5. Make sure no wider privilege slipped in ---------------------------------
DO $$ BEGIN
  IF has_schema_privilege('mcp_marketing_reader', 'public', 'USAGE')
     AND EXISTS (
       SELECT 1 FROM information_schema.role_table_grants
       WHERE grantee = 'mcp_marketing_reader' AND table_schema = 'public'
     ) THEN
    RAISE EXCEPTION 'mcp_marketing_reader must not hold table grants in schema public';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE grantee = 'mcp_marketing_reader' AND privilege_type <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'mcp_marketing_reader must be SELECT-only';
  END IF;
END $$;

COMMENT ON SCHEMA mcp_marketing IS
  'Read-only, workspace-scoped surface for the remote Roove BI MCP Worker (role mcp_marketing_reader). Expose this schema in the Data API settings.';
COMMIT;
