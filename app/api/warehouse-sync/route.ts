// app/api/warehouse-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { triggerWarehouseSync } from '@/lib/warehouse-actions';
import { getRequestId, logRouteEvent } from '@/lib/structured-logger';

export const maxDuration = 250;

async function runWarehouseSync(request: NextRequest, method: 'GET' | 'POST') {
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

  logRouteEvent({
    route: '/api/warehouse-sync',
    job: 'warehouse_sync',
    mode,
    status: 'start',
    request_id: requestId,
  });

  if (!isCron) {
    try {
      await requireDashboardPermissionAccess('admin:warehouse', 'Admin Warehouse');
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
    const result = await triggerWarehouseSync({ skipAuth: true });
    logRouteEvent({
      route: '/api/warehouse-sync',
      job: 'warehouse_sync',
      mode,
      status: result.failed > 0 ? 'partial' : 'success',
      request_id: requestId,
      duration_ms: Date.now() - startTime,
      rows_processed: result.results.length,
      extra: {
        synced: result.synced,
        failed: result.failed,
      },
    });
    return NextResponse.json(result);
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
  return runWarehouseSync(request, 'POST');
}

export async function GET(request: NextRequest) {
  return runWarehouseSync(request, 'GET');
}
