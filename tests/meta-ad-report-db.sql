-- Execute on the fixed local clone only. Fixture writes always roll back.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='roove_local') THEN RAISE EXCEPTION 'Refusing a database without the local clone marker'; END IF;
END $$;
CREATE TEMP TABLE report_test_scope AS
SELECT a.workspace_id,a.account_id, row_number() OVER (ORDER BY a.account_id) AS n
FROM meta_ad_accounts a WHERE workspace_id='00000000-0000-4000-8000-000000000001' AND is_active ORDER BY account_id LIMIT 2;
DO $$ DECLARE w uuid; a text; b text; uid uuid; v bigint; report jsonb; BEGIN
 SELECT workspace_id,account_id INTO w,a FROM report_test_scope WHERE n=1;
 SELECT account_id INTO b FROM report_test_scope WHERE n=2;
 SELECT id INTO uid FROM auth.users LIMIT 1;
 IF a IS NULL OR b IS NULL OR uid IS NULL THEN RAISE EXCEPTION 'Two local accounts and a user are required'; END IF;
 IF EXISTS(SELECT 1 FROM meta_ad_daily_metrics WHERE workspace_id=w AND metric_date BETWEEN '1999-12-31' AND '2000-01-03') THEN RAISE EXCEPTION 'Refusing fixture date collision'; END IF;
 IF EXISTS(SELECT 1 FROM meta_ad_creatives WHERE workspace_id=w AND ad_id LIKE '9999999900%') THEN RAISE EXCEPTION 'Refusing fixture ad collision'; END IF;
 UPDATE meta_ad_accounts SET default_brand_id=(SELECT min(id) FROM brands WHERE workspace_id=w) WHERE workspace_id=w AND account_id=a;
 UPDATE meta_ad_accounts SET default_brand_id=(SELECT max(id) FROM brands WHERE workspace_id=w) WHERE workspace_id=w AND account_id=b;
 PERFORM upsert_meta_ad_mappings(w,a,'[
 {"ad_id":"999999990001","ad_name":"[sendi][cons] Same","creative_id":"1","landing_page_urls":[],"auto_mapping":{"keywords":[],"tags":[{"dimension":"cep","key":"joint","raw":"sendi","label":"Sendi","position":1,"source":"bracket","recognized":true},{"dimension":"intention","key":"cons","raw":"cons","label":"Consideration","position":2,"source":"bracket","recognized":true}]}},
 {"ad_id":"999999990002","ad_name":"[skin][conv] Cached","creative_id":"2","landing_page_urls":[],"auto_mapping":{"keywords":[],"tags":[{"dimension":"cep","key":"skin","raw":"skin","label":"Skin","position":1,"source":"bracket","recognized":true},{"dimension":"intention","key":"conv","raw":"conv","label":"Conversion","position":2,"source":"bracket","recognized":true}]}},
 {"ad_id":"999999990009","ad_name":"[bone][disc] No delivery","creative_id":"9","landing_page_urls":[],"auto_mapping":{"keywords":[],"tags":[{"dimension":"cep","key":"bone","raw":"bone","label":"Bone","position":1,"source":"bracket","recognized":true}]}}
 ]','inventory');
 PERFORM set_meta_ad_mapping_overrides(w,a,'999999990001','{"cep":"bone"}',uid,1);
 PERFORM set_meta_ad_campaign_dimensions(w,a,'[{"ad_id":"999999990001","campaign_id":"111","campaign_objective":"OUTCOME_TRAFFIC"}]');
 INSERT INTO meta_ad_creatives(workspace_id,account_id,ad_id,creative_id,name,landing_page_urls) VALUES
 (w,a,'999999990001','1','Same','["https://example.com/cached"]'),
 (w,a,'999999990002','2','Cached','["https://example.com/shared"]'),
 (w,a,'999999990003','3','Verified','[]'),
 (w,a,'999999990004','4','Changed','["https://example.com/stale"]');
 INSERT INTO meta_ad_verified_destinations(workspace_id,account_id,ad_id,creative_id,landing_page_url,verified_by) VALUES(w,a,'999999990003','3','https://example.com/shared',uid);
 PERFORM replace_meta_ad_snapshot(w,a,'Test A','1999-12-31','2000-01-03','IDR','Asia/Jakarta','[
 {"ad_id":"999999990001","ad_name":"[sendi][cons] Same","creative_id":"1","metric_date":"2000-01-01","metrics":{"spend":50,"impressions":500,"outbound_clicks":10,"lpv":5},"raw_insights":{"campaign_id":"111","objective":"OUTCOME_SALES"},"landing_page_urls":["https://example.com/shared"]},
 {"ad_id":"999999990001","ad_name":"[sendi][cons] Same","creative_id":"1","metric_date":"2000-01-02","metrics":{"spend":100,"impressions":1000,"outbound_clicks":20,"lpv":10,"atc":3,"checkout":2,"purchases":1,"purchase_value":200},"raw_insights":{"campaign_id":"111","objective":"OUTCOME_SALES"},"landing_page_urls":["https://example.com/shared"]},
 {"ad_id":"999999990001","ad_name":"[sendi][cons] Same","creative_id":"1","metric_date":"2000-01-03","metrics":{"spend":200,"impressions":500,"outbound_clicks":30,"lpv":15,"purchases":2},"raw_insights":{"campaign_id":"111","objective":"OUTCOME_SALES"},"landing_page_urls":["https://example.com/shared"]},
 {"ad_id":"999999990002","ad_name":"[skin][conv] Cached","creative_id":"2","metric_date":"2000-01-02","metrics":{"spend":20,"impressions":10,"outbound_clicks":5,"lpv":3},"raw_insights":{"campaign_id":"111"},"landing_page_urls":[]},
 {"ad_id":"999999990003","ad_name":"[ tulang ] [ consideration ] Verified","creative_id":"3","metric_date":"2000-01-02","metrics":{"spend":30,"impressions":200,"outbound_clicks":6,"lpv":4},"raw_insights":{"objective":"OUTCOME_SALES"},"landing_page_urls":[]},
 {"ad_id":"999999990004","ad_name":"No tags","creative_id":"44","metric_date":"2000-01-03","metrics":{"spend":40,"impressions":400,"outbound_clicks":8,"lpv":4},"raw_insights":{},"landing_page_urls":[]},
 {"ad_id":"999999990005","ad_name":"[new:cep%][new:intention%] Multi","metric_date":"2000-01-03","metrics":{"spend":60,"impressions":600},"raw_insights":{},"landing_page_urls":["https://example.com/a","https://example.com/b"]},
 {"ad_id":"999999990006","ad_name":"[kulit][conv] Paused","creative_id":"6","metric_date":"1999-12-31","metrics":{"spend":70,"impressions":700,"outbound_clicks":9},"raw_insights":{"objective":"OUTCOME_SALES"},"landing_page_urls":["https://example.com/paused"]},
 {"ad_id":"999999990006","ad_name":"[kulit][conv] Paused","creative_id":"6","metric_date":"2000-01-02","metrics":{"spend":0,"impressions":0},"raw_insights":{"objective":"OUTCOME_SALES"},"landing_page_urls":["https://example.com/paused"]}
 ]');
 PERFORM replace_meta_ad_snapshot(w,b,'Test B','1999-12-31','2000-01-03','IDR','Asia/Jakarta','[
 {"ad_id":"999999990001","ad_name":"[sendi][cons] Same","metric_date":"2000-01-02","metrics":{"spend":999,"impressions":9990,"outbound_clicks":999},"raw_insights":{"objective":"OUTCOME_SALES"},"landing_page_urls":["https://example.com/shared"]}
 ]');
 SELECT revision INTO v FROM meta_ad_report_versions WHERE workspace_id=w;
 PERFORM replace_meta_ad_snapshot(w,a,'Test A','2000-01-04','2000-01-04','IDR','Asia/Jakarta','[]');
 IF (SELECT revision FROM meta_ad_report_versions WHERE workspace_id=w)<=v THEN RAISE EXCEPTION 'Zero-delivery sync did not invalidate cache'; END IF;
 SELECT revision INTO v FROM meta_ad_report_versions WHERE workspace_id=w;
 UPDATE meta_ad_verified_destinations SET landing_page_url='https://example.com/shared' WHERE workspace_id=w AND account_id=a AND ad_id='999999990003';
 IF (SELECT revision FROM meta_ad_report_versions WHERE workspace_id=w)<=v THEN RAISE EXCEPTION 'Verified URL changes did not invalidate cache'; END IF;
 SELECT revision INTO v FROM meta_ad_report_versions WHERE workspace_id=w;
 BEGIN
  PERFORM replace_meta_ad_snapshot(w,a,'Test','2000-01-01','2000-01-01','IDR','Asia/Jakarta','[{"ad_id":"1","ad_name":"Bad","metric_date":"2000-01-02","metrics":{},"raw_insights":{}}]');
  RAISE EXCEPTION 'Invalid snapshot was accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='Invalid snapshot was accepted' THEN RAISE; END IF;
 END;
 IF (SELECT revision FROM meta_ad_report_versions WHERE workspace_id=w)<>v THEN RAISE EXCEPTION 'Failed sync invalidated cache despite rollback'; END IF;
 -- Every report input can be changed by an independent CLI worker or admin.
 SELECT revision INTO v FROM meta_ad_report_versions WHERE workspace_id=w;
 UPDATE meta_ad_mappings SET ad_name=ad_name WHERE workspace_id=w AND account_id=a AND ad_id='999999990001';
 IF (SELECT revision FROM meta_ad_report_versions WHERE workspace_id=w)<=v THEN RAISE EXCEPTION 'Mapping changes did not invalidate cache'; END IF;
 SELECT revision INTO v FROM meta_ad_report_versions WHERE workspace_id=w;
 UPDATE meta_ad_creatives SET name=name WHERE workspace_id=w AND account_id=a AND ad_id='999999990001';
 IF (SELECT revision FROM meta_ad_report_versions WHERE workspace_id=w)<=v THEN RAISE EXCEPTION 'Creative changes did not invalidate cache'; END IF;
 SELECT revision INTO v FROM meta_ad_report_versions WHERE workspace_id=w;
 UPDATE meta_ad_accounts SET default_brand_id=default_brand_id WHERE workspace_id=w AND account_id=a;
 IF (SELECT revision FROM meta_ad_report_versions WHERE workspace_id=w)<=v THEN RAISE EXCEPTION 'Account brand changes did not invalidate cache'; END IF;
 SELECT revision INTO v FROM meta_ad_report_versions WHERE workspace_id=w;
 UPDATE brands SET name=name WHERE workspace_id=w;
 IF (SELECT revision FROM meta_ad_report_versions WHERE workspace_id=w)<=v THEN RAISE EXCEPTION 'Brand changes did not invalidate cache'; END IF;
 SELECT revision INTO v FROM meta_ad_report_versions WHERE workspace_id=w;
 UPDATE brands SET name=name WHERE workspace_id<>w;
 IF (SELECT revision FROM meta_ad_report_versions WHERE workspace_id=w)<>v THEN RAISE EXCEPTION 'Other workspace invalidated this cache'; END IF;
 IF has_function_privilege('anon','public.get_meta_ad_report(uuid,date,date,jsonb,jsonb,text,text,text,text,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.get_meta_ad_report(uuid,date,date,jsonb,jsonb,text,text,text,text,text)','EXECUTE')
 OR has_table_privilege('authenticated','meta_ad_report_versions','SELECT') THEN RAISE EXCEPTION 'Report bypasses server authorization'; END IF;
END $$;

CREATE TEMP TABLE report_test_cases(name text,params jsonb);
WITH scope AS (SELECT jsonb_agg(account_id ORDER BY n) ids FROM report_test_scope), brand AS (SELECT a.default_brand_id::text id FROM meta_ad_accounts a JOIN report_test_scope s USING(workspace_id,account_id) WHERE s.n=1)
INSERT INTO report_test_cases
SELECT x.name,jsonb_build_object('from',x.f,'to',x.t,'config',jsonb_build_object('account_ids',CASE WHEN x.name='zero delivery' THEN jsonb_build_array((SELECT account_id FROM report_test_scope WHERE n=1)) ELSE scope.ids END,'name_filter',x.name_filter,'match',x.match),
 'brandId',CASE WHEN x.brand THEN brand.id ELSE NULL END,'filters',x.filters,'groupBy',x.g,'view',x.v,'period',x.period,'groupKey',x.group_key)
FROM scope CROSS JOIN brand CROSS JOIN (VALUES
 ('landing pages','landing_page','overview','week',false,'{}'::jsonb,'','contains',NULL::text,'2000-01-02','2000-01-03'),
 ('per ad','ad','overview','week',false,'{}'::jsonb,'','contains',NULL,'2000-01-02','2000-01-03'),
 ('CEP by intention','cep_intention','overview','week',true,'{}'::jsonb,'','contains',NULL,'2000-01-02','2000-01-03'),
 ('CEP across accounts','cep_intention','overview','week',false,'{}'::jsonb,'','contains',NULL,'2000-01-02','2000-01-03'),
 ('CEP dimension filter','cep_intention','overview','week',true,'{"cep":"bone","intention":"cons","objective":"OUTCOME_SALES"}'::jsonb,'','contains',NULL,'2000-01-02','2000-01-03'),
 ('CEP unknown group','cep_intention','overview','week',false,'{"cep":"__unknown__"}'::jsonb,'','contains',NULL,'2000-01-02','2000-01-03'),
 ('CEP focused daily','cep_intention','daily','week',true,'{}'::jsonb,'','contains','cep:bone:cons','2000-01-02','2000-01-03'),
 ('CEP weekly history','cep_intention','trends','week',true,'{}'::jsonb,'','contains','cep:bone:cons','2000-01-02','2000-01-03'),
 ('CEP free-form tags','cep_intention','daily','week',false,'{"cep":"new:cep%","intention":"new:intention%"}'::jsonb,'','contains','cep:new%3Acep%25:new%3Aintention%25','2000-01-02','2000-01-03'),
 ('brand and dimensions','landing_page','overview','week',true,'{"cep":"bone","intention":"cons","objective":"OUTCOME_SALES"}'::jsonb,'','contains',NULL,'2000-01-02','2000-01-03'),
 ('unknown CEP','ad','overview','week',false,'{"cep":"__unknown__"}'::jsonb,'','contains',NULL,'2000-01-02','2000-01-03'),
 ('literal name','ad','overview','week',false,'{}'::jsonb,'[sendi][cons] Same','exact',NULL,'2000-01-02','2000-01-03'),
 ('empty selection','landing_page','overview','week',false,'{}'::jsonb,'no such name','contains',NULL,'2000-01-02','2000-01-03'),
 ('zero delivery','landing_page','overview','week',false,'{}'::jsonb,'','contains',NULL,'2000-01-04','2000-01-04'),
 ('daily','landing_page','daily','week',false,'{}'::jsonb,'','contains',NULL,'2000-01-02','2000-01-03'),
 ('weekly','landing_page','trends','week',false,'{}'::jsonb,'','contains',NULL,'2000-01-02','2000-01-03'),
 ('monthly','landing_page','trends','month',false,'{}'::jsonb,'','contains',NULL,'2000-01-02','2000-01-03'),
 ('focused history','landing_page','daily','week',true,'{}'::jsonb,'','contains','landing:https://example.com/shared','2000-01-02','2000-01-03'),
 ('creative details','landing_page','creatives','week',true,'{}'::jsonb,'','contains','landing:https://example.com/shared','2000-01-02','2000-01-03'),
 ('multi URL key','landing_page','creatives','week',false,'{}'::jsonb,'','contains','landing:multi:["https://example.com/a","https://example.com/b"]','2000-01-02','2000-01-03')
 ) x(name,g,v,period,brand,filters,name_filter,match,group_key,f,t);

SELECT jsonb_build_object(
 'accounts',(SELECT jsonb_agg(to_jsonb(a)) FROM (SELECT a.account_id,a.account_name,a.default_brand_id FROM meta_ad_accounts a JOIN report_test_scope s USING(workspace_id,account_id) ORDER BY a.account_id) a),
 'brands',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) FROM brands WHERE workspace_id=(SELECT workspace_id FROM report_test_scope LIMIT 1)),
 'facts',(SELECT jsonb_agg(to_jsonb(f) ORDER BY metric_date,account_id,ad_id) FROM (SELECT f.account_id,f.account_name,f.ad_id,f.ad_name,f.creative_id,f.metric_date,f.currency,f.metrics,f.landing_page_urls,f.campaign_id,f.campaign_objective FROM meta_ad_daily_metrics f JOIN report_test_scope s USING(workspace_id,account_id) WHERE f.metric_date BETWEEN '1999-10-01' AND '2000-01-04') f),
 'mappings',(SELECT jsonb_agg(to_jsonb(m) ORDER BY account_id,ad_id) FROM (SELECT m.account_id,m.ad_id,m.cep_key,m.intention_key,m.campaign_id,m.campaign_objective FROM meta_ad_mappings m JOIN report_test_scope s USING(workspace_id,account_id)) m),
 'creatives',(SELECT jsonb_agg(to_jsonb(c) ORDER BY account_id,ad_id) FROM (SELECT c.account_id,c.ad_id,c.creative_id,c.name,c.thumbnail_url,c.video_id,c.body,c.landing_page_urls FROM meta_ad_creatives c JOIN report_test_scope s USING(workspace_id,account_id)) c),
 'verified',(SELECT jsonb_agg(to_jsonb(v)) FROM (SELECT v.account_id,v.ad_id,v.creative_id,v.landing_page_url FROM meta_ad_verified_destinations v JOIN report_test_scope s USING(workspace_id,account_id)) v),
 'coverage',(SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT c.account_id,c.metric_date FROM meta_ad_sync_coverage c JOIN report_test_scope s USING(workspace_id,account_id) WHERE c.metric_date BETWEEN '1999-10-01' AND '2000-01-04') c),
 'cases',(SELECT jsonb_agg(jsonb_build_object('name',name,'params',params,'raw',get_meta_ad_report((SELECT workspace_id FROM report_test_scope LIMIT 1),(params->>'from')::date,(params->>'to')::date,params->'config',params->'filters',params->>'brandId',params->>'groupBy',params->>'view',params->>'period',params->>'groupKey'))) FROM report_test_cases),
 'otherWorkspace',get_meta_ad_report((SELECT id FROM workspaces WHERE id<>(SELECT workspace_id FROM report_test_scope LIMIT 1) LIMIT 1),'2000-01-02','2000-01-03')
);
ROLLBACK;
