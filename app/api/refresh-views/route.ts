// app/api/refresh-views/route.ts
// Force-recalculates all summary tables from base data.
// This is a safety valve — normally summary tables are updated incrementally via triggers.
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

    const svc = getServiceSupabase();
    const start = Date.now();

    const { error } = await svc.rpc('recalculate_all_summaries');

    const elapsed = Date.now() - start;

    if (error) {
      console.error(`[refresh-views] recalculate failed (${elapsed}ms):`, error.message);
      return NextResponse.json({
        success: false,
        elapsed_ms: elapsed,
        error: error.message,
      }, { status: 500 });
    }

    console.log(`[refresh-views] All summaries recalculated in ${elapsed}ms`);
    return NextResponse.json({
      success: true,
      elapsed_ms: elapsed,
      message: `Summaries recalculated in ${(elapsed / 1000).toFixed(1)}s`,
    });
  } catch (err: any) {
    console.error('[refresh-views] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
