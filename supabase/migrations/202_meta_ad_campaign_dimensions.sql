BEGIN;
-- Campaign objective is authoritative Meta metadata, separate from naming intention.
ALTER TABLE public.meta_ad_mappings
 ADD COLUMN campaign_id text,
 ADD COLUMN campaign_name text,
 ADD COLUMN campaign_objective text,
 ADD COLUMN campaign_observed_at timestamptz,
 ADD COLUMN cep_key text GENERATED ALWAYS AS (coalesce(overrides->>'cep',jsonb_path_query_first(auto_mapping,'$.tags[*] ? (@.dimension == "cep")')->>'key')) STORED,
 ADD COLUMN intention_key text GENERATED ALWAYS AS (coalesce(overrides->>'intention',jsonb_path_query_first(auto_mapping,'$.tags[*] ? (@.dimension == "intention")')->>'key')) STORED;
CREATE INDEX meta_ad_mapping_dimensions ON public.meta_ad_mappings(workspace_id,cep_key,campaign_objective,account_id);

CREATE FUNCTION public.set_meta_ad_campaign_dimensions(p_workspace_id uuid,p_account_id text,p_rows jsonb,p_observed_at timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r jsonb; n integer:=0;
BEGIN
 IF p_workspace_id IS NULL OR p_account_id IS NULL OR p_observed_at IS NULL OR p_rows IS NULL
 OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>500
 OR NOT EXISTS(SELECT 1 FROM public.meta_ad_accounts WHERE workspace_id=p_workspace_id AND account_id=p_account_id) THEN RAISE EXCEPTION 'Invalid campaign dimension scope'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':meta-mapping:'||p_account_id,0));
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF r->>'ad_id' IS NULL OR r->>'ad_id' !~ '^[0-9]+$'
   OR (r->>'campaign_id' IS NOT NULL AND r->>'campaign_id' !~ '^[0-9]+$')
   OR (r->>'campaign_objective' IS NOT NULL AND r->>'campaign_objective' !~ '^[A-Z0-9_]{1,100}$') THEN RAISE EXCEPTION 'Invalid campaign dimension row'; END IF;
  UPDATE public.meta_ad_mappings SET campaign_id=r->>'campaign_id',campaign_name=r->>'campaign_name',
   campaign_objective=CASE WHEN r->>'campaign_objective' IS NOT NULL THEN r->>'campaign_objective'
     WHEN campaign_id IS NOT DISTINCT FROM r->>'campaign_id' THEN campaign_objective ELSE NULL END,
   campaign_observed_at=p_observed_at
   WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND ad_id=r->>'ad_id'
    AND (campaign_observed_at IS NULL OR campaign_observed_at<=p_observed_at);
  IF FOUND THEN n:=n+1; END IF;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.set_meta_ad_campaign_dimensions(uuid,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_meta_ad_campaign_dimensions(uuid,text,jsonb,timestamptz) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
