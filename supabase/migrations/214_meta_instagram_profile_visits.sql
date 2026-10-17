BEGIN;
-- Null means Meta did not return this metric; a reported zero remains zero.
-- Keep the existing aggregate's 21-element initial state backward compatible.
CREATE OR REPLACE FUNCTION public.meta_ad_report_add(s numeric[],m jsonb) RETURNS numeric[]
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$ SELECT ARRAY[
 s[1]+coalesce((m->>'spend')::numeric,0),
 s[2]+coalesce((m->>'impressions')::numeric,0),
 s[3]+coalesce((m->>'clicks')::numeric,0),
 s[4]+coalesce((m->>'link_clicks')::numeric,0),
 s[5]+coalesce((m->>'outbound_clicks')::numeric,0),
 s[6]+coalesce((m->>'lpv')::numeric,0),
 s[7]+coalesce((m->>'view_content')::numeric,0),
 s[8]+coalesce((m->>'atc')::numeric,0),
 s[9]+coalesce((m->>'checkout')::numeric,0),
 s[10]+coalesce((m->>'purchases')::numeric,0),
 s[11]+coalesce((m->>'purchase_value')::numeric,0),
 s[12]+coalesce((m->>'video_plays')::numeric,0),
 s[13]+coalesce((m->>'video_3s')::numeric,0),
 s[14]+coalesce((m->>'thruplay')::numeric,0),
 s[15]+coalesce((m->>'video_25')::numeric,0),
 s[16]+coalesce((m->>'video_50')::numeric,0),
 s[17]+coalesce((m->>'video_75')::numeric,0),
 s[18]+coalesce((m->>'video_100')::numeric,0),
 s[19]+coalesce((m->>'leads')::numeric,0),
 s[20]+coalesce((m->>'conversations')::numeric,0),
 s[21]+coalesce((m->>'replies')::numeric,0),
 coalesce(s[22],0)+coalesce((m->>'instagram_profile_visits')::numeric,0),
 coalesce(s[23],0)+CASE WHEN m->>'instagram_profile_visits' IS NOT NULL THEN 1 ELSE 0 END,
 coalesce(s[24],0)+1
] $$;
CREATE OR REPLACE FUNCTION public.meta_ad_report_finish(s numeric[]) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$ SELECT jsonb_object_agg(k,s[i]) || jsonb_build_object('instagram_profile_visits',
 CASE WHEN coalesce(s[23],0)=coalesce(s[24],0) THEN coalesce(s[22],0) ELSE NULL END) FROM unnest(ARRAY['spend','impressions','clicks','link_clicks','outbound_clicks','lpv','view_content','atc','checkout','purchases','purchase_value','video_plays','video_3s','thruplay','video_25','video_50','video_75','video_100','leads','conversations','replies']) WITH ORDINALITY AS keys(k,i) $$;

CREATE FUNCTION public.save_meta_instagram_profile_visits(
 p_workspace_id uuid,p_account_id text,p_rows jsonb,p_observed_at timestamptz,p_api_version text
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_account_id IS NULL OR p_observed_at IS NULL OR p_observed_at>clock_timestamp()+interval '5 minutes'
 OR p_api_version IS NULL OR p_api_version !~ '^v[0-9]+\.[0-9]+$'
 OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>500
 OR NOT EXISTS(SELECT 1 FROM public.meta_ad_accounts WHERE workspace_id=p_workspace_id AND account_id=p_account_id) THEN
  RAISE EXCEPTION 'Invalid profile visit scope';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE
   coalesce(r->>'ad_id','') !~ '^[0-9]+$' OR r->>'metric_date' IS NULL OR
   NOT (r ? 'instagram_profile_visits') OR
   (r->'instagram_profile_visits'<>'null'::jsonb AND
     (jsonb_typeof(r->'instagram_profile_visits')<>'number' OR
      (r->>'instagram_profile_visits') !~ '^[0-9]+$' OR (r->>'instagram_profile_visits')::numeric>9007199254740991)))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY r->>'ad_id',r->>'metric_date' HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Invalid or duplicate profile visit rows';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':meta-ads:'||p_account_id,0));
 WITH input AS MATERIALIZED (
  SELECT r->>'ad_id' AS ad_id,(r->>'metric_date')::date AS metric_date,r->>'adset_id' AS adset_id,
    r->'instagram_profile_visits' AS visits FROM jsonb_array_elements(p_rows) r
 ), decision AS MATERIALIZED (
  SELECT i.*,CASE WHEN d.ad_id IS NULL THEN 'missing'
    WHEN (d.raw_insights->>'adset_id') IS DISTINCT FROM i.adset_id THEN 'scope_changed'
    WHEN coalesce(d.raw_insights->'ig_profile_visit_observation'->>'observed_at','')>to_char(p_observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN 'newer'
    ELSE 'save' END AS action FROM input i LEFT JOIN public.meta_ad_daily_metrics d
    ON d.workspace_id=p_workspace_id AND d.account_id=p_account_id AND d.ad_id=i.ad_id AND d.metric_date=i.metric_date
 ), saved AS (
  UPDATE public.meta_ad_daily_metrics d SET
   metrics=d.metrics || jsonb_build_object('instagram_profile_visits',i.visits),
   raw_insights=d.raw_insights || jsonb_build_object('instagram_profile_visits',i.visits,'ig_profile_visit_observation',jsonb_build_object(
     'observed_at',to_char(p_observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
     'status',CASE WHEN i.visits='null'::jsonb THEN 'not_returned' ELSE 'available' END,
     'api_version',p_api_version,'source','meta_insights_backfill'))
  FROM decision i WHERE i.action='save' AND d.workspace_id=p_workspace_id AND d.account_id=p_account_id
    AND d.ad_id=i.ad_id AND d.metric_date=i.metric_date RETURNING d.ad_id
 ) SELECT jsonb_build_object('saved',(SELECT count(*) FROM saved),
   'missing',count(*) FILTER(WHERE action='missing'),'scope_changed',count(*) FILTER(WHERE action='scope_changed'),
   'newer',count(*) FILTER(WHERE action='newer')) INTO result FROM decision;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_meta_instagram_profile_visits(uuid,text,jsonb,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_meta_instagram_profile_visits(uuid,text,jsonb,timestamptz,text) TO service_role;

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
 -- A legacy worker deletes/reinserts snapshots. Carry newer observations forward
 -- before deleting, scoped by workspace/account/ad/day AND adset identity.
 SELECT coalesce(jsonb_agg(CASE WHEN old.ad_id IS NOT NULL AND
   (old.raw_insights->>'adset_id') IS NOT DISTINCT FROM (r.value->'raw_insights'->>'adset_id') AND
   (old.metrics ? 'instagram_profile_visits') AND (
     (NOT (r.value->'raw_insights' ? 'instagram_profile_visits') AND NOT (r.value->'raw_insights' ? 'ig_profile_visit_observation')) OR
     coalesce(old.raw_insights->'ig_profile_visit_observation'->>'observed_at','') >
       coalesce(r.value->'raw_insights'->'ig_profile_visit_observation'->>'observed_at','')
   ) THEN r.value || jsonb_build_object(
     'metrics',(r.value->'metrics') || jsonb_build_object('instagram_profile_visits',old.metrics->'instagram_profile_visits'),
     'raw_insights',(r.value->'raw_insights') || jsonb_build_object('instagram_profile_visits',old.raw_insights->'instagram_profile_visits',
       'ig_profile_visit_observation',old.raw_insights->'ig_profile_visit_observation'))
   ELSE r.value END ORDER BY r.n),'[]'::jsonb) INTO p_rows
 FROM jsonb_array_elements(p_rows) WITH ORDINALITY r(value,n)
 LEFT JOIN public.meta_ad_daily_metrics old ON old.workspace_id=p_workspace_id AND old.account_id=p_account_id
   AND old.ad_id=r.value->>'ad_id' AND old.metric_date=(r.value->>'metric_date')::date;
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
