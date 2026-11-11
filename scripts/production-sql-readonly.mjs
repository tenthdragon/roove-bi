#!/usr/bin/env node
// Read-only SQL inspection of the production Supabase project.
//
//   node scripts/production-sql-readonly.mjs "select count(*) from public.tax_counterparties"
//   node scripts/production-sql-readonly.mjs --file query.sql [--limit 200] [--json]
//
// Trusted-operator inspection helper, not a sandbox for untrusted SQL.
// PostgreSQL AST validation restricts statements, explicit functions and casts;
// computed-field syntax and qualified column references are refused. Trusted
// database definitions (views, RLS, implicit casts/operators) may execute code.
// read_only: true is enforced by the existing Management API helper. Its
// credential still has its original privileges: never feed this CLI untrusted
// SQL or use its display limits as an authorization/bulk-export control.
// See docs/runbooks/production-sql-inspection.md for the supported subset.
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

const verdict = await validateInspectionSql(sql, { limit });
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
    const clipped = [];
    let bytes = 256; // reserve the envelope and truncation flags
    let outputTruncated = false;
    for (const row of shown) {
      const item = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, clipCell(value)]));
      const size = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1;
      if (bytes + size > MAX_OUTPUT_BYTES) { outputTruncated = true; break; }
      clipped.push(item);
      bytes += size;
    }
    output = `${JSON.stringify({ project: PRODUCTION_REF, rows: clipped, truncated: truncated || outputTruncated, outputTruncated })}\n`;
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
    const notice = `\n… output cut at ${MAX_OUTPUT_BYTES} bytes; narrow the query or lower --limit.\n`;
    const bytes = Buffer.from(output);
    let end = MAX_OUTPUT_BYTES - Buffer.byteLength(notice);
    while ((bytes[end] & 0xc0) === 0x80) end -= 1;
    output = bytes.subarray(0, end).toString('utf8') + notice;
  }
  process.stdout.write(output);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
