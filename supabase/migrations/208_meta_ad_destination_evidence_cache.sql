BEGIN;
-- Durable provider evidence is separate from the latest (possibly opaque) API
-- observation. Store no preview HTML, signed iframe URLs, creative copy or media.
CREATE TABLE public.meta_ad_destination_resolutions (
 workspace_id uuid NOT NULL, account_id text NOT NULL, ad_id text NOT NULL,
 creative_id text NOT NULL CHECK(creative_id ~ '^[0-9]+$'),
 adset_id text NOT NULL CHECK(adset_id ~ '^[0-9]+$'),
 kind text NOT NULL CHECK(kind IN ('website','native_profile','native_messaging','native_engagement','non_shopee_catalog')),
 source text NOT NULL CHECK(source IN ('meta_ad_preview','meta_creative_cta','meta_native_destination','meta_catalog_products')),
 urls jsonb NOT NULL CHECK(jsonb_typeof(urls)='array' AND jsonb_array_length(urls)<=50),
 proof jsonb NOT NULL CHECK(jsonb_typeof(proof)='object' AND proof<>'{}'::jsonb),
 observed_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,account_id,ad_id,creative_id,adset_id),
 FOREIGN KEY(workspace_id,account_id,ad_id) REFERENCES public.meta_ad_mappings(workspace_id,account_id,ad_id) ON DELETE CASCADE,
 CHECK(kind<>'website' OR jsonb_array_length(urls)>0)
);
ALTER TABLE public.meta_ad_destination_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ad_destination_resolutions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_ad_destination_resolutions TO service_role;

-- Every writer, including an older sync worker, benefits from the cache. A
-- current structured URL wins over a cached URL. A changed creative/ad set can
-- never inherit evidence from an earlier version of the ad.
CREATE FUNCTION public.preserve_meta_ad_destination_resolution()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r public.meta_ad_destination_resolutions; cached_url text; host text;
BEGIN
 IF jsonb_typeof(NEW.metadata->'urls')='array' AND jsonb_array_length(NEW.metadata->'urls')>0 THEN RETURN NEW; END IF;
 SELECT * INTO r FROM public.meta_ad_destination_resolutions
 WHERE workspace_id=NEW.workspace_id AND account_id=NEW.account_id AND ad_id=NEW.ad_id
 AND creative_id=NEW.creative_id AND adset_id=NEW.adset_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 NEW.metadata:=NEW.metadata||jsonb_build_object('urls',r.urls,'destination_resolution',jsonb_build_object(
  'kind',r.kind,'source',r.source,'observed_at',r.observed_at,'creative_id',r.creative_id,'adset_id',r.adset_id));
 -- Cached external websites never override catalog/app evidence or a CPAS
 -- classification. A cached, explicit Shopee URL remains positive CPAS proof.
 FOR cached_url IN SELECT jsonb_array_elements_text(r.urls) LOOP
  host:=rtrim(substring(lower(cached_url) from '^https?://([a-z0-9.-]+)(?=[:/?#]|$)'),'.');
  IF host ~ '(^|\.)(shopee\.co\.id|shp\.ee)$' THEN
   NEW.classification:='cpas';
   IF NOT coalesce(NEW.evidence,'[]'::jsonb) @> jsonb_build_array(jsonb_build_object('type','shopee_url','value',cached_url)) THEN
    NEW.evidence:=coalesce(NEW.evidence,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('type','shopee_url','value',cached_url));
   END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.preserve_meta_ad_destination_resolution() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER preserve_meta_ad_destination_resolution BEFORE INSERT OR UPDATE ON public.meta_ad_destination_metadata
FOR EACH ROW EXECUTE FUNCTION public.preserve_meta_ad_destination_resolution();

CREATE FUNCTION public.apply_meta_ad_destination_resolution()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 -- The BEFORE trigger merges the proof without changing API observation time,
 -- creative/adset identity, catalog/app IDs or historical spend/event facts.
 UPDATE public.meta_ad_destination_metadata SET metadata=metadata
 WHERE workspace_id=NEW.workspace_id AND account_id=NEW.account_id AND ad_id=NEW.ad_id
 AND creative_id=NEW.creative_id AND adset_id=NEW.adset_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.apply_meta_ad_destination_resolution() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER apply_meta_ad_destination_resolution AFTER INSERT ON public.meta_ad_destination_resolutions
FOR EACH ROW EXECUTE FUNCTION public.apply_meta_ad_destination_resolution();
COMMENT ON TABLE public.meta_ad_destination_resolutions IS 'Explicit provider destination proof per ad/creative/adset. Reuse matching successful evidence; no automatic browser rendering on page reads or sync.';
NOTIFY pgrst,'reload schema';
COMMIT;
