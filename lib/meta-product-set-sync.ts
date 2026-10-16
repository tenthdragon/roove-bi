import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceSupabase } from './service-supabase';
import { requireExplicitWorkspaceId } from './workspace-scope';
import { resolveWorkspaceCredential } from './workspace-integration-server';
import { verifyShopeeProductSet, type MetaDestinationMetadata } from './meta-ad-destination-metadata';
import { classifyMetaCpas } from './meta-cpas-evidence';

const defaultDependencies = { createServiceSupabase, resolveWorkspaceCredential, verifyShopeeProductSet, now: () => new Date() };

export function nextProductSetRetryAt(now: Date) {
  const wibDay = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  return new Date(Date.parse(`${wibDay}T00:00:00+07:00`) + 86400000).toISOString();
}

async function applyVerifiedProductSet(svc: SupabaseClient, workspaceId: string, accountId: string, productSetId: string) {
  const registry = await svc.from('meta_shopee_product_sets').select('product_set_id')
    .eq('workspace_id', workspaceId).eq('account_id', accountId);
  if (registry.error) throw new Error(registry.error.message);
  const verified = (registry.data || []).map(r => r.product_set_id);
  let changed = 0;
  for (let offset = 0; ; offset += 500) {
    const page = await svc.from('meta_ad_destination_metadata').select('ad_id,metadata,classification,evidence')
      .eq('workspace_id', workspaceId).eq('account_id', accountId)
      .contains('metadata', { product_set_ids: [productSetId] }).order('ad_id').range(offset, offset + 499);
    if (page.error) throw new Error(page.error.message);
    const rows = (page.data || []).flatMap(r => {
      const classification = classifyMetaCpas(r.metadata as MetaDestinationMetadata, verified);
      return r.classification !== classification.classification || JSON.stringify(r.evidence) !== JSON.stringify(classification.evidence)
        ? [{ ad_id: r.ad_id, metadata: r.metadata, ...classification }] : [];
    });
    if (rows.length) {
      const saved = await svc.rpc('apply_meta_product_set_classifications', { p_workspace_id: workspaceId,
        p_account_id: accountId, p_product_set_id: productSetId, p_rows: rows });
      if (saved.error) throw new Error(saved.error.message);
      changed += Number(saved.data || 0);
    }
    if ((page.data || []).length < 500) break;
  }
  return changed;
}

/** One product set per queue job. Provider reads have a shared 20-second budget. */
export async function runMetaProductSetVerification(options: { workspaceId: string; accountId: string; productSetId: string }, dependencies = defaultDependencies) {
  const workspaceId = requireExplicitWorkspaceId(options.workspaceId, 'Verifikasi product set');
  const { accountId, productSetId } = options;
  if (!/^act_\d+$/.test(accountId) || !/^\d+$/.test(productSetId)) throw new Error('Scope product set tidak valid.');
  const svc = dependencies.createServiceSupabase();
  const account = await svc.from('meta_ad_accounts').select('account_id').eq('workspace_id', workspaceId)
    .eq('account_id', accountId).eq('is_active', true).maybeSingle();
  if (account.error) throw new Error(account.error.message);
  if (!account.data) throw new Error('Akun product set tidak aktif atau berada di luar workspace.');
  const owned = await svc.from('meta_ad_destination_metadata').select('ad_id').eq('workspace_id', workspaceId)
    .eq('account_id', accountId).contains('metadata', { product_set_ids: [productSetId] }).limit(1);
  if (owned.error) throw new Error(owned.error.message);
  if (!owned.data?.length) throw new Error('Product set belum diamati pada ad dalam workspace/akun ini.');
  const registry = await svc.from('meta_shopee_product_sets').select('product_set_id').eq('workspace_id', workspaceId)
    .eq('account_id', accountId).eq('product_set_id', productSetId).maybeSingle();
  if (registry.error) throw new Error(registry.error.message);
  if (registry.data) return { status: 'success' as const, rows_inserted: await applyVerifiedProductSet(svc, workspaceId, accountId, productSetId),
    product_set_id: productSetId, already_verified: true, warnings: [] };
  const attempt = await svc.from('meta_product_set_verification_attempts').select('retry_after,error_message').eq('workspace_id', workspaceId)
    .eq('account_id', accountId).eq('product_set_id', productSetId).maybeSingle();
  if (attempt.error) throw new Error(attempt.error.message);
  const now = dependencies.now();
  if (attempt.data && Date.parse(attempt.data.retry_after) > now.getTime()) return { status: 'partial' as const,
    rows_inserted: 0, product_set_id: productSetId, retry_after: attempt.data.retry_after, warnings: [attempt.data.error_message] };
  const token = await dependencies.resolveWorkspaceCredential({ supabase: svc, workspaceId, provider: 'meta', fallbackEnvKeys: ['META_ACCESS_TOKEN'] });
  let verification: Awaited<ReturnType<typeof verifyShopeeProductSet>>;
  try {
    verification = await dependencies.verifyShopeeProductSet(productSetId, token, { signal: AbortSignal.timeout(20000) });
  } catch (e) {
    const error = String(e instanceof Error ? e.message : e).split(token).join('[redacted]').slice(0, 600);
    const checkedAt = dependencies.now();
    const retryAfter = nextProductSetRetryAt(checkedAt);
    const saved = await svc.from('meta_product_set_verification_attempts').upsert({ workspace_id: workspaceId, account_id: accountId,
      product_set_id: productSetId, checked_at: checkedAt.toISOString(), retry_after: retryAfter, error_message: error }, { onConflict: 'workspace_id,account_id,product_set_id' });
    if (saved.error) throw new Error(saved.error.message);
    return { status: 'partial' as const, rows_inserted: 0, product_set_id: productSetId, retry_after: retryAfter, warnings: [error] };
  }
  const saved = await svc.from('meta_shopee_product_sets').upsert({ workspace_id: workspaceId, account_id: accountId,
    product_set_id: productSetId, verification, verified_at: dependencies.now().toISOString() }, { onConflict: 'workspace_id,account_id,product_set_id' });
  if (saved.error) throw new Error(saved.error.message);
  const cleared = await svc.from('meta_product_set_verification_attempts').delete().eq('workspace_id', workspaceId)
    .eq('account_id', accountId).eq('product_set_id', productSetId);
  if (cleared.error) throw new Error(cleared.error.message);
  return { status: 'success' as const, rows_inserted: await applyVerifiedProductSet(svc, workspaceId, accountId, productSetId),
    product_set_id: productSetId, product_count: verification.product_count, already_verified: false, warnings: [] };
}
