-- Replace a complete account/date snapshot atomically, including zero-spend days.
CREATE OR REPLACE FUNCTION public.replace_meta_ads_spend(
  p_workspace_id uuid,
  p_account_name text,
  p_date_start date,
  p_date_end date,
  p_rows jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_account_name IS NULL
     OR p_date_start IS NULL OR p_date_end IS NULL OR p_date_start > p_date_end
     OR p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Invalid Meta snapshot scope';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(date date, ad_account text, data_source text)
    WHERE r.date IS NULL OR r.date < p_date_start OR r.date > p_date_end
       OR r.ad_account IS DISTINCT FROM p_account_name
       OR r.data_source IS DISTINCT FROM 'meta_api'
  ) THEN
    RAISE EXCEPTION 'Meta snapshot rows outside requested scope';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':meta:' || p_account_name, 0));
  DELETE FROM public.daily_ads_spend
  WHERE workspace_id = p_workspace_id AND ad_account = p_account_name
    AND data_source = 'meta_api' AND date BETWEEN p_date_start AND p_date_end;

  INSERT INTO public.daily_ads_spend
    (workspace_id, date, ad_account, spent, impressions, cpm, objective,
     source, store, brand_id, advertiser, data_source)
  SELECT p_workspace_id, r.date, p_account_name, r.spent, r.impressions, r.cpm,
    r.objective, r.source, r.store, r.brand_id, r.advertiser, 'meta_api'
  FROM jsonb_to_recordset(p_rows) AS r(
    date date, spent numeric, impressions bigint, cpm numeric,
    objective text, source text, store text, brand_id bigint, advertiser text
  );
END;
$$;
REVOKE ALL ON FUNCTION public.replace_meta_ads_spend(uuid, text, date, date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_meta_ads_spend(uuid, text, date, date, jsonb) TO service_role;
