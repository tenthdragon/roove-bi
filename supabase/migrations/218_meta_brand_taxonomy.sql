BEGIN;
-- Brand-owned vocabulary. Raw inventory tags and legacy overrides are retained.
CREATE TABLE public.meta_ad_cep_catalog (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),brand_id integer NOT NULL REFERENCES public.brands(id),
 key text NOT NULL CHECK(key ~ '^[a-z][a-z0-9_.-]{0,79}$'),label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 100),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=1000),revision integer NOT NULL DEFAULT 1,
 updated_by uuid REFERENCES auth.users(id),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,brand_id,key),UNIQUE(workspace_id,key)
);
CREATE TABLE public.meta_ad_taxonomy_rules (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),brand_id integer NOT NULL REFERENCES public.brands(id),
 dimension text NOT NULL CHECK(dimension IN ('cep','intention')),raw_key text NOT NULL CHECK(length(raw_key) BETWEEN 1 AND 500),
 cep_keys text[] NOT NULL DEFAULT '{}',intention_key text CHECK(intention_key IN ('disc','cons','conv')),
 revision integer NOT NULL DEFAULT 1,updated_by uuid NOT NULL REFERENCES auth.users(id),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,brand_id,dimension,raw_key),
 CHECK((dimension='cep' AND cardinality(cep_keys)>0 AND intention_key IS NULL) OR (dimension='intention' AND cardinality(cep_keys)=0 AND intention_key IS NOT NULL))
);
CREATE TABLE public.meta_ad_taxonomy_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 entity text NOT NULL,identity jsonb NOT NULL,before_value jsonb,after_value jsonb,changed_by uuid REFERENCES auth.users(id),changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_ad_cep_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ad_taxonomy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ad_taxonomy_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ad_cep_catalog,public.meta_ad_taxonomy_rules,public.meta_ad_taxonomy_audit FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_ad_cep_catalog,public.meta_ad_taxonomy_rules,public.meta_ad_taxonomy_audit TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.meta_ad_taxonomy_audit_id_seq TO service_role;

CREATE FUNCTION public.meta_taxonomy_key(d text,v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN d='cep' THEN CASE k WHEN 'kulit' THEN 'skin' WHEN 'sendi' THEN 'joint' WHEN 'tulang' THEN 'bone' WHEN 'rambut' THEN 'hair' WHEN 'kuku' THEN 'nail' ELSE k END
 WHEN d='intention' THEN CASE k WHEN 'discovery' THEN 'disc' WHEN 'consideration' THEN 'cons' WHEN 'conversion' THEN 'conv' ELSE k END ELSE k END
 FROM (SELECT lower(regexp_replace(btrim(coalesce(v,'')),'\s+',' ','g')) k) n
$$;
CREATE FUNCTION public.validate_meta_taxonomy() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE brand_name text;
BEGIN
 SELECT name INTO brand_name FROM brands WHERE id=NEW.brand_id AND workspace_id=NEW.workspace_id;
 IF brand_name IS NULL THEN RAISE EXCEPTION 'Brand is outside this workspace'; END IF;
 IF TG_TABLE_NAME='meta_ad_cep_catalog' THEN
  IF lower(btrim(brand_name))='roove' THEN
   IF NEW.key NOT IN ('skin','joint','bone','hair','nail') THEN RAISE EXCEPTION 'Roove has exactly five official CEPs'; END IF;
  ELSIF NEW.key NOT LIKE 'b'||NEW.brand_id::text||'.%' THEN RAISE EXCEPTION 'CEP key must belong to its brand'; END IF;
 ELSE
  NEW.raw_key:=public.meta_taxonomy_key(NEW.dimension,NEW.raw_key);
  IF cardinality(NEW.cep_keys)<>(SELECT count(DISTINCT k) FROM unnest(NEW.cep_keys) k) OR EXISTS(
   SELECT 1 FROM unnest(NEW.cep_keys) k WHERE NOT EXISTS(SELECT 1 FROM meta_ad_cep_catalog c WHERE c.workspace_id=NEW.workspace_id AND c.brand_id=NEW.brand_id AND c.key=k)) THEN RAISE EXCEPTION 'CEP is not in the brand catalog'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_meta_cep BEFORE INSERT OR UPDATE ON public.meta_ad_cep_catalog FOR EACH ROW EXECUTE FUNCTION public.validate_meta_taxonomy();
CREATE TRIGGER validate_meta_taxonomy_rule BEFORE INSERT OR UPDATE ON public.meta_ad_taxonomy_rules FOR EACH ROW EXECUTE FUNCTION public.validate_meta_taxonomy();
INSERT INTO public.meta_ad_cep_catalog(workspace_id,brand_id,key,label,description)
 SELECT b.workspace_id,b.id,c.key,c.label,c.description FROM brands b CROSS JOIN (VALUES
 ('skin','Kulit','Iklan yang menargetkan kebutuhan kesehatan kulit.'),('joint','Sendi','Iklan yang menargetkan kebutuhan kesehatan sendi.'),
 ('bone','Tulang','Iklan yang menargetkan kebutuhan kesehatan tulang.'),('hair','Rambut','Iklan yang menargetkan kebutuhan kesehatan rambut.'),('nail','Kuku','Iklan yang menargetkan kebutuhan kesehatan kuku.')) c(key,label,description)
 WHERE lower(btrim(b.name))='roove';

CREATE FUNCTION public.resolve_meta_ad_taxonomy(w uuid,b integer,a jsonb,o jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE d text; raw text; manual boolean; rule meta_ad_taxonomy_rules%ROWTYPE; candidates text[]; ceps text[]:='{}'; intent text; cs text; ins text;
BEGIN
 FOR d IN SELECT unnest(ARRAY['cep','intention']) LOOP
  manual:=CASE WHEN d='cep' THEN o ? 'ceps' OR o ? 'cep' ELSE o ? 'intention' END;
  raw:=public.meta_taxonomy_key(d,coalesce(o->>d,(SELECT t->>'key' FROM jsonb_array_elements(coalesce(a->'tags','[]')) t WHERE t->>'dimension'=d LIMIT 1)));
  rule:=NULL;
  IF NOT manual THEN SELECT * INTO rule FROM meta_ad_taxonomy_rules WHERE workspace_id=w AND brand_id=b AND dimension=d AND raw_key=raw; END IF;
  IF d='cep' THEN
   cs:=CASE WHEN manual THEN 'manual' WHEN rule.raw_key IS NOT NULL THEN 'rule' ELSE 'naming' END;
   candidates:=CASE WHEN jsonb_typeof(o->'ceps')='array' THEN ARRAY(SELECT jsonb_array_elements_text(o->'ceps')) WHEN rule.raw_key IS NOT NULL THEN rule.cep_keys ELSE ARRAY[raw] END;
   SELECT coalesce(array_agg(DISTINCT c.key ORDER BY c.key),'{}') INTO ceps FROM meta_ad_cep_catalog c WHERE c.workspace_id=w AND c.brand_id=b AND (c.key=ANY(candidates) OR c.key=ANY(ARRAY(SELECT 'b'||b::text||'.'||k FROM unnest(candidates) k)));
  ELSE
   ins:=CASE WHEN manual THEN 'manual' WHEN rule.raw_key IS NOT NULL THEN 'rule' ELSE 'naming' END;
   intent:=coalesce(rule.intention_key,raw);IF intent NOT IN ('disc','cons','conv') THEN intent:=NULL;END IF;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('cep_keys',ceps,'intention_key',intent,'cep_source',cs,'intention_source',ins);
END $$;
CREATE VIEW public.meta_ad_classifications WITH(security_invoker=true) AS
 SELECT m.workspace_id,m.account_id,m.ad_id,m.ad_name,m.creative_id,m.effective_status,m.landing_page_urls,m.auto_mapping,m.overrides,m.source,m.first_seen_at,m.last_seen_at,m.revision,
 m.campaign_id,m.campaign_name,m.campaign_objective,m.ad_channel,m.ad_channel_reason,a.default_brand_id AS brand_id,
 ARRAY(SELECT jsonb_array_elements_text(r.labels->'cep_keys')) AS cep_keys,(r.labels->'cep_keys'->>0) AS cep_key,r.labels->>'intention_key' AS intention_key,
 r.labels->>'cep_source' AS cep_source,r.labels->>'intention_source' AS intention_source
 FROM public.meta_ad_mapping_channels m JOIN public.meta_ad_accounts a USING(workspace_id,account_id)
 CROSS JOIN LATERAL (SELECT public.resolve_meta_ad_taxonomy(m.workspace_id,a.default_brand_id,m.auto_mapping,m.overrides) labels OFFSET 0) r;
REVOKE ALL ON public.meta_ad_classifications FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.meta_ad_classifications TO service_role;

CREATE FUNCTION public.audit_meta_taxonomy() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO meta_ad_taxonomy_audit(workspace_id,entity,identity,before_value,after_value,changed_by)
 VALUES(NEW.workspace_id,TG_TABLE_NAME,jsonb_build_object('brand_id',NEW.brand_id,'key',to_jsonb(NEW)->>'key','raw_key',to_jsonb(NEW)->>'raw_key','dimension',to_jsonb(NEW)->>'dimension'),CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW),NEW.updated_by);
 RETURN NEW;
END $$;
CREATE TRIGGER audit_meta_cep AFTER INSERT OR UPDATE ON public.meta_ad_cep_catalog FOR EACH ROW EXECUTE FUNCTION public.audit_meta_taxonomy();
CREATE TRIGGER audit_meta_taxonomy_rule AFTER INSERT OR UPDATE ON public.meta_ad_taxonomy_rules FOR EACH ROW EXECUTE FUNCTION public.audit_meta_taxonomy();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['meta_ad_cep_catalog','meta_ad_taxonomy_rules'] LOOP
  EXECUTE format('CREATE TRIGGER meta_report_insert AFTER INSERT ON public.%I REFERENCING NEW TABLE AS meta_new FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version()',t);
  EXECUTE format('CREATE TRIGGER meta_report_update AFTER UPDATE ON public.%I REFERENCING OLD TABLE AS meta_old NEW TABLE AS meta_new FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version()',t);
  EXECUTE format('CREATE TRIGGER meta_report_delete AFTER DELETE ON public.%I REFERENCING OLD TABLE AS meta_old FOR EACH STATEMENT EXECUTE FUNCTION public.bump_meta_ad_report_version()',t);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.set_meta_ad_mapping_overrides(p_workspace_id uuid,p_account_id text,p_ad_id text,p_overrides jsonb,p_user_id uuid,p_revision integer)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE b integer; old_value jsonb; k text; keys text[];
BEGIN
 IF p_overrides IS NULL OR jsonb_typeof(p_overrides)<>'object' OR p_user_id IS NULL OR p_revision IS NULL
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_overrides) AS entries(entry_key) WHERE entries.entry_key NOT IN ('cep','ceps','intention'))
 OR (p_overrides ? 'cep' AND p_overrides ? 'ceps') THEN RAISE EXCEPTION 'Invalid mapping override'; END IF;
 SELECT default_brand_id INTO b FROM meta_ad_accounts WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid mapping account'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text||':meta-mapping:'||p_account_id,0));
 SELECT overrides INTO old_value FROM meta_ad_mappings WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND ad_id=p_ad_id AND revision=p_revision FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mapping changed; reload before saving'; END IF;
 keys:=CASE WHEN p_overrides ? 'ceps' AND jsonb_typeof(p_overrides->'ceps')='array' THEN ARRAY(SELECT jsonb_array_elements_text(p_overrides->'ceps')) WHEN p_overrides ? 'cep' AND jsonb_typeof(p_overrides->'cep')='string' THEN ARRAY[p_overrides->>'cep'] ELSE '{}' END;
 IF (p_overrides ? 'ceps' AND (jsonb_typeof(p_overrides->'ceps')<>'array' OR jsonb_path_exists(p_overrides->'ceps','$[*] ? (@.type() != "string")')))
 OR (p_overrides ? 'cep' AND jsonb_typeof(p_overrides->'cep')<>'string')
 OR cardinality(keys)>50 OR cardinality(keys)<>(SELECT count(DISTINCT x) FROM unnest(keys) x)
 OR (EXISTS(SELECT 1 FROM unnest(keys) x WHERE NOT EXISTS(SELECT 1 FROM meta_ad_cep_catalog c WHERE c.workspace_id=p_workspace_id AND c.brand_id=b AND c.key=x)) AND ((p_overrides->'cep') IS DISTINCT FROM (old_value->'cep') OR (p_overrides->'ceps') IS DISTINCT FROM (old_value->'ceps')))
 OR (p_overrides ? 'intention' AND (jsonb_typeof(p_overrides->'intention')<>'string' OR (p_overrides->>'intention' NOT IN ('disc','cons','conv') AND (p_overrides->'intention') IS DISTINCT FROM (old_value->'intention')))) THEN RAISE EXCEPTION 'Choose official brand CEPs and Discovery, Consideration or Conversion'; END IF;
 UPDATE meta_ad_mappings SET overrides=p_overrides,override_by=p_user_id,override_at=now(),revision=revision+1 WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND ad_id=p_ad_id;
 INSERT INTO meta_ad_taxonomy_audit(workspace_id,entity,identity,before_value,after_value,changed_by) VALUES(p_workspace_id,'ad_override',jsonb_build_object('account_id',p_account_id,'ad_id',p_ad_id),old_value,p_overrides,p_user_id);
 DELETE FROM meta_ad_mapping_members WHERE workspace_id=p_workspace_id AND account_id=p_account_id AND ad_id=p_ad_id AND source='manual';
 FOR k IN SELECT c.key FROM meta_ad_cep_catalog c WHERE c.workspace_id=p_workspace_id AND c.brand_id=b AND c.key=ANY(keys) LOOP
  INSERT INTO meta_ad_mapping_units(workspace_id,dimension,unit_key,label,review_status) VALUES(p_workspace_id,'cep',k,k,'confirmed') ON CONFLICT DO NOTHING;
  INSERT INTO meta_ad_mapping_members(workspace_id,account_id,ad_id,dimension,unit_key,source,position,raw_value) VALUES(p_workspace_id,p_account_id,p_ad_id,'cep',k,'manual',0,k);
 END LOOP;
 IF p_overrides ? 'intention' AND p_overrides->>'intention' IN ('disc','cons','conv') THEN
  k:=p_overrides->>'intention';INSERT INTO meta_ad_mapping_units(workspace_id,dimension,unit_key,label,review_status) VALUES(p_workspace_id,'intention',k,k,'confirmed') ON CONFLICT DO NOTHING;
  INSERT INTO meta_ad_mapping_members(workspace_id,account_id,ad_id,dimension,unit_key,source,position,raw_value) VALUES(p_workspace_id,p_account_id,p_ad_id,'intention',k,'manual',0,k);
 END IF;
END $$;

CREATE FUNCTION public.meta_cep_group_key(c text,i text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT 'cep:'||replace(replace(coalesce(c,'__unknown__'),'%','%25'),':','%3A')||':'||replace(replace(coalesce(i,'__unknown__'),'%','%25'),':','%3A')
$$;
CREATE OR REPLACE FUNCTION public.get_meta_ad_report(
 p_workspace_id uuid,p_from date,p_to date,p_config jsonb DEFAULT '{}'::jsonb,
 p_filters jsonb DEFAULT '{}'::jsonb,p_brand text DEFAULT NULL,p_group_by text DEFAULT 'landing_page',
 p_view text DEFAULT 'overview',p_period text DEFAULT 'week',p_group_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE start_date date; result jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>92
 OR p_group_by IS NULL OR p_view IS NULL OR p_period IS NULL OR p_config IS NULL OR p_filters IS NULL
 OR p_group_by NOT IN ('ad','landing_page','cep_intention') OR p_view NOT IN ('overview','daily','trends','creatives')
 OR (p_filters ? 'channel' AND (jsonb_typeof(p_filters->'channel') <> 'string' OR p_filters->>'channel' NOT IN ('non_cpas','cpas','unknown')))
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
 ), active_ads AS MATERIALIZED (
  -- Only ads that delivered in the selected range exist for this report; their
  -- comparison-period and history rows are read, long-paused ads are not.
  SELECT DISTINCT f.account_id,f.ad_id FROM meta_ad_daily_metrics f JOIN active a USING(account_id)
  WHERE f.workspace_id=p_workspace_id AND f.metric_date BETWEEN p_from AND p_to AND coalesce((f.metrics->>'impressions')::numeric,0)>0
 ), labels AS MATERIALIZED (
  -- Resolve once per delivering ad, never once per day or per CEP membership.
  SELECT x.account_id,x.ad_id,ARRAY(SELECT jsonb_array_elements_text(r.value->'cep_keys')) AS cep_keys,r.value->>'intention_key' AS intention_key
  FROM active_ads x JOIN active a USING(account_id)
  LEFT JOIN meta_ad_mappings m ON m.workspace_id=p_workspace_id AND m.account_id=x.account_id AND m.ad_id=x.ad_id
  LEFT JOIN LATERAL (SELECT f.naming_cep_key,f.naming_intention_key FROM meta_ad_daily_metrics f WHERE m.ad_id IS NULL AND f.workspace_id=p_workspace_id AND f.account_id=x.account_id AND f.ad_id=x.ad_id AND f.metric_date BETWEEN p_from AND p_to ORDER BY f.metric_date DESC LIMIT 1) fallback ON true
  CROSS JOIN LATERAL (SELECT public.resolve_meta_ad_taxonomy(p_workspace_id,CASE WHEN a.brand='__unmapped__' THEN NULL ELSE a.brand::integer END,
   coalesce(m.auto_mapping,jsonb_build_object('tags',jsonb_build_array(jsonb_build_object('dimension','cep','key',fallback.naming_cep_key),jsonb_build_object('dimension','intention','key',fallback.naming_intention_key)))),coalesce(m.overrides,'{}')) AS value OFFSET 0) r
 ), facts AS (
  SELECT f.account_id,f.account_name,f.ad_id,f.ad_name,f.creative_id,f.metric_date,f.currency,f.metrics,a.brand,
   public.meta_ad_channel_bucket(d.classification,d.evidence,d.metadata,d.creative_id,coalesce(f.creative_id,c.creative_id,m.creative_id),d.adset_id,f.raw_insights->>'adset_id') AS ad_channel,
   CASE WHEN d.creative_id=coalesce(f.creative_id,c.creative_id,m.creative_id)
    AND (f.raw_insights->>'adset_id' IS NULL OR d.adset_id=f.raw_insights->>'adset_id')
    THEN d.metadata ELSE '{}'::jsonb END AS contact_metadata,
   l.cep_keys[1] AS cep,l.cep_keys AS ceps,
   l.intention_key AS intention,
   coalesce(f.campaign_objective,CASE WHEN m.campaign_id=f.campaign_id THEN m.campaign_objective END,ca.campaign_objective) AS objective,
   CASE WHEN jsonb_array_length(f.landing_page_urls)>0 THEN f.landing_page_urls
    WHEN d.metadata ? 'destination_resolution' AND jsonb_array_length(coalesce(d.metadata->'urls','[]'))>0
     AND d.creative_id=coalesce(f.creative_id,c.creative_id,m.creative_id)
     AND (f.raw_insights->>'adset_id' IS NULL OR d.adset_id=f.raw_insights->>'adset_id') THEN d.metadata->'urls'
    WHEN jsonb_array_length(coalesce(c.landing_page_urls,'[]'))>0 AND (f.creative_id IS NULL OR f.creative_id=c.creative_id) THEN c.landing_page_urls
    WHEN coalesce(f.creative_id,c.creative_id)=v.creative_id THEN jsonb_build_array(v.landing_page_url) ELSE '[]'::jsonb END AS urls,
   jsonb_array_length(f.landing_page_urls)=0 AND NOT (jsonb_array_length(coalesce(c.landing_page_urls,'[]'))>0 AND (f.creative_id IS NULL OR f.creative_id=c.creative_id))
    AND coalesce(f.creative_id,c.creative_id)=v.creative_id AS verified
  FROM meta_ad_daily_metrics f JOIN active a USING(account_id) JOIN labels l ON l.account_id=f.account_id AND l.ad_id=f.ad_id
  LEFT JOIN meta_ad_mappings m ON m.workspace_id=f.workspace_id AND m.account_id=f.account_id AND m.ad_id=f.ad_id
  LEFT JOIN campaigns ca ON ca.account_id=f.account_id AND ca.campaign_id=f.campaign_id
  LEFT JOIN meta_ad_creatives c ON c.workspace_id=f.workspace_id AND c.account_id=f.account_id AND c.ad_id=f.ad_id
  LEFT JOIN meta_ad_destination_metadata d ON d.workspace_id=f.workspace_id AND d.account_id=f.account_id AND d.ad_id=f.ad_id
  LEFT JOIN meta_ad_verified_destinations v ON v.workspace_id=f.workspace_id AND v.account_id=f.account_id AND v.ad_id=f.ad_id
  WHERE f.workspace_id=p_workspace_id AND f.metric_date BETWEEN start_date AND p_to
   AND (p_view='overview' OR p_brand IS NULL OR a.brand=p_brand)
   AND (coalesce(p_config->>'name_filter','')='' OR
    CASE WHEN p_config->>'match'='exact' THEN lower(regexp_replace(btrim(f.ad_name),'\s+',' ','g'))=lower(regexp_replace(btrim(p_config->>'name_filter'),'\s+',' ','g'))
     ELSE strpos(lower(regexp_replace(btrim(f.ad_name),'\s+',' ','g')),lower(regexp_replace(btrim(p_config->>'name_filter'),'\s+',' ','g')))>0 END)
 ), contact_scopes AS MATERIALIZED (
  -- Read identity once per distinct ad/creative/adset/URL scope, not once per day.
  SELECT DISTINCT account_id,ad_id,brand,ad_channel,contact_metadata,urls FROM facts
 ), destinations AS MATERIALIZED (
  SELECT s.*,CASE WHEN p_group_by='landing_page' AND ad_channel<>'cpas' THEN public.meta_ctwa_destination(
   contact_metadata,urls,brand,account_id,ad_id) END AS destination FROM contact_scopes s
 ), enriched AS MATERIALIZED (
  SELECT f.*,d.destination,CASE WHEN p_group_by='ad' THEN 'ad:'||f.account_id||':'||f.ad_id
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
  FROM facts f JOIN destinations d ON d.account_id=f.account_id AND d.ad_id=f.ad_id
   AND d.brand=f.brand AND d.ad_channel=f.ad_channel AND d.contact_metadata=f.contact_metadata AND d.urls=f.urls
 ), scoped AS MATERIALIZED (
  SELECT * FROM enriched WHERE channel_match AND brand_match AND cep_match AND intention_match AND objective_match
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
  'groups',CASE WHEN p_view='overview' THEN (SELECT coalesce(jsonb_agg((to_jsonb(g)-'group_key')||jsonb_build_object('key',g.group_key,'landing_page_urls',coalesce(u.urls,'{}')) ORDER BY (g.current->>'spend')::numeric DESC,g.group_key),'[]') FROM groups g LEFT JOIN group_urls u USING(group_key)) END,
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
REVOKE ALL ON FUNCTION public.get_meta_ad_report(uuid,date,date,jsonb,jsonb,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_ad_report(uuid,date,date,jsonb,jsonb,text,text,text,text,text) TO service_role;


-- Preview is read-only; spend is grouped by currency and every ad is counted once.
CREATE FUNCTION public.preview_meta_taxonomy_rule(w uuid,b integer,d text,raw text,f date,t date) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 WITH matched AS MATERIALIZED (
  SELECT m.account_id,m.ad_id,m.ad_name,CASE WHEN d='cep' THEN m.overrides ? 'ceps' OR m.overrides ? 'cep' ELSE m.overrides ? 'intention' END AS manual
  FROM meta_ad_mappings m JOIN meta_ad_accounts a USING(workspace_id,account_id)
  WHERE m.workspace_id=w AND a.default_brand_id=b AND public.meta_taxonomy_key(d,(SELECT x->>'key' FROM jsonb_array_elements(m.auto_mapping->'tags') x WHERE x->>'dimension'=d LIMIT 1))=raw
 ), spend AS (
  SELECT currency,sum(coalesce((metrics->>'spend')::numeric,0)) amount FROM meta_ad_daily_metrics v JOIN matched m USING(account_id,ad_id)
  WHERE v.workspace_id=w AND NOT m.manual AND v.metric_date BETWEEN f AND t GROUP BY currency
 ) SELECT jsonb_build_object('matched',(SELECT count(*) FROM matched),'eligible',(SELECT count(*) FROM matched WHERE NOT manual),'manualPreserved',(SELECT count(*) FROM matched WHERE manual),
 'spendByCurrency',(SELECT coalesce(jsonb_object_agg(currency,amount),'{}') FROM spend),'samples',(SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') FROM (SELECT account_id,ad_id,ad_name FROM matched WHERE NOT manual ORDER BY account_id,ad_id LIMIT 10) m))
$$;
-- Only the application service may use classification or mutation helpers.
DO $$ DECLARE fn regprocedure; BEGIN
 FOR fn IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('meta_taxonomy_key','validate_meta_taxonomy','resolve_meta_ad_taxonomy','audit_meta_taxonomy','meta_cep_group_key','preview_meta_taxonomy_rule') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
