import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

// Migrations 247, 248 and 249 run in a disposable database with the minimal
// workspace foundation they depend on. Direct reads then run as `authenticated`
// users with a JWT subject, exactly as PostgREST would issue them, and two
// concurrent imports race on the facility identity constraint. The shared
// local sample database is never touched.
const database = `tax_withholding_access_test_${randomBytes(6).toString('hex')}`;
const container = process.argv.includes('--ci') ? 'roove-access-requests-test' : 'supabase_db_roove-bi-local';
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const dockerArgs = (command, args) => [
  'exec', '-i', container, 'sh', '-c',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'tax-withholding-access-test',
  command, '-U', 'supabase_admin', ...args,
];
const docker = (command, args, input) => execFileSync('docker', dockerArgs(command, args), { input, encoding: 'utf8' });
const dockerAsync = promisify(execFile);
const psql = (input) => docker('psql', ['-d', database, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input);
const psqlAsync = async (input) => {
  const child = dockerAsync('docker', dockerArgs('psql', ['-d', database, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1']), { encoding: 'utf8' });
  child.child.stdin.end(input);
  return (await child).stdout;
};
const foundation = read('../supabase/migrations/163_workspace_foundation.sql');
const definition = (source, pattern) => {
  const match = source.match(pattern);
  if (!match) throw new Error(`Missing dependency: ${pattern}`);
  return match[0];
};
const roleHelpers = ['is_platform_owner', 'workspace_has_membership', 'workspace_can_access'].map((name) =>
  definition(foundation, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`))).join('\n');
const masterMigration = read('../supabase/migrations/247_tax_withholding.sql');
const readAccessMigration = read('../supabase/migrations/248_tax_withholding_read_access.sql');
const facilityIdentityMigration = read('../supabase/migrations/249_tax_facility_identity.sql');

// Two imports insert the same certificate at the same time; the constraint must
// leave exactly one row and neither side may fail.
const concurrentFacilityInsert = `
BEGIN;
INSERT INTO public.tax_counterparty_facilities (workspace_id, counterparty_id, facility_code, document_number, applies_to, valid_from)
VALUES ('00000000-0000-4000-8000-000000000101', 2, 'PP23', 'KET-RACE/2026', ARRAY['pph23'], DATE '2026-01-01')
ON CONFLICT (counterparty_id, facility_code, document_number, valid_from) DO NOTHING;
SELECT pg_sleep(0.4);
COMMIT;
`;

docker('createdb', [database]);
try {
  process.stdout.write(psql(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated, anon;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text NOT NULL);
CREATE TABLE public.workspaces (id uuid PRIMARY KEY, slug text);
CREATE TABLE public.workspace_memberships (
  workspace_id uuid, user_id uuid, role text, status text NOT NULL DEFAULT 'active',
  PRIMARY KEY(workspace_id, user_id)
);
CREATE TABLE public.role_permissions (role text, permission_key text, PRIMARY KEY(role, permission_key));
CREATE TABLE public.workspace_role_permissions (
  workspace_id uuid REFERENCES public.workspaces(id), role text, permission_key text,
  PRIMARY KEY(workspace_id, role, permission_key)
);
CREATE TABLE public.scalev_webhook_businesses (
  id serial, workspace_id uuid NOT NULL, business_code text, UNIQUE(workspace_id, id)
);
CREATE FUNCTION public.set_workspace_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
${roleHelpers}
INSERT INTO public.workspaces (id, slug) VALUES
  ('00000000-0000-4000-8000-000000000101', 'alpha'),
  ('00000000-0000-4000-8000-000000000102', 'beta');
${masterMigration}
${masterMigration}
${readAccessMigration}
${readAccessMigration}
${facilityIdentityMigration}
${facilityIdentityMigration}
${read('./tax-withholding-access-db.sql')}
`));

  await Promise.all([psqlAsync(concurrentFacilityInsert), psqlAsync(concurrentFacilityInsert)]);
  process.stdout.write(psql(`
DO $$ BEGIN
  IF (SELECT count(*) FROM public.tax_counterparty_facilities WHERE document_number = 'KET-RACE/2026') <> 1 THEN
    RAISE EXCEPTION 'Concurrent imports created duplicate facility rows';
  END IF;
END $$;
SELECT 'PASS: concurrent facility imports collapse to one row';
`));
} finally {
  docker('dropdb', ['--if-exists', database]);
}
