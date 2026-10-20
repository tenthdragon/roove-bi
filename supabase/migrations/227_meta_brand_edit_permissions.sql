BEGIN;
-- Business permissions are independent of credentials/integrations. Preserve
-- existing editors once, and grant advertisers only the three scoped actions.
INSERT INTO role_permissions(role,permission_key)
SELECT r.role,k FROM (SELECT role FROM role_permissions WHERE permission_key='admin:meta' UNION SELECT 'advertiser') r
CROSS JOIN unnest(ARRAY['meta:mapping','meta:taxonomy','meta:funnels']) k ON CONFLICT DO NOTHING;
INSERT INTO workspace_role_permissions(workspace_id,role,permission_key)
SELECT r.workspace_id,r.role,k FROM (
 SELECT workspace_id,role FROM workspace_role_permissions WHERE permission_key='admin:meta'
 UNION SELECT id,'advertiser' FROM workspaces
) r CROSS JOIN unnest(ARRAY['meta:mapping','meta:taxonomy','meta:funnels']) k ON CONFLICT DO NOTHING;

ALTER TABLE meta_ad_funnels ADD COLUMN brand_id integer;
ALTER TABLE meta_ad_funnels ADD FOREIGN KEY(workspace_id,brand_id) REFERENCES brands(workspace_id,id);
ALTER TABLE meta_landing_page_templates ADD COLUMN brand_id integer;
ALTER TABLE meta_landing_page_templates ADD FOREIGN KEY(workspace_id,brand_id) REFERENCES brands(workspace_id,id);
ALTER TABLE meta_landing_page_templates DROP CONSTRAINT meta_landing_page_templates_workspace_id_match_kind_pattern_key;
CREATE UNIQUE INDEX meta_template_brand_pattern ON meta_landing_page_templates(workspace_id,brand_id,match_kind,pattern) NULLS NOT DISTINCT;

-- Row locks match assignment/revocation's profile -> membership lock order.
-- A grant revoked before the write transaction cannot authorize a stale form.
CREATE FUNCTION assert_meta_edit_access(w uuid,u uuid,permission text,b integer) RETURNS void
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE user_role text; member_role text;
BEGIN
 SELECT role::text INTO user_role FROM profiles WHERE id=u FOR SHARE;
 IF NOT FOUND OR user_role='pending' THEN RAISE EXCEPTION 'Inactive user'; END IF;
 SELECT role INTO member_role FROM workspace_memberships WHERE workspace_id=w AND user_id=u AND status='active' FOR SHARE;
 IF user_role<>'owner' AND (member_role IS NULL OR member_role='pending') THEN RAISE EXCEPTION 'Inactive membership'; END IF;
 IF user_role<>'owner' AND member_role<>'workspace_owner' THEN
  PERFORM 1 FROM workspace_role_permissions WHERE workspace_id=w AND role=member_role AND permission_key=permission FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing Meta permission'; END IF;
  PERFORM 1 FROM workspace_role_permissions WHERE workspace_id=w AND role=member_role AND permission_key IN ('tab:meta-funnels','tab:marketing') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing Meta tab access'; END IF;
  IF member_role='advertiser' THEN
   PERFORM 1 FROM workspace_advertiser_brands WHERE workspace_id=w AND user_id=u AND brand_id=b FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Brand is not assigned'; END IF;
  END IF;
 END IF;
 IF b IS NOT NULL AND NOT EXISTS(SELECT 1 FROM brands WHERE workspace_id=w AND id=b) THEN RAISE EXCEPTION 'Brand outside workspace'; END IF;
END $$;
REVOKE ALL ON FUNCTION assert_meta_edit_access(uuid,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION assert_meta_edit_access(uuid,uuid,text,integer) TO service_role;

CREATE FUNCTION validate_meta_template_brand() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE fb integer;
BEGIN
 IF TG_OP='UPDATE' AND NEW.brand_id IS DISTINCT FROM OLD.brand_id THEN RAISE EXCEPTION 'Template/rule brand is immutable; copy instead'; END IF;
 IF TG_TABLE_NAME='meta_ad_funnels' THEN
  IF (TG_OP='INSERT' OR NEW.config IS DISTINCT FROM OLD.config) AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(NEW.config->'account_ids','[]')) a
   WHERE NOT EXISTS(SELECT 1 FROM meta_ad_accounts m WHERE m.workspace_id=NEW.workspace_id AND m.account_id=a AND m.is_active
    AND (NEW.brand_id IS NULL OR m.default_brand_id=NEW.brand_id))) THEN RAISE EXCEPTION 'Funnel account outside workspace/brand'; END IF;
 ELSE
  SELECT brand_id INTO fb FROM meta_ad_funnels WHERE workspace_id=NEW.workspace_id AND id=NEW.funnel_id AND NOT archived;
  IF NOT FOUND OR fb IS DISTINCT FROM NEW.brand_id THEN RAISE EXCEPTION 'Rule and funnel brand mismatch'; END IF;
  IF NEW.brand_id IS NOT NULL AND NEW.match_kind='ctwa' AND split_part(NEW.pattern,':',2)<>NEW.brand_id::text THEN RAISE EXCEPTION 'WhatsApp destination outside brand'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_meta_funnel_brand BEFORE INSERT OR UPDATE ON meta_ad_funnels FOR EACH ROW EXECUTE FUNCTION validate_meta_template_brand();
CREATE TRIGGER validate_meta_template_rule_brand BEFORE INSERT OR UPDATE ON meta_landing_page_templates FOR EACH ROW EXECUTE FUNCTION validate_meta_template_brand();
REVOKE ALL ON FUNCTION validate_meta_template_brand() FROM PUBLIC,anon,authenticated;

-- Only trusted server actions may call this RPC; actor identity comes from the
-- verified session, never from browser input. Scope is re-derived from the row.
CREATE FUNCTION mutate_meta_brand_configuration(p_workspace_id uuid,p_user_id uuid,p_operation text,p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE w uuid:=p_workspace_id; u uuid:=p_user_id; b integer; permission text; fid uuid; rid uuid;
 f meta_ad_funnels; r meta_landing_page_templates; changed integer; c jsonb; key text; table_name text; rev integer;
BEGIN
 permission:=CASE WHEN p_operation IN ('mapping','destination') THEN 'meta:mapping'
  WHEN p_operation IN ('cep','intention','cep_status','intention_status','taxonomy_rule') THEN 'meta:taxonomy'
  WHEN p_operation IN ('funnel','archive_funnel','template_rule','delete_template_rule') THEN 'meta:funnels' ELSE NULL END;
 IF permission IS NULL OR jsonb_typeof(p_input)<>'object' THEN RAISE EXCEPTION 'Invalid operation'; END IF;
 -- Derive scope from the locked target, then authorize before mutation.
 -- The server returns a generic error for unavailable or unauthorized targets.
 IF p_operation IN ('mapping','destination') THEN
  SELECT default_brand_id INTO b FROM meta_ad_accounts WHERE workspace_id=w AND account_id=p_input->>'accountId' AND is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account unavailable'; END IF;
 ELSIF p_operation IN ('funnel','archive_funnel','template_rule') THEN
  fid:=coalesce(p_input->>'id',p_input->>'funnelId')::uuid;
  IF p_operation='template_rule' THEN fid:=(p_input->>'funnelId')::uuid; END IF;
  IF fid IS NOT NULL THEN
   SELECT * INTO f FROM meta_ad_funnels WHERE workspace_id=w AND id=fid AND NOT archived FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Funnel unavailable'; END IF;
   b:=f.brand_id;
  ELSE b:=(p_input->>'brandId')::integer; END IF;
 ELSIF p_operation='delete_template_rule' THEN
  SELECT * INTO r FROM meta_landing_page_templates WHERE workspace_id=w AND id=(p_input->>'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rule unavailable'; END IF;
  b:=r.brand_id;
 ELSE b:=(p_input->>'brandId')::integer; END IF;
 PERFORM assert_meta_edit_access(w,u,permission,b);
 IF p_operation='mapping' THEN
  PERFORM set_meta_ad_mapping_overrides(w,p_input->>'accountId',p_input->>'adId',p_input->'overrides',u,(p_input->>'revision')::integer);
 ELSIF p_operation='destination' THEN
  IF NOT EXISTS(SELECT 1 FROM meta_ad_creatives WHERE workspace_id=w AND account_id=p_input->>'accountId' AND ad_id=p_input->>'adId' AND creative_id=p_input->>'creativeId') THEN RAISE EXCEPTION 'Creative changed'; END IF;
  INSERT INTO meta_ad_verified_destinations(workspace_id,account_id,ad_id,creative_id,landing_page_url,verified_by,updated_at)
   VALUES(w,p_input->>'accountId',p_input->>'adId',p_input->>'creativeId',p_input->>'url',u,now())
   ON CONFLICT(workspace_id,account_id,ad_id) DO UPDATE SET creative_id=excluded.creative_id,landing_page_url=excluded.landing_page_url,verified_by=u,updated_at=now();
 ELSIF p_operation='funnel' THEN
  c:=p_input->'config';
  IF c IS NULL OR jsonb_typeof(c)<>'object' THEN RAISE EXCEPTION 'Invalid configuration'; END IF;
  IF fid IS NULL THEN INSERT INTO meta_ad_funnels(workspace_id,brand_id,created_by,config) VALUES(w,b,u,c) RETURNING id INTO fid;
  ELSE
   UPDATE meta_ad_funnels SET config=c,version=version+1,updated_at=now() WHERE id=fid AND workspace_id=w AND version=(p_input->>'version')::integer;
   GET DIAGNOSTICS changed=ROW_COUNT; IF changed<>1 THEN RAISE EXCEPTION 'Funnel changed'; END IF;
  END IF;
  RETURN jsonb_build_object('id',fid);
 ELSIF p_operation='archive_funnel' THEN
  UPDATE meta_ad_funnels SET archived=true,updated_at=now() WHERE id=fid AND workspace_id=w;
  DELETE FROM meta_landing_page_templates WHERE workspace_id=w AND funnel_id=fid;
 ELSIF p_operation='template_rule' THEN
  rid:=(p_input->>'id')::uuid;
  IF rid IS NOT NULL THEN
   SELECT * INTO r FROM meta_landing_page_templates WHERE workspace_id=w AND id=rid FOR UPDATE;
   IF NOT FOUND OR r.brand_id IS DISTINCT FROM b THEN RAISE EXCEPTION 'Rule outside brand'; END IF;
   UPDATE meta_landing_page_templates SET funnel_id=fid,match_kind=p_input->>'match_kind',pattern=p_input->>'pattern',updated_at=now() WHERE id=rid AND workspace_id=w;
  ELSE
   INSERT INTO meta_landing_page_templates(workspace_id,brand_id,funnel_id,match_kind,pattern,created_by)
    VALUES(w,b,fid,p_input->>'match_kind',p_input->>'pattern',u)
    ON CONFLICT(workspace_id,brand_id,match_kind,pattern) DO UPDATE SET funnel_id=excluded.funnel_id,updated_at=now() RETURNING id INTO rid;
  END IF;
  RETURN jsonb_build_object('id',rid,'brand_id',b,'funnel_id',fid,'match_kind',p_input->>'match_kind','pattern',p_input->>'pattern');
 ELSIF p_operation='delete_template_rule' THEN
  DELETE FROM meta_landing_page_templates WHERE workspace_id=w AND id=r.id;
 ELSIF p_operation IN ('cep','intention','cep_status','intention_status') THEN
  table_name:=CASE WHEN p_operation LIKE 'cep%' THEN 'meta_ad_cep_catalog' ELSE 'meta_ad_intention_catalog' END;
  key:=p_input->>'key';rev:=(p_input->>'revision')::integer;
  IF rev IS NULL OR rev<0 THEN RAISE EXCEPTION 'Invalid revision'; END IF;
  IF p_operation LIKE '%_status' THEN
   EXECUTE format('UPDATE %I SET is_active=$1,revision=revision+1,updated_by=$2,updated_at=now() WHERE workspace_id=$3 AND brand_id=$4 AND key=$5 AND revision=$6',table_name)
    USING (p_input->>'active')::boolean,u,w,b,key,rev;
  ELSIF rev=0 THEN
   EXECUTE format('INSERT INTO %I(workspace_id,brand_id,key,label,description,updated_by) VALUES($1,$2,$3,$4,$5,$6)',table_name)
    USING w,b,key,p_input->>'label',p_input->>'description',u;
  ELSE
   EXECUTE format('UPDATE %I SET label=$1,description=$2,revision=revision+1,updated_by=$3,updated_at=now() WHERE workspace_id=$4 AND brand_id=$5 AND key=$6 AND revision=$7',table_name)
    USING p_input->>'label',p_input->>'description',u,w,b,key,rev;
  END IF;
  GET DIAGNOSTICS changed=ROW_COUNT; IF changed<>1 THEN RAISE EXCEPTION 'Category changed'; END IF;
 ELSIF p_operation='taxonomy_rule' THEN
  rev:=(p_input->>'revision')::integer;
  IF rev=0 THEN
   INSERT INTO meta_ad_taxonomy_rules(workspace_id,brand_id,dimension,raw_key,cep_keys,intention_key,updated_by)
    VALUES(w,b,p_input->>'dimension',p_input->>'raw_key',ARRAY(SELECT jsonb_array_elements_text(p_input->'cep_keys')),p_input->>'intention_key',u);
  ELSE
   UPDATE meta_ad_taxonomy_rules SET cep_keys=ARRAY(SELECT jsonb_array_elements_text(p_input->'cep_keys')),intention_key=p_input->>'intention_key',revision=revision+1,updated_by=u,updated_at=now()
    WHERE workspace_id=w AND brand_id=b AND dimension=p_input->>'dimension' AND raw_key=p_input->>'raw_key' AND revision=rev;
  END IF;
  GET DIAGNOSTICS changed=ROW_COUNT; IF changed<>1 THEN RAISE EXCEPTION 'Rule changed'; END IF;
 END IF;
 RETURN jsonb_build_object('saved',true);
END $$;
REVOKE ALL ON FUNCTION mutate_meta_brand_configuration(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mutate_meta_brand_configuration(uuid,uuid,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
