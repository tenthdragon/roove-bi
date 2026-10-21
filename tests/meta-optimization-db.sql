-- All schema, configurations and fixture mutations stay inside the runner's rollback.
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; a text; a2 text; config jsonb; report jsonb; old jsonb; parent jsonb; child jsonb; n integer; rev bigint; BEGIN
 SELECT s.account_id INTO a FROM ctwa_scope s WHERE s.n=1; SELECT s.account_id INTO a2 FROM ctwa_scope s WHERE s.n=2;
 SELECT jsonb_build_object('account_ids',jsonb_agg(account_id)) INTO config FROM ctwa_scope;
 old:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config);
 -- An adset is keyed by account as well as workspace, even if provider IDs collide.
 PERFORM save_meta_adset_optimizations(w,a,'[{"adset_id":"700","campaign_id":"900","campaign_objective":"OUTCOME_SALES","optimization_goal":"OFFSITE_CONVERSIONS","conversion_event":"PURCHASE","source_updated_at":"1996-01-02T00:00:00Z"}]','1996-01-03');
 PERFORM save_meta_adset_optimizations(w,a2,'[{"adset_id":"700","campaign_id":"901","campaign_objective":"OUTCOME_SALES","optimization_goal":"OFFSITE_CONVERSIONS","conversion_event":"INITIATED_CHECKOUT","source_updated_at":"1996-01-02T00:00:00Z"}]','1996-01-03');
 UPDATE meta_ad_daily_metrics SET raw_insights=raw_insights||jsonb_build_object('adset_id','700','campaign_id',CASE WHEN account_id=a THEN '900' ELSE '901' END,'objective','OUTCOME_SALES')
 WHERE workspace_id=w AND ad_id IN('99999997301','99999997302');
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config);
 IF report->'summary' IS DISTINCT FROM old->'summary' OR report->'previous' IS DISTINCT FROM old->'previous' THEN RAISE EXCEPTION 'Optimization metadata changed totals'; END IF;
 FOR parent IN SELECT value FROM jsonb_array_elements(report->'groups') LOOP
  IF (SELECT sum((c#>>'{current,spend}')::numeric) FROM jsonb_array_elements(parent->'optimization_breakdown') c) IS DISTINCT FROM (parent#>>'{current,spend}')::numeric THEN RAISE EXCEPTION 'Optimization current totals do not reconcile'; END IF;
  IF (SELECT sum((c#>>'{previous,spend}')::numeric) FROM jsonb_array_elements(parent->'optimization_breakdown') c) IS DISTINCT FROM (parent#>>'{previous,spend}')::numeric THEN RAISE EXCEPTION 'Optimization prior totals do not reconcile'; END IF;
  IF (SELECT sum(jsonb_array_length(c->'ad_ids')) FROM jsonb_array_elements(parent->'optimization_breakdown') c) IS DISTINCT FROM jsonb_array_length(parent->'ad_ids')::bigint THEN RAISE EXCEPTION 'Optimization counts duplicated or lost'; END IF;
 END LOOP;
 SELECT c INTO STRICT child FROM jsonb_array_elements(report->'groups') g CROSS JOIN jsonb_array_elements(g->'optimization_breakdown') c WHERE c->'ad_ids' ? '99999997301';
 IF child->>'conversion_event'<>'PURCHASE' OR child->>'objective'<>'OUTCOME_SALES' THEN RAISE EXCEPTION 'Purchase metadata missing: %',child; END IF;
 SELECT c INTO STRICT child FROM jsonb_array_elements(report->'groups') g CROSS JOIN jsonb_array_elements(g->'optimization_breakdown') c WHERE c->'ad_ids' ? '99999997302';
 IF child->>'conversion_event'<>'INITIATED_CHECKOUT' THEN RAISE EXCEPTION 'Account scope leaked'; END IF;
 -- Stale inventory cannot overwrite a later configuration, even with a later request timestamp.
 n:=save_meta_adset_optimizations(w,a,'[{"adset_id":"700","campaign_id":"900","optimization_goal":"LINK_CLICKS","source_updated_at":"1996-01-01T00:00:00Z"}]','1996-01-04');
 IF n<>0 OR (SELECT conversion_event FROM meta_adset_optimizations WHERE workspace_id=w AND account_id=a AND adset_id='700')<>'PURCHASE' THEN RAISE EXCEPTION 'Stale configuration overwritten'; END IF;
 n:=save_meta_adset_optimizations(w,a,'[{"adset_id":"700","campaign_id":"900","optimization_goal":"LINK_CLICKS","source_updated_at":"1996-01-05T00:00:00Z"}]','1996-01-02');
 IF n<>0 THEN RAISE EXCEPTION 'Older observation overwritten'; END IF;
 -- Reused/mismatched campaign identities do not borrow current optimization.
 UPDATE meta_ad_daily_metrics SET raw_insights=raw_insights||'{"campaign_id":"999"}' WHERE workspace_id=w AND account_id=a AND ad_id='99999997301';
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config);
 SELECT c INTO STRICT child FROM jsonb_array_elements(report->'groups') g CROSS JOIN jsonb_array_elements(g->'optimization_breakdown') c WHERE c->'ad_ids' ? '99999997301';
 IF child->>'optimization_goal' IS NOT NULL THEN RAISE EXCEPTION 'Different campaign metadata borrowed'; END IF;
 SELECT revision INTO rev FROM meta_ad_report_versions WHERE workspace_id=w;
 PERFORM save_meta_adset_optimizations(w,a,'[{"adset_id":"700","campaign_id":"900","campaign_objective":"OUTCOME_TRAFFIC","optimization_goal":"LANDING_PAGE_VIEWS","source_updated_at":"1996-01-05T00:00:00Z"}]','1996-01-06');
 IF (SELECT revision FROM meta_ad_report_versions WHERE workspace_id=w)<=rev THEN RAISE EXCEPTION 'Optimization update did not invalidate cache'; END IF;
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,'{}',NULL,'ad');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(report->'groups') g WHERE jsonb_array_length(g->'optimization_breakdown')>0) THEN RAISE EXCEPTION 'Unused per-ad optimization was aggregated'; END IF;
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config||'{"include_optimization":true}','{}',NULL,'ad');
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'groups') g WHERE g->'ad_ids' ? '99999997302' AND jsonb_array_length(g->'optimization_breakdown')=1) THEN RAISE EXCEPTION 'Per-ad detail missing'; END IF;
 report:=get_meta_ad_report_incremental('00000000-0000-4000-8000-000000000002','1996-01-02','1996-01-02',config);
 IF jsonb_array_length(report->'groups')<>0 THEN RAISE EXCEPTION 'Workspace leak'; END IF;
 BEGIN PERFORM save_meta_adset_optimizations(w,'act_nonexistent','[]','1996-01-06');RAISE EXCEPTION 'accepted foreign account';EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted foreign account' THEN RAISE;END IF;END;
 BEGIN PERFORM save_meta_adset_optimizations(w,a,'[{"adset_id":"700","campaign_id":"900"},{"adset_id":"700","campaign_id":"900"}]','1996-01-06');RAISE EXCEPTION 'accepted duplicate adset';EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted duplicate adset' THEN RAISE;END IF;END;
 IF has_table_privilege('authenticated','meta_adset_optimizations','SELECT') OR has_function_privilege('authenticated','save_meta_adset_optimizations(uuid,text,jsonb,timestamptz)','EXECUTE')
 OR has_function_privilege('anon','save_meta_adset_optimizations(uuid,text,jsonb,timestamptz)','EXECUTE') THEN RAISE EXCEPTION 'Browser privileges expanded'; END IF;
 -- Restore report fixtures before the parity suite.
 UPDATE meta_ad_daily_metrics d SET raw_insights=raw_insights-'campaign_id'-'objective'||jsonb_build_object('adset_id',f.adset_id)
 FROM ctwa_fixture f WHERE d.workspace_id=w AND d.ad_id=f.ad_id AND f.n IN(1,2);
 DELETE FROM meta_adset_optimizations WHERE workspace_id=w AND adset_id='700' AND account_id IN(a,a2);
END $$;
SELECT 'PASS: optimization cohorts, totals, comparisons, adset/account/campaign identity, stale inventory, revision, details, workspace scope and service-only grants';
