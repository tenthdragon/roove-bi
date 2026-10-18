-- Run only against a local clone or isolated staging. Every test rolls back.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('roove_local','roove_staging_history')) THEN RAISE EXCEPTION 'Nonproduction database required'; END IF;
END $$;
SELECT set_config('test.owner',(SELECT id::text FROM public.profiles WHERE role='owner' LIMIT 1),true);
SELECT set_config('test.other',(SELECT id::text FROM public.profiles WHERE id::text<>current_setting('test.owner') LIMIT 1),true);
SELECT set_config('test.workspace',(SELECT id::text FROM public.workspaces WHERE status='active' AND settings->'growth_execution_enabled'='true'::jsonb LIMIT 1),true);
SELECT set_config('test.other_workspace',(SELECT id::text FROM public.workspaces WHERE id::text<>current_setting('test.workspace') LIMIT 1),true);
SELECT set_config('test.case',gen_random_uuid()::text,true);
UPDATE public.profiles SET role='owner' WHERE id::text=current_setting('test.other');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',current_setting('test.owner'),true);
SELECT public.growth_case_create(current_setting('test.workspace')::uuid,current_setting('test.case')::uuid,gen_random_uuid());
DO $$
DECLARE r public.growth_cases; newer public.growth_cases; a jsonb;
BEGIN
 SELECT * INTO STRICT r FROM public.growth_cases WHERE id::text=current_setting('test.case');
 a:=r.attempts||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'hypothesis',r.problem,'action',r.problem,'result',r.problem));
 newer:=public.growth_case_save(r.workspace_id,r.id,r.version,'Test kasus','open',r.problem,a);
 IF jsonb_array_length(newer.attempts)<>2 OR newer.attempts->0<>r.attempts->0 THEN RAISE EXCEPTION 'Earlier attempt changed'; END IF;
 BEGIN
  PERFORM public.growth_case_save(r.workspace_id,r.id,r.version,'Stale','open',r.problem,a);
  RAISE EXCEPTION 'Expected stale conflict';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'Conflict:%' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.growth_case_save(r.workspace_id,r.id,newer.version,'Removed history','open',r.problem,r.attempts);
  RAISE EXCEPTION 'Expected removal rejection';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'Attempts cannot be removed%' THEN RAISE; END IF; END;
 newer:=public.growth_case_save(r.workspace_id,r.id,newer.version,'Test kasus','solved',r.problem,a);
 IF newer.status<>'solved' THEN RAISE EXCEPTION 'Solve failed'; END IF;
 newer:=public.growth_case_save(r.workspace_id,r.id,newer.version,'Test kasus','open',r.problem,a);
 IF newer.status<>'open' THEN RAISE EXCEPTION 'Reopen failed'; END IF;
 BEGIN
  PERFORM public.growth_case_save(current_setting('test.other_workspace')::uuid,r.id,newer.version,'Cross workspace','open',r.problem,a);
  RAISE EXCEPTION 'Expected workspace rejection';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Forbidden' THEN RAISE; END IF; END;
 IF public.growth_case_document_valid(jsonb_build_object('type','doc','content',jsonb_build_array(jsonb_build_object('type','image','attrs',jsonb_build_object('src','javascript:alert(1)')))),r.id) THEN RAISE EXCEPTION 'Unsafe image accepted'; END IF;
END $$;
INSERT INTO storage.objects(bucket_id,name) VALUES('growth-case-images',current_setting('test.workspace')||'/'||current_setting('test.owner')||'/'||current_setting('test.case')||'/test.png');
SELECT set_config('request.jwt.claim.sub',current_setting('test.other'),true);
DO $$ BEGIN
 IF NOT public.growth_has_permission(current_setting('test.workspace')::uuid,'tab:growth-work') THEN RAISE EXCEPTION 'Second user must have module permission for ownership test'; END IF;
 IF EXISTS(SELECT 1 FROM public.growth_cases WHERE id::text=current_setting('test.case')) THEN RAISE EXCEPTION 'Another owner can read case'; END IF;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='growth-case-images' AND name LIKE '%'||current_setting('test.case')||'%') THEN RAISE EXCEPTION 'Another owner can read image'; END IF;
 BEGIN
  PERFORM public.growth_case_save(current_setting('test.workspace')::uuid,current_setting('test.case')::uuid,4,'Other owner','open','{"type":"doc"}','[]');
  RAISE EXCEPTION 'Expected owner rejection';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'Forbidden' THEN RAISE; END IF; END;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('growth-case-images',current_setting('test.workspace')||'/'||current_setting('test.owner')||'/'||current_setting('test.case')||'/other.png');
  RAISE EXCEPTION 'Expected image rejection';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
