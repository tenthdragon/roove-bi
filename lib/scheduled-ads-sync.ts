import { getTodayWIB } from './sync-schedule';
import { createSyncJobDedupeKey, enqueueSyncJob } from './sync-jobs';
import { resolveScheduledWorkspaceIds } from './workspace-scheduler';

// Both HTTP timers and the CLI ads schedule enter through /api/meta-sync.
export async function enqueueScheduledAdsSync(
  workspaceId: string | null,
  requestId: string,
  dependencies = { resolveScheduledWorkspaceIds, enqueueSyncJob },
) {
  const today = getTodayWIB();
  const results = await Promise.allSettled((['meta', 'daily_ads'] as const).map(async (source) => {
    const workspaceIds = await dependencies.resolveScheduledWorkspaceIds(workspaceId, source);
    const jobName = source === 'meta' ? 'meta_sync' : 'daily_ads_sync';
    const payload: Record<string, string> = source === 'meta' ? { date_start: today, date_end: today } : {};
    const jobs = await Promise.allSettled(workspaceIds.map((id) => dependencies.enqueueSyncJob({
      workspaceId: id,
      jobName,
      route: '/api/meta-sync',
      mode: 'cron',
      payload,
      // Sheets covers its full date range; dedupe even across midnight.
      dedupeKey: createSyncJobDedupeKey(jobName, 'cron', payload),
      requestId,
      priority: source === 'meta' ? 10 : 15,
      maxAttempts: 3,
    })));
    const failed = jobs.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    return jobs.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  }));
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  return {
    queued: true,
    job_ids: results.flatMap((result) => result.status === 'fulfilled'
      ? result.value.map(({ job }) => job.id) : []),
    date_range: { start: today, end: today },
  };
}
