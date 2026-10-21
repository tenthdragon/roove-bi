-- Within the existing rollback harness: no fixtures or schema persist.
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; config jsonb; report jsonb; old jsonb; parent jsonb; child jsonb; filters jsonb; a text; rev bigint; BEGIN
 SELECT jsonb_build_object('account_ids',jsonb_agg(account_id)) INTO config FROM ctwa_scope;
 SELECT account_id INTO a FROM ctwa_scope WHERE n=1;
 old:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(old->'groups') g CROSS JOIN jsonb_array_elements(g->'partnership_breakdown') c WHERE c->>'status'<>'unknown') THEN RAISE EXCEPTION 'Uninspected cache is negative proof';END IF;
 SELECT revision INTO rev FROM meta_ad_report_versions WHERE workspace_id=w;
 UPDATE meta_ad_creatives c SET partnership_metadata=jsonb_build_object('version',1,'status',CASE f.n WHEN 1 THEN 'partnership' WHEN 2 THEN 'non_partnership' WHEN 9 THEN 'partnership' WHEN 13 THEN 'partnership' ELSE 'unknown' END) FROM ctwa_fixture f WHERE c.ad_id=f.ad_id;
 IF (SELECT revision FROM meta_ad_report_versions WHERE workspace_id=w)<=rev THEN RAISE EXCEPTION 'Partnership update did not invalidate cache';END IF;
 FOREACH filters IN ARRAY ARRAY['{}','{"channel":"non_cpas"}','{"channel":"cpas"}','{"channel":"unknown"}','{"cep":"skin"}','{"intention":"cons"}']::jsonb[] LOOP
  report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,filters);
  FOR parent IN SELECT value FROM jsonb_array_elements(report->'groups') LOOP
   IF (SELECT sum((c#>>'{current,spend}')::numeric) FROM jsonb_array_elements(parent->'partnership_breakdown') c) IS DISTINCT FROM (parent#>>'{current,spend}')::numeric THEN RAISE EXCEPTION 'Partnership current spend does not reconcile';END IF;
   IF (SELECT sum((c#>>'{previous,spend}')::numeric) FROM jsonb_array_elements(parent->'partnership_breakdown') c) IS DISTINCT FROM (parent#>>'{previous,spend}')::numeric THEN RAISE EXCEPTION 'Partnership prior spend does not reconcile';END IF;
   IF (SELECT sum(jsonb_array_length(c->'ad_ids')) FROM jsonb_array_elements(parent->'partnership_breakdown') c) IS DISTINCT FROM jsonb_array_length(parent->'ad_ids')::bigint THEN RAISE EXCEPTION 'Ads duplicated or missing';END IF;
  END LOOP;
 END LOOP;
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config);
 IF report->'summary' IS DISTINCT FROM old->'summary' OR report->'previous' IS DISTINCT FROM old->'previous' THEN RAISE EXCEPTION 'Partnership changed parent totals';END IF;
 SELECT c INTO STRICT child FROM jsonb_array_elements(report->'groups') g CROSS JOIN jsonb_array_elements(g->'partnership_breakdown') c WHERE c->'ad_ids' ? '99999997301';
 IF child->>'status'<>'partnership' THEN RAISE EXCEPTION 'Partnership missing';END IF;
 SELECT c INTO STRICT child FROM jsonb_array_elements(report->'groups') g CROSS JOIN jsonb_array_elements(g->'partnership_breakdown') c WHERE c->'ad_ids' ? '99999997302';
 IF child->>'status'<>'non_partnership' THEN RAISE EXCEPTION 'Non-partnership missing';END IF;
 SELECT c INTO STRICT child FROM jsonb_array_elements(report->'groups') g CROSS JOIN jsonb_array_elements(g->'partnership_breakdown') c WHERE c->'ad_ids' ? '999999973013';
 IF child->>'status'<>'unknown' THEN RAISE EXCEPTION 'Mismatched creative borrowed sponsorship';END IF;
 UPDATE meta_ad_daily_metrics SET creative_id=NULL WHERE workspace_id=w AND account_id=a AND ad_id='99999997309';
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config);
 SELECT c INTO STRICT child FROM jsonb_array_elements(report->'groups') g CROSS JOIN jsonb_array_elements(g->'partnership_breakdown') c WHERE c->'ad_ids' ? '99999997309';
 IF child->>'status'<>'partnership' THEN RAISE EXCEPTION 'Inventory matched metadata not used';END IF;
 UPDATE meta_ad_mappings SET creative_id='999999973777' WHERE workspace_id=w AND account_id=a AND ad_id='99999997309';
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config);
 SELECT c INTO STRICT child FROM jsonb_array_elements(report->'groups') g CROSS JOIN jsonb_array_elements(g->'partnership_breakdown') c WHERE c->'ad_ids' ? '99999997309';
 IF child->>'status'<>'unknown' THEN RAISE EXCEPTION 'Wrong inventory creative borrowed sponsorship';END IF;
 UPDATE meta_ad_mappings m SET creative_id=f.creative_id FROM ctwa_fixture f WHERE m.workspace_id=w AND m.account_id=a AND m.ad_id=f.ad_id AND f.n=9;
 UPDATE meta_ad_daily_metrics d SET creative_id=f.creative_id FROM ctwa_fixture f WHERE d.workspace_id=w AND d.account_id=a AND d.ad_id=f.ad_id AND f.n=9;
 report:=get_meta_ad_report_incremental('00000000-0000-4000-8000-000000000002','1996-01-02','1996-01-02',config);
 IF jsonb_array_length(report->'groups')<>0 THEN RAISE EXCEPTION 'Workspace scope leaked';END IF;
 IF has_table_privilege('authenticated','meta_ad_creatives','SELECT') OR has_function_privilege('authenticated','get_meta_ad_report_incremental(uuid,date,date,jsonb,jsonb,text,text,text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Browser privileges expanded';END IF;
 UPDATE meta_ad_creatives SET partnership_metadata=NULL WHERE workspace_id=w AND ad_id IN(SELECT ad_id FROM ctwa_fixture);
END $$;
SELECT 'PASS: partnership totals, counts, comparisons, filters, missing/changed creative identity, legacy unknown, revision and workspace boundaries';
