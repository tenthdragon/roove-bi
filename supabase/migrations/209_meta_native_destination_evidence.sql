BEGIN;
-- Attach proof to an unchanged structured destination too (e.g. a native
-- Instagram profile CTA). A different current URL still wins over the cache.
CREATE OR REPLACE FUNCTION public.preserve_meta_ad_destination_resolution()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r public.meta_ad_destination_resolutions; cached_url text; host text;
BEGIN
 SELECT * INTO r FROM public.meta_ad_destination_resolutions
 WHERE workspace_id=NEW.workspace_id AND account_id=NEW.account_id AND ad_id=NEW.ad_id
 AND creative_id=NEW.creative_id AND adset_id=NEW.adset_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.metadata->'urls')='array' AND jsonb_array_length(NEW.metadata->'urls')>0
 AND NEW.metadata->'urls' IS DISTINCT FROM r.urls THEN RETURN NEW; END IF;
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
NOTIFY pgrst,'reload schema';
COMMIT;
