import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Only migration 243 runs, in a disposable database with minimal dependencies.
// The shared local sample, its schema, and existing spend are never changed.
const database = `manual_spend_access_test_${randomBytes(6).toString('hex')}`;
const container = process.argv.includes('--ci') ? 'roove-access-requests-test' : 'supabase_db_roove-bi-local';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const docker = (command, args, input) => execFileSync('docker', [
  'exec', '-i', container, 'sh', '-c',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'manual-spend-access-test',
  command, '-U', 'supabase_admin', ...args,
], { input, encoding: 'utf8' });
const foundation = read('../supabase/migrations/163_workspace_foundation.sql');
const initial = read('../supabase/migrations/239_manual_marketplace_ad_spend.sql');
const definition = (source, pattern) => {
  const match = source.match(pattern);
  if (!match) throw new Error(`Missing dependency: ${pattern}`);
  return match[0];
};
const roleHelpers = ['is_platform_owner', 'workspace_has_role'].map(name =>
  definition(foundation, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`))).join('\n');
const tables = ['manual_marketplace_ad_spend_cutovers', 'workspace_advertiser_spend_access', 'manual_marketplace_ad_spend'].map(name =>
  definition(initial, new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))).join('\n');
const brandAssignments = definition(read('../supabase/migrations/224_advertiser_brand_access.sql'), /CREATE TABLE public\.workspace_advertiser_brands \([\s\S]*?\n\);/);
const migration = read('../supabase/migrations/243_manual_marketplace_spend_brand_scope.sql');

docker('createdb', [database]);
try {
  process.stdout.write(docker('psql', ['-d', database, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], `
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
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role text NOT NULL);
CREATE TABLE public.workspaces (id uuid PRIMARY KEY);
CREATE TABLE public.workspace_memberships (
  workspace_id uuid, user_id uuid, role text, status text,
  PRIMARY KEY(workspace_id, user_id)
);
CREATE TABLE public.brands (
  id integer, workspace_id uuid, is_active boolean, PRIMARY KEY(workspace_id, id)
);
${tables}
${brandAssignments}
${roleHelpers}
${migration}
${migration}
${read('./manual-marketplace-spend-access-db.sql')}
${read('./manual-marketplace-spend-brand-scope-db.sql')}
`));
} finally {
  docker('dropdb', ['--if-exists', database]);
}
