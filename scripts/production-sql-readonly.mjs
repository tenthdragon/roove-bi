#!/usr/bin/env node
// Read-only SQL against the production Supabase project, for inspection only.
//
//   node scripts/production-sql-readonly.mjs "select count(*) from public.tax_counterparties"
//   node scripts/production-sql-readonly.mjs --file query.sql [--limit 200] [--json]
//
// Guarantees:
//   * one statement, and it must start with SELECT, WITH, EXPLAIN, SHOW, TABLE
//     or VALUES; anything else is refused before any request is made;
//   * the Management API call is made with read_only: true, so the server runs
//     it inside a read-only transaction and rejects writes even if a function
//     in the query tried one;
//   * the credential comes from the Supabase CLI keychain entry via
//     scripts/local-production-access.mjs and is never printed;
//   * output is capped (default 200 rows) so an inspection cannot turn into a
//     bulk export by accident.
import { readFileSync } from 'node:fs';
import { productionReadOnlyQuery, PRODUCTION_REF } from './local-production-access.mjs';

const args = process.argv.slice(2);
const takeOption = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const [, value] = args.splice(index, 2);
  return value ?? fallback;
};
const hasFlag = (name) => {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
};

const asJson = hasFlag('--json');
const limit = Math.min(Math.max(Number(takeOption('--limit', '200')) || 200, 1), 2000);
const file = takeOption('--file', null);
const sql = (file ? readFileSync(file, 'utf8') : args.join(' ')).trim().replace(/;\s*$/, '');

if (!sql) {
  console.error('Usage: node scripts/production-sql-readonly.mjs "<select statement>" [--limit N] [--json]');
  process.exit(2);
}
if (sql.includes(';')) {
  console.error('Refused: exactly one statement is allowed.');
  process.exit(2);
}
if (!/^(select|with|explain|show|table|values)\b/i.test(sql)) {
  console.error('Refused: only SELECT / WITH / EXPLAIN / SHOW / TABLE / VALUES statements are allowed.');
  process.exit(2);
}
if (/\binto\s+(temp|temporary|unlogged|table)?\s*[a-z_"]/i.test(sql) && /^select/i.test(sql)) {
  console.error('Refused: SELECT ... INTO creates a table.');
  process.exit(2);
}

const wrapped = /^(explain|show)\b/i.test(sql)
  ? sql
  : `select * from (${sql}) as readonly_inspection limit ${limit + 1}`;

try {
  const rows = await productionReadOnlyQuery(wrapped);
  const list = Array.isArray(rows) ? rows : [];
  const truncated = list.length > limit;
  const shown = truncated ? list.slice(0, limit) : list;
  if (asJson) {
    process.stdout.write(`${JSON.stringify({ project: PRODUCTION_REF, rows: shown, truncated }, null, 2)}\n`);
  } else {
    if (shown.length === 0) {
      process.stdout.write('(0 rows)\n');
    } else {
      const columns = Object.keys(shown[0]);
      const cell = (value) => (value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));
      const widths = columns.map((column) => Math.max(column.length, ...shown.map((row) => cell(row[column]).length)));
      const line = (values) => values.map((value, index) => value.padEnd(widths[index])).join(' | ');
      process.stdout.write(`${line(columns)}\n${widths.map((width) => '-'.repeat(width)).join('-+-')}\n`);
      for (const row of shown) process.stdout.write(`${line(columns.map((column) => cell(row[column])))}\n`);
      process.stdout.write(`(${shown.length} row${shown.length === 1 ? '' : 's'}${truncated ? `, truncated at ${limit}` : ''})\n`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
