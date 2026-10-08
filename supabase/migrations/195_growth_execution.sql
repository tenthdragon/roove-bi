-- Growth Execution P0. Writes are only through authenticated, transactional RPCs.
-- Typed views share one record identity; links never duplicate work across tabs.
BEGIN;

CREATE TABLE public.growth_portfolios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
CREATE TABLE public.growth_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  portfolio_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  functions text[] NOT NULL CHECK (cardinality(functions) > 0 AND functions <@ ARRAY['growth','creative','acquisition','sales','ceo']),
  visibility_mode text NOT NULL CHECK (visibility_mode IN ('own_or_involved','team')),
  managed_functions text[] NOT NULL DEFAULT '{}' CHECK (managed_functions <@ ARRAY['growth','creative','acquisition','sales','ceo']),
  company_scope boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  FOREIGN KEY (workspace_id, portfolio_id) REFERENCES public.growth_portfolios(workspace_id,id),
  UNIQUE (workspace_id,portfolio_id,user_id),
  UNIQUE (id,workspace_id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE TABLE public.growth_membership_brands (
  membership_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  brand_id integer NOT NULL,
  PRIMARY KEY (membership_id,brand_id),
  FOREIGN KEY (membership_id,workspace_id) REFERENCES public.growth_memberships(id,workspace_id),
  FOREIGN KEY (workspace_id,brand_id) REFERENCES public.brands(workspace_id,id)
);
CREATE TABLE public.growth_mandate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  portfolio_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  domain text NOT NULL CHECK (domain IN ('growth_media','creative','sales_commercial','sales_operations','cross_function')),
  brand_id integer,
  max_amount numeric CHECK (max_amount >= 0 AND max_amount::text NOT IN ('NaN','Infinity','-Infinity')),
  allowed_actions text[] NOT NULL CHECK (cardinality(allowed_actions)>0),
  rationale text NOT NULL CHECK (length(btrim(rationale)) > 0),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  supersedes_id uuid REFERENCES public.growth_mandate_versions(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id,portfolio_id) REFERENCES public.growth_portfolios(workspace_id,id),
  FOREIGN KEY (workspace_id,brand_id) REFERENCES public.brands(workspace_id,id),
  CHECK (effective_to IS NULL OR effective_to>effective_from)
);
CREATE TABLE public.growth_records (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  portfolio_id uuid NOT NULL,
  short_id bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  kind text NOT NULL CHECK (kind IN ('goal','priority','work','dependency','evidence','deployment','experiment','result','decision','incident','weekly','link','update')),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 240),
  status text NOT NULL,
  brand_id integer,
  parent_id uuid,
  pic_id uuid REFERENCES auth.users(id),
  reviewer_id uuid REFERENCES auth.users(id),
  recipient_id uuid REFERENCES auth.users(id),
  blocker_owner_id uuid REFERENCES auth.users(id),
  due_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}',
  row_version integer NOT NULL DEFAULT 1,
  archived_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id,portfolio_id) REFERENCES public.growth_portfolios(workspace_id,id),
  FOREIGN KEY (workspace_id,brand_id) REFERENCES public.brands(workspace_id,id),
  UNIQUE(workspace_id,portfolio_id,id),
  FOREIGN KEY (workspace_id,portfolio_id,parent_id) REFERENCES public.growth_records(workspace_id,portfolio_id,id),
  CHECK (octet_length(payload::text)<=262144)
);
CREATE INDEX growth_record_list ON public.growth_records(workspace_id,portfolio_id,kind,updated_at DESC);
CREATE INDEX growth_record_parent ON public.growth_records(parent_id);
CREATE INDEX growth_active_priorities ON public.growth_records(portfolio_id) WHERE kind='priority' AND status IN ('active','blocked') AND archived_at IS NULL;
CREATE TABLE public.growth_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  portfolio_id uuid REFERENCES public.growth_portfolios(id),
  object_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  before_values jsonb,
  after_values jsonb NOT NULL,
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX growth_audit_object ON public.growth_audit_events(workspace_id,object_id,id DESC);
CREATE TABLE public.growth_requests (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,actor_id,action,request_id)
);
-- BI snapshots can only be inserted by the authorized server adapter. The
-- authenticated mutation never accepts financial figures supplied by a browser.
CREATE TABLE public.growth_metric_snapshots (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  portfolio_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  brand_id integer,
  cutoff_at timestamptz NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(workspace_id,portfolio_id) REFERENCES public.growth_portfolios(workspace_id,id)
);
ALTER TABLE public.growth_metric_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.growth_metric_snapshots FROM PUBLIC,anon,authenticated;
GRANT INSERT,SELECT ON public.growth_metric_snapshots TO service_role;

-- No permission seeds: the administrator explicitly assigns technical access.
CREATE FUNCTION public.growth_has_permission(w uuid, permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.workspaces WHERE id=w AND status='active'
   AND settings->'growth_execution_enabled'='true'::jsonb
   AND NOT coalesce(settings->'disabled_modules','[]') ? 'growth-work')
 AND (public.is_platform_owner() OR public.workspace_has_role(w,ARRAY['workspace_owner']) OR EXISTS (
   SELECT 1 FROM public.workspace_memberships m JOIN public.workspace_role_permissions p ON p.workspace_id=m.workspace_id AND p.role=m.role
   WHERE m.workspace_id=w AND m.user_id=auth.uid() AND m.status='active' AND p.permission_key=permission
 ));
$$;
CREATE FUNCTION public.growth_member(w uuid,p uuid,u uuid,b integer DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.growth_memberships m WHERE m.workspace_id=w AND m.portfolio_id=p AND m.user_id=u
 AND m.active AND now()>=m.effective_from AND (m.effective_to IS NULL OR now()<m.effective_to)
 AND public.workspace_has_membership(w,u)
 AND (m.company_scope OR (b IS NOT NULL AND EXISTS(SELECT 1 FROM public.growth_membership_brands mb WHERE mb.membership_id=m.id AND mb.brand_id=b))));
$$;
CREATE FUNCTION public.growth_team(w uuid,p uuid,b integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.growth_has_permission(w,'tab:growth-work') AND public.growth_has_permission(w,'growth:team-read')
 AND public.growth_member(w,p,auth.uid(),b) AND EXISTS(SELECT 1 FROM public.growth_memberships WHERE workspace_id=w AND portfolio_id=p AND user_id=auth.uid() AND visibility_mode='team');
$$;
CREATE FUNCTION public.growth_can_read(r public.growth_records) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.growth_has_permission(r.workspace_id,'tab:growth-work') AND public.growth_member(r.workspace_id,r.portfolio_id,auth.uid(),r.brand_id)
 AND (public.growth_team(r.workspace_id,r.portfolio_id,r.brand_id) OR auth.uid() IN (r.pic_id,r.reviewer_id,r.recipient_id,r.blocker_owner_id,r.created_by)
 OR (r.kind IN ('evidence','deployment','result','update','link') AND EXISTS(SELECT 1 FROM public.growth_records parent WHERE parent.id=r.parent_id
 AND auth.uid() IN (parent.pic_id,parent.reviewer_id,parent.recipient_id,parent.blocker_owner_id))))
 AND (r.kind<>'weekly' OR (public.growth_team(r.workspace_id,r.portfolio_id,r.brand_id)
 AND public.growth_has_permission(r.workspace_id,'growth:metrics-read') AND public.growth_has_permission(r.workspace_id,'growth:financial-target-read')));
$$;
CREATE FUNCTION public.growth_function(w uuid,p uuid,u uuid,f text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.growth_memberships WHERE workspace_id=w AND portfolio_id=p AND user_id=u AND active AND f=ANY(functions)
 AND now()>=effective_from AND (effective_to IS NULL OR now()<effective_to));
$$;
CREATE FUNCTION public.growth_roster_member(m public.growth_memberships) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT public.growth_has_permission(m.workspace_id,'tab:growth-work') AND (m.user_id=auth.uid()
 OR public.growth_has_permission(m.workspace_id,'growth:configure') OR public.growth_team(m.workspace_id,m.portfolio_id,NULL)
 OR EXISTS(SELECT 1 FROM public.growth_membership_brands b WHERE b.membership_id=m.id AND public.growth_team(m.workspace_id,m.portfolio_id,b.brand_id)));
$$;
CREATE FUNCTION public.growth_mandated(w uuid,p uuid,u uuid,b integer,domain_name text,action_name text,amount numeric) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT id FROM public.growth_mandate_versions m WHERE m.workspace_id=w AND m.portfolio_id=p AND m.actor_id=u
 AND public.growth_member(w,p,u,b) AND m.domain=domain_name AND (m.brand_id IS NULL OR m.brand_id=b)
 AND action_name=ANY(m.allowed_actions) AND (amount=0 OR (m.max_amount IS NOT NULL AND amount<=m.max_amount))
 AND now()>=m.effective_from AND (m.effective_to IS NULL OR now()<m.effective_to)
 AND NOT EXISTS(SELECT 1 FROM public.growth_mandate_versions newer WHERE newer.supersedes_id=m.id AND newer.effective_from<=now())
 ORDER BY m.effective_from DESC LIMIT 1;
$$;

ALTER TABLE public.growth_portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_membership_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_mandate_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.growth_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY growth_portfolio_read ON public.growth_portfolios FOR SELECT TO authenticated USING (
 public.growth_has_permission(workspace_id,'tab:growth-work') AND (public.growth_has_permission(workspace_id,'growth:configure') OR EXISTS (
 SELECT 1 FROM public.growth_memberships m WHERE m.portfolio_id=growth_portfolios.id AND m.user_id=auth.uid() AND m.active)));
CREATE POLICY growth_membership_read ON public.growth_memberships FOR SELECT TO authenticated USING (
 public.growth_roster_member(growth_memberships));
CREATE POLICY growth_membership_brand_read ON public.growth_membership_brands FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.growth_memberships m WHERE m.id=membership_id));
CREATE POLICY growth_mandate_read ON public.growth_mandate_versions FOR SELECT TO authenticated USING (
 public.growth_has_permission(workspace_id,'tab:growth-work') AND (public.growth_has_permission(workspace_id,'growth:configure')
 OR public.growth_team(workspace_id,portfolio_id,brand_id) OR (actor_id=auth.uid() AND public.growth_member(workspace_id,portfolio_id,auth.uid(),brand_id))));
CREATE POLICY growth_record_read ON public.growth_records FOR SELECT TO authenticated USING (public.growth_can_read(growth_records));
CREATE POLICY growth_audit_read ON public.growth_audit_events FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.growth_records r WHERE r.id=object_id AND public.growth_can_read(r))
 OR (action LIKE 'configure:%' AND public.growth_has_permission(workspace_id,'tab:growth-work') AND public.growth_has_permission(workspace_id,'growth:configure')));
REVOKE ALL ON public.growth_portfolios,public.growth_memberships,public.growth_membership_brands,public.growth_mandate_versions,public.growth_records,public.growth_audit_events,public.growth_requests FROM anon,authenticated;
GRANT SELECT ON public.growth_portfolios,public.growth_memberships,public.growth_membership_brands,public.growth_mandate_versions,public.growth_records,public.growth_audit_events TO authenticated;

-- Preserve histories and expose familiar entity names without duplicate records.
DO $$ DECLARE pair text[]; BEGIN
 FOREACH pair SLICE 1 IN ARRAY ARRAY[
 ['growth_goals','goal'],['growth_priorities','priority'],['growth_work_items','work'],['growth_dependencies','dependency'],
 ['growth_evidence','evidence'],['growth_deployments','deployment'],['growth_experiments','experiment'],['growth_experiment_results','result'],
 ['growth_decisions','decision'],['growth_incidents','incident'],['growth_weekly_reviews','weekly'],['growth_record_links','link'],['growth_updates','update']]
 LOOP
 EXECUTE format('CREATE VIEW public.%I WITH (security_invoker=true) AS SELECT * FROM public.growth_records WHERE kind=%L',pair[1],pair[2]);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',pair[1]);
 END LOOP;
END $$;

CREATE FUNCTION public.growth_configure(w uuid,p uuid,object_id uuid,expected_version integer,request_id uuid,kind text,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; old jsonb; hash text:=md5(input::text||coalesce(p::text,'')||object_id::text||expected_version::text||kind); existing public.growth_requests;
 m public.growth_memberships; b integer; action_name text:='configure:'||kind;
BEGIN
 IF NOT public.growth_has_permission(w,'tab:growth-work') OR NOT public.growth_has_permission(w,'growth:configure') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(w::text,195));
 SELECT * INTO existing FROM public.growth_requests WHERE workspace_id=w AND actor_id=auth.uid() AND action=action_name AND growth_requests.request_id=growth_configure.request_id;
 IF FOUND THEN IF existing.payload_hash<>hash THEN RAISE EXCEPTION 'Idempotency key berbeda payload'; END IF; RETURN existing.result; END IF;
 IF kind='portfolio' THEN
   IF expected_version<>0 THEN RAISE EXCEPTION 'Portfolio immutable'; END IF;
   INSERT INTO public.growth_portfolios(id,workspace_id,name,created_by) VALUES(object_id,w,input->>'name',auth.uid()) RETURNING to_jsonb(growth_portfolios.*) INTO result;
 ELSE
   IF NOT EXISTS(SELECT 1 FROM public.growth_portfolios WHERE id=p AND workspace_id=w) THEN RAISE EXCEPTION 'Portfolio tidak valid'; END IF;
   IF kind='membership' THEN
     IF EXISTS(SELECT 1 FROM public.growth_memberships WHERE id=object_id AND (workspace_id<>w OR portfolio_id<>p)) THEN RAISE EXCEPTION 'Forbidden: membership identity'; END IF;
     IF NOT public.workspace_has_membership(w,(input->>'user_id')::uuid) THEN RAISE EXCEPTION 'Aktor bukan anggota workspace aktif'; END IF;
     SELECT * INTO m FROM public.growth_memberships WHERE id=object_id AND workspace_id=w AND portfolio_id=p FOR UPDATE;
     IF (FOUND AND m.row_version<>expected_version) OR (NOT FOUND AND expected_version<>0) THEN RAISE EXCEPTION 'Conflict: muat ulang versi terbaru'; END IF;
     old:=CASE WHEN m.id IS NULL THEN NULL ELSE to_jsonb(m) END;
     INSERT INTO public.growth_memberships(id,workspace_id,portfolio_id,user_id,functions,visibility_mode,managed_functions,company_scope,active,effective_from,effective_to,created_by)
     VALUES(object_id,w,p,(input->>'user_id')::uuid,ARRAY(SELECT jsonb_array_elements_text(input->'functions')),input->>'visibility_mode',ARRAY(SELECT jsonb_array_elements_text(coalesce(input->'managed_functions','[]'))),coalesce((input->>'company_scope')::boolean,false),coalesce((input->>'active')::boolean,true),coalesce((input->>'effective_from')::timestamptz,now()),(input->>'effective_to')::timestamptz,auth.uid())
     ON CONFLICT(id) DO UPDATE SET functions=EXCLUDED.functions,managed_functions=EXCLUDED.managed_functions,visibility_mode=EXCLUDED.visibility_mode,company_scope=EXCLUDED.company_scope,active=EXCLUDED.active,effective_from=EXCLUDED.effective_from,effective_to=EXCLUDED.effective_to,row_version=growth_memberships.row_version+1
     RETURNING to_jsonb(growth_memberships.*) INTO result;
     IF m.id IS NOT NULL AND m.user_id<>(input->>'user_id')::uuid THEN RAISE EXCEPTION 'Identitas membership immutable'; END IF;
     DELETE FROM public.growth_membership_brands WHERE membership_id=object_id;
     FOR b IN SELECT value::integer FROM jsonb_array_elements_text(coalesce(input->'brand_ids','[]')) LOOP
       INSERT INTO public.growth_membership_brands VALUES(object_id,w,b);
     END LOOP;
     result:=result||jsonb_build_object('brand_ids',coalesce(input->'brand_ids','[]'));
   ELSIF kind='mandate' THEN
     IF expected_version<>0 OR NOT public.growth_member(w,p,(input->>'actor_id')::uuid,(input->>'brand_id')::integer) THEN RAISE EXCEPTION 'Mandat perlu membership aktif dan versi baru'; END IF;
     IF input->>'supersedes_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.growth_mandate_versions WHERE id=(input->>'supersedes_id')::uuid AND workspace_id=w AND portfolio_id=p AND actor_id=(input->>'actor_id')::uuid AND domain=input->>'domain') THEN RAISE EXCEPTION 'Mandat asal tidak valid'; END IF;
     INSERT INTO public.growth_mandate_versions(id,workspace_id,portfolio_id,actor_id,domain,brand_id,max_amount,allowed_actions,rationale,effective_from,effective_to,supersedes_id,created_by)
     VALUES(object_id,w,p,(input->>'actor_id')::uuid,input->>'domain',(input->>'brand_id')::integer,(input->>'max_amount')::numeric,ARRAY(SELECT jsonb_array_elements_text(input->'allowed_actions')),input->>'rationale',(input->>'effective_from')::timestamptz,(input->>'effective_to')::timestamptz,(input->>'supersedes_id')::uuid,auth.uid()) RETURNING to_jsonb(growth_mandate_versions.*) INTO result;
   ELSE RAISE EXCEPTION 'Jenis konfigurasi tidak valid'; END IF;
 END IF;
 INSERT INTO public.growth_audit_events(workspace_id,portfolio_id,object_id,actor_id,action,before_values,after_values,request_id) VALUES(w,CASE WHEN kind='portfolio' THEN object_id ELSE p END,object_id,auth.uid(),action_name,old,result,request_id);
 INSERT INTO public.growth_requests VALUES(w,auth.uid(),action_name,request_id,hash,result,now());
 RETURN result;
END $$;

CREATE FUNCTION public.growth_save_record(w uuid,p uuid,object_id uuid,expected_version integer,request_id uuid,input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.growth_records; n public.growth_records; parent public.growth_records; result jsonb; old jsonb;
 existing public.growth_requests; hash text:=md5(input::text||p::text||object_id::text||expected_version::text); snapshot public.growth_metric_snapshots;
 required text; actor uuid; mandate uuid; domain_name text; amount numeric; link_id uuid; requirement uuid;
BEGIN
 IF NOT public.growth_has_permission(w,'tab:growth-work') THEN RAISE EXCEPTION 'Forbidden: modul/tab'; END IF;
 -- Serialize portfolio quota, prerequisite checks and decisions; retries share lock.
 PERFORM 1 FROM public.growth_portfolios WHERE workspace_id=w AND id=p FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Portfolio tidak valid'; END IF;
 SELECT * INTO existing FROM public.growth_requests WHERE workspace_id=w AND actor_id=auth.uid() AND action='save' AND growth_requests.request_id=growth_save_record.request_id;
 IF FOUND THEN
   IF NOT EXISTS(SELECT 1 FROM public.growth_records q WHERE q.id=(existing.result->>'id')::uuid AND public.growth_can_read(q)) THEN RAISE EXCEPTION 'Forbidden: retry scope'; END IF;
   IF existing.payload_hash<>hash THEN RAISE EXCEPTION 'Idempotency key berbeda payload'; END IF; RETURN existing.result;
 END IF;
 SELECT * INTO r FROM public.growth_records WHERE id=object_id AND workspace_id=w AND portfolio_id=p FOR UPDATE;
 IF (FOUND AND r.row_version<>expected_version) OR (NOT FOUND AND expected_version<>0) THEN RAISE EXCEPTION 'Conflict: muat ulang versi terbaru'; END IF;
 IF r.id IS NOT NULL AND NOT public.growth_can_read(r) THEN RAISE EXCEPTION 'Forbidden: object'; END IF;
 n:=jsonb_populate_record(NULL::public.growth_records,input);
 n.id:=object_id; n.workspace_id:=w; n.portfolio_id:=p; n.payload:=coalesce(n.payload,'{}');
 n.payload:=n.payload - ARRAY['snapshot','mandate_version_id','decided_by','decided_at','finalized_by','finalized_at','approved_by','previous_status'];
 FOREACH required IN ARRAY ARRAY['budget','amount','target_value','output_version'] LOOP
   IF n.payload->>required IS NOT NULL AND ((n.payload->>required)::numeric)::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Nilai % harus finite',required; END IF;
 END LOOP;
 n.row_version:=expected_version+1; n.created_by:=coalesce(r.created_by,auth.uid()); n.created_at:=coalesce(r.created_at,now()); n.updated_at:=now();
 -- Derived metadata is preserved by the database and cannot be overwritten.
 n.payload:=n.payload || (coalesce(r.payload,'{}') - ARRAY['snapshot_id','metric','unit','target_value','period_from','period_to','notes','supersedes_id','revision_reason','diagnosis','success_criteria','goal_id','pause_reason','operational_category','acceptance_criteria','acknowledgment','output_version','progress_note','review_feedback','blocker_reason','action_needed','impact','follow_up_at','question','response','evidence_id','evidence_type','reference','captured_at','platform','external_id','deployed_at','hypothesis','design','comparator','baseline','cohort','confounders','primary_metric','diagnostic_metrics','success_rule','evidence_rule','guardrails','budget','action','start_at','end_at','evaluate_after','required_ids','partial_design','decision_id','actual','numerator','denominator','source','maturity','limitations','outcome','recommendation','domain','amount','options','rationale','execution_state','implementation_evidence_id','incident_type','urgency','containment','review','prevention','week_start','cutoff_at','learning','forecast','forecast_assumptions','next_steps','sales_alignment','data_completeness','target_id','relation','note']);
 IF r.kind='work' AND NOT (r.status='review' AND n.status='in_progress') THEN n.payload:=n.payload||jsonb_build_object('output_version',r.payload->'output_version'); END IF;
 IF NOT public.growth_member(w,p,auth.uid(),n.brand_id) THEN RAISE EXCEPTION 'Forbidden: membership/scope'; END IF;
 IF r.id IS NOT NULL AND (n.kind<>r.kind OR ((n.brand_id IS DISTINCT FROM r.brand_id OR n.parent_id IS DISTINCT FROM r.parent_id) AND (r.status<>'draft' OR EXISTS(SELECT 1 FROM public.growth_records child WHERE child.parent_id=r.id))) OR r.archived_at IS NOT NULL) THEN RAISE EXCEPTION 'Identitas/scope/parent immutable setelah komitmen; arsip tidak dapat diubah'; END IF;
 IF n.parent_id IS NOT NULL THEN
   SELECT * INTO parent FROM public.growth_records WHERE id=n.parent_id AND workspace_id=w AND portfolio_id=p;
   IF NOT FOUND OR parent.brand_id IS DISTINCT FROM n.brand_id OR (r.id IS NULL AND (parent.archived_at IS NOT NULL OR NOT public.growth_can_read(parent))) THEN RAISE EXCEPTION 'Parent tidak valid/di luar scope'; END IF;
 END IF;
 IF r.id IS NOT NULL AND (r.kind IN ('evidence','deployment','result','link','update') OR (r.kind='goal' AND r.status='approved') OR (r.kind='weekly' AND r.status='final')) THEN RAISE EXCEPTION 'Record immutable; buat versi pengganti'; END IF;
 IF r.kind='decision' AND r.status='decided' AND (n.payload-'execution_state'-'implementation_evidence_id')<>(r.payload-'execution_state'-'implementation_evidence_id') THEN RAISE EXCEPTION 'Keputusan final immutable; buat keputusan pengganti'; END IF;
 required:='growth:manage';
 IF n.kind='work' AND r.id IS NOT NULL AND auth.uid() IN (r.pic_id,r.blocker_owner_id) AND NOT(public.growth_has_permission(w,'growth:manage') AND public.growth_team(w,p,n.brand_id)) THEN required:='growth:update-own'; END IF;
 IF n.kind IN ('evidence','deployment','update') THEN required:='growth:update-own'; END IF;
 IF n.kind='dependency' AND r.id IS NOT NULL AND auth.uid()=r.recipient_id THEN required:='growth:update-own'; END IF;
 IF n.kind='work' AND n.status='accepted' AND r.status IS DISTINCT FROM 'accepted' THEN required:='growth:review'; END IF;
 IF n.kind='work' AND r.status='review' AND n.status='in_progress' THEN required:='growth:review'; END IF;
 IF n.kind='decision' AND r.status='requested' AND auth.uid()=r.recipient_id THEN required:='growth:decide'; END IF;
 IF n.kind='decision' AND n.status='decided' AND r.status IS DISTINCT FROM 'decided' THEN required:='growth:decide'; END IF;
 IF n.kind='weekly' AND n.status='final' THEN required:='growth:weekly-finalize'; END IF;
 IF n.archived_at IS DISTINCT FROM r.archived_at THEN required:='growth:manage'; END IF;
 IF NOT public.growth_has_permission(w,required) THEN RAISE EXCEPTION 'Forbidden: %',required; END IF;
 IF required='growth:manage' AND NOT public.growth_team(w,p,n.brand_id) THEN RAISE EXCEPTION 'Kelola memerlukan akses tim dalam scope'; END IF;
 IF required='growth:manage' AND n.kind IN ('priority','goal','experiment','result','weekly') AND NOT public.growth_function(w,p,auth.uid(),'growth') THEN RAISE EXCEPTION 'Objek strategis memerlukan fungsi Growth'; END IF;
 IF required='growth:manage' AND n.kind='work' AND n.pic_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.growth_memberships manager JOIN public.growth_memberships assignee ON assignee.workspace_id=manager.workspace_id AND assignee.portfolio_id=manager.portfolio_id
   WHERE manager.workspace_id=w AND manager.portfolio_id=p AND manager.user_id=auth.uid() AND assignee.user_id=n.pic_id
   AND (assignee.user_id=auth.uid() OR assignee.functions && manager.managed_functions)
 ) THEN RAISE EXCEPTION 'PIC di luar fungsi yang dikelola; gunakan dependency/handover'; END IF;
 IF required='growth:update-own' AND n.kind='work' AND (n.title<>r.title OR n.pic_id IS DISTINCT FROM r.pic_id OR n.reviewer_id IS DISTINCT FROM r.reviewer_id OR n.recipient_id IS DISTINCT FROM r.recipient_id OR n.due_at IS DISTINCT FROM r.due_at OR (n.payload-'acknowledgment'-'blocker_reason'-'action_needed'-'impact'-'follow_up_at'-'previous_status'-'progress_note')<>(r.payload-'acknowledgment'-'blocker_reason'-'action_needed'-'impact'-'follow_up_at'-'previous_status'-'progress_note')) THEN RAISE EXCEPTION 'PIC hanya boleh acknowledgment/progress/blocker'; END IF;
 IF required='growth:update-own' AND n.kind='work' AND n.parent_id IS DISTINCT FROM r.parent_id THEN RAISE EXCEPTION 'Parent hanya dapat diubah oleh pengelola sebelum komitmen'; END IF;
 IF required='growth:review' AND n.kind='work' AND (auth.uid() IS DISTINCT FROM r.reviewer_id OR n.pic_id IS DISTINCT FROM r.pic_id OR n.reviewer_id IS DISTINCT FROM r.reviewer_id OR n.due_at IS DISTINCT FROM r.due_at OR n.title<>r.title OR (n.payload-'review_feedback'-'output_version')<>(r.payload-'review_feedback'-'output_version')) THEN RAISE EXCEPTION 'Reviewer hanya menerima/merevisi hasil existing'; END IF;
 IF n.kind IN ('evidence','deployment','update','result','link') AND n.parent_id IS NULL THEN RAISE EXCEPTION 'Parent diperlukan'; END IF;
 IF required='growth:update-own' AND n.kind IN ('evidence','deployment','update') AND NOT(public.growth_team(w,p,n.brand_id) OR auth.uid() IN (parent.pic_id,parent.reviewer_id,parent.recipient_id,parent.blocker_owner_id)) THEN RAISE EXCEPTION 'Hanya aktor pekerjaan dapat menambah bukti/update'; END IF;
 FOREACH actor IN ARRAY ARRAY[n.pic_id,n.reviewer_id,n.recipient_id,n.blocker_owner_id] LOOP
   IF actor IS NOT NULL AND NOT public.growth_member(w,p,actor,n.brand_id) THEN RAISE EXCEPTION 'Aktor tidak aktif/di luar scope'; END IF;
 END LOOP;
 -- All UUID references use the same scoped core, including JSON prerequisites.
 FOREACH required IN ARRAY ARRAY['goal_id','decision_id','evidence_id','deployment_id','target_id','supersedes_id','implementation_evidence_id'] LOOP
   IF n.payload->>required IS NOT NULL THEN
     link_id:=(n.payload->>required)::uuid;
   IF link_id=object_id OR NOT EXISTS(SELECT 1 FROM public.growth_records q WHERE q.id=link_id AND q.workspace_id=w AND q.portfolio_id=p AND q.brand_id IS NOT DISTINCT FROM n.brand_id AND public.growth_can_read(q)
     AND (required NOT IN ('evidence_id','implementation_evidence_id') OR q.kind='evidence')
     AND (required<>'goal_id' OR (q.kind='goal' AND q.status='approved'))
     AND (required<>'decision_id' OR (q.kind='decision' AND q.status='decided'))
     AND (required<>'deployment_id' OR q.kind='deployment')
     AND (required<>'supersedes_id' OR q.kind=n.kind)) THEN RAISE EXCEPTION 'Link % tidak valid',required; END IF;
   END IF;
 END LOOP;
 IF n.archived_at IS NOT NULL AND r.id IS NULL THEN RAISE EXCEPTION 'Arsip hanya untuk record existing'; END IF;
 IF n.status='blocked' THEN
   IF n.blocker_owner_id IS NULL OR coalesce(n.payload->>'blocker_reason','')='' OR coalesce(n.payload->>'action_needed','')='' OR coalesce(n.payload->>'impact','')='' OR n.payload->>'follow_up_at' IS NULL THEN RAISE EXCEPTION 'Blocker memerlukan alasan, owner, tindakan, dampak dan follow-up'; END IF;
   PERFORM (n.payload->>'follow_up_at')::timestamptz;
   IF r.status IS DISTINCT FROM 'blocked' THEN n.payload:=n.payload||jsonb_build_object('previous_status',coalesce(r.status,'assigned')); END IF;
 ELSIF r.status='blocked' AND n.kind='work' AND n.status<>(r.payload->>'previous_status') THEN RAISE EXCEPTION 'Resume harus kembali ke status sebelum blocked'; END IF;

 CASE n.kind
 WHEN 'priority' THEN
   IF n.status NOT IN ('draft','active','blocked','paused','completed','cancelled') THEN RAISE EXCEPTION 'Status prioritas tidak valid'; END IF;
   IF n.status IN ('active','blocked') AND (n.archived_at IS NOT NULL OR (SELECT count(*) FROM public.growth_records WHERE portfolio_id=p AND kind='priority' AND status IN ('active','blocked') AND archived_at IS NULL AND id<>object_id)>=3) THEN RAISE EXCEPTION 'Maksimal tiga prioritas aktif; pause prioritas lain dahulu'; END IF;
   IF n.status='paused' AND coalesce(n.payload->>'pause_reason','')='' THEN RAISE EXCEPTION 'Pause perlu alasan eksplisit'; END IF;
   IF n.status IN ('active','blocked') AND (n.pic_id IS NULL OR coalesce(n.payload->>'diagnosis','')='' OR coalesce(n.payload->>'success_criteria','')='') THEN RAISE EXCEPTION 'Prioritas aktif perlu owner, diagnosis dan kriteria'; END IF;
 WHEN 'work' THEN
   n.payload:=n.payload||jsonb_build_object('acknowledgment',coalesce(n.payload->>'acknowledgment',r.payload->>'acknowledgment','pending'));
   IF n.status NOT IN ('draft','assigned','in_progress','blocked','review','accepted','cancelled') THEN RAISE EXCEPTION 'Status task tidak valid'; END IF;
   IF r.id IS NOT NULL AND n.status<>r.status AND NOT (
     (r.status='draft' AND n.status IN ('assigned','cancelled')) OR (r.status='assigned' AND n.status IN ('in_progress','blocked','cancelled')) OR
     (r.status='in_progress' AND n.status IN ('blocked','review','cancelled')) OR (r.status='blocked' AND n.status= r.payload->>'previous_status') OR
     (r.status='review' AND n.status IN ('in_progress','accepted','blocked','cancelled'))
   ) THEN RAISE EXCEPTION 'Transisi task tidak valid'; END IF;
   IF r.id IS NULL AND n.status NOT IN ('draft','assigned') THEN RAISE EXCEPTION 'Task baru draft/assigned'; END IF;
   IF r.status='accepted' AND (n.title<>r.title OR n.pic_id IS DISTINCT FROM r.pic_id OR n.reviewer_id IS DISTINCT FROM r.reviewer_id OR n.payload<>r.payload) THEN RAISE EXCEPTION 'Hasil accepted immutable'; END IF;
   IF n.status NOT IN ('draft','cancelled') AND (n.pic_id IS NULL OR n.reviewer_id IS NULL OR n.due_at IS NULL OR coalesce(n.payload->>'acceptance_criteria','')='' OR (n.parent_id IS NULL AND coalesce(n.payload->>'operational_category','')='')) THEN RAISE EXCEPTION 'Task perlu PIC, due, kriteria, reviewer dan prioritas/kategori'; END IF;
   IF parent.id IS NOT NULL AND parent.kind NOT IN ('priority','experiment') THEN RAISE EXCEPTION 'Task parent harus prioritas/eksperimen'; END IF;
   IF coalesce(n.payload->>'acknowledgment','pending') NOT IN ('pending','accepted','declined') THEN RAISE EXCEPTION 'Acknowledgment tidak valid'; END IF;
   IF r.id IS NULL THEN n.payload:=n.payload||'{"acknowledgment":"pending","output_version":1}'::jsonb;
   ELSIF n.payload->>'acknowledgment' IS DISTINCT FROM r.payload->>'acknowledgment' AND auth.uid()<>r.pic_id THEN RAISE EXCEPTION 'Acknowledgment hanya oleh PIC'; END IF;
   IF r.id IS NOT NULL AND n.pic_id IS DISTINCT FROM r.pic_id THEN n.payload:=n.payload||'{"acknowledgment":"pending"}'::jsonb; END IF;
   IF n.status IN ('in_progress','review','accepted') AND n.payload->>'acknowledgment'<>'accepted' THEN RAISE EXCEPTION 'PIC harus menerima penugasan'; END IF;
   IF n.status IN ('review','accepted') AND NOT EXISTS(SELECT 1 FROM public.growth_records WHERE parent_id=object_id AND kind='evidence' AND (payload->>'output_version')::integer=coalesce((n.payload->>'output_version')::integer,1)) THEN RAISE EXCEPTION 'Bukti versi output diperlukan'; END IF;
   IF n.status='accepted' AND r.status IS DISTINCT FROM 'accepted' AND (auth.uid() IS DISTINCT FROM n.reviewer_id OR auth.uid()=n.pic_id) THEN RAISE EXCEPTION 'Reviewer terpisah dari PIC harus menerima hasil'; END IF;
   IF r.status='review' AND n.status='in_progress' THEN
     IF auth.uid() IS DISTINCT FROM r.reviewer_id OR NOT public.growth_has_permission(w,'growth:review') OR coalesce(n.payload->>'review_feedback','')='' THEN RAISE EXCEPTION 'Revisi perlu reviewer dan feedback'; END IF;
     n.payload:=n.payload||jsonb_build_object('output_version',coalesce((r.payload->>'output_version')::integer,1)+1);
   END IF;
 WHEN 'dependency' THEN
   IF n.status NOT IN ('requested','committed','declined','fulfilled','cancelled') OR n.recipient_id IS NULL THEN RAISE EXCEPTION 'Dependency perlu penerima dan status sah'; END IF;
   IF NOT public.growth_function(w,p,n.recipient_id,'sales') THEN RAISE EXCEPTION 'Dependency Sales perlu penerima Sales'; END IF;
   IF r.id IS NULL AND n.status<>'requested' THEN RAISE EXCEPTION 'Mulai sebagai permintaan'; END IF;
   IF r.id IS NOT NULL AND n.status<>r.status AND NOT((r.status='requested' AND n.status IN ('committed','declined','cancelled')) OR (r.status='committed' AND n.status IN ('fulfilled','cancelled'))) THEN RAISE EXCEPTION 'Transisi dependency tidak valid'; END IF;
   IF n.status IN ('committed','declined','fulfilled') AND n.status IS DISTINCT FROM r.status AND auth.uid()<>n.recipient_id THEN RAISE EXCEPTION 'Komitmen hanya oleh penerima Sales'; END IF;
   IF n.status='committed' AND (n.pic_id IS NULL OR n.due_at IS NULL OR coalesce(n.payload->>'acceptance_criteria','')='') THEN RAISE EXCEPTION 'Komitmen Sales perlu PIC, due dan kriteria'; END IF;
   IF n.status IN ('committed','fulfilled') AND NOT public.growth_function(w,p,n.pic_id,'sales') THEN RAISE EXCEPTION 'Komitmen dependency Sales memerlukan PIC Sales'; END IF;
   IF n.status='declined' AND coalesce(n.payload->>'response','')='' THEN RAISE EXCEPTION 'Decline perlu alasan penerima'; END IF;
   IF n.status='fulfilled' AND n.payload->>'evidence_id' IS NULL AND NOT EXISTS(SELECT 1 FROM public.growth_records WHERE parent_id=object_id AND kind='evidence') THEN RAISE EXCEPTION 'Fulfilled perlu bukti'; END IF;
 WHEN 'evidence' THEN
   IF n.status<>'recorded' OR coalesce(n.payload->>'evidence_type','') NOT IN ('url','campaign','asset','document','text') OR coalesce(n.payload->>'reference','')='' OR n.payload->>'captured_at' IS NULL THEN RAISE EXCEPTION 'Bukti perlu tipe, referensi dan timestamp'; END IF;
   PERFORM (n.payload->>'captured_at')::timestamptz;
   IF n.payload->>'evidence_type'='url' AND n.payload->>'reference' !~* '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'URL hanya http/https'; END IF;
 WHEN 'deployment' THEN
   IF n.status<>'deployed' OR parent.kind<>'work' OR parent.status<>'accepted' OR n.payload->>'evidence_id' IS NULL OR coalesce(n.payload->>'platform','')='' OR coalesce(n.payload->>'external_id','')='' OR n.payload->>'deployed_at' IS NULL THEN RAISE EXCEPTION 'Deployment perlu task accepted, bukti, platform, ID dan waktu'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.growth_records WHERE id=(n.payload->>'evidence_id')::uuid AND parent_id=parent.id AND kind='evidence' AND (payload->>'output_version')::integer=(parent.payload->>'output_version')::integer) THEN RAISE EXCEPTION 'Deployment harus menunjuk bukti versi accepted'; END IF;
   PERFORM (n.payload->>'deployed_at')::timestamptz;
 WHEN 'experiment' THEN
   IF n.status NOT IN ('draft','ready','running','awaiting_evaluation','evaluated','closed','cancelled') THEN RAISE EXCEPTION 'Status eksperimen tidak valid'; END IF;
   IF r.id IS NULL AND n.status<>'draft' THEN RAISE EXCEPTION 'Eksperimen mulai draft'; END IF;
   IF r.status IN ('running','awaiting_evaluation','evaluated','closed') AND ((n.payload-'decision_id')<>(r.payload-'decision_id') OR n.pic_id IS DISTINCT FROM r.pic_id) THEN RAISE EXCEPTION 'Desain eksperimen berjalan immutable; buat eksperimen baru'; END IF;
   IF r.id IS NOT NULL AND n.status<>r.status AND NOT ((r.status='draft' AND n.status IN ('ready','cancelled')) OR (r.status='ready' AND n.status IN ('running','draft','cancelled')) OR (r.status='running' AND n.status IN ('awaiting_evaluation','cancelled')) OR (r.status='awaiting_evaluation' AND n.status IN ('evaluated','cancelled')) OR (r.status='evaluated' AND n.status IN ('closed','cancelled'))) THEN RAISE EXCEPTION 'Transisi eksperimen tidak valid'; END IF;
   IF n.status NOT IN ('draft','cancelled') THEN
     FOREACH required IN ARRAY ARRAY['hypothesis','design','comparator','baseline','cohort','confounders','primary_metric','diagnostic_metrics','success_rule','evidence_rule','guardrails','evaluate_after','start_at','end_at','budget','action'] LOOP
       IF coalesce(n.payload->>required,'')='' THEN RAISE EXCEPTION 'Brief eksperimen memerlukan %',required; END IF;
     END LOOP;
     IF n.pic_id IS NULL THEN RAISE EXCEPTION 'Eksperimen perlu PIC'; END IF;
     IF (n.payload->>'budget')::numeric<0 OR (n.payload->>'end_at')::timestamptz<(n.payload->>'start_at')::timestamptz OR (n.payload->>'evaluate_after')::timestamptz<(n.payload->>'end_at')::timestamptz THEN RAISE EXCEPTION 'Budget/tanggal eksperimen tidak valid'; END IF;
   END IF;
   IF n.status='running' AND r.status<>'running' THEN
     mandate:=public.growth_mandated(w,p,auth.uid(),n.brand_id,'growth_media',n.payload->>'action',(n.payload->>'budget')::numeric);
     IF mandate IS NULL THEN RAISE EXCEPTION 'Budget/aksi di luar mandat'; END IF;
     n.payload:=n.payload||jsonb_build_object('mandate_version_id',mandate);
     IF jsonb_array_length(coalesce(n.payload->'required_ids','[]'))=0 THEN RAISE EXCEPTION 'Eksperimen memerlukan prerequisite deployment/dependency'; END IF;
     FOR requirement IN SELECT value::uuid FROM jsonb_array_elements_text(n.payload->'required_ids') LOOP
       IF NOT EXISTS(SELECT 1 FROM public.growth_records q WHERE q.id=requirement AND q.workspace_id=w AND q.portfolio_id=p AND q.brand_id IS NOT DISTINCT FROM n.brand_id AND q.archived_at IS NULL AND ((q.kind='deployment' AND q.status='deployed') OR (q.kind='dependency' AND q.status='fulfilled'))) THEN RAISE EXCEPTION 'Prerequisite belum deployed/fulfilled'; END IF;
     END LOOP;
   END IF;
   IF n.status IN ('evaluated','closed') AND NOT EXISTS(SELECT 1 FROM public.growth_records WHERE parent_id=object_id AND kind='result') THEN RAISE EXCEPTION 'Hasil evaluasi diperlukan'; END IF;
   IF n.status='closed' AND n.payload->>'decision_id' IS NULL THEN RAISE EXCEPTION 'Penutupan perlu keputusan tindak lanjut'; END IF;
 WHEN 'result' THEN
   IF n.status<>'recorded' OR parent.kind<>'experiment' OR (parent.status<>'awaiting_evaluation' AND NOT(parent.status IN ('evaluated','closed') AND n.payload->>'supersedes_id' IS NOT NULL AND coalesce(n.payload->>'revision_reason','')<>'')) THEN RAISE EXCEPTION 'Hasil untuk eksperimen awaiting evaluation atau revisi beralasan'; END IF;
   FOREACH required IN ARRAY ARRAY['actual','numerator','denominator','cohort','period_from','period_to','source','captured_at','maturity','limitations','outcome','recommendation'] LOOP
     IF coalesce(n.payload->>required,'')='' THEN RAISE EXCEPTION 'Hasil perlu %',required; END IF;
   END LOOP;
   IF n.payload->>'outcome' NOT IN ('success','failure','inconclusive') OR n.payload->>'recommendation' NOT IN ('scale','continue','revise','stop','defer') THEN RAISE EXCEPTION 'Outcome/rekomendasi tidak valid'; END IF;
   IF n.payload->>'maturity'<>'mature' AND n.payload->>'recommendation'='scale' THEN RAISE EXCEPTION 'Hasil belum matang tidak boleh scale'; END IF;
   IF n.payload->>'recommendation'='scale' AND (n.payload->>'outcome'<>'success' OR (n.payload->>'denominator')::numeric<=0) THEN RAISE EXCEPTION 'Scale perlu outcome success dan denominator positif'; END IF;
   IF n.payload->>'recommendation'='scale' AND now()<(parent.payload->>'evaluate_after')::timestamptz THEN RAISE EXCEPTION 'Evaluate after belum tercapai'; END IF;
   PERFORM (n.payload->>'captured_at')::timestamptz;
 WHEN 'decision' THEN
   IF n.status NOT IN ('draft','requested','decided','withdrawn') THEN RAISE EXCEPTION 'Status keputusan tidak valid'; END IF;
   domain_name:=n.payload->>'domain'; amount:=coalesce((n.payload->>'amount')::numeric,0);
   IF domain_name NOT IN ('growth_media','creative','sales_commercial','sales_operations','cross_function') OR domain_name IS NULL OR amount<0 THEN RAISE EXCEPTION 'Domain/amount keputusan tidak valid'; END IF;
   IF r.id IS NULL AND n.status<>'draft' THEN RAISE EXCEPTION 'Keputusan mulai draft'; END IF;
   IF r.id IS NOT NULL AND n.status<>r.status AND NOT ((r.status='draft' AND n.status IN ('requested','decided','withdrawn')) OR (r.status='requested' AND n.status IN ('decided','withdrawn'))) THEN RAISE EXCEPTION 'Transisi keputusan tidak valid'; END IF;
   IF n.status='requested' AND (n.recipient_id IS NULL OR n.due_at IS NULL OR coalesce(n.payload->>'question','')='' OR coalesce(n.payload->>'options','')='') THEN RAISE EXCEPTION 'Permintaan perlu penerima, deadline, pertanyaan, opsi'; END IF;
   IF r.status='requested' AND (n.payload->>'domain' IS DISTINCT FROM r.payload->>'domain' OR n.payload->>'action' IS DISTINCT FROM r.payload->>'action' OR n.payload->>'amount' IS DISTINCT FROM r.payload->>'amount' OR n.recipient_id IS DISTINCT FROM r.recipient_id) THEN RAISE EXCEPTION 'Request immutable; tarik/buat versi baru'; END IF;
   IF r.status='requested' AND n.status='requested' AND auth.uid()=r.recipient_id AND ((n.payload-'response')<>(r.payload-'response') OR n.title<>r.title OR n.due_at IS DISTINCT FROM r.due_at) THEN RAISE EXCEPTION 'Needs information hanya memperbarui respons'; END IF;
   IF n.status='decided' AND r.status<>'decided' THEN
     IF r.status='requested' AND (auth.uid()<>r.recipient_id OR auth.uid()=r.created_by) THEN RAISE EXCEPTION 'Hanya penerima lain boleh menjawab request'; END IF;
     mandate:=public.growth_mandated(w,p,auth.uid(),n.brand_id,domain_name,n.payload->>'action',amount);
     IF mandate IS NULL THEN RAISE EXCEPTION 'Keputusan di luar mandat; minta pemilik mandat yang sah'; END IF;
     IF coalesce(n.payload->>'rationale','')='' OR n.payload->>'outcome' NOT IN ('approved','rejected','alternative') OR n.payload->>'outcome' IS NULL THEN RAISE EXCEPTION 'Keputusan perlu hasil dan alasan'; END IF;
     n.payload:=n.payload||jsonb_build_object('mandate_version_id',mandate,'decided_by',auth.uid(),'decided_at',now(),'execution_state','not_started');
   END IF;
   IF r.status='decided' THEN
     IF n.status<>'decided' OR n.pic_id IS DISTINCT FROM r.pic_id OR n.recipient_id IS DISTINCT FROM r.recipient_id OR n.title<>r.title THEN RAISE EXCEPTION 'Keputusan immutable'; END IF;
     IF n.payload->>'execution_state' NOT IN ('not_started','in_progress','implemented','not_implemented') OR n.payload->>'execution_state' IS NULL THEN RAISE EXCEPTION 'Execution state tidak valid'; END IF;
     IF n.payload->>'execution_state'='implemented' AND n.payload->>'implementation_evidence_id' IS NULL THEN RAISE EXCEPTION 'Implemented memerlukan bukti'; END IF;
   END IF;
 WHEN 'incident' THEN
   IF n.status NOT IN ('open','contained','resolved','closed') OR coalesce(n.payload->>'incident_type','')='' OR coalesce(n.payload->>'impact','')='' OR coalesce(n.payload->>'urgency','')='' OR n.pic_id IS NULL THEN RAISE EXCEPTION 'Insiden perlu jenis/dampak/urgensi/owner'; END IF;
   IF n.status IN ('contained','resolved','closed') AND coalesce(n.payload->>'containment','')='' THEN RAISE EXCEPTION 'Containment diperlukan'; END IF;
   IF r.id IS NULL AND n.status<>'open' THEN RAISE EXCEPTION 'Insiden mulai open'; END IF;
   IF r.id IS NOT NULL AND n.status<>r.status AND NOT((r.status='open' AND n.status='contained') OR (r.status='contained' AND n.status='resolved') OR (r.status='resolved' AND n.status='closed')) THEN RAISE EXCEPTION 'Transisi insiden tidak valid'; END IF;
   IF n.status IN ('resolved','closed') AND n.payload->>'evidence_id' IS NULL AND NOT EXISTS(SELECT 1 FROM public.growth_records WHERE parent_id=object_id AND kind='evidence') THEN RAISE EXCEPTION 'Resolusi insiden perlu bukti'; END IF;
   IF n.status='closed' AND (coalesce(n.payload->>'review','')='' OR coalesce(n.payload->>'prevention','')='') THEN RAISE EXCEPTION 'Penutupan insiden perlu review dan pencegahan'; END IF;
 WHEN 'weekly' THEN
   IF n.status NOT IN ('draft','final') OR NOT public.growth_team(w,p,n.brand_id) OR NOT public.growth_has_permission(w,'growth:metrics-read') OR NOT public.growth_has_permission(w,'growth:financial-target-read') THEN RAISE EXCEPTION 'Weekly perlu akses tim, BI dan target'; END IF;
   IF n.status='final' AND NOT public.growth_function(w,p,auth.uid(),'growth') THEN RAISE EXCEPTION 'Finalisasi hanya Growth'; END IF;
   IF extract(isodow FROM (n.payload->>'week_start')::date)<>1 OR n.payload->>'cutoff_at' IS NULL THEN RAISE EXCEPTION 'Weekly mulai Senin dan cutoff eksplisit'; END IF;
   PERFORM (n.payload->>'cutoff_at')::timestamptz;
   IF (n.payload->>'cutoff_at')::timestamptz>now() THEN RAISE EXCEPTION 'Cutoff tidak boleh di masa depan'; END IF;
   IF n.payload->>'snapshot_id' IS NOT NULL THEN
     SELECT * INTO snapshot FROM public.growth_metric_snapshots WHERE id=(n.payload->>'snapshot_id')::uuid AND workspace_id=w AND portfolio_id=p AND actor_id=auth.uid() AND brand_id IS NOT DISTINCT FROM n.brand_id AND cutoff_at=(n.payload->>'cutoff_at')::timestamptz;
     IF NOT FOUND THEN RAISE EXCEPTION 'Snapshot BI server tidak valid'; END IF;
     n.payload:=n.payload||jsonb_build_object('snapshot',snapshot.data || jsonb_build_object(
       'work_records',coalesce((SELECT jsonb_agg(a.after_values) FROM (SELECT DISTINCT ON (e.object_id) e.object_id,e.after_values FROM public.growth_audit_events e WHERE e.workspace_id=w AND e.portfolio_id=p AND e.action IN ('save','archive') AND e.created_at<=snapshot.cutoff_at ORDER BY e.object_id,e.id DESC) a WHERE a.after_values->>'kind'<>'weekly' AND (n.brand_id IS NULL OR (a.after_values->>'brand_id')::integer=n.brand_id)),'[]'),
       'mandate_versions',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM public.growth_mandate_versions m WHERE workspace_id=w AND portfolio_id=p AND created_at<=snapshot.cutoff_at AND (n.brand_id IS NULL OR brand_id IS NULL OR brand_id=n.brand_id)),'[]')));
   ELSIF r.id IS NOT NULL AND (n.payload->>'cutoff_at') IS DISTINCT FROM (r.payload->>'cutoff_at') THEN RAISE EXCEPTION 'Cutoff berubah; refresh snapshot server'; END IF;
   IF n.status='final' THEN
     IF NOT public.growth_function(w,p,auth.uid(),'growth') THEN RAISE EXCEPTION 'Finalisasi hanya Growth'; END IF;
     FOREACH required IN ARRAY ARRAY['diagnosis','learning','next_steps','sales_alignment','data_completeness'] LOOP
       IF coalesce(n.payload->>required,'')='' THEN RAISE EXCEPTION 'Weekly perlu %',required; END IF;
     END LOOP;
     IF n.payload->'snapshot' IS NULL OR n.payload->'snapshot'->>'workspace_id'<>w::text OR n.payload->'snapshot'->>'portfolio_id'<>p::text THEN RAISE EXCEPTION 'Snapshot server diperlukan'; END IF;
     IF n.payload->>'supersedes_id' IS NOT NULL AND coalesce(n.payload->>'revision_reason','')='' THEN RAISE EXCEPTION 'Revisi perlu alasan'; END IF;
     IF EXISTS(SELECT 1 FROM public.growth_records previous WHERE previous.workspace_id=w AND previous.portfolio_id=p AND previous.kind='weekly' AND previous.status='final' AND previous.brand_id IS NOT DISTINCT FROM n.brand_id AND previous.payload->>'week_start'=n.payload->>'week_start' AND previous.id<>object_id
       AND NOT EXISTS(SELECT 1 FROM public.growth_records replacement WHERE replacement.kind='weekly' AND replacement.status='final' AND replacement.payload->>'supersedes_id'=previous.id::text)
       AND previous.id::text IS DISTINCT FROM n.payload->>'supersedes_id') THEN RAISE EXCEPTION 'Review final pekan ini sudah ada; buat revisi yang menggantikan versi terakhir'; END IF;
     n.payload:=n.payload||jsonb_build_object('finalized_by',auth.uid(),'finalized_at',now());
   END IF;
 WHEN 'goal' THEN
   IF n.status NOT IN ('draft','approved','retired') OR coalesce(n.payload->>'metric','')='' OR coalesce(n.payload->>'unit','')='' OR coalesce(n.payload->>'period_from','')='' OR coalesce(n.payload->>'period_to','')='' OR n.pic_id IS NULL THEN RAISE EXCEPTION 'Goal perlu metric/unit/period/owner'; END IF;
   IF n.payload->>'target_value' IS NULL THEN RAISE EXCEPTION 'Target operasional wajib diisi'; END IF;
   PERFORM (n.payload->>'target_value')::numeric;
   IF n.status='approved' THEN
     mandate:=public.growth_mandated(w,p,auth.uid(),n.brand_id,'cross_function','approve_goal',0);
     IF mandate IS NULL THEN RAISE EXCEPTION 'Goal perlu mandat persetujuan'; END IF;
     n.payload:=n.payload||jsonb_build_object('mandate_version_id',mandate,'approved_by',auth.uid());
   END IF;
 WHEN 'link' THEN
   IF n.status<>'recorded' OR n.payload->>'target_id' IS NULL OR coalesce(n.payload->>'relation','')='' THEN RAISE EXCEPTION 'Link perlu target dan relation'; END IF;
 WHEN 'update' THEN
   IF n.status<>'recorded' OR coalesce(n.payload->>'note','')='' THEN RAISE EXCEPTION 'Update perlu catatan'; END IF;
 ELSE RAISE EXCEPTION 'Jenis record tidak valid';
 END CASE;

 old:=CASE WHEN r.id IS NULL THEN NULL ELSE to_jsonb(r) END;
 IF r.id IS NULL THEN
   INSERT INTO public.growth_records(id,workspace_id,portfolio_id,kind,title,status,brand_id,parent_id,pic_id,reviewer_id,recipient_id,blocker_owner_id,due_at,payload,row_version,created_by)
   VALUES(n.id,w,p,n.kind,n.title,n.status,n.brand_id,n.parent_id,n.pic_id,n.reviewer_id,n.recipient_id,n.blocker_owner_id,n.due_at,n.payload,n.row_version,auth.uid()) RETURNING to_jsonb(growth_records.*) INTO result;
 ELSE
   UPDATE public.growth_records SET title=n.title,status=n.status,brand_id=n.brand_id,parent_id=n.parent_id,pic_id=n.pic_id,reviewer_id=n.reviewer_id,recipient_id=n.recipient_id,blocker_owner_id=n.blocker_owner_id,due_at=n.due_at,payload=n.payload,row_version=n.row_version,archived_at=n.archived_at,updated_at=now()
   WHERE id=object_id RETURNING to_jsonb(growth_records.*) INTO result;
 END IF;
 INSERT INTO public.growth_audit_events(workspace_id,portfolio_id,object_id,actor_id,action,before_values,after_values,request_id) VALUES(w,p,object_id,auth.uid(),'save',old,result,request_id);
 INSERT INTO public.growth_requests VALUES(w,auth.uid(),'save',request_id,hash,result,now());
 RETURN result;
END $$;

CREATE FUNCTION public.growth_immutable_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Growth history append-only'; END $$;
CREATE TRIGGER growth_audit_append_only BEFORE UPDATE OR DELETE ON public.growth_audit_events FOR EACH ROW EXECUTE FUNCTION public.growth_immutable_history();
CREATE TRIGGER growth_mandates_append_only BEFORE UPDATE OR DELETE ON public.growth_mandate_versions FOR EACH ROW EXECUTE FUNCTION public.growth_immutable_history();
CREATE TRIGGER growth_snapshots_append_only BEFORE UPDATE OR DELETE ON public.growth_metric_snapshots FOR EACH ROW EXECUTE FUNCTION public.growth_immutable_history();

-- Minimal parent context for an involved actor; never includes unrelated work,
-- financial snapshots, experiment claims, or full parent payloads.
CREATE FUNCTION public.growth_parent_context(object_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',parent.id,'short_id',parent.short_id,'kind',parent.kind,'title',parent.title,'status',parent.status)
 FROM public.growth_records child JOIN public.growth_records parent ON parent.id=child.parent_id
 WHERE child.id=object_id AND public.growth_can_read(child);
$$;

-- SECURITY INVOKER intentionally applies record RLS to lists and aggregates.
CREATE FUNCTION public.growth_overview_summary(w uuid,p uuid,b integer) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 WITH visible AS (SELECT * FROM public.growth_records WHERE workspace_id=w AND portfolio_id=p AND archived_at IS NULL AND (b IS NULL OR brand_id=b)),
 items AS (SELECT id,short_id,kind,title,status,due_at,payload FROM visible)
 SELECT jsonb_build_object(
   'active_priorities',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM items WHERE kind='priority' AND status IN ('active','blocked') ORDER BY short_id LIMIT 3) r),'[]'),
   'blocked',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM items WHERE status='blocked' ORDER BY due_at NULLS LAST LIMIT 25) r),'[]'),
   'overdue',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM items WHERE kind IN ('work','dependency','decision') AND status NOT IN ('draft','accepted','cancelled','fulfilled','declined','decided','withdrawn') AND due_at<now() ORDER BY due_at LIMIT 25) r),'[]'),
   'pending_decisions',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM items WHERE kind='decision' AND status='requested' ORDER BY due_at NULLS LAST LIMIT 25) r),'[]'),
   'evaluation_needed',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM items WHERE kind='experiment' AND (status='awaiting_evaluation' OR (status='running' AND (payload->>'evaluate_after')::timestamptz<=now())) ORDER BY short_id LIMIT 25) r),'[]'),
   'awaiting_deployment',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM items i WHERE kind='work' AND status='accepted' AND NOT EXISTS(SELECT 1 FROM visible d WHERE d.parent_id=i.id AND d.kind='deployment') ORDER BY short_id LIMIT 25) r),'[]'),
   'last_review',(SELECT to_jsonb(r) FROM (SELECT id,short_id,title,status,payload->>'week_start' AS week_start,payload->>'cutoff_at' AS cutoff_at FROM visible WHERE kind='weekly' AND status='final' ORDER BY created_at DESC LIMIT 1) r)
 );
$$;

CREATE FUNCTION public.growth_archive_record(w uuid,p uuid,object_id uuid,expected_version integer,request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.growth_records; result jsonb; previous public.growth_requests; hash text:=md5(p::text||object_id::text||expected_version::text);
BEGIN
 IF NOT public.growth_has_permission(w,'tab:growth-work') OR NOT public.growth_has_permission(w,'growth:manage') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM 1 FROM public.growth_portfolios WHERE id=p AND workspace_id=w FOR UPDATE;
 SELECT * INTO r FROM public.growth_records WHERE id=object_id AND workspace_id=w AND portfolio_id=p FOR UPDATE;
 IF NOT FOUND OR NOT public.growth_can_read(r) OR NOT public.growth_team(w,p,r.brand_id) THEN RAISE EXCEPTION 'Forbidden: archive scope'; END IF;
 SELECT * INTO previous FROM public.growth_requests WHERE workspace_id=w AND actor_id=auth.uid() AND action='archive' AND growth_requests.request_id=growth_archive_record.request_id;
 IF FOUND THEN IF previous.payload_hash<>hash THEN RAISE EXCEPTION 'Idempotency key berbeda payload'; END IF; RETURN previous.result; END IF;
 IF r.row_version<>expected_version OR r.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Conflict: muat ulang versi terbaru'; END IF;
 IF r.kind='priority' AND r.status IN ('active','blocked') THEN RAISE EXCEPTION 'Pause/selesaikan prioritas sebelum arsip'; END IF;
 UPDATE public.growth_records SET archived_at=now(),updated_at=now(),row_version=row_version+1 WHERE id=object_id RETURNING to_jsonb(growth_records.*) INTO result;
 INSERT INTO public.growth_audit_events(workspace_id,portfolio_id,object_id,actor_id,action,before_values,after_values,request_id) VALUES(w,p,object_id,auth.uid(),'archive',to_jsonb(r),result,request_id);
 INSERT INTO public.growth_requests VALUES(w,auth.uid(),'archive',request_id,hash,result,now());
 RETURN result;
END $$;

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'growth_%' LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon',f.signature);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.signature);
 END LOOP;
END $$;
REVOKE INSERT,UPDATE,DELETE ON public.growth_portfolios,public.growth_memberships,public.growth_membership_brands,public.growth_mandate_versions,public.growth_records,public.growth_audit_events,public.growth_requests FROM service_role;
COMMIT;
