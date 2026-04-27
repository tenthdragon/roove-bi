import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { runScalevSync, type ScalevSyncMode } from '@/lib/scalev-sync-runner';
import { createSyncJobDedupeKey, enqueueSyncJob } from '@/lib/sync-jobs';
import { getRequestId, logRouteEvent } from '@/lib/structured-logger';

export const maxDuration = 120;

type ScalevRequestPayload = {
  mode?: ScalevSyncMode;
  date?: string;
  order_ids?: string[];
};

async function parseBody(req: NextRequest): Promise<ScalevRequestPayload> {
  try {
    const ct = req.headers.get('content-type');
    if (ct?.includes('application/json')) {
      return await req.json();
    }
  } catch {}

  return {};
}

function normalizeScalevPayload(body: ScalevRequestPayload) {
  if (body.mode === 'date' && body.date) {
    return { syncMode: 'date' as const, targetDate: body.date, targetOrderIds: null };
  }

  if (body.mode === 'repair' && body.date) {
    return { syncMode: 'repair' as const, targetDate: body.date, targetOrderIds: null };
  }

  if (body.mode === 'order_id' && Array.isArray(body.order_ids) && body.order_ids.length > 0) {
    return {
      syncMode: 'order_id' as const,
      targetDate: null,
      targetOrderIds: body.order_ids.filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    };
  }

  return { syncMode: 'full' as const, targetDate: null, targetOrderIds: null };
}

export async function GET(req: NextRequest) {
  const proxyReq = new NextRequest(new URL(req.url), {
    method: 'POST',
    headers: req.headers,
  });
  return POST(proxyReq);
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const requestId = getRequestId(req);
  const authHeader = req.headers.get('authorization');
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const requestMode = isCron ? 'cron_post' : 'dashboard_post';
  let requestedBy: string | null = null;

  try {
    if (!isCron) {
      const originError = rejectUntrustedOrigin(req);
      if (originError) return originError;

      const sessionError = rejectMissingDashboardSession(req);
      if (sessionError) return sessionError;

      const rateLimitError = limitByIp(
        req,
        'scalev-sync',
        8,
        10 * 60 * 1000,
        'Terlalu banyak permintaan sync ScaleV. Coba lagi beberapa menit lagi.',
      );
      if (rateLimitError) return rateLimitError;

      try {
        const { profile } = await requireDashboardPermissionAccess('admin:sync', 'Admin Sync');
        requestedBy = profile.id;
      } catch (authErr: any) {
        console.error('[scalev-sync] Auth error:', authErr.message);
        const status = /sesi|login/i.test(authErr.message || '') ? 401 : 403;
        logRouteEvent({
          route: '/api/scalev-sync',
          job: 'scalev_sync',
          mode: requestMode,
          status: 'denied',
          request_id: requestId,
          duration_ms: Date.now() - startTime,
          extra: { error: authErr.message, http_status: status },
        });
        return NextResponse.json({ error: authErr.message }, { status });
      }
    }

    const body = await parseBody(req);
    const { syncMode, targetDate, targetOrderIds } = normalizeScalevPayload(body);

    logRouteEvent({
      route: '/api/scalev-sync',
      job: 'scalev_sync',
      mode: `${requestMode}:${syncMode}`,
      status: 'start',
      request_id: requestId,
    });

    if (syncMode === 'order_id' || syncMode === 'repair') {
      const result = await runScalevSync({
        syncMode,
        targetDate,
        targetOrderIds,
      });

      logRouteEvent({
        route: '/api/scalev-sync',
        job: 'scalev_sync',
        mode: `${requestMode}:${syncMode}`,
        status: result.orders_errored > 0 ? 'partial' : 'success',
        request_id: requestId,
        duration_ms: result.duration_ms,
        rows_processed: result.pending_checked,
        extra: {
          orders_updated: result.orders_updated,
          orders_still_pending: result.orders_still_pending,
          orders_errored: result.orders_errored,
        },
      });

      return NextResponse.json(result);
    }

    const payload = {
      mode: syncMode,
      ...(targetDate ? { date: targetDate } : {}),
    };
    const queueMode = isCron ? 'cron' : 'manual';
    const { job, isDuplicate } = await enqueueSyncJob({
      jobName: 'scalev_sync',
      route: '/api/scalev-sync',
      mode: queueMode,
      payload,
      dedupeKey: createSyncJobDedupeKey('scalev_sync', queueMode, payload),
      requestedBy,
      requestId,
      maxAttempts: 3,
      priority: isCron ? 20 : 35,
    });

    logRouteEvent({
      route: '/api/scalev-sync',
      job: 'scalev_sync',
      mode: `${requestMode}:${syncMode}`,
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
        ? 'Sync Scalev sudah ada di antrean atau sedang berjalan.'
        : 'Sync Scalev berhasil dimasukkan ke antrean.',
    }, { status: 202 });
  } catch (err: any) {
    console.error('[scalev-sync] Fatal error:', err.message);
    logRouteEvent({
      route: '/api/scalev-sync',
      job: 'scalev_sync',
      mode: requestMode,
      status: 'failed',
      request_id: requestId,
      duration_ms: Date.now() - startTime,
      extra: { error: err.message },
    });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
