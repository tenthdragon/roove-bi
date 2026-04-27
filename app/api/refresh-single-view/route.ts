// app/api/refresh-single-view/route.ts
// Force-recalculates all summary tables. Kept for backward compatibility
// with the admin sync UI. Now delegates to recalculate_all_summaries().
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';

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
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'refresh-single-view',
      3,
      10 * 60 * 1000,
      'Terlalu banyak permintaan refresh full summary. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    // Auth check: admin:sync
    try {
      await requireDashboardPermissionAccess('admin:sync', 'Admin Sync');
    } catch (err: any) {
      const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
      return NextResponse.json({ error: err.message }, { status });
    }

    const svc = getServiceSupabase();
    const start = Date.now();
    const { error } = await svc.rpc('recalculate_all_summaries');
    const ms = Date.now() - start;

    if (error) {
      console.error(`[refresh-single-view] recalculate failed (${ms}ms):`, error.message);
      return NextResponse.json({ mv: 'all', ms, ok: false, error: error.message }, { status: 500 });
    }

    console.log(`[refresh-single-view] All summaries recalculated (${ms}ms)`);
    return NextResponse.json({ mv: 'all', ms, ok: true });
  } catch (err: any) {
    console.error('[refresh-single-view] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
