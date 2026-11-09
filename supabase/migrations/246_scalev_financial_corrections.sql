-- Raw ScaleV payloads remain untouched. Existing monetary columns are the BI
-- projection; only explicitly corrected fields retain a separate source value.
BEGIN;

CREATE TABLE public.scalev_financial_correction_versions (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  scalev_order_id bigint NOT NULL REFERENCES public.scalev_orders(id) ON DELETE RESTRICT,
  version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, scalev_order_id)
);
CREATE TABLE public.scalev_financial_corrections (
  workspace_id uuid NOT NULL,
  scalev_order_id bigint NOT NULL,
  entity text NOT NULL CHECK (entity IN ('order', 'line')),
  -- Same stable key as ingestion's ON CONFLICT(scalev_order_id,product_name).
  line_key text NOT NULL DEFAULT '',
  field text NOT NULL,
  original_amount numeric,
  source_amount numeric,
  corrected_amount numeric NOT NULL,
  active boolean NOT NULL DEFAULT true,
  source_updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, scalev_order_id, entity, line_key, field),
  FOREIGN KEY (workspace_id, scalev_order_id)
    REFERENCES public.scalev_financial_correction_versions(workspace_id, scalev_order_id),
  CHECK ((entity = 'order' AND line_key = '') OR (entity = 'line' AND line_key <> ''))
);
CREATE TABLE public.scalev_financial_correction_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  scalev_order_id bigint NOT NULL,
  version bigint NOT NULL,
  before_value jsonb NOT NULL,
  after_value jsonb NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 1000),
  changed_by uuid NOT NULL REFERENCES public.profiles(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, scalev_order_id, version)
);
CREATE TABLE public.workspace_financial_revisions (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id),
  revision bigint NOT NULL DEFAULT 0
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['scalev_financial_correction_versions', 'scalev_financial_corrections',
    'scalev_financial_correction_audit', 'workspace_financial_revisions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
    EXECUTE format('CREATE POLICY financial_correction_read ON public.%I FOR SELECT TO authenticated USING (public.workspace_has_role(workspace_id, ARRAY[''workspace_owner'',''admin'']))', t);
  END LOOP;
END $$;

CREATE FUNCTION public.scalev_correction_field_allowed(p_entity text, p_field text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(CASE p_entity
    WHEN 'order' THEN p_field = ANY(ARRAY['gross_revenue','net_revenue','shipping_cost',
      'shipping_discount','discount_code_discount','unique_code_discount'])
    WHEN 'line' THEN p_field = ANY(ARRAY['product_price_bt','discount_bt','cogs_bt'])
    ELSE false END, false);
$$;

-- Use the same workspace advisory lock as migration 188. Callers retry
-- transient deadlocks just like the existing line-persistence writer.
CREATE FUNCTION public.lock_scalev_financial_corrections() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE a bigint; b bigint; BEGIN
  IF TG_OP <> 'INSERT' THEN a := hashtextextended('scalev-order-lines:' || OLD.workspace_id::text, 0); END IF;
  IF TG_OP <> 'DELETE' THEN b := hashtextextended('scalev-order-lines:' || NEW.workspace_id::text, 0); END IF;
  IF a IS NOT NULL AND b IS NOT NULL AND a <> b THEN
    PERFORM pg_advisory_xact_lock(least(a,b)); PERFORM pg_advisory_xact_lock(greatest(a,b));
  ELSE PERFORM pg_advisory_xact_lock(coalesce(a,b)); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id) THEN
    IF EXISTS (SELECT 1 FROM public.scalev_financial_correction_versions
      WHERE workspace_id = OLD.workspace_id AND scalev_order_id = OLD.id) THEN
      RAISE EXCEPTION 'Order with financial correction history cannot change identity/workspace';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aa0_scalev_financial_lock BEFORE INSERT OR UPDATE OR DELETE ON public.scalev_orders
FOR EACH ROW EXECUTE FUNCTION public.lock_scalev_financial_corrections();

CREATE FUNCTION public.guard_scalev_corrected_line_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.workspace_id,NEW.scalev_order_id,NEW.product_name)
    IS DISTINCT FROM (OLD.workspace_id,OLD.scalev_order_id,OLD.product_name)
    AND EXISTS (SELECT 1 FROM public.scalev_financial_corrections
      WHERE workspace_id=OLD.workspace_id AND scalev_order_id=OLD.scalev_order_id
        AND entity='line' AND line_key=OLD.product_name) THEN
    RAISE EXCEPTION 'Corrected line identity changed; explicit reconciliation required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ab_scalev_corrected_line_identity
BEFORE UPDATE OF workspace_id,scalev_order_id,product_name ON public.scalev_order_lines
FOR EACH ROW EXECUTE FUNCTION public.guard_scalev_corrected_line_identity();

-- AFTER (not BEFORE) is essential: INSERT ... ON CONFLICT must capture incoming
-- raw values, not EXCLUDED values already rewritten by a BEFORE INSERT trigger.
-- One UPDATE OF trigger per field avoids treating unchanged corrected fields in
-- a partial status/financial update as fresh source values.
CREATE FUNCTION public.project_scalev_financial_correction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE e text := TG_ARGV[0]; f text := TG_ARGV[1]; k text := ''; oid bigint;
  src numeric; c public.scalev_financial_corrections%ROWTYPE; guard text; previous_guard text;
BEGIN
  IF e = 'order' THEN oid := NEW.id;
  ELSE oid := NEW.scalev_order_id; k := NEW.product_name; END IF;
  guard := TG_TABLE_NAME || ':' || NEW.id::text || ':' || f;
  IF current_setting('app.scalev_financial_projection', true) = guard THEN RETURN NULL; END IF;
  src := (to_jsonb(NEW)->>f)::numeric;
  UPDATE public.scalev_financial_corrections SET source_amount = src, source_updated_at = now()
    WHERE workspace_id = NEW.workspace_id AND scalev_order_id = oid
      AND entity = e AND line_key = k AND field = f RETURNING * INTO c;
  IF NOT FOUND OR NOT c.active OR src IS NOT DISTINCT FROM c.corrected_amount THEN RETURN NULL; END IF;
  previous_guard := current_setting('app.scalev_financial_projection', true);
  PERFORM set_config('app.scalev_financial_projection', guard, true);
  EXECUTE format('UPDATE public.%I SET %I = $1 WHERE id = $2 AND workspace_id = $3', TG_TABLE_NAME, f)
    USING c.corrected_amount, NEW.id, NEW.workspace_id;
  PERFORM set_config('app.scalev_financial_projection', coalesce(previous_guard,''), true);
  RETURN NULL;
END $$;

DO $$ DECLARE e text; t text; f text; fields text[]; BEGIN
  FOREACH e IN ARRAY ARRAY['order','line'] LOOP
    t := CASE e WHEN 'order' THEN 'scalev_orders' ELSE 'scalev_order_lines' END;
    fields := CASE e WHEN 'order' THEN ARRAY['gross_revenue','net_revenue','shipping_cost',
      'shipping_discount','discount_code_discount','unique_code_discount']
      ELSE ARRAY['product_price_bt','discount_bt','cogs_bt'] END;
    FOREACH f IN ARRAY fields LOOP
      EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OF %I ON public.%I FOR EACH ROW EXECUTE FUNCTION public.project_scalev_financial_correction(%L,%L)',
        'zzzz_financial_correction_' || f, f, t, e, f);
    END LOOP;
  END LOOP;
END $$;

CREATE FUNCTION public.set_scalev_financial_corrections(
  p_workspace_id uuid, p_order_id bigint, p_changes jsonb, p_reason text,
  p_expected_version bigint, p_actor_id uuid DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid; v bigint; change jsonb; e text; k text; f text; t text;
  row_id bigint; src numeric; amount numeric; enabled boolean; before_rows jsonb; after_rows jsonb;
  previous_guard text;
BEGIN
  actor := auth.uid();
  IF auth.role() = 'service_role' THEN actor := p_actor_id;
  ELSIF p_actor_id IS NOT NULL AND p_actor_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Cannot attribute correction to another user';
  END IF;
  IF actor IS NULL OR NOT EXISTS (SELECT 1 FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND user_id = actor AND status = 'active'
      AND role IN ('workspace_owner','admin')) THEN RAISE EXCEPTION 'Financial correction access denied'; END IF;
  IF p_expected_version IS NULL OR p_expected_version < 0 OR p_reason IS NULL
    OR length(btrim(p_reason)) NOT BETWEEN 1 AND 1000
    OR p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN RAISE EXCEPTION 'Invalid correction request'; END IF;
  IF jsonb_array_length(p_changes) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Invalid correction count'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('scalev-order-lines:' || p_workspace_id::text, 0));
  PERFORM 1 FROM public.scalev_orders WHERE id = p_order_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found in workspace'; END IF;
  INSERT INTO public.scalev_financial_correction_versions(workspace_id,scalev_order_id)
    VALUES(p_workspace_id,p_order_id) ON CONFLICT DO NOTHING;
  SELECT version INTO v FROM public.scalev_financial_correction_versions
    WHERE workspace_id=p_workspace_id AND scalev_order_id=p_order_id FOR UPDATE;
  IF v <> p_expected_version THEN RAISE EXCEPTION 'Correction version changed; reload before editing'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes) c
    GROUP BY c->>'entity', coalesce(c->>'line_key',''), c->>'field' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate correction field'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY entity,line_key,field),'[]') INTO before_rows
    FROM public.scalev_financial_corrections c WHERE workspace_id=p_workspace_id AND scalev_order_id=p_order_id;

  FOR change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    IF jsonb_typeof(change) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(change) x
      WHERE x NOT IN ('entity','line_key','field','amount','active')) THEN RAISE EXCEPTION 'Invalid correction fields'; END IF;
    e := change->>'entity'; k := coalesce(change->>'line_key',''); f := change->>'field';
    IF NOT public.scalev_correction_field_allowed(e,f) OR (e='order' AND k<>'') OR (e='line' AND k='')
      OR (change ? 'active' AND jsonb_typeof(change->'active') <> 'boolean') THEN RAISE EXCEPTION 'Invalid correction target'; END IF;
    enabled := coalesce((change->>'active')::boolean,true);
    IF enabled AND (NOT change ? 'amount' OR jsonb_typeof(change->'amount') <> 'number') THEN
      RAISE EXCEPTION 'Correction amount must be numeric'; END IF;
    amount := (change->>'amount')::numeric;
    IF enabled AND (amount IS NULL OR abs(amount) > 9999999999.99 OR amount <> round(amount,2)) THEN
      RAISE EXCEPTION 'Correction amount must fit the monetary column with at most two decimals'; END IF;
    t := CASE e WHEN 'order' THEN 'scalev_orders' ELSE 'scalev_order_lines' END;
    IF e = 'order' THEN
      EXECUTE format('SELECT id,%I FROM public.scalev_orders WHERE workspace_id=$1 AND id=$2 FOR UPDATE',f)
        INTO row_id,src USING p_workspace_id,p_order_id;
    ELSE
      EXECUTE format('SELECT id,%I FROM public.scalev_order_lines WHERE workspace_id=$1 AND scalev_order_id=$2 AND product_name=$3 FOR UPDATE',f)
        INTO row_id,src USING p_workspace_id,p_order_id,k;
    END IF;
    IF row_id IS NULL AND enabled THEN RAISE EXCEPTION 'Correction target no longer exists'; END IF;
    IF enabled THEN
      INSERT INTO public.scalev_financial_corrections
        (workspace_id,scalev_order_id,entity,line_key,field,original_amount,source_amount,corrected_amount,active)
      VALUES(p_workspace_id,p_order_id,e,k,f,src,src,amount,true)
      ON CONFLICT (workspace_id,scalev_order_id,entity,line_key,field)
        DO UPDATE SET corrected_amount=EXCLUDED.corrected_amount, active=true;
    ELSE
      UPDATE public.scalev_financial_corrections SET active=false
        WHERE workspace_id=p_workspace_id AND scalev_order_id=p_order_id AND entity=e AND line_key=k AND field=f
        RETURNING source_amount INTO amount;
      IF NOT FOUND THEN RAISE EXCEPTION 'No correction to deactivate'; END IF;
    END IF;
    IF row_id IS NOT NULL THEN
      previous_guard := current_setting('app.scalev_financial_projection',true);
      PERFORM set_config('app.scalev_financial_projection',t || ':' || row_id::text || ':' || f,true);
      EXECUTE format('UPDATE public.%I SET %I=$1 WHERE workspace_id=$2 AND id=$3',t,f)
        USING amount,p_workspace_id,row_id;
      PERFORM set_config('app.scalev_financial_projection',coalesce(previous_guard,''),true);
    END IF;
  END LOOP;
  UPDATE public.scalev_financial_correction_versions SET version=version+1
    WHERE workspace_id=p_workspace_id AND scalev_order_id=p_order_id RETURNING version INTO v;
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY entity,line_key,field),'[]') INTO after_rows
    FROM public.scalev_financial_corrections c WHERE workspace_id=p_workspace_id AND scalev_order_id=p_order_id;
  INSERT INTO public.scalev_financial_correction_audit
    (workspace_id,scalev_order_id,version,before_value,after_value,reason,changed_by)
    VALUES(p_workspace_id,p_order_id,v,before_rows,after_rows,btrim(p_reason),actor);
  INSERT INTO public.workspace_financial_revisions(workspace_id,revision) VALUES(p_workspace_id,1)
    ON CONFLICT(workspace_id) DO UPDATE SET revision=workspace_financial_revisions.revision+1;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.scalev_correction_field_allowed(text,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.lock_scalev_financial_corrections() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.project_scalev_financial_correction() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.guard_scalev_corrected_line_identity() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.set_scalev_financial_corrections(uuid,bigint,jsonb,text,bigint,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_scalev_financial_corrections(uuid,bigint,jsonb,text,bigint,uuid) TO authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
