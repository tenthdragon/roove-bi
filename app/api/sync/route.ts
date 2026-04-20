import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { runDailyAdsSync } from '@/lib/daily-ads-sync-runner';
import { getRequestId, logRouteEvent } from '@/lib/structured-logger';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const requestId = getRequestId(req);
  const authHeader = req.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const mode = isCron ? 'cron_post' : 'dashboard_post';
  let requestedBy: string | null = null;

  logRouteEvent({
    route: '/api/sync',
    job: 'daily_ads_sync',
    mode,
    status: 'start',
    request_id: requestId,
  });

  try {
    if (!isCron) {
      try {
        const { profile } = await requireDashboardPermissionAccess('admin:daily', 'Admin Daily Data');
        requestedBy = profile.id;
      } catch (err: any) {
        const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
        logRouteEvent({
          route: '/api/sync',
          job: 'daily_ads_sync',
          mode,
          status: 'denied',
          request_id: requestId,
          duration_ms: Date.now() - startTime,
          extra: { error: err.message, http_status: status },
        });
        return NextResponse.json({ error: err.message }, { status });
      }
    }

    const result = await runDailyAdsSync();
    const status = result.failed === 0 ? 'success' : result.synced > 0 ? 'partial' : 'failed';

    logRouteEvent({
      route: '/api/sync',
      job: 'daily_ads_sync',
      mode,
      status,
      request_id: requestId,
      duration_ms: Date.now() - startTime,
      rows_processed: result.rows_inserted,
      extra: {
        requested_by: requestedBy,
        synced: result.synced,
        failed: result.failed,
      },
    });

    return NextResponse.json({
      queued: false,
      status,
      message: result.message,
      synced: result.synced,
      failed: result.failed,
      rows_inserted: result.rows_inserted,
      results: result.results,
    }, { status: status === 'failed' ? 500 : 200 });
  } catch (err: any) {
    console.error('Sync API error:', err);
    logRouteEvent({
      route: '/api/sync',
      job: 'daily_ads_sync',
      mode,
      status: 'failed',
      request_id: requestId,
      duration_ms: Date.now() - startTime,
      extra: { error: err.message },
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
