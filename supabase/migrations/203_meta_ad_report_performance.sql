BEGIN;
-- Service-only reports. Cache keys use a transactional data revision, including
-- CLI worker writes: no Next.js request context is needed to invalidate cache.
CREATE TABLE public.meta_ad_report_versions (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id),
 revision bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.meta_ad_report_versions(workspace_id) SELECT id FROM public.workspaces;
ALTER TABLE public.meta_ad_report_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ad_report_versions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_ad_report_versions TO service_role;
CREATE FUNCTION public.bump_meta_ad_report_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  INSERT INTO meta_ad_report_versions(workspace_id,revision)
  SELECT DISTINCT workspace_id,1 FROM meta_old
  ON CONFLICT(workspace_id) DO UPDATE SET revision=meta_ad_report_versions.revision+1,updated_at=now();
 ELSIF TG_OP='INSERT' THEN
  INSERT INTO meta_ad_report_versions(workspace_id,revision)
  SELECT DISTINCT workspace_id,1 FROM meta_new
  ON CONFLICT(workspace_id) DO UPDATE SET revision=meta_ad_report_versions.revision+1,updated_at=now();
 ELSE
  INSERT INTO meta_ad_report_versions(workspace_id,revision)
  SELECT workspace_id,1 FROM (SELECT workspace_id FROM meta_new UNION SELECT workspace_id FROM meta_old) changed
  ON CONFLICT(workspace_id) DO UPDATE SET revision=meta_ad_report_versions.revision+1,updated_at=now();
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.bump_meta_ad_report_version() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['meta_ad_daily_metrics','meta_ad_sync_coverage','meta_ad_creatives','meta_ad_verified_destinations','meta_ad_mappings','meta_ad_accounts','brands'] LOOP
  EXECUTE format('CREATE TRIGGER meta_report_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS meta_new FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version()',t);
  EXECUTE format('CREATE TRIGGER meta_report_update AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS meta_old NEW TABLE AS meta_new FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version()',t);
  EXECUTE format('CREATE TRIGGER meta_report_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS meta_old FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version()',t);
 END LOOP;
END $$;

-- Parse unmapped facts once, with the same leading-bracket rules and aliases as
-- parseAdMapping. Current manual mapping still takes precedence at query time.
CREATE FUNCTION public.meta_ad_name_dimension(p_name text,p_position integer) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 WITH token AS (SELECT nullif(lower(regexp_replace(btrim(normalize(
  CASE WHEN p_position=1 THEN (regexp_match(p_name,'^\s*\[([^\[\]]*)\]'))[1]
       ELSE (regexp_match(p_name,'^\s*\[[^\[\]]*\]\s*\[([^\[\]]*)\]'))[1] END,NFC)), '\s+',' ','g')),'') AS v)
 SELECT CASE WHEN p_position=1 THEN CASE v WHEN 'kulit' THEN 'skin' WHEN 'sendi' THEN 'joint' WHEN 'tulang' THEN 'bone' WHEN 'rambut' THEN 'hair' WHEN 'kuku' THEN 'nail' ELSE v END
 ELSE CASE v WHEN 'discovery' THEN 'disc' WHEN 'consideration' THEN 'cons' WHEN 'conversion' THEN 'conv' ELSE v END END FROM token
$$;
REVOKE ALL ON FUNCTION public.meta_ad_name_dimension(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_ad_name_dimension(text,integer) TO service_role;
ALTER TABLE public.meta_ad_daily_metrics
 ADD COLUMN campaign_id text GENERATED ALWAYS AS (raw_insights->>'campaign_id') STORED,
 ADD COLUMN campaign_objective text GENERATED ALWAYS AS (raw_insights->>'objective') STORED,
 ADD COLUMN naming_cep_key text GENERATED ALWAYS AS (public.meta_ad_name_dimension(ad_name,1)) STORED,
 ADD COLUMN naming_intention_key text GENERATED ALWAYS AS (public.meta_ad_name_dimension(ad_name,2)) STORED;
CREATE INDEX meta_ad_report_account_date ON public.meta_ad_daily_metrics(workspace_id,account_id,metric_date,ad_id);
CREATE INDEX meta_ad_mapping_intention ON public.meta_ad_mappings(workspace_id,intention_key,account_id,ad_id);

-- Sum events before deriving ratios; never average per-ad ratios.
CREATE FUNCTION public.meta_ad_report_add(s numeric[],m jsonb) RETURNS numeric[]
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
 s[21]+coalesce((m->>'replies')::numeric,0)
] $$;
CREATE FUNCTION public.meta_ad_report_finish(s numeric[]) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$ SELECT jsonb_object_agg(k,s[i]) FROM unnest(ARRAY['spend','impressions','clicks','link_clicks','outbound_clicks','lpv','view_content','atc','checkout','purchases','purchase_value','video_plays','video_3s','thruplay','video_25','video_50','video_75','video_100','leads','conversations','replies']) WITH ORDINALITY AS keys(k,i) $$;
CREATE AGGREGATE public.meta_ad_report_sum(jsonb) (SFUNC=public.meta_ad_report_add,STYPE=numeric[],FINALFUNC=public.meta_ad_report_finish,INITCOND='{0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0}');
REVOKE ALL ON FUNCTION public.meta_ad_report_add(numeric[],jsonb), public.meta_ad_report_finish(numeric[]), public.meta_ad_report_sum(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meta_ad_report_add(numeric[],jsonb), public.meta_ad_report_finish(numeric[]), public.meta_ad_report_sum(jsonb) TO service_role;

CREATE FUNCTION public.get_meta_ad_report(
 p_workspace_id uuid,p_from date,p_to date,p_config jsonb DEFAULT '{}'::jsonb,
 p_filters jsonb DEFAULT '{}'::jsonb,p_brand text DEFAULT NULL,p_group_by text DEFAULT 'landing_page',
 p_view text DEFAULT 'overview',p_period text DEFAULT 'week',p_group_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE start_date date; result jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>92
 OR p_group_by IS NULL OR p_view IS NULL OR p_period IS NULL OR p_config IS NULL OR p_filters IS NULL
 OR p_group_by NOT IN ('ad','landing_page') OR p_view NOT IN ('overview','daily','trends','creatives')
 OR p_period NOT IN ('week','month') OR jsonb_typeof(p_config)<>'object' OR jsonb_typeof(p_filters)<>'object'
 THEN RAISE EXCEPTION 'Invalid Meta report scope'; END IF;
 start_date:=CASE WHEN p_view='trends' THEN p_to-89 WHEN p_view='daily' THEN p_from-1 ELSE p_from-(p_to-p_from+1) END;
 WITH active AS MATERIALIZED (
  SELECT a.account_id,a.account_name,coalesce(b.id::text,'__unmapped__') AS brand
  FROM meta_ad_accounts a LEFT JOIN brands b ON b.id=a.default_brand_id AND b.workspace_id=a.workspace_id
  WHERE a.workspace_id=p_workspace_id AND a.is_active
   AND (coalesce(jsonb_array_length(p_config->'account_ids'),0)=0 OR p_config->'account_ids' ? a.account_id)
 ), selected_accounts AS (
  SELECT * FROM active WHERE p_brand IS NULL OR brand=p_brand
 ), campaigns AS (
  SELECT DISTINCT ON (m.account_id,m.campaign_id) m.account_id,m.campaign_id,m.campaign_objective
  FROM meta_ad_mappings m JOIN active a USING(account_id)
  WHERE m.workspace_id=p_workspace_id AND m.campaign_id IS NOT NULL AND m.campaign_objective IS NOT NULL
  ORDER BY m.account_id,m.campaign_id,m.ad_id DESC
 ), facts AS (
  SELECT f.account_id,f.account_name,f.ad_id,f.ad_name,f.creative_id,f.metric_date,f.currency,f.metrics,a.brand,
   CASE WHEN m.ad_id IS NOT NULL THEN m.cep_key ELSE f.naming_cep_key END AS cep,
   CASE WHEN m.ad_id IS NOT NULL THEN m.intention_key ELSE f.naming_intention_key END AS intention,
   coalesce(f.campaign_objective,CASE WHEN m.campaign_id=f.campaign_id THEN m.campaign_objective END,ca.campaign_objective) AS objective,
   CASE WHEN jsonb_array_length(f.landing_page_urls)>0 THEN f.landing_page_urls
    WHEN jsonb_array_length(coalesce(c.landing_page_urls,'[]'))>0 AND (f.creative_id IS NULL OR f.creative_id=c.creative_id) THEN c.landing_page_urls
    WHEN coalesce(f.creative_id,c.creative_id)=v.creative_id THEN jsonb_build_array(v.landing_page_url) ELSE '[]'::jsonb END AS urls,
   jsonb_array_length(f.landing_page_urls)=0 AND NOT (jsonb_array_length(coalesce(c.landing_page_urls,'[]'))>0 AND (f.creative_id IS NULL OR f.creative_id=c.creative_id))
    AND coalesce(f.creative_id,c.creative_id)=v.creative_id AS verified
  FROM meta_ad_daily_metrics f JOIN active a USING(account_id)
  LEFT JOIN meta_ad_mappings m ON m.workspace_id=f.workspace_id AND m.account_id=f.account_id AND m.ad_id=f.ad_id
  LEFT JOIN campaigns ca ON ca.account_id=f.account_id AND ca.campaign_id=f.campaign_id
  LEFT JOIN meta_ad_creatives c ON c.workspace_id=f.workspace_id AND c.account_id=f.account_id AND c.ad_id=f.ad_id
  LEFT JOIN meta_ad_verified_destinations v ON v.workspace_id=f.workspace_id AND v.account_id=f.account_id AND v.ad_id=f.ad_id
  WHERE f.workspace_id=p_workspace_id AND f.metric_date BETWEEN start_date AND p_to
   AND (p_view='overview' OR p_brand IS NULL OR a.brand=p_brand)
   AND (coalesce(p_config->>'name_filter','')='' OR
    CASE WHEN p_config->>'match'='exact' THEN lower(regexp_replace(btrim(f.ad_name),'\s+',' ','g'))=lower(regexp_replace(btrim(p_config->>'name_filter'),'\s+',' ','g'))
     ELSE strpos(lower(regexp_replace(btrim(f.ad_name),'\s+',' ','g')),lower(regexp_replace(btrim(p_config->>'name_filter'),'\s+',' ','g')))>0 END)
 ), enriched AS MATERIALIZED (
  SELECT f.*,CASE WHEN p_group_by='ad' THEN 'ad:'||account_id||':'||ad_id
   WHEN jsonb_array_length(urls)=0 THEN 'landing:unknown'
   WHEN jsonb_array_length(urls)=1 THEN 'landing:'||(urls->>0)
   ELSE 'landing:multi:['||(SELECT string_agg(to_json(u)::text,',' ORDER BY u) FROM jsonb_array_elements_text(urls) u)||']' END AS group_key,
   (p_brand IS NULL OR brand=p_brand) AS brand_match,
   (coalesce(p_filters->>'cep','')='' OR coalesce(cep,'__unknown__')=p_filters->>'cep') AS cep_match,
   (coalesce(p_filters->>'intention','')='' OR coalesce(intention,'__unknown__')=p_filters->>'intention') AS intention_match,
   (coalesce(p_filters->>'objective','')='' OR coalesce(objective,'__unknown__')=p_filters->>'objective') AS objective_match
  FROM facts f
 ), scoped AS MATERIALIZED (
  SELECT * FROM enriched WHERE brand_match AND cep_match AND intention_match AND objective_match
 ), groups AS (
  SELECT group_key,
   CASE WHEN p_group_by='ad' THEN (array_agg(ad_name ORDER BY metric_date DESC,account_id DESC,ad_id DESC))[1]
    WHEN group_key='landing:unknown' THEN 'URL belum terbaca'
    WHEN group_key LIKE 'landing:multi:%' THEN 'Beberapa landing page ('||jsonb_array_length((array_agg(urls))[1])||' URL)'
    ELSE substr(group_key,9) END AS name,
   public.meta_ad_report_sum(metrics) FILTER(WHERE metric_date>=p_from) AS current,
   public.meta_ad_report_sum(metrics) FILTER(WHERE metric_date<p_from) AS previous,
   array_agg(DISTINCT ad_id ORDER BY ad_id) AS ad_ids,
   array_agg(DISTINCT ad_name ORDER BY ad_name) AS ad_names,
   array_agg(DISTINCT account_name ORDER BY account_name) AS accounts,
   coalesce(array_agg(DISTINCT ad_id ORDER BY ad_id) FILTER(WHERE verified),'{}') AS verified_ad_ids
  FROM scoped GROUP BY group_key
 ), group_urls AS (
  SELECT group_key,array_agg(DISTINCT u ORDER BY u) AS urls FROM scoped CROSS JOIN LATERAL jsonb_array_elements_text(urls) u GROUP BY group_key
 ), facet_rows AS (
  SELECT 'cep' AS dimension,coalesce(cep,'__unknown__') AS value,account_id,ad_id FROM enriched WHERE metric_date>=p_from AND brand_match AND intention_match AND objective_match
  UNION ALL SELECT 'intention',coalesce(intention,'__unknown__'),account_id,ad_id FROM enriched WHERE metric_date>=p_from AND brand_match AND cep_match AND objective_match
  UNION ALL SELECT 'objective',coalesce(objective,'__unknown__'),account_id,ad_id FROM enriched WHERE metric_date>=p_from AND brand_match AND cep_match AND intention_match
 ), facet_values AS (
  SELECT dimension,value FROM facet_rows
  UNION SELECT 'cep',coalesce(m.cep_key,'__unknown__') FROM meta_ad_mappings m JOIN selected_accounts a USING(account_id) WHERE m.workspace_id=p_workspace_id
  UNION SELECT 'intention',coalesce(m.intention_key,'__unknown__') FROM meta_ad_mappings m JOIN selected_accounts a USING(account_id) WHERE m.workspace_id=p_workspace_id
  UNION SELECT 'objective',coalesce(m.campaign_objective,'__unknown__') FROM meta_ad_mappings m JOIN selected_accounts a USING(account_id) WHERE m.workspace_id=p_workspace_id
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
  FROM scoped WHERE p_group_key IS NULL OR group_key=p_group_key GROUP BY 1
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
  'groups',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_agg((to_jsonb(g)-'group_key')||jsonb_build_object('key',g.group_key,'landing_page_urls',coalesce(u.urls,'{}')) ORDER BY (g.current->>'spend')::numeric DESC,g.group_key),'[]') FROM groups g LEFT JOIN group_urls u USING(group_key)) END,
  'coverage',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM coverage c) END,
  'facets',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]') FROM facet_counts c) END,
  'facetTotals',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_object_agg(dimension,n),'{}') FROM (SELECT dimension,count(DISTINCT (account_id,ad_id)) AS n FROM facet_rows GROUP BY dimension) counts) END,
  'brandCounts',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_object_agg(brand,n),'{}') FROM (SELECT brand,count(DISTINCT (account_id,ad_id)) AS n FROM enriched WHERE metric_date>=p_from AND cep_match AND intention_match AND objective_match GROUP BY brand) counts) END,
  'matchingAds',CASE WHEN p_view='overview' THEN (SELECT count(DISTINCT (account_id,ad_id)) FROM scoped WHERE metric_date>=p_from) END,
  'objectiveUnknownAds',CASE WHEN p_view='overview' THEN (SELECT count(DISTINCT (account_id,ad_id)) FROM enriched WHERE metric_date>=p_from AND brand_match AND objective IS NULL) END,
  'destinations',CASE WHEN p_view='overview' THEN jsonb_build_object(
   'urls',(SELECT count(DISTINCT urls->>0) FROM scoped WHERE metric_date>=p_from AND jsonb_array_length(urls)=1),
   'missing_ads',(SELECT count(DISTINCT (account_id,ad_id)) FROM scoped WHERE metric_date>=p_from AND jsonb_array_length(urls)=0),
   'multi_ads',(SELECT count(DISTINCT (account_id,ad_id)) FROM scoped WHERE metric_date>=p_from AND jsonb_array_length(urls)>1),
   'missing',(SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') FROM (SELECT DISTINCT ON(account_id,ad_id) account_id,ad_id,account_name,ad_name FROM scoped WHERE metric_date>=p_from AND jsonb_array_length(urls)=0 ORDER BY account_id,ad_id,metric_date DESC LIMIT 20) m)) END,
  'history',CASE WHEN p_view IN ('daily','trends') THEN (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY date),'[]') FROM history h) END,
  'historyComplete',CASE WHEN p_view IN ('daily','trends') THEN EXISTS(SELECT 1 FROM selected_accounts) AND NOT EXISTS(SELECT 1 FROM missing) END,
  'creatives',CASE WHEN p_view='creatives' THEN (SELECT coalesce(jsonb_agg(jsonb_build_object('account_id',c.account_id,'ad_id',c.ad_id,'creative_id',c.creative_id,'name',c.name,'thumbnail_url',c.thumbnail_url,'video_id',c.video_id,'body',c.body,'landing_page_urls',c.landing_page_urls) ORDER BY c.account_id,c.ad_id),'[]') FROM meta_ad_creatives c WHERE c.workspace_id=p_workspace_id AND EXISTS(SELECT 1 FROM scoped s WHERE s.account_id=c.account_id AND s.ad_id=c.ad_id AND s.group_key=p_group_key)) END
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_meta_ad_report(uuid,date,date,jsonb,jsonb,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_ad_report(uuid,date,date,jsonb,jsonb,text,text,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
