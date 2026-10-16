import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { resolveWorkspaceCredential } from '../../lib/workspace-integration-server';
import { fetchAdDestinationBatch } from '../../lib/meta-ad-destination-metadata';
import { classifyMetaCpas } from '../../lib/meta-cpas-evidence';

const arg = (name: string) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
async function main() {
  const workspaceId = arg('workspace');
  if (!workspaceId || !/^[a-f0-9-]{36}$/.test(workspaceId)) throw new Error('Explicit --workspace=<UUID> required.');
  const envFile = resolve(arg('env-file') || '.env.local');
  if (existsSync(envFile)) for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || /^\s*#/.test(line)) continue;
    const i = line.indexOf('='), key = line.slice(0, i).trim();
    process.env[key] ||= line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  const apply = process.argv.includes('--apply');
  const resume = process.argv.includes('--resume');
  const maxBatches = Number(arg('max-batches') || '0');
  if (!Number.isInteger(maxBatches) || maxBatches < 0) throw new Error('Invalid max-batches.');
  const checkpoint = resolve(arg('checkpoint') || `.local/meta-cpas-backfill-${workspaceId}.jsonl`);
  mkdirSync(dirname(checkpoint), { recursive: true, mode: 0o700 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const workspace = await db.from('workspaces').select('id,slug,name').eq('id', workspaceId).single();
  if (workspace.error) throw workspace.error;
  const token = await resolveWorkspaceCredential({ supabase: db, workspaceId, provider: 'meta', fallbackEnvKeys: ['META_ACCESS_TOKEN'] });
  const accounts = await db.from('meta_ad_accounts').select('account_id,account_name').eq('workspace_id', workspaceId);
  if (accounts.error) throw accounts.error;
  const accountNames = new Map((accounts.data || []).map(a => [a.account_id, a.account_name]));
  const verified = await db.from('meta_shopee_product_sets').select('account_id,product_set_id').eq('workspace_id', workspaceId);
  if (verified.error) throw verified.error;
  const ads: { account_id: string; ad_id: string }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await db.rpc('list_meta_ads_for_destination_backfill', { p_workspace_id: workspaceId }).range(offset, offset + 999);
    if (page.error) throw page.error;
    ads.push(...page.data); if (page.data.length < 1000) break;
  }
  const completed = new Set<string>();
  if (resume && existsSync(checkpoint)) for (const line of readFileSync(checkpoint, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    if (row.workspace_id !== workspaceId) throw new Error('Checkpoint workspace mismatch.');
    if (row.saved) completed.add(`${row.account_id}:${row.ad_id}`);
  }
  const pending = ads.filter(a => !completed.has(`${a.account_id}:${a.ad_id}`));
  console.log(JSON.stringify({ event: 'start', workspace: workspace.data, database_host: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname,
    apply, total_ads: ads.length, previously_saved: completed.size, pending: pending.length, checkpoint }));
  const summary = { read: 0, saved: 0, cpas: 0, unknown: 0, failed: 0, batches: 0 };
  for (const accountId of [...new Set(pending.map(a => a.account_id))]) {
    const ids = pending.filter(a => a.account_id === accountId).map(a => a.ad_id);
    for (let offset = 0; offset < ids.length; offset += 50) {
      if (maxBatches && summary.batches >= maxBatches) break;
      const batch = ids.slice(offset, offset + 50), observedAt = new Date().toISOString();
      const result = await fetchAdDestinationBatch(batch, token);
      if (result.rows.some(r => r.account_id !== accountId)) throw new Error('Meta returned a different account; batch not written.');
      const rows = result.rows.map(r => ({ workspace_id: workspaceId, account_id: accountId, ad_id: r.ad_id,
        creative_id: r.creative_id, adset_id: r.adset_id, destination_type: r.metadata.destination_type,
        metadata: r.metadata, ...classifyMetaCpas(r.metadata, (verified.data || []).filter(v => v.account_id === accountId).map(v => v.product_set_id)), observed_at: observedAt }));
      if (apply && rows.length) {
        const saved = await db.from('meta_ad_destination_metadata').upsert(rows, { onConflict: 'workspace_id,account_id,ad_id' });
        if (saved.error) throw saved.error;
        summary.saved += rows.length;
      }
      for (const row of rows) appendFileSync(checkpoint, JSON.stringify({ ...row, saved: apply }) + '\n', { mode: 0o600 });
      for (const failure of result.failures) appendFileSync(checkpoint, JSON.stringify({ workspace_id: workspaceId, account_id: accountId, ...failure, saved: false, observed_at: observedAt }) + '\n', { mode: 0o600 });
      summary.batches++; summary.read += rows.length; summary.failed += result.failures.length;
      summary.cpas += rows.filter(r => r.classification === 'cpas').length;
      summary.unknown += rows.filter(r => r.classification === 'unknown').length;
      console.log(JSON.stringify({ event: 'batch', account: accountNames.get(accountId), batch_size: batch.length, ...summary, failures: result.failures }));
      if (result.failures.some(f => f.code === 190)) throw new Error('Meta token invalid/expired; checkpoint retained.');
      if (result.failures.some(f => [4,17,32,613,80004].includes(f.code || 0))) throw new Error('Meta rate limit; resume after cooldown using checkpoint.');
    }
    if (maxBatches && summary.batches >= maxBatches) break;
  }
  console.log(JSON.stringify({ event: 'complete', ...summary, skipped_previously_saved: completed.size, total_ads: ads.length }));
}
main().catch(e => { console.error(JSON.stringify({ event: 'error', message: e.message || String(e) })); process.exitCode = 1; });
