BEGIN;

CREATE TABLE public.workspace_advertiser_parser_access (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  FOREIGN KEY (workspace_id, user_id)
    REFERENCES public.workspace_memberships(workspace_id, user_id) ON DELETE CASCADE
);
ALTER TABLE public.workspace_advertiser_parser_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_advertiser_parser_access FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workspace_advertiser_parser_access TO service_role;
GRANT SELECT ON public.workspace_advertiser_parser_access TO authenticated;
CREATE POLICY advertiser_parser_access_self ON public.workspace_advertiser_parser_access
FOR SELECT TO authenticated USING (
  user_id = (SELECT auth.uid())
  AND public.workspace_has_role(workspace_id, ARRAY['advertiser'])
);

CREATE TABLE public.workspace_advertiser_parser_access_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  enabled boolean NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_advertiser_parser_access_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_advertiser_parser_access_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.workspace_advertiser_parser_access_audit TO service_role;

CREATE FUNCTION public.audit_advertiser_parser_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.workspace_advertiser_parser_access_audit
    (workspace_id, user_id, enabled, changed_by)
  VALUES (
    CASE WHEN TG_OP = 'INSERT' THEN NEW.workspace_id ELSE OLD.workspace_id END,
    CASE WHEN TG_OP = 'INSERT' THEN NEW.user_id ELSE OLD.user_id END,
    TG_OP = 'INSERT', auth.uid()
  );
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.audit_advertiser_parser_access() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_advertiser_parser_access
AFTER INSERT OR DELETE ON public.workspace_advertiser_parser_access
FOR EACH ROW EXECUTE FUNCTION public.audit_advertiser_parser_access();

CREATE FUNCTION public.set_workspace_advertiser_parser_access(
  p_workspace_id uuid, p_user_id uuid, p_enabled boolean
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.workspace_has_role(p_workspace_id, ARRAY['workspace_owner']) THEN
    RAISE EXCEPTION 'Hanya owner workspace yang dapat mengatur akses MP Data Parser.';
  END IF;
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'Pilihan akses tidak valid.'; END IF;

  -- Serialize with membership changes and the other per-advertiser controls.
  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  PERFORM 1 FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id AND user_id = p_user_id
      AND role = 'advertiser' AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Advertiser tidak aktif di workspace ini.'; END IF;

  IF p_enabled THEN
    INSERT INTO public.workspace_advertiser_parser_access (workspace_id, user_id, created_by)
    VALUES (p_workspace_id, p_user_id, auth.uid()) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.workspace_advertiser_parser_access
    WHERE workspace_id = p_workspace_id AND user_id = p_user_id;
  END IF;
  RETURN p_enabled;
END $$;
REVOKE ALL ON FUNCTION public.set_workspace_advertiser_parser_access(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_workspace_advertiser_parser_access(uuid, uuid, boolean) TO authenticated;

CREATE FUNCTION public.clear_advertiser_parser_access() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role OR OLD.status IS DISTINCT FROM NEW.status THEN
    DELETE FROM public.workspace_advertiser_parser_access
    WHERE workspace_id = OLD.workspace_id AND user_id = OLD.user_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clear_advertiser_parser_access() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER clear_advertiser_parser_access
AFTER UPDATE OF role, status ON public.workspace_memberships
FOR EACH ROW EXECUTE FUNCTION public.clear_advertiser_parser_access();

NOTIFY pgrst, 'reload schema';
COMMIT;
