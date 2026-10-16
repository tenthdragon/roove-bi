import { enqueueIncrementalMetaSync } from './meta-sync-queue';
import { createServiceSupabase } from './service-supabase';
import { createSyncJobDedupeKey, enqueueSyncJob } from './sync-jobs';
import { resolveScheduledWorkspaceIds } from './workspace-scheduler';

const defaultDependencies = { resolveScheduledWorkspaceIds, enqueueSyncJob,
  enqueueMetaSync: (id: string, requestId: string) => enqueueIncrementalMetaSync(createServiceSupabase(), id, undefined, requestId) };

// Separate schedules: Meta once at 17:00 WIB; Sheets retains its ten-minute feed.
export async function enqueueScheduledAdsSync(
  workspaceId: string | null,
  requestId: string,
  dependencies = defaultDependencies,
  source: 'meta' | 'daily_ads' = 'meta',
) {
  const workspaceIds = await dependencies.resolveScheduledWorkspaceIds(workspaceId, source);
  const results = await Promise.allSettled(workspaceIds.map(async id => {
    if (source === 'meta') return dependencies.enqueueMetaSync(id, requestId);
    const payload = {};
    const result = await dependencies.enqueueSyncJob({ workspaceId: id, jobName: 'daily_ads_sync',
      route: '/api/meta-sync', mode: 'cron', payload,
      dedupeKey: createSyncJobDedupeKey('daily_ads_sync', 'cron', payload), requestId, priority: 15, maxAttempts: 3 });
    return [result.job.id];
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return { queued: true, source,
    job_ids: results.flatMap(result => result.status === 'fulfilled' ? result.value : []) };
}
