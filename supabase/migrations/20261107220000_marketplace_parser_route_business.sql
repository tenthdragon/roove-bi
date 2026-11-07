-- Accept explicit per-route businesses. Existing v1 rows and audit history stay
-- untouched; the app resolves legacy references before an explicit user save.
BEGIN;
ALTER TABLE public.marketplace_parser_configs
  DROP CONSTRAINT marketplace_parser_configs_config_check,
  ADD CONSTRAINT marketplace_parser_configs_config_check
    CHECK (jsonb_typeof(config) = 'object' AND config->>'schemaVersion' IS NOT NULL
      AND config->>'schemaVersion' IN ('1', '2'));
COMMIT;
