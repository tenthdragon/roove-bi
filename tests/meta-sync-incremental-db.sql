BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='roove_local') THEN RAISE EXCEPTION 'Local clone required'; END IF; END $$;
-- MIGRATION
SET LOCAL ROLE service_role;
DO $$ DECLARE w uuid; a text; count_saved integer; before_fact text; BEGIN
 SELECT workspace_id,account_id INTO STRICT w,a FROM meta_ad_accounts ORDER BY workspace_id,account_id LIMIT 1;
 SELECT md5(string_agg(md5(to_jsonb(t)::text),',' ORDER BY workspace_id,account_id,ad_id,metric_date)) INTO before_fact FROM meta_ad_daily_metrics t;
 INSERT INTO meta_ad_mappings(workspace_id,account_id,ad_id,ad_name,creative_id,landing_page_urls,auto_mapping,source,fingerprint)
 VALUES(w,a,'99999997501','Metadata state test','99999997502','[]','{"tags":[],"keywords":[],"issues":[],"free_text":"test"}','inventory','metadata-test');
 INSERT INTO meta_ad_creatives(workspace_id,account_id,ad_id,creative_id,name,updated_at) VALUES(w,a,'99999997501','99999997502','Metadata state test','2000-01-02');
 INSERT INTO meta_ad_destination_metadata(workspace_id,account_id,ad_id,creative_id,adset_id,metadata,classification,evidence,observed_at)
 VALUES(w,a,'99999997501','99999997502','99999997503','{"contact_identity_checked":true,"urls":[],"product_set_ids":[]}','unknown','[]','2000-01-02');
 count_saved:=save_meta_ad_metadata_state(w,a,jsonb_build_array(jsonb_build_object('ad_id','99999997501','creative_id','99999997502','adset_id','99999997503','source_fingerprint',repeat('a',64),'source_updated_at','2000-01-01','adset_updated_at','2000-01-01')),'2000-01-02');
 IF count_saved<>1 THEN RAISE EXCEPTION 'Successful cache observation not certified'; END IF;
 count_saved:=save_meta_ad_metadata_state(w,a,jsonb_build_array(jsonb_build_object('ad_id','99999997501','creative_id','99999997502','adset_id','99999997599','source_fingerprint',repeat('b',64),'source_updated_at','2000-01-01','adset_updated_at','2000-01-01')),'2000-01-02');
 IF count_saved<>0 THEN RAISE EXCEPTION 'Wrong adset certified'; END IF;
 count_saved:=save_meta_ad_metadata_state(w,a,jsonb_build_array(jsonb_build_object('ad_id','99999997501','creative_id','99999997502','adset_id','99999997503','source_fingerprint',repeat('b',64),'source_updated_at','2000-01-01','adset_updated_at','2000-01-01')),'2000-01-01');
 IF count_saved<>0 OR (SELECT source_fingerprint FROM meta_ad_metadata_sync_state WHERE workspace_id=w AND account_id=a AND ad_id='99999997501')<>repeat('a',64) THEN RAISE EXCEPTION 'Older cache replaced newer certification'; END IF;
 count_saved:=save_meta_ad_metadata_state(w,a,jsonb_build_array(jsonb_build_object('ad_id','99999997501','creative_id','99999997502','adset_id','99999997503','source_fingerprint',repeat('b',64),'source_updated_at','2000-01-03','adset_updated_at','2000-01-01')),'2000-01-03');
 IF count_saved<>0 THEN RAISE EXCEPTION 'Provider version newer than observations certified'; END IF;
 IF before_fact IS DISTINCT FROM (SELECT md5(string_agg(md5(to_jsonb(t)::text),',' ORDER BY workspace_id,account_id,ad_id,metric_date)) FROM meta_ad_daily_metrics t) THEN RAISE EXCEPTION 'Historical facts changed'; END IF;
END $$;
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; other uuid:='00000000-0000-4000-8000-000000000002'; ids uuid[]; r jsonb; rejected boolean; BEGIN
 SELECT array_agg(gen_random_uuid()) INTO ids FROM generate_series(1,10);
 INSERT INTO sync_jobs(id,workspace_id,job_name,mode,route,status,payload,created_at,completed_at)
 VALUES(ids[1],w,'meta_sync','incremental','/dashboard/meta-funnels','success','{"meta_sync_bundle":true,"meta_bundle_enqueued":false}','2099-01-01','2099-01-01'),
 (ids[2],w,'meta_sync','ad_funnels','/dashboard/meta-funnels','success','{}','2099-01-01 00:00:01','2099-01-01 00:00:02'),
 (ids[3],w,'meta_sync','ad_mapping','/dashboard/meta-funnels','success','{}','2099-01-01 00:00:01','2099-01-01 00:00:03'),
 (ids[4],w,'meta_sync','ad_mapping_creatives','/dashboard/meta-funnels','queued','{}','2099-01-01 00:00:03',NULL),
 (ids[5],w,'meta_sync','meta_product_set_verify','/dashboard/meta-funnels','partial','{}','2099-01-01 00:00:04','2099-01-01 00:00:05'),
 (ids[6],w,'meta_sync','incremental','/dashboard/meta-funnels','success','{"meta_sync_bundle":true,"meta_bundle_enqueued":true}','2100-01-01','2100-01-01'),
 (ids[7],other,'meta_sync','ad_funnels','/dashboard/meta-funnels','success','{}','2099-01-01','2099-01-01'),
 (ids[8],w,'daily_ads_sync','cron','/api/meta-sync','success','{}','2099-01-01','2099-01-01'),
 (ids[9],w,'meta_sync','ad_mapping_creatives','/dashboard/meta-funnels','success',jsonb_build_object('meta_parent_job_id',ids[3]),'2099-01-01 00:00:03','2099-01-01 00:00:04');
 PERFORM complete_meta_sync_bundle(w,ids[1],ARRAY[ids[2],ids[3]],NULL);
 PERFORM link_meta_sync_jobs(w,ids[3],ARRAY[ids[4]]);
 PERFORM link_meta_sync_jobs(w,ids[4],ARRAY[ids[5]]);
 PERFORM link_meta_sync_jobs(w,ids[6],ARRAY[ids[5]]);
 PERFORM link_meta_sync_jobs(w,ids[1],ARRAY[ids[2]]);
 r:=get_meta_sync_job_tree(w,ARRAY[ids[1],ids[2],ids[3]]);
 IF jsonb_array_length(r)<>6 OR (SELECT count(DISTINCT j->>'id') FROM jsonb_array_elements(r) j)<>6 THEN RAISE EXCEPTION 'Missing or duplicated descendant batch: %',r; END IF;
 IF (SELECT payload->>'meta_bundle_enqueued' FROM sync_jobs WHERE id=ids[1])<>'true' THEN RAISE EXCEPTION 'Bundle preparation not finalized'; END IF;
 IF jsonb_array_length(get_meta_sync_job_tree(w,NULL))<>2 THEN RAISE EXCEPTION 'Latest bundle or reused job not tracked'; END IF;
 IF jsonb_array_length(get_meta_sync_job_tree(other,ARRAY[ids[1]]))<>0 THEN RAISE EXCEPTION 'Cross-workspace progress leakage'; END IF;
 rejected:=false; BEGIN PERFORM link_meta_sync_jobs(w,ids[1],ARRAY[ids[7]]); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Cross-workspace edge accepted'; END IF;
 rejected:=false; BEGIN PERFORM link_meta_sync_jobs(w,ids[1],ARRAY[ids[8]]); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Other provider job accepted'; END IF;
 rejected:=false; BEGIN PERFORM link_meta_sync_jobs(w,ids[5],ARRAY[ids[1]]); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Cyclic progress accepted'; END IF;
 IF has_function_privilege('authenticated','public.get_meta_sync_job_tree(uuid,uuid[])','EXECUTE') OR has_table_privilege('authenticated','public.meta_ad_metadata_sync_state','SELECT') THEN RAISE EXCEPTION 'Browser access expanded'; END IF;
END $$;
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; ids uuid[]; r jsonb; BEGIN
 SELECT array_agg(gen_random_uuid()) INTO ids FROM generate_series(1,5);
 INSERT INTO sync_jobs(id,workspace_id,job_name,mode,route,status,payload,created_at,completed_at) VALUES
 (ids[1],w,'meta_sync','cron','/api/meta-sync','success','{}','1994-01-01','1994-01-01'),
 (ids[2],w,'meta_sync','ad_funnels','/dashboard/meta-funnels','success','{}','1994-01-01 00:00:01','1994-01-01'),
 (ids[3],w,'meta_sync','ad_mapping_creatives','/dashboard/meta-funnels','success','{}','1994-01-01 03:00:00','1994-01-01'),
 (ids[4],w,'meta_sync','cron','/api/meta-sync','success','{}','1994-01-02','1994-01-02'),
 (ids[5],w,'meta_sync','meta_product_set_verify','/dashboard/meta-funnels','partial','{}','1994-01-02 03:00:00','1994-01-02');
 r:=get_meta_sync_job_tree(w,ARRAY[ids[1]]);
 IF jsonb_array_length(r)<>3 THEN RAISE EXCEPTION 'Legacy descendants not bounded by next run: %',r; END IF;
END $$;
DO $$ DECLARE w uuid; a text; r jsonb; before_fact jsonb; BEGIN
 SELECT workspace_id,account_id INTO w,a FROM meta_ad_mappings WHERE ad_id='99999997501' LIMIT 1;
 INSERT INTO meta_ad_daily_metrics(workspace_id,account_id,account_name,ad_id,ad_name,creative_id,metric_date,currency,metrics,raw_insights,landing_page_urls)
 VALUES(w,a,'Metadata fallback test','99999997501','Metadata fallback test',NULL,'1993-01-01','IDR','{"spend":100,"purchases":2}','{"adset_id":"99999997503"}','[]');
 SELECT to_jsonb(t) INTO before_fact FROM meta_ad_daily_metrics t WHERE workspace_id=w AND account_id=a AND ad_id='99999997501' AND metric_date='1993-01-01';
 UPDATE meta_ad_creatives SET landing_page_urls='["https://roove.co.id/new-metadata"]' WHERE workspace_id=w AND account_id=a AND ad_id='99999997501';
 r:=get_meta_ad_report(w,'1993-01-01','1993-01-01',jsonb_build_object('account_ids',jsonb_build_array(a)));
 IF (r->'summary'->>'spend')::numeric<>100 OR jsonb_array_length(r->'groups')<>1 OR r->'groups'->0->>'key'<>'landing:https://roove.co.id/new-metadata' THEN RAISE EXCEPTION 'Deferred metadata did not resolve the snapshot'; END IF;
 IF before_fact IS DISTINCT FROM (SELECT to_jsonb(t) FROM meta_ad_daily_metrics t WHERE workspace_id=w AND account_id=a AND ad_id='99999997501' AND metric_date='1993-01-01') THEN RAISE EXCEPTION 'Enrichment mutated the performance snapshot'; END IF;
END $$;
SELECT 'PASS: cache identity/freshness certification, fact conservation, complete recursive batch counts, dedupe, scope/grants, cycle rejection and legacy compatibility';
ROLLBACK;
