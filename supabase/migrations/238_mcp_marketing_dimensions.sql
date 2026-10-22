BEGIN;
-- Add only non-secret dimension metadata to the existing JWT-bound reader.
-- Do not expose business API keys/webhook secrets, workspace settings or PII.
CREATE OR REPLACE VIEW mcp_marketing.workspaces AS
  SELECT id, slug, name FROM public.workspaces
  WHERE id = mcp_marketing.jwt_workspace_id();

CREATE OR REPLACE VIEW mcp_marketing.brands AS
  SELECT workspace_id, id, name, is_active FROM public.brands
  WHERE workspace_id = mcp_marketing.jwt_workspace_id();

CREATE OR REPLACE VIEW mcp_marketing.scalev_webhook_businesses AS
  SELECT workspace_id, id, business_code, business_name, is_active
  FROM public.scalev_webhook_businesses
  WHERE workspace_id = mcp_marketing.jwt_workspace_id();

CREATE OR REPLACE VIEW mcp_marketing.scalev_store_channels AS
  SELECT s.workspace_id, s.id, s.business_id, s.store_name, s.is_active
  FROM public.scalev_store_channels s
  JOIN public.scalev_webhook_businesses b
    ON b.id = s.business_id AND b.workspace_id = s.workspace_id
  WHERE s.workspace_id = mcp_marketing.jwt_workspace_id();

CREATE OR REPLACE VIEW mcp_marketing.business_brand_roles AS
  SELECT r.workspace_id, r.id, r.brand_id, r.business_id, r.role, r.is_active
  FROM public.business_brand_roles r
  JOIN public.brands b ON b.id = r.brand_id AND b.workspace_id = r.workspace_id
  JOIN public.scalev_webhook_businesses business
    ON business.id = r.business_id AND business.workspace_id = r.workspace_id
  WHERE r.workspace_id = mcp_marketing.jwt_workspace_id();

CREATE OR REPLACE VIEW mcp_marketing.brand_aliases AS
  SELECT a.workspace_id, a.id, a.brand_id, a.provider, a.alias_type,
         a.alias, a.alias_normalized, a.is_active
  FROM public.brand_aliases a
  JOIN public.brands b ON b.id = a.brand_id AND b.workspace_id = a.workspace_id
  WHERE a.workspace_id = mcp_marketing.jwt_workspace_id();

-- Append columns to preserve the existing view's column order/dependencies.
-- brand_id is frozen on the spend row; store is a legacy label, NOT a store FK.
CREATE OR REPLACE VIEW mcp_marketing.daily_ads_spend AS
  SELECT workspace_id, date, source, store, ad_account, spent, data_source,
         impressions, cpm, objective, advertiser, business_code, id, brand_id
  FROM public.daily_ads_spend
  WHERE workspace_id = mcp_marketing.jwt_workspace_id();

REVOKE ALL ON mcp_marketing.workspaces, mcp_marketing.scalev_webhook_businesses,
  mcp_marketing.scalev_store_channels, mcp_marketing.business_brand_roles,
  mcp_marketing.brand_aliases FROM PUBLIC;
GRANT SELECT ON mcp_marketing.workspaces, mcp_marketing.scalev_webhook_businesses,
  mcp_marketing.scalev_store_channels, mcp_marketing.business_brand_roles,
  mcp_marketing.brand_aliases TO mcp_marketing_reader;
NOTIFY pgrst, 'reload schema';
COMMIT;
