BEGIN;
ALTER TABLE public.meta_ad_daily_metrics ADD COLUMN landing_page_urls jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(landing_page_urls)='array');
ALTER TABLE public.meta_ad_creatives ADD COLUMN landing_page_urls jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(landing_page_urls)='array');

-- Store observed destinations with daily facts; do not duplicate an ad's metrics
-- when a dynamic/carousel creative contains multiple distinct destinations.
CREATE OR REPLACE FUNCTION public.replace_meta_ad_snapshot(
 p_workspace_id uuid,p_account_id text,p_account_name text,p_start date,p_end date,
 p_currency text,p_timezone text,p_rows jsonb
) RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF p_workspace_id IS NULL OR p_account_id IS NULL OR p_start IS NULL OR p_end IS NULL
   OR p_start>p_end OR p_end-p_start>6 OR p_currency IS NULL OR p_timezone IS NULL
   OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array'
   OR NOT EXISTS(SELECT 1 FROM public.meta_ad_accounts WHERE workspace_id=p_workspace_id AND account_id=p_account_id) THEN
   RAISE EXCEPTION 'Invalid Meta ad snapshot scope';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(ad_id text,ad_name text,metric_date date,metrics jsonb,raw_insights jsonb,landing_page_urls jsonb)
   WHERE r.ad_id IS NULL OR r.ad_id !~ '^[0-9]+$' OR r.ad_name IS NULL OR r.metric_date IS NULL
   OR r.metric_date NOT BETWEEN p_start AND p_end OR r.metrics IS NULL OR jsonb_typeof(r.metrics)<>'object'
   OR r.raw_insights IS NULL OR jsonb_typeof(r.raw_insights)<>'object'
   OR (r.landing_page_urls IS NOT NULL AND (jsonb_typeof(r.landing_page_urls)<>'array'
     OR jsonb_path_exists(r.landing_page_urls,'$[*] ? (@.type() != "string")')))) THEN
   RAISE EXCEPTION 'Meta ad rows outside snapshot scope';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':meta-ads:'||p_account_id,0));
 DELETE FROM public.meta_ad_daily_metrics WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND metric_date BETWEEN p_start AND p_end;
 INSERT INTO public.meta_ad_daily_metrics(workspace_id,account_id,account_name,ad_id,ad_name,creative_id,metric_date,currency,metrics,raw_insights,landing_page_urls)
 SELECT p_workspace_id,p_account_id,p_account_name,r.ad_id,r.ad_name,r.creative_id,r.metric_date,p_currency,r.metrics,r.raw_insights,coalesce(r.landing_page_urls,'[]'::jsonb)
 FROM jsonb_to_recordset(p_rows) AS r(ad_id text,ad_name text,creative_id text,metric_date date,metrics jsonb,raw_insights jsonb,landing_page_urls jsonb);
 INSERT INTO public.meta_ad_sync_coverage(workspace_id,account_id,metric_date,currency,timezone_name)
 SELECT p_workspace_id,p_account_id,d::date,p_currency,p_timezone FROM generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d
 ON CONFLICT(workspace_id,account_id,metric_date) DO UPDATE SET synced_at=now(),currency=excluded.currency,timezone_name=excluded.timezone_name;
END $$;
REVOKE ALL ON FUNCTION public.replace_meta_ad_snapshot(uuid,text,text,date,date,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_meta_ad_snapshot(uuid,text,text,date,date,text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
