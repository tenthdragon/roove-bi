-- Isolated local clone only. No fixture survives this transaction.
BEGIN;
DO $$
DECLARE w uuid; other_w uuid; account text; verifier uuid; rows jsonb; renamed jsonb; failures integer:=0; n integer;
BEGIN
 SELECT workspace_id,account_id INTO w,account FROM public.meta_ad_accounts LIMIT 1;
 SELECT id INTO other_w FROM public.workspaces WHERE id<>w LIMIT 1;
 SELECT id INTO verifier FROM auth.users LIMIT 1;
 IF w IS NULL OR verifier IS NULL THEN RAISE EXCEPTION 'Local test needs an account and user'; END IF;
 IF EXISTS(SELECT 1 FROM public.meta_ad_mappings WHERE workspace_id=w AND account_id=account AND ad_id IN ('999999999999999991','999999999999999992')) THEN RAISE EXCEPTION 'Refusing test identity collision'; END IF;
 rows:='[{"ad_id":"999999999999999991","ad_name":"[novel-unit][cons][tag] creative","creative_id":"1","effective_status":"PAUSED","landing_page_urls":["https://roove.co.id/test"],"auto_mapping":{"parser_version":1,"tags":[{"dimension":"cep","key":"test-novel-unit","raw":"novel-unit","label":"Novel unit","source":"bracket","position":1,"recognized":false},{"dimension":"intention","key":"cons","raw":"cons","label":"Consideration","source":"bracket","position":2,"recognized":true}],"keywords":[{"dimension":"keyword","key":"creative","raw":"creative","label":"creative","source":"keyword","position":0,"recognized":false}],"free_text":"creative","issues":[]}}]'::jsonb;
 PERFORM public.upsert_meta_ad_mappings(w,account,rows,'inventory','2026-01-01');
 IF (SELECT review_status FROM public.meta_ad_mapping_units WHERE workspace_id=w AND dimension='cep' AND unit_key='test-novel-unit')<>'new' THEN RAISE EXCEPTION 'New unit not registered'; END IF;
 SELECT count(*) INTO n FROM public.meta_ad_mapping_members WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999991';
 IF n<>3 THEN RAISE EXCEPTION 'Granular memberships missing'; END IF;
 PERFORM public.upsert_meta_ad_mappings(w,account,rows,'inventory','2026-01-02');
 IF (SELECT revision FROM public.meta_ad_mappings WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999991')<>1 THEN RAISE EXCEPTION 'Repeat observation created a duplicate revision'; END IF;
 PERFORM public.set_meta_ad_mapping_overrides(w,account,'999999999999999991','{"cep":"bone"}',verifier,1);
 BEGIN
  PERFORM public.set_meta_ad_mapping_overrides(w,account,'999999999999999991','{"cep":"skin"}',verifier,1);
 EXCEPTION WHEN others THEN failures:=failures+1; END;
 IF failures<>1 THEN RAISE EXCEPTION 'Stale manual edit accepted'; END IF;
 UPDATE public.meta_ad_mapping_units SET review_status='confirmed',label='Reviewed label' WHERE workspace_id=w AND dimension='cep' AND unit_key='test-novel-unit';
 renamed:=jsonb_set(jsonb_set(rows,'{0,ad_name}','"[novel-unit][cons][tag] renamed"'),'{0,creative_id}','"2"');
 PERFORM public.upsert_meta_ad_mappings(w,account,renamed,'inventory','2026-01-03');
 IF (SELECT overrides FROM public.meta_ad_mappings WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999991')<>'{"cep":"bone"}'::jsonb THEN RAISE EXCEPTION 'Sync erased manual override'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.meta_ad_mapping_members WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999991' AND dimension='cep' AND unit_key='bone' AND source='manual') THEN RAISE EXCEPTION 'Manual membership erased'; END IF;
 IF (SELECT label FROM public.meta_ad_mapping_units WHERE workspace_id=w AND dimension='cep' AND unit_key='test-novel-unit')<>'Reviewed label' THEN RAISE EXCEPTION 'Sync erased reviewed unit'; END IF;
 SELECT count(*) INTO n FROM public.meta_ad_mapping_observations WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999991';
 IF n<>2 THEN RAISE EXCEPTION 'Naming/creative change history not retained'; END IF;
 PERFORM public.upsert_meta_ad_mappings(w,account,rows,'cache','2026-01-04');
 PERFORM public.upsert_meta_ad_mappings(w,account,rows,'inventory','2025-12-31');
 IF (SELECT creative_id FROM public.meta_ad_mappings WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999991')<>'2' THEN RAISE EXCEPTION 'Cache/stale sync overwrote inventory'; END IF;
 PERFORM public.upsert_meta_ad_mappings(w,account,jsonb_set(renamed,'{0,ad_id}','"999999999999999992"'),'inventory','2026-01-03');
 SELECT count(*) INTO n FROM public.meta_ad_mappings WHERE workspace_id=w AND account_id=account AND ad_id IN ('999999999999999991','999999999999999992');
 IF n<>2 THEN RAISE EXCEPTION 'Same-named ads collapsed into one identity'; END IF;
 BEGIN
  PERFORM public.upsert_meta_ad_mappings(other_w,'act_999999999999999999',rows,'inventory');
 EXCEPTION WHEN others THEN failures:=failures+1; END;
 IF failures<>2 THEN RAISE EXCEPTION 'Invalid workspace/account scope accepted'; END IF;
 BEGIN
  PERFORM public.upsert_meta_ad_mappings(w,account,jsonb_set(rows,'{0,auto_mapping,tags,0,key}','""'),'inventory','2026-01-05');
 EXCEPTION WHEN others THEN failures:=failures+1; END;
 IF failures<>3 THEN RAISE EXCEPTION 'Malformed token accepted'; END IF;
 IF (SELECT creative_id FROM public.meta_ad_mappings WHERE workspace_id=w AND account_id=account AND ad_id='999999999999999991')<>'2' THEN RAISE EXCEPTION 'Failed mapping destroyed previous snapshot'; END IF;
 IF has_function_privilege('authenticated','public.upsert_meta_ad_mappings(uuid,text,jsonb,text,timestamptz)','EXECUTE') OR has_function_privilege('authenticated','public.set_meta_ad_mapping_overrides(uuid,text,text,jsonb,uuid,integer)','EXECUTE') THEN RAISE EXCEPTION 'Browser can bypass mapping authorization'; END IF;
 FOR account IN SELECT unnest(ARRAY['meta_ad_mappings','meta_ad_mapping_observations','meta_ad_mapping_units','meta_ad_mapping_members','meta_ad_mapping_sync_state']) LOOP
  IF has_table_privilege('authenticated','public.'||account,'SELECT') OR has_table_privilege('anon','public.'||account,'INSERT') THEN RAISE EXCEPTION 'Browser grants leaked for %',account; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=('public.'||account)::regclass) THEN RAISE EXCEPTION 'RLS disabled on %',account; END IF;
 END LOOP;
 RAISE NOTICE 'PASS: open vocabulary, stable ad identity, idempotency, history, preserved corrections, atomic validation, stale/cache protection, workspace/RLS/grants';
END $$;
ROLLBACK;
