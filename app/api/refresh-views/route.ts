// app/api/refresh-views/route.ts
// Refreshes all materialized views one-by-one to avoid PostgREST statement timeout.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 120;

// MVs in dependency order (channel_complete depends on order_channel)
const MV_LIST = [
  'mv_daily_order_channel',
  'mv_daily_ads_by_brand',
  'mv_daily_channel_complete',
  'mv_daily_product_complete',
  'mv_customer_first_order',
  'mv_daily_customer_type',
  'mv_customer_cohort',
  'mv_monthly_cohort',
];

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
        return NextResponse.json({ error: 'Only owners and finance users can refresh views' }, { status: 403 });
      }
    }

    const svc = getServiceSupabase();
    const start = Date.now();
    const results: { mv: string; ms: number; ok: boolean; error?: string }[] = [];

    // Refresh each MV individually to avoid single-statement timeout
    for (const mv of MV_LIST) {
      const mvStart = Date.now();
      const { error } = await svc.rpc('refresh_single_mv', { mv_name: mv });
      const ms = Date.now() - mvStart;

      if (error) {
        console.error(`[refresh-views] ${mv} failed (${ms}ms):`, error.message);
        results.push({ mv, ms, ok: false, error: error.message });
      } else {
        console.log(`[refresh-views] ${mv} refreshed (${ms}ms)`);
        results.push({ mv, ms, ok: true });
      }
    }

    const elapsed = Date.now() - start;
    const failed = results.filter(r => !r.ok);

    if (failed.length > 0) {
      console.error(`[refresh-views] ${failed.length}/${MV_LIST.length} failed`);
      return NextResponse.json({
        success: false,
        elapsed_ms: elapsed,
        message: `${failed.length} view(s) failed to refresh`,
        results,
      }, { status: 500 });
    }

    console.log(`[refresh-views] All views refreshed in ${elapsed}ms`);
    return NextResponse.json({
      success: true,
      elapsed_ms: elapsed,
      message: `Views refreshed in ${(elapsed / 1000).toFixed(1)}s`,
      results,
    });
  } catch (err: any) {
    console.error('[refresh-views] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
