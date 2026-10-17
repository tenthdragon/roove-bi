BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='roove_local') THEN RAISE EXCEPTION 'local database required'; END IF; END $$;
CREATE TEMP TABLE proof_scope AS SELECT m.workspace_id,m.account_id FROM meta_ad_mappings m JOIN meta_ad_accounts a USING(workspace_id,account_id) WHERE a.is_active LIMIT 1;
INSERT INTO meta_ad_mappings(workspace_id,account_id,ad_id,ad_name,creative_id,landing_page_urls,auto_mapping,source,fingerprint)
SELECT workspace_id,account_id,'999999971001','Destination cache test','999999971002','[]','{"tags":[],"keywords":[],"issues":[],"free_text":"test"}','inventory','destination-cache-test' FROM proof_scope;
INSERT INTO meta_ad_destination_metadata(workspace_id,account_id,ad_id,creative_id,adset_id,metadata,classification,evidence,observed_at)
SELECT workspace_id,account_id,'999999971001','999999971002','999999971003','{"version":1,"urls":[],"product_set_ids":[],"application_ids":[],"android_packages":[],"ios_app_ids":[]}','unknown','[]',now() FROM proof_scope;
INSERT INTO meta_ad_destination_resolutions(workspace_id,account_id,ad_id,creative_id,adset_id,kind,source,urls,proof,observed_at)
SELECT workspace_id,account_id,'999999971001','999999971002','999999971003','website','meta_ad_preview','["https://roove.co.id/osteoporosis"]','{"cta_label":"Learn more"}',now() FROM proof_scope;
INSERT INTO meta_ad_daily_metrics(workspace_id,account_id,account_name,ad_id,ad_name,creative_id,metric_date,currency,metrics,raw_insights,landing_page_urls)
SELECT workspace_id,account_id,'Destination test','999999971001','Destination cache test','999999971002','1997-01-01','IDR','{"spend":100,"impressions":1000}','{"adset_id":"999999971003"}','[]' FROM proof_scope;
DO $$ DECLARE d meta_ad_destination_metadata; report jsonb; BEGIN
 SELECT * INTO d FROM meta_ad_destination_metadata WHERE ad_id='999999971001';
 IF d.metadata->'urls'<>'["https://roove.co.id/osteoporosis"]'::jsonb THEN RAISE EXCEPTION 'Proof not applied'; END IF;
 IF meta_ad_channel_bucket(d.classification,d.evidence,d.metadata,d.creative_id,d.creative_id,d.adset_id)<>'non_cpas' THEN RAISE EXCEPTION 'Website not grouped'; END IF;
 report:=get_meta_ad_report(d.workspace_id,'1997-01-01','1997-01-01',jsonb_build_object('account_ids',jsonb_build_array(d.account_id)),'{"channel":"non_cpas"}');
 IF jsonb_array_length(report->'groups')<>1 OR report->'groups'->0->>'key'<>'landing:https://roove.co.id/osteoporosis' OR (report->'summary'->>'spend')::numeric<>100 THEN RAISE EXCEPTION 'Cached destination not used by report: %',report; END IF;
 -- An opaque sync observation must reuse the existing proof.
 UPDATE meta_ad_destination_metadata SET metadata='{"urls":[],"product_set_ids":[]}',classification='unknown',evidence='[]' WHERE ad_id=d.ad_id;
 SELECT * INTO d FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id;
 IF d.metadata->'urls'<>'["https://roove.co.id/osteoporosis"]'::jsonb THEN RAISE EXCEPTION 'Opaque sync erased proof'; END IF;
 -- Current structured URL takes precedence over an older cached destination.
 UPDATE meta_ad_destination_metadata SET metadata='{"urls":["https://roove.co.id/new"]}' WHERE ad_id=d.ad_id;
 IF (SELECT metadata->'urls' FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id)<>'["https://roove.co.id/new"]'::jsonb THEN RAISE EXCEPTION 'Current URL replaced by cache'; END IF;
 -- Native structured URLs need their positive proof marker too.
 UPDATE meta_ad_destination_resolutions SET kind='native_profile',source='meta_creative_cta',urls='["https://www.instagram.com/roove.co.id"]' WHERE ad_id=d.ad_id;
 UPDATE meta_ad_destination_metadata SET metadata='{"urls":["https://www.instagram.com/roove.co.id"]}' WHERE ad_id=d.ad_id;
 SELECT * INTO d FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id;
 IF d.metadata->'destination_resolution'->>'kind' IS DISTINCT FROM 'native_profile' THEN RAISE EXCEPTION 'Structured native proof not attached'; END IF;
 IF meta_ad_channel_bucket(d.classification,d.evidence,d.metadata,d.creative_id,d.creative_id,d.adset_id)<>'non_cpas' THEN RAISE EXCEPTION 'Native profile not grouped'; END IF;
 UPDATE meta_ad_destination_resolutions SET kind='website',source='meta_ad_preview',urls='["https://roove.co.id/osteoporosis"]' WHERE ad_id=d.ad_id;
 -- Identity changes cannot inherit the destination cache.
 UPDATE meta_ad_destination_metadata SET creative_id='999999971004',metadata='{"urls":[]}' WHERE ad_id=d.ad_id;
 IF (SELECT metadata->'urls' FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id)<>'[]'::jsonb THEN RAISE EXCEPTION 'Stale creative cache leaked'; END IF;
 report:=get_meta_ad_report(d.workspace_id,'1997-01-01','1997-01-01',jsonb_build_object('account_ids',jsonb_build_array(d.account_id)),'{"channel":"unknown"}');
 IF report->'groups'->0->>'key' IS DISTINCT FROM 'landing:unknown' THEN RAISE EXCEPTION 'Stale cached URL leaked to a historical fact'; END IF;
 UPDATE meta_ad_destination_metadata SET creative_id=d.creative_id,adset_id='999999971005',metadata='{"urls":[]}' WHERE ad_id=d.ad_id;
 IF (SELECT metadata->'urls' FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id)<>'[]'::jsonb THEN RAISE EXCEPTION 'Stale adset cache leaked'; END IF;
 -- Verified catalog remains CPAS despite a cached brand website.
 UPDATE meta_ad_destination_metadata SET adset_id=d.adset_id,metadata='{"urls":[],"product_set_ids":["123"]}',classification='cpas',evidence='[{"type":"verified_product_set_id","value":"123"}]' WHERE ad_id=d.ad_id;
 SELECT * INTO d FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id;
 IF meta_ad_channel_bucket(d.classification,d.evidence,d.metadata,d.creative_id,d.creative_id,d.adset_id)<>'cpas' THEN RAISE EXCEPTION 'Cached website overrides catalog'; END IF;
 -- An owner-confirmed RTI catalog is non-CPAS, including when broken/empty.
 UPDATE meta_ad_destination_resolutions SET kind='non_shopee_catalog',source='user_catalog_confirmation',urls='["https://roove.co.id/osteoporosis"]',proof='{"product_set_ids":["123"],"catalog_owner":"RTI"}' WHERE ad_id=d.ad_id;
 UPDATE meta_ad_destination_metadata SET metadata='{"urls":[],"product_set_ids":["123"]}',classification='unknown',evidence='[]' WHERE ad_id=d.ad_id;
 SELECT * INTO d FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id;
 IF meta_ad_channel_bucket(d.classification,d.evidence,d.metadata,d.creative_id,d.creative_id,d.adset_id)<>'non_cpas' THEN RAISE EXCEPTION 'Confirmed RTI catalog remains unclassified'; END IF;
 UPDATE meta_ad_destination_metadata SET metadata='{"urls":["https://roove.co.id/new"],"product_set_ids":["123"]}' WHERE ad_id=d.ad_id;
 SELECT * INTO d FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id;
 IF d.metadata->'urls'<>'["https://roove.co.id/new"]'::jsonb OR meta_ad_channel_bucket(d.classification,d.evidence,d.metadata,d.creative_id,d.creative_id,d.adset_id)<>'non_cpas' THEN RAISE EXCEPTION 'Catalog proof did not survive a website URL change'; END IF;
 UPDATE meta_ad_destination_metadata SET metadata='{"urls":[],"product_set_ids":["123","456"]}' WHERE ad_id=d.ad_id;
 SELECT * INTO d FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id;
 IF meta_ad_channel_bucket(d.classification,d.evidence,d.metadata,d.creative_id,d.creative_id,d.adset_id)<>'unknown' THEN RAISE EXCEPTION 'Unidentified new catalog inherited RTI proof'; END IF;
 -- A Shopee URL always takes precedence over non-Shopee catalog ownership.
 UPDATE meta_ad_destination_metadata SET metadata='{"urls":["https://shopee.co.id/shop"],"product_set_ids":["123"]}',classification='unknown',evidence='[]' WHERE ad_id=d.ad_id;
 SELECT * INTO d FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id;
 IF d.classification<>'cpas' OR meta_ad_channel_bucket(d.classification,d.evidence,d.metadata,d.creative_id,d.creative_id,d.adset_id)<>'cpas' THEN RAISE EXCEPTION 'Shopee URL lost to RTI proof'; END IF;
 UPDATE meta_ad_destination_metadata SET metadata='{"urls":[],"product_set_ids":["123"]}',classification='cpas',evidence='[{"type":"verified_product_set_id","value":"123"}]' WHERE ad_id=d.ad_id;
 SELECT * INTO d FROM meta_ad_destination_metadata WHERE ad_id=d.ad_id;
 IF meta_ad_channel_bucket(d.classification,d.evidence,d.metadata,d.creative_id,d.creative_id,d.adset_id)<>'cpas' THEN RAISE EXCEPTION 'Verified Shopee catalog lost priority'; END IF;
 IF meta_ad_channel_bucket('unknown','[]','{"product_set_ids":["123"],"destination_resolution":{"kind":"non_shopee_catalog","creative_id":"1","adset_id":"2","non_shopee_product_set_ids":["123"]}}','1','1','2')<>'non_cpas' THEN RAISE EXCEPTION 'Confirmed non-Shopee catalog requires no URL'; END IF;
 -- Native evidence is scoped, and cannot defeat an unidentified catalog.
 IF meta_ad_channel_bucket('unknown','[]',jsonb_build_object('destination_resolution',jsonb_build_object('kind','native_profile','creative_id','1','adset_id','2')),'1','1','2')<>'non_cpas' THEN RAISE EXCEPTION 'Native proof not grouped'; END IF;
 IF meta_ad_channel_bucket('unknown','[]',jsonb_build_object('product_set_ids',jsonb_build_array('3'),'destination_resolution',jsonb_build_object('kind','native_profile','creative_id','1','adset_id','2')),'1','1','2')<>'unknown' THEN RAISE EXCEPTION 'Native proof defeats catalog'; END IF;
 IF meta_ad_channel_bucket('unknown','[]',jsonb_build_object('destination_resolution',jsonb_build_object('kind','native_profile','creative_id','1','adset_id','2')),'1','1','9')<>'unknown' THEN RAISE EXCEPTION 'Native proof ignores adset identity'; END IF;
 IF has_table_privilege('anon','meta_ad_destination_resolutions','SELECT') OR has_table_privilege('authenticated','meta_ad_destination_resolutions','SELECT') THEN RAISE EXCEPTION 'Proof bypasses authorization'; END IF;
END $$;
SELECT 'PASS: durable destination proof, opaque sync, current URL precedence, creative/adset isolation, catalog priority and native proof';
ROLLBACK;
