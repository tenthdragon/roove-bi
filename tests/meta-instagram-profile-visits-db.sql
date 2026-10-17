BEGIN;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='roove_local') THEN RAISE EXCEPTION 'Local database required'; END IF; END $$;
-- MIGRATION
SET LOCAL ROLE service_role;
DO $$ DECLARE w uuid; a text; result jsonb; baseline jsonb; actual jsonb; row jsonb; t timestamptz:='2026-10-17T01:00:00Z'; BEGIN
 SELECT workspace_id,account_id INTO STRICT w,a FROM meta_ad_accounts ORDER BY workspace_id,account_id LIMIT 1;
 IF EXISTS(SELECT 1 FROM meta_ad_daily_metrics WHERE workspace_id=w AND account_id=a AND metric_date='1995-01-01') THEN RAISE EXCEPTION 'Fixture collision'; END IF;
 INSERT INTO meta_ad_daily_metrics(workspace_id,account_id,account_name,ad_id,ad_name,creative_id,metric_date,currency,metrics,raw_insights,landing_page_urls)
 VALUES(w,a,'IG fixture','99999997401','IG fixture','99999997402','1995-01-01','IDR','{"spend":1234,"purchases":5,"conversations":6}',
 '{"adset_id":"99999997403","spend":"1234","actions":[{"value":"5"}]}','["https://instagram.com/example"]');
 SELECT to_jsonb(d) INTO baseline FROM meta_ad_daily_metrics d WHERE workspace_id=w AND account_id=a AND ad_id='99999997401' AND metric_date='1995-01-01';
 result:=save_meta_instagram_profile_visits(w,a,'[{"ad_id":"99999997401","adset_id":"99999997403","metric_date":"1995-01-01","instagram_profile_visits":37}]',t,'v24.0');
 IF (result->>'saved')::int<>1 THEN RAISE EXCEPTION 'Patch missing'; END IF;
 SELECT to_jsonb(d) INTO actual FROM meta_ad_daily_metrics d WHERE workspace_id=w AND account_id=a AND ad_id='99999997401' AND metric_date='1995-01-01';
 IF actual->'metrics'->>'instagram_profile_visits'<>'37' OR actual->'raw_insights'->>'instagram_profile_visits'<>'37' THEN RAISE EXCEPTION 'Metric missing'; END IF;
 actual:=actual || jsonb_build_object('metrics',(actual->'metrics')-'instagram_profile_visits','raw_insights',(actual->'raw_insights')-'instagram_profile_visits'-'ig_profile_visit_observation');
 IF actual IS DISTINCT FROM baseline THEN RAISE EXCEPTION 'Non-profile fields modified'; END IF;
 result:=save_meta_instagram_profile_visits(w,a,'[{"ad_id":"99999997401","adset_id":"99999997403","metric_date":"1995-01-01","instagram_profile_visits":0}]',t-interval '1 second','v24.0');
 IF (result->>'newer')::int<>1 THEN RAISE EXCEPTION 'Older observation applied'; END IF;
 result:=save_meta_instagram_profile_visits(w,a,'[{"ad_id":"99999997401","adset_id":"99999997499","metric_date":"1995-01-01","instagram_profile_visits":0}]',t,'v24.0');
 IF (result->>'scope_changed')::int<>1 THEN RAISE EXCEPTION 'Wrong adset applied'; END IF;
 result:=save_meta_instagram_profile_visits(w,a,'[{"ad_id":"99999997499","metric_date":"1995-01-01","instagram_profile_visits":0}]',t,'v24.0');
 IF (result->>'missing')::int<>1 THEN RAISE EXCEPTION 'Missing fact inserted'; END IF;
 row:=jsonb_build_object('ad_id','99999997401','ad_name','IG fixture','creative_id','99999997402','metric_date','1995-01-01','metrics','{"spend":1234,"purchases":5}'::jsonb,'raw_insights','{"adset_id":"99999997403","spend":"1234"}'::jsonb);
 PERFORM replace_meta_ad_snapshot(w,a,'IG fixture','1995-01-01','1995-01-01','IDR','Asia/Jakarta',jsonb_build_array(row));
 IF (SELECT metrics->>'instagram_profile_visits' FROM meta_ad_daily_metrics WHERE workspace_id=w AND account_id=a AND ad_id='99999997401' AND metric_date='1995-01-01')<>'37' THEN RAISE EXCEPTION 'Legacy snapshot erased backfill'; END IF;
 row:=row || jsonb_build_object('metrics',(row->'metrics') || '{"instagram_profile_visits":0}'::jsonb,'raw_insights',(row->'raw_insights') || jsonb_build_object('instagram_profile_visits',0,'ig_profile_visit_observation',jsonb_build_object('observed_at','2026-10-17T02:00:00.000Z')));
 PERFORM replace_meta_ad_snapshot(w,a,'IG fixture','1995-01-01','1995-01-01','IDR','Asia/Jakarta',jsonb_build_array(row));
 IF (SELECT metrics->>'instagram_profile_visits' FROM meta_ad_daily_metrics WHERE workspace_id=w AND account_id=a AND ad_id='99999997401' AND metric_date='1995-01-01')<>'0' THEN RAISE EXCEPTION 'Fresh zero not applied'; END IF;
 result:=save_meta_instagram_profile_visits(w,a,'[{"ad_id":"99999997401","adset_id":"99999997403","metric_date":"1995-01-01","instagram_profile_visits":null}]','2026-10-17T03:00:00Z','v24.0');
 IF (SELECT metrics->'instagram_profile_visits' FROM meta_ad_daily_metrics WHERE workspace_id=w AND account_id=a AND ad_id='99999997401' AND metric_date='1995-01-01')<>'null'::jsonb THEN RAISE EXCEPTION 'Unknown became zero'; END IF;
 IF has_function_privilege('anon','public.save_meta_instagram_profile_visits(uuid,text,jsonb,timestamptz,text)','EXECUTE') OR has_function_privilege('authenticated','public.save_meta_instagram_profile_visits(uuid,text,jsonb,timestamptz,text)','EXECUTE') THEN RAISE EXCEPTION 'Browser patch access'; END IF;
END $$;
DO $$ DECLARE result jsonb; BEGIN
 SELECT meta_ad_report_sum(m) INTO result FROM (VALUES('{"spend":10,"instagram_profile_visits":5}'::jsonb),('{"spend":20,"instagram_profile_visits":0}'::jsonb)) v(m);
 IF result->>'spend'<>'30' OR result->>'instagram_profile_visits'<>'5' THEN RAISE EXCEPTION 'Known aggregate incorrect'; END IF;
 SELECT meta_ad_report_sum(m) INTO result FROM (VALUES('{"spend":10,"instagram_profile_visits":5}'::jsonb),('{"spend":20}'::jsonb)) v(m);
 IF result->>'spend'<>'30' OR result->'instagram_profile_visits'<>'null'::jsonb THEN RAISE EXCEPTION 'Partial aggregate became zero'; END IF;
 SELECT meta_ad_report_sum(m) INTO result FROM (SELECT '{}'::jsonb AS m WHERE false) v;
 IF result->>'instagram_profile_visits'<>'0' THEN RAISE EXCEPTION 'Empty aggregate incorrect'; END IF;
END $$;
SELECT 'PASS: profile-only patch, freshness/scope guards, legacy snapshot preservation, explicit zero/null, aggregate parity and restricted grants';
ROLLBACK;
