import type { SupabaseClient } from '@supabase/supabase-js';
import { createSyncJobDedupeKey, enqueueSyncJob } from './sync-jobs';
import { metaAdAccountRange } from './meta-incremental-sync';
import { shiftDay } from './meta-funnel-domain';

export async function enqueueMetaAdBatches(workspaceId: string, accounts: string[], from: string, to: string, requestedBy?: string) {
  const jobs: string[] = [];
  // Most recent weeks first, so monitoring is usable before older trend history finishes.
  for (let end = to; end >= from; end = shiftDay(end, -7)) {
    const start = [shiftDay(end, -6), from].sort()[1];
    const results = await Promise.all(accounts.map(async account_id => {
      const payload = { ad_funnels_only: true, account_id, date_start: start, date_end: end };
      const result = await enqueueSyncJob({ workspaceId, jobName: 'meta_sync', route: '/dashboard/meta-funnels', mode: 'ad_funnels',
        payload, requestedBy, dedupeKey: createSyncJobDedupeKey('meta_sync', 'ad_funnels', payload), maxAttempts: 3, priority: 20 });
      return result.job.id;
    }));
    jobs.push(...results);
  }
  return jobs;
}
export async function enqueueScheduledMetaAdBatches(svc: SupabaseClient, workspaceId: string, enqueue = enqueueMetaAdBatches, requestedBy?: string) {
  const accounts = await svc.from('meta_ad_accounts').select('account_id').eq('workspace_id', workspaceId).eq('is_active', true);
  if (accounts.error) throw new Error(accounts.error.message);
  // No saved funnel is required. Each account resumes from its own successful
  // coverage, so a failed account is not skipped when another account succeeds.
  const jobs = await Promise.all((accounts.data || []).map(async account => {
    const range = await metaAdAccountRange(svc, workspaceId, account.account_id);
    return enqueue(workspaceId, [account.account_id], range.from, range.to, requestedBy);
  }));
  return jobs.flat();
}
