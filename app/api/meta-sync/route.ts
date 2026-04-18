import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { createSyncJobDedupeKey, enqueueSyncJob } from '@/lib/sync-jobs';
import { getRequestId, logRouteEvent } from '@/lib/structured-logger';

export const maxDuration = 60;

function getCronDateRange() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const end = new Date(wib);
  end.setDate(end.getDate() - 1);
  const start = new Date(wib);
  start.setDate(start.getDate() - 3);

  return {
    date_start: start.toISOString().split('T')[0],
    date_end: end.toISOString().split('T')[0],
  };
}

function resolveDateRange(req: NextRequest, method: 'GET' | 'POST') {
  const { searchParams } = new URL(req.url);
  const defaultRange = method === 'GET' ? getCronDateRange() : null;

  return {
    date_start: searchParams.get('date_start') || defaultRange?.date_start || null,
    date_end: searchParams.get('date_end') || defaultRange?.date_end || searchParams.get('date_start') || null,
  };
}

async function queueMetaSync(req: NextRequest, method: 'GET' | 'POST') {
  const startTime = Date.now();
  const requestId = getRequestId(req);
  const authHeader = req.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const mode = isCron ? `cron_${method.toLowerCase()}` : `dashboard_${method.toLowerCase()}`;
  let requestedBy: string | null = null;

  logRouteEvent({
    route: '/api/meta-sync',
    job: 'meta_sync',
    mode,
    status: 'start',
    request_id: requestId,
  });

  try {
    if (!isCron) {
      try {
        const { profile } = await requireDashboardPermissionAccess('admin:meta', 'Admin Meta');
        requestedBy = profile.id;
      } catch (err: any) {
        const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
        logRouteEvent({
          route: '/api/meta-sync',
          job: 'meta_sync',
          mode,
          status: 'denied',
          request_id: requestId,
          duration_ms: Date.now() - startTime,
          extra: { error: err.message, http_status: status },
        });
        return NextResponse.json({ error: err.message }, { status });
      }
    }

    const payload = resolveDateRange(req, method);
    const dedupePayload = {
      date_start: payload.date_start || 'default',
      date_end: payload.date_end || payload.date_start || 'default',
    };

    const { job, isDuplicate } = await enqueueSyncJob({
      jobName: 'meta_sync',
      route: '/api/meta-sync',
      mode: isCron ? 'cron' : 'manual',
      payload,
      dedupeKey: createSyncJobDedupeKey('meta_sync', isCron ? 'cron' : 'manual', dedupePayload),
      requestedBy,
      requestId,
      maxAttempts: 3,
      priority: isCron ? 30 : 40,
    });

    logRouteEvent({
      route: '/api/meta-sync',
      job: 'meta_sync',
      mode,
      status: 'success',
      request_id: requestId,
      duration_ms: Date.now() - startTime,
      rows_processed: 1,
      extra: {
        queued: true,
        duplicate: isDuplicate,
        job_id: job.id,
        date_start: payload.date_start,
        date_end: payload.date_end,
      },
    });

    return NextResponse.json({
      queued: true,
      duplicate: isDuplicate,
      job_id: job.id,
      status: job.status,
      date_range: {
        start: payload.date_start,
        end: payload.date_end || payload.date_start,
      },
      message: isDuplicate
        ? 'Sync Meta dengan rentang tanggal ini sudah ada di antrean atau sedang berjalan.'
        : 'Sync Meta berhasil dimasukkan ke antrean.',
    }, { status: 202 });
  } catch (err: any) {
    console.error('[meta-sync] Fatal error:', err);
    logRouteEvent({
      route: '/api/meta-sync',
      job: 'meta_sync',
      mode,
      status: 'failed',
      request_id: requestId,
      duration_ms: Date.now() - startTime,
      extra: { error: err.message },
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return queueMetaSync(req, 'GET');
}

export async function POST(req: NextRequest) {
  return queueMetaSync(req, 'POST');
}
