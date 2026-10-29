BEGIN;
-- Decode cached daily metrics once and aggregate with native numeric SUMs.
-- Keep the old complete-report contract by default. The detail page explicitly
-- requests no breakdown; each selected breakdown has its own bounded cache read.
-- No source data, existing projection certificates or historical migrations change.
CREATE OR REPLACE FUNCTION public.get_meta_ad_report_incremental(
 p_workspace_id uuid,p_from date,p_to date,p_config jsonb DEFAULT '{}'::jsonb,
 p_filters jsonb DEFAULT '{}'::jsonb,p_brand text DEFAULT NULL,p_group_by text DEFAULT 'landing_page',
 p_view text DEFAULT 'overview',p_period text DEFAULT 'week',p_group_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
DECLARE start_date date; result jsonb; optimization_filter jsonb; analysis boolean; breakdown text; breakdown_only boolean;
BEGIN
 IF p_workspace_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>92
 OR p_group_by IS NULL OR p_view IS NULL OR p_period IS NULL OR p_config IS NULL OR p_filters IS NULL
 OR p_group_by NOT IN ('ad','landing_page','cep_intention') OR p_view NOT IN ('overview','daily','trends','creatives')
 OR (p_filters ? 'channel' AND (jsonb_typeof(p_filters->'channel') <> 'string' OR p_filters->>'channel' NOT IN ('non_cpas','cpas','unknown')))
 OR p_period NOT IN ('week','month') OR jsonb_typeof(p_config)<>'object' OR jsonb_typeof(p_filters)<>'object'
 THEN RAISE EXCEPTION 'Invalid Meta report scope'; END IF;
 -- Reject malformed filters instead of silently broadening a report.
 IF (p_filters ? 'format' AND (jsonb_typeof(p_filters->'format')<>'string' OR p_filters->>'format' NOT IN ('image','video','carousel','mixed','unknown')))
 OR (p_filters ? 'partnership' AND (jsonb_typeof(p_filters->'partnership')<>'string' OR p_filters->>'partnership' NOT IN ('partnership','non_partnership','unknown')))
 THEN RAISE EXCEPTION 'Invalid Meta analysis filter'; END IF;
 IF p_filters ? 'optimization' THEN
  IF jsonb_typeof(p_filters->'optimization')<>'string' OR length(p_filters->>'optimization')>500 THEN RAISE EXCEPTION 'Invalid Meta optimization filter'; END IF;
  optimization_filter:=(p_filters->>'optimization')::jsonb;
  IF jsonb_typeof(optimization_filter)<>'array' THEN RAISE EXCEPTION 'Invalid Meta optimization filter'; END IF;
  IF jsonb_array_length(optimization_filter)<>4 OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(optimization_filter) WITH ORDINALITY e(value,n)
   WHERE jsonb_typeof(value)<>'null' AND (jsonb_typeof(value)<>'string' OR
    (value#>>'{}') !~ CASE WHEN n=4 THEN '^[0-9]{1,100}$' ELSE '^[A-Z0-9_]{1,100}$' END)
  ) THEN RAISE EXCEPTION 'Invalid Meta optimization filter'; END IF;
 END IF;
 breakdown:=coalesce(p_config->>'breakdown','all');
 breakdown_only:=coalesce(p_config->>'breakdown_only','false')='true';
 IF breakdown NOT IN ('all','none','format','optimization','partnership')
 OR (breakdown_only AND (p_view<>'overview' OR p_group_by<>'landing_page' OR breakdown NOT IN ('format','optimization','partnership')))
 THEN RAISE EXCEPTION 'Invalid Meta breakdown scope'; END IF;
 analysis:=p_view='overview' AND coalesce(p_config->>'include_analysis','false')='true';
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
  SELECT f.*, n.spend AS m_spend, n.impressions AS m_impressions, n.clicks AS m_clicks, n.link_clicks AS m_link_clicks, n.outbound_clicks AS m_outbound_clicks, n.lpv AS m_lpv, n.view_content AS m_view_content, n.atc AS m_atc, n.checkout AS m_checkout, n.purchases AS m_purchases, n.purchase_value AS m_purchase_value, n.video_plays AS m_video_plays, n.video_3s AS m_video_3s, n.thruplay AS m_thruplay, n.video_25 AS m_video_25, n.video_50 AS m_video_50, n.video_75 AS m_video_75, n.video_100 AS m_video_100, n.leads AS m_leads, n.conversations AS m_conversations, n.replies AS m_replies, n.instagram_profile_visits AS m_instagram_profile_visits FROM meta_brand_report_days d JOIN active a USING(account_id)
  CROSS JOIN LATERAL jsonb_to_recordset(d.rows) AS f(account_id text,ad_id text,ad_name text,account_name text,creative_id text,metric_date date,currency text,metrics jsonb,
   brand text,naming_cep_key text,naming_intention_key text,objective text,urls jsonb,verified boolean,ad_channel text,destination jsonb)
  CROSS JOIN LATERAL jsonb_to_record(f.metrics) AS n(spend numeric,impressions numeric,clicks numeric,link_clicks numeric,outbound_clicks numeric,lpv numeric,view_content numeric,atc numeric,checkout numeric,purchases numeric,purchase_value numeric,video_plays numeric,video_3s numeric,thruplay numeric,video_25 numeric,video_50 numeric,video_75 numeric,video_100 numeric,leads numeric,conversations numeric,replies numeric,instagram_profile_visits numeric)
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
   f.m_spend,f.m_impressions,f.m_clicks,f.m_link_clicks,f.m_outbound_clicks,f.m_lpv,f.m_view_content,f.m_atc,f.m_checkout,f.m_purchases,f.m_purchase_value,f.m_video_plays,f.m_video_3s,f.m_thruplay,f.m_video_25,f.m_video_50,f.m_video_75,f.m_video_100,f.m_leads,f.m_conversations,f.m_replies,f.m_instagram_profile_visits,
   l.cep_keys[1] AS cep,l.cep_keys AS ceps,l.intention_key AS intention,f.objective,f.urls,f.verified,
   CASE WHEN p_group_by='landing_page' THEN f.destination END AS destination
  FROM daily f JOIN labels l USING(account_id,ad_id)
  WHERE f.metric_date BETWEEN start_date AND p_to AND (p_view='overview' OR p_brand IS NULL OR f.brand=p_brand)
   AND (coalesce(p_config->>'name_filter','')='' OR
    CASE WHEN p_config->>'match'='exact' THEN lower(regexp_replace(btrim(f.ad_name),'\s+',' ','g'))=lower(regexp_replace(btrim(p_config->>'name_filter'),'\s+',' ','g'))
     ELSE strpos(lower(regexp_replace(btrim(f.ad_name),'\s+',' ','g')),lower(regexp_replace(btrim(p_config->>'name_filter'),'\s+',' ','g')))>0 END)
 ), dimension_enriched AS MATERIALIZED (
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
 ), latest_creatives AS MATERIALIZED (
  SELECT DISTINCT ON (f.account_id,f.ad_id) f.account_id,f.ad_id,f.creative_id
  FROM daily f
  WHERE ((p_view='overview' AND ((p_group_by='landing_page' AND breakdown IN ('all','format','partnership')) OR (p_group_by='ad' AND p_config->>'include_matrix'='true')))
    OR analysis OR p_filters ? 'format' OR p_filters ? 'partnership') AND f.metric_date BETWEEN p_from AND p_to
  ORDER BY f.account_id,f.ad_id,f.metric_date DESC
 ), ad_formats AS MATERIALIZED (
  -- One current format per delivering ad, also used for its comparison cohort.
  -- Known historical IDs stay strict. NULL historical IDs may use the current
  -- inventory-matched creative, explicitly marked as latest metadata in the UI.
  SELECT x.account_id,x.ad_id,coalesce(c.creative_format,'unknown') AS creative_format,
    CASE WHEN c.partnership_metadata->>'version'='1' THEN coalesce(c.partnership_metadata->>'status','unknown') ELSE 'unknown' END AS partnership_status,
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
  FROM (SELECT DISTINCT account_id,ad_id FROM dimension_enriched
   WHERE analysis OR optimization_filter IS NOT NULL OR (channel_match AND brand_match AND cep_match AND intention_match AND objective_match)) x
  LEFT JOIN LATERAL (
   SELECT d.raw_insights->>'adset_id' AS adset_id,d.campaign_id,d.campaign_objective
   FROM meta_ad_daily_metrics d WHERE d.workspace_id=p_workspace_id AND d.account_id=x.account_id AND d.ad_id=x.ad_id
    AND d.metric_date BETWEEN p_from AND p_to ORDER BY d.metric_date DESC LIMIT 1
  ) observed ON true
  LEFT JOIN meta_ad_mappings m ON m.workspace_id=p_workspace_id AND m.account_id=x.account_id AND m.ad_id=x.ad_id
  LEFT JOIN meta_adset_optimizations o ON o.workspace_id=p_workspace_id AND o.account_id=x.account_id
   AND o.adset_id=observed.adset_id AND o.campaign_id=observed.campaign_id
  WHERE (p_view='overview' AND ((p_group_by='landing_page' AND breakdown IN ('all','optimization')) OR (p_group_by='ad' AND p_config->>'include_optimization'='true')))
   OR analysis OR optimization_filter IS NOT NULL
 ), enriched AS MATERIALIZED (
  SELECT b.*,coalesce(f.creative_format,'unknown') AS creative_format,coalesce(f.partnership_status,'unknown') AS partnership_status,
   jsonb_build_array(o.objective,o.optimization_goal,o.conversion_event,o.custom_conversion_id) AS optimization_value,
   (NOT (p_filters ? 'format') OR coalesce(f.creative_format,'unknown')=p_filters->>'format') AS format_match,
   (NOT (p_filters ? 'partnership') OR coalesce(f.partnership_status,'unknown')=p_filters->>'partnership') AS partnership_match,
   (optimization_filter IS NULL OR jsonb_build_array(o.objective,o.optimization_goal,o.conversion_event,o.custom_conversion_id)=optimization_filter) AS optimization_match
  FROM dimension_enriched b LEFT JOIN ad_formats f USING(account_id,ad_id) LEFT JOIN ad_optimizations o USING(account_id,ad_id)
 ), scoped AS MATERIALIZED (
  SELECT * FROM enriched WHERE channel_match AND brand_match AND cep_match AND intention_match AND objective_match
   AND format_match AND partnership_match AND optimization_match
 ), matrix_ad_metadata AS MATERIALIZED (
  SELECT 'ad:'||x.account_id||':'||x.ad_id AS group_key,
   jsonb_build_object('cep_keys',CASE WHEN coalesce(p_filters->>'cep','')<>'' THEN ARRAY[p_filters->>'cep'] ELSE coalesce(l.cep_keys,'{}') END,
    'creative_format',coalesce(f.creative_format,'unknown'),'uses_latest_metadata',coalesce(f.uses_latest_metadata,false)) AS value
  FROM (SELECT DISTINCT account_id,ad_id FROM scoped) x
  JOIN labels l USING(account_id,ad_id) LEFT JOIN ad_formats f USING(account_id,ad_id)
  WHERE p_view='overview' AND p_group_by='ad' AND p_config->>'include_matrix'='true'
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
   public.meta_ad_report_finish(ARRAY[
    coalesce(sum(m_spend) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_impressions) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_clicks) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_link_clicks) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_outbound_clicks) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_lpv) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_view_content) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_atc) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_checkout) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_purchases) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_purchase_value) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_plays) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_3s) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_thruplay) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_25) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_50) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_75) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_100) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_leads) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_conversations) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_replies) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_instagram_profile_visits) FILTER(WHERE metric_date>=p_from),0),
    count(m_instagram_profile_visits) FILTER(WHERE metric_date>=p_from),
    count(*) FILTER(WHERE metric_date>=p_from)
   ]::numeric[]) AS current,
   public.meta_ad_report_finish(ARRAY[
    coalesce(sum(m_spend) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_impressions) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_clicks) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_link_clicks) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_outbound_clicks) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_lpv) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_view_content) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_atc) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_checkout) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_purchases) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_purchase_value) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_video_plays) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_video_3s) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_thruplay) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_video_25) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_video_50) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_video_75) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_video_100) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_leads) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_conversations) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_replies) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_instagram_profile_visits) FILTER(WHERE metric_date<p_from),0),
    count(m_instagram_profile_visits) FILTER(WHERE metric_date<p_from),
    count(*) FILTER(WHERE metric_date<p_from)
   ]::numeric[]) AS previous,
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
    public.meta_ad_report_finish(ARRAY[
    coalesce(sum(s.m_spend) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_impressions) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_clicks) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_link_clicks) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_outbound_clicks) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_lpv) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_view_content) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_atc) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_checkout) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_purchases) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_purchase_value) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_plays) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_3s) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_thruplay) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_25) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_50) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_75) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_100) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_leads) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_conversations) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_replies) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date>=p_from),0),
    count(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date>=p_from),
    count(*) FILTER(WHERE s.metric_date>=p_from)
   ]::numeric[]) AS current,
    public.meta_ad_report_finish(ARRAY[
    coalesce(sum(s.m_spend) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_impressions) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_clicks) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_link_clicks) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_outbound_clicks) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_lpv) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_view_content) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_atc) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_checkout) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_purchases) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_purchase_value) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_plays) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_3s) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_thruplay) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_25) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_50) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_75) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_100) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_leads) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_conversations) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_replies) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date<p_from),0),
    count(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date<p_from),
    count(*) FILTER(WHERE s.metric_date<p_from)
   ]::numeric[]) AS previous
  FROM group_rows s JOIN ad_formats f USING(account_id,ad_id)
  WHERE p_group_by='landing_page' AND breakdown IN ('all','format')
  GROUP BY s.report_key,f.creative_format
 ), format_breakdowns AS (
  SELECT group_key,jsonb_agg(jsonb_build_object('format',creative_format,'ad_ids',ad_ids,'latest_metadata_ad_ids',latest_metadata_ad_ids,'current',current,'previous',previous)
    ORDER BY creative_format) AS breakdown FROM format_groups GROUP BY group_key
 ), partnership_groups AS (
  -- Mutually exclusive current-ad cohorts, including their prior-period metrics.
  -- Identity uses the same strict creative binding as format; NULL historical IDs
  -- may use inventory-matched current metadata. This describes latest setup, not historical proof.
  SELECT s.report_key AS group_key,f.partnership_status AS status,
   array_agg(DISTINCT s.ad_id ORDER BY s.ad_id) AS ad_ids,
   public.meta_ad_report_finish(ARRAY[
    coalesce(sum(s.m_spend) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_impressions) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_clicks) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_link_clicks) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_outbound_clicks) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_lpv) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_view_content) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_atc) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_checkout) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_purchases) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_purchase_value) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_plays) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_3s) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_thruplay) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_25) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_50) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_75) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_100) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_leads) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_conversations) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_replies) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date>=p_from),0),
    count(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date>=p_from),
    count(*) FILTER(WHERE s.metric_date>=p_from)
   ]::numeric[]) AS current,
   public.meta_ad_report_finish(ARRAY[
    coalesce(sum(s.m_spend) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_impressions) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_clicks) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_link_clicks) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_outbound_clicks) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_lpv) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_view_content) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_atc) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_checkout) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_purchases) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_purchase_value) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_plays) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_3s) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_thruplay) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_25) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_50) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_75) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_100) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_leads) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_conversations) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_replies) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date<p_from),0),
    count(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date<p_from),
    count(*) FILTER(WHERE s.metric_date<p_from)
   ]::numeric[]) AS previous
  FROM group_rows s JOIN ad_formats f USING(account_id,ad_id)
  WHERE p_group_by='landing_page' AND breakdown IN ('all','partnership')
  GROUP BY s.report_key,f.partnership_status
 ), partnership_breakdowns AS (
  SELECT group_key,jsonb_agg(to_jsonb(p)-'group_key' ORDER BY status) AS breakdown
  FROM partnership_groups p GROUP BY group_key
 ), optimization_groups AS (
  SELECT s.report_key AS group_key,o.objective,o.optimization_goal,o.conversion_event,o.custom_conversion_id,
   array_agg(DISTINCT s.ad_id ORDER BY s.ad_id) AS ad_ids,
   public.meta_ad_report_finish(ARRAY[
    coalesce(sum(s.m_spend) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_impressions) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_clicks) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_link_clicks) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_outbound_clicks) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_lpv) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_view_content) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_atc) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_checkout) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_purchases) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_purchase_value) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_plays) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_3s) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_thruplay) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_25) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_50) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_75) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_100) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_leads) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_conversations) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_replies) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date>=p_from),0),
    count(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date>=p_from),
    count(*) FILTER(WHERE s.metric_date>=p_from)
   ]::numeric[]) AS current,
   public.meta_ad_report_finish(ARRAY[
    coalesce(sum(s.m_spend) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_impressions) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_clicks) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_link_clicks) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_outbound_clicks) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_lpv) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_view_content) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_atc) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_checkout) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_purchases) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_purchase_value) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_plays) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_3s) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_thruplay) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_25) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_50) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_75) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_100) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_leads) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_conversations) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_replies) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date<p_from),0),
    count(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date<p_from),
    count(*) FILTER(WHERE s.metric_date<p_from)
   ]::numeric[]) AS previous
  FROM group_rows s JOIN ad_optimizations o USING(account_id,ad_id)
  WHERE p_group_by='landing_page' AND breakdown IN ('all','optimization')
  GROUP BY s.report_key,o.objective,o.optimization_goal,o.conversion_event,o.custom_conversion_id
  UNION ALL
  -- An ad group already contains exactly this ad/account cohort. Reuse its
  -- totals instead of running the 21-metric aggregate a second time per ad.
  SELECT g.group_key,o.objective,o.optimization_goal,o.conversion_event,o.custom_conversion_id,
   g.ad_ids,g.current,g.previous
  FROM groups g JOIN ad_optimizations o ON g.group_key='ad:'||o.account_id||':'||o.ad_id
  WHERE p_group_by='ad' AND p_config->>'include_optimization'='true'
 ), optimization_breakdowns AS (
  SELECT group_key,jsonb_agg(to_jsonb(o)-'group_key' ORDER BY objective,optimization_goal,conversion_event,custom_conversion_id) AS breakdown
  FROM optimization_groups o GROUP BY group_key
 ), group_urls AS (
  SELECT report_key AS group_key,array_agg(DISTINCT u ORDER BY u) AS urls FROM group_rows CROSS JOIN LATERAL jsonb_array_elements_text(urls) u GROUP BY report_key
 ), facet_rows AS (
  SELECT 'cep' AS dimension,c AS value,account_id,ad_id FROM enriched CROSS JOIN LATERAL unnest(CASE WHEN cardinality(ceps)>0 THEN ceps ELSE ARRAY['__unknown__'] END) c WHERE metric_date>=p_from AND channel_match AND brand_match AND intention_match AND objective_match AND format_match AND partnership_match AND optimization_match
  UNION ALL SELECT 'intention',coalesce(intention,'__unknown__'),account_id,ad_id FROM enriched WHERE metric_date>=p_from AND channel_match AND brand_match AND cep_match AND objective_match AND format_match AND partnership_match AND optimization_match
  UNION ALL SELECT 'objective',coalesce(objective,'__unknown__'),account_id,ad_id FROM enriched WHERE metric_date>=p_from AND channel_match AND brand_match AND cep_match AND intention_match AND format_match AND partnership_match AND optimization_match
 ), facet_values AS (
  SELECT dimension,value FROM facet_rows
  UNION SELECT 'cep',c.key FROM meta_ad_cep_catalog c JOIN selected_accounts a ON a.brand=c.brand_id::text WHERE c.workspace_id=p_workspace_id
  UNION SELECT 'cep','__unknown__'
  UNION SELECT 'intention',i FROM unnest(ARRAY['disc','cons','conv','__unknown__']) i
  UNION SELECT 'objective',coalesce(m.campaign_objective,'__unknown__') FROM meta_ad_mapping_channels m JOIN selected_accounts a USING(account_id) WHERE m.workspace_id=p_workspace_id AND (NOT (p_filters ? 'channel') OR m.ad_channel=p_filters->>'channel')
 ), facet_counts AS (
  SELECT v.dimension,v.value,count(DISTINCT (r.account_id,r.ad_id)) FILTER(WHERE r.ad_id IS NOT NULL) AS count
  FROM facet_values v LEFT JOIN facet_rows r USING(dimension,value) GROUP BY v.dimension,v.value
 ), analysis_rows AS (
  -- Each facet excludes only its own filter and counts an ad once, not per day/CEP.
  SELECT 'format' AS dimension,creative_format AS value,account_id,ad_id FROM enriched
   WHERE analysis AND metric_date>=p_from AND channel_match AND brand_match AND cep_match AND intention_match AND objective_match AND partnership_match AND optimization_match
  UNION ALL SELECT 'partnership',partnership_status,account_id,ad_id FROM enriched
   WHERE analysis AND metric_date>=p_from AND channel_match AND brand_match AND cep_match AND intention_match AND objective_match AND format_match AND optimization_match
  UNION ALL SELECT 'optimization',optimization_value::text,account_id,ad_id FROM enriched
   WHERE analysis AND metric_date>=p_from AND channel_match AND brand_match AND cep_match AND intention_match AND objective_match AND format_match AND partnership_match
 ), analysis_values AS (
  SELECT dimension,value FROM analysis_rows
  UNION SELECT 'format',v FROM unnest(ARRAY['image','video','carousel','mixed','unknown']) v WHERE analysis
  UNION SELECT 'partnership',v FROM unnest(ARRAY['partnership','non_partnership','unknown']) v WHERE analysis
  UNION SELECT 'optimization',optimization_value::text FROM enriched WHERE analysis AND metric_date>=p_from AND channel_match AND brand_match
 ), analysis_counts AS (
  SELECT v.dimension,v.value,count(DISTINCT (r.account_id,r.ad_id)) FILTER(WHERE r.ad_id IS NOT NULL) AS count
  FROM analysis_values v LEFT JOIN analysis_rows r USING(dimension,value) GROUP BY v.dimension,v.value
 ), coverage AS MATERIALIZED (
  SELECT account_id,metric_date FROM meta_ad_sync_coverage WHERE workspace_id=p_workspace_id
   AND account_id IN (SELECT account_id FROM selected_accounts) AND metric_date BETWEEN start_date AND p_to
 ), buckets AS (
  SELECT DISTINCT CASE WHEN p_view='daily' THEN d::date ELSE date_trunc(p_period,d)::date END AS date
  FROM generate_series(start_date::timestamp,p_to::timestamp,interval '1 day') d
 ), bucket_totals AS (
  SELECT CASE WHEN p_view='daily' THEN metric_date ELSE date_trunc(p_period,metric_date::timestamp)::date END AS date,public.meta_ad_report_finish(ARRAY[
    coalesce(sum(m_spend),0),
    coalesce(sum(m_impressions),0),
    coalesce(sum(m_clicks),0),
    coalesce(sum(m_link_clicks),0),
    coalesce(sum(m_outbound_clicks),0),
    coalesce(sum(m_lpv),0),
    coalesce(sum(m_view_content),0),
    coalesce(sum(m_atc),0),
    coalesce(sum(m_checkout),0),
    coalesce(sum(m_purchases),0),
    coalesce(sum(m_purchase_value),0),
    coalesce(sum(m_video_plays),0),
    coalesce(sum(m_video_3s),0),
    coalesce(sum(m_thruplay),0),
    coalesce(sum(m_video_25),0),
    coalesce(sum(m_video_50),0),
    coalesce(sum(m_video_75),0),
    coalesce(sum(m_video_100),0),
    coalesce(sum(m_leads),0),
    coalesce(sum(m_conversations),0),
    coalesce(sum(m_replies),0),
    coalesce(sum(m_instagram_profile_visits),0),
    count(m_instagram_profile_visits),
    count(*)
   ]::numeric[]) AS totals
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
  ) SELECT CASE WHEN breakdown_only THEN jsonb_build_object(
  'currencies',(SELECT coalesce(jsonb_agg(DISTINCT currency),'[]') FROM scoped),
  'groups',(SELECT coalesce(jsonb_agg(jsonb_build_object('key',k.group_key,
    'format_breakdown',coalesce(f.breakdown,'[]'::jsonb),
    'partnership_breakdown',coalesce(p.breakdown,'[]'::jsonb),
    'optimization_breakdown',coalesce(o.breakdown,'[]'::jsonb)) ORDER BY k.group_key),'[]'::jsonb)
   FROM (SELECT group_key FROM format_breakdowns UNION SELECT group_key FROM partnership_breakdowns UNION SELECT group_key FROM optimization_breakdowns) k
   LEFT JOIN format_breakdowns f USING(group_key) LEFT JOIN partnership_breakdowns p USING(group_key) LEFT JOIN optimization_breakdowns o USING(group_key))
 ) ELSE jsonb_build_object(
  'currencies',(SELECT coalesce(jsonb_agg(DISTINCT currency),'[]') FROM scoped),
  'summary',CASE WHEN p_view='overview' THEN (SELECT public.meta_ad_report_finish(ARRAY[
    coalesce(sum(m_spend),0),
    coalesce(sum(m_impressions),0),
    coalesce(sum(m_clicks),0),
    coalesce(sum(m_link_clicks),0),
    coalesce(sum(m_outbound_clicks),0),
    coalesce(sum(m_lpv),0),
    coalesce(sum(m_view_content),0),
    coalesce(sum(m_atc),0),
    coalesce(sum(m_checkout),0),
    coalesce(sum(m_purchases),0),
    coalesce(sum(m_purchase_value),0),
    coalesce(sum(m_video_plays),0),
    coalesce(sum(m_video_3s),0),
    coalesce(sum(m_thruplay),0),
    coalesce(sum(m_video_25),0),
    coalesce(sum(m_video_50),0),
    coalesce(sum(m_video_75),0),
    coalesce(sum(m_video_100),0),
    coalesce(sum(m_leads),0),
    coalesce(sum(m_conversations),0),
    coalesce(sum(m_replies),0),
    coalesce(sum(m_instagram_profile_visits),0),
    count(m_instagram_profile_visits),
    count(*)
   ]::numeric[]) FROM scoped WHERE metric_date>=p_from) END,
  'previous',CASE WHEN p_view='overview' THEN (SELECT public.meta_ad_report_finish(ARRAY[
    coalesce(sum(m_spend),0),
    coalesce(sum(m_impressions),0),
    coalesce(sum(m_clicks),0),
    coalesce(sum(m_link_clicks),0),
    coalesce(sum(m_outbound_clicks),0),
    coalesce(sum(m_lpv),0),
    coalesce(sum(m_view_content),0),
    coalesce(sum(m_atc),0),
    coalesce(sum(m_checkout),0),
    coalesce(sum(m_purchases),0),
    coalesce(sum(m_purchase_value),0),
    coalesce(sum(m_video_plays),0),
    coalesce(sum(m_video_3s),0),
    coalesce(sum(m_thruplay),0),
    coalesce(sum(m_video_25),0),
    coalesce(sum(m_video_50),0),
    coalesce(sum(m_video_75),0),
    coalesce(sum(m_video_100),0),
    coalesce(sum(m_leads),0),
    coalesce(sum(m_conversations),0),
    coalesce(sum(m_replies),0),
    coalesce(sum(m_instagram_profile_visits),0),
    count(m_instagram_profile_visits),
    count(*)
   ]::numeric[]) FROM scoped WHERE metric_date<p_from) END,
  'groups',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_agg((to_jsonb(g)-'group_key')||jsonb_build_object('key',g.group_key,'landing_page_urls',coalesce(u.urls,'{}'),'format_breakdown',coalesce(fb.breakdown,'[]'::jsonb),'optimization_breakdown',coalesce(ob.breakdown,'[]'::jsonb),'partnership_breakdown',coalesce(pb.breakdown,'[]'::jsonb))||CASE WHEN p_group_by='ad' AND p_config->>'include_matrix'='true' THEN jsonb_build_object('matrix_metadata',mm.value) ELSE '{}'::jsonb END ORDER BY (g.current->>'spend')::numeric DESC,g.group_key),'[]') FROM groups g LEFT JOIN group_urls u USING(group_key) LEFT JOIN format_breakdowns fb USING(group_key) LEFT JOIN optimization_breakdowns ob USING(group_key) LEFT JOIN partnership_breakdowns pb USING(group_key) LEFT JOIN matrix_ad_metadata mm USING(group_key)) END,
  'coverage',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM coverage c) END,
  'facets',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM facet_counts c) END,
  'facetTotals',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_object_agg(dimension,n),'{}') FROM (SELECT dimension,count(DISTINCT (account_id,ad_id)) AS n FROM facet_rows GROUP BY dimension) counts) END,
  'brandCounts',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_object_agg(brand,n),'{}') FROM (SELECT brand,count(DISTINCT (account_id,ad_id)) AS n FROM enriched WHERE metric_date>=p_from AND channel_match AND cep_match AND intention_match AND objective_match AND format_match AND partnership_match AND optimization_match GROUP BY brand) counts) END,
  'channelCounts',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_object_agg(ad_channel,n),'{}') FROM (SELECT ad_channel,count(DISTINCT (account_id,ad_id)) AS n FROM enriched WHERE metric_date>=p_from AND brand_match AND cep_match AND intention_match AND objective_match AND format_match AND partnership_match AND optimization_match GROUP BY ad_channel) counts) END,
  'cepLabels',(SELECT coalesce(jsonb_object_agg(c.key,c.label),'{}') FROM meta_ad_cep_catalog c WHERE c.workspace_id=p_workspace_id AND c.brand_id::text IN (SELECT brand FROM selected_accounts)),
  'intentionTotals',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]') FROM (SELECT coalesce(intention,'__unknown__') AS intention,public.meta_ad_report_finish(ARRAY[
    coalesce(sum(m_spend) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_impressions) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_clicks) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_link_clicks) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_outbound_clicks) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_lpv) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_view_content) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_atc) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_checkout) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_purchases) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_purchase_value) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_plays) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_3s) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_thruplay) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_25) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_50) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_75) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_100) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_leads) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_conversations) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_replies) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_instagram_profile_visits) FILTER(WHERE metric_date>=p_from),0),
    count(m_instagram_profile_visits) FILTER(WHERE metric_date>=p_from),
    count(*) FILTER(WHERE metric_date>=p_from)
   ]::numeric[]) AS current FROM scoped GROUP BY intention) i) END,
  'multiCepAds',(SELECT count(DISTINCT (account_id,ad_id)) FROM scoped WHERE metric_date>=p_from AND cardinality(ceps)>1),
  'matchingAds',CASE WHEN p_view='overview' THEN (SELECT count(DISTINCT (account_id,ad_id)) FROM scoped WHERE metric_date>=p_from) END,
  'objectiveUnknownAds',CASE WHEN p_view='overview' THEN (SELECT count(DISTINCT (account_id,ad_id)) FROM enriched WHERE metric_date>=p_from AND channel_match AND brand_match AND objective IS NULL AND format_match AND partnership_match AND optimization_match) END,
  'destinations',CASE WHEN p_view='overview' THEN jsonb_build_object(
   'urls',(SELECT count(DISTINCT urls->>0) FROM scoped WHERE metric_date>=p_from AND jsonb_array_length(urls)=1),
   'missing_ads',(SELECT count(DISTINCT (account_id,ad_id)) FROM scoped WHERE metric_date>=p_from AND destination IS NULL AND jsonb_array_length(urls)=0),
   'multi_ads',(SELECT count(DISTINCT (account_id,ad_id)) FROM scoped WHERE metric_date>=p_from AND destination IS NULL AND jsonb_array_length(urls)>1),
   'missing',(SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') FROM (SELECT DISTINCT ON(account_id,ad_id) account_id,ad_id,account_name,ad_name FROM scoped WHERE metric_date>=p_from AND destination IS NULL AND jsonb_array_length(urls)=0 ORDER BY account_id,ad_id,metric_date DESC LIMIT 20) m)) END,
  'history',CASE WHEN p_view IN ('daily','trends') THEN (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY date),'[]') FROM history h) END,
  'historyComplete',CASE WHEN p_view IN ('daily','trends') THEN EXISTS(SELECT 1 FROM selected_accounts) AND NOT EXISTS(SELECT 1 FROM missing) END,
  'creatives',CASE WHEN p_view='creatives' THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('account_id',c.account_id,'ad_id',c.ad_id,'creative_id',c.creative_id,'name',c.name,'thumbnail_url',c.thumbnail_url,'video_id',c.video_id,'body',c.body,'landing_page_urls',c.landing_page_urls) ORDER BY c.account_id,c.ad_id),'[]') FROM meta_ad_creatives c WHERE c.workspace_id=p_workspace_id AND EXISTS(SELECT 1 FROM scoped s WHERE s.account_id=c.account_id AND s.ad_id=c.ad_id AND (s.creative_id IS NULL OR s.creative_id=c.creative_id) AND ((p_group_by<>'cep_intention' AND s.group_key=p_group_key) OR (p_group_by='cep_intention' AND EXISTS(SELECT 1 FROM unnest(CASE WHEN cardinality(s.ceps)>0 THEN s.ceps ELSE ARRAY['__unknown__'] END) k WHERE public.meta_cep_group_key(k,s.intention)=p_group_key))))) END
 ) || CASE WHEN analysis THEN jsonb_build_object(
  'analysisFacets',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY dimension,value),'[]') FROM analysis_counts c),
  'analysisFacetTotals',(SELECT coalesce(jsonb_object_agg(dimension,n),'{}') FROM (SELECT dimension,count(DISTINCT (account_id,ad_id)) AS n FROM analysis_rows GROUP BY dimension) counts)
 ) ELSE '{}'::jsonb END END INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_meta_ad_report_incremental(uuid,date,date,jsonb,jsonb,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_ad_report_incremental(uuid,date,date,jsonb,jsonb,text,text,text,text,text) TO service_role;

CREATE FUNCTION public.get_meta_brand_detail_report_light(p_workspace_id uuid,p_from date,p_to date,p_brand text,p_channel text,p_filters jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
DECLARE config jsonb; ids jsonb;
BEGIN
 IF p_channel IS NULL OR p_channel NOT IN ('non_cpas','cpas') OR p_brand IS NULL THEN RAISE EXCEPTION 'Invalid brand detail scope'; END IF;
 SELECT jsonb_agg(a.account_id ORDER BY a.account_id) INTO ids FROM meta_ad_accounts a LEFT JOIN brands b ON b.workspace_id=a.workspace_id AND b.id=a.default_brand_id
 WHERE a.workspace_id=p_workspace_id AND a.is_active AND coalesce(b.id::text,'__unmapped__')=p_brand;
 -- A brand with no active accounts returns an empty scoped report. An
 -- impossible account ID keeps an empty brand from meaning "all accounts".
 config:=jsonb_build_object('account_ids',coalesce(ids,'[""]'::jsonb),'breakdown','none');
 RETURN jsonb_build_object(
  'website',public.get_meta_ad_report_incremental(p_workspace_id,p_from,p_to,config||jsonb_build_object('include_analysis',p_channel='non_cpas'),p_filters||'{"channel":"non_cpas"}',p_brand,'landing_page'),
  'cpas',public.get_meta_ad_report_incremental(p_workspace_id,p_from,p_to,config||jsonb_build_object('include_analysis',p_channel='cpas'),p_filters||'{"channel":"cpas"}',p_brand,'ad'),
  'cep',public.get_meta_ad_report_incremental(p_workspace_id,p_from,p_to,config,p_filters||jsonb_build_object('channel',p_channel),p_brand,'cep_intention'));
END $$;
REVOKE ALL ON FUNCTION public.get_meta_brand_detail_report_light(uuid,date,date,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_brand_detail_report_light(uuid,date,date,text,text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.get_meta_brand_overview_report_scoped(p_workspace_id uuid,p_from date,p_to date,p_filters jsonb,p_brand_ids integer[])
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
DECLARE start_date date; dirty jsonb; result jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>92
  OR p_filters IS NULL OR jsonb_typeof(p_filters)<>'object' THEN RAISE EXCEPTION 'Invalid Meta brand report scope'; END IF;
 start_date:=p_from-(p_to-p_from+1);
 WITH active AS (SELECT account_id FROM meta_ad_accounts WHERE workspace_id=p_workspace_id AND is_active AND (p_brand_ids IS NULL OR default_brand_id=ANY(p_brand_ids))), needed AS (
  SELECT f.account_id,f.metric_date FROM meta_ad_daily_metrics f JOIN active a USING(account_id)
   WHERE f.workspace_id=p_workspace_id AND f.metric_date BETWEEN start_date AND p_to GROUP BY f.account_id,f.metric_date
  UNION SELECT d.account_id,d.metric_date FROM meta_brand_report_days d JOIN active a USING(account_id)
   WHERE d.workspace_id=p_workspace_id AND d.metric_date BETWEEN start_date AND p_to
 ), versions AS (
  SELECT n.*,coalesce(e.revision,0) AS day_revision,coalesce(a.revision,0) AS account_revision,coalesce(w.revision,0) AS workspace_revision
  FROM needed n LEFT JOIN meta_brand_report_epochs e ON e.workspace_id=p_workspace_id AND e.account_id=n.account_id AND e.metric_date=n.metric_date
  LEFT JOIN meta_brand_report_epochs a ON a.workspace_id=p_workspace_id AND a.account_id=n.account_id AND a.metric_date=DATE '0001-01-01'
  LEFT JOIN meta_brand_report_epochs w ON w.workspace_id=p_workspace_id AND w.account_id='' AND w.metric_date=DATE '0001-01-01'
 ) SELECT coalesce(jsonb_agg(to_jsonb(v)),'[]') INTO dirty FROM versions v
 LEFT JOIN meta_brand_report_days d ON d.workspace_id=p_workspace_id AND d.account_id=v.account_id AND d.metric_date=v.metric_date
 WHERE d.day_revision IS DISTINCT FROM v.day_revision OR d.account_revision IS DISTINCT FROM v.account_revision OR d.workspace_revision IS DISTINCT FROM v.workspace_revision;
 IF jsonb_array_length(dirty)>0 THEN PERFORM public.refresh_meta_brand_report_days(p_workspace_id,dirty); END IF;

 WITH active AS MATERIALIZED (
  SELECT a.account_id,coalesce(b.id::text,'__unmapped__') AS brand FROM meta_ad_accounts a
  LEFT JOIN brands b ON b.id=a.default_brand_id AND b.workspace_id=a.workspace_id WHERE a.workspace_id=p_workspace_id AND a.is_active AND (p_brand_ids IS NULL OR a.default_brand_id=ANY(p_brand_ids))
 ), daily AS MATERIALIZED (
  SELECT f.*, n.spend AS m_spend, n.impressions AS m_impressions, n.clicks AS m_clicks, n.link_clicks AS m_link_clicks, n.outbound_clicks AS m_outbound_clicks, n.lpv AS m_lpv, n.view_content AS m_view_content, n.atc AS m_atc, n.checkout AS m_checkout, n.purchases AS m_purchases, n.purchase_value AS m_purchase_value, n.video_plays AS m_video_plays, n.video_3s AS m_video_3s, n.thruplay AS m_thruplay, n.video_25 AS m_video_25, n.video_50 AS m_video_50, n.video_75 AS m_video_75, n.video_100 AS m_video_100, n.leads AS m_leads, n.conversations AS m_conversations, n.replies AS m_replies, n.instagram_profile_visits AS m_instagram_profile_visits FROM meta_brand_report_days d JOIN active a USING(account_id)
  CROSS JOIN LATERAL jsonb_to_recordset(d.rows) AS f(account_id text,ad_id text,ad_name text,account_name text,metric_date date,currency text,metrics jsonb,
   brand text,naming_cep_key text,naming_intention_key text,objective text,urls jsonb,verified boolean,ad_channel text,destination jsonb,group_key text)
  CROSS JOIN LATERAL jsonb_to_record(f.metrics) AS n(spend numeric,impressions numeric,clicks numeric,link_clicks numeric,outbound_clicks numeric,lpv numeric,view_content numeric,atc numeric,checkout numeric,purchases numeric,purchase_value numeric,video_plays numeric,video_3s numeric,thruplay numeric,video_25 numeric,video_50 numeric,video_75 numeric,video_100 numeric,leads numeric,conversations numeric,replies numeric,instagram_profile_visits numeric)
  WHERE d.workspace_id=p_workspace_id AND d.metric_date BETWEEN start_date AND p_to
 ), active_ads AS MATERIALIZED (
  SELECT DISTINCT account_id,ad_id FROM daily WHERE metric_date>=p_from AND coalesce((metrics->>'impressions')::numeric,0)>0
 ), labels AS MATERIALIZED (
  SELECT x.account_id,x.ad_id,ARRAY(SELECT jsonb_array_elements_text(r.value->'cep_keys')) AS ceps,r.value->>'intention_key' AS intention
  FROM active_ads x JOIN active a USING(account_id)
  LEFT JOIN meta_ad_mappings m ON m.workspace_id=p_workspace_id AND m.account_id=x.account_id AND m.ad_id=x.ad_id
  LEFT JOIN LATERAL (SELECT f.naming_cep_key,f.naming_intention_key FROM daily f WHERE m.ad_id IS NULL AND f.account_id=x.account_id AND f.ad_id=x.ad_id
   AND f.metric_date>=p_from ORDER BY f.metric_date DESC LIMIT 1) fallback ON true
  CROSS JOIN LATERAL (SELECT public.resolve_meta_ad_taxonomy(p_workspace_id,CASE WHEN a.brand='__unmapped__' THEN NULL ELSE a.brand::integer END,
   coalesce(m.auto_mapping,jsonb_build_object('tags',jsonb_build_array(jsonb_build_object('dimension','cep','key',fallback.naming_cep_key),jsonb_build_object('dimension','intention','key',fallback.naming_intention_key)))),coalesce(m.overrides,'{}')) AS value OFFSET 0) r
 ), enriched AS MATERIALIZED (
  SELECT f.*,l.ceps,l.intention,
   (coalesce(p_filters->>'cep','')='' OR p_filters->>'cep'=ANY(CASE WHEN cardinality(l.ceps)>0 THEN l.ceps ELSE ARRAY['__unknown__'] END)) AS cep_match,
   (coalesce(p_filters->>'intention','')='' OR coalesce(l.intention,'__unknown__')=p_filters->>'intention') AS intention_match,
   (coalesce(p_filters->>'objective','')='' OR coalesce(f.objective,'__unknown__')=p_filters->>'objective') AS objective_match
  FROM daily f JOIN labels l USING(account_id,ad_id)
 ), scoped AS MATERIALIZED (
  SELECT * FROM enriched WHERE ad_channel IN ('non_cpas','cpas') AND cep_match AND intention_match AND objective_match
 ), groups AS (
  SELECT brand,ad_channel,group_key,
   CASE WHEN ad_channel='cpas' THEN (array_agg(ad_name ORDER BY metric_date DESC,account_id DESC,ad_id DESC))[1]
    WHEN group_key LIKE 'ctwa:%' THEN 'WhatsApp · '||coalesce((min(destination::text)::jsonb)->>'phone_number',
     CASE WHEN (min(destination::text)::jsonb)->>'status'='multiple' THEN 'Beberapa nomor · perlu verifikasi' ELSE 'Nomor belum tersedia' END)
    WHEN group_key='landing:unknown' THEN 'URL belum terbaca'
    WHEN group_key LIKE 'landing:multi:%' THEN 'Beberapa landing page ('||jsonb_array_length((array_agg(urls))[1])||' URL)'
    ELSE substr(group_key,9) END AS name,
   public.meta_ad_report_finish(ARRAY[
    coalesce(sum(m_spend) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_impressions) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_clicks) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_link_clicks) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_outbound_clicks) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_lpv) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_view_content) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_atc) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_checkout) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_purchases) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_purchase_value) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_plays) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_3s) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_thruplay) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_25) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_50) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_75) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_video_100) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_leads) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_conversations) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_replies) FILTER(WHERE metric_date>=p_from),0),
    coalesce(sum(m_instagram_profile_visits) FILTER(WHERE metric_date>=p_from),0),
    count(m_instagram_profile_visits) FILTER(WHERE metric_date>=p_from),
    count(*) FILTER(WHERE metric_date>=p_from)
   ]::numeric[]) AS current,
   public.meta_ad_report_finish(ARRAY[
    coalesce(sum(m_spend) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_impressions) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_clicks) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_link_clicks) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_outbound_clicks) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_lpv) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_view_content) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_atc) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_checkout) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_purchases) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_purchase_value) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_video_plays) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_video_3s) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_thruplay) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_video_25) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_video_50) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_video_75) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_video_100) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_leads) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_conversations) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_replies) FILTER(WHERE metric_date<p_from),0),
    coalesce(sum(m_instagram_profile_visits) FILTER(WHERE metric_date<p_from),0),
    count(m_instagram_profile_visits) FILTER(WHERE metric_date<p_from),
    count(*) FILTER(WHERE metric_date<p_from)
   ]::numeric[]) AS previous,
   min(destination::text)::jsonb AS destination,array_agg(DISTINCT currency ORDER BY currency) AS currencies,
   array_agg(DISTINCT ad_id ORDER BY ad_id) AS ad_ids,array_agg(DISTINCT ad_name ORDER BY ad_name) AS ad_names,
   array_agg(DISTINCT account_name ORDER BY account_name) AS accounts,
   coalesce(array_agg(DISTINCT ad_id ORDER BY ad_id) FILTER(WHERE verified),'{}') AS verified_ad_ids
  FROM scoped GROUP BY brand,ad_channel,group_key
 ), group_urls AS (
  SELECT brand,ad_channel,group_key,array_agg(DISTINCT u ORDER BY u) AS urls FROM scoped CROSS JOIN LATERAL jsonb_array_elements_text(urls) u GROUP BY brand,ad_channel,group_key
 ), group_reports AS (
  SELECT g.brand,g.ad_channel,jsonb_agg((to_jsonb(g)-'brand'-'ad_channel'-'group_key')||jsonb_build_object('key',g.group_key,'landing_page_urls',coalesce(u.urls,'{}'))
   ORDER BY (g.current->>'spend')::numeric DESC,g.group_key) AS groups FROM groups g LEFT JOIN group_urls u USING(brand,ad_channel,group_key) GROUP BY g.brand,g.ad_channel
 ), worlds AS (
  SELECT b.brand,c.ad_channel FROM (SELECT DISTINCT brand FROM active) b CROSS JOIN (VALUES('non_cpas'),('cpas')) c(ad_channel)
 ), summaries AS (
  SELECT w.brand,w.ad_channel,coalesce(array_agg(DISTINCT s.currency ORDER BY s.currency) FILTER(WHERE s.currency IS NOT NULL),'{}') AS currencies,
   public.meta_ad_report_finish(ARRAY[
    coalesce(sum(s.m_spend) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_impressions) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_clicks) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_link_clicks) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_outbound_clicks) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_lpv) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_view_content) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_atc) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_checkout) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_purchases) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_purchase_value) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_plays) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_3s) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_thruplay) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_25) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_50) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_75) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_video_100) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_leads) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_conversations) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_replies) FILTER(WHERE s.metric_date>=p_from),0),
    coalesce(sum(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date>=p_from),0),
    count(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date>=p_from),
    count(*) FILTER(WHERE s.metric_date>=p_from)
   ]::numeric[]) AS summary,
   public.meta_ad_report_finish(ARRAY[
    coalesce(sum(s.m_spend) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_impressions) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_clicks) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_link_clicks) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_outbound_clicks) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_lpv) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_view_content) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_atc) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_checkout) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_purchases) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_purchase_value) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_plays) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_3s) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_thruplay) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_25) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_50) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_75) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_video_100) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_leads) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_conversations) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_replies) FILTER(WHERE s.metric_date<p_from),0),
    coalesce(sum(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date<p_from),0),
    count(s.m_instagram_profile_visits) FILTER(WHERE s.metric_date<p_from),
    count(*) FILTER(WHERE s.metric_date<p_from)
   ]::numeric[]) AS previous,
   count(DISTINCT (s.account_id,s.ad_id)) FILTER(WHERE s.metric_date>=p_from) AS "matchingAds",
   count(DISTINCT s.urls->>0) FILTER(WHERE s.metric_date>=p_from AND jsonb_array_length(s.urls)=1) AS urls,
   count(DISTINCT (s.account_id,s.ad_id)) FILTER(WHERE s.metric_date>=p_from AND s.destination IS NULL AND jsonb_array_length(s.urls)=0) AS missing_ads,
   count(DISTINCT (s.account_id,s.ad_id)) FILTER(WHERE s.metric_date>=p_from AND s.destination IS NULL AND jsonb_array_length(s.urls)>1) AS multi_ads
  FROM worlds w LEFT JOIN scoped s USING(brand,ad_channel) GROUP BY w.brand,w.ad_channel
 ), coverage AS (
  SELECT a.brand,jsonb_agg(jsonb_build_object('account_id',c.account_id,'metric_date',c.metric_date) ORDER BY c.account_id,c.metric_date) AS rows
  FROM meta_ad_sync_coverage c JOIN active a USING(account_id) WHERE c.workspace_id=p_workspace_id AND c.metric_date BETWEEN start_date AND p_to GROUP BY a.brand
 ), cep_spend AS (
  SELECT brand,c AS cep,sum(coalesce((metrics->>'spend')::numeric,0)) AS spend FROM scoped
  CROSS JOIN LATERAL unnest(CASE WHEN cardinality(ceps)>0 THEN ceps ELSE ARRAY['__unknown__'] END) c
  WHERE metric_date>=p_from AND (coalesce(p_filters->>'cep','')='' OR c=p_filters->>'cep') GROUP BY brand,c
 ), facet_rows AS (
  SELECT 'cep' AS dimension,c AS value,account_id,ad_id FROM enriched CROSS JOIN LATERAL unnest(CASE WHEN cardinality(ceps)>0 THEN ceps ELSE ARRAY['__unknown__'] END) c
   WHERE metric_date>=p_from AND ad_channel='non_cpas' AND intention_match AND objective_match
  UNION ALL SELECT 'intention',coalesce(intention,'__unknown__'),account_id,ad_id FROM enriched WHERE metric_date>=p_from AND ad_channel='non_cpas' AND cep_match AND objective_match
  UNION ALL SELECT 'objective',coalesce(objective,'__unknown__'),account_id,ad_id FROM enriched WHERE metric_date>=p_from AND ad_channel='non_cpas' AND cep_match AND intention_match
 ), facet_values AS (
  SELECT dimension,value FROM facet_rows
  UNION SELECT 'cep',c.key FROM meta_ad_cep_catalog c JOIN active a ON a.brand=c.brand_id::text WHERE c.workspace_id=p_workspace_id
  UNION SELECT 'cep','__unknown__'
  UNION SELECT 'intention',i FROM unnest(ARRAY['disc','cons','conv','__unknown__']) i
  UNION SELECT 'objective',coalesce(m.campaign_objective,'__unknown__') FROM meta_ad_mapping_channels m JOIN active a USING(account_id) WHERE m.workspace_id=p_workspace_id AND m.ad_channel='non_cpas'
 ), facet_counts AS (
  SELECT v.dimension,v.value,count(DISTINCT (r.account_id,r.ad_id)) FILTER(WHERE r.ad_id IS NOT NULL) AS count
  FROM facet_values v LEFT JOIN facet_rows r USING(dimension,value) GROUP BY v.dimension,v.value
 ) SELECT jsonb_build_object(
  'reports',(SELECT coalesce(jsonb_agg(jsonb_build_object('brand',s.brand,'channel',s.ad_channel,'report',jsonb_build_object(
   'currencies',s.currencies,'summary',s.summary,'previous',s.previous,'matchingAds',s."matchingAds",'groups',coalesce(g.groups,'[]'),
   'coverage',coalesce(c.rows,'[]'),'destinations',jsonb_build_object('urls',s.urls,'missing_ads',s.missing_ads,'multi_ads',s.multi_ads,'missing','[]'::jsonb),
   'facets','[]'::jsonb,'facetTotals','{}'::jsonb,'brandCounts','{}'::jsonb,'objectiveUnknownAds',0,'history','[]'::jsonb,'historyComplete',false,'creatives','[]'::jsonb)
  ) ORDER BY s.brand,s.ad_channel),'[]') FROM summaries s LEFT JOIN group_reports g USING(brand,ad_channel) LEFT JOIN coverage c USING(brand)),
  'cepSpend',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY brand,cep),'[]') FROM cep_spend c),
  'facets',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY dimension,value),'[]') FROM facet_counts c),
  'facetTotals',(SELECT coalesce(jsonb_object_agg(dimension,n),'{}') FROM (SELECT dimension,count(DISTINCT (account_id,ad_id)) AS n FROM facet_rows GROUP BY dimension) t),
  'cepLabels',(SELECT coalesce(jsonb_object_agg(c.key,c.label),'{}') FROM meta_ad_cep_catalog c WHERE c.workspace_id=p_workspace_id AND c.brand_id::text IN (SELECT brand FROM active))
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_meta_brand_overview_report_scoped(uuid,date,date,jsonb,integer[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_brand_overview_report_scoped(uuid,date,date,jsonb,integer[]) TO service_role;

-- One overview implementation preserves the authorized-brand predicate for both
-- unrestricted owners and assigned advertisers; no authorization is cached here.
CREATE OR REPLACE FUNCTION public.get_meta_brand_overview_report(p_workspace_id uuid,p_from date,p_to date,p_filters jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE sql VOLATILE SET search_path=public,pg_temp AS $$
 SELECT public.get_meta_brand_overview_report_scoped(p_workspace_id,p_from,p_to,p_filters,NULL);
$$;
REVOKE ALL ON FUNCTION public.get_meta_brand_overview_report(uuid,date,date,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_brand_overview_report(uuid,date,date,jsonb) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
