INSERT INTO public.profiles VALUES
  ('10000000-0000-4000-8000-000000000006', 'brand_manager'),
  ('10000000-0000-4000-8000-000000000007', 'advertiser');
INSERT INTO public.workspace_memberships VALUES
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006', 'brand_manager', 'active'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000006', 'staf_ops', 'active'),
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000007', 'brand_manager', 'active');

DO $$
DECLARE
  w uuid := '00000000-0000-4000-8000-000000000001';
  other_workspace uuid := '00000000-0000-4000-8000-000000000002';
  manager uuid; platform text; entry_id bigint; owner_entry_id bigint;
BEGIN
  -- Active workspace membership, rather than the global profile role, grants
  -- both platforms and allows changing between brands without assignments.
  FOREACH manager IN ARRAY ARRAY[
    '10000000-0000-4000-8000-000000000006'::uuid,
    '10000000-0000-4000-8000-000000000007'::uuid
  ] LOOP
    PERFORM set_config('request.jwt.claim.sub', manager::text, false);
    FOREACH platform IN ARRAY ARRAY['shopee_ads','tiktok_ads'] LOOP
      entry_id := public.save_manual_marketplace_ad_spend(w,NULL,platform,7,'2026-10-09',100,'',NULL);
      PERFORM public.save_manual_marketplace_ad_spend(w,entry_id,platform,8,'2026-10-09',0,'correction',1);
      PERFORM pg_temp.assert_true((SELECT brand_id=8 AND amount=0 AND version=2 AND created_by=manager FROM public.manual_marketplace_ad_spend WHERE id=entry_id), 'Brand Manager correction failed');
      PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L,%s,%L,8,%L,999,%L,1)',w,entry_id,platform,'2026-10-09',''), 'sudah berubah');
      PERFORM pg_temp.expect_denied(format('SELECT public.delete_manual_marketplace_ad_spend(%L,%s,1)',w,entry_id), 'sudah berubah');
      PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L,NULL,%L,8,%L,100,%L,NULL)',other_workspace,platform,'2026-10-09',''), 'Akses input platform');
      PERFORM pg_temp.expect_denied(format('SELECT public.delete_manual_marketplace_ad_spend(%L,%s,2)',other_workspace,entry_id), 'tidak tersedia');

      UPDATE public.workspace_memberships SET status='inactive' WHERE workspace_id=w AND user_id=manager;
      PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L,%s,%L,8,%L,999,%L,2)',w,entry_id,platform,'2026-10-09',''), 'Akses input platform');
      PERFORM pg_temp.expect_denied(format('SELECT public.delete_manual_marketplace_ad_spend(%L,%s,2)',w,entry_id), 'tidak tersedia');
      UPDATE public.workspace_memberships SET status='active',role='advertiser' WHERE workspace_id=w AND user_id=manager;
      PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L,%s,%L,8,%L,999,%L,2)',w,entry_id,platform,'2026-10-09',''), 'Akses input platform');
      PERFORM pg_temp.expect_denied(format('SELECT public.delete_manual_marketplace_ad_spend(%L,%s,2)',w,entry_id), 'tidak tersedia');
      UPDATE public.workspace_memberships SET role='brand_manager' WHERE workspace_id=w AND user_id=manager;
      PERFORM public.delete_manual_marketplace_ad_spend(w,entry_id,2);
      PERFORM pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM public.manual_marketplace_ad_spend WHERE id=entry_id), 'Brand Manager deletion failed');
    END LOOP;

    SELECT e.id INTO STRICT owner_entry_id FROM public.manual_marketplace_ad_spend e
      WHERE e.workspace_id=w AND e.platform='shopee_ads' AND e.brand_id=1 AND e.spend_date='2026-10-07';
    PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L,%s,%L,1,%L,999,%L,1)',w,owner_entry_id,'shopee_ads','2026-10-07',''), 'bukan milik Anda');
    PERFORM pg_temp.expect_denied(format('SELECT public.delete_manual_marketplace_ad_spend(%L,%s,1)',w,owner_entry_id), 'bukan milik Anda');
  END LOOP;
END $$;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', false);
SELECT public.save_manual_marketplace_ad_spend('00000000-0000-4000-8000-000000000001',NULL,'shopee_ads',7,'2026-10-09',100,'',NULL) AS manager_entry_id \gset
SELECT public.delete_manual_marketplace_ad_spend('00000000-0000-4000-8000-000000000001',:manager_entry_id,1);
RESET ROLE;
SELECT 'PASS: Brand Manager both platforms/all brands, own corrections/deletions, active workspace role, inactive and demoted denial, workspace isolation and authenticated execution';
