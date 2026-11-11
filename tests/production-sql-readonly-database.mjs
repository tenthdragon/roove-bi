// Fresh, network-isolated PostgreSQL only. Never connects to Supabase or a snapshot.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { validateInspectionSql } from '../scripts/production-sql-readonly-guard.mjs';
const container = `roove-sql-guard-test-${process.pid}`;
const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
const psql = sql => docker(['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input: sql });
let created = false;
try {
  docker(['run', '--rm', '-d', '--name', container, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
  created = true;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { docker(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.ok(ready, 'Disposable PostgreSQL did not become ready');
  // Establish that our regression actually has an observable side effect in RO.
  assert.equal(psql(`BEGIN READ ONLY;
SELECT (710073::bigint).pg_try_advisory_lock;
SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid();
ROLLBACK;`).trim(), 't\n1');
  psql(`CREATE FUNCTION public.lower(integer) RETURNS boolean LANGUAGE sql VOLATILE AS $$ SELECT pg_try_advisory_lock($1) $$;
CREATE FUNCTION public.like(integer) RETURNS boolean LANGUAGE sql VOLATILE AS $$ SELECT pg_try_advisory_lock($1) $$;`);
  const valid = [
    ['select 1 <= 2, 1 != 2, 2 >= 1', 't|t|t'],
    ["select '{\"a\":1}'::jsonb->>'a', 'a' || 'b'", '1|ab'],
    ['with t(x) as (values (1)) select * from t', '1'],
    ['select x from (values (1)) t(x)', '1'],
    ['select 1 -- inspection', '1'], ['select 1; -- inspection', '1'],
    ["select 'a'\n'b'", 'ab'], ["select '字' as label, lower('A')", '字|a'],
    ["select B'101', substring('abc' from 2 for 1)", '101|b'],
  ];
  for (const [sql, expected] of valid) {
    const verdict = await validateInspectionSql(sql);
    assert.equal(verdict.ok, true, verdict.reason);
    assert.equal(psql(`BEGIN READ ONLY;\n${verdict.statement};\nROLLBACK;`).trim(), expected, sql);
  }
  for (const sql of ['select (710073::bigint).pg_try_advisory_lock', 'select public.like(710073)', 'explain ("analyze") select 1']) {
    assert.equal((await validateInspectionSql(sql)).ok, false, sql);
  }
  const overload = await validateInspectionSql('select lower(710073)');
  assert.ok(overload.ok);
  assert.throws(() => psql(`BEGIN READ ONLY;\n${overload.statement};`), /pg_catalog.lower/, 'must not execute public.lower(integer)');
  const explain = await validateInspectionSql('explain (format json) select 1');
  const plan = JSON.parse(psql(explain.statement));
  assert.equal(plan[0].Plan['Actual Rows'], undefined, 'plain EXPLAIN must not execute');
  console.log(`PASS: ${valid.length} SQL results, blocked bypasses, builtin overload isolation, and plan-only EXPLAIN on PostgreSQL 17`);
} finally {
  if (created) docker(['rm', '-f', container]);
}
