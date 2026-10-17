import type { SupabaseClient } from '@supabase/supabase-js';
import { createSyncJobDedupeKey, enqueueSyncJob } from './sync-jobs';
import { linkMetaSyncJobs } from './meta-sync-job-tree';
import { requireExplicitWorkspaceId } from './workspace-scope';

export async function enqueueNewMetaProductSets(svc: SupabaseClient, workspaceId: string, accountId: string,
  productSetIds: string[], enqueue = enqueueSyncJob, now = new Date(), parentJobId?: string) {
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
    const basePayload = { ad_mapping_only: true, verify_shopee_product_set: true, account_id: accountId, product_set_id };
    const payload = { ...basePayload, ...(parentJobId ? { meta_parent_job_id: parentJobId } : {}) };
    const result = await enqueue({ workspaceId, jobName: 'meta_sync', route: '/dashboard/meta-funnels',
      mode: 'meta_product_set_verify', payload, priority: 19, maxAttempts: 2,
      dedupeKey: createSyncJobDedupeKey('meta_sync', 'meta_product_set_verify', basePayload) });
    jobs.push(result.job.id);
  }
  if (parentJobId) await linkMetaSyncJobs(svc, workspaceId, parentJobId, jobs);
  return jobs;
}
