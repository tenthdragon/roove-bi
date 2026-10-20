BEGIN;
CREATE TABLE meta_ad_intention_catalog (
 workspace_id uuid NOT NULL, brand_id integer NOT NULL,
 key text NOT NULL CHECK(key ~ '^[a-z][a-z0-9_.-]{0,79}$'),
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 100),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=1000),
 is_active boolean NOT NULL DEFAULT true, revision integer NOT NULL DEFAULT 1,
 updated_by uuid REFERENCES auth.users(id),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,brand_id,key), FOREIGN KEY(workspace_id,brand_id) REFERENCES brands(workspace_id,id),
 CHECK(key IN ('disc','cons','conv') OR key LIKE 'b'||brand_id::text||'.%')
);
CREATE UNIQUE INDEX meta_intention_brand_label ON meta_ad_intention_catalog(workspace_id,brand_id,lower(btrim(label)));
ALTER TABLE meta_ad_intention_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON meta_ad_intention_catalog FROM PUBLIC,anon,authenticated;
GRANT ALL ON meta_ad_intention_catalog TO service_role;
INSERT INTO meta_ad_intention_catalog(workspace_id,brand_id,key,label)
SELECT b.workspace_id,b.id,i.key,i.label FROM brands b CROSS JOIN (VALUES('disc','Discovery'),('cons','Consideration'),('conv','Conversion')) i(key,label);
CREATE FUNCTION seed_meta_brand_intentions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO meta_ad_intention_catalog(workspace_id,brand_id,key,label)
 SELECT NEW.workspace_id,NEW.id,i.key,i.label FROM (VALUES('disc','Discovery'),('cons','Consideration'),('conv','Conversion')) i(key,label);
 RETURN NEW;
END $$;
CREATE TRIGGER seed_meta_brand_intentions AFTER INSERT ON brands FOR EACH ROW EXECUTE FUNCTION seed_meta_brand_intentions();
REVOKE ALL ON FUNCTION seed_meta_brand_intentions() FROM PUBLIC,anon,authenticated;
ALTER TABLE meta_ad_taxonomy_rules DROP CONSTRAINT meta_ad_taxonomy_rules_intention_key_check;
CREATE FUNCTION guard_meta_intention() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE b integer; old_key text; new_key text;
BEGIN
 IF TG_TABLE_NAME='meta_ad_intention_catalog' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Deactivate intentions instead of deleting history'; END IF;
  IF TG_OP='UPDATE' AND (NEW.workspace_id,NEW.brand_id,NEW.key) IS DISTINCT FROM (OLD.workspace_id,OLD.brand_id,OLD.key) THEN RAISE EXCEPTION 'Intention identity cannot change'; END IF;
 ELSIF TG_TABLE_NAME='meta_ad_taxonomy_rules' THEN
  IF NEW.dimension<>'intention' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN old_key:=OLD.intention_key; END IF;
  IF NOT EXISTS(SELECT 1 FROM meta_ad_intention_catalog WHERE workspace_id=NEW.workspace_id AND brand_id=NEW.brand_id AND key=NEW.intention_key AND (is_active OR key=old_key)) THEN RAISE EXCEPTION 'Choose an active brand intention'; END IF;
 ELSE
  IF NEW.overrides->'intention' IS NOT DISTINCT FROM OLD.overrides->'intention' OR NOT NEW.overrides ? 'intention' THEN RETURN NEW; END IF;
  SELECT default_brand_id INTO b FROM meta_ad_accounts WHERE workspace_id=NEW.workspace_id AND account_id=NEW.account_id;
  old_key:=public.resolve_meta_ad_taxonomy(OLD.workspace_id,b,OLD.auto_mapping,OLD.overrides)->>'intention_key';
  new_key:=NEW.overrides->>'intention';
  IF NOT EXISTS(SELECT 1 FROM meta_ad_intention_catalog WHERE workspace_id=NEW.workspace_id AND brand_id=b AND key=new_key AND (is_active OR key=old_key)) THEN RAISE EXCEPTION 'Choose an active brand intention'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_meta_intention_identity BEFORE UPDATE OR DELETE ON meta_ad_intention_catalog FOR EACH ROW EXECUTE FUNCTION guard_meta_intention();
CREATE TRIGGER guard_meta_intention_rule BEFORE INSERT OR UPDATE ON meta_ad_taxonomy_rules FOR EACH ROW EXECUTE FUNCTION guard_meta_intention();
CREATE TRIGGER guard_meta_intention_override BEFORE UPDATE OF overrides ON meta_ad_mappings FOR EACH ROW EXECUTE FUNCTION guard_meta_intention();
REVOKE ALL ON FUNCTION guard_meta_intention() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER audit_meta_intention AFTER INSERT OR UPDATE ON meta_ad_intention_catalog FOR EACH ROW EXECUTE FUNCTION audit_meta_taxonomy();
CREATE TRIGGER meta_report_insert AFTER INSERT ON meta_ad_intention_catalog REFERENCING NEW TABLE AS meta_new FOR EACH STATEMENT EXECUTE FUNCTION bump_meta_ad_report_version();
CREATE TRIGGER meta_report_update AFTER UPDATE ON meta_ad_intention_catalog REFERENCING OLD TABLE AS meta_old NEW TABLE AS meta_new FOR EACH STATEMENT EXECUTE FUNCTION bump_meta_ad_report_version();
CREATE OR REPLACE FUNCTION public.resolve_meta_ad_taxonomy(w uuid,b integer,a jsonb,o jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE d text; raw text; manual boolean; rule meta_ad_taxonomy_rules%ROWTYPE; candidates text[]; ceps text[]:='{}'; intent text; cs text; ins text;
BEGIN
 FOR d IN SELECT unnest(ARRAY['cep','intention']) LOOP
  manual:=CASE WHEN d='cep' THEN o ? 'ceps' OR o ? 'cep' ELSE o ? 'intention' END;
  raw:=public.meta_taxonomy_key(d,coalesce(o->>d,(SELECT t->>'key' FROM jsonb_array_elements(coalesce(a->'tags','[]')) t WHERE t->>'dimension'=d LIMIT 1)));
  rule:=NULL;
  IF NOT manual THEN SELECT * INTO rule FROM meta_ad_taxonomy_rules WHERE workspace_id=w AND brand_id=b AND dimension=d AND raw_key=raw; END IF;
  IF d='cep' THEN
   cs:=CASE WHEN manual THEN 'manual' WHEN rule.raw_key IS NOT NULL THEN 'rule' ELSE 'naming' END;
   candidates:=CASE WHEN jsonb_typeof(o->'ceps')='array' THEN ARRAY(SELECT jsonb_array_elements_text(o->'ceps')) WHEN rule.raw_key IS NOT NULL THEN rule.cep_keys ELSE ARRAY[raw] END;
   SELECT coalesce(array_agg(DISTINCT c.key ORDER BY c.key),'{}') INTO ceps FROM meta_ad_cep_catalog c WHERE c.workspace_id=w AND c.brand_id=b AND (c.key=ANY(candidates) OR c.key=ANY(ARRAY(SELECT 'b'||b::text||'.'||k FROM unnest(candidates) k)));
  ELSE
   ins:=CASE WHEN manual THEN 'manual' WHEN rule.raw_key IS NOT NULL THEN 'rule' ELSE 'naming' END;
   intent:=coalesce(rule.intention_key,raw);
   IF intent NOT IN ('disc','cons','conv') THEN
    SELECT key INTO intent FROM meta_ad_intention_catalog WHERE workspace_id=w AND brand_id=b AND key IN (intent,'b'||b::text||'.'||intent) ORDER BY key=intent DESC LIMIT 1;
   END IF;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('cep_keys',ceps,'intention_key',intent,'cep_source',cs,'intention_source',ins);
END $$;
CREATE OR REPLACE FUNCTION public.set_meta_ad_mapping_overrides(p_workspace_id uuid,p_account_id text,p_ad_id text,p_overrides jsonb,p_user_id uuid,p_revision integer)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE b integer; old_value jsonb; k text; keys text[];
BEGIN
 IF p_overrides IS NULL OR jsonb_typeof(p_overrides)<>'object' OR p_user_id IS NULL OR p_revision IS NULL
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_overrides) AS entries(entry_key) WHERE entries.entry_key NOT IN ('cep','ceps','intention'))
 OR (p_overrides ? 'cep' AND p_overrides ? 'ceps') THEN RAISE EXCEPTION 'Invalid mapping override'; END IF;
 SELECT default_brand_id INTO b FROM meta_ad_accounts WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid mapping account'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':meta-mapping:'||p_account_id,0));
 SELECT overrides INTO old_value FROM meta_ad_mappings WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND ad_id=p_ad_id AND revision=p_revision FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mapping changed; reload before saving'; END IF;
 keys:=CASE WHEN p_overrides ? 'ceps' AND jsonb_typeof(p_overrides->'ceps')='array' THEN ARRAY(SELECT jsonb_array_elements_text(p_overrides->'ceps')) WHEN p_overrides ? 'cep' AND jsonb_typeof(p_overrides->'cep')='string' THEN ARRAY[p_overrides->>'cep'] ELSE '{}' END;
 IF (p_overrides ? 'ceps' AND (jsonb_typeof(p_overrides->'ceps')<>'array' OR jsonb_path_exists(p_overrides->'ceps','$[*] ? (@.type() != "string")')))
 OR (p_overrides ? 'cep' AND jsonb_typeof(p_overrides->'cep')<>'string')
 OR cardinality(keys)>50 OR cardinality(keys)<>(SELECT count(DISTINCT x) FROM unnest(keys) x)
 OR (EXISTS(SELECT 1 FROM unnest(keys) x WHERE NOT EXISTS(SELECT 1 FROM meta_ad_cep_catalog c WHERE c.workspace_id=p_workspace_id AND c.brand_id=b AND c.key=x)) AND ((p_overrides->'cep') IS DISTINCT FROM (old_value->'cep') OR (p_overrides->'ceps') IS DISTINCT FROM (old_value->'ceps')))
 OR (p_overrides ? 'intention' AND (jsonb_typeof(p_overrides->'intention')<>'string' OR (NOT EXISTS(SELECT 1 FROM meta_ad_intention_catalog WHERE workspace_id=p_workspace_id AND brand_id=b AND key=p_overrides->>'intention') AND (p_overrides->'intention') IS DISTINCT FROM (old_value->'intention')))) THEN RAISE EXCEPTION 'Choose official CEPs and intentions for this brand'; END IF;
 UPDATE meta_ad_mappings SET overrides=p_overrides,override_by=p_user_id,override_at=now(),revision=revision+1 WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND ad_id=p_ad_id;
 INSERT INTO meta_ad_taxonomy_audit(workspace_id,entity,identity,before_value,after_value,changed_by) VALUES(p_workspace_id,'ad_override',jsonb_build_object('account_id',p_account_id,'ad_id',p_ad_id),old_value,p_overrides,p_user_id);
 DELETE FROM meta_ad_mapping_members WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND ad_id=p_ad_id AND source='manual';
 FOR k IN SELECT c.key FROM meta_ad_cep_catalog c WHERE c.workspace_id=p_workspace_id AND c.brand_id=b AND c.key=ANY(keys) LOOP
  INSERT INTO meta_ad_mapping_units(workspace_id,dimension,unit_key,label,review_status) VALUES(p_workspace_id,'cep',k,k,'confirmed') ON CONFLICT DO NOTHING;
  INSERT INTO meta_ad_mapping_members(workspace_id,account_id,ad_id,dimension,unit_key,source,position,raw_value) VALUES(p_workspace_id,p_account_id,p_ad_id,'cep',k,'manual',0,k);
 END LOOP;
 IF p_overrides ? 'intention' THEN
  k:=p_overrides->>'intention';INSERT INTO meta_ad_mapping_units(workspace_id,dimension,unit_key,label,review_status) VALUES(p_workspace_id,'intention',k,k,'confirmed') ON CONFLICT DO NOTHING;
  INSERT INTO meta_ad_mapping_members(workspace_id,account_id,ad_id,dimension,unit_key,source,position,raw_value) VALUES(p_workspace_id,p_account_id,p_ad_id,'intention',k,'manual',0,k);
 END IF;
END $$;


NOTIFY pgrst,'reload schema';
COMMIT;
