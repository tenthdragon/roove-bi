BEGIN;

-- A spreadsheet row remains available even while a manual entry owns the
-- effective spend for the same workspace, date, brand, and platform.
CREATE TABLE public.manual_marketplace_sheet_fallback (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  date date NOT NULL,
  platform text NOT NULL CHECK (platform IN ('shopee_ads', 'tiktok_ads')),
  brand_id integer NOT NULL,
  row_key text NOT NULL,
  source text NOT NULL,
  store text NOT NULL,
  ad_account text NOT NULL,
  spent numeric NOT NULL,
  original_row jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, date, platform, brand_id, row_key),
  FOREIGN KEY (workspace_id, brand_id) REFERENCES public.brands(workspace_id, id)
);
CREATE INDEX manual_marketplace_sheet_fallback_month_idx
  ON public.manual_marketplace_sheet_fallback (workspace_id, date DESC, platform);
ALTER TABLE public.manual_marketplace_sheet_fallback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manual_marketplace_sheet_fallback FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.manual_marketplace_sheet_fallback TO service_role;

CREATE FUNCTION public.marketplace_ad_spend_platform(p_source text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN lower(coalesce(p_source, '')) LIKE '%tiktok%' THEN 'tiktok_ads'
    WHEN lower(coalesce(p_source, '')) LIKE '%shopee%'
      AND lower(p_source) NOT LIKE '%live%'
      AND lower(p_source) NOT LIKE '%cpas%'
      AND lower(p_source) NOT LIKE '%facebook%' THEN 'shopee_ads'
    ELSE NULL
  END;
$$;
REVOKE ALL ON FUNCTION public.marketplace_ad_spend_platform(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_ad_spend_platform(text) TO service_role;

CREATE FUNCTION public.marketplace_sheet_spend_row_key(p_row public.daily_ads_spend) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT md5(concat_ws(chr(31), p_row.date::text, coalesce(p_row.ad_account, ''),
    coalesce(p_row.spent, 0)::text, coalesce(p_row.objective, ''),
    coalesce(p_row.source, ''), coalesce(p_row.store, ''),
    coalesce(p_row.advertiser, ''), coalesce(p_row.business_code, '')));
$$;
REVOKE ALL ON FUNCTION public.marketplace_sheet_spend_row_key(public.daily_ads_spend) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_sheet_spend_row_key(public.daily_ads_spend) TO service_role;

CREATE FUNCTION public.lock_marketplace_spend_key(
  p_workspace_id uuid, p_platform text, p_brand_id integer, p_date date
) RETURNS void LANGUAGE sql VOLATILE SET search_path = public, pg_temp AS $$
  SELECT pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::text || ':' || p_platform || ':' || p_brand_id::text || ':' || p_date::text, 0));
$$;
REVOKE ALL ON FUNCTION public.lock_marketplace_spend_key(uuid, text, integer, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lock_marketplace_spend_key(uuid, text, integer, date) TO service_role;

CREATE OR REPLACE FUNCTION public.skip_legacy_marketplace_ad_spend() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_platform text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.manual_marketplace_ad_spend_cutovers c
    WHERE c.workspace_id = NEW.workspace_id AND NEW.date >= c.starts_on
  ) THEN RETURN NEW; END IF;
  v_platform := public.marketplace_ad_spend_platform(NEW.source);
  IF v_platform IS NULL THEN RETURN NEW; END IF;

  IF NEW.data_source = 'google_sheets' THEN
    NEW.brand_id := coalesce(NEW.brand_id,
      public.resolve_workspace_brand_id(NEW.workspace_id, NEW.store));
    -- Unmapped sheet stores remain visible, never silently dropped.
    IF NEW.brand_id IS NULL THEN RETURN NEW; END IF;
    PERFORM public.lock_marketplace_spend_key(
      NEW.workspace_id, v_platform, NEW.brand_id, NEW.date);
    INSERT INTO public.manual_marketplace_sheet_fallback
      (workspace_id, date, platform, brand_id, row_key, source, store,
       ad_account, spent, original_row)
    VALUES
      (NEW.workspace_id, NEW.date, v_platform, NEW.brand_id,
       public.marketplace_sheet_spend_row_key(NEW), coalesce(NEW.source, ''),
       coalesce(NEW.store, ''), coalesce(NEW.ad_account, ''), coalesce(NEW.spent, 0),
       to_jsonb(NEW) - 'id' - 'manual_marketplace_entry_id')
    ON CONFLICT (workspace_id, date, platform, brand_id, row_key)
    DO UPDATE SET original_row = EXCLUDED.original_row, spent = EXCLUDED.spent,
      updated_at = now();
    IF EXISTS (
      SELECT 1 FROM public.manual_marketplace_ad_spend m
      WHERE m.workspace_id = NEW.workspace_id AND m.platform = v_platform
        AND m.brand_id = NEW.brand_id AND m.spend_date = NEW.date
    ) THEN RETURN NULL; END IF;
    IF EXISTS (
      SELECT 1 FROM public.daily_ads_spend d
      WHERE d.workspace_id = NEW.workspace_id AND d.date = NEW.date
        AND d.brand_id = NEW.brand_id AND d.data_source = 'google_sheets'
        AND public.marketplace_ad_spend_platform(d.source) = v_platform
        AND public.marketplace_sheet_spend_row_key(d) = public.marketplace_sheet_spend_row_key(NEW)
    ) THEN RETURN NULL; END IF;
    RETURN NEW;
  END IF;

  -- XLSX and Shopee API never become a second fallback for this feature.
  IF NEW.data_source IN ('xlsx_upload', 'shopee_ads_api')
    OR (NEW.data_source IS NULL AND NEW.import_id IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.restore_marketplace_sheet_fallback(
  p_workspace_id uuid, p_platform text, p_brand_id integer, p_date date
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.lock_marketplace_spend_key(
    p_workspace_id, p_platform, p_brand_id, p_date);
  IF EXISTS (
    SELECT 1 FROM public.manual_marketplace_ad_spend m
    WHERE m.workspace_id = p_workspace_id AND m.platform = p_platform
      AND m.brand_id = p_brand_id AND m.spend_date = p_date
  ) THEN RETURN; END IF;
  DELETE FROM public.daily_ads_spend d
  WHERE d.workspace_id = p_workspace_id AND d.date = p_date
    AND d.brand_id = p_brand_id AND d.data_source = 'google_sheets'
    AND public.marketplace_ad_spend_platform(d.source) = p_platform;
  INSERT INTO public.daily_ads_spend
    (workspace_id, date, brand_id, ad_account, spent, objective, source, store,
     advertiser, import_id, impressions, cpm, data_source, business_code,
     platform_attributed_revenue, platform_reported_roas, raw_attribution)
  SELECT r.workspace_id, r.date, r.brand_id, r.ad_account, r.spent, r.objective,
    r.source, r.store, r.advertiser, r.import_id, r.impressions, r.cpm,
    r.data_source, r.business_code, r.platform_attributed_revenue,
    r.platform_reported_roas, r.raw_attribution
  FROM public.manual_marketplace_sheet_fallback f
  CROSS JOIN LATERAL jsonb_populate_record(
    NULL::public.daily_ads_spend, f.original_row) r
  WHERE f.workspace_id = p_workspace_id AND f.platform = p_platform
    AND f.brand_id = p_brand_id AND f.date = p_date;
END $$;
REVOKE ALL ON FUNCTION public.restore_marketplace_sheet_fallback(uuid, text, integer, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_marketplace_sheet_fallback(uuid, text, integer, date)
  TO service_role;

CREATE OR REPLACE FUNCTION public.sync_manual_marketplace_ad_spend() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_brand_name text; v_changed_by uuid; v_old_key text; v_new_key text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_key := OLD.workspace_id::text || ':' || OLD.platform || ':' || OLD.brand_id || ':' || OLD.spend_date;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_key := NEW.workspace_id::text || ':' || NEW.platform || ':' || NEW.brand_id || ':' || NEW.spend_date;
  END IF;
  IF v_old_key IS NOT NULL AND v_new_key IS NOT NULL AND v_old_key <> v_new_key THEN
    IF v_old_key < v_new_key THEN
      PERFORM public.lock_marketplace_spend_key(OLD.workspace_id, OLD.platform, OLD.brand_id, OLD.spend_date);
      PERFORM public.lock_marketplace_spend_key(NEW.workspace_id, NEW.platform, NEW.brand_id, NEW.spend_date);
    ELSE
      PERFORM public.lock_marketplace_spend_key(NEW.workspace_id, NEW.platform, NEW.brand_id, NEW.spend_date);
      PERFORM public.lock_marketplace_spend_key(OLD.workspace_id, OLD.platform, OLD.brand_id, OLD.spend_date);
    END IF;
  ELSIF v_old_key IS NOT NULL THEN
    PERFORM public.lock_marketplace_spend_key(OLD.workspace_id, OLD.platform, OLD.brand_id, OLD.spend_date);
  ELSE
    PERFORM public.lock_marketplace_spend_key(NEW.workspace_id, NEW.platform, NEW.brand_id, NEW.spend_date);
  END IF;

  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    DELETE FROM public.daily_ads_spend WHERE manual_marketplace_entry_id = OLD.id;
    IF TG_OP = 'DELETE' OR v_old_key <> v_new_key THEN
      PERFORM public.restore_marketplace_sheet_fallback(
        OLD.workspace_id, OLD.platform, OLD.brand_id, OLD.spend_date);
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    DELETE FROM public.daily_ads_spend d
    WHERE d.workspace_id = NEW.workspace_id AND d.date = NEW.spend_date
      AND d.brand_id = NEW.brand_id AND d.data_source = 'google_sheets'
      AND public.marketplace_ad_spend_platform(d.source) = NEW.platform;
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

-- Populate the retained fallback for the October rows archived at cutover.
INSERT INTO public.manual_marketplace_sheet_fallback
  (workspace_id, date, platform, brand_id, row_key, source, store,
   ad_account, spent, original_row)
SELECT r.workspace_id, r.date, public.marketplace_ad_spend_platform(r.source),
  r.brand_id, public.marketplace_sheet_spend_row_key(r), coalesce(r.source, ''),
  coalesce(r.store, ''), coalesce(r.ad_account, ''), coalesce(r.spent, 0),
  to_jsonb(r) - 'id' - 'manual_marketplace_entry_id'
FROM public.manual_marketplace_legacy_spend_archive a
CROSS JOIN LATERAL jsonb_populate_record(NULL::public.daily_ads_spend, a.original_row) r
WHERE r.data_source = 'google_sheets' AND r.brand_id IS NOT NULL
  AND public.marketplace_ad_spend_platform(r.source) IS NOT NULL
ON CONFLICT DO NOTHING;

-- The one-time 27 October backfill copied spreadsheet values into the manual
-- table. Move only those traceable imports back to the spreadsheet fallback;
-- independently entered advertiser values remain manual and keep priority.
DELETE FROM public.manual_marketplace_ad_spend m
USING public.manual_marketplace_legacy_spend_archive a
WHERE m.workspace_id = a.workspace_id
  AND m.platform = public.marketplace_ad_spend_platform(a.original_row->>'source')
  AND m.brand_id = (a.original_row->>'brand_id')::integer
  AND m.spend_date = (a.original_row->>'date')::date
  AND m.amount = round((a.original_row->>'spent')::numeric, 2)
  AND m.note = 'Backfill otomatis dari arsip Google Sheets; arsip ID '
    || a.original_id || '; sumber ' || (a.original_row->>'source');

DO $$ DECLARE k record;
BEGIN
  FOR k IN SELECT DISTINCT f.workspace_id, f.platform, f.brand_id, f.date
    FROM public.manual_marketplace_sheet_fallback f
    WHERE NOT EXISTS (
      SELECT 1 FROM public.manual_marketplace_ad_spend m
      WHERE m.workspace_id=f.workspace_id AND m.platform=f.platform
        AND m.brand_id=f.brand_id AND m.spend_date=f.date)
      AND NOT EXISTS (
        SELECT 1 FROM public.daily_ads_spend d
        WHERE d.workspace_id=f.workspace_id AND d.date=f.date
          AND d.brand_id=f.brand_id AND d.data_source='google_sheets'
          AND public.marketplace_ad_spend_platform(d.source)=f.platform)
    LOOP
    PERFORM public.restore_marketplace_sheet_fallback(
      k.workspace_id, k.platform, k.brand_id, k.date);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
