import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { resolveWorkspaceCredential } from '../../lib/workspace-integration-server';
import { verifyShopeeProductSet } from '../../lib/meta-ad-destination-metadata';
import { classifyMetaCpas } from '../../lib/meta-cpas-evidence';

async function main() {
  const workspaceId = process.argv.find(v => v.startsWith('--workspace='))?.slice(12);
  if (!workspaceId || !/^[a-f0-9-]{36}$/.test(workspaceId)) throw new Error('Explicit --workspace=<UUID> required.');
  if (existsSync('.env.local')) for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || /^\s*#/.test(line)) continue;
    const i = line.indexOf('='), key = line.slice(0, i).trim();
    process.env[key] ||= line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  const apply = process.argv.includes('--apply');
  const reclassifyOnly = process.argv.includes('--reclassify-only');
  const unverifiedOnly = process.argv.includes('--unverified-only');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = await resolveWorkspaceCredential({ supabase: db, workspaceId, provider: 'meta', fallbackEnvKeys: ['META_ACCESS_TOKEN'] });
  const observations: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await db.from('meta_ad_destination_metadata').select('*').eq('workspace_id', workspaceId).order('account_id').order('ad_id').range(offset, offset + 999);
    if (page.error) throw page.error;
    observations.push(...page.data); if (page.data.length < 1000) break;
  }
  const sets = new Map<string, Set<string>>();
  for (const row of observations) {
    if (!sets.has(row.account_id)) sets.set(row.account_id, new Set());
    for (const id of row.metadata.product_set_ids) sets.get(row.account_id)!.add(id);
  }
  const verifiedByAccount = new Map<string, string[]>(); let verifiedCount = 0, failedCount = 0;
  const existing = await db.from('meta_shopee_product_sets').select('account_id,product_set_id').eq('workspace_id', workspaceId);
  if (existing.error) throw existing.error;
  for (const row of existing.data || []) verifiedByAccount.set(row.account_id, [...(verifiedByAccount.get(row.account_id) || []), row.product_set_id]);
  if (!reclassifyOnly) for (const [accountId, ids] of sets) for (const id of ids) {
    if (unverifiedOnly && verifiedByAccount.get(accountId)?.includes(id)) continue;
    try {
      const verification = await verifyShopeeProductSet(id, token);
      if (apply) {
        const saved = await db.from('meta_shopee_product_sets').upsert({ workspace_id: workspaceId, account_id: accountId, product_set_id: id, verification, verified_at: new Date().toISOString() }, { onConflict: 'workspace_id,account_id,product_set_id' });
        if (saved.error) throw saved.error;
      }
      verifiedByAccount.set(accountId, [...new Set([...(verifiedByAccount.get(accountId) || []), id])]); verifiedCount++;
      console.log(JSON.stringify({ event: 'product_set_verified', account_id: accountId, product_set_id: id, product_count: verification.product_count, apply }));
    } catch (e: any) {
      failedCount++;
      console.log(JSON.stringify({ event: 'product_set_unverified', account_id: accountId, product_set_id: id, error: e.message }));
    }
  }
  let changed = 0;
  for (let offset = 0; offset < observations.length; offset += 100) {
    const changedRows = observations.slice(offset, offset + 100).flatMap(row => {
      const classification = classifyMetaCpas(row.metadata, verifiedByAccount.get(row.account_id) || []);
      return row.classification !== classification.classification || JSON.stringify(row.evidence) !== JSON.stringify(classification.evidence)
        ? [{ ...row, ...classification }] : [];
    });
    if (apply && changedRows.length) {
      const saved = await db.from('meta_ad_destination_metadata').upsert(changedRows, { onConflict: 'workspace_id,account_id,ad_id' });
      if (saved.error) throw saved.error;
    }
    changed += changedRows.length;
  }
  console.log(JSON.stringify({ event: 'complete', observations: observations.length, verified_product_sets: verifiedCount, unverified_product_sets: failedCount, reclassified_ads: changed, apply, reclassify_only: reclassifyOnly }));
}
main().catch(e => { console.error(JSON.stringify({ event: 'error', message: e.message || String(e) })); process.exitCode = 1; });
