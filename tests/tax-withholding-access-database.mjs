import { execFile, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';

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
const readOnlyGrantsMigration = read('../supabase/migrations/250_tax_master_read_only_grants.sql');

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
`));

  // Rehearse the upgrade against populated data, before the unique constraint
  // exists. The failed migration must preserve every row and even roll back
  // its preliminary blank-document normalization.
  psql(`INSERT INTO public.tax_counterparties(id, workspace_id, name, identity_type, identity_number)
    VALUES (900, '00000000-0000-4000-8000-000000000101', 'UPGRADE FIXTURE', 'unknown', 'UNKNOWN');`);
  for (const difference of ["applies_to=ARRAY['pph26']", 'rate_override=1.5', "valid_to=DATE '2026-12-31'", "notes='Different note'"]) {
    psql(`INSERT INTO public.tax_counterparty_facilities(id, workspace_id, counterparty_id, facility_code, document_number, applies_to, valid_from)
      VALUES (900, '00000000-0000-4000-8000-000000000101', 900, 'PP23', '', ARRAY['pph23'], DATE '2026-01-01'),
             (901, '00000000-0000-4000-8000-000000000101', 900, 'PP23', NULL, ARRAY['pph23'], DATE '2026-01-01');
      UPDATE public.tax_counterparty_facilities SET ${difference} WHERE id=901;`);
    const before = psql('SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM public.tax_counterparty_facilities f;');
    assert.throws(() => psql(facilityIdentityMigration), /Conflicting tax facility rows/);
    assert.equal(psql('SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM public.tax_counterparty_facilities f;'), before);
    assert.equal(psql("SELECT count(*) FROM pg_constraint WHERE conname='tax_counterparty_facilities_identity_key';").trim(), '0');
    psql('DELETE FROM public.tax_counterparty_facilities WHERE counterparty_id=900;');
  }
  psql(`INSERT INTO public.tax_counterparty_facilities(id, workspace_id, counterparty_id, facility_code, document_number, applies_to, valid_from, notes)
    VALUES (900, '00000000-0000-4000-8000-000000000101', 900, 'PP23', '', ARRAY['pph23'], DATE '2026-01-01', 'Same'),
           (901, '00000000-0000-4000-8000-000000000101', 900, 'PP23', NULL, ARRAY['pph23'], DATE '2026-01-01', 'Same'),
           (902, '00000000-0000-4000-8000-000000000101', 900, 'PP23', NULL, ARRAY['pph23'], DATE '2027-01-01', 'Renewal');`);
  psql(facilityIdentityMigration);
  assert.equal(psql('SELECT string_agg(id::text,\',\' ORDER BY id) FROM public.tax_counterparty_facilities;').trim(), '900,902');
  psql(facilityIdentityMigration);
  psql('DELETE FROM public.tax_counterparties WHERE id=900;');
  // Match Supabase's default grants: an earlier SELECT grant does not remove
  // INSERT/UPDATE/DELETE/TRUNCATE or direct sequence access.
  psql(`GRANT ALL ON public.tax_object_codes, public.tax_withholding_entities,
    public.tax_counterparties, public.tax_counterparty_facilities TO authenticated;
    GRANT ALL ON SEQUENCE public.tax_withholding_entities_id_seq,
    public.tax_counterparties_id_seq, public.tax_counterparty_facilities_id_seq TO authenticated;`);
  assert.equal(psql("SELECT has_table_privilege('authenticated','public.tax_counterparties','TRUNCATE');").trim(), 't');
  psql(readOnlyGrantsMigration);
  psql(readOnlyGrantsMigration);
  process.stdout.write(psql(`DO $$ DECLARE target regclass; BEGIN
    FOREACH target IN ARRAY ARRAY['public.tax_object_codes'::regclass,'public.tax_withholding_entities'::regclass,
      'public.tax_counterparties'::regclass,'public.tax_counterparty_facilities'::regclass] LOOP
      IF NOT has_table_privilege('authenticated',target,'SELECT')
        OR has_table_privilege('authenticated',target,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_table_privilege('anon',target,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
        OR NOT has_table_privilege('service_role',target,'INSERT,UPDATE,DELETE')
      THEN RAISE EXCEPTION 'Unexpected tax table grants: %', target; END IF;
    END LOOP;
    FOREACH target IN ARRAY ARRAY['public.tax_withholding_entities_id_seq'::regclass,
      'public.tax_counterparties_id_seq'::regclass,'public.tax_counterparty_facilities_id_seq'::regclass] LOOP
      IF has_sequence_privilege('authenticated',target,'USAGE,SELECT,UPDATE')
        OR has_sequence_privilege('anon',target,'USAGE,SELECT,UPDATE')
        OR NOT has_sequence_privilege('service_role',target,'USAGE')
      THEN RAISE EXCEPTION 'Unexpected tax sequence grants: %', target; END IF;
    END LOOP;
  END $$;
  SELECT 'PASS: inherited Supabase write and truncate grants removed; service-role writes retained';`));
  process.stdout.write('PASS: populated upgrade preserves conflicts and collapses only equivalent payloads\n');
  process.stdout.write(psql(read('./tax-withholding-access-db.sql')));

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
