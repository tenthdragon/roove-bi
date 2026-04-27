import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { runMetaSync } from '@/lib/meta-sync-runner';
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

function resolveDateRange(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const queryStart = searchParams.get('date_start');
  const queryEnd = searchParams.get('date_end') || queryStart;

  if (queryStart || queryEnd) {
    return {
      date_start: queryStart,
      date_end: queryEnd,
    };
  }

  const defaultRange = getCronDateRange();

  return {
    date_start: defaultRange.date_start,
    date_end: defaultRange.date_end,
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
      const originError = rejectUntrustedOrigin(req);
      if (originError) return originError;

      const sessionError = rejectMissingDashboardSession(req);
      if (sessionError) return sessionError;

      const rateLimitError = limitByIp(
        req,
        'meta-sync',
        8,
        10 * 60 * 1000,
        'Terlalu banyak permintaan Meta sync. Coba lagi beberapa menit lagi.',
      );
      if (rateLimitError) return rateLimitError;

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

    const payload = resolveDateRange(req);
    const result = await runMetaSync({
      dateStart: payload.date_start,
      dateEnd: payload.date_end,
    });

    logRouteEvent({
      route: '/api/meta-sync',
      job: 'meta_sync',
      mode,
      status: result.status,
      request_id: requestId,
      duration_ms: Date.now() - startTime,
      rows_processed: result.rows_inserted,
      extra: {
        requested_by: requestedBy,
        date_start: payload.date_start,
        date_end: payload.date_end,
        accounts_synced: result.accounts_synced,
        accounts_total: result.accounts_total,
      },
    });

    return NextResponse.json({
      queued: false,
      status: result.status,
      date_range: {
        start: payload.date_start,
        end: payload.date_end || payload.date_start,
      },
      accounts_synced: result.accounts_synced,
      accounts_total: result.accounts_total,
      rows_inserted: result.rows_inserted,
      duration_ms: result.duration_ms,
      token_warning: result.token_warning,
      errors: result.errors,
      message: result.message || (result.status === 'success'
        ? 'Sync Meta selesai.'
        : result.status === 'partial'
          ? 'Sync Meta selesai sebagian.'
          : 'Sync Meta gagal.'),
    }, { status: result.status === 'failed' ? 500 : 200 });
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
