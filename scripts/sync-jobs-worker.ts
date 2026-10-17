import { buildNextScalevSyncJobPayload } from '../lib/scalev-sync-job-payload';
import { parseSyncWorkerArgs, drainSyncQueue } from '../lib/sync-worker-loop';
import { hostname } from 'os';
import { loadEnvConfig } from '@next/env';
import { executeSyncJob } from '../lib/sync-job-runners';
import {
  claimNextSyncJob,
  createSyncJobDedupeKey,
  enqueueSyncJob,
  failSyncJob,
  finalizeSyncJob,
  requeueStaleSyncJobs,
  type SyncJobTerminalStatus,
} from '../lib/sync-jobs';
import { logRouteEvent } from '../lib/structured-logger';

loadEnvConfig(process.cwd());

async function processNextJob(workerId: string) {
  const job = await claimNextSyncJob(workerId);
  if (!job) return false;

  const requestId = job.request_id || job.id;
  const startedAt = Date.now();

  logRouteEvent({
    route: job.route,
    job: job.job_name,
    mode: `worker:${job.mode}`,
    status: 'start',
    request_id: requestId,
    extra: {
      job_id: job.id,
      attempt_count: job.attempt_count,
    },
  });

  try {
    const result = await executeSyncJob(job);
    const nextPayload = buildNextScalevSyncJobPayload(job, result.resultSummary);
    if (nextPayload) {
      await enqueueSyncJob({
        workspaceId: job.workspace_id,
        jobName: 'scalev_sync',
        route: job.route,
        mode: job.mode,
        payload: nextPayload as Record<string, any>,
        dedupeKey: createSyncJobDedupeKey('scalev_sync', job.mode, nextPayload as Record<string, any>),
        requestedBy: job.requested_by,
        requestId: job.request_id || job.id,
        maxAttempts: job.max_attempts,
        priority: job.priority,
      });
    }
    await finalizeSyncJob({
      jobId: job.id,
      status: result.status as SyncJobTerminalStatus,
      resultSummary: result.resultSummary as any,
      rowsProcessed: result.rowsProcessed,
      durationMs: Date.now() - startedAt,
    });

    logRouteEvent({
      route: job.route,
      job: job.job_name,
      mode: `worker:${job.mode}`,
      status: result.status,
      request_id: requestId,
      duration_ms: Date.now() - startedAt,
      rows_processed: result.rowsProcessed ?? undefined,
      extra: {
        job_id: job.id,
      },
    });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    await failSyncJob(job.id, message, Date.now() - startedAt);

    logRouteEvent({
      route: job.route,
      job: job.job_name,
      mode: `worker:${job.mode}`,
      status: 'failed',
      request_id: requestId,
      duration_ms: Date.now() - startedAt,
      extra: {
        job_id: job.id,
        error: message,
      },
    });
  }

  return true;
}

async function main() {
  const options = parseSyncWorkerArgs(process.argv.slice(2));
  const workerId = `${hostname()}:${process.pid}`;
  const requeued = await requeueStaleSyncJobs(options.staleAfterMinutes);

  if (requeued > 0) {
    console.warn(JSON.stringify({
      ts: new Date().toISOString(),
      worker_id: workerId,
      status: 'requeued_stale_jobs',
      count: requeued,
    }));
  }

  const processedJobs = await drainSyncQueue(options, () => processNextJob(workerId));

  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    worker_id: workerId,
    status: 'idle',
    processed_jobs: processedJobs,
  }));
}

main().catch((err: any) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    status: 'worker_failed',
    error: message,
  }));
  process.exit(1);
});
