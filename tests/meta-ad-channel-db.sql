-- Fixed local database runner only. All fixture writes roll back.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='roove_local') THEN RAISE EXCEPTION 'Local clone marker required'; END IF;
END $$;
-- Classification requires evidence, never a generic app, account name or catalog.
DO $$ DECLARE item record; got text; BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('catalog only','cpas','[]'::jsonb,'{"product_set_ids":["1"]}'::jsonb,'1','1',NULL::text,NULL::text,'cpas'),
  ('Shopee app','cpas','[]','{"application_ids":["957549474255294"]}','1','1',NULL,NULL,'cpas'),
  ('website','unknown','[]','{"urls":["https://roove.co.id/a"],"product_set_ids":[]}','1','1',NULL,NULL,'non_cpas'),
  ('message','unknown','[]','{"destination_type":"WHATSAPP"}','1','1',NULL,NULL,'non_cpas'),
  ('opaque catalog','unknown','[]','{"urls":["https://roove.co.id"],"product_set_ids":["1"]}','1','1',NULL,NULL,'unknown'),
  ('conflict','unknown','[{"type":"conflicting_website_url","value":"https://roove.co.id"}]','{"urls":["https://roove.co.id"]}','1','1',NULL,NULL,'unknown'),
  ('stale creative','cpas','[]','{}','1','2',NULL,NULL,'unknown'),
  ('stale adset','cpas','[]','{}','1','1','1','2','unknown'),
  ('missing creative','cpas','[]','{}','1',NULL,NULL,NULL,'unknown'),
  ('Canvas','unknown','[]','{"urls":["https://fb.com/canvas_doc/1"]}','1','1',NULL,NULL,'unknown'),
  ('generic app','unknown','[]','{"urls":["https://roove.co.id"],"destination_type":"APP"}','1','1',NULL,NULL,'unknown'),
  ('other app','unknown','[]','{"urls":["https://roove.co.id"],"application_ids":["123"]}','1','1',NULL,NULL,'unknown'),
  ('missing Shopee classification','unknown','[]','{"urls":["https://shopee.co.id/shop"]}','1','1',NULL,NULL,'unknown'),
  ('fake subdomain is a website','unknown','[]','{"urls":["https://shopee.co.id.example.com/a"]}','1','1',NULL,NULL,'non_cpas'),
  ('subdomain transit','unknown','[]','{"urls":["https://www.facebook.com/a"]}','1','1',NULL,NULL,'unknown'),
  ('no metadata',NULL,'[]',NULL,'1','1',NULL,NULL,'unknown')
 ) t(name,classification,evidence,metadata,observed_creative,expected_creative,observed_adset,expected_adset,expected) LOOP
  got:=public.meta_ad_channel_bucket(item.classification,item.evidence,item.metadata,item.observed_creative,item.expected_creative,item.observed_adset,item.expected_adset);
  IF got<>item.expected THEN RAISE EXCEPTION '%: expected %, got %',item.name,item.expected,got; END IF;
 END LOOP;
END $$;

CREATE TEMP TABLE channel_scope AS
SELECT workspace_id,account_id,row_number() OVER(ORDER BY account_id) AS n FROM meta_ad_accounts
WHERE workspace_id='00000000-0000-4000-8000-000000000001' AND is_active ORDER BY account_id LIMIT 2;
DO $$ BEGIN
 IF (SELECT count(*) FROM channel_scope)<>2 THEN RAISE EXCEPTION 'Two local accounts required'; END IF;
 IF EXISTS(SELECT 1 FROM meta_ad_daily_metrics WHERE metric_date BETWEEN '1998-01-01' AND '1998-01-02')
 OR EXISTS(SELECT 1 FROM meta_ad_mappings WHERE ad_id LIKE '9999999800%') THEN RAISE EXCEPTION 'Fixture collision'; END IF;
END $$;
UPDATE meta_ad_accounts a SET default_brand_id=CASE s.n WHEN 1 THEN (SELECT min(id) FROM brands WHERE workspace_id=s.workspace_id) ELSE (SELECT max(id) FROM brands WHERE workspace_id=s.workspace_id) END FROM channel_scope s WHERE a.workspace_id=s.workspace_id AND a.account_id=s.account_id;
CREATE TEMP TABLE channel_fixture(n int,account_n int,channel text,metadata jsonb,evidence jsonb,observed_creative text,expected_creative text);
INSERT INTO channel_fixture VALUES
 (1,1,'cpas','{"product_set_ids":["999999980001"]}','[]','1','1'),
 (2,2,'cpas','{"urls":["https://shopee.co.id/shop"]}','[]','2','2'),
 (3,1,'unknown','{"urls":["https://roove.co.id/a"]}','[]','3','3'),
 (4,2,'unknown','{"destination_type":"MESSENGER"}','[]','4','4'),
 (5,1,'unknown','{"product_set_ids":["999999980005"]}','[]','5','5'),
 (6,1,'unknown','{"urls":["https://roove.co.id/a"],"product_set_ids":["999999980001"]}','[{"type":"conflicting_website_url","value":"https://roove.co.id/a"}]','6','6'),
 (7,1,'cpas','{}','[]','7','77'),
 (8,1,'unknown','{"urls":["https://fb.com/canvas_doc/1"]}','[]','8','8');
INSERT INTO meta_ad_mappings(workspace_id,account_id,ad_id,ad_name,creative_id,landing_page_urls,auto_mapping,source,fingerprint)
SELECT s.workspace_id,s.account_id,'99999998000'||f.n,'[joint][cons] Channel test '||f.n,f.expected_creative,'["https://same.test/"]','{"tags":[],"keywords":[],"issues":[],"free_text":"test"}','inventory','channel-test-'||f.n FROM channel_fixture f JOIN channel_scope s ON s.n=f.account_n;
INSERT INTO meta_ad_creatives(workspace_id,account_id,ad_id,creative_id,name,landing_page_urls)
SELECT workspace_id,account_id,ad_id,creative_id,ad_name,landing_page_urls FROM meta_ad_mappings WHERE ad_id LIKE '9999999800%';
INSERT INTO meta_ad_destination_metadata(workspace_id,account_id,ad_id,creative_id,adset_id,metadata,classification,evidence,observed_at)
SELECT s.workspace_id,s.account_id,'99999998000'||f.n,f.observed_creative,'1',f.metadata,f.channel,f.evidence,now() FROM channel_fixture f JOIN channel_scope s ON s.n=f.account_n;
INSERT INTO meta_ad_daily_metrics(workspace_id,account_id,account_name,ad_id,ad_name,creative_id,metric_date,currency,metrics,raw_insights,landing_page_urls)
SELECT s.workspace_id,s.account_id,'Channel account '||s.n,m.ad_id,m.ad_name,
 CASE WHEN f.n=4 THEN NULL ELSE f.expected_creative END,day,'IDR',jsonb_build_object('spend',f.n*10,'impressions',f.n*100,'purchases',f.n),'{"adset_id":"1","objective":"OUTCOME_SALES"}',m.landing_page_urls
FROM channel_fixture f JOIN channel_scope s ON s.n=f.account_n JOIN meta_ad_mappings m ON m.workspace_id=s.workspace_id AND m.account_id=s.account_id AND m.ad_id='99999998000'||f.n
CROSS JOIN (VALUES('1998-01-01'::date),('1998-01-02'::date)) days(day);
INSERT INTO meta_ad_sync_coverage(workspace_id,account_id,metric_date,currency,timezone_name)
SELECT workspace_id,account_id,day,'IDR','Asia/Jakarta' FROM channel_scope CROSS JOIN (VALUES('1998-01-01'::date),('1998-01-02'::date)) days(day);
DO $$ DECLARE w uuid; config jsonb; channel text; report jsonb; legacy jsonb; history jsonb; detail jsonb; brand text; v bigint; combined numeric:=0; expected numeric; BEGIN
 SELECT min(workspace_id::text)::uuid,jsonb_build_object('account_ids',jsonb_agg(account_id)) INTO w,config FROM channel_scope;
 legacy:=get_meta_ad_report(w,'1998-01-02','1998-01-02',config);
 IF (legacy->'summary'->>'spend')::numeric<>360 THEN RAISE EXCEPTION 'Unexpected fixture totals'; END IF;
 FOREACH channel IN ARRAY ARRAY['cpas','non_cpas','unknown'] LOOP
  expected:=CASE channel WHEN 'cpas' THEN 30 WHEN 'non_cpas' THEN 70 ELSE 260 END;
  report:=get_meta_ad_report(w,'1998-01-02','1998-01-02',config,jsonb_build_object('channel',channel));
  IF (report->'summary'->>'spend')::numeric<>expected OR (report->'previous'->>'spend')::numeric<>expected THEN RAISE EXCEPTION '% summary mixes channels: %',channel,report; END IF;
  combined:=combined+(report->'summary'->>'spend')::numeric;
  IF jsonb_array_length(report->'groups')<>1 OR (report->'groups'->0->'current'->>'spend')::numeric<>expected THEN RAISE EXCEPTION 'Shared landing page mixes channels'; END IF;
  IF (report->>'matchingAds')::int<>(CASE channel WHEN 'unknown' THEN 4 ELSE 2 END) THEN RAISE EXCEPTION 'Channel ad count mismatch'; END IF;
  IF report->'channelCounts'<>'{"cpas":2,"non_cpas":2,"unknown":4}'::jsonb THEN RAISE EXCEPTION 'Picker counts are filtered by selected channel'; END IF;
  IF (SELECT sum(value::text::numeric) FROM jsonb_each(report->'brandCounts'))<>(CASE channel WHEN 'unknown' THEN 4 ELSE 2 END) THEN RAISE EXCEPTION 'Brand counts mix channels'; END IF;
  IF (report->'facetTotals'->>'objective')::int<>(CASE channel WHEN 'unknown' THEN 4 ELSE 2 END) THEN RAISE EXCEPTION 'Facets mix channels'; END IF;
  history:=get_meta_ad_report(w,'1998-01-02','1998-01-02',config,jsonb_build_object('channel',channel),NULL,'landing_page','daily','week','landing:https://same.test/');
  IF (history->'history'->1->'totals'->>'spend')::numeric<>expected THEN RAISE EXCEPTION 'History mixes channels'; END IF;
  history:=get_meta_ad_report(w,'1998-01-02','1998-01-02',config,jsonb_build_object('channel',channel),NULL,'landing_page','trends');
  IF (SELECT sum((p->'totals'->>'spend')::numeric) FROM jsonb_array_elements(history->'history') p)<>expected*2 THEN RAISE EXCEPTION 'Trends mix channels'; END IF;
  detail:=get_meta_ad_report(w,'1998-01-02','1998-01-02',config,jsonb_build_object('channel',channel),NULL,'landing_page','creatives','week','landing:https://same.test/');
  IF jsonb_array_length(detail->'creatives')<>(CASE channel WHEN 'unknown' THEN 4 ELSE 2 END) THEN RAISE EXCEPTION 'Creative details mix channels'; END IF;
  SELECT a.default_brand_id::text INTO brand FROM meta_ad_accounts a JOIN channel_scope s USING(workspace_id,account_id) WHERE s.n=1;
  report:=get_meta_ad_report(w,'1998-01-02','1998-01-02',config,jsonb_build_object('channel',channel),brand);
  IF (report->'summary'->>'spend')::numeric<>(CASE channel WHEN 'cpas' THEN 10 WHEN 'non_cpas' THEN 30 ELSE 260 END) THEN RAISE EXCEPTION 'Brand totals mix channels'; END IF;
 END LOOP;
 IF combined<>(legacy->'summary'->>'spend')::numeric THEN RAISE EXCEPTION 'Channels do not reconcile'; END IF;
 IF (SELECT count(*) FROM meta_ad_mapping_channels WHERE workspace_id=w AND ad_id LIKE '9999999800%' AND ad_channel='non_cpas')<>2 THEN RAISE EXCEPTION 'Mapping view does not use same grouping'; END IF;
 IF EXISTS(SELECT 1 FROM meta_ad_mapping_channels WHERE workspace_id=w AND ad_id='999999980007' AND ad_channel<>'unknown') THEN RAISE EXCEPTION 'Stale metadata leaked into classification'; END IF;
 -- Workspace/account isolation and invalid RPC channel inputs fail closed.
 report:=get_meta_ad_report((SELECT id FROM workspaces WHERE id<>w LIMIT 1),'1998-01-02','1998-01-02',config,'{"channel":"cpas"}');
 IF (report->>'matchingAds')::int<>0 THEN RAISE EXCEPTION 'Cross-workspace leak'; END IF;
 BEGIN PERFORM get_meta_ad_report(w,'1998-01-02','1998-01-02',config,'{"channel":"all"}'); RAISE EXCEPTION 'Bad channel accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='Bad channel accepted' THEN RAISE; END IF; END;
 SELECT revision INTO v FROM meta_ad_report_versions WHERE workspace_id=w;
 UPDATE meta_ad_destination_metadata SET observed_at=now() WHERE workspace_id=w AND ad_id='999999980001';
 IF (SELECT revision FROM meta_ad_report_versions WHERE workspace_id=w)<=v THEN RAISE EXCEPTION 'Metadata does not invalidate report cache'; END IF;
 SELECT revision INTO v FROM meta_ad_report_versions WHERE workspace_id=w;
 INSERT INTO meta_shopee_product_sets(workspace_id,account_id,product_set_id,verification) SELECT workspace_id,account_id,'999999980001','{"complete":true}' FROM channel_scope WHERE n=1;
 IF (SELECT revision FROM meta_ad_report_versions WHERE workspace_id=w)<=v THEN RAISE EXCEPTION 'Registry does not invalidate report cache'; END IF;
 IF has_table_privilege('authenticated','meta_ad_mapping_channels','SELECT') OR has_table_privilege('anon','meta_ad_mapping_channels','SELECT') OR has_function_privilege('anon','meta_ad_channel_bucket(text,jsonb,jsonb,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Channel data bypasses server authorization'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='meta_ad_mapping_channels'::regclass AND reloptions @> ARRAY['security_invoker=true']) THEN RAISE EXCEPTION 'View bypasses RLS'; END IF;
END $$;
SELECT 'PASS: CPAS evidence, shared URL isolation, summaries, brand/facet counts, history, creative details, fallback identities, cache invalidation and grants';
ROLLBACK;
