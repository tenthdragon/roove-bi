INSERT INTO public.profiles VALUES
  ('10000000-0000-4000-8000-000000000011', 'staf_ops'),
  ('10000000-0000-4000-8000-000000000012', 'advertiser'),
  ('10000000-0000-4000-8000-000000000013', 'advertiser');
INSERT INTO public.workspace_memberships VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000011', 'workspace_owner', 'active'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000012', 'advertiser', 'active'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000012', 'advertiser', 'active'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000013', 'advertiser', 'active');

DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-000000000001';
  b uuid := '00000000-0000-4000-8000-000000000002';
  owner_id uuid := '10000000-0000-4000-8000-000000000011';
  advertiser uuid := '10000000-0000-4000-8000-000000000012';
  actor uuid;
BEGIN
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.workspace_advertiser_parser_access), 'Parser must start disabled');
  PERFORM set_config('request.jwt.claim.sub', owner_id::text, false);
  PERFORM public.set_workspace_advertiser_parser_access(a,advertiser,true);
  PERFORM public.set_workspace_advertiser_parser_access(a,advertiser,true);
  PERFORM pg_temp.assert_true((SELECT count(*)=1 FROM public.workspace_advertiser_parser_access_audit), 'Retry duplicated audit');
  PERFORM pg_temp.assert_true((SELECT enabled AND changed_by=owner_id FROM public.workspace_advertiser_parser_access_audit), 'Grant missing actor');
  PERFORM pg_temp.expect_denied(format('SELECT public.set_workspace_advertiser_parser_access(%L,%L,true)',b,advertiser), 'Hanya owner');
  PERFORM pg_temp.expect_denied(format('SELECT public.set_workspace_advertiser_parser_access(%L,%L,NULL)',a,advertiser), 'tidak valid');
  PERFORM pg_temp.expect_denied(format('SELECT public.set_workspace_advertiser_parser_access(%L,%L,true)',a,owner_id), 'Advertiser tidak aktif');

  FOREACH actor IN ARRAY ARRAY[
    '10000000-0000-4000-8000-000000000002'::uuid,
    '10000000-0000-4000-8000-000000000006'::uuid,
    '10000000-0000-4000-8000-000000000010'::uuid,
    advertiser
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub',actor::text,false);
    PERFORM pg_temp.expect_denied(format('SELECT public.set_workspace_advertiser_parser_access(%L,%L,false)',a,advertiser), 'Hanya owner');
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub','',false);
  PERFORM pg_temp.expect_denied(format('SELECT public.set_workspace_advertiser_parser_access(%L,%L,true)',a,advertiser), 'Hanya owner');
END $$;

-- The real authenticated role can read only its own grant and cannot write it.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000012',false);
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM public.workspace_advertiser_parser_access), 'Own grant not visible');
SELECT pg_temp.expect_denied($q$INSERT INTO public.workspace_advertiser_parser_access(workspace_id,user_id)
  VALUES ('00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000012')$q$, 'permission denied');
SELECT pg_temp.expect_denied('DELETE FROM public.workspace_advertiser_parser_access', 'permission denied');
SELECT pg_temp.expect_denied('UPDATE public.workspace_advertiser_parser_access SET created_at=now()', 'permission denied');
SELECT pg_temp.expect_denied('SELECT * FROM public.workspace_advertiser_parser_access_audit', 'permission denied');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000013',false);
SELECT pg_temp.assert_true((SELECT count(*)=0 FROM public.workspace_advertiser_parser_access), 'Other advertiser grant leaked');
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000011',false);
SELECT public.set_workspace_advertiser_parser_access('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000012',false);
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=2 AND NOT bool_and(enabled) FROM public.workspace_advertiser_parser_access_audit), 'Revocation missing audit');

DO $$
DECLARE
  a uuid := '00000000-0000-4000-8000-000000000001';
  b uuid := '00000000-0000-4000-8000-000000000002';
  advertiser uuid := '10000000-0000-4000-8000-000000000012';
BEGIN
  PERFORM set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
  PERFORM public.set_workspace_advertiser_parser_access(a,advertiser,true);
  PERFORM public.set_workspace_advertiser_parser_access(b,advertiser,true);
  UPDATE public.workspace_memberships SET status='suspended' WHERE workspace_id=a AND user_id=advertiser;
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.workspace_advertiser_parser_access WHERE workspace_id=a), 'Suspension retained grant');
  PERFORM pg_temp.assert_true(EXISTS(SELECT 1 FROM public.workspace_advertiser_parser_access WHERE workspace_id=b), 'Other workspace grant removed');
  PERFORM pg_temp.expect_denied(format('SELECT public.set_workspace_advertiser_parser_access(%L,%L,true)',a,advertiser), 'Advertiser tidak aktif');
  UPDATE public.workspace_memberships SET status='active' WHERE workspace_id=a AND user_id=advertiser;
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.workspace_advertiser_parser_access WHERE workspace_id=a), 'Reactivation restored revoked grant');
  PERFORM public.set_workspace_advertiser_parser_access(a,advertiser,true);
  UPDATE public.workspace_memberships SET role='brand_manager' WHERE workspace_id=a AND user_id=advertiser;
  UPDATE public.workspace_memberships SET role='advertiser' WHERE workspace_id=a AND user_id=advertiser;
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.workspace_advertiser_parser_access WHERE workspace_id=a), 'Role round trip restored grant');
  DELETE FROM public.workspace_memberships WHERE workspace_id=b AND user_id=advertiser;
  PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.workspace_advertiser_parser_access), 'Membership deletion retained grant');
  PERFORM pg_temp.assert_true((SELECT NOT enabled FROM public.workspace_advertiser_parser_access_audit ORDER BY id DESC LIMIT 1), 'Cascade deletion missing audit');
END $$;
SELECT pg_temp.assert_true(NOT has_table_privilege('anon','public.workspace_advertiser_parser_access','SELECT'), 'Anonymous grant read allowed');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon','public.set_workspace_advertiser_parser_access(uuid,uuid,boolean)','EXECUTE'), 'Anonymous RPC allowed');
SELECT pg_temp.assert_true(NOT has_function_privilege('authenticated','public.clear_advertiser_parser_access()','EXECUTE'), 'Trigger callable by users');
SELECT 'PASS: parser owner-only activation, default-off, idempotent audit, own-grant RLS, direct-write denial, workspace isolation, suspension, revocation and membership cleanup';
