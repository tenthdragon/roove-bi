// app/api/refresh-views/route.ts
// Refreshes all materialized views (order → ads → channel → product)
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

    // Call the refresh_order_views function (uses CONCURRENTLY)
    const { error } = await svc.rpc('refresh_order_views', { use_concurrent: true });

    if (error) {
      console.error('[refresh-views] Error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const elapsed = Date.now() - start;
    console.log(`[refresh-views] Materialized views refreshed in ${elapsed}ms`);

    return NextResponse.json({
      success: true,
      elapsed_ms: elapsed,
      message: `Views refreshed in ${(elapsed / 1000).toFixed(1)}s`,
    });
  } catch (err: any) {
    console.error('[refresh-views] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
