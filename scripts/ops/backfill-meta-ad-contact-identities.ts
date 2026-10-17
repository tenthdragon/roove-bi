import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { fetchAdDestinationBatch } from '../../lib/meta-ad-destination-metadata';
import { resolveWorkspaceCredential } from '../../lib/workspace-integration-server';
import { requireExplicitWorkspaceId } from '../../lib/workspace-scope';

const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const ok = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
const whatsAppUrl = (value: unknown) => {
  if (typeof value !== 'string') return false;
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && ['api.whatsapp.com', 'web.whatsapp.com', 'wa.me'].includes(u.hostname); }
  catch { return false; }
};

async function main() {
  const workspaceId = requireExplicitWorkspaceId(arg('workspace'), 'Contact identity backfill');
  const envFile = resolve(arg('env-file') || '.env.local');
  if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || /^\s*#/.test(line)) continue;
    const i = line.indexOf('='), key = line.slice(0, i).trim();
    process.env[key] ||= line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  const expectedHost = arg('expected-api-host');
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!expectedHost || new URL(api).hostname !== expectedHost) throw new Error('Explicit matching --expected-api-host required.');
  const apply = process.argv.includes('--apply');
  const db = createClient(api, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const workspace = ok(await db.from('workspaces').select('id,slug').eq('id', workspaceId).single());
  const accounts = ok(await db.from('meta_ad_accounts').select('account_id,account_name').eq('workspace_id', workspaceId));
  const ownedAccounts = new Set(accounts.map(a => a.account_id));
  const candidates = new Map<string, { account_id: string; ad_id: string }>();
  const beforeMetadata: { account_id: string; ad_id: string; [key: string]: unknown }[] = [];
  const observations: Record<string, unknown>[] = [];
  for (const table of ['meta_ad_destination_metadata', 'meta_ad_creatives', 'meta_ad_mappings']) {
    const fields = table === 'meta_ad_destination_metadata' ? '*' : 'account_id,ad_id,landing_page_urls';
    for (let offset = 0; ; offset += 1000) {
      const rows = ok(await db.from(table).select(fields).eq('workspace_id', workspaceId).order('account_id').order('ad_id').range(offset, offset + 999)) as unknown as {
        account_id: string; ad_id: string; destination_type?: string; metadata?: { urls?: string[] }; landing_page_urls?: string[];
      }[];
      if (table === 'meta_ad_destination_metadata') beforeMetadata.push(...rows);
      for (const row of rows) if (ownedAccounts.has(row.account_id) && (row.destination_type === 'WHATSAPP' || (row.metadata?.urls || row.landing_page_urls || []).some(whatsAppUrl))) {
        candidates.set(`${row.account_id}:${row.ad_id}`, { account_id: row.account_id, ad_id: row.ad_id });
      }
      if (rows.length < 1000) break;
    }
  }
  const backup = arg('backup-file');
  if (apply && backup) {
    if (existsSync(resolve(backup))) throw new Error('Backup already exists; inspect before retrying.');
    writeFileSync(resolve(backup), JSON.stringify({ workspace_id: workspaceId, at: new Date().toISOString(),
      rows: beforeMetadata.filter(r => candidates.has(`${r.account_id}:${r.ad_id}`)) }), { mode: 0o600, flag: 'wx' });
  }
  const summary = { workspace: workspace.slug, workspace_id: workspaceId, apply, selected: candidates.size, read: 0, saved: 0,
    page_available: 0, phone_available: 0, missing_phone: [] as string[], missing_identity: [] as string[],
    failures: [] as { ad_id: string; error: string; code?: number }[], skipped: [] as { ad_id: string; reason: string }[],
    facts_writes: 0, brand_writes: 0, sync_jobs_enqueued: 0 };
  console.log(JSON.stringify({ event: 'start', workspace: workspace.slug, apply, candidates: candidates.size }));
  if (candidates.size) {
    const token = await resolveWorkspaceCredential({ supabase: db, workspaceId, provider: 'meta', fallbackEnvKeys: ['META_ACCESS_TOKEN'] });
    for (const accountId of [...new Set([...candidates.values()].map(r => r.account_id))]) {
      const ids = [...candidates.values()].filter(r => r.account_id === accountId).map(r => r.ad_id);
      for (let offset = 0; offset < ids.length; offset += 50) {
        const result = await fetchAdDestinationBatch(ids.slice(offset, offset + 50), token);
        if (result.rows.some(r => r.account_id !== accountId)) throw new Error('Returned ad outside expected account; batch not written.');
        summary.read += result.rows.length; summary.failures.push(...result.failures);
        const observedAt = new Date().toISOString();
        const rows = result.rows.flatMap(r => {
          const identity = r.metadata.contact_identity;
          if (!identity) { summary.missing_identity.push(r.ad_id); return []; }
          if (identity.page_id) summary.page_available++;
          if (identity.whatsapp_phone_numbers.length) summary.phone_available++; else summary.missing_phone.push(r.ad_id);
          return [{ account_id: r.account_id, ad_id: r.ad_id, creative_id: r.creative_id, adset_id: r.adset_id, identity, observed_at: observedAt }];
        });
        observations.push(...rows);
        if (apply && rows.length) {
          const saved = ok(await db.rpc('save_meta_ad_contact_identities', { p_workspace_id: workspaceId, p_rows: rows })) as { saved: number; skipped: { ad_id: string; reason: string }[] };
          summary.saved += saved.saved; summary.skipped.push(...saved.skipped);
        }
        console.log(JSON.stringify({ event: 'batch', workspace: workspace.slug, account_id: accountId, read: summary.read, saved: summary.saved,
          page_available: summary.page_available, phone_available: summary.phone_available, failed: summary.failures.length, skipped: summary.skipped.length }));
        if (result.failures.some(f => [190, 4, 17, 32, 613, 80004].includes(f.code || 0))) throw new Error('Meta authentication/rate limit failure; stop and inspect before retrying.');
      }
    }
  }
  const output = arg('summary-file');
  if (output) writeFileSync(resolve(output), JSON.stringify(summary, null, 2), { mode: 0o600 });
  const observationFile = arg('observations-file');
  if (observationFile) writeFileSync(resolve(observationFile), JSON.stringify({ workspace_id: workspaceId, rows: observations }), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ event: 'complete', ...summary }));
  if (summary.failures.length || summary.skipped.length || summary.missing_identity.length) process.exitCode = 2;
}
main().catch(e => { console.error(JSON.stringify({ event: 'error', message: e instanceof Error ? e.message : 'Contact backfill failed' })); process.exitCode = 1; });
