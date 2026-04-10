// app/api/cashflow-snapshot/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDashboardTabAccess } from '@/lib/dashboard-access';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// POST: generate snapshot (manual or cron)
export async function POST(req: NextRequest) {
  try {
    // Check if cron or manual
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;

    let month: number;
    let year: number;
    let triggeredBy = 'manual';

    if (isCron) {
      // Cron: capture previous month
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      month = prev.getMonth() + 1;
      year = prev.getFullYear();
      triggeredBy = 'cron';
    } else {
      await requireDashboardTabAccess('cashflow', 'Cash Flow');

      // Manual: read from body
      const body = await req.json().catch(() => ({}));
      month = body.month;
      year = body.year;

      if (!month || !year) {
        // Default: current month
        const now = new Date();
        month = now.getMonth() + 1;
        year = now.getFullYear();
      }

      // Validate range
      if (month < 1 || month > 12 || year < 2000 || year > 2100) {
        return NextResponse.json({ error: 'Month must be 1-12, year must be 2000-2100' }, { status: 400 });
      }
    }

    const svc = getServiceSupabase();

    // Call the Supabase function
    const { data, error } = await svc.rpc('generate_cashflow_snapshot', {
      p_month: month,
      p_year: year,
      p_is_auto: isCron,
      p_triggered_by: triggeredBy,
    });

    if (error) throw error;

    // Fetch the created snapshot to return
    const { data: snapshot } = await svc
      .from('monthly_cashflow_snapshot')
      .select('*')
      .eq('period_month', month)
      .eq('period_year', year)
      .eq('is_auto', isCron)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      snapshot_id: data,
      period: `${year}-${String(month).padStart(2, '0')}`,
      triggered_by: triggeredBy,
      snapshot,
    });
  } catch (err: any) {
    console.error('Cashflow snapshot error:', err);
    const status = err?.message?.includes('login') ? 401 : err?.message?.includes('Akses') ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}

// GET: retrieve snapshots
export async function GET(req: NextRequest) {
  try {
    await requireDashboardTabAccess('cashflow', 'Cash Flow');

    const svc = getServiceSupabase();
    const url = new URL(req.url);
    const months = parseInt(url.searchParams.get('months') || '6');

    const { data, error } = await svc
      .from('monthly_cashflow_snapshot')
      .select('*')
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false })
      .limit(months);

    if (error) throw error;

    return NextResponse.json({ snapshots: data || [] });
  } catch (err: any) {
    const status = err?.message?.includes('login') ? 401 : err?.message?.includes('Akses') ? 403 : 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
