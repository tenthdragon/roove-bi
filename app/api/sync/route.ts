import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { runDailyAdsSync } from '@/lib/daily-ads-sync-runner';
import { getRequestId, logRouteEvent } from '@/lib/structured-logger';
import { resolveScheduledWorkspaceIds } from '@/lib/workspace-scheduler';

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const requestId = getRequestId(req);
  const authHeader = req.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const mode = isCron ? 'cron_post' : 'dashboard_post';
  let requestedBy: string | null = null;
  let workspaceId: string | null = null;

  logRouteEvent({
    route: '/api/sync',
    job: 'daily_ads_sync',
    mode,
    status: 'start',
    request_id: requestId,
  });

  try {
    if (!isCron) {
      const originError = rejectUntrustedOrigin(req);
      if (originError) return originError;

      const sessionError = rejectMissingDashboardSession(req);
      if (sessionError) return sessionError;

      const rateLimitError = limitByIp(
        req,
        'daily-sync',
        8,
        10 * 60 * 1000,
        'Terlalu banyak permintaan sync harian. Coba lagi beberapa menit lagi.',
      );
      if (rateLimitError) return rateLimitError;

      try {
        const access = await requireDashboardPermissionAccess('admin:daily', 'Admin Daily Data');
        const { profile } = access;
        requestedBy = profile.id;
        workspaceId = access.workspaceId;
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

    const workspaceIds = isCron
      ? await resolveScheduledWorkspaceIds(
          new URL(req.url).searchParams.get('workspace_id'),
          'daily_ads',
        )
      : [workspaceId!];
    const results = [];
    for (const scheduledWorkspaceId of workspaceIds) {
      results.push(await runDailyAdsSync(scheduledWorkspaceId));
    }
    const result = {
      message: workspaceIds.length === 0
        ? 'Tidak ada workspace dengan koneksi daily data aktif.'
        : `${workspaceIds.length} workspace selesai diproses.`,
      synced: results.reduce((sum, item) => sum + item.synced, 0),
      failed: results.reduce((sum, item) => sum + item.failed, 0),
      rows_inserted: results.reduce((sum, item) => sum + item.rows_inserted, 0),
      results: results.flatMap((item) => item.results),
    };
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
