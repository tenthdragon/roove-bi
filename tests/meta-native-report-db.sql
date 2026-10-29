-- Compare the exact pre-241 report, including every child breakdown and null
-- metric, against the native aggregate. These fixtures also exercise current
-- creative/adset identity, historical objective changes and overlapping CEPs.
CREATE FUNCTION pg_temp.canonical_meta241(r jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE k text; a jsonb;
BEGIN
 FOREACH k IN ARRAY ARRAY['groups','coverage','facets','creatives','intentionTotals','analysisFacets'] LOOP
  IF jsonb_typeof(r->k)='array' THEN
   SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]') INTO a FROM jsonb_array_elements(r->k);
   r:=jsonb_set(r,ARRAY[k],a);
  END IF;
 END LOOP;
 RETURN r;
END $$;
DO $$ DECLARE w uuid:='00000000-0000-4000-8000-000000000001'; config jsonb; f jsonb; g text; v text; flag boolean;
 expected jsonb; actual jsonb; compact jsonb; item jsonb; kind text; b text; n int:=0;
BEGIN
 SELECT jsonb_build_object('account_ids',jsonb_agg(account_id),'include_optimization',true,'include_matrix',true) INTO config FROM ctwa_scope;
 FOREACH flag IN ARRAY ARRAY[false,true] LOOP
 FOREACH f IN ARRAY ARRAY['{}','{"channel":"non_cpas"}','{"format":"video","partnership":"partnership"}','{"cep":"not-present"}']::jsonb[] LOOP
 FOREACH g IN ARRAY ARRAY['ad','landing_page','cep_intention'] LOOP
 FOREACH v IN ARRAY ARRAY['overview','daily','trends','creatives'] LOOP
  expected:=pg_temp.meta_report_before_241(w,'1996-01-02','1996-01-02',config||jsonb_build_object('include_analysis',flag),f,NULL,g,v,'week','landing:unknown');
  actual:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config||jsonb_build_object('include_analysis',flag),f,NULL,g,v,'week','landing:unknown');
  IF pg_temp.canonical_meta241(actual) IS DISTINCT FROM pg_temp.canonical_meta241(expected) THEN RAISE EXCEPTION 'Native report mismatch: %, %, %, %',flag,f,g,v; END IF;
  n:=n+1;
 END LOOP; END LOOP; END LOOP; END LOOP;
 FOREACH f IN ARRAY ARRAY['{}','{"channel":"non_cpas","partnership":"partnership"}','{"format":"unknown"}','{"cep":"not-present"}']::jsonb[] LOOP
  expected:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config,f);
  FOREACH kind IN ARRAY ARRAY['format','optimization','partnership'] LOOP
   actual:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config||jsonb_build_object('breakdown',kind),f);
   IF actual-'groups' IS DISTINCT FROM expected-'groups' THEN RAISE EXCEPTION 'Breakdown changes parent summary/facets'; END IF;
   compact:=get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02',config||jsonb_build_object('breakdown',kind,'breakdown_only',true),f);
   IF compact-'groups' IS DISTINCT FROM jsonb_build_object('currencies',expected->'currencies') THEN RAISE EXCEPTION 'Compact response contains unrelated aggregates'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(expected->'groups') LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(compact->'groups') c WHERE c->>'key'=item->>'key' AND c->(kind||'_breakdown')=item->(kind||'_breakdown')) THEN RAISE EXCEPTION 'Deferred child differs: %, %',kind,item->>'key'; END IF;
   END LOOP;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(compact->'groups') c CROSS JOIN unnest(ARRAY['format','partnership','optimization']) other WHERE other<>kind AND c->(other||'_breakdown')<>'[]'::jsonb) THEN RAISE EXCEPTION 'Unrequested breakdown computed'; END IF;
  END LOOP;
 END LOOP;
 SELECT default_brand_id::text INTO b FROM meta_ad_accounts WHERE workspace_id=w AND account_id=(SELECT account_id FROM ctwa_scope s WHERE s.n=1);
 expected:=get_meta_brand_detail_report(w,'1996-01-02','1996-01-02',b,'non_cpas');
 actual:=get_meta_brand_detail_report_light(w,'1996-01-02','1996-01-02',b,'non_cpas');
 FOREACH kind IN ARRAY ARRAY['website','cpas','cep'] LOOP
  IF (actual->kind)-'groups' IS DISTINCT FROM (expected->kind)-'groups' THEN RAISE EXCEPTION 'Light detail changes summary: %',kind; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(actual#>ARRAY[kind,'groups']) LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(expected#>ARRAY[kind,'groups']) c WHERE c-'format_breakdown'-'optimization_breakdown'-'partnership_breakdown'=item-'format_breakdown'-'optimization_breakdown'-'partnership_breakdown') THEN RAISE EXCEPTION 'Light detail changes parent group'; END IF;
   IF item->'format_breakdown'<>'[]' OR item->'partnership_breakdown'<>'[]' OR item->'optimization_breakdown'<>'[]' THEN RAISE EXCEPTION 'Light detail computed breakdown'; END IF;
  END LOOP;
 END LOOP;
 IF has_function_privilege('authenticated','public.get_meta_brand_detail_report_light(uuid,date,date,text,text,jsonb)','EXECUTE') OR has_function_privilege('anon','public.get_meta_brand_detail_report_light(uuid,date,date,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Browser grant expanded'; END IF;
 BEGIN PERFORM get_meta_ad_report_incremental(w,'1996-01-02','1996-01-02','{"breakdown":"bad"}'); RAISE EXCEPTION 'accepted bad breakdown';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='accepted bad breakdown' THEN RAISE; END IF; END;
 RAISE NOTICE 'PASS: % exact native report comparisons, deferred breakdown reconciliation, light detail, unavailable metrics, empty cohorts and grants',n;
END $$;
