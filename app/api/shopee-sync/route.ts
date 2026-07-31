import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { getRequestId, logRouteEvent } from '@/lib/structured-logger';
import { runShopeeSync } from '@/lib/shopee-sync-runner';
import { resolveScheduledWorkspaceIds } from '@/lib/workspace-scheduler';

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

  return getCronDateRange();
}

async function queueShopeeSync(req: NextRequest, method: 'GET' | 'POST') {
  const startTime = Date.now();
  const requestId = getRequestId(req);
  const authHeader = req.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const mode = isCron ? `cron_${method.toLowerCase()}` : `dashboard_${method.toLowerCase()}`;
  let requestedBy: string | null = null;
  let workspaceId: string | null = null;

  logRouteEvent({
    route: '/api/shopee-sync',
    job: 'shopee_sync',
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
        'shopee-sync',
        8,
        10 * 60 * 1000,
        'Terlalu banyak permintaan Shopee sync. Coba lagi beberapa menit lagi.',
      );
      if (rateLimitError) return rateLimitError;

      try {
        const access = await requireDashboardPermissionAccess('admin:meta', 'Admin Meta');
        const { profile } = access;
        requestedBy = profile.id;
        workspaceId = access.workspaceId;
      } catch (error: any) {
        const status = /sesi|login/i.test(error.message || '') ? 401 : 403;
        logRouteEvent({
          route: '/api/shopee-sync',
          job: 'shopee_sync',
          mode,
          status: 'denied',
          request_id: requestId,
          duration_ms: Date.now() - startTime,
          extra: { error: error.message, http_status: status },
        });
        return NextResponse.json({ error: error.message }, { status });
      }
    }

    const payload = resolveDateRange(req);
    const workspaceIds = isCron
      ? await resolveScheduledWorkspaceIds(
          new URL(req.url).searchParams.get('workspace_id'),
          'shopee',
        )
      : [workspaceId!];
    const results = [];
    const routeErrors: string[] = [];
    for (const scheduledWorkspaceId of workspaceIds) {
      try {
        results.push(await runShopeeSync({
          workspaceId: scheduledWorkspaceId,
          dateStart: payload.date_start,
          dateEnd: payload.date_end,
        }));
      } catch (error: any) {
        routeErrors.push(`${scheduledWorkspaceId}: ${error?.message || 'Shopee sync gagal'}`);
      }
    }
    const result = {
      status: routeErrors.length === 0
        ? 'success' as const
        : results.length > 0
          ? 'partial' as const
          : 'failed' as const,
      shops_synced: results.reduce((sum, item) => sum + item.shops_synced, 0),
      shops_total: results.reduce((sum, item) => sum + item.shops_total, 0),
      rows_inserted: results.reduce((sum, item) => sum + item.rows_inserted, 0),
      spend_total: results.reduce((sum, item) => sum + item.spend_total, 0),
      direct_gmv_total: results.reduce((sum, item) => sum + item.direct_gmv_total, 0),
      broad_gmv_total: results.reduce((sum, item) => sum + item.broad_gmv_total, 0),
      duration_ms: Date.now() - startTime,
      errors: [...results.flatMap((item) => item.errors || []), ...routeErrors],
      message: workspaceIds.length === 0 ? 'Tidak ada workspace dengan toko Shopee aktif.' : undefined,
    };

    logRouteEvent({
      route: '/api/shopee-sync',
      job: 'shopee_sync',
      mode,
      status: result.status,
      request_id: requestId,
      duration_ms: Date.now() - startTime,
      rows_processed: result.rows_inserted,
      extra: {
        requested_by: requestedBy,
        date_start: payload.date_start,
        date_end: payload.date_end,
        shops_synced: result.shops_synced,
        shops_total: result.shops_total,
        spend_total: result.spend_total,
        direct_gmv_total: result.direct_gmv_total,
      },
    });

    return NextResponse.json({
      queued: false,
      status: result.status,
      date_range: {
        start: payload.date_start,
        end: payload.date_end || payload.date_start,
      },
      shops_synced: result.shops_synced,
      shops_total: result.shops_total,
      rows_inserted: result.rows_inserted,
      spend_total: result.spend_total,
      direct_gmv_total: result.direct_gmv_total,
      broad_gmv_total: result.broad_gmv_total,
      duration_ms: result.duration_ms,
      errors: result.errors,
      message: result.message || (
        result.status === 'success'
          ? 'Sync Shopee selesai.'
          : result.status === 'partial'
            ? 'Sync Shopee selesai sebagian.'
            : 'Sync Shopee gagal.'
      ),
    }, { status: result.status === 'failed' ? 500 : 200 });
  } catch (error: any) {
    console.error('[shopee-sync] Fatal error:', error);
    logRouteEvent({
      route: '/api/shopee-sync',
      job: 'shopee_sync',
      mode,
      status: 'failed',
      request_id: requestId,
      duration_ms: Date.now() - startTime,
      extra: { error: error.message },
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return queueShopeeSync(req, 'GET');
}

export async function POST(req: NextRequest) {
  return queueShopeeSync(req, 'POST');
}
