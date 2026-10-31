CREATE FUNCTION pg_temp.assert_true(value boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
  IF value IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF;
END $$;
CREATE FUNCTION pg_temp.expect_denied(command text, expected text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE denied boolean := false;
BEGIN
  BEGIN EXECUTE command;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM !~ expected THEN RAISE; END IF;
    denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Unexpectedly allowed: %', command; END IF;
END $$;

INSERT INTO public.workspaces VALUES
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002');
INSERT INTO public.manual_marketplace_ad_spend_cutovers
SELECT id, '2026-10-01', now() FROM public.workspaces;
INSERT INTO public.brands
SELECT n, id, true FROM public.workspaces CROSS JOIN generate_series(1, 10) n;
INSERT INTO public.profiles VALUES
  ('10000000-0000-4000-8000-000000000001', 'owner'),
  ('10000000-0000-4000-8000-000000000002', 'admin'),
  ('10000000-0000-4000-8000-000000000003', 'advertiser'),
  ('10000000-0000-4000-8000-000000000004', 'advertiser'),
  ('10000000-0000-4000-8000-000000000005', 'staf_ops');
INSERT INTO public.workspace_memberships VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'admin', 'active'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'advertiser', 'active'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000004', 'advertiser', 'active'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000005', 'workspace_owner', 'active'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'staf_ops', 'active');
INSERT INTO public.workspace_advertiser_spend_access (workspace_id, user_id, platform)
VALUES ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'shopee_ads');
INSERT INTO public.workspace_advertiser_brands (workspace_id, user_id, brand_id) VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 1),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 4);

DO $$
DECLARE
  workspace_a uuid := '00000000-0000-4000-8000-000000000001';
  workspace_b uuid := '00000000-0000-4000-8000-000000000002';
  actor uuid; platform text; entry_id bigint; actor_index integer := 0;
BEGIN
  -- Platform owner (without membership), admin and workspace owner need no grant.
  FOREACH actor IN ARRAY ARRAY[
    '10000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000002'::uuid,
    '10000000-0000-4000-8000-000000000005'::uuid
  ] LOOP
    actor_index := actor_index + 1;
    PERFORM set_config('request.jwt.claim.sub', actor::text, false);
    FOREACH platform IN ARRAY ARRAY['shopee_ads', 'tiktok_ads'] LOOP
      entry_id := public.save_manual_marketplace_ad_spend(workspace_a, NULL, platform, actor_index, '2026-10-07', 150000, '', NULL);
      PERFORM pg_temp.assert_true((SELECT created_by = actor AND updated_by = actor AND version = 1 FROM public.manual_marketplace_ad_spend WHERE id = entry_id), 'Creator identity must be retained');
      PERFORM public.save_manual_marketplace_ad_spend(workspace_a, entry_id, platform, actor_index, '2026-10-07', 0, 'correction', 1);
      PERFORM pg_temp.assert_true((SELECT amount = 0 AND version = 2 FROM public.manual_marketplace_ad_spend WHERE id = entry_id), 'Owner/admin zero correction failed');
      PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L, %s, %L, %s, %L, 5, %L, 1)', workspace_a, entry_id, platform, actor_index, '2026-10-07', ''), 'sudah berubah');
      PERFORM pg_temp.expect_denied(format('SELECT public.delete_manual_marketplace_ad_spend(%L, %s, 1)', workspace_a, entry_id), 'sudah berubah');
      PERFORM public.delete_manual_marketplace_ad_spend(workspace_a, entry_id, 2);
      PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.manual_marketplace_ad_spend WHERE id = entry_id), 'Own deletion failed');
    END LOOP;
  END LOOP;

  -- Keep one owner entry to verify other accounts cannot edit/delete it.
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
  entry_id := public.save_manual_marketplace_ad_spend(workspace_a, NULL, 'shopee_ads', 1, '2026-10-07', 50, '', NULL);
  FOREACH actor IN ARRAY ARRAY['10000000-0000-4000-8000-000000000002'::uuid, '10000000-0000-4000-8000-000000000003'::uuid] LOOP
    PERFORM set_config('request.jwt.claim.sub', actor::text, false);
    PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L, %s, %L, 1, %L, 999, %L, 1)', workspace_a, entry_id, 'shopee_ads', '2026-10-07', ''), 'bukan milik Anda');
    PERFORM pg_temp.expect_denied(format('SELECT public.delete_manual_marketplace_ad_spend(%L, %s, 1)', workspace_a, entry_id), 'bukan milik Anda');
    PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L, NULL, %L, 1, %L, 999, %L, NULL)', workspace_a, 'shopee_ads', '2026-10-07', ''), 'sudah ada');
  END LOOP;
  PERFORM pg_temp.assert_true((SELECT amount = 50 AND version = 1 FROM public.manual_marketplace_ad_spend WHERE id = entry_id), 'Another creator entry changed');

  -- Advertiser stays limited to its grant, including corrections/deletions.
  entry_id := public.save_manual_marketplace_ad_spend(workspace_a, NULL, 'shopee_ads', 4, '2026-10-07', 100, '', NULL);
  PERFORM public.save_manual_marketplace_ad_spend(workspace_a, entry_id, 'shopee_ads', 4, '2026-10-07', 120, '', 1);
  PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L, NULL, %L, 4, %L, 100, %L, NULL)', workspace_a, 'tiktok_ads', '2026-10-07', ''), 'Akses input platform');
  DELETE FROM public.workspace_advertiser_spend_access;
  PERFORM pg_temp.expect_denied(format('SELECT public.delete_manual_marketplace_ad_spend(%L, %s, 2)', workspace_a, entry_id), 'tidak tersedia');
  INSERT INTO public.workspace_advertiser_spend_access (workspace_id, user_id, platform) VALUES (workspace_a, actor, 'shopee_ads');
  PERFORM public.delete_manual_marketplace_ad_spend(workspace_a, entry_id, 2);
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
  PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L, NULL, %L, 4, %L, 100, %L, NULL)', workspace_a, 'shopee_ads', '2026-10-07', ''), 'Akses input platform');

  -- Admin authority is workspace-local and requires active membership.
  PERFORM set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
  PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L, NULL, %L, 5, %L, 100, %L, NULL)', workspace_b, 'shopee_ads', '2026-10-07', ''), 'Akses input platform');
  entry_id := public.save_manual_marketplace_ad_spend(workspace_a, NULL, 'tiktok_ads', 5, '2026-10-07', 100, '', NULL);
  PERFORM pg_temp.expect_denied(format('SELECT public.delete_manual_marketplace_ad_spend(%L, %s, 1)', workspace_b, entry_id), 'tidak tersedia');
  UPDATE public.workspace_memberships SET status = 'inactive' WHERE user_id = auth.uid() AND workspace_id = workspace_a;
  PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L, %s, %L, 5, %L, 200, %L, 1)', workspace_a, entry_id, 'tiktok_ads', '2026-10-07', ''), 'Akses input platform');
  PERFORM pg_temp.expect_denied(format('SELECT public.delete_manual_marketplace_ad_spend(%L, %s, 1)', workspace_a, entry_id), 'tidak tersedia');
  UPDATE public.workspace_memberships SET status = 'active' WHERE user_id = auth.uid() AND workspace_id = workspace_a;
  UPDATE public.brands SET is_active = false WHERE workspace_id = workspace_a AND id = 5;
  PERFORM public.save_manual_marketplace_ad_spend(workspace_a, entry_id, 'tiktok_ads', 5, '2026-10-07', 120, '', 1);
  PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L, NULL, %L, 5, %L, 100, %L, NULL)', workspace_a, 'shopee_ads', '2026-10-08', ''), 'Brand tidak aktif');
  PERFORM public.delete_manual_marketplace_ad_spend(workspace_a, entry_id, 2);
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L, NULL, %L, 6, %L, 100, %L, NULL)', workspace_a, 'shopee_ads', '2026-10-07', ''), 'tidak valid');
END $$;

SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.save_manual_marketplace_ad_spend(uuid,bigint,text,integer,date,numeric,text,integer)', 'EXECUTE'), 'Anonymous save must be denied');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'public.delete_manual_marketplace_ad_spend(uuid,bigint,integer)', 'EXECUTE'), 'Anonymous delete must be denied');
-- Exercise the security-definer functions through the real authenticated role.
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
SELECT public.save_manual_marketplace_ad_spend('00000000-0000-4000-8000-000000000001', NULL, 'tiktok_ads', 6, '2026-10-07', 100, '', NULL) AS authenticated_entry_id \gset
SELECT public.delete_manual_marketplace_ad_spend('00000000-0000-4000-8000-000000000001', :authenticated_entry_id, 1);
RESET ROLE;
SELECT 'PASS: owner/admin input, own corrections/deletions, advertiser grants, workspace isolation, inactive membership, version checks, anonymous denial, authenticated execution';
