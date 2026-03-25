// app/api/refresh-single-view/route.ts
// Force-recalculates all summary tables. Kept for backward compatibility
// with the admin sync UI. Now delegates to recalculate_all_summaries().
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
