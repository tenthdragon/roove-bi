import type { SupabaseClient } from '@supabase/supabase-js';
import { createSyncJobDedupeKey, enqueueSyncJob } from './sync-jobs';
import { requireExplicitWorkspaceId } from './workspace-scope';

export async function enqueueNewMetaProductSets(svc: SupabaseClient, workspaceId: string, accountId: string,
  productSetIds: string[], enqueue = enqueueSyncJob, now = new Date()) {
  requireExplicitWorkspaceId(workspaceId, 'Verifikasi product set');
  if (!/^act_\d+$/.test(accountId) || productSetIds.some(id => !/^\d+$/.test(id))) throw new Error('Scope product set tidak valid.');
  const ids = [...new Set(productSetIds)].sort();
  if (!ids.length) return [];
  const verified = await svc.from('meta_shopee_product_sets').select('product_set_id')
    .eq('workspace_id', workspaceId).eq('account_id', accountId).in('product_set_id', ids);
  if (verified.error) throw new Error(verified.error.message);
  const attempts = await svc.from('meta_product_set_verification_attempts').select('product_set_id,retry_after')
    .eq('workspace_id', workspaceId).eq('account_id', accountId).in('product_set_id', ids);
  if (attempts.error) throw new Error(attempts.error.message);
  const known = new Set((verified.data || []).map(r => r.product_set_id));
  const cooling = new Set((attempts.data || []).filter(r => Date.parse(r.retry_after) > now.getTime()).map(r => r.product_set_id));
  const jobs: string[] = [];
  for (const product_set_id of ids) {
    if (known.has(product_set_id) || cooling.has(product_set_id)) continue;
    const payload = { ad_mapping_only: true, verify_shopee_product_set: true, account_id: accountId, product_set_id };
    const result = await enqueue({ workspaceId, jobName: 'meta_sync', route: '/dashboard/meta-funnels',
      mode: 'meta_product_set_verify', payload, priority: 19, maxAttempts: 2,
      dedupeKey: createSyncJobDedupeKey('meta_sync', 'meta_product_set_verify', payload) });
    jobs.push(result.job.id);
  }
  return jobs;
}
