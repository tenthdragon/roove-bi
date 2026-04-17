// app/api/financial-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { triggerFinancialSync } from '@/lib/financial-actions';
import { getRequestId, logRouteEvent } from '@/lib/structured-logger';

export const maxDuration = 120; // Allow up to 2 minutes for parsing

async function runFinancialSync(request: NextRequest, method: 'GET' | 'POST') {
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
    route: '/api/financial-sync',
    job: 'financial_sync',
    mode,
    status: 'start',
    request_id: requestId,
  });

  if (!isCron) {
    try {
      await requireDashboardPermissionAccess('admin:financial', 'Admin Financial');
    } catch (err: any) {
      const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
      logRouteEvent({
        route: '/api/financial-sync',
        job: 'financial_sync',
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
    const result = await triggerFinancialSync({ skipAuth: true });
    logRouteEvent({
      route: '/api/financial-sync',
      job: 'financial_sync',
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
    console.error('[Financial Sync API] Error:', err);
    logRouteEvent({
      route: '/api/financial-sync',
      job: 'financial_sync',
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
  return runFinancialSync(request, 'POST');
}

// GET endpoint for cron jobs
export async function GET(request: NextRequest) {
  return runFinancialSync(request, 'GET');
}
