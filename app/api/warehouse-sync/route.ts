import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { createSyncJobDedupeKey, enqueueSyncJob } from '@/lib/sync-jobs';
import { getRequestId, logRouteEvent } from '@/lib/structured-logger';

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

  logRouteEvent({
    route: '/api/warehouse-sync',
    job: 'warehouse_sync',
    mode,
    status: 'start',
    request_id: requestId,
  });

  if (!isCron) {
    try {
      const { profile } = await requireDashboardPermissionAccess('admin:warehouse', 'Admin Warehouse');
      requestedBy = profile.id;
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
    const { job, isDuplicate } = await enqueueSyncJob({
      jobName: 'warehouse_sync',
      route: '/api/warehouse-sync',
      mode: queueMode,
      payload: {},
      dedupeKey: createSyncJobDedupeKey('warehouse_sync', queueMode, {}),
      requestedBy,
      requestId,
      maxAttempts: 3,
      priority: isCron ? 35 : 45,
    });

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
        duplicate: isDuplicate,
        job_id: job.id,
      },
    });

    return NextResponse.json({
      queued: true,
      duplicate: isDuplicate,
      job_id: job.id,
      status: job.status,
      message: isDuplicate
        ? 'Sync warehouse sudah ada di antrean atau sedang berjalan.'
        : 'Sync warehouse berhasil dimasukkan ke antrean.',
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
