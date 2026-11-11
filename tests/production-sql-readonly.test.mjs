import assert from 'node:assert/strict';
import test from 'node:test';
import { clipCell, tokenize, validateInspectionSql } from '../scripts/production-sql-readonly-guard.mjs';

const accept = (sql, options) => {
  const verdict = validateInspectionSql(sql, options);
  assert.equal(verdict.ok, true, `expected acceptance, got: ${verdict.reason}`);
  return verdict;
};
const refuse = (sql, pattern) => {
  const verdict = validateInspectionSql(sql);
  assert.equal(verdict.ok, false, `expected refusal for: ${sql}`);
  assert.match(verdict.reason, pattern);
};

test('accepts plain inspection statements and wraps them with a row cap', () => {
  const verdict = accept('select count(*) from public.tax_counterparties', { limit: 50 });
  assert.equal(verdict.rows, 50);
  assert.match(verdict.statement, /^select \* from \(\nselect count \( \* \) from public \. tax_counterparties\n\) as readonly_inspection limit 51$/);
  accept('with t as (select 1 as x) select x from t');
  accept('table public.tax_object_codes');
  accept("values (1, 'a')");
  accept('explain select 1');
  accept('show server_version');
  accept('select pg_catalog.count(*) from pg_class');
  accept('select has_table_privilege(\'anon\', \'public.tax_counterparties\', \'SELECT\')');
});

test('literals and comments are opaque to the checks', () => {
  accept("select 'a;b' as text");
  accept("select 'into foo' as text");
  accept('select $$delete from x; pg_terminate_backend(1)$$ as text');
  accept('select "weird;name" from public.x');
  accept('select 1 /* update ; drop */ as y');
  const trailing = accept('select 1 -- inspection');
  assert.match(trailing.statement, /select 1\n\) as readonly_inspection/);
  accept("select E'it''s;ok' as t");
});

test('refuses more than one statement and non-read statements', () => {
  refuse('select 1; select 2', /one statement/);
  refuse('delete from public.tax_counterparties', /Only SELECT/);
  refuse('with t as (delete from public.x returning *) select * from t', /DELETE/);
  refuse('select * into t from public.x', /INTO creates a table/);
  refuse('select 1 for update', /FOR UPDATE/);
  refuse('explain analyze select 1', /EXPLAIN ANALYZE/);
  refuse('explain (analyze, buffers) select 1', /EXPLAIN ANALYZE/);
  refuse('', /Empty/);
  refuse(';', /Empty/);
});

test('refuses side-effecting or unlisted function calls', () => {
  refuse('select pg_terminate_backend(123)', /pg_terminate_backend/);
  refuse('select pg_advisory_lock(1)', /pg_advisory_lock/);
  refuse("select dblink_exec('conn', 'delete from x')", /dblink_exec/);
  refuse("select set_config('role', 'postgres', true)", /set_config/);
  refuse('select pg_sleep(10)', /pg_sleep/);
  refuse("select pg_notify('c', 'p')", /pg_notify/);
  refuse('select extensions.dblink_exec(1)', /extensions\.dblink_exec/);
  refuse('select "pg_terminate_backend"(1)', /Quoted function/);
  refuse("select lo_import('/etc/passwd')", /lo_import/);
});

test('tokenizer reports unterminated constructs', () => {
  assert.throws(() => tokenize("select 'open"), /Unterminated string/);
  assert.throws(() => tokenize('select $$open'), /dollar-quoted/);
  assert.throws(() => tokenize('select /* open'), /block comment/);
  assert.throws(() => tokenize('select "open'), /quoted identifier/);
});

test('cells are clipped for display', () => {
  assert.equal(clipCell(null), '');
  assert.equal(clipCell({ a: 1 }), '{"a":1}');
  const long = 'x'.repeat(2500);
  assert.match(clipCell(long), /^x{2000}… \[500 more chars\]$/);
});
