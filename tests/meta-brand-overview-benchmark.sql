SET LOCAL statement_timeout='60s';
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; b text; ch text; g text; t timestamptz; ms numeric; r jsonb; n integer:=0; BEGIN
 t:=clock_timestamp();
 FOR b IN SELECT DISTINCT coalesce(br.id::text,'__unmapped__') FROM meta_ad_accounts a LEFT JOIN brands br ON br.id=a.default_brand_id AND br.workspace_id=a.workspace_id WHERE a.workspace_id=w AND a.is_active LOOP
  FOR ch,g IN SELECT * FROM (VALUES('non_cpas','landing_page'),('cpas','ad'),('non_cpas','cep_intention'),('cpas','cep_intention')) x(c,g) LOOP
   PERFORM get_meta_ad_report(w,'2026-10-01','2026-10-18','{}',jsonb_build_object('channel',ch),b,g); n:=n+1;
  END LOOP;
 END LOOP;
 PERFORM get_meta_ad_report(w,'2026-10-01','2026-10-18','{}','{"channel":"non_cpas"}');
 ms:=round(extract(epoch FROM clock_timestamp()-t)*1000,1);
 RAISE NOTICE 'Baseline: % RPCs, % ms sequential database time',n+1,ms;
 t:=clock_timestamp();r:=get_meta_brand_overview_report(w,'2026-10-01','2026-10-18');
 RAISE NOTICE 'New cold: 1 RPC, % ms, % projected days',round(extract(epoch FROM clock_timestamp()-t)*1000,1),(SELECT count(*) FROM meta_brand_report_days WHERE workspace_id=w);
 t:=clock_timestamp();r:=get_meta_brand_overview_report(w,'2026-10-01','2026-10-18');
 RAISE NOTICE 'New warm: 1 RPC, % ms',round(extract(epoch FROM clock_timestamp()-t)*1000,1);
END $$;
SELECT 'PASS: benchmark ran on the reduced local Meta sample; transaction rolled back';
