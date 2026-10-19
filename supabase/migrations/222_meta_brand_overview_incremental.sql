BEGIN;
-- Incremental enrichment for Ringkasan Brand. Metric writes invalidate only the
-- affected account/day. Metadata changes invalidate that account's history;
-- taxonomy is resolved live once per delivering ad, preserving current rules.
-- No historical facts, mappings, classifications or template assignments change.
CREATE TABLE public.meta_brand_report_epochs (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE, account_id text NOT NULL,
 metric_date date NOT NULL, revision bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(workspace_id,account_id,metric_date)
);
CREATE TABLE public.meta_brand_report_days (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE, account_id text NOT NULL, metric_date date NOT NULL,
 day_revision bigint NOT NULL, account_revision bigint NOT NULL, workspace_revision bigint NOT NULL,
 rows jsonb NOT NULL, refreshed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,account_id,metric_date)
);
ALTER TABLE public.meta_brand_report_epochs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_brand_report_days ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_brand_report_epochs,public.meta_brand_report_days FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_brand_report_epochs,public.meta_brand_report_days TO service_role;

CREATE FUNCTION public.invalidate_meta_brand_report_days() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE source_sql text; account_sql text; date_sql text; fields_sql text;
BEGIN
 account_sql:=CASE WHEN TG_TABLE_NAME='brands' THEN quote_literal('')||'::text' ELSE 'account_id' END;
 date_sql:=CASE WHEN TG_TABLE_NAME='meta_ad_daily_metrics' THEN 'metric_date' ELSE 'DATE ''0001-01-01''' END;
 source_sql:=CASE WHEN TG_OP='DELETE' THEN 'SELECT * FROM meta_old' ELSE 'SELECT * FROM meta_new' END;
 IF TG_OP='UPDATE' THEN
  -- Inventory last_seen_at, sync timestamps and creative copy do not alter this
  -- projection. Taxonomy overrides/rules are resolved live by the batch query.
  fields_sql:=CASE TG_TABLE_NAME
   WHEN 'meta_ad_daily_metrics' THEN 'workspace_id,account_id,ad_id,metric_date,account_name,ad_name,creative_id,currency,metrics,landing_page_urls,raw_insights'
   WHEN 'meta_ad_mappings' THEN 'workspace_id,account_id,ad_id,creative_id,campaign_id,campaign_objective'
   WHEN 'meta_ad_creatives' THEN 'workspace_id,account_id,ad_id,creative_id,landing_page_urls'
   WHEN 'meta_ad_verified_destinations' THEN 'workspace_id,account_id,ad_id,creative_id,landing_page_url'
   WHEN 'meta_ad_destination_metadata' THEN 'workspace_id,account_id,ad_id,creative_id,adset_id,classification,evidence,metadata'
   WHEN 'meta_ad_accounts' THEN 'workspace_id,account_id,is_active,default_brand_id'
   WHEN 'brands' THEN 'workspace_id,id,name' END;
  source_sql:=format('(SELECT %1$s FROM meta_new EXCEPT SELECT %1$s FROM meta_old) UNION (SELECT %1$s FROM meta_old EXCEPT SELECT %1$s FROM meta_new)',fields_sql);
 END IF;
 -- A reserved date is the account metadata epoch; account '' is the workspace
 -- epoch (brand edits). Epochs and source writes commit or roll back together.
 EXECUTE 'INSERT INTO meta_brand_report_epochs AS e(workspace_id,account_id,metric_date,revision)
 SELECT DISTINCT workspace_id,'||account_sql||','||date_sql||',1 FROM ('||source_sql||') changed ORDER BY 1,2,3
 ON CONFLICT(workspace_id,account_id,metric_date) DO UPDATE SET revision=e.revision+1';
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.invalidate_meta_brand_report_days() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['meta_ad_daily_metrics','meta_ad_mappings','meta_ad_creatives','meta_ad_verified_destinations','meta_ad_destination_metadata','meta_ad_accounts','brands'] LOOP
  EXECUTE format('CREATE TRIGGER meta_brand_days_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS meta_new FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_meta_brand_report_days()',t);
  EXECUTE format('CREATE TRIGGER meta_brand_days_update AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS meta_old NEW TABLE AS meta_new FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_meta_brand_report_days()',t);
  EXECUTE format('CREATE TRIGGER meta_brand_days_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS meta_old FOR EACH STATEMENT EXECUTE FUNCTION public.invalidate_meta_brand_report_days()',t);
 END LOOP;
END $$;

CREATE FUNCTION public.refresh_meta_brand_report_days(p_workspace_id uuid,p_days jsonb)
RETURNS void LANGUAGE sql VOLATILE SET search_path=public,pg_temp AS $$
 WITH requested AS MATERIALIZED (
  SELECT * FROM jsonb_to_recordset(p_days) AS q(account_id text,metric_date date,day_revision bigint,account_revision bigint,workspace_revision bigint)
 ), active AS MATERIALIZED (
  SELECT a.account_id,coalesce(b.id::text,'__unmapped__') AS brand
  FROM meta_ad_accounts a LEFT JOIN brands b ON b.id=a.default_brand_id AND b.workspace_id=a.workspace_id
  WHERE a.workspace_id=p_workspace_id AND a.is_active
 ), campaigns AS (
  SELECT DISTINCT ON (m.account_id,m.campaign_id) m.account_id,m.campaign_id,m.campaign_objective
  FROM meta_ad_mappings m JOIN active a USING(account_id)
  WHERE m.workspace_id=p_workspace_id AND m.campaign_id IS NOT NULL AND m.campaign_objective IS NOT NULL
  ORDER BY m.account_id,m.campaign_id,m.ad_id DESC
 ), facts AS (
  SELECT f.account_id,f.account_name,f.ad_id,f.ad_name,f.creative_id,f.metric_date,f.currency,f.metrics,a.brand,
   public.meta_ad_channel_bucket(d.classification,d.evidence,d.metadata,d.creative_id,coalesce(f.creative_id,c.creative_id,m.creative_id),d.adset_id,f.raw_insights->>'adset_id') AS ad_channel,
   CASE WHEN d.creative_id=coalesce(f.creative_id,c.creative_id,m.creative_id)
    AND (f.raw_insights->>'adset_id' IS NULL OR d.adset_id=f.raw_insights->>'adset_id')
    THEN d.metadata ELSE '{}'::jsonb END AS contact_metadata,
   f.naming_cep_key,f.naming_intention_key,
   coalesce(f.campaign_objective,CASE WHEN m.campaign_id=f.campaign_id THEN m.campaign_objective END,ca.campaign_objective) AS objective,
   CASE WHEN jsonb_array_length(f.landing_page_urls)>0 THEN f.landing_page_urls
    WHEN d.metadata ? 'destination_resolution' AND jsonb_array_length(coalesce(d.metadata->'urls','[]'))>0
     AND d.creative_id=coalesce(f.creative_id,c.creative_id,m.creative_id)
     AND (f.raw_insights->>'adset_id' IS NULL OR d.adset_id=f.raw_insights->>'adset_id') THEN d.metadata->'urls'
    WHEN jsonb_array_length(coalesce(c.landing_page_urls,'[]'))>0 AND (f.creative_id IS NULL OR f.creative_id=c.creative_id) THEN c.landing_page_urls
    WHEN coalesce(f.creative_id,c.creative_id)=v.creative_id THEN jsonb_build_array(v.landing_page_url) ELSE '[]'::jsonb END AS urls,
   jsonb_array_length(f.landing_page_urls)=0 AND NOT (jsonb_array_length(coalesce(c.landing_page_urls,'[]'))>0 AND (f.creative_id IS NULL OR f.creative_id=c.creative_id))
    AND coalesce(f.creative_id,c.creative_id)=v.creative_id AS verified
  FROM meta_ad_daily_metrics f JOIN active a USING(account_id) JOIN requested q ON q.account_id=f.account_id AND q.metric_date=f.metric_date
  LEFT JOIN meta_ad_mappings m ON m.workspace_id=f.workspace_id AND m.account_id=f.account_id AND m.ad_id=f.ad_id
  LEFT JOIN campaigns ca ON ca.account_id=f.account_id AND ca.campaign_id=f.campaign_id
  LEFT JOIN meta_ad_creatives c ON c.workspace_id=f.workspace_id AND c.account_id=f.account_id AND c.ad_id=f.ad_id
  LEFT JOIN meta_ad_destination_metadata d ON d.workspace_id=f.workspace_id AND d.account_id=f.account_id AND d.ad_id=f.ad_id
  LEFT JOIN meta_ad_verified_destinations v ON v.workspace_id=f.workspace_id AND v.account_id=f.account_id AND v.ad_id=f.ad_id
  WHERE f.workspace_id=p_workspace_id
 ), contact_scopes AS MATERIALIZED (
  -- Read identity once per distinct ad/creative/adset/URL scope, not once per day.
  SELECT DISTINCT account_id,ad_id,brand,ad_channel,contact_metadata,urls FROM facts
 ), destinations AS MATERIALIZED (
  SELECT s.*,CASE WHEN ad_channel='non_cpas' THEN public.meta_ctwa_destination(
   contact_metadata,urls,brand,account_id,ad_id) END AS destination FROM contact_scopes s
 ), enriched AS (
  SELECT f.account_id,f.ad_id,f.ad_name,f.account_name,f.metric_date,f.currency,f.metrics,f.brand,
   f.naming_cep_key,f.naming_intention_key,f.objective,f.urls,f.verified,f.ad_channel,d.destination,
   CASE WHEN f.ad_channel='cpas' THEN 'ad:'||f.account_id||':'||f.ad_id
    WHEN d.destination IS NOT NULL THEN d.destination->>'key'
    WHEN jsonb_array_length(f.urls)=0 THEN 'landing:unknown'
    WHEN jsonb_array_length(f.urls)=1 THEN 'landing:'||(f.urls->>0)
    ELSE 'landing:multi:['||(SELECT string_agg(to_json(u)::text,',' ORDER BY u) FROM jsonb_array_elements_text(f.urls) u)||']' END AS group_key
  FROM facts f JOIN destinations d ON d.account_id=f.account_id AND d.ad_id=f.ad_id
   AND d.brand=f.brand AND d.ad_channel=f.ad_channel AND d.contact_metadata=f.contact_metadata AND d.urls=f.urls
 ), daily AS (
  SELECT account_id,metric_date,jsonb_agg(to_jsonb(e) ORDER BY ad_id) AS rows FROM enriched e GROUP BY account_id,metric_date
 ) INSERT INTO meta_brand_report_days(workspace_id,account_id,metric_date,day_revision,account_revision,workspace_revision,rows)
 SELECT p_workspace_id,q.account_id,q.metric_date,q.day_revision,q.account_revision,q.workspace_revision,coalesce(d.rows,'[]')
 FROM requested q LEFT JOIN daily d USING(account_id,metric_date) ORDER BY q.account_id,q.metric_date
 ON CONFLICT(workspace_id,account_id,metric_date) DO UPDATE SET day_revision=EXCLUDED.day_revision,
  account_revision=EXCLUDED.account_revision,workspace_revision=EXCLUDED.workspace_revision,rows=EXCLUDED.rows,refreshed_at=clock_timestamp()
 WHERE meta_brand_report_days.day_revision<=EXCLUDED.day_revision AND meta_brand_report_days.account_revision<=EXCLUDED.account_revision
  AND meta_brand_report_days.workspace_revision<=EXCLUDED.workspace_revision;
$$;
REVOKE ALL ON FUNCTION public.refresh_meta_brand_report_days(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_meta_brand_report_days(uuid,jsonb) TO service_role;

CREATE FUNCTION public.get_meta_brand_overview_report(p_workspace_id uuid,p_from date,p_to date,p_filters jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
DECLARE start_date date; dirty jsonb; result jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>92
  OR p_filters IS NULL OR jsonb_typeof(p_filters)<>'object' THEN RAISE EXCEPTION 'Invalid Meta brand report scope'; END IF;
 start_date:=p_from-(p_to-p_from+1);
 WITH active AS (SELECT account_id FROM meta_ad_accounts WHERE workspace_id=p_workspace_id AND is_active), needed AS (
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
  LEFT JOIN brands b ON b.id=a.default_brand_id AND b.workspace_id=a.workspace_id WHERE a.workspace_id=p_workspace_id AND a.is_active
 ), daily AS MATERIALIZED (
  SELECT f.* FROM meta_brand_report_days d JOIN active a USING(account_id)
  CROSS JOIN LATERAL jsonb_to_recordset(d.rows) AS f(account_id text,ad_id text,ad_name text,account_name text,metric_date date,currency text,metrics jsonb,
   brand text,naming_cep_key text,naming_intention_key text,objective text,urls jsonb,verified boolean,ad_channel text,destination jsonb,group_key text)
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
   public.meta_ad_report_sum(metrics) FILTER(WHERE metric_date>=p_from) AS current,
   public.meta_ad_report_sum(metrics) FILTER(WHERE metric_date<p_from) AS previous,
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
   public.meta_ad_report_sum(s.metrics) FILTER(WHERE s.metric_date>=p_from) AS summary,
   public.meta_ad_report_sum(s.metrics) FILTER(WHERE s.metric_date<p_from) AS previous,
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
REVOKE ALL ON FUNCTION public.get_meta_brand_overview_report(uuid,date,date,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_brand_overview_report(uuid,date,date,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
