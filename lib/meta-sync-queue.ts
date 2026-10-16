import type { SupabaseClient } from '@supabase/supabase-js';
import { createSyncJobDedupeKey, enqueueSyncJob } from './sync-jobs';
import { enqueueScheduledMetaAdBatches } from './meta-funnel-sync-queue';
import { enqueueScheduledMetaAdMapping } from './meta-ad-mapping-queue';
import { getTodayWIB } from './sync-schedule';

const defaultDependencies = { enqueueSyncJob, enqueueScheduledMetaAdBatches, enqueueScheduledMetaAdMapping };
export async function enqueueIncrementalMetaSync(svc: SupabaseClient, workspaceId: string, requestedBy?: string, requestId?: string, dependencies = defaultDependencies) {
  const payload = { incremental: true, requested_day: getTodayWIB() };
  // Enqueue these independently: a spend failure must not prevent detail or
  // mapping updates. The shared worker applies its existing retries/backoff.
  const results = await Promise.allSettled([
    dependencies.enqueueSyncJob({ workspaceId, jobName: 'meta_sync', route: '/api/meta-sync', mode: requestedBy ? 'incremental' : 'cron',
      payload, requestedBy, requestId, dedupeKey: createSyncJobDedupeKey('meta_sync', 'incremental', payload), priority: 10, maxAttempts: 3 }).then(r => [r.job.id]),
    dependencies.enqueueScheduledMetaAdBatches(svc, workspaceId, undefined, requestedBy),
    dependencies.enqueueScheduledMetaAdMapping(svc, workspaceId, undefined, requestedBy),
  ]);
  const failed = results.find(r => r.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}
