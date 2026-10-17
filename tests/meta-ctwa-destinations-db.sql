BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='roove_local') THEN RAISE EXCEPTION 'Local clone required'; END IF; END $$;
-- The runner installs 213 inside this transaction, then rolls everything back.
-- MIGRATION
SET LOCAL ROLE service_role;
CREATE TEMP TABLE ctwa_scope AS SELECT workspace_id,account_id,row_number() OVER(ORDER BY account_id) AS n FROM meta_ad_accounts
 WHERE workspace_id='00000000-0000-4000-8000-000000000001' AND is_active ORDER BY account_id LIMIT 3;
DO $$ BEGIN
 IF (SELECT count(*) FROM ctwa_scope)<>3 THEN RAISE EXCEPTION 'Three local accounts required'; END IF;
 IF EXISTS(SELECT 1 FROM meta_ad_daily_metrics WHERE metric_date BETWEEN '1996-01-01' AND '1996-01-02') THEN RAISE EXCEPTION 'Fixture date collision'; END IF;
END $$;
UPDATE meta_ad_accounts a SET default_brand_id=CASE WHEN s.n<3 THEN (SELECT min(id) FROM brands WHERE workspace_id=s.workspace_id) ELSE (SELECT max(id) FROM brands WHERE workspace_id=s.workspace_id) END FROM ctwa_scope s WHERE a.workspace_id=s.workspace_id AND a.account_id=s.account_id;
CREATE TEMP TABLE ctwa_fixture AS SELECT n,CASE n WHEN 2 THEN 2 WHEN 4 THEN 3 WHEN 6 THEN 2 ELSE 1 END AS account_n,
 '9999999730'||n::text AS ad_id,'9999999731'||n::text AS creative_id,'9999999732'||n::text AS adset_id,
 CASE WHEN n=7 THEN '[]'::jsonb WHEN n=9 THEN '["https://roove.co.id/test"]' ELSE '["https://api.whatsapp.com/send"]' END AS urls,
 CASE WHEN n IN(5,6,9) THEN '[]'::jsonb WHEN n=3 THEN '["+628222222222"]' WHEN n=8 THEN '["+628111111111","+628222222222"]' ELSE '["+628111111111"]' END AS phones
 FROM generate_series(1,13) n;
INSERT INTO meta_ad_mappings(workspace_id,account_id,ad_id,ad_name,creative_id,landing_page_urls,auto_mapping,source,fingerprint)
 SELECT s.workspace_id,s.account_id,f.ad_id,'CTWA fixture '||f.n,f.creative_id,f.urls,'{"tags":[],"keywords":[],"issues":[],"free_text":"test"}','inventory',f.ad_id FROM ctwa_fixture f JOIN ctwa_scope s ON s.n=f.account_n;
INSERT INTO meta_ad_creatives(workspace_id,account_id,ad_id,creative_id,name,landing_page_urls)
 SELECT s.workspace_id,s.account_id,f.ad_id,f.creative_id,'CTWA fixture '||f.n,f.urls FROM ctwa_fixture f JOIN ctwa_scope s ON s.n=f.account_n;
INSERT INTO meta_ad_destination_metadata(workspace_id,account_id,ad_id,creative_id,adset_id,metadata,classification,evidence,observed_at)
 SELECT s.workspace_id,s.account_id,f.ad_id,CASE WHEN f.n=11 THEN '999999973999' ELSE f.creative_id END,f.adset_id,
 jsonb_build_object('destination_type',CASE WHEN f.n<>9 THEN 'WHATSAPP' END,'urls',f.urls,'product_set_ids',CASE WHEN f.n=10 THEN '["999999973777"]'::jsonb ELSE '[]'::jsonb END,'contact_identity',jsonb_build_object(
  'version',1,'creative_id',CASE WHEN f.n=11 THEN '999999973999' ELSE f.creative_id END,'adset_id',f.adset_id,
  'page_id','123','page_ids',jsonb_build_array('123'),'page_sources','{"promoted":"123"}'::jsonb,'whatsapp_phone_numbers',f.phones,'whatsapp_sources','[]'::jsonb)),
 CASE WHEN f.n=10 THEN 'cpas' ELSE 'unknown' END,'[]',now() FROM ctwa_fixture f JOIN ctwa_scope s ON s.n=f.account_n;
INSERT INTO meta_ad_daily_metrics(workspace_id,account_id,account_name,ad_id,ad_name,creative_id,metric_date,currency,metrics,raw_insights,landing_page_urls)
 SELECT s.workspace_id,s.account_id,'CTWA account '||s.n,f.ad_id,'CTWA fixture '||f.n,CASE WHEN f.n=13 THEN '999999973998' ELSE f.creative_id END,day,'IDR',
 jsonb_build_object('spend',f.n*10,'impressions',f.n*100,'conversations',f.n),jsonb_build_object('adset_id',CASE WHEN f.n=12 THEN '999999973997' ELSE f.adset_id END),f.urls
 FROM ctwa_fixture f JOIN ctwa_scope s ON s.n=f.account_n CROSS JOIN (VALUES('1996-01-01'::date),('1996-01-02'::date)) dates(day);
INSERT INTO meta_ad_sync_coverage(workspace_id,account_id,metric_date,currency,timezone_name)
 SELECT s.workspace_id,s.account_id,day,'IDR','Asia/Jakarta' FROM ctwa_scope s CROSS JOIN (VALUES('1996-01-01'::date),('1996-01-02'::date)) dates(day);
DO $$ DECLARE w uuid; config jsonb; report jsonb; target_group jsonb; k text; a text; brand text; h jsonb; details jsonb; noncpas jsonb; other jsonb; BEGIN
 SELECT min(workspace_id::text)::uuid,jsonb_build_object('account_ids',jsonb_agg(account_id)) INTO w,config FROM ctwa_scope;
 SELECT s.account_id,b.default_brand_id::text INTO a,brand FROM ctwa_scope s JOIN meta_ad_accounts b USING(workspace_id,account_id) WHERE s.n=1;
 report:=get_meta_ad_report(w,'1996-01-02','1996-01-02',config);
 IF (report->'summary'->>'spend')::numeric<>910 OR (report->'previous'->>'spend')::numeric<>910 THEN RAISE EXCEPTION 'Report total changed'; END IF;
 IF (SELECT sum((value->'current'->>'spend')::numeric) FROM jsonb_array_elements(report->'groups'))<>910 THEN RAISE EXCEPTION 'Group totals duplicate or lose spend'; END IF;
 k:='ctwa:'||brand||':phone:+628111111111';
 SELECT value INTO STRICT target_group FROM jsonb_array_elements(report->'groups') WHERE value->>'key'=k;
 IF (target_group->'current'->>'spend')::numeric<>100 OR jsonb_array_length(target_group->'ad_ids')<>3 OR jsonb_array_length(target_group->'accounts')<>2 THEN RAISE EXCEPTION 'Same brand/phone not combined across accounts: %',target_group; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(report->'groups') g WHERE g->'destination'->>'phone_number'='+628111111111')<>2 THEN RAISE EXCEPTION 'Different brands mixed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'groups') g WHERE g->>'key'='ctwa:'||brand||':phone:+628222222222' AND (g->'current'->>'spend')::numeric=30) THEN RAISE EXCEPTION 'Different phone mixed'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(report->'groups') g WHERE g->'destination'->>'status'='missing')<>5 THEN RAISE EXCEPTION 'Missing phone scope or stale creative/adset mixed: %',report->'groups'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'groups') g WHERE g->'destination'->>'status'='multiple' AND (g->'current'->>'spend')::numeric=80) THEN RAISE EXCEPTION 'Multiple phone evidence split spend'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'groups') g WHERE g->>'key'='landing:https://roove.co.id/test' AND g->'destination'='null'::jsonb) THEN RAISE EXCEPTION 'Website behavior changed'; END IF;
 h:=get_meta_ad_report(w,'1996-01-02','1996-01-02',config,'{}',brand,'landing_page','daily','week',k);
 IF (h->'history'->1->'totals'->>'spend')::numeric<>100 THEN RAISE EXCEPTION 'CTWA daily drawer mixes destinations'; END IF;
 h:=get_meta_ad_report(w,'1996-01-02','1996-01-02',config,'{}',brand,'landing_page','trends','week',k);
 IF (SELECT sum((p->'totals'->>'spend')::numeric) FROM jsonb_array_elements(h->'history') p)<>200 THEN RAISE EXCEPTION 'CTWA trend mixes destinations'; END IF;
 details:=get_meta_ad_report(w,'1996-01-02','1996-01-02',config,'{}',brand,'landing_page','creatives','week',k);
 IF jsonb_array_length(details->'creatives')<>3 THEN RAISE EXCEPTION 'CTWA creative drawer mixes destinations'; END IF;
 h:=get_meta_ad_report(w,'1996-01-02','1996-01-02',config,'{}',brand);
 IF (h->'summary'->>'spend')::numeric<>870 THEN RAISE EXCEPTION 'Brand total mixes brands'; END IF;
 h:=get_meta_ad_report(w,'1996-01-02','1996-01-02',config,'{"channel":"cpas"}');
 IF (h->'summary'->>'spend')::numeric<>100 OR h->'groups'->0->'destination'<>'null'::jsonb THEN RAISE EXCEPTION 'CPAS priority lost'; END IF;
 noncpas:=get_meta_ad_report(w,'1996-01-02','1996-01-02',config,'{"channel":"non_cpas"}');
 IF (noncpas->'summary'->>'spend')::numeric<>450 THEN RAISE EXCEPTION 'Non-CPAS channel scope changed: %',noncpas->'summary'; END IF;
 IF (noncpas->'destinations'->>'missing_ads')::int<>0 THEN RAISE EXCEPTION 'CTWA with number but no URL counted as missing website URL'; END IF;
 other:=get_meta_ad_report('00000000-0000-4000-8000-000000000002','1996-01-02','1996-01-02',config);
 IF (other->>'matchingAds')::int<>0 THEN RAISE EXCEPTION 'Workspace isolation failed'; END IF;
 IF has_function_privilege('authenticated','public.meta_ctwa_destination(jsonb,jsonb,text,text,text)','EXECUTE') OR has_table_privilege('authenticated','public.meta_landing_page_templates','SELECT') THEN RAISE EXCEPTION 'Browser privileges expanded'; END IF;
END $$;
-- Shared template storage permits one template for multiple scoped destinations.
DO $$ DECLARE w uuid; creator uuid; fid uuid; brand text; BEGIN
 SELECT min(workspace_id::text)::uuid INTO w FROM ctwa_scope;
 SELECT id INTO STRICT creator FROM profiles WHERE role='owner' LIMIT 1;
 SELECT min(default_brand_id)::text INTO brand FROM meta_ad_accounts WHERE workspace_id=w;
 INSERT INTO meta_ad_funnels(workspace_id,config,created_by) VALUES(w,'{}',creator) RETURNING id INTO fid;
 INSERT INTO meta_landing_page_templates(workspace_id,funnel_id,match_kind,pattern,created_by) VALUES
  (w,fid,'ctwa','ctwa:'||brand||':phone:+628111111111',creator),
  (w,fid,'ctwa','ctwa:'||brand||':phone:+628222222222',creator);
 IF (SELECT count(*) FROM meta_landing_page_templates WHERE funnel_id=fid)<>2 THEN RAISE EXCEPTION 'Shared template assignments not stored'; END IF;
 BEGIN
  INSERT INTO meta_landing_page_templates(workspace_id,funnel_id,match_kind,pattern,created_by) VALUES(w,fid,'ctwa','ctwa:anything',creator);
  RAISE EXCEPTION 'Invalid destination accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
SELECT 'PASS: CTWA brand/phone aggregation, account merging, isolated unknowns, stale scope, CPAS priority, totals, trends, creatives, workspace isolation and RLS';
ROLLBACK;
