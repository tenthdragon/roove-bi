-- Isolated local clone only. No fixture survives this transaction.
BEGIN;
DO $$
DECLARE w uuid; account text; fact_count bigint; n bigint; t text;
BEGIN
 SELECT workspace_id,account_id INTO w,account FROM public.meta_ad_accounts LIMIT 1;
 IF w IS NULL THEN RAISE EXCEPTION 'Local test requires an account'; END IF;
 IF EXISTS(SELECT 1 FROM public.meta_ad_creatives WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999981') THEN RAISE EXCEPTION 'Fixture identity collision'; END IF;
 SELECT count(*) INTO fact_count FROM public.meta_ad_daily_metrics;
 INSERT INTO public.meta_ad_creatives(workspace_id,account_id,ad_id,creative_id,name,landing_page_urls)
 VALUES(w,account,'999999999999999981','981','Metadata fixture','[]');
 SELECT count(*) INTO n FROM public.list_meta_ads_for_destination_backfill(w) s WHERE s.account_id=account AND s.ad_id='999999999999999981';
 IF n<>1 THEN RAISE EXCEPTION 'Backfill omits creative-only ad'; END IF;
 SELECT count(*) INTO n FROM public.list_meta_ads_for_destination_backfill('ffffffff-ffff-4fff-8fff-ffffffffffff');
 IF n<>0 THEN RAISE EXCEPTION 'Backfill crosses workspace boundary'; END IF;
 INSERT INTO public.meta_ad_destination_metadata(workspace_id,account_id,ad_id,creative_id,metadata,classification,evidence,observed_at)
 VALUES(w,account,'999999999999999981','981','{"product_set_ids":["981"]}','unknown','[]',now());
 INSERT INTO public.meta_shopee_product_sets(workspace_id,account_id,product_set_id,verification)
 VALUES(w,account,'981','{"method":"test-product-urls","complete":true,"product_count":1}');
 IF fact_count<>(SELECT count(*) FROM public.meta_ad_daily_metrics) THEN RAISE EXCEPTION 'Destination writes changed performance facts'; END IF;
 BEGIN
  UPDATE public.meta_ad_destination_metadata SET classification='non_cpas' WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999981';
  RAISE EXCEPTION 'Unsupported classification accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF has_function_privilege('authenticated','public.list_meta_ads_for_destination_backfill(uuid)','EXECUTE') OR has_function_privilege('anon','public.list_meta_ads_for_destination_backfill(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Backfill function leaked to browser'; END IF;
 FOR t IN SELECT unnest(ARRAY['meta_ad_destination_metadata','meta_shopee_product_sets']) LOOP
  IF has_table_privilege('authenticated','public.'||t,'SELECT') OR has_table_privilege('anon','public.'||t,'INSERT') THEN RAISE EXCEPTION 'Browser grants leaked for %',t; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||t)::regclass) THEN RAISE EXCEPTION 'RLS disabled for %',t; END IF;
  IF NOT has_table_privilege('service_role','public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Missing service grants for %',t; END IF;
 END LOOP;
 RAISE NOTICE 'PASS: destination metadata storage, independent facts, complete ID scope, workspace isolation, conservative classification, RLS/grants';
END $$;
ROLLBACK;
