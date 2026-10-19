BEGIN;

-- Membership-scoped grants. Empty assignments intentionally grant no brand.
CREATE UNIQUE INDEX brands_workspace_id_id_access_key ON public.brands(workspace_id,id);
CREATE TABLE public.workspace_advertiser_brands (
 workspace_id uuid NOT NULL,user_id uuid NOT NULL,brand_id integer NOT NULL,
 created_by uuid REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,user_id,brand_id),
 FOREIGN KEY(workspace_id,user_id) REFERENCES public.workspace_memberships(workspace_id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,brand_id) REFERENCES public.brands(workspace_id,id) ON DELETE CASCADE
);
ALTER TABLE public.workspace_advertiser_brands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_advertiser_brands FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_advertiser_brands TO service_role;
CREATE TABLE public.workspace_advertiser_brand_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id uuid NOT NULL,user_id uuid NOT NULL,
 before_brand_ids integer[] NOT NULL,after_brand_ids integer[] NOT NULL,changed_by uuid,changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_advertiser_brand_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_advertiser_brand_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.workspace_advertiser_brand_audit TO service_role;

CREATE FUNCTION public.set_workspace_advertiser_brands(p_workspace_id uuid,p_user_id uuid,p_brand_ids integer[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_ids integer[];new_ids integer[];
BEGIN
 IF auth.uid() IS NULL OR NOT public.workspace_has_role(p_workspace_id,ARRAY['workspace_owner']) THEN
  RAISE EXCEPTION 'Hanya owner workspace yang bisa mengalokasikan brand.';
 END IF;
 IF p_brand_ids IS NULL OR cardinality(p_brand_ids)>500 OR array_position(p_brand_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'Alokasi brand tidak valid.'; END IF;
 -- Use the same lock order as role approval/revocation (migration 221).
 PERFORM 1 FROM profiles WHERE id=p_user_id FOR UPDATE;
 PERFORM 1 FROM workspace_memberships WHERE workspace_id=p_workspace_id AND user_id=p_user_id AND role='advertiser' AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'User bukan advertiser aktif di workspace ini.'; END IF;
 SELECT coalesce(array_agg(DISTINCT b ORDER BY b),'{}') INTO new_ids FROM unnest(p_brand_ids) b;
 IF EXISTS(SELECT 1 FROM unnest(new_ids) b WHERE NOT EXISTS(SELECT 1 FROM brands WHERE workspace_id=p_workspace_id AND id=b)) THEN RAISE EXCEPTION 'Brand berada di luar workspace ini.'; END IF;
 SELECT coalesce(array_agg(brand_id ORDER BY brand_id),'{}') INTO old_ids FROM workspace_advertiser_brands WHERE workspace_id=p_workspace_id AND user_id=p_user_id;
 DELETE FROM workspace_advertiser_brands WHERE workspace_id=p_workspace_id AND user_id=p_user_id AND NOT(brand_id=ANY(new_ids));
 INSERT INTO workspace_advertiser_brands(workspace_id,user_id,brand_id,created_by)
 SELECT p_workspace_id,p_user_id,b,auth.uid() FROM unnest(new_ids) b ON CONFLICT DO NOTHING;
 INSERT INTO workspace_advertiser_brand_audit(workspace_id,user_id,before_brand_ids,after_brand_ids,changed_by) VALUES(p_workspace_id,p_user_id,old_ids,new_ids,auth.uid());
 RETURN jsonb_build_object('brandIds',new_ids);
END $$;
REVOKE ALL ON FUNCTION public.set_workspace_advertiser_brands(uuid,uuid,integer[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_workspace_advertiser_brands(uuid,uuid,integer[]) TO authenticated;

CREATE FUNCTION public.clear_advertiser_brand_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old_ids integer[];
BEGIN
 IF OLD.role IS DISTINCT FROM NEW.role OR OLD.status IS DISTINCT FROM NEW.status THEN
  SELECT coalesce(array_agg(brand_id ORDER BY brand_id),'{}') INTO old_ids FROM workspace_advertiser_brands WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;
  DELETE FROM workspace_advertiser_brands WHERE workspace_id=OLD.workspace_id AND user_id=OLD.user_id;
  IF cardinality(old_ids)>0 THEN INSERT INTO workspace_advertiser_brand_audit(workspace_id,user_id,before_brand_ids,after_brand_ids,changed_by) VALUES(OLD.workspace_id,OLD.user_id,old_ids,'{}',auth.uid()); END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clear_advertiser_brand_access() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER clear_advertiser_brand_access AFTER UPDATE OF role,status ON public.workspace_memberships FOR EACH ROW EXECUTE FUNCTION public.clear_advertiser_brand_access();
CREATE TRIGGER meta_report_insert AFTER INSERT ON public.workspace_advertiser_brands REFERENCING NEW TABLE AS meta_new FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version();
CREATE TRIGGER meta_report_delete AFTER DELETE ON public.workspace_advertiser_brands REFERENCING OLD TABLE AS meta_old FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version();

-- Scope accounts before projections, totals, facets, coverage and labels.
-- The existing unrestricted RPC remains unchanged for older application releases.
CREATE FUNCTION public.get_meta_brand_overview_report_scoped(p_workspace_id uuid,p_from date,p_to date,p_filters jsonb,p_brand_ids integer[])
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
REVOKE ALL ON FUNCTION public.get_meta_brand_overview_report_scoped(uuid,date,date,jsonb,integer[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_brand_overview_report_scoped(uuid,date,date,jsonb,integer[]) TO service_role;


NOTIFY pgrst,'reload schema';
COMMIT;
