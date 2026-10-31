DO $$
DECLARE
  w uuid := '00000000-0000-4000-8000-000000000001';
  other_workspace uuid := '00000000-0000-4000-8000-000000000002';
  advertiser uuid := '10000000-0000-4000-8000-000000000003';
  entry_id bigint; platform text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', advertiser::text, false);
  INSERT INTO public.workspace_advertiser_spend_access (workspace_id,user_id,platform)
    VALUES(w,advertiser,'tiktok_ads');
  INSERT INTO public.workspace_memberships VALUES(other_workspace,advertiser,'advertiser','active');
  INSERT INTO public.workspace_advertiser_brands(workspace_id,user_id,brand_id)
    VALUES(other_workspace,advertiser,6);

  FOREACH platform IN ARRAY ARRAY['shopee_ads','tiktok_ads'] LOOP
    -- A platform grant does not authorize an unassigned brand, even when the
    -- same brand ID is assigned in another workspace.
    PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L,NULL,%L,6,%L,100,%L,NULL)',w,platform,'2026-10-08',''), 'Akses input platform atau brand');
    entry_id := public.save_manual_marketplace_ad_spend(w,NULL,platform,4,'2026-10-08',100,'',NULL);
    PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L,%s,%L,6,%L,999,%L,1)',w,entry_id,platform,'2026-10-08',''), 'Akses input platform atau brand');
    PERFORM pg_temp.assert_true((SELECT brand_id=4 AND amount=100 AND version=1 FROM public.manual_marketplace_ad_spend WHERE id=entry_id), 'Unauthorized brand edit changed the entry');

    -- Moving between two assigned brands is allowed.
    PERFORM public.save_manual_marketplace_ad_spend(w,entry_id,platform,1,'2026-10-08',110,'',1);
    DELETE FROM public.workspace_advertiser_brands WHERE workspace_id=w AND user_id=advertiser AND brand_id=1;
    -- A revoked entry cannot be laundered back into scope by changing its brand.
    PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L,%s,%L,4,%L,999,%L,2)',w,entry_id,platform,'2026-10-08',''), 'tidak tersedia');
    PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L,%s,%L,1,%L,999,%L,2)',w,entry_id,platform,'2026-10-08',''), 'Akses input platform atau brand');
    PERFORM pg_temp.expect_denied(format('SELECT public.delete_manual_marketplace_ad_spend(%L,%s,2)',w,entry_id), 'tidak tersedia');
    PERFORM pg_temp.assert_true((SELECT brand_id=1 AND amount=110 AND version=2 FROM public.manual_marketplace_ad_spend WHERE id=entry_id), 'Revoked entry was changed or deleted');

    INSERT INTO public.workspace_advertiser_brands(workspace_id,user_id,brand_id) VALUES(w,advertiser,1);
    PERFORM public.save_manual_marketplace_ad_spend(w,entry_id,platform,4,'2026-10-08',120,'',2);
    -- Existing own entries remain correctable for inactive, still-assigned brands.
    UPDATE public.brands SET is_active=false WHERE workspace_id=w AND id=4;
    PERFORM public.save_manual_marketplace_ad_spend(w,entry_id,platform,4,'2026-10-08',130,'',3);
    PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L,NULL,%L,4,%L,100,%L,NULL)',w,platform,'2026-10-09',''), 'Brand tidak aktif');
    PERFORM public.delete_manual_marketplace_ad_spend(w,entry_id,4);
    UPDATE public.brands SET is_active=true WHERE workspace_id=w AND id=4;
  END LOOP;

  DELETE FROM public.workspace_advertiser_brands WHERE workspace_id=w AND user_id=advertiser;
  PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L,NULL,%L,4,%L,100,%L,NULL)',w,'shopee_ads','2026-10-09',''), 'Akses input platform atau brand');
  PERFORM pg_temp.expect_denied(format('SELECT public.save_manual_marketplace_ad_spend(%L,NULL,%L,4,%L,100,%L,NULL)',w,'tiktok_ads','2026-10-09',''), 'Akses input platform atau brand');
END $$;
SELECT 'PASS: both platforms require the assigned brand, workspace-local grants, allowed brand corrections, revoked old/new brand denial, no-assignment denial, and own-entry deletion';
