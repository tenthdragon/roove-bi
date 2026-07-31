// app/api/refresh-views/route.ts
// Recalculates summary tables from base data.
// Supports optional date range (from/to) for fast partial recalculation.
// Without date range, recalculates ALL data (slow, use sparingly).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { resolveScheduledWorkspaceIds } from '@/lib/workspace-scheduler';

export const maxDuration = 300;

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(req: NextRequest) {
  try {
    // Auth check: admin:sync or cron
    const authHeader = req.headers.get('authorization');
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    let workspaceId: string | null = null;
    if (!isCron) {
      const originError = rejectUntrustedOrigin(req);
      if (originError) return originError;

      const sessionError = rejectMissingDashboardSession(req);
      if (sessionError) return sessionError;

      const rateLimitError = limitByIp(
        req,
        'refresh-views',
        4,
        10 * 60 * 1000,
        'Terlalu banyak permintaan refresh summaries. Coba lagi beberapa menit lagi.',
      );
      if (rateLimitError) return rateLimitError;

      try {
        const access = await requireDashboardPermissionAccess('admin:sync', 'Admin Sync');
        workspaceId = access.workspaceId;
      } catch (err: any) {
        const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
        return NextResponse.json({ error: err.message }, { status });
      }
    }

    // Parse optional date range from body
    let fromDate: string | null = null;
    let toDate: string | null = null;
    try {
      const body = await req.json();
      fromDate = body.from || null;
      toDate = body.to || null;
      if (isCron && body.workspace_id) {
        workspaceId = String(body.workspace_id);
      }
    } catch {
      // No body or invalid JSON — recalculate all
    }

    const workspaceIds = isCron
      ? await resolveScheduledWorkspaceIds(workspaceId, 'all')
      : [workspaceId!];
    const svc = getServiceSupabase();
    const start = Date.now();

    const mode = fromDate && toDate ? `${fromDate} to ${toDate}` : 'all';
    const results = [];
    for (const scheduledWorkspaceId of workspaceIds) {
      const { error } = await svc.rpc('recalculate_workspace_summaries', {
        p_workspace_id: scheduledWorkspaceId,
        p_from: fromDate,
        p_to: toDate,
      });
      results.push({
        workspace_id: scheduledWorkspaceId,
        success: !error,
        error: error?.message || null,
      });
    }

    const elapsed = Date.now() - start;
    const failed = results.filter((result) => !result.success);

    if (failed.length > 0) {
      console.error(`[refresh-views] recalculate (${mode}) failed (${elapsed}ms):`, failed);
      return NextResponse.json({
        success: false,
        elapsed_ms: elapsed,
        mode,
        results,
        error: `${failed.length} workspace gagal direcalculate.`,
      }, { status: 500 });
    }

    console.log(`[refresh-views] Summaries recalculated (${mode}) in ${elapsed}ms`);
    return NextResponse.json({
      success: true,
      elapsed_ms: elapsed,
      mode,
      workspace_count: results.length,
      results,
      message: `${results.length} workspace summaries recalculated (${mode}) in ${(elapsed / 1000).toFixed(1)}s`,
    });
  } catch (err: any) {
    console.error('[refresh-views] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
