import type { SupabaseClient } from '@supabase/supabase-js';
import { createSyncJobDedupeKey, enqueueSyncJob } from './sync-jobs';
import { createServiceSupabase } from './service-supabase';
import { linkMetaSyncJobs } from './meta-sync-job-tree';
import { getTodayWIB } from './sync-schedule';

export async function enqueueMetaAdMapping(workspaceId: string, accounts: string[], requestedBy?: string) {
  return Promise.all(accounts.map(async account_id => {
    const payload = { ad_mapping_only: true, account_id, requested_day: getTodayWIB() };
    return (await enqueueSyncJob({ workspaceId, jobName: 'meta_sync', route: '/dashboard/meta-funnels', mode: 'ad_mapping', payload, requestedBy,
      dedupeKey: createSyncJobDedupeKey('meta_sync', 'ad_mapping', payload), maxAttempts: 3, priority: 15 })).job.id;
  }));
}
export async function enqueueMetaAdMappingCreatives(workspaceId: string, accountId: string, adIds: string[], enqueue = enqueueSyncJob, parentJobId?: string, svc?: SupabaseClient) {
  const jobs: string[] = []; const ids = [...new Set(adIds)].sort();
  // One creative read plus one destination read per job. Keep the request count
  // bounded now that each ad also needs its application/catalog configuration.
  for (let offset = 0; offset < ids.length; offset += 50) {
    const basePayload = { ad_mapping_only: true, account_id: accountId, creative_ad_ids: ids.slice(offset, offset + 50), requested_day: getTodayWIB() };
    const payload = { ...basePayload, ...(parentJobId ? { meta_parent_job_id: parentJobId } : {}) };
    const result = await enqueue({ workspaceId, jobName: 'meta_sync', route: '/dashboard/meta-funnels', mode: 'ad_mapping_creatives', payload,
      dedupeKey: createSyncJobDedupeKey('meta_sync', 'ad_mapping_creatives', basePayload), maxAttempts: 3, priority: 25 });
    jobs.push(result.job.id);
  }
  if (parentJobId) await linkMetaSyncJobs(svc || createServiceSupabase(), workspaceId, parentJobId, jobs);
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
