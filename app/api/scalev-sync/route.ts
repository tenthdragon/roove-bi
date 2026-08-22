import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { runScalevSync, type ScalevSyncMode } from '@/lib/scalev-sync-runner';
import { createSyncJobDedupeKey, enqueueSyncJob } from '@/lib/sync-jobs';
import { getRequestId, logRouteEvent } from '@/lib/structured-logger';
import { resolveScheduledWorkspaceIds } from '@/lib/workspace-scheduler';

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

  if (body.mode === 'repair' && (body.date || (Array.isArray(body.order_ids) && body.order_ids.length > 0))) {
    return {
      syncMode: 'repair' as const,
      targetDate: body.date || null,
      targetOrderIds: Array.isArray(body.order_ids)
        ? body.order_ids.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : null,
    };
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
  let workspaceId: string | null = null;

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
        const access = await requireDashboardPermissionAccess('admin:sync', 'Admin Sync');
        const { profile } = access;
        requestedBy = profile.id;
        workspaceId = access.workspaceId;
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
    const workspaceIds = isCron
      ? await resolveScheduledWorkspaceIds(
          new URL(req.url).searchParams.get('workspace_id'),
          'scalev',
        )
      : [workspaceId!];

    logRouteEvent({
      route: '/api/scalev-sync',
      job: 'scalev_sync',
      mode: `${requestMode}:${syncMode}`,
      status: 'start',
      request_id: requestId,
    });

    if (syncMode === 'order_id' || syncMode === 'repair') {
      const results = [];
      for (const scheduledWorkspaceId of workspaceIds) {
        results.push(await runScalevSync({
          workspaceId: scheduledWorkspaceId,
          syncMode,
          targetDate,
          targetOrderIds,
        }));
      }
      const result = results.length === 1 ? results[0] : {
        success: results.every((item) => item.success),
        sync_mode: syncMode,
        pending_checked: results.reduce((sum, item) => sum + item.pending_checked, 0),
        orders_updated: results.reduce((sum, item) => sum + item.orders_updated, 0),
        orders_repaired: results.reduce((sum, item) => sum + item.orders_repaired, 0),
        orders_still_pending: results.reduce((sum, item) => sum + item.orders_still_pending, 0),
        orders_errored: results.reduce((sum, item) => sum + item.orders_errored, 0),
        duration_ms: Date.now() - startTime,
        has_more: results.some((item) => item.has_more),
        next_after_id: null,
        details: results.flatMap((item) => item.details || []),
      };

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
    const queuedJobs = [];
    for (const scheduledWorkspaceId of workspaceIds) {
      queuedJobs.push(await enqueueSyncJob({
        workspaceId: scheduledWorkspaceId,
        jobName: 'scalev_sync',
        route: '/api/scalev-sync',
        mode: queueMode,
        payload,
        dedupeKey: createSyncJobDedupeKey('scalev_sync', queueMode, payload),
        requestedBy,
        requestId,
        maxAttempts: 3,
        priority: isCron ? 20 : 35,
      }));
    }
    const primary = queuedJobs[0] || null;

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
        duplicate: queuedJobs.every((item) => item.isDuplicate),
        job_ids: queuedJobs.map((item) => item.job.id).join(','),
      },
    });

    return NextResponse.json({
      queued: true,
      duplicate: queuedJobs.length > 0 && queuedJobs.every((item) => item.isDuplicate),
      job_id: primary?.job.id || null,
      job_ids: queuedJobs.map((item) => item.job.id),
      status: primary?.job.status || 'success',
      message: queuedJobs.length === 0
        ? 'Tidak ada workspace dengan koneksi ScaleV aktif.'
        : queuedJobs.every((item) => item.isDuplicate)
          ? 'Sync Scalev sudah ada di antrean atau sedang berjalan.'
          : `${queuedJobs.length} sync Scalev berhasil dimasukkan ke antrean.`,
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
