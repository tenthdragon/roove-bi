BEGIN;
DO $$
DECLARE w uuid; account text; verifier uuid; other_w uuid; failures integer:=0;
BEGIN
 SELECT workspace_id,account_id INTO w,account FROM public.meta_ad_accounts LIMIT 1;
 SELECT id INTO verifier FROM auth.users LIMIT 1;
 SELECT id INTO other_w FROM public.workspaces WHERE id<>w LIMIT 1;
 IF EXISTS(SELECT 1 FROM public.meta_ad_mappings WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999993') THEN RAISE EXCEPTION 'Test identity collision'; END IF;
 PERFORM public.upsert_meta_ad_mappings(w,account,'[{"ad_id":"999999999999999993","ad_name":"[sendi][cons] Test","creative_id":"1","landing_page_urls":[],"auto_mapping":{"tags":[{"dimension":"cep","key":"joint","raw":"sendi","label":"Sendi","position":1,"source":"bracket","recognized":true},{"dimension":"intention","key":"cons","raw":"cons","label":"Consideration","position":2,"source":"bracket","recognized":true}],"keywords":[]}}]','inventory','2026-01-01');
 IF NOT EXISTS(SELECT 1 FROM public.meta_ad_mappings WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999993' AND cep_key='joint' AND intention_key='cons') THEN RAISE EXCEPTION 'Automatic dimensions not generated'; END IF;
 PERFORM public.set_meta_ad_mapping_overrides(w,account,'999999999999999993','{"cep":"bone"}',verifier,1);
 IF NOT EXISTS(SELECT 1 FROM public.meta_ad_mappings WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999993' AND cep_key='bone' AND intention_key='cons') THEN RAISE EXCEPTION 'Manual CEP override not used by dimension filter'; END IF;
 PERFORM public.set_meta_ad_campaign_dimensions(w,account,'[{"ad_id":"999999999999999993","campaign_id":"52","campaign_name":"Test Sales","campaign_objective":"OUTCOME_SALES"}]','2026-01-02');
 PERFORM public.set_meta_ad_campaign_dimensions(w,account,'[{"ad_id":"999999999999999993","campaign_id":"53","campaign_objective":"OUTCOME_TRAFFIC"}]','2026-01-01');
 IF (SELECT campaign_objective FROM public.meta_ad_mappings WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999993')<>'OUTCOME_SALES' THEN RAISE EXCEPTION 'Stale objective overwrote latest value'; END IF;
 PERFORM public.set_meta_ad_campaign_dimensions(w,account,'[{"ad_id":"999999999999999993","campaign_id":"52"}]','2026-01-03');
 IF (SELECT campaign_objective FROM public.meta_ad_mappings WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999993')<>'OUTCOME_SALES' THEN RAISE EXCEPTION 'Omitted objective erased matching campaign cache'; END IF;
 PERFORM public.set_meta_ad_campaign_dimensions(w,account,'[{"ad_id":"999999999999999993","campaign_id":"53"}]','2026-01-04');
 IF (SELECT campaign_objective FROM public.meta_ad_mappings WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999993') IS NOT NULL THEN RAISE EXCEPTION 'New campaign inherited previous objective'; END IF;
 BEGIN
  PERFORM public.set_meta_ad_campaign_dimensions(other_w,'act_999999999999999999','[]');
 EXCEPTION WHEN others THEN failures:=failures+1; END;
 IF failures<>1 THEN RAISE EXCEPTION 'Invalid campaign workspace/account scope accepted'; END IF;
 IF has_function_privilege('authenticated','public.set_meta_ad_campaign_dimensions(uuid,text,jsonb,timestamptz)','EXECUTE') OR has_table_privilege('authenticated','public.meta_ad_mappings','SELECT') THEN RAISE EXCEPTION 'Browser bypasses server auth'; END IF;
 RAISE NOTICE 'PASS: generated dimensions, manual overrides, campaign scope/cache/history protection and restricted grants';
END $$;
ROLLBACK;
