BEGIN;
-- Open vocabulary: the ad ID is identity; names, labels and URLs can change.
CREATE TABLE public.meta_ad_mappings (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), account_id text NOT NULL, ad_id text NOT NULL CHECK(ad_id ~ '^[0-9]+$'),
 ad_name text NOT NULL, creative_id text, effective_status text,
 landing_page_urls jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(landing_page_urls)='array'),
 auto_mapping jsonb NOT NULL CHECK(jsonb_typeof(auto_mapping)='object'),
 overrides jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(overrides)='object'),
 override_by uuid REFERENCES auth.users(id), override_at timestamptz,
 source text NOT NULL CHECK(source IN ('inventory','cache')),
 fingerprint text NOT NULL, revision integer NOT NULL DEFAULT 1,
 first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,account_id,ad_id)
);
CREATE TABLE public.meta_ad_mapping_observations (
 workspace_id uuid NOT NULL, account_id text NOT NULL, ad_id text NOT NULL, fingerprint text NOT NULL,
 snapshot jsonb NOT NULL, observed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,account_id,ad_id,fingerprint),
 FOREIGN KEY(workspace_id,account_id,ad_id) REFERENCES public.meta_ad_mappings(workspace_id,account_id,ad_id) ON DELETE CASCADE
);
CREATE TABLE public.meta_ad_mapping_units (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), dimension text NOT NULL, unit_key text NOT NULL,
 label text NOT NULL, review_status text NOT NULL CHECK(review_status IN ('recognized','new','confirmed')),
 reviewed_by uuid REFERENCES auth.users(id), reviewed_at timestamptz,
 first_seen_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,dimension,unit_key)
);
CREATE TABLE public.meta_ad_mapping_members (
 workspace_id uuid NOT NULL, account_id text NOT NULL, ad_id text NOT NULL,
 dimension text NOT NULL, unit_key text NOT NULL, source text NOT NULL CHECK(source IN ('bracket','keyword','manual')),
 position integer NOT NULL, raw_value text NOT NULL,
 PRIMARY KEY(workspace_id,account_id,ad_id,dimension,unit_key,source,position),
 FOREIGN KEY(workspace_id,account_id,ad_id) REFERENCES public.meta_ad_mappings(workspace_id,account_id,ad_id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,dimension,unit_key) REFERENCES public.meta_ad_mapping_units(workspace_id,dimension,unit_key)
);
CREATE INDEX meta_ad_mapping_members_unit ON public.meta_ad_mapping_members(workspace_id,dimension,unit_key,account_id,ad_id);
CREATE TABLE public.meta_ad_mapping_sync_state (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), account_id text NOT NULL,
 last_inventory_at timestamptz NOT NULL, ads_count integer NOT NULL, PRIMARY KEY(workspace_id,account_id)
);
ALTER TABLE public.meta_ad_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ad_mapping_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ad_mapping_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ad_mapping_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ad_mapping_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ad_mappings,public.meta_ad_mapping_observations,public.meta_ad_mapping_units,public.meta_ad_mapping_members,public.meta_ad_mapping_sync_state FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_ad_mappings,public.meta_ad_mapping_observations,public.meta_ad_mapping_units,public.meta_ad_mapping_members,public.meta_ad_mapping_sync_state TO service_role;

CREATE FUNCTION public.upsert_meta_ad_mappings(p_workspace_id uuid,p_account_id text,p_rows jsonb,p_source text,p_observed_at timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r jsonb; t jsonb; fp text; n integer:=0;
BEGIN
 IF p_workspace_id IS NULL OR p_account_id IS NULL OR p_source NOT IN ('inventory','cache') OR p_observed_at IS NULL
 OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>500
 OR NOT EXISTS(SELECT 1 FROM public.meta_ad_accounts WHERE workspace_id=p_workspace_id AND account_id=p_account_id) THEN
  RAISE EXCEPTION 'Invalid Meta mapping scope';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':meta-mapping:'||p_account_id,0));
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF r->>'ad_id' IS NULL OR r->>'ad_id' !~ '^[0-9]+$' OR r->>'ad_name' IS NULL
   OR jsonb_typeof(r->'auto_mapping') IS DISTINCT FROM 'object'
   OR jsonb_typeof(r->'auto_mapping'->'tags') IS DISTINCT FROM 'array'
   OR jsonb_typeof(r->'auto_mapping'->'keywords') IS DISTINCT FROM 'array'
   OR jsonb_typeof(r->'landing_page_urls') IS DISTINCT FROM 'array'
   OR jsonb_path_exists(r->'landing_page_urls','$[*] ? (@.type() != "string")') THEN
   RAISE EXCEPTION 'Invalid Meta mapping row';
  END IF;
  -- A cached backfill cannot replace a directly observed current inventory.
  IF EXISTS(SELECT 1 FROM public.meta_ad_mappings WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND ad_id=r->>'ad_id'
    AND (last_seen_at>p_observed_at OR (source='inventory' AND p_source='cache'))) THEN CONTINUE; END IF;
  fp:=md5((r-'effective_status')::text);
  INSERT INTO public.meta_ad_mappings(workspace_id,account_id,ad_id,ad_name,creative_id,effective_status,landing_page_urls,auto_mapping,source,fingerprint,first_seen_at,last_seen_at)
   VALUES(p_workspace_id,p_account_id,r->>'ad_id',r->>'ad_name',r->>'creative_id',r->>'effective_status',r->'landing_page_urls',r->'auto_mapping',p_source,fp,p_observed_at,p_observed_at)
   ON CONFLICT(workspace_id,account_id,ad_id) DO UPDATE SET ad_name=excluded.ad_name,creative_id=excluded.creative_id,effective_status=excluded.effective_status,
    landing_page_urls=excluded.landing_page_urls,auto_mapping=excluded.auto_mapping,source=excluded.source,fingerprint=excluded.fingerprint,last_seen_at=excluded.last_seen_at,
    revision=meta_ad_mappings.revision+CASE WHEN meta_ad_mappings.fingerprint<>excluded.fingerprint THEN 1 ELSE 0 END;
  INSERT INTO public.meta_ad_mapping_observations(workspace_id,account_id,ad_id,fingerprint,snapshot,observed_at)
   VALUES(p_workspace_id,p_account_id,r->>'ad_id',fp,r,p_observed_at) ON CONFLICT DO NOTHING;
  DELETE FROM public.meta_ad_mapping_members WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND ad_id=r->>'ad_id' AND source<>'manual';
  FOR t IN SELECT value FROM jsonb_array_elements((r->'auto_mapping'->'tags')||(r->'auto_mapping'->'keywords')) LOOP
   IF t->>'dimension' IS NULL OR t->>'key' IS NULL OR t->>'key'='' OR t->>'source' NOT IN ('bracket','keyword')
    OR (t->>'dimension' NOT IN ('cep','intention','keyword') AND t->>'dimension' !~ '^bracket_[0-9]+$') THEN RAISE EXCEPTION 'Invalid Meta mapping token'; END IF;
   INSERT INTO public.meta_ad_mapping_units(workspace_id,dimension,unit_key,label,review_status,first_seen_at,last_seen_at)
    VALUES(p_workspace_id,t->>'dimension',t->>'key',t->>'label',CASE WHEN (t->>'recognized')::boolean THEN 'recognized' ELSE 'new' END,p_observed_at,p_observed_at)
    ON CONFLICT(workspace_id,dimension,unit_key) DO UPDATE SET last_seen_at=greatest(meta_ad_mapping_units.last_seen_at,excluded.last_seen_at);
   INSERT INTO public.meta_ad_mapping_members(workspace_id,account_id,ad_id,dimension,unit_key,source,position,raw_value)
    VALUES(p_workspace_id,p_account_id,r->>'ad_id',t->>'dimension',t->>'key',t->>'source',(t->>'position')::integer,t->>'raw') ON CONFLICT DO NOTHING;
  END LOOP;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.upsert_meta_ad_mappings(uuid,text,jsonb,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_meta_ad_mappings(uuid,text,jsonb,text,timestamptz) TO service_role;

CREATE FUNCTION public.set_meta_ad_mapping_overrides(p_workspace_id uuid,p_account_id text,p_ad_id text,p_overrides jsonb,p_user_id uuid,p_revision integer)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE entry record;
BEGIN
 IF p_overrides IS NULL OR jsonb_typeof(p_overrides)<>'object' OR p_user_id IS NULL
 OR EXISTS(SELECT 1 FROM jsonb_each(p_overrides) WHERE key NOT IN ('cep','intention') OR jsonb_typeof(value)<>'string' OR length(value#>>'{}') NOT BETWEEN 1 AND 500)
 OR NOT EXISTS(SELECT 1 FROM public.meta_ad_accounts WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND is_active) THEN RAISE EXCEPTION 'Invalid mapping override'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':meta-mapping:'||p_account_id,0));
 UPDATE public.meta_ad_mappings SET overrides=p_overrides,override_by=p_user_id,override_at=now(),revision=revision+1
 WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND ad_id=p_ad_id AND revision=p_revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mapping changed; reload before saving'; END IF;
 DELETE FROM public.meta_ad_mapping_members WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND ad_id=p_ad_id AND source='manual';
 FOR entry IN SELECT key,value FROM jsonb_each_text(p_overrides) LOOP
  INSERT INTO public.meta_ad_mapping_units(workspace_id,dimension,unit_key,label,review_status,reviewed_by,reviewed_at)
   VALUES(p_workspace_id,entry.key,entry.value,entry.value,'confirmed',p_user_id,now())
   ON CONFLICT(workspace_id,dimension,unit_key) DO NOTHING;
  INSERT INTO public.meta_ad_mapping_members(workspace_id,account_id,ad_id,dimension,unit_key,source,position,raw_value)
   VALUES(p_workspace_id,p_account_id,p_ad_id,entry.key,entry.value,'manual',0,entry.value);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.set_meta_ad_mapping_overrides(uuid,text,text,jsonb,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_meta_ad_mapping_overrides(uuid,text,text,jsonb,uuid,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
