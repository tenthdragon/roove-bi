BEGIN;

-- Roove and Apurva both switch to advertiser-entered Shopee/TikTok spend.
CREATE TABLE public.manual_marketplace_ad_spend_cutovers (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.manual_marketplace_ad_spend_cutovers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_marketplace_ad_spend_cutovers FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.manual_marketplace_ad_spend_cutovers TO service_role;
INSERT INTO public.manual_marketplace_ad_spend_cutovers (workspace_id, starts_on)
SELECT id, DATE '2026-10-01' FROM public.workspaces WHERE slug IN ('roove', 'apurva');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.manual_marketplace_ad_spend_cutovers) <> 2 THEN
    RAISE EXCEPTION 'Roove and Apurva workspaces must both exist for manual ad spend cutover.';
  END IF;
END $$;

CREATE TABLE public.workspace_advertiser_spend_access (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('shopee_ads', 'tiktok_ads')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id, platform),
  FOREIGN KEY (workspace_id, user_id)
    REFERENCES public.workspace_memberships(workspace_id, user_id) ON DELETE CASCADE
);
ALTER TABLE public.workspace_advertiser_spend_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_advertiser_spend_access FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workspace_advertiser_spend_access TO service_role;

CREATE TABLE public.workspace_advertiser_spend_access_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  before_platforms text[] NOT NULL,
  after_platforms text[] NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_advertiser_spend_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_advertiser_spend_access_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.workspace_advertiser_spend_access_audit TO service_role;

CREATE FUNCTION public.set_workspace_advertiser_spend_access(
  p_workspace_id uuid, p_user_id uuid, p_platforms text[]
) RETURNS text[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_before text[]; v_after text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.workspace_has_role(p_workspace_id, ARRAY['workspace_owner']) THEN
    RAISE EXCEPTION 'Hanya owner workspace yang dapat mengatur akses input iklan.';
  END IF;
  IF p_platforms IS NULL OR cardinality(p_platforms) > 2
     OR array_position(p_platforms, NULL) IS NOT NULL
     OR EXISTS (SELECT 1 FROM unnest(p_platforms) p WHERE p NOT IN ('shopee_ads', 'tiktok_ads')) THEN
    RAISE EXCEPTION 'Pilihan platform tidak valid.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.manual_marketplace_ad_spend_cutovers WHERE workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'Input biaya iklan belum aktif untuk workspace ini.';
  END IF;

  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  PERFORM 1 FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND user_id = p_user_id
      AND role = 'advertiser' AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Advertiser tidak aktif di workspace ini.'; END IF;

  SELECT coalesce(array_agg(platform ORDER BY platform), '{}') INTO v_before
  FROM public.workspace_advertiser_spend_access
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
  SELECT coalesce(array_agg(DISTINCT p ORDER BY p), '{}') INTO v_after FROM unnest(p_platforms) p;
  IF v_before = v_after THEN RETURN v_after; END IF;

  DELETE FROM public.workspace_advertiser_spend_access
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND NOT (platform = ANY(v_after));
  INSERT INTO public.workspace_advertiser_spend_access (workspace_id, user_id, platform, created_by)
  SELECT p_workspace_id, p_user_id, p, auth.uid() FROM unnest(v_after) p ON CONFLICT DO NOTHING;
  INSERT INTO public.workspace_advertiser_spend_access_audit
    (workspace_id, user_id, before_platforms, after_platforms, changed_by)
  VALUES (p_workspace_id, p_user_id, v_before, v_after, auth.uid());
  RETURN v_after;
END $$;
REVOKE ALL ON FUNCTION public.set_workspace_advertiser_spend_access(uuid, uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_workspace_advertiser_spend_access(uuid, uuid, text[]) TO authenticated;

CREATE FUNCTION public.clear_advertiser_spend_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_before text[];
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role OR OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT coalesce(array_agg(platform ORDER BY platform), '{}') INTO v_before
    FROM public.workspace_advertiser_spend_access
    WHERE workspace_id = OLD.workspace_id AND user_id = OLD.user_id;
    DELETE FROM public.workspace_advertiser_spend_access
    WHERE workspace_id = OLD.workspace_id AND user_id = OLD.user_id;
    IF cardinality(v_before) > 0 THEN
      INSERT INTO public.workspace_advertiser_spend_access_audit
        (workspace_id, user_id, before_platforms, after_platforms, changed_by)
      VALUES (OLD.workspace_id, OLD.user_id, v_before, '{}', auth.uid());
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clear_advertiser_spend_access() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER clear_advertiser_spend_access
AFTER UPDATE OF role, status ON public.workspace_memberships
FOR EACH ROW EXECUTE FUNCTION public.clear_advertiser_spend_access();

CREATE TABLE public.manual_marketplace_ad_spend (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('shopee_ads', 'tiktok_ads')),
  brand_id integer NOT NULL,
  spend_date date NOT NULL,
  amount numeric(18, 2) NOT NULL CHECK (amount >= 0),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  updated_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, platform, brand_id, spend_date),
  FOREIGN KEY (workspace_id, brand_id) REFERENCES public.brands(workspace_id, id)
);
CREATE INDEX manual_marketplace_ad_spend_workspace_date_idx
ON public.manual_marketplace_ad_spend (workspace_id, spend_date DESC);
ALTER TABLE public.manual_marketplace_ad_spend ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_marketplace_ad_spend FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.manual_marketplace_ad_spend TO service_role;

CREATE TABLE public.manual_marketplace_ad_spend_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id bigint NOT NULL,
  workspace_id uuid NOT NULL,
  platform text NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  before_value jsonb,
  after_value jsonb,
  changed_by uuid NOT NULL REFERENCES public.profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX manual_marketplace_ad_spend_audit_workspace_idx
ON public.manual_marketplace_ad_spend_audit (workspace_id, changed_at DESC);
ALTER TABLE public.manual_marketplace_ad_spend_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_marketplace_ad_spend_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.manual_marketplace_ad_spend_audit TO service_role;

ALTER TABLE public.daily_ads_spend ADD COLUMN manual_marketplace_entry_id bigint;
CREATE UNIQUE INDEX daily_ads_spend_manual_marketplace_entry_key
ON public.daily_ads_spend (manual_marketplace_entry_id)
WHERE manual_marketplace_entry_id IS NOT NULL;

-- Keep the original rows recoverable, then remove their contribution from BI.
-- Facebook CPAS is Meta API spend and deliberately remains untouched. Shopee
-- Live is a separate stream and also remains untouched.
CREATE TABLE public.manual_marketplace_legacy_spend_archive (
  original_id integer PRIMARY KEY,
  workspace_id uuid NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  original_row jsonb NOT NULL
);
ALTER TABLE public.manual_marketplace_legacy_spend_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_marketplace_legacy_spend_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.manual_marketplace_legacy_spend_archive TO service_role;
INSERT INTO public.manual_marketplace_legacy_spend_archive (original_id, workspace_id, original_row)
SELECT ads.id, ads.workspace_id, to_jsonb(ads)
FROM public.daily_ads_spend ads
JOIN public.manual_marketplace_ad_spend_cutovers cutover USING (workspace_id)
WHERE ads.date >= cutover.starts_on
  AND (ads.data_source IN ('google_sheets', 'xlsx_upload', 'shopee_ads_api')
       OR (ads.data_source IS NULL AND ads.import_id IS NOT NULL))
  AND (
    (ads.source ILIKE '%shopee%' AND ads.source NOT ILIKE '%live%' AND ads.source NOT ILIKE '%cpas%' AND ads.source NOT ILIKE '%facebook%')
    OR (ads.source ILIKE '%tiktok%')
  );
DELETE FROM public.daily_ads_spend ads
USING public.manual_marketplace_legacy_spend_archive archive
WHERE ads.id = archive.original_id;

-- Importers filter these rows too, but this database guard protects the
-- cutover if an older worker or upload endpoint is still running.
CREATE FUNCTION public.skip_legacy_marketplace_ad_spend() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.data_source IN ('google_sheets', 'xlsx_upload', 'shopee_ads_api')
      OR (NEW.data_source IS NULL AND NEW.import_id IS NOT NULL))
     AND EXISTS (
       SELECT 1 FROM public.manual_marketplace_ad_spend_cutovers c
       WHERE c.workspace_id = NEW.workspace_id AND NEW.date >= c.starts_on
     )
     AND (
       (NEW.source ILIKE '%shopee%' AND NEW.source NOT ILIKE '%live%'
        AND NEW.source NOT ILIKE '%cpas%' AND NEW.source NOT ILIKE '%facebook%')
       OR NEW.source ILIKE '%tiktok%'
     ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.skip_legacy_marketplace_ad_spend() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER skip_legacy_marketplace_ad_spend
BEFORE INSERT OR UPDATE ON public.daily_ads_spend
FOR EACH ROW EXECUTE FUNCTION public.skip_legacy_marketplace_ad_spend();

CREATE FUNCTION public.sync_manual_marketplace_ad_spend() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_brand_name text; v_changed_by uuid;
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    DELETE FROM public.daily_ads_spend WHERE manual_marketplace_entry_id = OLD.id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT name INTO v_brand_name FROM public.brands
    WHERE workspace_id = NEW.workspace_id AND id = NEW.brand_id;
    INSERT INTO public.daily_ads_spend
      (workspace_id, date, brand_id, store, source, spent, ad_account, advertiser,
       data_source, manual_marketplace_entry_id)
    VALUES
      (NEW.workspace_id, NEW.spend_date, NEW.brand_id, v_brand_name,
       CASE NEW.platform WHEN 'shopee_ads' THEN 'Shopee Ads' ELSE 'TikTok Ads' END,
       NEW.amount, 'Manual input', 'Advertiser', 'manual_marketplace', NEW.id);
  END IF;

  v_changed_by := CASE WHEN TG_OP = 'DELETE' THEN OLD.updated_by ELSE NEW.updated_by END;
  INSERT INTO public.manual_marketplace_ad_spend_audit
    (entry_id, workspace_id, platform, action, before_value, after_value, changed_by)
  VALUES
    (CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
     CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END,
     CASE WHEN TG_OP = 'DELETE' THEN OLD.platform ELSE NEW.platform END,
     CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'updated' ELSE 'deleted' END,
     CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
     CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
     v_changed_by);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.sync_manual_marketplace_ad_spend() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER sync_manual_marketplace_ad_spend
AFTER INSERT OR UPDATE OR DELETE ON public.manual_marketplace_ad_spend
FOR EACH ROW EXECUTE FUNCTION public.sync_manual_marketplace_ad_spend();

CREATE FUNCTION public.save_manual_marketplace_ad_spend(
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
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    JOIN public.workspace_advertiser_spend_access a
      ON a.workspace_id = m.workspace_id AND a.user_id = m.user_id
    WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
      AND m.role = 'advertiser' AND m.status = 'active' AND a.platform = p_platform
  ) THEN RAISE EXCEPTION 'Akses input platform ini tidak tersedia.'; END IF;
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

CREATE FUNCTION public.delete_manual_marketplace_ad_spend(
  p_workspace_id uuid, p_entry_id bigint, p_expected_version integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_deleted public.manual_marketplace_ad_spend%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi login tidak ditemukan.'; END IF;
  DELETE FROM public.manual_marketplace_ad_spend e
  USING public.workspace_memberships m, public.workspace_advertiser_spend_access a,
        public.manual_marketplace_ad_spend_cutovers c
  WHERE e.id = p_entry_id AND e.workspace_id = p_workspace_id
    AND e.created_by = auth.uid() AND e.version = p_expected_version
    AND m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
    AND m.role = 'advertiser' AND m.status = 'active'
    AND a.workspace_id = p_workspace_id AND a.user_id = auth.uid()
    AND a.platform = e.platform AND c.workspace_id = p_workspace_id
  RETURNING e.* INTO v_deleted;
  IF v_deleted.id IS NULL THEN RAISE EXCEPTION 'Input tidak tersedia, bukan milik Anda, atau sudah berubah. Muat ulang data.'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.delete_manual_marketplace_ad_spend(uuid, bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_manual_marketplace_ad_spend(uuid, bigint, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
