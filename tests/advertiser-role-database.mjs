import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

// Validate only the reviewed migration in an empty, disposable database.
// Never apply schema changes to the shared local sample or replay history.
const database = `advertiser_test_${randomBytes(6).toString('hex')}`;
const docker = (command, args, input) => execFileSync('docker', [
  'exec', '-i', 'supabase_db_roove-bi-local', 'sh', '-c',
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'advertiser-role-test',
  command, '-U', 'supabase_admin', ...args,
], { input, encoding: 'utf8' });
const migration = readFileSync(new URL('../supabase/migrations/220_advertiser_role.sql', import.meta.url), 'utf8');

docker('createdb', [database]);
try {
  process.stdout.write(docker('psql', ['-d', database, '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], `
CREATE TYPE public.user_role AS ENUM ('owner', 'pending', 'brand_manager');
CREATE TABLE public.profiles (id uuid PRIMARY KEY, role public.user_role NOT NULL);
CREATE TABLE public.workspaces (id uuid PRIMARY KEY);
CREATE TABLE public.role_permissions (role text, permission_key text, PRIMARY KEY(role, permission_key));
CREATE TABLE public.workspace_role_permissions (
  workspace_id uuid REFERENCES public.workspaces(id), role text, permission_key text,
  PRIMARY KEY(workspace_id, role, permission_key)
);
INSERT INTO public.workspaces VALUES
  ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
INSERT INTO public.role_permissions VALUES ('brand_manager','tab:marketing');
INSERT INTO public.workspace_role_permissions
  SELECT id, 'brand_manager', 'tab:marketing' FROM public.workspaces;
${migration}
${migration}
INSERT INTO public.profiles VALUES ('00000000-0000-4000-8000-000000000003', 'advertiser');
DO $$ BEGIN
  IF (SELECT array_agg(permission_key) FROM public.role_permissions WHERE role='advertiser')
    IS DISTINCT FROM ARRAY['tab:meta-funnels']::text[] THEN
    RAISE EXCEPTION 'Advertiser global template grants incorrect permissions';
  END IF;
  IF EXISTS (
    SELECT w.id FROM public.workspaces w
    LEFT JOIN public.workspace_role_permissions p ON p.workspace_id=w.id AND p.role='advertiser'
    GROUP BY w.id HAVING count(p.permission_key)<>1 OR min(p.permission_key)<>'tab:meta-funnels'
  ) THEN RAISE EXCEPTION 'Every workspace must grant exactly Meta Ads'; END IF;
  IF (SELECT count(*) FROM public.workspace_role_permissions WHERE role='brand_manager' AND permission_key='tab:marketing')<>2
    OR NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role='brand_manager' AND permission_key='tab:marketing') THEN
    RAISE EXCEPTION 'Existing permissions changed';
  END IF;
END $$;
SELECT 'PASS: advertiser profile enum, narrow global/workspace grants, existing roles and repeat execution';
`));
} finally {
  docker('dropdb', ['--if-exists', database]);
}
