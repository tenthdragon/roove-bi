import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Exercise the parser's migrations in a disposable database, never in the
// shared local snapshot. No historical migration directory is replayed.
const database = `parser_config_test_${randomBytes(6).toString('hex')}`;
const container = process.argv.includes('--ci') ? 'roove-access-requests-test' : 'supabase_db_roove-bi-local';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const docker = (command, args, input) => execFileSync('docker', [
  'exec', '-i', container, 'sh', '-c',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'parser-config-test',
  command, '-U', 'supabase_admin', ...args,
], { input, encoding: 'utf8' });

docker('createdb', [database]);
try {
  process.stdout.write(docker('psql', ['-d', database, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], `
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.workspaces (id uuid PRIMARY KEY);
CREATE TABLE public.scalev_store_channels (id integer PRIMARY KEY);
CREATE TABLE public.scalev_catalog_bundle_store_links (workspace_id uuid,business_id integer,store_name text,scalev_bundle_id integer,is_available boolean);
INSERT INTO public.workspaces VALUES ('00000000-0000-0000-0000-000000000001');
${read('../supabase/migrations/20261107195500_marketplace_parser_config.sql')}
INSERT INTO public.marketplace_parser_configs(workspace_id,revision,config)
VALUES ('00000000-0000-0000-0000-000000000001',1,
  '{"schemaVersion":1,"rooveBusiness":"RTI","lazadaBusiness":"RLT","routes":[{"business":"$roove"}]}');
${read('../supabase/migrations/20261107220000_marketplace_parser_route_business.sql')}
DO $$
DECLARE original jsonb; affected integer;
BEGIN
  SELECT config INTO original FROM public.marketplace_parser_config_history WHERE revision=1;
  IF (SELECT config FROM public.marketplace_parser_configs) IS DISTINCT FROM original
    OR (SELECT revision FROM public.marketplace_parser_configs) <> 1
    OR (SELECT count(*) FROM public.marketplace_parser_config_history) <> 1 THEN
    RAISE EXCEPTION 'Migration changed existing configuration or history';
  END IF;
  UPDATE public.marketplace_parser_configs SET revision=2,
    config='{"schemaVersion":2,"routes":[{"business":"RTI"}]}' WHERE revision=1;
  IF (SELECT count(*) FROM public.marketplace_parser_config_history) <> 2
    OR (SELECT config FROM public.marketplace_parser_config_history WHERE revision=1) IS DISTINCT FROM original
    OR (SELECT config->>'schemaVersion' FROM public.marketplace_parser_config_history WHERE revision=2) <> '2' THEN
    RAISE EXCEPTION 'Saving version 2 did not retain version 1 history';
  END IF;
  UPDATE public.marketplace_parser_configs SET revision=2 WHERE revision=1;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Stale revision overwrote the current configuration'; END IF;
  BEGIN
    UPDATE public.marketplace_parser_configs SET revision=3,config='{"schemaVersion":99}';
    RAISE EXCEPTION 'Unsupported schema version accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.marketplace_parser_configs SET revision=3,config='{}';
    RAISE EXCEPTION 'Missing schema version accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN ('public.marketplace_parser_configs'::regclass,'public.marketplace_parser_config_history'::regclass) AND NOT relrowsecurity)
    OR has_table_privilege('authenticated','public.marketplace_parser_configs','SELECT')
    OR has_table_privilege('anon','public.marketplace_parser_configs','INSERT') THEN
    RAISE EXCEPTION 'Configuration access restrictions changed';
  END IF;
END $$;
${read('../supabase/migrations/20261109220000_marketplace_parser_account_stores.sql')}
DO $$
BEGIN
  IF (SELECT count(*) FROM public.marketplace_parser_config_history) <> 2 THEN RAISE EXCEPTION 'v3 migration changed history'; END IF;
  UPDATE public.marketplace_parser_configs SET revision=3,config='{"schemaVersion":3,"accounts":[],"stores":[]}';
  IF (SELECT count(*) FROM public.marketplace_parser_config_history) <> 3 THEN RAISE EXCEPTION 'v3 save not audited'; END IF;
  IF has_table_privilege('authenticated','public.marketplace_parser_store_syncs','SELECT') OR has_table_privilege('anon','public.marketplace_parser_store_syncs','INSERT') THEN RAISE EXCEPTION 'Sync metadata exposed'; END IF;
  INSERT INTO public.scalev_store_channels VALUES (1);
  INSERT INTO public.marketplace_parser_store_syncs(workspace_id,store_id,status,bundle_count) VALUES ('00000000-0000-0000-0000-000000000001',1,'ready',0);
  BEGIN
    UPDATE public.marketplace_parser_store_syncs SET status='unknown';
    RAISE EXCEPTION 'Invalid sync state accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT 'PASS: v1/v2 history preserved, v3 save audited, sync metadata protected, empty Store sync recorded';
`));
} finally {
  docker('dropdb', ['--if-exists', database]);
}
