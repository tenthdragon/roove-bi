-- Version 3 fixes Business on the source account and routes only within selected
-- Stores. Existing configuration/history is retained until an explicit team save.
BEGIN;
ALTER TABLE public.marketplace_parser_configs
  DROP CONSTRAINT marketplace_parser_configs_config_check,
  ADD CONSTRAINT marketplace_parser_configs_config_check CHECK (
    jsonb_typeof(config) = 'object' AND config->>'schemaVersion' IS NOT NULL
    AND config->>'schemaVersion' IN ('1','2','3')
  );
CREATE TABLE public.marketplace_parser_store_syncs (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  store_id integer NOT NULL REFERENCES public.scalev_store_channels(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('syncing','ready','failed')),
  synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  bundle_count integer NOT NULL DEFAULT 0 CHECK (bundle_count >= 0),
  PRIMARY KEY (workspace_id,store_id)
);
ALTER TABLE public.marketplace_parser_store_syncs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketplace_parser_store_syncs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.marketplace_parser_store_syncs TO service_role;
CREATE INDEX IF NOT EXISTS idx_parser_store_bundle_availability
  ON public.scalev_catalog_bundle_store_links(workspace_id,business_id,store_name,scalev_bundle_id)
  WHERE is_available;
COMMENT ON TABLE public.marketplace_parser_store_syncs IS 'Completion state for explicit per-Store catalog refresh; zero-bundle Stores are recorded too.';
COMMIT;
