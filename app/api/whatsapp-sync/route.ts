import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  fetchAllWabaInsights,
  getYesterdayWIB,
  type WabaAccount,
} from '@/lib/meta-whatsapp';
import { type DailyAdSpendRow } from '@/lib/meta-marketing';


function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export const maxDuration = 250;

/**
 * GET handler — called by Vercel Cron.
 * Syncs last 3 days to self-heal any gaps from missed cron runs.
 */
export async function GET(req: NextRequest) {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const end = new Date(wib);
  end.setDate(end.getDate() - 1);
  const start = new Date(wib);
  start.setDate(start.getDate() - 3);

  const url = new URL(req.url);
  url.searchParams.set('date_start', start.toISOString().split('T')[0]);
  url.searchParams.set('date_end', end.toISOString().split('T')[0]);

  const proxyReq = new NextRequest(url, {
    method: 'POST',
    headers: req.headers,
  });
  return POST(proxyReq);
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // ── Auth ──
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
        return NextResponse.json({ error: 'Only owners and finance users can sync' }, { status: 403 });
      }
    }

    // ── Validate environment ──
    // Use WHATSAPP_ACCESS_TOKEN if set, otherwise fall back to META_ACCESS_TOKEN
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json(
        { error: 'WHATSAPP_ACCESS_TOKEN or META_ACCESS_TOKEN not configured' },
        { status: 500 }
      );
    }

    const svc = getServiceSupabase();

    // ── Determine date range ──
    const { searchParams } = new URL(req.url);
    let body: Record<string, string> = {};
    try { body = await req.json(); } catch { /* no body */ }
    const dateStart = searchParams.get('date_start') || body.startDate || getYesterdayWIB();
    const dateEnd = searchParams.get('date_end') || body.endDate || dateStart;

    // ── Get active WABA accounts ──
    const { data: accounts, error: accountsError } = await svc
      .from('waba_accounts')
      .select('*')
      .eq('is_active', true);

    if (accountsError) throw accountsError;
    if (!accounts || accounts.length === 0) {
      return NextResponse.json({
        message: 'No active WABA accounts configured',
        accounts_synced: 0,
        rows_inserted: 0,
      });
    }

    // ── Create sync log entry ──
    const { data: logEntry, error: logError } = await svc
      .from('waba_sync_log')
      .insert({
        sync_date: new Date().toISOString().split('T')[0],
        date_range_start: dateStart,
        date_range_end: dateEnd,
        status: 'running',
      })
      .select('id')
      .single();

    if (logError) {
      console.error('[whatsapp-sync] Failed to create log entry:', logError);
    }
    const logId = logEntry?.id;

    // ── Fetch analytics from WABA API ──
    console.log(`[whatsapp-sync] Fetching analytics for ${accounts.length} accounts, range: ${dateStart} to ${dateEnd}`);

    const results = await fetchAllWabaInsights(
      accounts as WabaAccount[],
      dateStart,
      dateEnd,
      accessToken
    );

    // ── Collect all rows and detect errors ──
    const allRows: DailyAdSpendRow[] = [];
    const errors: string[] = [];
    let accountsSynced = 0;

    for (const result of results) {
      if (result.error) {
        errors.push(`${result.waba_name}: ${result.error}`);
      } else {
        accountsSynced++;
      }
      allRows.push(...result.rows);
    }

    // ── Delete existing WABA data for the date range ──
    {
      const { error: delError } = await svc
        .from('daily_ads_spend')
        .delete()
        .gte('date', dateStart)
        .lte('date', dateEnd)
        .eq('data_source', 'whatsapp_api');

      if (delError) {
        console.error(`[whatsapp-sync] Delete error:`, delError);
      }
    }

    // ── Batch insert new data ──
    let rowsInserted = 0;
    if (allRows.length > 0) {
      for (let i = 0; i < allRows.length; i += 500) {
        const batch = allRows.slice(i, i + 500);
        const { error } = await svc.from('daily_ads_spend').insert(batch);
        if (error) {
          console.error(`[whatsapp-sync] Insert batch error:`, error);
          errors.push(`Insert batch ${Math.floor(i / 500) + 1}: ${error.message}`);
        } else {
          rowsInserted += batch.length;
        }
      }
    }



    // ── Update sync log ──
    const duration = Date.now() - startTime;
    const status = errors.length === 0 ? 'success' : (accountsSynced > 0 ? 'partial' : 'failed');

    if (logId) {
      await svc.from('waba_sync_log').update({
        accounts_synced: accountsSynced,
        rows_inserted: rowsInserted,
        status,
        error_message: errors.length > 0 ? errors.join('; ') : null,
        duration_ms: duration,
      }).eq('id', logId);
    }

    console.log(`[whatsapp-sync] Done: ${accountsSynced}/${accounts.length} accounts, ${rowsInserted} rows, ${duration}ms`);

    return NextResponse.json({
      success: status !== 'failed',
      status,
      accounts_synced: accountsSynced,
      accounts_total: accounts.length,
      rows_inserted: rowsInserted,
      date_range: { start: dateStart, end: dateEnd },
      duration_ms: duration,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error('[whatsapp-sync] Fatal error:', err);

    try {
      const svc = getServiceSupabase();
      await svc.from('waba_sync_log').insert({
        sync_date: new Date().toISOString().split('T')[0],
        date_range_start: new Date().toISOString().split('T')[0],
        date_range_end: new Date().toISOString().split('T')[0],
        status: 'failed',
        error_message: err.message,
        duration_ms: duration,
      });
    } catch {}

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
