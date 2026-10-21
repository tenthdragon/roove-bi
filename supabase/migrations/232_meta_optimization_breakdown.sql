BEGIN;
-- Current provider configuration, scoped to the adset/account/workspace identity.
-- Historical performance facts are not rewritten by this metadata inventory.
CREATE TABLE public.meta_adset_optimizations (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),account_id text NOT NULL,
 adset_id text NOT NULL CHECK(adset_id ~ '^[0-9]+$'),campaign_id text NOT NULL CHECK(campaign_id ~ '^[0-9]+$'),
 campaign_objective text,optimization_goal text,conversion_event text,custom_conversion_id text CHECK(custom_conversion_id ~ '^[0-9]+$'),
 source_updated_at timestamptz,observed_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,account_id,adset_id)
);
ALTER TABLE public.meta_adset_optimizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_adset_optimizations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_adset_optimizations TO service_role;
CREATE FUNCTION public.save_meta_adset_optimizations(p_workspace_id uuid,p_account_id text,p_rows jsonb,p_observed_at timestamptz)
RETURNS integer LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE n integer; BEGIN
 IF p_workspace_id IS NULL OR p_account_id IS NULL OR p_observed_at IS NULL OR p_observed_at>now()+interval '5 minutes'
 OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>500
 OR NOT EXISTS(SELECT 1 FROM meta_ad_accounts WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND is_active)
 THEN RAISE EXCEPTION 'Invalid optimization inventory scope'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE jsonb_typeof(r)<>'object'
 OR coalesce(r->>'adset_id','') !~ '^[0-9]+$' OR coalesce(r->>'campaign_id','') !~ '^[0-9]+$'
 OR (r->>'custom_conversion_id' IS NOT NULL AND r->>'custom_conversion_id' !~ '^[0-9]+$')
 OR length(coalesce(r->>'optimization_goal',''))>200 OR length(coalesce(r->>'conversion_event',''))>200 OR length(coalesce(r->>'campaign_objective',''))>200)
 OR (SELECT count(DISTINCT r->>'adset_id') FROM jsonb_array_elements(p_rows) r)<>jsonb_array_length(p_rows)
 THEN RAISE EXCEPTION 'Invalid optimization inventory rows'; END IF;
 INSERT INTO meta_adset_optimizations AS existing(workspace_id,account_id,adset_id,campaign_id,campaign_objective,optimization_goal,conversion_event,custom_conversion_id,source_updated_at,observed_at)
 SELECT p_workspace_id,p_account_id,r.adset_id,r.campaign_id,r.campaign_objective,r.optimization_goal,r.conversion_event,r.custom_conversion_id,r.source_updated_at,p_observed_at
 FROM jsonb_to_recordset(p_rows) r(adset_id text,campaign_id text,campaign_objective text,optimization_goal text,conversion_event text,custom_conversion_id text,source_updated_at timestamptz)
 ON CONFLICT(workspace_id,account_id,adset_id) DO UPDATE SET
 campaign_id=excluded.campaign_id,campaign_objective=excluded.campaign_objective,optimization_goal=excluded.optimization_goal,
 conversion_event=excluded.conversion_event,custom_conversion_id=excluded.custom_conversion_id,source_updated_at=excluded.source_updated_at,observed_at=excluded.observed_at
 WHERE excluded.observed_at>=existing.observed_at AND (existing.source_updated_at IS NULL OR excluded.source_updated_at>=existing.source_updated_at);
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.save_meta_adset_optimizations(uuid,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_meta_adset_optimizations(uuid,text,jsonb,timestamptz) TO service_role;
CREATE TRIGGER meta_report_insert AFTER INSERT ON public.meta_adset_optimizations REFERENCING NEW TABLE AS meta_new FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version();
CREATE TRIGGER meta_report_update AFTER UPDATE ON public.meta_adset_optimizations REFERENCING OLD TABLE AS meta_old NEW TABLE AS meta_new FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version();
CREATE TRIGGER meta_report_delete AFTER DELETE ON public.meta_adset_optimizations REFERENCING OLD TABLE AS meta_old FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version();

CREATE OR REPLACE FUNCTION public.get_meta_ad_report_incremental(
 p_workspace_id uuid,p_from date,p_to date,p_config jsonb DEFAULT '{}'::jsonb,
 p_filters jsonb DEFAULT '{}'::jsonb,p_brand text DEFAULT NULL,p_group_by text DEFAULT 'landing_page',
 p_view text DEFAULT 'overview',p_period text DEFAULT 'week',p_group_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
DECLARE start_date date; result jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>92
 OR p_group_by IS NULL OR p_view IS NULL OR p_period IS NULL OR p_config IS NULL OR p_filters IS NULL
 OR p_group_by NOT IN ('ad','landing_page','cep_intention') OR p_view NOT IN ('overview','daily','trends','creatives')
 OR (p_filters ? 'channel' AND (jsonb_typeof(p_filters->'channel') <> 'string' OR p_filters->>'channel' NOT IN ('non_cpas','cpas','unknown')))
 OR p_period NOT IN ('week','month') OR jsonb_typeof(p_config)<>'object' OR jsonb_typeof(p_filters)<>'object'
 THEN RAISE EXCEPTION 'Invalid Meta report scope'; END IF;
 start_date:=CASE WHEN p_view='trends' THEN p_to-89 WHEN p_view='daily' THEN p_from-1 ELSE p_from-(p_to-p_from+1) END;
 PERFORM public.ensure_meta_brand_report_days(p_workspace_id,least(start_date,p_from),p_to,
  CASE WHEN coalesce(jsonb_array_length(p_config->'account_ids'),0)=0 THEN NULL ELSE ARRAY(SELECT jsonb_array_elements_text(p_config->'account_ids')) END);
 WITH active AS MATERIALIZED (
  SELECT a.account_id,a.account_name,coalesce(b.id::text,'__unmapped__') AS brand
  FROM meta_ad_accounts a LEFT JOIN brands b ON b.id=a.default_brand_id AND b.workspace_id=a.workspace_id
  WHERE a.workspace_id=p_workspace_id AND a.is_active
   AND (coalesce(jsonb_array_length(p_config->'account_ids'),0)=0 OR p_config->'account_ids' ? a.account_id)
 ), selected_accounts AS (
  SELECT * FROM active WHERE p_brand IS NULL OR brand=p_brand
 ), daily AS MATERIALIZED (
  SELECT f.* FROM meta_brand_report_days d JOIN active a USING(account_id)
  CROSS JOIN LATERAL jsonb_to_recordset(d.rows) AS f(account_id text,ad_id text,ad_name text,account_name text,creative_id text,metric_date date,currency text,metrics jsonb,
   brand text,naming_cep_key text,naming_intention_key text,objective text,urls jsonb,verified boolean,ad_channel text,destination jsonb)
  WHERE d.workspace_id=p_workspace_id AND d.metric_date BETWEEN least(start_date,p_from) AND p_to
 ), active_ads AS MATERIALIZED (
  -- Only ads that delivered in the selected range exist for this report; their
  -- comparison-period and history rows are read, long-paused ads are not.
  SELECT DISTINCT f.account_id,f.ad_id FROM daily f JOIN active a USING(account_id)
  WHERE f.metric_date BETWEEN p_from AND p_to AND coalesce((f.metrics->>'impressions')::numeric,0)>0
 ), labels AS MATERIALIZED (
  -- Resolve once per delivering ad, never once per day or per CEP membership.
  SELECT x.account_id,x.ad_id,ARRAY(SELECT jsonb_array_elements_text(r.value->'cep_keys')) AS cep_keys,r.value->>'intention_key' AS intention_key
  FROM active_ads x JOIN active a USING(account_id)
  LEFT JOIN meta_ad_mappings m ON m.workspace_id=p_workspace_id AND m.account_id=x.account_id AND m.ad_id=x.ad_id
  LEFT JOIN LATERAL (SELECT f.naming_cep_key,f.naming_intention_key FROM daily f WHERE m.ad_id IS NULL AND f.account_id=x.account_id AND f.ad_id=x.ad_id AND f.metric_date BETWEEN p_from AND p_to ORDER BY f.metric_date DESC LIMIT 1) fallback ON true
  CROSS JOIN LATERAL (SELECT public.resolve_meta_ad_taxonomy(p_workspace_id,CASE WHEN a.brand='__unmapped__' THEN NULL ELSE a.brand::integer END,
   coalesce(m.auto_mapping,jsonb_build_object('tags',jsonb_build_array(jsonb_build_object('dimension','cep','key',fallback.naming_cep_key),jsonb_build_object('dimension','intention','key',fallback.naming_intention_key)))),coalesce(m.overrides,'{}')) AS value OFFSET 0) r
 ), facts AS (
  SELECT f.account_id,f.account_name,f.ad_id,f.ad_name,f.creative_id,f.metric_date,f.currency,f.metrics,f.brand,f.ad_channel,
   l.cep_keys[1] AS cep,l.cep_keys AS ceps,l.intention_key AS intention,f.objective,f.urls,f.verified,
   CASE WHEN p_group_by='landing_page' THEN f.destination END AS destination
  FROM daily f JOIN labels l USING(account_id,ad_id)
  WHERE f.metric_date BETWEEN start_date AND p_to AND (p_view='overview' OR p_brand IS NULL OR f.brand=p_brand)
   AND (coalesce(p_config->>'name_filter','')='' OR
    CASE WHEN p_config->>'match'='exact' THEN lower(regexp_replace(btrim(f.ad_name),'\s+',' ','g'))=lower(regexp_replace(btrim(p_config->>'name_filter'),'\s+',' ','g'))
     ELSE strpos(lower(regexp_replace(btrim(f.ad_name),'\s+',' ','g')),lower(regexp_replace(btrim(p_config->>'name_filter'),'\s+',' ','g')))>0 END)
 ), enriched AS MATERIALIZED (
  SELECT f.*,CASE WHEN p_group_by='ad' THEN 'ad:'||f.account_id||':'||f.ad_id
   WHEN p_group_by='cep_intention' THEN 'cep:'||replace(replace(coalesce(f.cep,'__unknown__'),'%','%25'),':','%3A')||':'||replace(replace(coalesce(f.intention,'__unknown__'),'%','%25'),':','%3A')
   WHEN destination IS NOT NULL THEN destination->>'key'
   WHEN jsonb_array_length(f.urls)=0 THEN 'landing:unknown'
   WHEN jsonb_array_length(f.urls)=1 THEN 'landing:'||(f.urls->>0)
   ELSE 'landing:multi:['||(SELECT string_agg(to_json(u)::text,',' ORDER BY u) FROM jsonb_array_elements_text(f.urls) u)||']' END AS group_key,
   (NOT (p_filters ? 'channel') OR f.ad_channel=p_filters->>'channel') AS channel_match,
   (p_brand IS NULL OR f.brand=p_brand) AS brand_match,
   (coalesce(p_filters->>'cep','')='' OR p_filters->>'cep'=ANY(CASE WHEN cardinality(ceps)>0 THEN ceps ELSE ARRAY['__unknown__'] END)) AS cep_match,
   (coalesce(p_filters->>'intention','')='' OR coalesce(intention,'__unknown__')=p_filters->>'intention') AS intention_match,
   (coalesce(p_filters->>'objective','')='' OR coalesce(objective,'__unknown__')=p_filters->>'objective') AS objective_match
  FROM facts f
 ), scoped AS MATERIALIZED (
  SELECT * FROM enriched WHERE channel_match AND brand_match AND cep_match AND intention_match AND objective_match
 ), latest_creatives AS MATERIALIZED (
  SELECT DISTINCT ON (f.account_id,f.ad_id) f.account_id,f.ad_id,f.creative_id
  FROM daily f
  WHERE p_group_by='landing_page' AND p_view='overview' AND f.metric_date BETWEEN p_from AND p_to
  ORDER BY f.account_id,f.ad_id,f.metric_date DESC
 ), ad_formats AS MATERIALIZED (
  -- One current format per delivering ad, also used for its comparison cohort.
  -- Known historical IDs stay strict. NULL historical IDs may use the current
  -- inventory-matched creative, explicitly marked as latest metadata in the UI.
  SELECT x.account_id,x.ad_id,coalesce(c.creative_format,'unknown') AS creative_format,
    (latest.creative_id IS NULL AND c.creative_format IS NOT NULL AND c.creative_format<>'unknown') AS uses_latest_metadata
  FROM active_ads x JOIN latest_creatives latest USING(account_id,ad_id)
  LEFT JOIN meta_ad_mappings m ON m.workspace_id=p_workspace_id AND m.account_id=x.account_id AND m.ad_id=x.ad_id
  LEFT JOIN meta_ad_creatives c ON c.workspace_id=p_workspace_id AND c.account_id=x.account_id
    AND c.ad_id=x.ad_id AND c.creative_id=coalesce(latest.creative_id,m.creative_id)
 ), ad_optimizations AS MATERIALIZED (
  -- The latest selected adset identity must match the current provider metadata.
  -- Optimization labels explicitly describe the latest synced configuration.
  SELECT x.account_id,x.ad_id,
   coalesce(observed.campaign_objective,CASE WHEN m.campaign_id=observed.campaign_id THEN m.campaign_objective END,o.campaign_objective) AS objective,
   o.optimization_goal,o.conversion_event,o.custom_conversion_id
  FROM (SELECT DISTINCT account_id,ad_id FROM scoped) x
  LEFT JOIN LATERAL (
   SELECT d.raw_insights->>'adset_id' AS adset_id,d.campaign_id,d.campaign_objective
   FROM meta_ad_daily_metrics d WHERE d.workspace_id=p_workspace_id AND d.account_id=x.account_id AND d.ad_id=x.ad_id
    AND d.metric_date BETWEEN p_from AND p_to ORDER BY d.metric_date DESC LIMIT 1
  ) observed ON true
  LEFT JOIN meta_ad_mappings m ON m.workspace_id=p_workspace_id AND m.account_id=x.account_id AND m.ad_id=x.ad_id
  LEFT JOIN meta_adset_optimizations o ON o.workspace_id=p_workspace_id AND o.account_id=x.account_id
   AND o.adset_id=observed.adset_id AND o.campaign_id=observed.campaign_id
  WHERE p_view='overview' AND (p_group_by='landing_page' OR (p_group_by='ad' AND p_config->>'include_optimization'='true'))
 ), group_rows AS (
  -- Cohort rows may overlap. Summary, facets, history and intention totals below
  -- continue to read unique daily facts from scoped/enriched.
  SELECT s.*,coalesce(x.key,s.group_key) AS report_key FROM scoped s LEFT JOIN LATERAL (
   SELECT public.meta_cep_group_key(c,s.intention) AS key FROM unnest(CASE WHEN cardinality(s.ceps)>0 THEN s.ceps ELSE ARRAY['__unknown__'] END) c
   WHERE p_group_by='cep_intention' AND (coalesce(p_filters->>'cep','')='' OR c=p_filters->>'cep')
  ) x ON true
 ), groups AS (
  SELECT report_key AS group_key,
   CASE WHEN p_group_by='ad' THEN (array_agg(ad_name ORDER BY metric_date DESC,account_id DESC,ad_id DESC))[1]
    WHEN p_group_by='cep_intention' THEN report_key
    WHEN report_key LIKE 'ctwa:%' THEN 'WhatsApp · '||coalesce((min(destination::text)::jsonb)->>'phone_number',
     CASE WHEN (min(destination::text)::jsonb)->>'status'='multiple' THEN 'Beberapa nomor · perlu verifikasi' ELSE 'Nomor belum tersedia' END)
    WHEN report_key='landing:unknown' THEN 'URL belum terbaca'
    WHEN report_key LIKE 'landing:multi:%' THEN 'Beberapa landing page ('||jsonb_array_length((array_agg(urls))[1])||' URL)'
    ELSE substr(report_key,9) END AS name,
   public.meta_ad_report_sum(metrics) FILTER(WHERE metric_date>=p_from) AS current,
   public.meta_ad_report_sum(metrics) FILTER(WHERE metric_date<p_from) AS previous,
   min(destination::text)::jsonb AS destination,
   array_agg(DISTINCT currency ORDER BY currency) AS currencies,
   array_agg(DISTINCT ad_id ORDER BY ad_id) AS ad_ids,
   array_agg(DISTINCT ad_name ORDER BY ad_name) AS ad_names,
   array_agg(DISTINCT account_name ORDER BY account_name) AS accounts,
   coalesce(array_agg(DISTINCT ad_id ORDER BY ad_id) FILTER(WHERE verified),'{}') AS verified_ad_ids
  FROM group_rows GROUP BY report_key
 ), format_groups AS (
  SELECT s.report_key AS group_key,f.creative_format,
    coalesce(array_agg(DISTINCT s.ad_id ORDER BY s.ad_id) FILTER(WHERE f.uses_latest_metadata),'{}') AS latest_metadata_ad_ids,
    array_agg(DISTINCT s.ad_id ORDER BY s.ad_id) AS ad_ids,
    public.meta_ad_report_sum(s.metrics) FILTER(WHERE s.metric_date>=p_from) AS current,
    public.meta_ad_report_sum(s.metrics) FILTER(WHERE s.metric_date<p_from) AS previous
  FROM group_rows s JOIN ad_formats f USING(account_id,ad_id)
  GROUP BY s.report_key,f.creative_format
 ), format_breakdowns AS (
  SELECT group_key,jsonb_agg(jsonb_build_object('format',creative_format,'ad_ids',ad_ids,'latest_metadata_ad_ids',latest_metadata_ad_ids,'current',current,'previous',previous)
    ORDER BY creative_format) AS breakdown FROM format_groups GROUP BY group_key
 ), optimization_groups AS (
  SELECT s.report_key AS group_key,o.objective,o.optimization_goal,o.conversion_event,o.custom_conversion_id,
   array_agg(DISTINCT s.ad_id ORDER BY s.ad_id) AS ad_ids,
   public.meta_ad_report_sum(s.metrics) FILTER(WHERE s.metric_date>=p_from) AS current,
   public.meta_ad_report_sum(s.metrics) FILTER(WHERE s.metric_date<p_from) AS previous
  FROM group_rows s JOIN ad_optimizations o USING(account_id,ad_id)
  GROUP BY s.report_key,o.objective,o.optimization_goal,o.conversion_event,o.custom_conversion_id
 ), optimization_breakdowns AS (
  SELECT group_key,jsonb_agg(to_jsonb(o)-'group_key' ORDER BY objective,optimization_goal,conversion_event,custom_conversion_id) AS breakdown
  FROM optimization_groups o GROUP BY group_key
 ), group_urls AS (
  SELECT report_key AS group_key,array_agg(DISTINCT u ORDER BY u) AS urls FROM group_rows CROSS JOIN LATERAL jsonb_array_elements_text(urls) u GROUP BY report_key
 ), facet_rows AS (
  SELECT 'cep' AS dimension,c AS value,account_id,ad_id FROM enriched CROSS JOIN LATERAL unnest(CASE WHEN cardinality(ceps)>0 THEN ceps ELSE ARRAY['__unknown__'] END) c WHERE metric_date>=p_from AND channel_match AND brand_match AND intention_match AND objective_match
  UNION ALL SELECT 'intention',coalesce(intention,'__unknown__'),account_id,ad_id FROM enriched WHERE metric_date>=p_from AND channel_match AND brand_match AND cep_match AND objective_match
  UNION ALL SELECT 'objective',coalesce(objective,'__unknown__'),account_id,ad_id FROM enriched WHERE metric_date>=p_from AND channel_match AND brand_match AND cep_match AND intention_match
 ), facet_values AS (
  SELECT dimension,value FROM facet_rows
  UNION SELECT 'cep',c.key FROM meta_ad_cep_catalog c JOIN selected_accounts a ON a.brand=c.brand_id::text WHERE c.workspace_id=p_workspace_id
  UNION SELECT 'cep','__unknown__'
  UNION SELECT 'intention',i FROM unnest(ARRAY['disc','cons','conv','__unknown__']) i
  UNION SELECT 'objective',coalesce(m.campaign_objective,'__unknown__') FROM meta_ad_mapping_channels m JOIN selected_accounts a USING(account_id) WHERE m.workspace_id=p_workspace_id AND (NOT (p_filters ? 'channel') OR m.ad_channel=p_filters->>'channel')
 ), facet_counts AS (
  SELECT v.dimension,v.value,count(DISTINCT (r.account_id,r.ad_id)) FILTER(WHERE r.ad_id IS NOT NULL) AS count
  FROM facet_values v LEFT JOIN facet_rows r USING(dimension,value) GROUP BY v.dimension,v.value
 ), coverage AS MATERIALIZED (
  SELECT account_id,metric_date FROM meta_ad_sync_coverage WHERE workspace_id=p_workspace_id
   AND account_id IN (SELECT account_id FROM selected_accounts) AND metric_date BETWEEN start_date AND p_to
 ), buckets AS (
  SELECT DISTINCT CASE WHEN p_view='daily' THEN d::date ELSE date_trunc(p_period,d)::date END AS date
  FROM generate_series(start_date::timestamp,p_to::timestamp,interval '1 day') d
 ), bucket_totals AS (
  SELECT CASE WHEN p_view='daily' THEN metric_date ELSE date_trunc(p_period,metric_date::timestamp)::date END AS date,public.meta_ad_report_sum(metrics) AS totals
  FROM scoped WHERE p_group_key IS NULL OR (p_group_by<>'cep_intention' AND group_key=p_group_key) OR (p_group_by='cep_intention' AND EXISTS(SELECT 1 FROM unnest(CASE WHEN cardinality(ceps)>0 THEN ceps ELSE ARRAY['__unknown__'] END) c WHERE public.meta_cep_group_key(c,intention)=p_group_key)) GROUP BY 1
 ), missing AS (
  SELECT a.account_id,d::date AS date FROM selected_accounts a CROSS JOIN generate_series(start_date::timestamp,p_to::timestamp,interval '1 day') d
  LEFT JOIN coverage c ON c.account_id=a.account_id AND c.metric_date=d::date WHERE c.account_id IS NULL
 ), history AS (
  SELECT b.date,coalesce(t.totals,public.meta_ad_report_finish(array_fill(0::numeric,ARRAY[21]))) AS totals,
   EXISTS(SELECT 1 FROM selected_accounts) AND NOT EXISTS(SELECT 1 FROM missing m WHERE m.date BETWEEN greatest(b.date,start_date) AND least(
    CASE WHEN p_view='daily' THEN b.date WHEN p_period='week' THEN b.date+6 ELSE (b.date+interval '1 month'-interval '1 day')::date END,p_to)) AS complete,
   b.date<start_date OR CASE WHEN p_view='daily' THEN b.date WHEN p_period='week' THEN b.date+6 ELSE (b.date+interval '1 month'-interval '1 day')::date END>p_to AS partial
  FROM buckets b LEFT JOIN bucket_totals t USING(date)
 ) SELECT jsonb_build_object(
  'currencies',(SELECT coalesce(jsonb_agg(DISTINCT currency),'[]') FROM scoped),
  'summary',CASE WHEN p_view='overview' THEN (SELECT public.meta_ad_report_sum(metrics) FROM scoped WHERE metric_date>=p_from) END,
  'previous',CASE WHEN p_view='overview' THEN (SELECT public.meta_ad_report_sum(metrics) FROM scoped WHERE metric_date<p_from) END,
  'groups',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_agg((to_jsonb(g)-'group_key')||jsonb_build_object('key',g.group_key,'landing_page_urls',coalesce(u.urls,'{}'),'format_breakdown',coalesce(fb.breakdown,'[]'::jsonb),'optimization_breakdown',coalesce(ob.breakdown,'[]'::jsonb)) ORDER BY (g.current->>'spend')::numeric DESC,g.group_key),'[]') FROM groups g LEFT JOIN group_urls u USING(group_key) LEFT JOIN format_breakdowns fb USING(group_key) LEFT JOIN optimization_breakdowns ob USING(group_key)) END,
  'coverage',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM coverage c) END,
  'facets',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM facet_counts c) END,
  'facetTotals',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_object_agg(dimension,n),'{}') FROM (SELECT dimension,count(DISTINCT (account_id,ad_id)) AS n FROM facet_rows GROUP BY dimension) counts) END,
  'brandCounts',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_object_agg(brand,n),'{}') FROM (SELECT brand,count(DISTINCT (account_id,ad_id)) AS n FROM enriched WHERE metric_date>=p_from AND channel_match AND cep_match AND intention_match AND objective_match GROUP BY brand) counts) END,
  'channelCounts',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_object_agg(ad_channel,n),'{}') FROM (SELECT ad_channel,count(DISTINCT (account_id,ad_id)) AS n FROM enriched WHERE metric_date>=p_from AND brand_match AND cep_match AND intention_match AND objective_match GROUP BY ad_channel) counts) END,
  'cepLabels',(SELECT coalesce(jsonb_object_agg(c.key,c.label),'{}') FROM meta_ad_cep_catalog c WHERE c.workspace_id=p_workspace_id AND c.brand_id::text IN (SELECT brand FROM selected_accounts)),
  'intentionTotals',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') FROM (SELECT coalesce(intention,'__unknown__') AS intention,public.meta_ad_report_sum(metrics) FILTER(WHERE metric_date>=p_from) AS current FROM scoped GROUP BY intention) i) END,
  'multiCepAds',(SELECT count(DISTINCT (account_id,ad_id)) FROM scoped WHERE metric_date>=p_from AND cardinality(ceps)>1),
  'matchingAds',CASE WHEN p_view='overview' THEN (SELECT count(DISTINCT (account_id,ad_id)) FROM scoped WHERE metric_date>=p_from) END,
  'objectiveUnknownAds',CASE WHEN p_view='overview' THEN (SELECT count(DISTINCT (account_id,ad_id)) FROM enriched WHERE metric_date>=p_from AND channel_match AND brand_match AND objective IS NULL) END,
  'destinations',CASE WHEN p_view='overview' THEN jsonb_build_object(
   'urls',(SELECT count(DISTINCT urls->>0) FROM scoped WHERE metric_date>=p_from AND jsonb_array_length(urls)=1),
   'missing_ads',(SELECT count(DISTINCT (account_id,ad_id)) FROM scoped WHERE metric_date>=p_from AND destination IS NULL AND jsonb_array_length(urls)=0),
   'multi_ads',(SELECT count(DISTINCT (account_id,ad_id)) FROM scoped WHERE metric_date>=p_from AND destination IS NULL AND jsonb_array_length(urls)>1),
   'missing',(SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') FROM (SELECT DISTINCT ON(account_id,ad_id) account_id,ad_id,account_name,ad_name FROM scoped WHERE metric_date>=p_from AND destination IS NULL AND jsonb_array_length(urls)=0 ORDER BY account_id,ad_id,metric_date DESC LIMIT 20) m)) END,
  'history',CASE WHEN p_view IN ('daily','trends') THEN (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY date),'[]') FROM history h) END,
  'historyComplete',CASE WHEN p_view IN ('daily','trends') THEN EXISTS(SELECT 1 FROM selected_accounts) AND NOT EXISTS(SELECT 1 FROM missing) END,
  'creatives',CASE WHEN p_view='creatives' THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('account_id',c.account_id,'ad_id',c.ad_id,'creative_id',c.creative_id,'name',c.name,'thumbnail_url',c.thumbnail_url,'video_id',c.video_id,'body',c.body,'landing_page_urls',c.landing_page_urls) ORDER BY c.account_id,c.ad_id),'[]') FROM meta_ad_creatives c WHERE c.workspace_id=p_workspace_id AND EXISTS(SELECT 1 FROM scoped s WHERE s.account_id=c.account_id AND s.ad_id=c.ad_id AND (s.creative_id IS NULL OR s.creative_id=c.creative_id) AND ((p_group_by<>'cep_intention' AND s.group_key=p_group_key) OR (p_group_by='cep_intention' AND EXISTS(SELECT 1 FROM unnest(CASE WHEN cardinality(s.ceps)>0 THEN s.ceps ELSE ARRAY['__unknown__'] END) k WHERE public.meta_cep_group_key(k,s.intention)=p_group_key))))) END
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_meta_ad_report_incremental(uuid,date,date,jsonb,jsonb,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_ad_report_incremental(uuid,date,date,jsonb,jsonb,text,text,text,text,text) TO service_role;


COMMIT;
