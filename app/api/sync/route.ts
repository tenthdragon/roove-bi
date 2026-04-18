import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { createSyncJobDedupeKey, enqueueSyncJob } from '@/lib/sync-jobs';
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

    const { job, isDuplicate } = await enqueueSyncJob({
      jobName: 'daily_ads_sync',
      route: '/api/sync',
      mode: isCron ? 'cron' : 'manual',
      payload: {},
      dedupeKey: createSyncJobDedupeKey('daily_ads_sync', isCron ? 'cron' : 'manual', {}),
      requestedBy,
      requestId,
      maxAttempts: 3,
      priority: isCron ? 40 : 50,
    });

    logRouteEvent({
      route: '/api/sync',
      job: 'daily_ads_sync',
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
        ? 'Sync harian sudah ada di antrean atau sedang berjalan.'
        : 'Sync harian berhasil dimasukkan ke antrean.',
    }, { status: 202 });
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
