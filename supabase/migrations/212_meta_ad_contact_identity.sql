BEGIN;
-- Contact identities describe the current creative/adset only. Existing URL,
-- CPAS evidence, facts, account-brand defaults and template rules are unchanged.
CREATE FUNCTION public.meta_ad_contact_identity_valid(p jsonb, creative text, adset text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN jsonb_typeof(p) IS DISTINCT FROM 'object'
  OR jsonb_typeof(p->'page_ids') IS DISTINCT FROM 'array'
  OR jsonb_typeof(p->'whatsapp_phone_numbers') IS DISTINCT FROM 'array'
  THEN false ELSE coalesce(p->>'version'='1'
  AND creative ~ '^[1-9][0-9]*$' AND adset ~ '^[1-9][0-9]*$'
  AND p->>'creative_id'=creative AND p->>'adset_id'=adset
  AND jsonb_typeof(p->'page_ids')='array' AND jsonb_typeof(p->'whatsapp_phone_numbers')='array'
  AND jsonb_typeof(p->'page_sources')='object' AND jsonb_typeof(p->'whatsapp_sources')='array'
  AND jsonb_array_length(p->'page_ids')<=10 AND jsonb_array_length(p->'whatsapp_phone_numbers')<=20
  AND NOT jsonb_path_exists(p->'page_ids','$[*] ? (@.type() != "string" || !(@ like_regex "^[1-9][0-9]*$"))')
  AND NOT jsonb_path_exists(p->'whatsapp_phone_numbers','$[*] ? (@.type() != "string" || !(@ like_regex "^[+][1-9][0-9]{6,14}$"))')
  AND ((p->>'page_id' IS NULL AND jsonb_array_length(p->'page_ids')=0)
    OR (p->>'page_id' ~ '^[1-9][0-9]*$' AND p->'page_ids' ? (p->>'page_id')))
  AND (jsonb_array_length(p->'page_ids')>0 OR jsonb_array_length(p->'whatsapp_phone_numbers')>0)
  AND octet_length(p::text)<=16384,false) END
$$;

CREATE FUNCTION public.preserve_meta_ad_contact_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE incoming jsonb; previous jsonb; merged jsonb; page_changed boolean;
BEGIN
 incoming:=NEW.metadata->'contact_identity';
 IF NOT public.meta_ad_contact_identity_valid(incoming,NEW.creative_id,NEW.adset_id) THEN
  incoming:=NULL;
  NEW.metadata:=NEW.metadata-'contact_identity'-'contact_identity_observed_at';
 END IF;
 IF TG_OP='UPDATE' AND OLD.creative_id=NEW.creative_id AND OLD.adset_id=NEW.adset_id
  AND public.meta_ad_contact_identity_valid(OLD.metadata->'contact_identity',NEW.creative_id,NEW.adset_id) THEN
  previous:=OLD.metadata->'contact_identity';
 END IF;
 IF incoming IS NULL THEN
  IF previous IS NOT NULL THEN
   NEW.metadata:=NEW.metadata||jsonb_build_object('contact_identity',previous,
    'contact_identity_observed_at',coalesce(OLD.metadata->'contact_identity_observed_at',to_jsonb(OLD.observed_at)));
  END IF;
  RETURN NEW;
 END IF;
 merged:=incoming;
 IF previous IS NOT NULL THEN
  page_changed:=incoming->>'page_id' IS NOT NULL AND previous->>'page_id' IS NOT NULL
    AND incoming->>'page_id'<>previous->>'page_id';
  IF incoming->>'page_id' IS NULL THEN
   merged:=merged||jsonb_build_object('page_id',previous->'page_id','page_ids',previous->'page_ids','page_sources',previous->'page_sources');
  END IF;
  IF jsonb_array_length(incoming->'whatsapp_phone_numbers')=0 AND NOT page_changed THEN
   merged:=merged||jsonb_build_object('whatsapp_phone_numbers',previous->'whatsapp_phone_numbers','whatsapp_sources',previous->'whatsapp_sources');
  END IF;
 END IF;
 NEW.metadata:=NEW.metadata||jsonb_build_object('contact_identity',merged,
  'contact_identity_observed_at',coalesce(NEW.metadata->'contact_identity_observed_at',to_jsonb(NEW.observed_at)));
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_meta_ad_contact_identity BEFORE INSERT OR UPDATE ON public.meta_ad_destination_metadata
 FOR EACH ROW EXECUTE FUNCTION public.preserve_meta_ad_contact_identity();

-- Backfill patches only contact identity while holding each current metadata
-- row lock. A concurrent URL/catalog refresh cannot be overwritten by a stale
-- client snapshot; a different creative/adset is skipped rather than guessed.
CREATE FUNCTION public.save_meta_ad_contact_identities(p_workspace_id uuid,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE r jsonb; d public.meta_ad_destination_metadata; n integer:=0; skipped jsonb:='[]'; ts timestamptz;
BEGIN
 IF p_workspace_id IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_rows)>50 THEN RAISE EXCEPTION 'Invalid contact identity batch'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF coalesce(r->>'account_id','') !~ '^act_[0-9]+$' OR coalesce(r->>'ad_id','') !~ '^[1-9][0-9]*$'
   OR NOT public.meta_ad_contact_identity_valid(r->'identity',r->>'creative_id',r->>'adset_id')
   OR (r ? 'workspace_id' AND r->>'workspace_id'<>p_workspace_id::text)
   THEN RAISE EXCEPTION 'Invalid contact identity row'; END IF;
  ts:=(r->>'observed_at')::timestamptz;
  IF ts IS NULL THEN RAISE EXCEPTION 'Missing contact observation time'; END IF;
  SELECT * INTO d FROM public.meta_ad_destination_metadata
   WHERE workspace_id=p_workspace_id AND account_id=r->>'account_id' AND ad_id=r->>'ad_id' FOR UPDATE;
  IF NOT FOUND OR d.creative_id IS DISTINCT FROM r->>'creative_id' OR d.adset_id IS DISTINCT FROM r->>'adset_id' THEN
   skipped:=skipped||jsonb_build_array(jsonb_build_object('ad_id',r->>'ad_id','reason','metadata_identity_changed_or_missing')); CONTINUE;
  END IF;
  IF coalesce((d.metadata->>'contact_identity_observed_at')::timestamptz,'-infinity')>ts THEN
   skipped:=skipped||jsonb_build_array(jsonb_build_object('ad_id',r->>'ad_id','reason','newer_identity_observation')); CONTINUE;
  END IF;
  UPDATE public.meta_ad_destination_metadata SET metadata=metadata||jsonb_build_object(
   'contact_identity',r->'identity','contact_identity_observed_at',ts)
   WHERE workspace_id=p_workspace_id AND account_id=d.account_id AND ad_id=d.ad_id;
  n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('saved',n,'skipped',skipped);
END $$;
REVOKE ALL ON FUNCTION public.meta_ad_contact_identity_valid(jsonb,text,text),public.preserve_meta_ad_contact_identity(),
 public.save_meta_ad_contact_identities(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_ad_contact_identity_valid(jsonb,text,text),public.preserve_meta_ad_contact_identity(),
 public.save_meta_ad_contact_identities(uuid,jsonb) TO service_role;
COMMENT ON FUNCTION public.save_meta_ad_contact_identities(uuid,jsonb) IS 'Service-only contact identity patch; never changes URLs, CPAS proof, brand mappings or historical facts.';
NOTIFY pgrst,'reload schema';
COMMIT;
