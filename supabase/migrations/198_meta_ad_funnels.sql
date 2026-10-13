BEGIN;
-- Ad-level facts are separate from financial/account spend to prevent double counting.
CREATE TABLE public.meta_ad_daily_metrics (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 account_id text NOT NULL, account_name text NOT NULL,
 ad_id text NOT NULL, ad_name text NOT NULL, creative_id text,
 metric_date date NOT NULL, currency text NOT NULL,
 metrics jsonb NOT NULL CHECK(jsonb_typeof(metrics)='object'),
 raw_insights jsonb NOT NULL CHECK(jsonb_typeof(raw_insights)='object'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,account_id,ad_id,metric_date)
);
CREATE INDEX meta_ad_daily_date ON public.meta_ad_daily_metrics(workspace_id,metric_date,account_id);
CREATE TABLE public.meta_ad_sync_coverage (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), account_id text NOT NULL,
 metric_date date NOT NULL, currency text NOT NULL, timezone_name text NOT NULL,
 synced_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,account_id,metric_date)
);
CREATE TABLE public.meta_ad_creatives (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), account_id text NOT NULL,
 ad_id text NOT NULL, creative_id text, name text NOT NULL,
 thumbnail_url text, video_id text, body text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,account_id,ad_id)
);
CREATE TABLE public.meta_ad_funnels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 config jsonb NOT NULL CHECK(jsonb_typeof(config)='object'), version integer NOT NULL DEFAULT 1,
 archived boolean NOT NULL DEFAULT false, created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id)
);
CREATE INDEX meta_ad_funnels_workspace ON public.meta_ad_funnels(workspace_id,archived);
CREATE TABLE public.meta_funnel_alerts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
 funnel_id uuid NOT NULL, rule_version integer NOT NULL,
 group_key text NOT NULL, metric_id text NOT NULL, period_end date NOT NULL,
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,funnel_id) REFERENCES public.meta_ad_funnels(workspace_id,id),
 UNIQUE(funnel_id,rule_version,group_key,metric_id,period_end), UNIQUE(workspace_id,id)
);
CREATE INDEX meta_funnel_alerts_workspace ON public.meta_funnel_alerts(workspace_id,period_end DESC);
CREATE TABLE public.meta_funnel_alert_reads (
 workspace_id uuid NOT NULL, alert_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES auth.users(id),
 read_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(alert_id,user_id),
 FOREIGN KEY(workspace_id,alert_id) REFERENCES public.meta_funnel_alerts(workspace_id,id) ON DELETE CASCADE
);
-- Access is through authenticated, workspace-scoped server actions only.
-- No browser PostgREST grants, including for restricted marketing reviewers.
ALTER TABLE public.meta_ad_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ad_sync_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ad_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ad_funnels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_funnel_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_funnel_alert_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ad_daily_metrics,public.meta_ad_sync_coverage,public.meta_ad_creatives,
 public.meta_ad_funnels,public.meta_funnel_alerts,public.meta_funnel_alert_reads FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_ad_daily_metrics,public.meta_ad_sync_coverage,public.meta_ad_creatives,
 public.meta_ad_funnels,public.meta_funnel_alerts,public.meta_funnel_alert_reads TO service_role;

CREATE FUNCTION public.replace_meta_ad_snapshot(
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
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(ad_id text,ad_name text,metric_date date,metrics jsonb,raw_insights jsonb)
   WHERE r.ad_id IS NULL OR r.ad_id !~ '^[0-9]+$' OR r.ad_name IS NULL OR r.metric_date IS NULL
   OR r.metric_date NOT BETWEEN p_start AND p_end OR r.metrics IS NULL OR jsonb_typeof(r.metrics)<>'object'
   OR r.raw_insights IS NULL OR jsonb_typeof(r.raw_insights)<>'object') THEN
   RAISE EXCEPTION 'Meta ad rows outside snapshot scope';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':meta-ads:'||p_account_id,0));
 DELETE FROM public.meta_ad_daily_metrics WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND metric_date BETWEEN p_start AND p_end;
 INSERT INTO public.meta_ad_daily_metrics(workspace_id,account_id,account_name,ad_id,ad_name,creative_id,metric_date,currency,metrics,raw_insights)
 SELECT p_workspace_id,p_account_id,p_account_name,r.ad_id,r.ad_name,r.creative_id,r.metric_date,p_currency,r.metrics,r.raw_insights
 FROM jsonb_to_recordset(p_rows) AS r(ad_id text,ad_name text,creative_id text,metric_date date,metrics jsonb,raw_insights jsonb);
 INSERT INTO public.meta_ad_sync_coverage(workspace_id,account_id,metric_date,currency,timezone_name)
 SELECT p_workspace_id,p_account_id,d::date,p_currency,p_timezone FROM generate_series(p_start::timestamp,p_end::timestamp,interval '1 day') d
 ON CONFLICT(workspace_id,account_id,metric_date) DO UPDATE SET synced_at=now(),currency=excluded.currency,timezone_name=excluded.timezone_name;
END $$;
REVOKE ALL ON FUNCTION public.replace_meta_ad_snapshot(uuid,text,text,date,date,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.replace_meta_ad_snapshot(uuid,text,text,date,date,text,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
