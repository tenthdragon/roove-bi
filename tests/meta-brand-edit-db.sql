CREATE FUNCTION pg_temp.ok(value boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END $$;
CREATE FUNCTION pg_temp.denied(w uuid,u uuid,op text,input jsonb) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 BEGIN PERFORM mutate_meta_brand_configuration(w,u,op,input); EXCEPTION WHEN OTHERS THEN RETURN; END;
 RAISE EXCEPTION 'Unauthorized operation succeeded: % %',op,input;
END $$;
CREATE TEMP TABLE edit_scope AS SELECT
 '00000000-0000-4000-8000-000000000001'::uuid w,
 (SELECT id FROM profiles WHERE role::text NOT IN ('owner','pending') ORDER BY id LIMIT 1) u,
 (SELECT id FROM profiles WHERE role::text NOT IN ('owner','pending') ORDER BY id OFFSET 1 LIMIT 1) teammate,
 (SELECT min(id) FROM brands WHERE workspace_id='00000000-0000-4000-8000-000000000001') b,
 (SELECT max(id) FROM brands WHERE workspace_id='00000000-0000-4000-8000-000000000001') other,
 (SELECT account_id FROM meta_ad_accounts WHERE workspace_id='00000000-0000-4000-8000-000000000001' AND is_active ORDER BY account_id LIMIT 1) account;
INSERT INTO workspace_memberships(workspace_id,user_id,role,status) SELECT w,u,'advertiser','active' FROM edit_scope
UNION ALL SELECT w,teammate,'advertiser','active' FROM edit_scope
ON CONFLICT(workspace_id,user_id) DO UPDATE SET role='advertiser',status='active';
INSERT INTO workspace_role_permissions(workspace_id,role,permission_key) SELECT w,'advertiser','tab:meta-funnels' FROM edit_scope ON CONFLICT DO NOTHING;
INSERT INTO workspace_advertiser_brands(workspace_id,user_id,brand_id) SELECT w,u,b FROM edit_scope UNION ALL SELECT w,teammate,b FROM edit_scope;
UPDATE meta_ad_accounts a SET default_brand_id=s.b FROM edit_scope s WHERE a.workspace_id=s.w AND a.account_id=s.account;
INSERT INTO meta_ad_mappings(workspace_id,account_id,ad_id,ad_name,auto_mapping,source,fingerprint)
SELECT w,account,'999998822700','Brand scope fixture','{"tags":[{"dimension":"intention","key":"retention"}],"keywords":[],"issues":[],"free_text":"test"}','inventory','brand-edit-test' FROM edit_scope;
GRANT SELECT ON edit_scope TO service_role;
SET LOCAL ROLE service_role;
DO $$ DECLARE s record; own uuid; shared uuid; other_funnel uuid; rule uuid; custom_key text; r jsonb; v integer; BEGIN
 SELECT * INTO s FROM edit_scope;
 PERFORM pg_temp.ok(s.b<>s.other AND s.u IS NOT NULL AND s.teammate IS NOT NULL,'Need distinct local fixture users/brands');
 PERFORM pg_temp.ok(NOT EXISTS(SELECT 1 FROM workspace_role_permissions WHERE workspace_id=s.w AND role='advertiser' AND permission_key='admin:meta'),'Advertiser received integration permission');
 INSERT INTO meta_ad_funnels(workspace_id,created_by,config) VALUES(s.w,s.u,'{}') RETURNING id INTO shared;
 INSERT INTO meta_ad_funnels(workspace_id,brand_id,created_by,config) VALUES(s.w,s.other,s.u,'{}') RETURNING id INTO other_funnel;
 r:=mutate_meta_brand_configuration(s.w,s.u,'funnel',jsonb_build_object('brandId',s.b,'config','{"account_ids":[],"name":"Own brand"}'::jsonb));own:=(r->>'id')::uuid;
 PERFORM mutate_meta_brand_configuration(s.w,s.teammate,'funnel',jsonb_build_object('id',own,'version',1,'config','{"account_ids":[],"name":"Teammate edit"}'::jsonb));
 PERFORM pg_temp.ok((SELECT version=2 AND config->>'name'='Teammate edit' FROM meta_ad_funnels WHERE id=own),'Same-brand teammate cannot edit');
 PERFORM pg_temp.denied(s.w,s.u,'funnel','{"config":{}}');
 PERFORM pg_temp.denied(s.w,s.u,'funnel',jsonb_build_object('brandId',s.other,'config','{}'::jsonb));
 PERFORM pg_temp.denied(s.w,s.u,'funnel',jsonb_build_object('brandId',s.b,'config',jsonb_build_object('account_ids',jsonb_build_array('act_999999999999'))));
 PERFORM pg_temp.denied(s.w,s.u,'funnel',jsonb_build_object('id',shared,'version',1,'config','{}'::jsonb));
 PERFORM pg_temp.denied(s.w,s.u,'archive_funnel',jsonb_build_object('id',other_funnel));
 PERFORM pg_temp.denied('00000000-0000-4000-8000-000000000002',s.u,'funnel',jsonb_build_object('id',own,'version',2,'config','{}'::jsonb));
 PERFORM pg_temp.denied(s.w,s.u,'funnel',jsonb_build_object('id',own,'version',1,'config','{}'::jsonb));
 r:=mutate_meta_brand_configuration(s.w,s.u,'template_rule',jsonb_build_object('funnelId',own,'match_kind','exact','pattern','https://shared.example/path'));rule:=(r->>'id')::uuid;
 INSERT INTO meta_landing_page_templates(workspace_id,funnel_id,match_kind,pattern,created_by) VALUES(s.w,shared,'exact','https://shared.example/path',s.u);
 INSERT INTO meta_landing_page_templates(workspace_id,brand_id,funnel_id,match_kind,pattern,created_by) VALUES(s.w,s.other,other_funnel,'exact','https://shared.example/path',s.u);
 PERFORM pg_temp.ok((SELECT count(*)=3 FROM meta_landing_page_templates WHERE workspace_id=s.w AND pattern='https://shared.example/path'),'Same URL scopes overwrite each other');
 PERFORM pg_temp.denied(s.w,s.u,'template_rule',jsonb_build_object('funnelId',other_funnel,'id',rule,'match_kind','exact','pattern','https://other.example/'));
 PERFORM pg_temp.denied(s.w,s.u,'template_rule',jsonb_build_object('funnelId',own,'match_kind','ctwa','pattern','ctwa:'||s.other||':phone:+628111111111'));
 custom_key:='b'||s.b||'.retention-test';
 PERFORM mutate_meta_brand_configuration(s.w,s.u,'intention',jsonb_build_object('brandId',s.b,'key',custom_key,'label','Retention fixture','description','Existing customers','revision',0));
 PERFORM mutate_meta_brand_configuration(s.w,s.u,'taxonomy_rule',jsonb_build_object('brandId',s.b,'dimension','intention','raw_key','retention','cep_keys','[]'::jsonb,'intention_key',custom_key,'revision',0));
 r:=resolve_meta_ad_taxonomy(s.w,s.b,'{"tags":[{"dimension":"intention","key":"retention"}]}','{}');
 PERFORM pg_temp.ok(r->>'intention_key'=custom_key,'Custom intention not resolved');
 PERFORM pg_temp.ok(resolve_meta_ad_taxonomy(s.w,s.other,'{"tags":[{"dimension":"intention","key":"retention"}]}','{}')->>'intention_key' IS NULL,'Other brand adopted custom intention');
 PERFORM pg_temp.denied(s.w,s.u,'intention',jsonb_build_object('brandId',s.other,'key','b'||s.other||'.foreign','label','Foreign','description','','revision',0));
 SELECT revision INTO v FROM meta_ad_mappings WHERE workspace_id=s.w AND account_id=s.account AND ad_id='999998822700';
 PERFORM mutate_meta_brand_configuration(s.w,s.u,'mapping',jsonb_build_object('accountId',s.account,'adId','999998822700','revision',v,'overrides',jsonb_build_object('intention',custom_key)));
 PERFORM pg_temp.ok((SELECT intention_key=custom_key FROM meta_ad_classifications WHERE workspace_id=s.w AND account_id=s.account AND ad_id='999998822700'),'Custom manual classification lost');
 -- Both report engines must preserve the custom intention and unique spend.
 PERFORM pg_temp.ok(NOT EXISTS(SELECT 1 FROM meta_ad_daily_metrics WHERE metric_date='1995-01-02'),'Fixture date collision');
 PERFORM replace_meta_ad_snapshot(s.w,s.account,'Brand edit test','1995-01-02','1995-01-02','IDR','Asia/Jakarta','[
  {"ad_id":"999998822700","ad_name":"Brand scope fixture","metric_date":"1995-01-02","metrics":{"spend":125,"impressions":100,"purchases":1},"raw_insights":{},"landing_page_urls":[]}
 ]');
 r:=get_meta_ad_report(s.w,'1995-01-02','1995-01-02',jsonb_build_object('account_ids',jsonb_build_array(s.account)),jsonb_build_object('intention',custom_key),s.b::text,'cep_intention');
 PERFORM pg_temp.ok((r#>>'{summary,spend}')::numeric=125 AND r#>>'{groups,0,key}'='cep:__unknown__:'||custom_key,'Custom intention lost in legacy report');
 r:=get_meta_ad_report_incremental(s.w,'1995-01-02','1995-01-02',jsonb_build_object('account_ids',jsonb_build_array(s.account)),jsonb_build_object('intention',custom_key),s.b::text,'cep_intention');
 PERFORM pg_temp.ok((r#>>'{summary,spend}')::numeric=125 AND (r->>'matchingAds')::int=1,'Custom intention filter lost or duplicated spend');
 PERFORM pg_temp.ok(EXISTS(SELECT 1 FROM jsonb_array_elements(r->'facets') f WHERE f->>'dimension'='intention' AND f->>'value'=custom_key),'Custom intention facet missing');
 PERFORM pg_temp.ok((SELECT sum((i#>>'{current,spend}')::numeric)=125 FROM jsonb_array_elements(r->'intentionTotals') i),'Intention total duplicated');
 PERFORM mutate_meta_brand_configuration(s.w,s.u,'intention_status',jsonb_build_object('brandId',s.b,'key',custom_key,'revision',1,'active',false));
 PERFORM pg_temp.ok(resolve_meta_ad_taxonomy(s.w,s.b,'{}',jsonb_build_object('intention',custom_key))->>'intention_key'=custom_key,'Retirement erased history');
 -- Canonical-account reassignments immediately revoke access to old ad targets.
 UPDATE meta_ad_accounts SET default_brand_id=s.other WHERE workspace_id=s.w AND account_id=s.account;
 PERFORM pg_temp.denied(s.w,s.u,'mapping',jsonb_build_object('accountId',s.account,'adId','999998822700','revision',v+1,'overrides','{}'::jsonb));
 DELETE FROM workspace_role_permissions WHERE workspace_id=s.w AND role='advertiser' AND permission_key='meta:taxonomy';
 PERFORM pg_temp.denied(s.w,s.u,'intention_status',jsonb_build_object('brandId',s.b,'key',custom_key,'revision',2,'active',true));
 DELETE FROM workspace_advertiser_brands WHERE workspace_id=s.w AND user_id=s.u;
 PERFORM pg_temp.denied(s.w,s.u,'funnel',jsonb_build_object('id',own,'version',2,'config','{}'::jsonb));
 PERFORM pg_temp.denied(s.w,s.u,'delete_template_rule',jsonb_build_object('id',rule));
 PERFORM mutate_meta_brand_configuration(s.w,s.teammate,'archive_funnel',jsonb_build_object('id',own));
 PERFORM pg_temp.ok((SELECT archived FROM meta_ad_funnels WHERE id=own),'Archive failed');
 PERFORM pg_temp.ok(NOT EXISTS(SELECT 1 FROM meta_landing_page_templates WHERE id=rule),'Own rules remain after archive');
 PERFORM pg_temp.ok((SELECT count(*)=2 FROM meta_landing_page_templates WHERE workspace_id=s.w AND pattern='https://shared.example/path'),'Archive removed shared/foreign rules');
END $$;
RESET ROLE;
DO $$ BEGIN
 PERFORM pg_temp.ok(NOT has_function_privilege('authenticated','mutate_meta_brand_configuration(uuid,uuid,text,jsonb)','EXECUTE'),'Browser can spoof actor');
 PERFORM pg_temp.ok(NOT has_function_privilege('anon','mutate_meta_brand_configuration(uuid,uuid,text,jsonb)','EXECUTE'),'Anonymous mutation exposed');
 PERFORM pg_temp.ok(NOT has_table_privilege('authenticated','meta_ad_intention_catalog','SELECT,INSERT,UPDATE,DELETE'),'Catalog bypass exposed');
END $$;
SELECT 'PASS: independent permissions, own-brand teammate edits, shared/foreign/workspace denial, URL isolation, custom intention lifecycle, revoked assignments/permission, account reassignment, optimistic version, archive isolation, private RPC';
