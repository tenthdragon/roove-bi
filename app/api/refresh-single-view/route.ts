// app/api/refresh-single-view/route.ts
// Refreshes a SINGLE materialized view to avoid long-running requests.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 300;

const ALLOWED_MVS = [
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
    // Auth check: owner/finance
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
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await req.json();
    const mvName = body.mv_name;

    if (!mvName || !ALLOWED_MVS.includes(mvName)) {
      return NextResponse.json({ error: `Invalid view: ${mvName}` }, { status: 400 });
    }

    const svc = getServiceSupabase();
    const start = Date.now();
    const { error } = await svc.rpc('refresh_single_mv', { mv_name: mvName });
    const ms = Date.now() - start;

    if (error) {
      console.error(`[refresh-single-view] ${mvName} failed (${ms}ms):`, error.message);
      return NextResponse.json({ mv: mvName, ms, ok: false, error: error.message }, { status: 500 });
    }

    console.log(`[refresh-single-view] ${mvName} refreshed (${ms}ms)`);
    return NextResponse.json({ mv: mvName, ms, ok: true });
  } catch (err: any) {
    console.error('[refresh-single-view] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
