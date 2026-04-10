import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function authenticate(req: NextRequest) {
  const { createServerSupabase } = await import('@/lib/supabase-server');
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated', status: 401 };

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'owner' && profile?.role !== 'finance' && profile?.role !== 'sales_manager') {
    return { error: 'Only owners, finance, and sales managers can access analytics', status: 403 };
  }
  return { user, profile };
}

/** GET — Fetch template performance analytics from DB */
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const svc = getServiceSupabase();
    const url = new URL(req.url);
    const templateIds = url.searchParams.get('template_ids')?.split(',').filter(Boolean) || [];
    const start = url.searchParams.get('start') || '';
    const end = url.searchParams.get('end') || '';

    if (templateIds.length === 0) {
      return NextResponse.json({ error: 'template_ids required' }, { status: 400 });
    }
    if (!start || !end) {
      return NextResponse.json({ error: 'start and end date required (YYYY-MM-DD)' }, { status: 400 });
    }

    const { data: analyticsRows, error: analyticsError } = await svc
      .from('waba_template_daily_analytics')
      .select('template_id, date, sent, delivered, read, clicked, replied, cost')
      .in('template_id', templateIds)
      .gte('date', start)
      .lte('date', end)
      .order('date');

    if (analyticsError) throw analyticsError;

    const byTemplate: Record<string, { sent: number; delivered: number; read: number; clicked: number; replied: number; cost: number }> = {};
    const dailyMap: Record<string, { date: string; sent: number; delivered: number; read: number; clicked: number; replied: number }> = {};

    for (const row of analyticsRows || []) {
      if (!byTemplate[row.template_id]) {
        byTemplate[row.template_id] = {
          sent: 0,
          delivered: 0,
          read: 0,
          clicked: 0,
          replied: 0,
          cost: 0,
        };
      }

      byTemplate[row.template_id].sent += row.sent || 0;
      byTemplate[row.template_id].delivered += row.delivered || 0;
      byTemplate[row.template_id].read += row.read || 0;
      byTemplate[row.template_id].clicked += row.clicked || 0;
      byTemplate[row.template_id].replied += row.replied || 0;
      byTemplate[row.template_id].cost += row.cost || 0;

      if (!dailyMap[row.date]) {
        dailyMap[row.date] = { date: row.date, sent: 0, delivered: 0, read: 0, clicked: 0, replied: 0 };
      }
      dailyMap[row.date].sent += row.sent || 0;
      dailyMap[row.date].delivered += row.delivered || 0;
      dailyMap[row.date].read += row.read || 0;
      dailyMap[row.date].clicked += row.clicked || 0;
      dailyMap[row.date].replied += row.replied || 0;
    }

    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json({ byTemplate, daily });
  } catch (err: any) {
    console.error('[waba-template-analytics] GET error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
