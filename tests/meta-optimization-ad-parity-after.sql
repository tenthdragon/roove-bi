DO $$ DECLARE r record; actual jsonb; BEGIN
 FOR r IN SELECT * FROM optimization_ad_parity LOOP
 actual:=public.get_meta_ad_report_incremental('00000000-0000-4000-8000-000000000001','1996-01-02','1996-01-02',r.config,
 r.filters||CASE WHEN r.channel IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('channel',r.channel) END,NULL,r.group_by);
 IF actual IS DISTINCT FROM r.expected THEN RAISE EXCEPTION 'Optimization report changed: %, %, %, %',r.group_by,r.channel,r.filters,r.flag; END IF;
 END LOOP;
END $$;
SELECT 'PASS: 36 optimization report scopes match migration 232 exactly';
