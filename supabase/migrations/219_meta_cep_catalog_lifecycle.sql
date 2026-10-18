BEGIN;
-- Retire choices without removing historical classifications or approved rules.
ALTER TABLE public.meta_ad_cep_catalog ADD COLUMN is_active boolean NOT NULL DEFAULT true;
CREATE UNIQUE INDEX meta_cep_brand_label ON public.meta_ad_cep_catalog(workspace_id,brand_id,lower(btrim(label)));

CREATE OR REPLACE FUNCTION public.validate_meta_taxonomy() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE brand_name text; retained text[] := '{}';
BEGIN
 SELECT name INTO brand_name FROM brands WHERE id=NEW.brand_id AND workspace_id=NEW.workspace_id;
 IF brand_name IS NULL THEN RAISE EXCEPTION 'Brand is outside this workspace'; END IF;
 IF TG_TABLE_NAME='meta_ad_cep_catalog' THEN
  IF TG_OP='UPDATE' AND (NEW.workspace_id,NEW.brand_id,NEW.key) IS DISTINCT FROM (OLD.workspace_id,OLD.brand_id,OLD.key) THEN
   RAISE EXCEPTION 'CEP identity cannot change';
  END IF;
  IF NEW.key NOT LIKE 'b'||NEW.brand_id::text||'.%'
   AND NOT (lower(btrim(brand_name))='roove' AND NEW.key IN ('skin','joint','bone','hair','nail')) THEN
   RAISE EXCEPTION 'CEP key must belong to its brand';
  END IF;
 ELSE
  NEW.raw_key:=public.meta_taxonomy_key(NEW.dimension,NEW.raw_key);
  IF TG_OP='UPDATE' THEN retained:=OLD.cep_keys; END IF;
  IF cardinality(NEW.cep_keys)<>(SELECT count(DISTINCT k) FROM unnest(NEW.cep_keys) k)
   OR EXISTS(SELECT 1 FROM unnest(NEW.cep_keys) k WHERE NOT EXISTS(
    SELECT 1 FROM meta_ad_cep_catalog c WHERE c.workspace_id=NEW.workspace_id AND c.brand_id=NEW.brand_id AND c.key=k
     AND (c.is_active OR k=ANY(retained)))) THEN
   RAISE EXCEPTION 'Choose active brand CEPs for new rule assignments';
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public.guard_meta_cep_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE b integer; retained text[]; assigned text[];
BEGIN
 IF TG_TABLE_NAME='meta_ad_cep_catalog' THEN RAISE EXCEPTION 'Deactivate CEPs instead of deleting history'; END IF;
 IF NEW.overrides->'ceps' IS NOT DISTINCT FROM OLD.overrides->'ceps'
  AND NEW.overrides->'cep' IS NOT DISTINCT FROM OLD.overrides->'cep' THEN RETURN NEW; END IF;
 SELECT default_brand_id INTO b FROM meta_ad_accounts WHERE workspace_id=NEW.workspace_id AND account_id=NEW.account_id;
 retained:=ARRAY(SELECT jsonb_array_elements_text(public.resolve_meta_ad_taxonomy(OLD.workspace_id,b,OLD.auto_mapping,OLD.overrides)->'cep_keys'));
 assigned:=CASE WHEN jsonb_typeof(NEW.overrides->'ceps')='array' THEN ARRAY(SELECT jsonb_array_elements_text(NEW.overrides->'ceps'))
  WHEN jsonb_typeof(NEW.overrides->'cep')='string' THEN ARRAY[NEW.overrides->>'cep'] ELSE '{}' END;
 IF EXISTS(SELECT 1 FROM unnest(assigned) k JOIN meta_ad_cep_catalog c
  ON c.workspace_id=NEW.workspace_id AND c.brand_id=b AND c.key=k WHERE NOT c.is_active AND NOT k=ANY(retained)) THEN
  RAISE EXCEPTION 'Inactive CEP cannot be assigned to another ad';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_meta_cep_delete BEFORE DELETE ON public.meta_ad_cep_catalog
 FOR EACH ROW EXECUTE FUNCTION public.guard_meta_cep_lifecycle();
CREATE TRIGGER guard_meta_cep_assignment BEFORE UPDATE OF overrides ON public.meta_ad_mappings
 FOR EACH ROW EXECUTE FUNCTION public.guard_meta_cep_lifecycle();
REVOKE ALL ON FUNCTION public.guard_meta_cep_lifecycle() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_meta_cep_lifecycle() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
