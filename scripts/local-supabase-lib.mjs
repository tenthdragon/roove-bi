import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const PROJECT_ID = 'roove-bi-local';
export const NETWORK_NAME = 'roove-bi-local-loopback';
export const APP_PORT = 3130;
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
export function assertProjectConfig(text) {
  if (!/^project_id\s*=\s*"roove-bi-local"\s*$/m.test(text)) throw new Error('Refusing a config outside the fixed roove-bi-local project');
}
export function assertLocalUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port !== '54321' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Refusing non-local Supabase URL; expected http://127.0.0.1:54321');
  }
  return url.origin;
}
export function localCliArgs(command) {
  const allowed = { start: ['start'], stop: ['stop'], status: ['status', '-o', 'json'] };
  if (!Object.hasOwn(allowed, command)) throw new Error('Only local start/stop/status commands are allowed');
  return [...allowed[command], '--workdir', '.local', ...(command === 'start' ? ['--network-id', NETWORK_NAME] : [])];
}
export function assertLoopbackBindings(containers) {
  for (const container of containers) {
    for (const ports of Object.values(container.NetworkSettings?.Ports || {})) {
      for (const port of ports || []) {
        if (port.HostIp !== '127.0.0.1') throw new Error('Local Supabase ports are not loopback-only. Run db:local:stop then db:local:start using this helper.');
      }
    }
  }
}
export function cleanEnvironment(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) =>
    /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_.*|TMPDIR|TEMP|TMP|TERM|COLORTERM|DOCKER_HOST|DOCKER_CONTEXT|DOCKER_CONFIG)$/.test(key)
  ));
}
export function blankDotenvKeys(text) {
  return Object.fromEntries([...text.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((m) => [m[1], '']));
}
export function localSql(name, input) {
  let sql = input;
  const notes = [];
  if (name === '001_initial_schema.sql') {
    // Legacy roles existed in the hosted DB but were not recorded in migrations.
    // Include all roles up front to also avoid ADD VALUE/use-in-same-transaction errors.
    sql = sql.replace("('owner', 'manager', 'brand_manager')", "('owner', 'manager', 'brand_manager', 'finance', 'staff', 'pending', 'admin', 'direktur_operasional', 'warehouse_manager', 'ppic', 'direktur_ops', 'staf_ops', 'direktur_finance', 'staf_finance', 'ppic_manager', 'marketing_api_reviewer')");
    notes.push('Local enum includes undocumented legacy roles and later enum values.');
  }
  if (name === '005_refresh_function.sql') {
    // This old file was edited later to refresh customer MVs introduced in 026.
    sql = sql.replace(/^\s*REFRESH MATERIALIZED VIEW(?: CONCURRENTLY)? mv_(?:daily_customer_type|customer_cohort|monthly_cohort);\s*$/gm, '');
    notes.push('Refresh only the four MVs that exist at this point in history.');
  }
  if (name === '012_webhook_businesses.sql') {
    sql += `\nINSERT INTO public.scalev_webhook_businesses(business_code,business_name,webhook_secret,is_active)
      SELECT code,code || ' · Referensi Lokal',gen_random_uuid()::text || gen_random_uuid()::text,false
      FROM unnest(ARRAY['RTI','RLB','RLT','JHN']) code ON CONFLICT(business_code) DO NOTHING;\n`;
    notes.push('Inactive dummy business references satisfy later warehouse foreign keys; no live integration secrets.');
  }
  if (name === '038_fix_csv_date_swap.sql') {
    sql = '-- Historical CSV date repair has no rows to repair locally.\nSELECT 1;';
    notes.push('Skip data-only repair of a production CSV upload; no schema changes.');
  }
  if (name === '050_switch_to_summary_tables.sql') {
    sql = 'DROP VIEW IF EXISTS public.v_monthly_cohort;\n' + sql;
    notes.push('Recreate monthly cohort wrapper to allow its intended numeric-to-bigint type change.');
  }
  if (name === '066_warehouse_seed_rlb_and_stock.sql' || name === '073_warehouse_reseed_all.sql') {
    const helper = name.startsWith('066') ? 'CREATE OR REPLACE FUNCTION _seed_initial_stock' : 'CREATE OR REPLACE FUNCTION _seed_stock';
    if (!sql.includes(helper)) throw new Error(`Stock seed ${name} changed; review local adapter`);
    sql = sql.slice(0, sql.indexOf(helper));
    notes.push('Keep reference product catalog, omit historical opening stock/batches/ledger.');
  }
  if (name === '096_seed_bank_accounts.sql') {
    sql = '-- No production bank account numbers are seeded locally.\nSELECT 1;';
    notes.push('Omit data-only production bank account seed.');
  }
  if (name === '174_apurva_warehouse_cutover.sql') {
    sql = '-- Production inventory cutover intentionally not replayed into an empty local database.\nSELECT 1;';
    notes.push('Skip data-only production stock cutover; not a schema migration.');
  }
  if (name === '179_transfer_historical_purvu_orders_to_apurva.sql') {
    const marker = 'CREATE TEMP TABLE expected_purvu_transfer';
    if (!sql.includes(marker)) throw new Error('Historical transfer migration changed; review local adapter');
    sql = sql.slice(0, sql.indexOf(marker)) + '\nCOMMIT;\n';
    notes.push('Keep routing table, grants and trigger; omit transfer of 40 production orders.');
  }
  const indexes = sql.replace(/\b(CREATE(?: UNIQUE)? INDEX|DROP INDEX)\s+CONCURRENTLY\b/gi, '$1');
  if (indexes !== sql) notes.push('Build/drop indexes normally on the isolated empty local database, inside its checkpoint transaction.');
  sql = indexes;
  // Each file and its bootstrap checkpoint commit atomically in our local runner.
  sql = sql.replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm, '');
  return { sql, notes };
}
export async function buildMigrations(root) {
  const directory = path.join(root, 'supabase/migrations');
  const names = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name) && !/(?:_ROLLBACK|_verify|_validation_queries)\.sql$/i.test(name));
  const order = (name) => name === '065_vendor_pkp.sql' ? 78.5 : Number(name.split('_')[0]);
  names.sort((a, b) => order(a) - order(b) || a.localeCompare(b, 'en'));
  const base = await readFile(path.join(root, 'supabase/local/legacy-base.sql'), 'utf8');
  const entries = [{ name: '000_local_legacy_base.sql', sql: base, sourceChecksum: sha256(base), notes: ['Local-only pre-migration table definitions; no production data.'] }];
  for (const name of names) {
    const source = await readFile(path.join(directory, name), 'utf8');
    entries.push({ name, sourceChecksum: sha256(source), ...localSql(name, source) });
  }
  return entries.map((entry, index) => ({ ...entry, generatedName: `${String(index).padStart(5, '0')}_${entry.name}`, checksum: sha256(entry.sourceChecksum + '\n' + entry.sql) }));
}
