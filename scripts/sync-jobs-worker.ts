import { hostname } from 'os';
import { loadEnvConfig } from '@next/env';
import { executeSyncJob } from '../lib/sync-job-runners';
import {
  claimNextSyncJob,
  failSyncJob,
  finalizeSyncJob,
  requeueStaleSyncJobs,
  type SyncJobTerminalStatus,
} from '../lib/sync-jobs';
import { logRouteEvent } from '../lib/structured-logger';

loadEnvConfig(process.cwd());

type WorkerOptions = {
  loop: boolean;
  pollMs: number;
  staleAfterMinutes: number;
  maxJobs: number | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv: string[]): WorkerOptions {
  const options: WorkerOptions = {
    loop: false,
    pollMs: 5000,
    staleAfterMinutes: 30,
    maxJobs: null,
  };

  for (const arg of argv) {
    if (arg === '--loop') {
      options.loop = true;
      continue;
    }

    if (arg.startsWith('--poll-ms=')) {
      options.pollMs = parsePositiveInt(arg.split('=')[1], options.pollMs);
      continue;
    }

    if (arg.startsWith('--stale-after-minutes=')) {
      options.staleAfterMinutes = parsePositiveInt(arg.split('=')[1], options.staleAfterMinutes);
      continue;
    }

    if (arg.startsWith('--max-jobs=')) {
      options.maxJobs = parsePositiveInt(arg.split('=')[1], 1);
    }
  }

  return options;
}

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
  const options = parseArgs(process.argv.slice(2));
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

  let processedJobs = 0;

  while (true) {
    const processed = await processNextJob(workerId);
    if (processed) {
      processedJobs += 1;
      if (options.maxJobs && processedJobs >= options.maxJobs) {
        break;
      }
      continue;
    }

    if (!options.loop) {
      break;
    }

    await sleep(options.pollMs);
  }

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
