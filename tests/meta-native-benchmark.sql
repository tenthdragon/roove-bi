SET LOCAL statement_timeout='60s';
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; b text; config jsonb; t timestamptz;
 reference jsonb; candidate jsonb; kind text; attempt int; baseline_ms numeric; native_ms numeric; core_ms numeric; child_ms numeric;
BEGIN
 SELECT a.default_brand_id::text INTO b FROM meta_ad_daily_metrics f JOIN meta_ad_accounts a USING(workspace_id,account_id)
 WHERE f.workspace_id=w AND a.is_active AND f.metric_date BETWEEN '2026-10-01' AND '2026-10-28' GROUP BY a.default_brand_id ORDER BY count(*) DESC LIMIT 1;
 SELECT jsonb_build_object('account_ids',jsonb_agg(account_id),'include_analysis',true) INTO config FROM meta_ad_accounts WHERE workspace_id=w AND is_active AND default_brand_id::text=b;
 FOR attempt IN 1..3 LOOP
  t:=clock_timestamp(); reference:=pg_temp.meta_report_before_241(w,'2026-10-01','2026-10-28',config,'{"channel":"non_cpas"}',b);
  baseline_ms:=round(extract(epoch FROM clock_timestamp()-t)*1000,1);
  t:=clock_timestamp(); candidate:=get_meta_ad_report_incremental(w,'2026-10-01','2026-10-28',config,'{"channel":"non_cpas"}',b);
  native_ms:=round(extract(epoch FROM clock_timestamp()-t)*1000,1);
  IF reference IS DISTINCT FROM candidate THEN RAISE EXCEPTION 'Benchmark changed results'; END IF;
  t:=clock_timestamp(); PERFORM get_meta_brand_detail_report_light(w,'2026-10-01','2026-10-28',b,'non_cpas');
  core_ms:=round(extract(epoch FROM clock_timestamp()-t)*1000,1);
  t:=clock_timestamp(); PERFORM get_meta_ad_report_incremental(w,'2026-10-01','2026-10-28',config||'{"breakdown":"format","breakdown_only":true,"include_analysis":false}','{"channel":"non_cpas"}',b);
  child_ms:=round(extract(epoch FROM clock_timestamp()-t)*1000,1);
  RAISE NOTICE 'sample benchmark run=% website_before_ms=% website_all_after_ms=% full_core_batch_after_ms=% selected_format_ms=% identical=true',attempt,baseline_ms,native_ms,core_ms,child_ms;
 END LOOP;
END $$;
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; t timestamptz; old jsonb; fresh jsonb; old_ms numeric; new_ms numeric;
BEGIN
 t:=clock_timestamp();old:=pg_temp.meta_overview_before_241(w,'2026-10-01','2026-10-28');old_ms:=round(extract(epoch FROM clock_timestamp()-t)*1000,1);
 t:=clock_timestamp();fresh:=get_meta_brand_overview_report(w,'2026-10-01','2026-10-28');new_ms:=round(extract(epoch FROM clock_timestamp()-t)*1000,1);
 IF old IS DISTINCT FROM fresh THEN RAISE EXCEPTION 'Overview benchmark changed results'; END IF;
 RAISE NOTICE 'all-brand overview: before_ms=% after_ms=% identical=true',old_ms,new_ms;
END $$;
-- Exercise a larger month + comparison cohort in the same rollback transaction.
-- This is a synthetic scale fixture, never a claim about production page timing.
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; a text; b text; config jsonb; t timestamptz;
 baseline jsonb; candidate jsonb; old_ms numeric; new_ms numeric;
BEGIN
 SELECT account_id,default_brand_id::text INTO a,b FROM meta_ad_accounts WHERE workspace_id=w AND is_active AND default_brand_id IS NOT NULL ORDER BY account_id LIMIT 1;
 INSERT INTO meta_ad_daily_metrics(workspace_id,account_id,account_name,ad_id,ad_name,metric_date,currency,metrics,raw_insights,landing_page_urls)
 SELECT w,a,'Performance fixture','99988241'||n::text,'[skin][conv] Scale fixture '||n,d::date,'IDR',
  jsonb_build_object('spend',n*100,'impressions',n*1000,'lpv',n*25,'purchases',n,'instagram_profile_visits',CASE WHEN n%7=0 THEN NULL ELSE n END),
  '{"objective":"OUTCOME_SALES"}',jsonb_build_array('https://fixture.invalid/landing/'||(n%12)::text)
 FROM generate_series(1,200) n CROSS JOIN generate_series(DATE '2026-09-03',DATE '2026-10-28',interval '1 day') d;
 config:=jsonb_build_object('account_ids',jsonb_build_array(a),'name_filter','Scale fixture','match','contains','include_analysis',true);
 PERFORM ensure_meta_brand_report_days(w,'2026-09-03','2026-10-28',ARRAY[a]);
 t:=clock_timestamp(); baseline:=pg_temp.meta_report_before_241(w,'2026-10-01','2026-10-28',config,'{}',b);
 old_ms:=round(extract(epoch FROM clock_timestamp()-t)*1000,1);
 t:=clock_timestamp(); candidate:=get_meta_ad_report_incremental(w,'2026-10-01','2026-10-28',config,'{}',b);
 new_ms:=round(extract(epoch FROM clock_timestamp()-t)*1000,1);
 IF baseline IS DISTINCT FROM candidate THEN RAISE EXCEPTION 'Scaled benchmark changed results'; END IF;
 RAISE NOTICE 'synthetic 11200 fact rows/200 ads/56 days: before_ms=% after_ms=% identical=true',old_ms,new_ms;
END $$;
