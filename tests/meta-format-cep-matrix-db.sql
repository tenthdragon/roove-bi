-- Opt-in matrix metadata shares the existing per-ad report totals and scope.
SAVEPOINT matrix_fixtures;
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; a text; a2 text; b text; config jsonb; report jsonb; baseline jsonb; g jsonb; stripped jsonb; BEGIN
 SELECT account_id INTO a FROM ctwa_scope WHERE n=1;SELECT account_id INTO a2 FROM ctwa_scope WHERE n=2;
 SELECT default_brand_id::text INTO b FROM meta_ad_accounts WHERE workspace_id=w AND account_id=a;
 SELECT jsonb_build_object('account_ids',jsonb_agg(account_id),'include_optimization',true) INTO config FROM ctwa_scope;
 UPDATE meta_ad_creatives SET creative_format=CASE WHEN ad_id='99999997302' THEN 'video' ELSE 'image' END WHERE workspace_id=w AND ad_id IN('99999997301','99999997302','99999997303','99999997305');
 UPDATE meta_ad_daily_metrics SET raw_insights=raw_insights||jsonb_build_object('adset_id','700','campaign_id',CASE WHEN account_id=a THEN '900' ELSE '901' END,'objective','OUTCOME_SALES') WHERE workspace_id=w AND ad_id IN('99999997301','99999997302');
 PERFORM save_meta_adset_optimizations(w,a,'[{"adset_id":"700","campaign_id":"900","campaign_objective":"OUTCOME_SALES","optimization_goal":"OFFSITE_CONVERSIONS","conversion_event":"PURCHASE"}]',now());
 PERFORM save_meta_adset_optimizations(w,a2,'[{"adset_id":"700","campaign_id":"901","campaign_objective":"OUTCOME_SALES","optimization_goal":"OFFSITE_CONVERSIONS","conversion_event":"INITIATED_CHECKOUT"}]',now());
 -- NULL historical identity may use matched inventory; a conflicting historical creative stays unknown.
 UPDATE meta_ad_daily_metrics SET creative_id=NULL WHERE workspace_id=w AND ad_id='99999997303';
 UPDATE meta_ad_daily_metrics SET creative_id='999999973999' WHERE workspace_id=w AND ad_id='99999997305';
 baseline:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,'{}',b,'ad');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(baseline->'groups') x WHERE x ? 'matrix_metadata') THEN RAISE EXCEPTION 'Matrix metadata fetched without opt-in';END IF;
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config||'{"include_matrix":true}','{}',b,'ad');
 SELECT coalesce(jsonb_agg(value-'matrix_metadata' ORDER BY (value#>>'{current,spend}')::numeric DESC,value->>'key'),'[]') INTO stripped FROM jsonb_array_elements(report->'groups');
 IF report-'groups' IS DISTINCT FROM baseline-'groups' OR stripped IS DISTINCT FROM baseline->'groups' THEN RAISE EXCEPTION 'Matrix changed report totals, comparisons, groups or scope'; END IF;
 FOR g IN SELECT value FROM jsonb_array_elements(report->'groups') LOOP
  IF NOT(g ? 'matrix_metadata') OR jsonb_typeof(g#>'{matrix_metadata,cep_keys}')<>'array' THEN RAISE EXCEPTION 'Missing per-ad taxonomy metadata';END IF;
  IF jsonb_array_length(g->'format_breakdown')<>0 THEN RAISE EXCEPTION 'Matrix reaggregated unused per-ad format totals';END IF;
 END LOOP;
 SELECT value INTO STRICT g FROM jsonb_array_elements(report->'groups') WHERE value->'ad_ids' ? '99999997301';
 IF NOT(g#>'{matrix_metadata,cep_keys}' ?& ARRAY['joint','skin']) OR g#>>'{matrix_metadata,creative_format}'<>'image' OR g#>>'{optimization_breakdown,0,conversion_event}'<>'PURCHASE' THEN RAISE EXCEPTION 'Official multi-CEP taxonomy, format or actual optimization missing: %',g;END IF;
 SELECT value INTO STRICT g FROM jsonb_array_elements(report->'groups') WHERE value->'ad_ids' ? '99999997302';
 IF g#>>'{matrix_metadata,creative_format}'<>'video' OR g#>>'{optimization_breakdown,0,conversion_event}'<>'INITIATED_CHECKOUT' THEN RAISE EXCEPTION 'Account/adset campaign identity mixed';END IF;
 SELECT value INTO STRICT g FROM jsonb_array_elements(report->'groups') WHERE value->'ad_ids' ? '99999997303';
 IF g#>>'{matrix_metadata,creative_format}'<>'image' OR g#>>'{matrix_metadata,uses_latest_metadata}'<>'true' THEN RAISE EXCEPTION 'Inventory fallback/provenance missing';END IF;
 SELECT value INTO STRICT g FROM jsonb_array_elements(report->'groups') WHERE value->'ad_ids' ? '99999997305';
 IF g#>>'{matrix_metadata,creative_format}'<>'unknown' THEN RAISE EXCEPTION 'Conflicting historical creative borrowed metadata';END IF;
 -- Selected CEP cannot leak the other memberships of a matching multi-CEP ad.
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config||'{"include_matrix":true}','{"cep":"joint"}',b,'ad');
 IF jsonb_array_length(report->'groups')<>1 OR report#>'{groups,0,matrix_metadata,cep_keys}'<>'["joint"]'::jsonb THEN RAISE EXCEPTION 'CEP filter leaked a second membership';END IF;
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config||'{"include_matrix":true}','{"intention":"disc"}',b,'ad');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(report->'groups') x WHERE x->'ad_ids' ? '99999997301') THEN RAISE EXCEPTION 'Intention filter ignored';END IF;
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config||'{"include_matrix":true}','{"objective":"OUTCOME_TRAFFIC"}',b,'ad');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(report->'groups') x WHERE x->'ad_ids' ? '99999997301') THEN RAISE EXCEPTION 'Objective filter ignored';END IF;
 -- All channel values retain exactly the ordinary report cohort and totals.
 FOR g IN SELECT jsonb_build_object('channel',x) FROM unnest(ARRAY['non_cpas','cpas','unknown']) x LOOP
  baseline:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,g,b,'ad');
  report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config||'{"include_matrix":true}',g,b,'ad');
  IF report->'summary' IS DISTINCT FROM baseline->'summary' OR report->'matchingAds' IS DISTINCT FROM baseline->'matchingAds' THEN RAISE EXCEPTION 'Channel scope changed';END IF;
 END LOOP;
 report:=get_meta_ad_report_incremental('00000000-0000-4000-8000-000000000002','1996-01-02','1996-01-02',config||'{"include_matrix":true}','{}',b,'ad');
 IF jsonb_array_length(report->'groups')<>0 THEN RAISE EXCEPTION 'Matrix workspace leak';END IF;
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config||jsonb_build_object('account_ids',jsonb_build_array(a),'include_matrix',true),'{}',b,'ad');
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(report->'groups') x WHERE x->'ad_ids' ? '99999997302') THEN RAISE EXCEPTION 'Account scope escaped';END IF;
 IF has_function_privilege('authenticated','get_meta_ad_report_incremental(uuid,date,date,jsonb,jsonb,text,text,text,text,text)','EXECUTE') OR has_function_privilege('anon','get_meta_ad_report_incremental(uuid,date,date,jsonb,jsonb,text,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Matrix expanded browser grants';END IF;
END $$;
ROLLBACK TO SAVEPOINT matrix_fixtures;
RELEASE SAVEPOINT matrix_fixtures;
SELECT 'PASS: matrix opt-in, exact cohort/totals parity, taxonomy membership, creative identity/provenance, optimization identity, filters, channels, account/workspace scope and grants';
