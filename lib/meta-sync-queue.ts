import type { SupabaseClient } from '@supabase/supabase-js';
import { createSyncJobDedupeKey, enqueueSyncJob } from './sync-jobs';
import { enqueueScheduledMetaAdBatches } from './meta-funnel-sync-queue';
import { enqueueScheduledMetaAdMapping } from './meta-ad-mapping-queue';
import { getTodayWIB } from './sync-schedule';

const defaultDependencies = { enqueueSyncJob, enqueueScheduledMetaAdBatches, enqueueScheduledMetaAdMapping };
export async function enqueueIncrementalMetaSync(svc: SupabaseClient, workspaceId: string, requestedBy?: string, requestId?: string, dependencies = defaultDependencies) {
  const basePayload = { incremental: true, requested_day: getTodayWIB() };
  const payload = { ...basePayload, meta_sync_bundle: true, meta_bundle_enqueued: false };
  // Enqueue these independently: a spend failure must not prevent detail or
  // mapping updates. The shared worker applies its existing retries/backoff.
  const results = await Promise.allSettled([
    dependencies.enqueueSyncJob({ workspaceId, jobName: 'meta_sync', route: '/api/meta-sync', mode: requestedBy ? 'incremental' : 'cron',
      payload, requestedBy, requestId, dedupeKey: createSyncJobDedupeKey('meta_sync', 'incremental', basePayload), priority: 10, maxAttempts: 3 }).then(r => [r.job.id]),
    dependencies.enqueueScheduledMetaAdBatches(svc, workspaceId, undefined, requestedBy),
    dependencies.enqueueScheduledMetaAdMapping(svc, workspaceId, undefined, requestedBy),
  ]);
  const root = results[0];
  const childIds = results.slice(1).flatMap(r => r.status === 'fulfilled' ? r.value : []);
  const failed = results.find(r => r.status === 'rejected');
  if (root.status === 'fulfilled') {
    const saved = await svc.rpc('complete_meta_sync_bundle', { p_workspace_id: workspaceId, p_root_id: root.value[0],
      p_child_ids: childIds, p_queue_error: failed ? 'Sebagian batch belum berhasil masuk antrean.' : null });
    if (saved.error) throw new Error(saved.error.message);
  }
  if (failed?.status === 'rejected') throw failed.reason;
  return results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
}
