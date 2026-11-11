import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { clipCell, validateInspectionSql } from '../scripts/production-sql-readonly-guard.mjs';

const accept = async (sql, options) => {
  const verdict = await validateInspectionSql(sql, options);
  assert.equal(verdict.ok, true, `${sql}: ${verdict.reason}`);
  return verdict;
};
const refuse = async (sql, pattern) => {
  const verdict = await validateInspectionSql(sql);
  assert.equal(verdict.ok, false, `expected refusal for: ${sql}`);
  if (pattern) assert.match(verdict.reason, pattern);
};

test('ordinary inspections, CTE column lists and aliases use the PostgreSQL grammar', async () => {
  const verdict = await accept('select count(*) from public.tax_counterparties', { limit: 50 });
  assert.equal(verdict.rows, 50);
  assert.equal(verdict.statement, 'select * from (\nselect pg_catalog.count(*) from public.tax_counterparties\n) as readonly_inspection limit 51');
  for (const sql of [
    'with t(x) as (values (1)) select * from t',
    'with recursive t(x) as (values (1) union all select x+1 from t where x<3) select * from t',
    'select x from (values (1)) as t(x)',
    'table public.tax_object_codes', "values (1, 'a')", 'explain select 1',
    'explain (format json, costs false) select 1', 'show server_version',
    'select pg_catalog.count(*) from pg_class',
    "select has_table_privilege('anon', 'public.tax_counterparties', 'SELECT')",
    "select coalesce(null, 1), greatest(1,2), substring('ab' from 1 for 1)",
    'select row_number() over (order by x) from (values (1)) t(x)',
    'select t.* from (values (1)) t(x)',
  ]) await accept(sql);
});

test('operators, comments, prefixes, and literal whitespace retain their meaning', async () => {
  for (const sql of [
    'select 1 <= 2, 2 >= 1, 1 != 2, 1 <> 2', "select 'a' || 'b'",
    "select 'a;b' as text", "select 'into foo' as text",
    'select $$delete from x; pg_terminate_backend(1)$$ as text',
    'select "weird;name" from public.x', 'select 1 /* update ; drop /* nested */ */ as y',
    'select 1 -- inspection', "select E'it''s;ok' as t", "select B'101'", "select U&'d\\0061t'",
    "select 'a'\n'b' as text",
  ]) assert.ok((await accept(sql)).statement.includes(sql), sql);
  assert.ok((await accept("select '{\"a\":1}'::jsonb->>'a'")).statement.includes("::pg_catalog.jsonb->>'a'"));
  assert.equal((await accept('select 1; -- trailing')).statement, 'select * from (\nselect 1\n) as readonly_inspection limit 201');
  assert.ok((await accept("select '字😀' as label, lower('A'), 'x'::text")).statement.includes("'字😀' as label, pg_catalog.lower('A'), 'x'::pg_catalog.text"));
});

test('rejects writes, multiple statements, locks, invalid SQL and every ANALYZE spelling', async () => {
  for (const sql of [
    'select 1; select 2', 'delete from public.x',
    'with t as (delete from public.x returning *) select * from t',
    'select * into t from public.x', 'select 1 for update', 'select 1 for share',
    'explain analyze select 1', 'explain (analyze, buffers) select 1',
    'explain ("analyze") select 1', 'explain ("ANALYZE" true) select 1',
    'explain (analyze false) select 1', 'explain (U&"analy\\007ae") select 1',
    'explain delete from public.x', '', ';', "select 'open", 'select $$open',
    'select /* open', 'select "open', 'select 1\0; delete from x',
  ]) await refuse(sql);
});

test('blocks direct, computed-field, quoted and schema-qualified function bypasses', async () => {
  for (const sql of [
    'select pg_terminate_backend(123)', 'select pg_advisory_lock(1)',
    "select dblink_exec('conn', 'delete from x')", "select set_config('role','postgres',true)",
    'select pg_sleep(10)', "select pg_notify('c','p')", 'select extensions.dblink_exec(1)',
    'select "pg_terminate_backend"(1)', "select lo_import('/etc/passwd')",
    'select (710073::bigint).pg_try_advisory_lock',
    'select (710073::bigint)."pg_try_advisory_lock"',
    'select ((710073::bigint).pg_try_advisory_lock)',
    'select t.pg_try_advisory_lock from (values (1)) t(x)',
    'select (t).custom_function from (values (1)) t(x)',
    'select public.like(1)', 'select public.only(1)', 'select public.lower(1)',
    "select 'x'::public.custom_type", 'select 1 OPERATOR(public.+) 2',
    "select * from xmltable('/x' passing '<x/>' columns x int path '.')",
  ]) await refuse(sql);
});

test('pins builtin function/type resolution instead of trusting search_path', async () => {
  assert.ok((await accept('select lower(1)')).statement.includes('pg_catalog.lower(1)'));
  assert.ok((await accept('select "lower"(1)')).statement.includes('pg_catalog."lower"(1)'));
  assert.ok((await accept("select 'x'::text")).statement.includes('::pg_catalog.text'));
});

test('rejects invalid row bounds and oversized input before execution', async () => {
  for (const limit of [0, -1, 1.5, 2001, NaN, Infinity, 'oops']) {
    assert.equal((await validateInspectionSql('select 1', { limit })).ok, false);
  }
  assert.equal((await accept('select 1', { limit: 2000 })).rows, 2000);
  await refuse('select 1 /*' + 'x'.repeat(65536) + '*/', /64 KB/);
});

test('CLI refuses every regression before credential lookup or network access', () => {
  for (const sql of ['select (710073::bigint).pg_try_advisory_lock', 'explain ("analyze") select 1', 'select 1; delete from x']) {
    const result = spawnSync(process.execPath, ['scripts/production-sql-readonly.mjs', sql], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /^Refused:/);
    assert.equal(result.stdout, '');
  }
});

test('cells are clipped for display', () => {
  assert.equal(clipCell(null), '');
  assert.equal(clipCell({ a: 1 }), '{"a":1}');
  assert.match(clipCell('x'.repeat(2500)), /^x{2000}… \[500 more chars\]$/);
});

test('CLI keeps Unicode output within its byte cap and JSON parseable', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'roove-sql-cli-'));
  const preload = join(directory, 'offline.mjs');
  writeFileSync(preload, `
    import assert from 'node:assert/strict';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    childProcess.execFileSync = (program, args) => {
      assert.equal(program, '/usr/bin/security');
      return 'sbp_' + '0'.repeat(40);
    };
    syncBuiltinESMExports();
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.supabase.com/v1/projects/hpsenndhoyzgnnkrhtly/database/query');
      const body = JSON.parse(options.body);
      assert.equal(body.read_only, true);
      assert.ok(body.query.includes('with t(x) as (values (1))'));
      return new Response(JSON.stringify(Array.from({length: 2001}, () => ({text:'字'.repeat(2500)}))));
    };
  `);
  try {
    for (const json of [false, true]) {
      const result = spawnSync(process.execPath, ['--import', preload, 'scripts/production-sql-readonly.mjs', 'with t(x) as (values (1)) select * from t', '--limit', '2000', ...(json ? ['--json'] : [])], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(Buffer.byteLength(result.stdout) <= 256 * 1024);
      assert.ok(!result.stdout.includes('\ufffd'));
      if (json) {
        const data = JSON.parse(result.stdout);
        assert.equal(data.truncated, true);
        assert.equal(data.outputTruncated, true);
        assert.ok(data.rows.length > 0);
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
