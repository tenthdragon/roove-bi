-- Fixtures inherited from the destination report suite; all changes roll back.
UPDATE meta_ad_creatives c SET creative_format=CASE f.n WHEN 1 THEN 'image' WHEN 2 THEN 'video' WHEN 7 THEN 'carousel' WHEN 9 THEN 'image' WHEN 13 THEN 'video' ELSE 'unknown' END
FROM ctwa_fixture f WHERE c.ad_id=f.ad_id;
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; report jsonb; parent jsonb; child jsonb; config jsonb; b text; filters jsonb; k text; a text; revision_before bigint; BEGIN
 SELECT jsonb_build_object('account_ids',jsonb_agg(account_id)) INTO config FROM ctwa_scope;
 SELECT s.account_id,ma.default_brand_id::text INTO a,b FROM ctwa_scope s JOIN meta_ad_accounts ma USING(workspace_id,account_id) WHERE s.n=1;
 k:='ctwa:'||b||':phone:+628111111111';
 FOREACH filters IN ARRAY ARRAY['{}','{"channel":"non_cpas"}','{"channel":"cpas"}','{"channel":"unknown"}','{"cep":"skin"}','{"intention":"cons"}']::jsonb[] LOOP
  report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,filters);
  FOR parent IN SELECT value FROM jsonb_array_elements(report->'groups') LOOP
   IF (SELECT sum((c#>>'{current,spend}')::numeric) FROM jsonb_array_elements(parent->'format_breakdown') c) IS DISTINCT FROM (parent#>>'{current,spend}')::numeric THEN RAISE EXCEPTION 'Child current totals do not reconcile: %',parent; END IF;
   IF (SELECT sum((c#>>'{previous,spend}')::numeric) FROM jsonb_array_elements(parent->'format_breakdown') c) IS DISTINCT FROM (parent#>>'{previous,spend}')::numeric THEN RAISE EXCEPTION 'Child previous totals do not reconcile'; END IF;
   IF (SELECT sum(jsonb_array_length(c->'ad_ids')) FROM jsonb_array_elements(parent->'format_breakdown') c) IS DISTINCT FROM jsonb_array_length(parent->'ad_ids')::bigint THEN RAISE EXCEPTION 'Child counts do not reconcile'; END IF;
  END LOOP;
 END LOOP;
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config);
 SELECT value INTO STRICT parent FROM jsonb_array_elements(report->'groups') WHERE value->>'key'=k;
 IF jsonb_array_length(parent->'format_breakdown')<>3 THEN RAISE EXCEPTION 'Expected three formats across two accounts: %',parent; END IF;
 SELECT value INTO STRICT child FROM jsonb_array_elements(parent->'format_breakdown') WHERE value->>'format'='video';
 IF child->'ad_ids'<>'["99999997302"]' OR (child#>>'{current,spend}')::numeric<>20 THEN RAISE EXCEPTION 'Video cohort incorrect'; END IF;
 -- Stale creative metadata must not label a different creative's metrics.
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'groups') g CROSS JOIN LATERAL jsonb_array_elements(g->'format_breakdown') c
  WHERE c->>'format'='unknown' AND c->'ad_ids' ? '999999973013') THEN RAISE EXCEPTION 'Stale creative classified as video'; END IF;
 -- An actual image URL gets the same breakdown as WhatsApp destinations.
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'groups') g CROSS JOIN LATERAL jsonb_array_elements(g->'format_breakdown') c
  WHERE g->>'key'='landing:https://roove.co.id/test' AND c->>'format'='image' AND c->'ad_ids' ? '99999997309') THEN RAISE EXCEPTION 'URL image breakdown missing'; END IF;
 SELECT revision INTO revision_before FROM meta_ad_report_versions WHERE workspace_id=w;
 UPDATE meta_ad_creatives SET creative_format='mixed' WHERE workspace_id=w AND account_id=a AND ad_id='99999997301';
 IF (SELECT revision FROM meta_ad_report_versions WHERE workspace_id=w)<=revision_before THEN RAISE EXCEPTION 'Format update did not invalidate report cache'; END IF;
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'groups') g CROSS JOIN LATERAL jsonb_array_elements(g->'format_breakdown') c
  WHERE g->>'key'=k AND c->>'format'='mixed' AND c->'ad_ids' ? '99999997301') THEN RAISE EXCEPTION 'Warm projection retained old format'; END IF;
 report:=get_meta_ad_report_incremental('00000000-0000-4000-8000-000000000002','1996-01-02','1996-01-02',config);
 IF jsonb_array_length(report->'groups')<>0 THEN RAISE EXCEPTION 'Workspace leak'; END IF;
 IF has_function_privilege('authenticated','public.get_meta_ad_report_incremental(uuid,date,date,jsonb,jsonb,text,text,text,text,text)','EXECUTE')
 OR has_table_privilege('authenticated','public.meta_ad_creatives','SELECT') THEN RAISE EXCEPTION 'Browser permissions expanded'; END IF;
END $$;
SELECT 'PASS: format totals, comparisons, distinct counts, URL/CTWA, stale creative, cache invalidation, filters and workspace boundaries';
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; config jsonb; report jsonb; child jsonb; a text; BEGIN
 SELECT jsonb_build_object('account_ids',jsonb_agg(account_id)) INTO config FROM ctwa_scope;
 SELECT account_id INTO a FROM ctwa_scope WHERE n=1;
 UPDATE meta_ad_daily_metrics SET creative_id=NULL WHERE workspace_id=w AND account_id=a AND ad_id='99999997309';
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config);
 SELECT c INTO STRICT child FROM jsonb_array_elements(report->'groups') g CROSS JOIN jsonb_array_elements(g->'format_breakdown') c WHERE c->'ad_ids' ? '99999997309';
 IF child->>'format'<>'image' OR child->'latest_metadata_ad_ids'<>'["99999997309"]' THEN RAISE EXCEPTION 'Missing historical ID did not use labeled current metadata: %',child; END IF;
 UPDATE meta_ad_mappings SET creative_id='999999973777' WHERE workspace_id=w AND account_id=a AND ad_id='99999997309';
 report:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config);
 SELECT c INTO STRICT child FROM jsonb_array_elements(report->'groups') g CROSS JOIN jsonb_array_elements(g->'format_breakdown') c WHERE c->'ad_ids' ? '99999997309';
 IF child->>'format'<>'unknown' OR child->'latest_metadata_ad_ids'<>'[]' THEN RAISE EXCEPTION 'Stale inventory metadata used'; END IF;
 -- Restore fixtures for the parity suite that follows.
 UPDATE meta_ad_mappings m SET creative_id=f.creative_id FROM ctwa_fixture f WHERE m.workspace_id=w AND m.account_id=a AND m.ad_id=f.ad_id AND f.n=9;
 UPDATE meta_ad_daily_metrics d SET creative_id=f.creative_id FROM ctwa_fixture f WHERE d.workspace_id=w AND d.account_id=a AND d.ad_id=f.ad_id AND f.n=9;
END $$;
SELECT 'PASS: missing historical identity uses inventory-matched latest metadata with explicit provenance; conflicts remain unknown';
