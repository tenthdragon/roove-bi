BEGIN;
-- Current destination evidence is separate from historical delivery facts.
CREATE TABLE public.meta_ad_destination_metadata (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 account_id text NOT NULL, ad_id text NOT NULL CHECK(ad_id ~ '^[0-9]+$'),
 creative_id text, adset_id text, destination_type text,
 metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object'),
 classification text NOT NULL CHECK(classification IN ('cpas','unknown')),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array'),
 observed_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,account_id,ad_id)
);
CREATE INDEX meta_ad_destination_classification ON public.meta_ad_destination_metadata(workspace_id,classification,account_id);
-- Entries require explicit verification, never an account name or a generic catalog ID.
CREATE TABLE public.meta_shopee_product_sets (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), account_id text NOT NULL,
 product_set_id text NOT NULL CHECK(product_set_id ~ '^[0-9]+$'),
 verification jsonb NOT NULL CHECK(jsonb_typeof(verification)='object' AND verification <> '{}'::jsonb),
 verified_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,account_id,product_set_id)
);
ALTER TABLE public.meta_ad_destination_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_shopee_product_sets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ad_destination_metadata,public.meta_shopee_product_sets FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_ad_destination_metadata,public.meta_shopee_product_sets TO service_role;
CREATE FUNCTION public.list_meta_ads_for_destination_backfill(p_workspace_id uuid)
RETURNS TABLE(account_id text,ad_id text) LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 WITH stored AS (
  SELECT c.account_id,c.ad_id FROM meta_ad_creatives c WHERE c.workspace_id=p_workspace_id
  UNION SELECT m.account_id,m.ad_id FROM meta_ad_mappings m WHERE m.workspace_id=p_workspace_id
  UNION SELECT d.account_id,d.ad_id FROM meta_ad_daily_metrics d WHERE d.workspace_id=p_workspace_id
 ) SELECT s.account_id,s.ad_id FROM stored s WHERE EXISTS (
  SELECT 1 FROM meta_ad_accounts a WHERE a.workspace_id=p_workspace_id AND a.account_id=s.account_id
 ) ORDER BY s.account_id,s.ad_id
$$;
REVOKE ALL ON FUNCTION public.list_meta_ads_for_destination_backfill(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_meta_ads_for_destination_backfill(uuid) TO service_role;
COMMENT ON TABLE public.meta_ad_destination_metadata IS 'Current API observations only; not proof of destinations at historical delivery dates. Failed API reads must preserve existing observations.';
NOTIFY pgrst,'reload schema';
COMMIT;
