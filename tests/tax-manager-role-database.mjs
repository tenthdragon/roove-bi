import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Use a disposable database, never the shared local sample or production.
const database = `tax_manager_test_${randomBytes(6).toString('hex')}`;
const container = process.argv.includes('--ci') ? 'roove-access-requests-test' : 'supabase_db_roove-bi-local';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const docker = (command, args, input) => execFileSync('docker', [
  'exec', '-i', container, 'sh', '-c',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'tax-manager-test',
  command, '-U', 'supabase_admin', ...args,
], { input, encoding: 'utf8' });
const sql = input => docker('psql', ['-d', database, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], input);
const migration = read('../supabase/migrations/20261120043010_tax_manager_role.sql');
const accessMigration = read('../supabase/migrations/221_workspace_access_requests.sql');
const fixture = read('workspace-access-requests-db.sql');
const foundation = read('../supabase/migrations/163_workspace_foundation.sql');
const ownerHelper = foundation.match(/CREATE OR REPLACE FUNCTION public\.is_platform_owner\([\s\S]*?\$\$;/)?.[0];
assert.ok(ownerHelper);

docker('createdb', [database]);
try {
  // Also replay all existing approval/rejection assertions against the updated
  // function, to catch changes to its locks, owner guards or legacy handling.
  process.stdout.write(sql(fixture.replace('-- MIGRATION', () => `${accessMigration}
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.role_permissions (role text, permission_key text, PRIMARY KEY(role, permission_key));
CREATE TABLE public.workspace_role_permissions (
  workspace_id uuid REFERENCES public.workspaces(id), role text, permission_key text,
  PRIMARY KEY(workspace_id, role, permission_key)
);
INSERT INTO public.role_permissions VALUES ('brand_manager', 'tab:marketing');
INSERT INTO public.workspace_role_permissions SELECT id, 'brand_manager', 'tab:marketing' FROM public.workspaces;
${migration}
${migration}
`)));
  process.stdout.write(sql(`
DROP FUNCTION public.is_platform_owner();
${ownerHelper}
CREATE TABLE public.tax_withholding_entities (id int, workspace_id uuid);
CREATE TABLE public.tax_counterparties (id int, workspace_id uuid);
CREATE TABLE public.tax_counterparty_facilities (id int, workspace_id uuid);
ALTER TABLE public.tax_withholding_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_counterparties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tax_counterparty_facilities ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.tax_withholding_entities, public.tax_counterparties, public.tax_counterparty_facilities TO authenticated;
${read('../supabase/migrations/248_tax_withholding_read_access.sql')}
INSERT INTO public.tax_counterparties VALUES (1, '00000000-0000-4000-8000-000000000101'), (2, '00000000-0000-4000-8000-000000000102');
INSERT INTO public.profiles(id, role) VALUES
  ('00000000-0000-4000-8000-000000000011', 'pending'),
  ('00000000-0000-4000-8000-000000000012', 'pending');
INSERT INTO public.workspace_memberships(workspace_id, user_id, role, status)
VALUES ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000011', 'pending', 'invited');
DO $$ BEGIN
 IF (SELECT array_agg(permission_key) FROM public.role_permissions WHERE role='tax_manager') IS DISTINCT FROM ARRAY['tab:tax-withholding']::text[]
 OR EXISTS (SELECT w.id FROM public.workspaces w LEFT JOIN public.workspace_role_permissions p ON p.workspace_id=w.id AND p.role='tax_manager'
   GROUP BY w.id HAVING count(p.permission_key)<>1 OR min(p.permission_key)<>'tab:tax-withholding') THEN
  RAISE EXCEPTION 'Tax Manager must receive only the tax page in the template and each workspace'; END IF;
 IF (SELECT count(*) FROM public.workspace_role_permissions WHERE role='brand_manager' AND permission_key='tab:marketing')<>2
 OR NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role='brand_manager' AND permission_key='tab:marketing') THEN
  RAISE EXCEPTION 'Existing role permissions changed'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000011','set_role','tax_manager');
SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000012','invite','tax_manager');
SELECT public.expect_access_error($q$SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000003','set_role','tax_manager')$q$,'Hanya owner');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',false);
SELECT public.expect_access_error($q$SELECT public.manage_workspace_user_access('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000012','set_role','workspace_owner')$q$,'Hanya owner');
DO $$ BEGIN
 IF (SELECT array_agg(id) FROM public.tax_counterparties) IS DISTINCT FROM ARRAY[1] THEN
  RAISE EXCEPTION 'Tax Manager must see only its workspace tax data'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.profiles WHERE id IN ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012')
   AND role::text='tax_manager' AND active_workspace_id='00000000-0000-4000-8000-000000000101')<>2 THEN
  RAISE EXCEPTION 'Tax Manager approval/invitation did not clear the pending login gate'; END IF;
 IF has_function_privilege('anon','public.manage_workspace_user_access(uuid,uuid,text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'Anonymous role assignment allowed'; END IF;
END $$;
DELETE FROM public.workspace_role_permissions WHERE workspace_id='00000000-0000-4000-8000-000000000101' AND role='tax_manager';
SET ROLE authenticated;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.tax_counterparties) THEN RAISE EXCEPTION 'Revoked Tax Manager still reads tax data'; END IF;
END $$;
RESET ROLE;
INSERT INTO public.workspace_role_permissions VALUES ('00000000-0000-4000-8000-000000000101','tax_manager','tab:tax-withholding');
UPDATE public.workspace_memberships SET status='suspended' WHERE user_id='00000000-0000-4000-8000-000000000011';
SET ROLE authenticated;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.tax_counterparties) THEN RAISE EXCEPTION 'Suspended Tax Manager still reads tax data'; END IF;
END $$;
RESET ROLE;
SELECT 'PASS: Tax Manager enum, default grants, approval, invitation, owner restrictions, tenant isolation, revocation, suspension and repeat migration';
`));
} finally {
  docker('dropdb', ['--if-exists', database]);
}
