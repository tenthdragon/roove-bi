DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; b text; t timestamptz; config jsonb; BEGIN
 SELECT a.default_brand_id::text INTO b FROM meta_ad_daily_metrics f JOIN meta_ad_accounts a USING(workspace_id,account_id)
 WHERE f.workspace_id=w AND a.is_active AND f.metric_date BETWEEN '2026-10-01' AND '2026-10-18' GROUP BY a.default_brand_id ORDER BY count(*) DESC LIMIT 1;
 SELECT jsonb_build_object('account_ids',jsonb_agg(account_id)) INTO config FROM meta_ad_accounts WHERE workspace_id=w AND is_active AND default_brand_id::text=b;
 t:=clock_timestamp();
 PERFORM get_meta_ad_report(w,'2026-10-01','2026-10-18','{}','{"channel":"non_cpas"}',b,'landing_page');
 PERFORM get_meta_ad_report(w,'2026-10-01','2026-10-18','{}','{"channel":"cpas"}',b,'ad');
 PERFORM get_meta_ad_report(w,'2026-10-01','2026-10-18','{}','{"channel":"non_cpas"}',b,'cep_intention');
 RAISE NOTICE 'Old detail, 3 RPCs: % ms serial database time',round(extract(epoch FROM clock_timestamp()-t)*1000,1);
 t:=clock_timestamp(); PERFORM get_meta_brand_detail_report(w,'2026-10-01','2026-10-18',b,'non_cpas');
 RAISE NOTICE 'New detail batch cold, 1 RPC: % ms',round(extract(epoch FROM clock_timestamp()-t)*1000,1);
 t:=clock_timestamp(); PERFORM get_meta_brand_detail_report(w,'2026-10-01','2026-10-18',b,'non_cpas');
 RAISE NOTICE 'New detail batch warm, 1 RPC: % ms',round(extract(epoch FROM clock_timestamp()-t)*1000,1);
 t:=clock_timestamp(); PERFORM get_meta_ad_report(w,'2026-10-01','2026-10-18','{}','{"channel":"non_cpas"}',b,'landing_page','trends');
 RAISE NOTICE 'Old 90-day history: % ms',round(extract(epoch FROM clock_timestamp()-t)*1000,1);
 t:=clock_timestamp(); PERFORM get_meta_ad_report_incremental(w,'2026-10-01','2026-10-18',config,'{"channel":"non_cpas"}',b,'landing_page','trends');
 RAISE NOTICE 'New 90-day history cold: % ms',round(extract(epoch FROM clock_timestamp()-t)*1000,1);
 t:=clock_timestamp(); PERFORM get_meta_ad_report_incremental(w,'2026-10-01','2026-10-18',config,'{"channel":"non_cpas"}',b,'landing_page','trends');
 RAISE NOTICE 'New 90-day history warm: % ms',round(extract(epoch FROM clock_timestamp()-t)*1000,1);
END $$;
