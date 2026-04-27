import { NextRequest, NextResponse } from 'next/server';
import { executeSyncJob } from '@/lib/sync-job-runners';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import {
  claimNextSyncJob,
  failSyncJob,
  finalizeSyncJob,
  requeueStaleSyncJobs,
  type SyncJobTerminalStatus,
} from '@/lib/sync-jobs';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { getRequestId, logRouteEvent } from '@/lib/structured-logger';

export const maxDuration = 60;

function getWorkerId() {
  return `http-worker:${process.pid}`;
}

async function runOneJob(requestId: string) {
  const workerId = getWorkerId();
  const job = await claimNextSyncJob(workerId);

  if (!job) {
    return null;
  }

  const startedAt = Date.now();

  logRouteEvent({
    route: '/api/sync-jobs-worker',
    job: job.job_name,
    mode: `http-worker:${job.mode}`,
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
      route: '/api/sync-jobs-worker',
      job: job.job_name,
      mode: `http-worker:${job.mode}`,
      status: result.status,
      request_id: requestId,
      duration_ms: Date.now() - startedAt,
      rows_processed: result.rowsProcessed ?? undefined,
      extra: {
        job_id: job.id,
      },
    });

    return {
      job_id: job.id,
      job_name: job.job_name,
      status: result.status,
      rows_processed: result.rowsProcessed,
      result_summary: result.resultSummary,
    };
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);

    await failSyncJob(job.id, message, Date.now() - startedAt);

    logRouteEvent({
      route: '/api/sync-jobs-worker',
      job: job.job_name,
      mode: `http-worker:${job.mode}`,
      status: 'failed',
      request_id: requestId,
      duration_ms: Date.now() - startedAt,
      extra: {
        job_id: job.id,
        error: message,
      },
    });

    return {
      job_id: job.id,
      job_name: job.job_name,
      status: 'failed',
      error: message,
    };
  }
}

async function handleRun(request: NextRequest) {
  const requestId = getRequestId(request);
  const authHeader = request.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isCron) {
    const originError = rejectUntrustedOrigin(request);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(request);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      request,
      'sync-jobs-worker',
      12,
      10 * 60 * 1000,
      'Terlalu banyak permintaan worker sync. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    try {
      await requireDashboardPermissionAccess('admin:sync', 'Admin Sync');
    } catch (err: any) {
      const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
      return NextResponse.json({ error: err.message }, { status });
    }
  }

  const url = new URL(request.url);
  const maxJobs = Math.min(Math.max(Number(url.searchParams.get('max_jobs') || 1), 1), 5);
  const requeued = await requeueStaleSyncJobs(30);
  const processed = [];

  for (let i = 0; i < maxJobs; i += 1) {
    const result = await runOneJob(requestId);
    if (!result) break;
    processed.push(result);
  }

  return NextResponse.json({
    ok: true,
    requeued_stale_jobs: requeued,
    processed_jobs: processed.length,
    jobs: processed,
  });
}

export async function GET(request: NextRequest) {
  return handleRun(request);
}

export async function POST(request: NextRequest) {
  return handleRun(request);
}
