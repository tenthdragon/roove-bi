// app/api/refresh-views/route.ts
// Recalculates summary tables from base data.
// Supports optional date range (from/to) for fast partial recalculation.
// Without date range, recalculates ALL data (slow, use sparingly).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
    // Auth check: owner/finance or cron
    const authHeader = req.headers.get('authorization');
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    if (!isCron) {
      const { createServerSupabase } = await import('@/lib/supabase-server');
      const supabase = createServerSupabase();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profile?.role !== 'owner' && profile?.role !== 'finance') {
        return NextResponse.json({ error: 'Only owners and finance users can recalculate' }, { status: 403 });
      }
    }

    // Parse optional date range from body
    let fromDate: string | null = null;
    let toDate: string | null = null;
    try {
      const body = await req.json();
      fromDate = body.from || null;
      toDate = body.to || null;
    } catch {
      // No body or invalid JSON — recalculate all
    }

    const svc = getServiceSupabase();
    const start = Date.now();

    let error: any;
    let mode: string;

    if (fromDate && toDate) {
      // Fast: recalculate only the specified date range
      mode = `${fromDate} to ${toDate}`;
      ({ error } = await svc.rpc('recalculate_summaries_range', { p_from: fromDate, p_to: toDate }));
    } else {
      // Full: recalculate everything
      mode = 'all';
      ({ error } = await svc.rpc('recalculate_all_summaries'));
    }

    const elapsed = Date.now() - start;

    if (error) {
      console.error(`[refresh-views] recalculate (${mode}) failed (${elapsed}ms):`, error.message);
      return NextResponse.json({
        success: false,
        elapsed_ms: elapsed,
        mode,
        error: error.message,
      }, { status: 500 });
    }

    console.log(`[refresh-views] Summaries recalculated (${mode}) in ${elapsed}ms`);
    return NextResponse.json({
      success: true,
      elapsed_ms: elapsed,
      mode,
      message: `Summaries recalculated (${mode}) in ${(elapsed / 1000).toFixed(1)}s`,
    });
  } catch (err: any) {
    console.error('[refresh-views] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
