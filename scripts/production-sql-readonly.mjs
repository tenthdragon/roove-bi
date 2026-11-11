#!/usr/bin/env node
// Read-only SQL inspection of the production Supabase project.
//
//   node scripts/production-sql-readonly.mjs "select count(*) from public.tax_counterparties"
//   node scripts/production-sql-readonly.mjs --file query.sql [--limit 200] [--json]
//
// What this does and does not guarantee:
//   * the statement is checked offline by scripts/production-sql-readonly-guard.mjs:
//     one SELECT/WITH/TABLE/VALUES/EXPLAIN/SHOW statement, no data- or
//     session-changing keyword, no SELECT INTO, and function calls only from
//     an allowlist of pure/stable inspection functions, so side-effecting
//     functions such as pg_terminate_backend or dblink_exec are refused before
//     any request is made;
//   * the request is sent with read_only: true, so the server runs it in a
//     read-only transaction and rejects ordinary writes as a second line;
//   * the credential comes from the Supabase CLI keychain entry via
//     scripts/local-production-access.mjs and is never printed;
//   * output is bounded for display: at most --limit rows (default 200, max
//     2000), each cell clipped to 2,000 characters and the whole output to
//     256 KB. This is an output cap for inspection, not a bulk-export control:
//     the executing role can still read anything it is allowed to read.
import { readFileSync } from 'node:fs';
import { productionReadOnlyQuery, PRODUCTION_REF } from './local-production-access.mjs';
import {
  DEFAULT_ROWS,
  MAX_OUTPUT_BYTES,
  clipCell,
  validateInspectionSql,
} from './production-sql-readonly-guard.mjs';

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
const limit = Number(takeOption('--limit', String(DEFAULT_ROWS)));
const file = takeOption('--file', null);
const sql = file ? readFileSync(file, 'utf8') : args.join(' ');

if (!sql.trim()) {
  console.error('Usage: node scripts/production-sql-readonly.mjs "<select statement>" [--limit N] [--json]');
  process.exit(2);
}

const verdict = validateInspectionSql(sql, { limit });
if (!verdict.ok) {
  console.error(`Refused: ${verdict.reason}`);
  process.exit(2);
}

try {
  const result = await productionReadOnlyQuery(verdict.statement);
  const list = Array.isArray(result) ? result : [];
  const truncated = list.length > verdict.rows;
  const shown = truncated ? list.slice(0, verdict.rows) : list;
  let output;
  if (asJson) {
    const clipped = shown.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, clipCell(value)])));
    output = `${JSON.stringify({ project: PRODUCTION_REF, rows: clipped, truncated }, null, 2)}\n`;
  } else if (shown.length === 0) {
    output = '(0 rows)\n';
  } else {
    const columns = Object.keys(shown[0]);
    const cells = shown.map((row) => columns.map((column) => clipCell(row[column])));
    const widths = columns.map((column, index) => Math.min(120, Math.max(column.length, ...cells.map((row) => row[index].length))));
    const line = (values) => values.map((value, index) => value.padEnd(widths[index])).join(' | ');
    const lines = [line(columns), widths.map((width) => '-'.repeat(width)).join('-+-'), ...cells.map(line)];
    lines.push(`(${shown.length} row${shown.length === 1 ? '' : 's'}${truncated ? `, truncated at ${verdict.rows}` : ''})`);
    output = `${lines.join('\n')}\n`;
  }
  if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) {
    output = `${output.slice(0, MAX_OUTPUT_BYTES)}\n… output cut at ${MAX_OUTPUT_BYTES} bytes; narrow the query or lower --limit.\n`;
  }
  process.stdout.write(output);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
