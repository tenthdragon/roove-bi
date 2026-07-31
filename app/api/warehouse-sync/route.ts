import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { createSyncJobDedupeKey, enqueueSyncJob } from '@/lib/sync-jobs';
import { getRequestId, logRouteEvent } from '@/lib/structured-logger';
import { resolveScheduledWorkspaceIds } from '@/lib/workspace-scheduler';

export const maxDuration = 60;

async function queueWarehouseSync(request: NextRequest, method: 'GET' | 'POST') {
  const startTime = Date.now();
  const requestId = getRequestId(request);
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const secret = method === 'GET' ? new URL(request.url).searchParams.get('secret') : null;
  const isCron = !!cronSecret && (
    authHeader === `Bearer ${cronSecret}` ||
    (method === 'GET' && secret === cronSecret)
  );
  const mode = `${isCron ? 'cron' : 'dashboard'}_${method.toLowerCase()}`;
  let requestedBy: string | null = null;
  let workspaceId: string | null = null;

  logRouteEvent({
    route: '/api/warehouse-sync',
    job: 'warehouse_sync',
    mode,
    status: 'start',
    request_id: requestId,
  });

  if (!isCron) {
    const originError = rejectUntrustedOrigin(request);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(request);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      request,
      'warehouse-sync',
      8,
      10 * 60 * 1000,
      'Terlalu banyak permintaan Warehouse Sync. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    try {
      const access = await requireDashboardPermissionAccess('admin:warehouse', 'Admin Warehouse');
      const { profile } = access;
      requestedBy = profile.id;
      workspaceId = access.workspaceId;
    } catch (err: any) {
      const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
      logRouteEvent({
        route: '/api/warehouse-sync',
        job: 'warehouse_sync',
        mode,
        status: 'denied',
        request_id: requestId,
        duration_ms: Date.now() - startTime,
        extra: { error: err.message, http_status: status },
      });
      return NextResponse.json({ error: err.message }, { status });
    }
  }

  try {
    const queueMode = isCron ? 'cron' : 'manual';
    const workspaceIds = isCron
      ? await resolveScheduledWorkspaceIds(
          new URL(request.url).searchParams.get('workspace_id'),
          'warehouse',
        )
      : [workspaceId!];
    const queuedJobs = [];
    for (const scheduledWorkspaceId of workspaceIds) {
      queuedJobs.push(await enqueueSyncJob({
        workspaceId: scheduledWorkspaceId,
        jobName: 'warehouse_sync',
        route: '/api/warehouse-sync',
        mode: queueMode,
        payload: {},
        dedupeKey: createSyncJobDedupeKey('warehouse_sync', queueMode, {}),
        requestedBy,
        requestId,
        maxAttempts: 3,
        priority: isCron ? 35 : 45,
      }));
    }
    const primary = queuedJobs[0] || null;

    logRouteEvent({
      route: '/api/warehouse-sync',
      job: 'warehouse_sync',
      mode,
      status: 'success',
      request_id: requestId,
      duration_ms: Date.now() - startTime,
      rows_processed: 1,
      extra: {
        queued: true,
        duplicate: queuedJobs.length > 0 && queuedJobs.every((item) => item.isDuplicate),
        job_ids: queuedJobs.map((item) => item.job.id).join(','),
      },
    });

    return NextResponse.json({
      queued: true,
      duplicate: queuedJobs.length > 0 && queuedJobs.every((item) => item.isDuplicate),
      job_id: primary?.job.id || null,
      job_ids: queuedJobs.map((item) => item.job.id),
      status: primary?.job.status || 'success',
      message: queuedJobs.length === 0
        ? 'Tidak ada workspace dengan koneksi warehouse aktif.'
        : `${queuedJobs.length} sync warehouse diproses.`,
    }, { status: 202 });
  } catch (err: any) {
    console.error('[Warehouse Sync API] Error:', err);
    logRouteEvent({
      route: '/api/warehouse-sync',
      job: 'warehouse_sync',
      mode,
      status: 'failed',
      request_id: requestId,
      duration_ms: Date.now() - startTime,
      extra: { error: err.message },
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return queueWarehouseSync(request, 'POST');
}

export async function GET(request: NextRequest) {
  return queueWarehouseSync(request, 'GET');
}
