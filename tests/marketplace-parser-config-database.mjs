import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Exercise the parser's migrations in a disposable database, never in the
// shared local snapshot. No historical migration directory is replayed.
const database = `parser_config_test_${randomBytes(6).toString('hex')}`;
const serviceActor = `${database}_service`;
const container = process.argv.includes('--ci') ? 'roove-access-requests-test' : 'supabase_db_roove-bi-local';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const docker = (command, args, input) => execFileSync('docker', [
  'exec', '-i', container, 'sh', '-c',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'parser-config-test',
  command, '-U', 'supabase_admin', ...args,
], { input, encoding: 'utf8' });

docker('createdb', [database]);
try {
  // Plain PostgreSQL CI creates service_role without Supabase's BYPASSRLS.
  // Model the production service actor with an isolated, non-login role that
  // inherits the real migration grants; never alter a shared role's attributes.
  docker('psql', ['-d', database, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'],
    `CREATE ROLE ${serviceActor} NOLOGIN INHERIT BYPASSRLS; GRANT service_role TO ${serviceActor};`);
  process.stdout.write(docker('psql', ['-d', database, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], `
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.workspaces (id uuid PRIMARY KEY);
CREATE TABLE public.scalev_store_channels (id integer PRIMARY KEY);
CREATE TABLE public.scalev_webhook_businesses (id integer PRIMARY KEY);
CREATE TABLE public.scalev_catalog_bundles (workspace_id uuid,business_id integer,custom_id text);
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
INSERT INTO public.scalev_catalog_bundles VALUES ('00000000-0000-0000-0000-000000000001',4,'EXISTING');
${read('../supabase/migrations/20261110120000_parser_cached_diagnosis.sql')}
DO $$
DECLARE key_a text := repeat('a',64); key_b text := repeat('b',64); first_delay float8; second_delay float8; old_next timestamptz;
BEGIN
  IF (SELECT price_options IS NOT NULL OR scalev_owner_uid IS NOT NULL FROM public.scalev_catalog_bundles) THEN
    RAISE EXCEPTION 'Legacy metadata must remain unknown, not fabricated';
  END IF;
  BEGIN
    UPDATE public.scalev_catalog_bundles SET price_options='{}';
    RAISE EXCEPTION 'Non-array options accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  IF has_table_privilege('authenticated','public.scalev_api_request_budget','SELECT')
    OR has_table_privilege('anon','public.scalev_api_request_budget','INSERT')
    OR has_function_privilege('authenticated','public.reserve_scalev_api_request(text,timestamptz,boolean)','EXECUTE')
    OR has_function_privilege('anon','public.reserve_scalev_api_request(text,timestamptz,boolean)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.reserve_scalev_api_request(text,timestamptz,boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'Request budget is not service-only';
  END IF;
  BEGIN
    PERFORM public.reserve_scalev_api_request('raw-key-must-not-be-saved');
    RAISE EXCEPTION 'Invalid hash accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Invalid credential hash' THEN RAISE; END IF;
  END;
  first_delay := public.reserve_scalev_api_request(key_a);
  second_delay := public.reserve_scalev_api_request(key_a);
  IF first_delay > 5 OR second_delay < 200 OR second_delay > 251 THEN RAISE EXCEPTION 'Requests are not spaced by credential: %, %',first_delay,second_delay; END IF;
  IF public.reserve_scalev_api_request(key_b) > 5 THEN RAISE EXCEPTION 'Independent key incorrectly delayed'; END IF;
  IF public.reserve_scalev_api_request(key_a,NULL,true) <> 0 THEN RAISE EXCEPTION 'Cooldown check consumed/awaited a slot'; END IF;
  PERFORM public.reserve_scalev_api_request(key_a,clock_timestamp()+interval '60 seconds');
  SELECT next_at INTO old_next FROM public.scalev_api_request_budget WHERE key_hash=key_a;
  IF public.reserve_scalev_api_request(key_a) < 59000
    OR public.reserve_scalev_api_request(key_a,NULL,true) < 59000 THEN RAISE EXCEPTION 'Shared cooldown ignored'; END IF;
  IF (SELECT next_at FROM public.scalev_api_request_budget WHERE key_hash=key_a) IS DISTINCT FROM old_next THEN RAISE EXCEPTION 'Long cooldown accumulated another reservation'; END IF;
  PERFORM public.reserve_scalev_api_request(key_a,clock_timestamp()+interval '1 second');
  IF public.reserve_scalev_api_request(key_a,NULL,true) < 59000 THEN RAISE EXCEPTION 'Cooldown was shortened by another caller'; END IF;
END $$;
SELECT 'PASS: legacy metadata retained, service-only shared request budget, staggered credentials and monotonic cooldown';
CREATE SCHEMA storage;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint);
CREATE TABLE storage.objects(id integer PRIMARY KEY,bucket_id text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated,anon,service_role;
GRANT SELECT,INSERT ON storage.objects TO authenticated,anon;
CREATE POLICY existing_broad_policy ON storage.objects FOR ALL TO authenticated,anon USING(true) WITH CHECK(true);
${read('../supabase/migrations/20261111074823_marketplace_parser_archive_routing.sql')}
INSERT INTO storage.objects VALUES(1,'marketplace-parser-archive'),(2,'unrelated');
SET ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='marketplace-parser-archive') THEN RAISE EXCEPTION 'Archive exposed through broad Storage policy'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='unrelated') THEN RAISE EXCEPTION 'Unrelated Storage behavior changed'; END IF;
 IF has_table_privilege('authenticated','marketplace_parser_batches','SELECT') OR has_table_privilege('anon','marketplace_parser_route_decisions','INSERT') THEN RAISE EXCEPTION 'Archive exposed to client'; END IF;
END $$;
RESET ROLE;
SET ROLE ${serviceActor};
INSERT INTO public.marketplace_parser_batches(id,workspace_id,account_id,business_code,account_snapshot,filename,source_path,source_sha256,byte_size,batch_date,parsed_file,order_count,created_by,actor_name)
VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000001','account','RTI','{}','source.xlsx','scope/source.xlsx',repeat('a',64),100,'2026-11-11','{}',1,'00000000-0000-4000-8000-000000000002','Tester');
INSERT INTO public.marketplace_parser_route_decisions(id,workspace_id,account_id,business_code,case_key,case_hash,items,store_id,store_name,revision,source_batch_id,source_order_key,created_by,actor_name)
VALUES('00000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000001','account','RTI','[[1,"SKU",1]]',repeat('b',64),'[{}]',1,'Store',1,'00000000-0000-4000-8000-000000000001','order','00000000-0000-4000-8000-000000000002','Tester');
DO $$ BEGIN
 BEGIN UPDATE public.marketplace_parser_batches SET filename='changed'; RAISE EXCEPTION 'Source is mutable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.marketplace_parser_batches; RAISE EXCEPTION 'Source deletable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.marketplace_parser_route_decisions SET store_id=1; RAISE EXCEPTION 'Decisions mutable'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.marketplace_parser_route_decisions SELECT '00000000-0000-4000-8000-000000000004'::uuid,workspace_id,account_id,business_code,case_key,case_hash,items,store_id,store_name,revision,source_batch_id,source_order_key,created_by,actor_name,created_at FROM public.marketplace_parser_route_decisions; RAISE EXCEPTION 'Concurrent decision overwrote history'; EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS: immutable source/export/decision grants, concurrent decision protection and private Storage under broad policies';

`));
} finally {
  docker('dropdb', ['--if-exists', database]);
  docker('psql', ['-d', 'postgres', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], `DROP ROLE IF EXISTS ${serviceActor};`);
}
