// Only the fixed local database is supported. All test schema/data rolls back.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const query = input => execFileSync('docker', ['exec', '-i', 'supabase_db_roove-bi-local', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input, encoding: 'utf8' });
assert.equal(query("SELECT to_regnamespace('roove_local') IS NOT NULL;").trim(), 't');
const exists = () => query("SELECT to_regclass('public.meta_funnel_column_preferences') IS NOT NULL;").trim() === 't';
const beforeExists = exists(), before = beforeExists ? query('SELECT count(*) FROM meta_funnel_column_preferences;') : null;
const migration = beforeExists ? '' : readFileSync(new URL('../supabase/migrations/225_meta_funnel_column_preferences.sql', import.meta.url), 'utf8').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
const beforeSort = beforeExists && query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='meta_funnel_column_preferences' AND column_name='sort_config');").trim() === 't';
const sortMigration = beforeSort ? '' : readFileSync(new URL('../supabase/migrations/226_meta_funnel_sort_preferences.sql', import.meta.url), 'utf8').replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '');
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
-- RPC saves as the service role; each patch must preserve the unrelated setting.
GRANT SELECT ON column_scope TO service_role;
SET LOCAL ROLE service_role;
SELECT save_meta_funnel_table_preference(a,fa,'sort',NULL,'{"key":"name","direction":"descending"}') IS NOT NULL FROM column_scope;
SELECT save_meta_funnel_table_preference(a,fa,'columns',NULL) IS NOT NULL FROM column_scope;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM meta_funnel_column_preferences p JOIN column_scope s ON p.user_id=s.a AND p.funnel_id=s.fa
   WHERE p.column_order='{}' AND p.sort_config->>'key'='name') THEN RAISE EXCEPTION 'Column reset erased sort'; END IF;
END $$;
SELECT save_meta_funnel_table_preference(a,fa,'columns','{"order":["funnel","metric:spent"],"hidden":[]}') IS NOT NULL FROM column_scope;
SELECT save_meta_funnel_table_preference(a,fa,'sort',NULL,NULL) IS NOT NULL FROM column_scope;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM meta_funnel_column_preferences p JOIN column_scope s ON p.user_id=s.a AND p.funnel_id=s.fa
   WHERE p.column_order=ARRAY['funnel','metric:spent'] AND p.sort_config IS NULL) THEN RAISE EXCEPTION 'Sort reset erased columns'; END IF;
END $$;
SELECT save_meta_funnel_table_preference(a,fa,'sort',NULL,'{"key":"metric:spent","direction":"ascending"}') IS NOT NULL FROM column_scope;
SELECT save_meta_funnel_table_preference(a,fa,'columns','{"order":["funnel","metric:spent"],"hidden":["metric:spent"]}') IS NOT NULL FROM column_scope;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM meta_funnel_column_preferences p JOIN column_scope s ON p.user_id=s.a AND p.funnel_id=s.fa WHERE p.sort_config IS NOT NULL)
   THEN RAISE EXCEPTION 'Hidden sort was not cleared'; END IF;
END $$;
SELECT save_meta_funnel_table_preference(a,fa,'sort',NULL,'{"key":"metric:spent","direction":"descending"}') IS NOT NULL FROM column_scope;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM meta_funnel_column_preferences p JOIN column_scope s ON p.user_id=s.a AND p.funnel_id=s.fa WHERE p.sort_config IS NOT NULL)
   THEN RAISE EXCEPTION 'Hidden sort reintroduced'; END IF;
 IF NOT EXISTS(SELECT 1 FROM meta_funnel_column_preferences p JOIN column_scope s ON p.user_id=s.b AND p.funnel_id=s.fa WHERE p.hidden_columns=ARRAY['funnel'] AND p.sort_config IS NULL)
   THEN RAISE EXCEPTION 'Another user changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM meta_funnel_column_preferences p JOIN column_scope s ON p.user_id=s.a AND p.funnel_id=s.fb WHERE p.hidden_columns=ARRAY['funnel'] AND p.sort_config IS NULL)
   THEN RAISE EXCEPTION 'Another template changed'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE value jsonb; BEGIN
 FOREACH value IN ARRAY ARRAY['{}'::jsonb,'{"key":"name","direction":null}'::jsonb,
   '{"key":"funnel","direction":"ascending"}'::jsonb,'{"key":"funnel","direction":"ascending","stage":null}'::jsonb,
   '{"key":"name","direction":"ascending","stage":"purchases"}'::jsonb] LOOP
   BEGIN
    UPDATE meta_funnel_column_preferences SET sort_config=value WHERE funnel_id=(SELECT fa FROM column_scope);
    RAISE EXCEPTION 'Invalid sort accepted: %', value;
   EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 IF has_function_privilege('anon','public.save_meta_funnel_table_preference(uuid,uuid,text,jsonb,jsonb)','EXECUTE') OR
    has_function_privilege('authenticated','public.save_meta_funnel_table_preference(uuid,uuid,text,jsonb,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'RPC exposed to clients'; END IF;
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
console.log(query('BEGIN;\n' + migration + '\n' + sortMigration + '\n' + sql + '\nROLLBACK;').trim());
assert.equal(exists(), beforeExists);
if (beforeExists) assert.equal(query('SELECT count(*) FROM meta_funnel_column_preferences;'), before);
assert.equal(beforeExists && query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='meta_funnel_column_preferences' AND column_name='sort_config');").trim() === 't', beforeSort);
console.log('PASS: columns/sort patches, isolated resets, validation, grants; schema and fixtures rolled back');
