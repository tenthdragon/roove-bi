-- Run only against the isolated local clone. All test writes roll back.
BEGIN;
DO $$
DECLARE w uuid; other_w uuid; account text; n integer; failures integer:=0; verified_ad text; creative text; verifier uuid;
BEGIN
 SELECT workspace_id,account_id INTO w,account FROM public.meta_ad_accounts LIMIT 1;
 IF w IS NULL THEN RAISE EXCEPTION 'Local test needs an existing Meta account'; END IF;
 SELECT id INTO other_w FROM public.workspaces WHERE id<>w LIMIT 1;
 IF EXISTS(SELECT 1 FROM public.meta_ad_daily_metrics WHERE workspace_id=w AND account_id=account AND metric_date='2000-01-01') THEN
  RAISE EXCEPTION 'Refusing test date collision';
 END IF;
 PERFORM public.replace_meta_ad_snapshot(w,account,'Test account','2000-01-01','2000-01-02','IDR','Asia/Jakarta',
  '[{"ad_id":"1","ad_name":"Test A","metric_date":"2000-01-01","metrics":{"spend":100},"raw_insights":{},"landing_page_urls":["https://roove.co.id/test"]}]');
 SELECT count(*) INTO n FROM public.meta_ad_daily_metrics WHERE workspace_id=w AND account_id=account AND metric_date BETWEEN '2000-01-01' AND '2000-01-02';
 IF n<>1 THEN RAISE EXCEPTION 'Snapshot insert failed'; END IF;
 IF (SELECT landing_page_urls FROM public.meta_ad_daily_metrics WHERE workspace_id=w AND account_id=account AND ad_id='1' AND metric_date='2000-01-01') <> '["https://roove.co.id/test"]'::jsonb THEN
  RAISE EXCEPTION 'Snapshot destination not persisted';
 END IF;
 SELECT count(*) INTO n FROM public.meta_ad_sync_coverage WHERE workspace_id=w AND account_id=account AND metric_date BETWEEN '2000-01-01' AND '2000-01-02';
 IF n<>2 THEN RAISE EXCEPTION 'Zero-row date coverage missing'; END IF;
 -- Failed replacement must preserve prior facts and coverage.
 BEGIN
  PERFORM public.replace_meta_ad_snapshot(w,account,'Test account','2000-01-01','2000-01-02','IDR','Asia/Jakarta',
   '[{"ad_id":"1","ad_name":"A","metric_date":"2000-01-03","metrics":{},"raw_insights":{}}]');
 EXCEPTION WHEN others THEN failures:=failures+1; END;
 IF failures<>1 THEN RAISE EXCEPTION 'Out-of-range snapshot accepted'; END IF;
 SELECT count(*) INTO n FROM public.meta_ad_daily_metrics WHERE workspace_id=w AND account_id=account AND ad_id='1' AND metric_date='2000-01-01';
 IF n<>1 THEN RAISE EXCEPTION 'Failed replacement destroyed prior data'; END IF;
 BEGIN
  PERFORM public.replace_meta_ad_snapshot(other_w,'act_999999999999999999','Test','2000-01-01','2000-01-01','IDR','Asia/Jakarta','[]');
 EXCEPTION WHEN others THEN failures:=failures+1; END;
 IF failures<>2 THEN RAISE EXCEPTION 'Unknown/cross-workspace account accepted'; END IF;
 BEGIN
  PERFORM public.replace_meta_ad_snapshot(w,account,'Test account','2000-01-01','2000-01-02','IDR','Asia/Jakarta',
   '[{"ad_id":"1","ad_name":"A","metric_date":"2000-01-01","metrics":{},"raw_insights":{},"landing_page_urls":[42]}]');
 EXCEPTION WHEN others THEN failures:=failures+1; END;
 IF failures<>3 THEN RAISE EXCEPTION 'Invalid destination array accepted'; END IF;
 SELECT count(*) INTO n FROM public.meta_ad_daily_metrics WHERE workspace_id=w AND account_id=account AND metric_date='2000-01-01' AND landing_page_urls='["https://roove.co.id/test"]'::jsonb;
 IF n<>1 THEN RAISE EXCEPTION 'Invalid destinations destroyed prior snapshot'; END IF;
 PERFORM public.replace_meta_ad_snapshot(w,account,'Test account','2000-01-01','2000-01-02','IDR','Asia/Jakarta','[]');
 SELECT count(*) INTO n FROM public.meta_ad_daily_metrics WHERE workspace_id=w AND account_id=account AND metric_date BETWEEN '2000-01-01' AND '2000-01-02';
 IF n<>0 THEN RAISE EXCEPTION 'Empty replacement did not remove stale facts'; END IF;
 SELECT c.ad_id,c.creative_id INTO verified_ad,creative FROM public.meta_ad_creatives c
 WHERE c.workspace_id=w AND c.account_id=account AND c.creative_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.meta_ad_verified_destinations v WHERE v.workspace_id=c.workspace_id AND v.account_id=c.account_id AND v.ad_id=c.ad_id) LIMIT 1;
 SELECT id INTO verifier FROM auth.users LIMIT 1;
 IF verified_ad IS NULL OR verifier IS NULL THEN RAISE EXCEPTION 'Verified URL test needs a cached local creative and user'; END IF;
 INSERT INTO public.meta_ad_verified_destinations(workspace_id,account_id,ad_id,creative_id,landing_page_url,verified_by)
 VALUES(w,account,verified_ad,creative,'https://roove.co.id/verified-test',verifier);
 BEGIN
  INSERT INTO public.meta_ad_verified_destinations(workspace_id,account_id,ad_id,creative_id,landing_page_url,verified_by)
  VALUES(other_w,account,verified_ad,creative,'https://roove.co.id/verified-test',verifier);
 EXCEPTION WHEN foreign_key_violation THEN failures:=failures+1; END;
 IF failures<>4 THEN RAISE EXCEPTION 'Cross-workspace verified destination accepted'; END IF;
 IF has_table_privilege('authenticated','public.meta_ad_daily_metrics','SELECT')
 OR has_table_privilege('anon','public.meta_ad_funnels','SELECT')
 OR has_table_privilege('authenticated','public.meta_ad_verified_destinations','SELECT')
 OR has_table_privilege('authenticated','public.meta_ad_verified_destinations','INSERT')
 OR has_function_privilege('authenticated','public.replace_meta_ad_snapshot(uuid,text,text,date,date,text,text,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'Browser access bypasses server authorization';
 END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.meta_ad_daily_metrics'::regclass) THEN RAISE EXCEPTION 'RLS disabled'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.meta_ad_verified_destinations'::regclass) THEN RAISE EXCEPTION 'Verified URL RLS disabled'; END IF;
 RAISE NOTICE 'PASS: atomic snapshots, destinations, empty-day coverage, invalid scope rejection, and browser restrictions';
END $$;
ROLLBACK;
