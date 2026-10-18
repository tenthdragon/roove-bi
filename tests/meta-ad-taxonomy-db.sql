-- Fixed local database only; the enclosing runner always rolls back.
DO $$ BEGIN IF to_regnamespace('roove_local') IS NULL THEN RAISE EXCEPTION 'Local database marker missing'; END IF; END $$;
CREATE FUNCTION pg_temp.assert_true(v boolean,m text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF v IS DISTINCT FROM true THEN RAISE EXCEPTION '%',m;END IF;END $$;
DO $$
DECLARE w uuid:='00000000-0000-4000-8000-000000000001';a text;b text;rb integer;ob integer;u uuid;v bigint;r jsonb;x jsonb;rev integer;
BEGIN
 SELECT id INTO rb FROM brands WHERE workspace_id=w AND lower(name)='roove';
 SELECT account_id INTO a FROM meta_ad_accounts WHERE workspace_id=w AND default_brand_id=rb AND is_active ORDER BY account_id LIMIT 1;
 SELECT account_id,default_brand_id INTO b,ob FROM meta_ad_accounts WHERE workspace_id=w AND default_brand_id<>rb AND is_active ORDER BY account_id LIMIT 1;
 SELECT id INTO u FROM auth.users LIMIT 1;
 PERFORM pg_temp.assert_true(a IS NOT NULL AND b IS NOT NULL AND u IS NOT NULL,'Fixture requires two scoped brands/accounts');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM meta_ad_mappings WHERE ad_id LIKE '9999999800%'),'Fixture ad collision');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM meta_ad_daily_metrics WHERE metric_date='2001-01-01'),'Fixture date collision');
 PERFORM pg_temp.assert_true((SELECT count(*)=5 FROM meta_ad_cep_catalog WHERE workspace_id=w AND brand_id=rb AND key IN ('skin','joint','bone','hair','nail')),'Roove seed categories missing');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM meta_ad_cep_catalog WHERE workspace_id=w AND brand_id=ob),'Roove CEPs leaked to another brand');
 BEGIN INSERT INTO meta_ad_cep_catalog(workspace_id,brand_id,key,label,updated_by) VALUES(w,rb,'unscoped-fixture','Sport',u);RAISE EXCEPTION 'accepted unscoped CEP';EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted unscoped CEP' THEN RAISE;END IF;END;
 INSERT INTO meta_ad_cep_catalog(workspace_id,brand_id,key,label,updated_by) VALUES(w,ob,'b'||ob||'.fixture-taxonomy-sport','Aktivitas',u);
 BEGIN INSERT INTO meta_ad_cep_catalog(workspace_id,brand_id,key,label) SELECT id,rb,'skin','Wrong workspace' FROM workspaces WHERE id<>w LIMIT 1;RAISE EXCEPTION 'accepted foreign brand';EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted foreign brand' THEN RAISE;END IF;END;
 PERFORM upsert_meta_ad_mappings(w,a,'[
 {"ad_id":"999999980001","ad_name":"[fixture-taxonomy-sport][fixture-taxonomy-educ] Manual","creative_id":"1","landing_page_urls":[],"auto_mapping":{"tags":[{"dimension":"cep","key":"fixture-taxonomy-sport","raw":"fixture-taxonomy-sport","label":"fixture-taxonomy-sport","position":1,"source":"bracket","recognized":false},{"dimension":"intention","key":"fixture-taxonomy-educ","raw":"fixture-taxonomy-educ","label":"fixture-taxonomy-educ","position":2,"source":"bracket","recognized":false}],"keywords":[]}},
 {"ad_id":"999999980002","ad_name":"[fixture-taxonomy-sport][fixture-taxonomy-educ] Automatic","creative_id":"2","landing_page_urls":[],"auto_mapping":{"tags":[{"dimension":"cep","key":"fixture-taxonomy-sport","raw":"fixture-taxonomy-sport","label":"fixture-taxonomy-sport","position":1,"source":"bracket","recognized":false},{"dimension":"intention","key":"fixture-taxonomy-educ","raw":"fixture-taxonomy-educ","label":"fixture-taxonomy-educ","position":2,"source":"bracket","recognized":false}],"keywords":[]}},
 {"ad_id":"999999980003","ad_name":"[features][tripeptide] Review","creative_id":"3","landing_page_urls":[],"auto_mapping":{"tags":[{"dimension":"cep","key":"features","raw":"features","label":"features","position":1,"source":"bracket","recognized":false},{"dimension":"intention","key":"tripeptide","raw":"tripeptide","label":"tripeptide","position":2,"source":"bracket","recognized":false}],"keywords":[]}}
 ]','inventory');
 PERFORM set_meta_ad_mapping_overrides(w,a,'999999980001','{"ceps":["skin","joint"],"intention":"cons"}',u,1);
 PERFORM pg_temp.assert_true((SELECT cep_keys=ARRAY['joint','skin'] AND intention_key='cons' FROM meta_ad_classifications WHERE workspace_id=w AND account_id=a AND ad_id='999999980001'),'Manual multi CEP failed');
 PERFORM pg_temp.assert_true((SELECT cep_keys='{}' AND intention_key IS NULL FROM meta_ad_classifications WHERE workspace_id=w AND account_id=a AND ad_id='999999980003'),'Arbitrary raw tags became categories');
 BEGIN PERFORM set_meta_ad_mapping_overrides(w,a,'999999980001','{"ceps":["skin","skin"]}',u,2);RAISE EXCEPTION 'accepted duplicate';EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted duplicate' THEN RAISE;END IF;END;
 BEGIN PERFORM set_meta_ad_mapping_overrides(w,a,'999999980001','{"intention":"features"}',u,2);RAISE EXCEPTION 'accepted intention';EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted intention' THEN RAISE;END IF;END;
 BEGIN PERFORM set_meta_ad_mapping_overrides(w,a,'999999980001',jsonb_build_object('ceps',jsonb_build_array('b'||ob||'.fixture-taxonomy-sport')),u,2);RAISE EXCEPTION 'accepted other brand CEP';EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted other brand CEP' THEN RAISE;END IF;END;
 BEGIN PERFORM set_meta_ad_mapping_overrides(w,a,'999999980001','{}',u,1);RAISE EXCEPTION 'accepted stale revision';EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted stale revision' THEN RAISE;END IF;END;
 PERFORM replace_meta_ad_snapshot(w,a,'Taxonomy local','2001-01-01','2001-01-01','IDR','Asia/Jakarta','[
 {"ad_id":"999999980001","ad_name":"[fixture-taxonomy-sport][fixture-taxonomy-educ] Manual","metric_date":"2001-01-01","metrics":{"spend":100,"impressions":100,"purchases":1},"raw_insights":{},"landing_page_urls":[]},
 {"ad_id":"999999980002","ad_name":"[fixture-taxonomy-sport][fixture-taxonomy-educ] Automatic","metric_date":"2001-01-01","metrics":{"spend":200,"impressions":200,"purchases":2},"raw_insights":{},"landing_page_urls":[]},
 {"ad_id":"999999980003","ad_name":"[features][tripeptide] Review","metric_date":"2001-01-01","metrics":{"spend":50,"impressions":50},"raw_insights":{},"landing_page_urls":[]}
 ]');
 r:=preview_meta_taxonomy_rule(w,rb,'cep','fixture-taxonomy-sport','2001-01-01','2001-01-01');
 PERFORM pg_temp.assert_true((r->>'eligible')::int=1 AND (r->>'manualPreserved')::int=1 AND (r#>>'{spendByCurrency,IDR}')::numeric=200,'Preview duplicated spend or ignored manual edits: '||r::text);
 SELECT revision INTO v FROM meta_ad_report_versions WHERE workspace_id=w;
 INSERT INTO meta_ad_taxonomy_rules(workspace_id,brand_id,dimension,raw_key,cep_keys,updated_by) VALUES(w,rb,'cep','fixture-taxonomy-sport',ARRAY['bone','joint'],u);
 INSERT INTO meta_ad_taxonomy_rules(workspace_id,brand_id,dimension,raw_key,intention_key,updated_by) VALUES(w,rb,'intention','fixture-taxonomy-educ','disc',u);
 PERFORM pg_temp.assert_true((SELECT revision>v FROM meta_ad_report_versions WHERE workspace_id=w),'Rule save did not invalidate report cache');
 PERFORM pg_temp.assert_true((SELECT cep_keys=ARRAY['bone','joint'] AND intention_key='disc' FROM meta_ad_classifications WHERE workspace_id=w AND account_id=a AND ad_id='999999980002'),'Rule did not remap existing ad');
 r:=get_meta_ad_report(w,'2001-01-01','2001-01-01',jsonb_build_object('account_ids',jsonb_build_array(a)),'{}',rb::text,'cep_intention');
 PERFORM pg_temp.assert_true((r#>>'{summary,spend}')::numeric=350 AND (r->>'matchingAds')::int=3,'Unique brand total or ad count doubled');
 PERFORM pg_temp.assert_true((SELECT sum((g#>>'{current,spend}')::numeric)=650 FROM jsonb_array_elements(r->'groups') g),'Overlapping cohort totals are incorrect');
 PERFORM pg_temp.assert_true((SELECT sum((g#>>'{current,spend}')::numeric)=350 FROM jsonb_array_elements(r->'intentionTotals') g),'Intention totals doubled across CEP memberships');
 PERFORM pg_temp.assert_true((r->>'multiCepAds')::int=2,'Multi CEP count failed');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'facets') g WHERE g->>'dimension'='intention' AND g->>'value' NOT IN ('disc','cons','conv','__unknown__')),'Invalid intention leaked to filters');
 PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'facets') g WHERE g->>'dimension'='cep' AND g->>'value' NOT IN ('skin','joint','bone','hair','nail','__unknown__')),'Invalid CEP leaked to Roove filters');
 r:=get_meta_ad_report(w,'2001-01-01','2001-01-01',jsonb_build_object('account_ids',jsonb_build_array(a)),'{"cep":"skin"}',rb::text,'cep_intention');
 PERFORM pg_temp.assert_true((r#>>'{summary,spend}')::numeric=100 AND jsonb_array_length(r->'groups')=1 AND r#>>'{groups,0,key}'='cep:skin:cons','CEP filtering lost membership or duplicated groups');
 r:=get_meta_ad_report(w,'2001-01-01','2001-01-01',jsonb_build_object('account_ids',jsonb_build_array(a)),'{}',rb::text,'cep_intention','daily','week',NULL);
 PERFORM pg_temp.assert_true((SELECT sum((g#>>'{totals,spend}')::numeric)=350 FROM jsonb_array_elements(r->'history') g),'Unfocused history doubled');
 r:=get_meta_ad_report(w,'2001-01-01','2001-01-01',jsonb_build_object('account_ids',jsonb_build_array(a)),'{}',rb::text,'cep_intention','daily','week','cep:skin:cons');
 PERFORM pg_temp.assert_true((SELECT sum((g#>>'{totals,spend}')::numeric)=100 FROM jsonb_array_elements(r->'history') g),'Focused CEP history failed');
 r:=get_meta_ad_report(w,'2001-01-01','2001-01-01',jsonb_build_object('account_ids',jsonb_build_array(a)),'{}',rb::text,'ad');
 PERFORM pg_temp.assert_true((SELECT sum((g#>>'{current,spend}')::numeric)=350 FROM jsonb_array_elements(r->'groups') g),'Ad report doubled');
 PERFORM upsert_meta_ad_mappings(w,a,'[{"ad_id":"999999980004","ad_name":"[fixture-taxonomy-sport][fixture-taxonomy-educ] New","creative_id":"4","landing_page_urls":[],"auto_mapping":{"tags":[{"dimension":"cep","key":"fixture-taxonomy-sport","raw":"fixture-taxonomy-sport","label":"fixture-taxonomy-sport","position":1,"source":"bracket","recognized":false},{"dimension":"intention","key":"fixture-taxonomy-educ","raw":"fixture-taxonomy-educ","label":"fixture-taxonomy-educ","position":2,"source":"bracket","recognized":false}],"keywords":[]}}]','inventory');
 PERFORM pg_temp.assert_true((SELECT cep_keys=ARRAY['bone','joint'] AND intention_key='disc' FROM meta_ad_classifications WHERE workspace_id=w AND account_id=a AND ad_id='999999980004'),'New ad did not inherit approved rule');
 PERFORM upsert_meta_ad_mappings(w,a,'[{"ad_id":"999999980001","ad_name":"[nail][conv] Renamed","creative_id":"5","landing_page_urls":[],"auto_mapping":{"tags":[{"dimension":"cep","key":"nail","raw":"nail","label":"nail","position":1,"source":"bracket","recognized":true}],"keywords":[]}}]','inventory',now()+interval '1 minute');
 PERFORM pg_temp.assert_true((SELECT cep_keys=ARRAY['joint','skin'] AND intention_key='cons' FROM meta_ad_classifications WHERE workspace_id=w AND account_id=a AND ad_id='999999980001'),'Sync overwrote manual classification');
 -- Legacy manual values remain evidence and can be repaired one dimension at a time.
 UPDATE meta_ad_mappings SET overrides='{"cep":"legacy-cep","intention":"legacy-intention"}',revision=revision+1 WHERE workspace_id=w AND account_id=a AND ad_id='999999980003';
 SELECT revision INTO rev FROM meta_ad_mappings WHERE workspace_id=w AND account_id=a AND ad_id='999999980003';
 PERFORM set_meta_ad_mapping_overrides(w,a,'999999980003','{"cep":"legacy-cep","intention":"conv"}',u,rev);
 PERFORM pg_temp.assert_true((SELECT cep_keys='{}' AND intention_key='conv' FROM meta_ad_classifications WHERE workspace_id=w AND account_id=a AND ad_id='999999980003'),'Legacy manual values blocked an independent repair');
 PERFORM set_meta_ad_mapping_overrides(w,a,'999999980003','{"ceps":["skin"],"intention":"conv"}',u,rev+1);
 PERFORM pg_temp.assert_true((SELECT cep_keys=ARRAY['skin'] AND intention_key='conv' FROM meta_ad_classifications WHERE workspace_id=w AND account_id=a AND ad_id='999999980003'),'Legacy repair did not finish');
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM meta_ad_taxonomy_audit WHERE workspace_id=w AND entity='ad_override' AND after_value->'ceps'='["skin","joint"]'),'Missing mapping audit');
 PERFORM pg_temp.assert_true(NOT has_table_privilege('authenticated','meta_ad_cep_catalog','SELECT') AND NOT has_function_privilege('anon','resolve_meta_ad_taxonomy(uuid,integer,jsonb,jsonb)','EXECUTE'),'Taxonomy bypasses server authorization');
 PERFORM pg_temp.assert_true(has_function_privilege('service_role','resolve_meta_ad_taxonomy(uuid,integer,jsonb,jsonb)','EXECUTE'),'Service cannot classify');
END $$;
-- Exercise the real database API role, including trigger/audit sequence privileges.
SET LOCAL ROLE service_role;
DO $$ DECLARE w uuid;a text;u uuid;rev integer;rb integer;r jsonb;BEGIN
 SELECT workspace_id,account_id,override_by,revision INTO w,a,u,rev FROM meta_ad_mappings WHERE ad_id='999999980001';
 SELECT default_brand_id INTO rb FROM meta_ad_accounts WHERE workspace_id=w AND account_id=a;
 PERFORM set_meta_ad_mapping_overrides(w,a,'999999980001','{"ceps":["skin","joint"],"intention":"cons"}',u,rev);
 INSERT INTO meta_ad_taxonomy_rules(workspace_id,brand_id,dimension,raw_key,intention_key,updated_by) VALUES(w,rb,'intention','fixture-service-permissions','conv',u);
 r:=get_meta_ad_report(w,'2001-01-01','2001-01-01',jsonb_build_object('account_ids',jsonb_build_array(a)),'{}',rb::text,'cep_intention');
 IF (r#>>'{summary,spend}')::numeric<>350 THEN RAISE EXCEPTION 'Service report totals failed'; END IF;
END $$;
RESET ROLE;
SELECT 'PASS: brand catalog isolation, three intentions, multi CEP, unique totals/facets/history, manual preservation, preview, rules for old/new ads, revisions, audit and grants';

-- Lifecycle is exercised as the real API role and rolled back with all fixtures.
SET LOCAL ROLE service_role;
DO $$
DECLARE w uuid; a text; u uuid; rb integer; k text; rev integer; before_report jsonb; after_report jsonb; v bigint;
BEGIN
 SELECT workspace_id,account_id,override_by INTO w,a,u FROM meta_ad_mappings WHERE ad_id='999999980001';
 SELECT default_brand_id INTO rb FROM meta_ad_accounts WHERE workspace_id=w AND account_id=a;
 k:='b'||rb||'.fixture-lifecycle';
 INSERT INTO meta_ad_cep_catalog(workspace_id,brand_id,key,label,description,updated_by) VALUES(w,rb,k,'Aktivitas fixture','Additional Roove CEP',u);
 PERFORM pg_temp.assert_true((SELECT count(*)>5 FROM meta_ad_cep_catalog WHERE workspace_id=w AND brand_id=rb),'Roove cannot add a sixth CEP');
 BEGIN INSERT INTO meta_ad_cep_catalog(workspace_id,brand_id,key,label,updated_by) VALUES(w,rb,k||'-copy','  AKTIVITAS FIXTURE ',u);RAISE EXCEPTION 'accepted duplicate label';EXCEPTION WHEN unique_violation THEN NULL;END;
 SELECT revision INTO rev FROM meta_ad_mappings WHERE workspace_id=w AND account_id=a AND ad_id='999999980003';
 PERFORM set_meta_ad_mapping_overrides(w,a,'999999980003',jsonb_build_object('ceps',jsonb_build_array('skin',k),'intention','conv'),u,rev);
 INSERT INTO meta_ad_taxonomy_rules(workspace_id,brand_id,dimension,raw_key,cep_keys,updated_by) VALUES(w,rb,'cep','fixture-lifecycle',ARRAY[k],u);
 before_report:=get_meta_ad_report(w,'2001-01-01','2001-01-01',jsonb_build_object('account_ids',jsonb_build_array(a)),'{}',rb::text,'cep_intention');
 SELECT revision INTO v FROM meta_ad_report_versions WHERE workspace_id=w;
 UPDATE meta_ad_cep_catalog SET is_active=false,revision=revision+1,updated_by=u WHERE workspace_id=w AND brand_id=rb AND key=k;
 PERFORM pg_temp.assert_true((SELECT revision>v FROM meta_ad_report_versions WHERE workspace_id=w),'Deactivate did not invalidate report cache');
 after_report:=get_meta_ad_report(w,'2001-01-01','2001-01-01',jsonb_build_object('account_ids',jsonb_build_array(a)),'{}',rb::text,'cep_intention');
 PERFORM pg_temp.assert_true(before_report->'summary'=after_report->'summary' AND before_report->'groups'=after_report->'groups','Deactivation changed historical performance');
 SELECT revision INTO rev FROM meta_ad_mappings WHERE workspace_id=w AND account_id=a AND ad_id='999999980003';
 PERFORM set_meta_ad_mapping_overrides(w,a,'999999980003',jsonb_build_object('ceps',jsonb_build_array('joint',k),'intention','cons'),u,rev);
 PERFORM pg_temp.assert_true((SELECT k=ANY(cep_keys) FROM meta_ad_classifications WHERE workspace_id=w AND account_id=a AND ad_id='999999980003'),'Could not retain an archived assignment');
 SELECT revision INTO rev FROM meta_ad_mappings WHERE workspace_id=w AND account_id=a AND ad_id='999999980001';
 BEGIN PERFORM set_meta_ad_mapping_overrides(w,a,'999999980001',jsonb_build_object('ceps',jsonb_build_array(k)),u,rev);RAISE EXCEPTION 'accepted new inactive assignment';EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted new inactive assignment' THEN RAISE;END IF;END;
 BEGIN INSERT INTO meta_ad_taxonomy_rules(workspace_id,brand_id,dimension,raw_key,cep_keys,updated_by) VALUES(w,rb,'cep','fixture-new-inactive',ARRAY[k],u);RAISE EXCEPTION 'accepted inactive rule';EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted inactive rule' THEN RAISE;END IF;END;
 UPDATE meta_ad_taxonomy_rules SET cep_keys=ARRAY[k,'skin'],revision=revision+1 WHERE workspace_id=w AND brand_id=rb AND raw_key='fixture-lifecycle';
 PERFORM pg_temp.assert_true(public.resolve_meta_ad_taxonomy(w,rb,'{"tags":[{"dimension":"cep","key":"fixture-lifecycle"}]}','{}')->'cep_keys'=to_jsonb(ARRAY[k,'skin']),'Existing approved rule lost archived CEP');
 BEGIN DELETE FROM meta_ad_cep_catalog WHERE workspace_id=w AND brand_id=rb AND key=k;RAISE EXCEPTION 'deleted historical CEP';EXCEPTION WHEN OTHERS THEN IF SQLERRM='deleted historical CEP' THEN RAISE;END IF;END;
 BEGIN UPDATE meta_ad_cep_catalog SET key=k||'-changed' WHERE workspace_id=w AND brand_id=rb AND key=k;RAISE EXCEPTION 'changed stable identity';EXCEPTION WHEN OTHERS THEN IF SQLERRM='changed stable identity' THEN RAISE;END IF;END;
 UPDATE meta_ad_cep_catalog SET is_active=true,label='Aktivitas diperbarui',revision=revision+1,updated_by=u WHERE workspace_id=w AND brand_id=rb AND key=k;
 PERFORM set_meta_ad_mapping_overrides(w,a,'999999980001',jsonb_build_object('ceps',jsonb_build_array(k)),u,rev);
 PERFORM pg_temp.assert_true((SELECT cep_keys=ARRAY[k] FROM meta_ad_classifications WHERE workspace_id=w AND account_id=a AND ad_id='999999980001'),'Reactivated category cannot be assigned');
 PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM meta_ad_taxonomy_audit WHERE workspace_id=w AND entity='meta_ad_cep_catalog' AND identity->>'key'=k AND (before_value->>'is_active')::boolean AND NOT (after_value->>'is_active')::boolean),'Deactivation audit missing');
 PERFORM pg_temp.assert_true(NOT has_function_privilege('anon','guard_meta_cep_lifecycle()','EXECUTE'),'Lifecycle permission leak');
END $$;
RESET ROLE;
SELECT 'PASS: flexible Roove catalog, stable identity, rename, deactivate/reactivate, retained history/rules, inactive assignment rejection, audit and API-role grants';
