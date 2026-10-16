import type { SupabaseClient } from '@supabase/supabase-js';
import { createSyncJobDedupeKey, enqueueSyncJob } from './sync-jobs';
import { getTodayWIB } from './sync-schedule';

export async function enqueueMetaAdMapping(workspaceId: string, accounts: string[], requestedBy?: string) {
  return Promise.all(accounts.map(async account_id => {
    const payload = { ad_mapping_only: true, account_id, requested_day: getTodayWIB() };
    return (await enqueueSyncJob({ workspaceId, jobName: 'meta_sync', route: '/dashboard/meta-funnels', mode: 'ad_mapping', payload, requestedBy,
      dedupeKey: createSyncJobDedupeKey('meta_sync', 'ad_mapping', payload), maxAttempts: 3, priority: 25 })).job.id;
  }));
}
export async function enqueueMetaAdMappingCreatives(workspaceId: string, accountId: string, adIds: string[], enqueue = enqueueSyncJob) {
  const jobs: string[] = []; const ids = [...new Set(adIds)].sort();
  // At most two Meta batch requests per job, within the HTTP worker's 60s limit.
  for (let offset = 0; offset < ids.length; offset += 100) {
    const payload = { ad_mapping_only: true, account_id: accountId, creative_ad_ids: ids.slice(offset, offset + 100), requested_day: getTodayWIB() };
    const result = await enqueue({ workspaceId, jobName: 'meta_sync', route: '/dashboard/meta-funnels', mode: 'ad_mapping_creatives', payload,
      dedupeKey: createSyncJobDedupeKey('meta_sync', 'ad_mapping_creatives', payload), maxAttempts: 3, priority: 20 });
    jobs.push(result.job.id);
  }
  return jobs;
}
export async function enqueueScheduledMetaAdMapping(svc: SupabaseClient, workspaceId: string, enqueue = enqueueMetaAdMapping, requestedBy?: string) {
  const accounts = await svc.from('meta_ad_accounts').select('account_id').eq('workspace_id', workspaceId).eq('is_active', true);
  if (accounts.error) throw new Error(accounts.error.message);
  // Inventory is current metadata rather than a historical Insights range.
  // Refresh it in every daily/manual bundle, including ads added since a manual
  // sync earlier today. Active jobs are deduplicated by the queue as before.
  const ids = (accounts.data || []).map(a => a.account_id);
  return ids.length ? enqueue(workspaceId, ids, requestedBy) : [];
}
