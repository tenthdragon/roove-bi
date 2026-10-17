BEGIN;
-- A catalog can be confirmed as non-Shopee by the workspace owner even when
-- Meta cannot enumerate its empty/broken products. Keep that provenance explicit.
ALTER TABLE public.meta_ad_destination_resolutions DROP CONSTRAINT meta_ad_destination_resolutions_source_check;
ALTER TABLE public.meta_ad_destination_resolutions ADD CONSTRAINT meta_ad_destination_resolutions_source_check
 CHECK(source IN ('meta_ad_preview','meta_creative_cta','meta_native_destination','meta_catalog_products','user_catalog_confirmation'));

CREATE OR REPLACE FUNCTION public.preserve_meta_ad_destination_resolution()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r public.meta_ad_destination_resolutions; cached_url text; host text; resolution jsonb; destination_urls jsonb;
BEGIN
 SELECT * INTO r FROM public.meta_ad_destination_resolutions
 WHERE workspace_id=NEW.workspace_id AND account_id=NEW.account_id AND ad_id=NEW.ad_id
 AND creative_id=NEW.creative_id AND adset_id=NEW.adset_id;
 IF NOT FOUND THEN RETURN NEW; END IF;
 IF jsonb_typeof(NEW.metadata->'urls')='array' AND jsonb_array_length(NEW.metadata->'urls')>0
 AND NEW.metadata->'urls' IS DISTINCT FROM r.urls AND r.kind<>'non_shopee_catalog' THEN RETURN NEW; END IF;
 destination_urls:=CASE WHEN r.kind='non_shopee_catalog' AND jsonb_typeof(NEW.metadata->'urls')='array'
  AND jsonb_array_length(NEW.metadata->'urls')>0 THEN NEW.metadata->'urls' ELSE r.urls END;
 resolution:=jsonb_build_object('kind',r.kind,'source',r.source,'observed_at',r.observed_at,'creative_id',r.creative_id,'adset_id',r.adset_id);
 -- Cover only the exact product-set IDs confirmed by the owner. A newly added
 -- unknown catalog must not inherit the earlier catalog's identity.
 IF r.kind='non_shopee_catalog' AND jsonb_typeof(r.proof->'product_set_ids')='array' THEN
  resolution:=resolution||jsonb_build_object('non_shopee_product_set_ids',r.proof->'product_set_ids');
 END IF;
 NEW.metadata:=NEW.metadata||jsonb_build_object('urls',destination_urls,'destination_resolution',resolution);
 FOR cached_url IN SELECT jsonb_array_elements_text(destination_urls) LOOP
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
