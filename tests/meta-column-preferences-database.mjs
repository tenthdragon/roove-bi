// Only the fixed local database is supported. All test schema/data rolls back.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const query = input => execFileSync('docker', ['exec', '-i', 'supabase_db_roove-bi-local', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input, encoding: 'utf8' });
assert.equal(query("SELECT to_regnamespace('roove_local') IS NOT NULL;").trim(), 't');
const exists = () => query("SELECT to_regclass('public.meta_funnel_column_preferences') IS NOT NULL;").trim() === 't';
const beforeExists = exists(), before = beforeExists ? query('SELECT count(*) FROM meta_funnel_column_preferences;') : null;
const migration = beforeExists ? '' : readFileSync(new URL('../supabase/migrations/225_meta_funnel_column_preferences.sql', import.meta.url), 'utf8').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const sql = `
CREATE TEMP TABLE column_scope AS SELECT (SELECT id FROM auth.users ORDER BY id LIMIT 1) a,
 (SELECT id FROM auth.users ORDER BY id LIMIT 1 OFFSET 1) b, gen_random_uuid() fa, gen_random_uuid() fb,
 (SELECT id FROM workspaces ORDER BY id LIMIT 1) workspace_id;
INSERT INTO meta_ad_funnels(id,workspace_id,config,created_by)
SELECT fa,workspace_id,'{}'::jsonb,a FROM column_scope UNION ALL SELECT fb,workspace_id,'{}'::jsonb,a FROM column_scope;
INSERT INTO meta_funnel_column_preferences(user_id,funnel_id,column_order,hidden_columns)
SELECT a,fa,ARRAY['funnel','metric:spent'],ARRAY['metric:spent'] FROM column_scope
UNION ALL SELECT b,fa,ARRAY['metric:spent','funnel'],ARRAY['funnel'] FROM column_scope
UNION ALL SELECT a,fb,ARRAY['metric:spent','funnel'],ARRAY['funnel'] FROM column_scope;
DO $$ BEGIN
 IF (SELECT count(*) FROM meta_funnel_column_preferences p JOIN column_scope s ON p.funnel_id IN(s.fa,s.fb)) <> 3 THEN RAISE EXCEPTION 'User/template isolation failed'; END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.meta_funnel_column_preferences'::regclass) THEN RAISE EXCEPTION 'RLS disabled'; END IF;
 IF has_table_privilege('authenticated','public.meta_funnel_column_preferences','SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('anon','public.meta_funnel_column_preferences','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Private preferences exposed'; END IF;
 IF NOT has_table_privilege('service_role','public.meta_funnel_column_preferences','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Server cannot persist preferences'; END IF;
 BEGIN
  UPDATE meta_funnel_column_preferences SET hidden_columns=ARRAY['metric:unknown'] WHERE funnel_id=(SELECT fa FROM column_scope);
  RAISE EXCEPTION 'Invalid hidden column accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM count(*) FROM public.meta_funnel_column_preferences; RAISE EXCEPTION 'Browser bypassed server access checks';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DELETE FROM meta_funnel_column_preferences WHERE user_id=(SELECT a FROM column_scope) AND funnel_id=(SELECT fa FROM column_scope);
DO $$ BEGIN
 IF (SELECT count(*) FROM meta_funnel_column_preferences p JOIN column_scope s ON p.funnel_id IN(s.fa,s.fb)) <> 2 THEN RAISE EXCEPTION 'Reset affected another user or template'; END IF;
END $$;
DELETE FROM meta_ad_funnels WHERE id=(SELECT fa FROM column_scope);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM meta_funnel_column_preferences WHERE funnel_id=(SELECT fa FROM column_scope)) THEN RAISE EXCEPTION 'Deleted template left orphan preferences'; END IF;
END $$;
SELECT 'PASS: persistence, user/template keys, reset, grants, RLS and cascade';
`;
console.log(query('BEGIN;\n' + migration + '\n' + sql + '\nROLLBACK;').trim());
assert.equal(exists(), beforeExists);
if (beforeExists) assert.equal(query('SELECT count(*) FROM meta_funnel_column_preferences;'), before);
console.log('PASS: schema and fixtures rolled back');
