CREATE FUNCTION pg_temp.normalize_meta_report(r jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE k text; a jsonb;
BEGIN
 FOREACH k IN ARRAY ARRAY['groups','coverage','facets','creatives','intentionTotals'] LOOP
  IF jsonb_typeof(r->k)='array' THEN
   SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]') INTO a FROM jsonb_array_elements(r->k);
   r:=jsonb_set(r,ARRAY[k],a);
  END IF;
 END LOOP;
 RETURN r;
END $$;
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; a text; b text; f jsonb; g text; v text; period text; focus text; old jsonb; fresh jsonb; batch jsonb; config jsonb; n int:=0; t timestamptz; BEGIN
 SELECT s.account_id INTO a FROM ctwa_scope s WHERE s.n=1;
 SELECT default_brand_id::text INTO b FROM meta_ad_accounts WHERE workspace_id=w AND account_id=a;
 -- An unmapped naming fallback must use the selected range's latest fact.
 INSERT INTO meta_ad_daily_metrics(workspace_id,account_id,account_name,ad_id,ad_name,creative_id,metric_date,currency,metrics,raw_insights,landing_page_urls)
 VALUES(w,a,'Fallback','999999973777','[skin][conv] Previous','777','1996-01-01','IDR','{"spend":30,"impressions":100}','{}','["https://example.com/fallback"]'),
 (w,a,'Fallback','999999973777','[joint][cons] Current','777','1996-01-02','IDR','{"spend":50,"impressions":200}','{}','["https://example.com/fallback"]');
 FOREACH config IN ARRAY ARRAY['{}','{"account_ids":["'||a||'"]}','{"name_filter":"CTWA","match":"contains"}','{"name_filter":"[joint][cons] Current","match":"exact"}']::jsonb[] LOOP
  FOREACH f IN ARRAY ARRAY['{}','{"channel":"non_cpas"}','{"channel":"cpas"}','{"channel":"unknown","cep":"__unknown__"}','{"cep":"joint","intention":"cons"}','{"objective":"__unknown__"}']::jsonb[] LOOP
   FOREACH g IN ARRAY ARRAY['ad','landing_page','cep_intention'] LOOP
    FOREACH v IN ARRAY ARRAY['overview','daily','trends','creatives'] LOOP
     period:=CASE WHEN n%2=0 THEN 'week' ELSE 'month' END;
     focus:=CASE g WHEN 'ad' THEN 'ad:'||a||':99999997301' WHEN 'cep_intention' THEN 'cep:joint:cons' ELSE 'ctwa:'||b||':phone:+628111111111' END;
     IF n%2=0 AND v<>'creatives' THEN focus:=NULL; END IF;
     old:=get_meta_ad_report(w,'1996-01-02','1996-01-02',config,f,CASE WHEN n%3=0 THEN b ELSE NULL END,g,v,period,focus);
     fresh:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,f,CASE WHEN n%3=0 THEN b ELSE NULL END,g,v,period,focus);
     IF pg_temp.normalize_meta_report(old) IS DISTINCT FROM pg_temp.normalize_meta_report(fresh) THEN
      RAISE EXCEPTION 'Report mismatch case % / % / % / % / %',n,g,v,f,config;
     END IF;
     n:=n+1;
    END LOOP;
   END LOOP;
  END LOOP;
 END LOOP;
 -- The detail batch scopes accounts before aggregation; compare with the same
 -- account scope, preserving every raw field consumed by the detail page.
 SELECT jsonb_build_object('account_ids',jsonb_agg(account_id)) INTO config FROM meta_ad_accounts WHERE workspace_id=w AND default_brand_id::text=b AND is_active;
 FOREACH f IN ARRAY ARRAY['{}','{"cep":"joint"}','{"intention":"cons"}']::jsonb[] LOOP
  FOREACH g IN ARRAY ARRAY['non_cpas','cpas'] LOOP
   batch:=get_meta_brand_detail_report(w,'1996-01-02','1996-01-02',b,g,f);
   old:=get_meta_ad_report(w,'1996-01-02','1996-01-02',config,f||'{"channel":"non_cpas"}',b,'landing_page');
   IF pg_temp.normalize_meta_report(batch->'website') IS DISTINCT FROM pg_temp.normalize_meta_report(old) THEN RAISE EXCEPTION 'Website batch mismatch'; END IF;
   old:=get_meta_ad_report(w,'1996-01-02','1996-01-02',config,f||'{"channel":"cpas"}',b,'ad');
   IF pg_temp.normalize_meta_report(batch->'cpas') IS DISTINCT FROM pg_temp.normalize_meta_report(old) THEN RAISE EXCEPTION 'CPAS batch mismatch'; END IF;
   old:=get_meta_ad_report(w,'1996-01-02','1996-01-02',config,f||jsonb_build_object('channel',g),b,'cep_intention');
   IF pg_temp.normalize_meta_report(batch->'cep') IS DISTINCT FROM pg_temp.normalize_meta_report(old) THEN RAISE EXCEPTION 'CEP batch mismatch'; END IF;
  END LOOP;
 END LOOP;
 batch:=get_meta_brand_detail_report(w,'1996-01-02','1996-01-02','2147483647','non_cpas');
 old:=get_meta_ad_report(w,'1996-01-02','1996-01-02','{"account_ids":[""]}','{"channel":"non_cpas"}','2147483647','landing_page');
 IF pg_temp.normalize_meta_report(batch->'website') IS DISTINCT FROM pg_temp.normalize_meta_report(old) THEN RAISE EXCEPTION 'Empty brand batch mismatch'; END IF;
 SELECT max(refreshed_at) INTO t FROM meta_brand_report_days;
 PERFORM get_meta_brand_detail_report(w,'1996-01-02','1996-01-02',b,'non_cpas');
 IF (SELECT max(refreshed_at) FROM meta_brand_report_days) IS DISTINCT FROM t THEN RAISE EXCEPTION 'Warm detail rebuilt source projections'; END IF;
 fresh:=get_meta_ad_report_incremental('00000000-0000-4000-8000-000000000002','1996-01-02','1996-01-02',config);
 IF (fresh->>'matchingAds')::int<>0 THEN RAISE EXCEPTION 'Workspace leakage'; END IF;
 IF has_function_privilege('authenticated','public.get_meta_ad_report_incremental(uuid,date,date,jsonb,jsonb,text,text,text,text,text)','EXECUTE')
 OR has_function_privilege('anon','public.get_meta_brand_detail_report(uuid,date,date,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Browser permissions expanded'; END IF;
 RAISE NOTICE 'PASS: % full report parity cases, batched detail, all groupings/views/filters, scoped cache reuse and permissions',n;
END $$;
