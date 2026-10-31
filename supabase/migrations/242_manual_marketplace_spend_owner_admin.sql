BEGIN;

-- Owners and active workspace admins may enter either platform without an
-- advertiser grant. Corrections/deletions remain limited to the creator, with
-- version checks and the existing projection/audit triggers unchanged.
CREATE OR REPLACE FUNCTION public.save_manual_marketplace_ad_spend(
  p_workspace_id uuid, p_entry_id bigint, p_platform text, p_brand_id integer,
  p_spend_date date, p_amount numeric, p_note text, p_expected_version integer
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id bigint; v_cutover date;
BEGIN
  IF auth.uid() IS NULL OR p_platform NOT IN ('shopee_ads', 'tiktok_ads') THEN
    RAISE EXCEPTION 'Input biaya iklan tidak valid.';
  END IF;
  SELECT starts_on INTO v_cutover FROM public.manual_marketplace_ad_spend_cutovers
  WHERE workspace_id = p_workspace_id;
  IF v_cutover IS NULL OR p_spend_date IS NULL OR p_spend_date < v_cutover
     OR p_spend_date > (now() AT TIME ZONE 'Asia/Jakarta')::date
     OR p_amount IS NULL OR p_amount < 0 OR p_amount > 1000000000000
     OR length(coalesce(p_note, '')) > 500 THEN
    RAISE EXCEPTION 'Tanggal, jumlah, atau catatan input tidak valid.';
  END IF;
  IF NOT (public.workspace_has_role(p_workspace_id, ARRAY['workspace_owner', 'admin']) OR EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    JOIN public.workspace_advertiser_spend_access a
      ON a.workspace_id = m.workspace_id AND a.user_id = m.user_id
    WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
      AND m.role = 'advertiser' AND m.status = 'active' AND a.platform = p_platform
  )) THEN RAISE EXCEPTION 'Akses input platform ini tidak tersedia.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.brands b
    WHERE b.workspace_id = p_workspace_id AND b.id = p_brand_id
      AND (b.is_active OR (p_entry_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.manual_marketplace_ad_spend e
        WHERE e.id = p_entry_id AND e.workspace_id = p_workspace_id
          AND e.brand_id = p_brand_id AND e.created_by = auth.uid()
      )))) THEN
    RAISE EXCEPTION 'Brand tidak aktif atau bukan milik workspace ini.';
  END IF;

  IF p_entry_id IS NULL THEN
    INSERT INTO public.manual_marketplace_ad_spend
      (workspace_id, platform, brand_id, spend_date, amount, note, created_by, updated_by)
    VALUES (p_workspace_id, p_platform, p_brand_id, p_spend_date, p_amount,
      coalesce(p_note, ''), auth.uid(), auth.uid())
    ON CONFLICT (workspace_id, platform, brand_id, spend_date) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Input untuk tanggal dan brand ini sudah ada. Muat ulang data.'; END IF;
  ELSE
    UPDATE public.manual_marketplace_ad_spend
    SET brand_id = p_brand_id, spend_date = p_spend_date, amount = p_amount,
        note = coalesce(p_note, ''), updated_by = auth.uid(), updated_at = now(),
        version = version + 1
    WHERE id = p_entry_id AND workspace_id = p_workspace_id AND platform = p_platform
      AND created_by = auth.uid() AND version = p_expected_version
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Input tidak tersedia, bukan milik Anda, atau sudah berubah. Muat ulang data.'; END IF;
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.save_manual_marketplace_ad_spend(uuid, bigint, text, integer, date, numeric, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_manual_marketplace_ad_spend(uuid, bigint, text, integer, date, numeric, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_manual_marketplace_ad_spend(
  p_workspace_id uuid, p_entry_id bigint, p_expected_version integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_deleted public.manual_marketplace_ad_spend%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi login tidak ditemukan.'; END IF;
  DELETE FROM public.manual_marketplace_ad_spend e
  USING public.manual_marketplace_ad_spend_cutovers c
  WHERE e.id = p_entry_id AND e.workspace_id = p_workspace_id
    AND e.created_by = auth.uid() AND e.version = p_expected_version
    AND c.workspace_id = p_workspace_id
    AND (public.workspace_has_role(p_workspace_id, ARRAY['workspace_owner', 'admin']) OR EXISTS (
      SELECT 1 FROM public.workspace_memberships m
      JOIN public.workspace_advertiser_spend_access a
        ON a.workspace_id = m.workspace_id AND a.user_id = m.user_id
      WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
        AND m.role = 'advertiser' AND m.status = 'active' AND a.platform = e.platform
    ))
  RETURNING e.* INTO v_deleted;
  IF v_deleted.id IS NULL THEN RAISE EXCEPTION 'Input tidak tersedia, bukan milik Anda, atau sudah berubah. Muat ulang data.'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.delete_manual_marketplace_ad_spend(uuid, bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_manual_marketplace_ad_spend(uuid, bigint, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
