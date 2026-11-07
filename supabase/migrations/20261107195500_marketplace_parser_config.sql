-- Parser configuration only. Does not insert/update orders or contact Scalev.
BEGIN;
CREATE TABLE public.marketplace_parser_configs (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object' AND config->>'schemaVersion' = '1'),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.marketplace_parser_config_history (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  config jsonb NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, revision)
);
ALTER TABLE public.marketplace_parser_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_parser_config_history ENABLE ROW LEVEL SECURITY;
-- All access goes through server actions, authorized for the active workspace
-- and Sales Channel permission before using the service role. No client policies.
REVOKE ALL ON public.marketplace_parser_configs, public.marketplace_parser_config_history FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.marketplace_parser_configs TO service_role;
GRANT SELECT, INSERT ON public.marketplace_parser_config_history TO service_role;
CREATE FUNCTION public.audit_marketplace_parser_config() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.workspace_id <> OLD.workspace_id OR NEW.revision <> OLD.revision + 1) THEN
    RAISE EXCEPTION 'Parser configuration revision must increment by one';
  END IF;
  INSERT INTO public.marketplace_parser_config_history(workspace_id,revision,config,changed_by)
  VALUES (NEW.workspace_id,NEW.revision,NEW.config,NEW.updated_by);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_marketplace_parser_config() FROM PUBLIC;
CREATE TRIGGER marketplace_parser_config_audit AFTER INSERT OR UPDATE ON public.marketplace_parser_configs
FOR EACH ROW EXECUTE FUNCTION public.audit_marketplace_parser_config();
COMMENT ON TABLE public.marketplace_parser_configs IS 'Workspace-scoped, versioned configuration for XLSX to Scalev CSV; independent of legacy intake.';
COMMIT;
