BEGIN;
-- Certify only successful creative + destination observations. Missing/failed
-- observations remain eligible for the next sync; immutable provider evidence
-- and all historical delivery facts stay in their existing tables.
CREATE TABLE public.meta_ad_metadata_sync_state (
 workspace_id uuid NOT NULL, account_id text NOT NULL, ad_id text NOT NULL,
 creative_id text NOT NULL CHECK(creative_id ~ '^[0-9]+$'),
 adset_id text NOT NULL CHECK(adset_id ~ '^[0-9]+$'),
 source_fingerprint text NOT NULL CHECK(source_fingerprint ~ '^[a-f0-9]{64}$'),
 source_updated_at timestamptz NOT NULL, adset_updated_at timestamptz NOT NULL,
 observed_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,account_id,ad_id),
 FOREIGN KEY(workspace_id,account_id,ad_id) REFERENCES public.meta_ad_mappings(workspace_id,account_id,ad_id) ON DELETE CASCADE
);
ALTER TABLE public.meta_ad_metadata_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ad_metadata_sync_state FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_ad_metadata_sync_state TO service_role;
CREATE FUNCTION public.save_meta_ad_metadata_state(p_workspace_id uuid,p_account_id text,p_rows jsonb,p_observed_at timestamptz)
RETURNS integer LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE saved integer;
BEGIN
 IF p_workspace_id IS NULL OR p_account_id IS NULL OR p_observed_at IS NULL OR p_observed_at>clock_timestamp()+interval '5 minutes'
 OR p_rows IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>500 THEN RAISE EXCEPTION 'Invalid metadata state scope'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_rows) r(ad_id text,creative_id text,adset_id text,source_fingerprint text,source_updated_at timestamptz,adset_updated_at timestamptz)
 WHERE coalesce(r.ad_id,'') !~ '^[0-9]+$' OR coalesce(r.creative_id,'') !~ '^[0-9]+$' OR coalesce(r.adset_id,'') !~ '^[0-9]+$'
 OR coalesce(r.source_fingerprint,'') !~ '^[a-f0-9]{64}$' OR r.source_updated_at IS NULL OR r.adset_updated_at IS NULL) THEN RAISE EXCEPTION 'Invalid metadata source'; END IF;
 INSERT INTO public.meta_ad_metadata_sync_state AS s(workspace_id,account_id,ad_id,creative_id,adset_id,source_fingerprint,source_updated_at,adset_updated_at,observed_at)
 SELECT p_workspace_id,p_account_id,r.ad_id,r.creative_id,r.adset_id,r.source_fingerprint,r.source_updated_at,r.adset_updated_at,p_observed_at
 FROM jsonb_to_recordset(p_rows) r(ad_id text,creative_id text,adset_id text,source_fingerprint text,source_updated_at timestamptz,adset_updated_at timestamptz)
 JOIN public.meta_ad_creatives c ON c.workspace_id=p_workspace_id AND c.account_id=p_account_id AND c.ad_id=r.ad_id AND c.creative_id=r.creative_id
 JOIN public.meta_ad_destination_metadata d ON d.workspace_id=p_workspace_id AND d.account_id=p_account_id AND d.ad_id=r.ad_id AND d.creative_id=r.creative_id AND d.adset_id=r.adset_id
 JOIN public.meta_ad_mappings m ON m.workspace_id=p_workspace_id AND m.account_id=p_account_id AND m.ad_id=r.ad_id AND m.creative_id=r.creative_id
 WHERE (d.metadata->'contact_identity'->>'version'='1' OR d.metadata->>'contact_identity_checked'='true')
 AND greatest(r.source_updated_at,r.adset_updated_at)<=least(c.updated_at,d.observed_at)
 ON CONFLICT(workspace_id,account_id,ad_id) DO UPDATE SET creative_id=excluded.creative_id,adset_id=excluded.adset_id,
 source_fingerprint=excluded.source_fingerprint,source_updated_at=excluded.source_updated_at,adset_updated_at=excluded.adset_updated_at,observed_at=excluded.observed_at
 WHERE s.observed_at<=excluded.observed_at;
 GET DIAGNOSTICS saved=ROW_COUNT; RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.save_meta_ad_metadata_state(uuid,text,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_meta_ad_metadata_state(uuid,text,jsonb,timestamptz) TO service_role;

-- Job links account for dynamically created batches and deduplicated jobs that
-- are reused by more than one request. No new provider jobs are made on reads.
CREATE TABLE public.meta_sync_job_links (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 parent_job_id uuid NOT NULL REFERENCES public.sync_jobs(id) ON DELETE CASCADE,
 child_job_id uuid NOT NULL REFERENCES public.sync_jobs(id) ON DELETE CASCADE,
 PRIMARY KEY(workspace_id,parent_job_id,child_job_id), CHECK(parent_job_id<>child_job_id)
);
ALTER TABLE public.meta_sync_job_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_sync_job_links FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.meta_sync_job_links TO service_role;
CREATE FUNCTION public.check_meta_sync_job_link() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (SELECT count(*) FROM public.sync_jobs WHERE workspace_id=NEW.workspace_id AND job_name='meta_sync' AND id IN (NEW.parent_job_id,NEW.child_job_id))<>2 THEN RAISE EXCEPTION 'Meta job link outside workspace'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_meta_sync_job_link BEFORE INSERT OR UPDATE ON public.meta_sync_job_links FOR EACH ROW EXECUTE FUNCTION public.check_meta_sync_job_link();
REVOKE ALL ON FUNCTION public.check_meta_sync_job_link() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.link_meta_sync_jobs(p_workspace_id uuid,p_parent_id uuid,p_child_ids uuid[])
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF p_workspace_id IS NULL OR p_parent_id IS NULL OR p_child_ids IS NULL OR cardinality(p_child_ids)>5000 OR p_parent_id=ANY(p_child_ids) THEN RAISE EXCEPTION 'Invalid Meta job links'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sync_jobs WHERE workspace_id=p_workspace_id AND id=p_parent_id AND job_name='meta_sync')
 OR EXISTS(SELECT 1 FROM unnest(p_child_ids) c(id) LEFT JOIN public.sync_jobs j ON j.id=c.id AND j.workspace_id=p_workspace_id AND j.job_name='meta_sync' WHERE j.id IS NULL) THEN RAISE EXCEPTION 'Meta job link outside workspace'; END IF;
 IF EXISTS(WITH RECURSIVE descendants(id) AS (SELECT unnest(p_child_ids) UNION SELECT l.child_job_id FROM descendants d JOIN public.meta_sync_job_links l ON l.workspace_id=p_workspace_id AND l.parent_job_id=d.id) SELECT 1 FROM descendants WHERE id=p_parent_id) THEN RAISE EXCEPTION 'Cyclic Meta job links'; END IF;
 INSERT INTO public.meta_sync_job_links(workspace_id,parent_job_id,child_job_id) SELECT DISTINCT p_workspace_id,p_parent_id,id FROM unnest(p_child_ids) c(id) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.link_meta_sync_jobs(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.link_meta_sync_jobs(uuid,uuid,uuid[]) TO service_role;
CREATE FUNCTION public.complete_meta_sync_bundle(p_workspace_id uuid,p_root_id uuid,p_child_ids uuid[],p_queue_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM public.link_meta_sync_jobs(p_workspace_id,p_root_id,p_child_ids);
 UPDATE public.sync_jobs SET payload=payload||jsonb_build_object('meta_sync_bundle',true,'meta_bundle_enqueued',p_queue_error IS NULL,'meta_bundle_queue_error',left(p_queue_error,500))
 WHERE workspace_id=p_workspace_id AND id=p_root_id AND job_name='meta_sync' AND mode IN ('cron','incremental');
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid Meta bundle root'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.complete_meta_sync_bundle(uuid,uuid,uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_meta_sync_bundle(uuid,uuid,uuid[],text) TO service_role;
CREATE INDEX meta_sync_parent_payload ON public.sync_jobs(workspace_id,(payload->>'meta_parent_job_id')) WHERE job_name='meta_sync' AND payload ? 'meta_parent_job_id';

CREATE FUNCTION public.get_meta_sync_job_tree(p_workspace_id uuid,p_root_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE roots uuid[]; started timestamptz; next_run timestamptz; legacy boolean; result jsonb;
BEGIN
 IF p_workspace_id IS NULL OR (p_root_ids IS NOT NULL AND (cardinality(p_root_ids)<1 OR cardinality(p_root_ids)>5000)) THEN RAISE EXCEPTION 'Invalid Meta progress scope'; END IF;
 roots:=p_root_ids;
 IF roots IS NULL THEN
  SELECT ARRAY[id] INTO roots FROM public.sync_jobs WHERE workspace_id=p_workspace_id AND job_name='meta_sync' AND mode IN ('cron','incremental') ORDER BY created_at DESC LIMIT 1;
  IF roots IS NULL THEN SELECT ARRAY[id] INTO roots FROM public.sync_jobs WHERE workspace_id=p_workspace_id AND job_name='meta_sync' AND mode IN ('ad_funnels','ad_mapping') ORDER BY created_at DESC LIMIT 1; END IF;
 END IF;
 SELECT min(created_at),NOT bool_or(coalesce((payload->>'meta_sync_bundle')::boolean,false) OR payload ? 'meta_parent_job_id'
   OR EXISTS(SELECT 1 FROM public.meta_sync_job_links l WHERE l.workspace_id=p_workspace_id AND (l.parent_job_id=j.id OR l.child_job_id=j.id)))
 INTO started,legacy FROM public.sync_jobs j WHERE workspace_id=p_workspace_id AND job_name='meta_sync' AND id=ANY(roots);
 IF started IS NULL THEN RETURN '[]'::jsonb; END IF;
 -- Read-only compatibility for bundles queued before durable lineage existed.
 -- The next spend bundle bounds the legacy run, including its late children.
 SELECT min(created_at) INTO next_run FROM public.sync_jobs WHERE workspace_id=p_workspace_id AND job_name='meta_sync' AND mode IN ('cron','incremental') AND created_at>started+interval '5 seconds';
 WITH RECURSIVE seeds(id) AS (
  SELECT id FROM public.sync_jobs WHERE workspace_id=p_workspace_id AND job_name='meta_sync' AND id=ANY(roots)
  UNION SELECT id FROM public.sync_jobs WHERE legacy AND workspace_id=p_workspace_id AND job_name='meta_sync'
   AND created_at>=started AND created_at<coalesce(next_run,'infinity'::timestamptz)
   AND (mode IN ('ad_mapping_creatives','meta_product_set_verify') OR (mode IN ('cron','incremental','ad_funnels','ad_mapping') AND created_at<started+interval '5 minutes'))
 ), edges(parent_id,child_id) AS (
  SELECT parent_job_id,child_job_id FROM public.meta_sync_job_links WHERE workspace_id=p_workspace_id
  UNION SELECT CASE WHEN payload->>'meta_parent_job_id' ~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' THEN (payload->>'meta_parent_job_id')::uuid END,id
   FROM public.sync_jobs WHERE workspace_id=p_workspace_id AND job_name='meta_sync' AND payload ? 'meta_parent_job_id'
 ), tree(id) AS (SELECT id FROM seeds UNION SELECT e.child_id FROM tree t JOIN edges e ON e.parent_id=t.id)
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',j.id,'mode',j.mode,'status',j.status,'error_message',j.error_message,'created_at',j.created_at,
   'started_at',j.started_at,'completed_at',j.completed_at,'payload',j.payload,'result_summary',jsonb_build_object('warnings',coalesce(j.result_summary->'warnings','[]'::jsonb),'errors',coalesce(j.result_summary->'errors','[]'::jsonb))) ORDER BY j.created_at DESC,j.id),'[]'::jsonb)
 INTO result FROM tree t JOIN public.sync_jobs j ON j.id=t.id AND j.workspace_id=p_workspace_id AND j.job_name='meta_sync';
 IF jsonb_array_length(result)>10000 THEN RAISE EXCEPTION 'Meta sync run exceeds progress limit'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_meta_sync_job_tree(uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_sync_job_tree(uuid,uuid[]) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
