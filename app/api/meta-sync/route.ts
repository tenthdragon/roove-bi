import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  fetchAllAccountsInsights,
  checkTokenHealth,
  getYesterdayWIB,
  type MetaAdAccount,
  type DailyAdSpendRow,
} from '@/lib/meta-marketing';
import { triggerViewRefresh } from '@/lib/refresh-views';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export const maxDuration = 250;

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // ── Auth: same pattern as /api/sync ──
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
    const accessToken = process.env.META_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json({ error: 'META_ACCESS_TOKEN not configured' }, { status: 500 });
    }

    const svc = getServiceSupabase();

    // ── Determine date range ──
    // Query params: ?date_start=YYYY-MM-DD&date_end=YYYY-MM-DD
    // Default: yesterday only
    const { searchParams } = new URL(req.url);
    const dateStart = searchParams.get('date_start') || getYesterdayWIB();
    const dateEnd = searchParams.get('date_end') || dateStart;

    // ── Check token health (non-blocking warning) ──
    let tokenWarning: string | null = null;
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (appId && appSecret) {
      const health = await checkTokenHealth(accessToken, appId, appSecret);
      if (health) {
        tokenWarning = health.warning;
        console.warn(`[meta-sync] Token warning: ${health.warning}`);
      }
    }

    // ── Get active Meta Ad Accounts ──
    const { data: accounts, error: accountsError } = await svc
      .from('meta_ad_accounts')
      .select('*')
      .eq('is_active', true);

    if (accountsError) throw accountsError;
    if (!accounts || accounts.length === 0) {
      return NextResponse.json({
        message: 'No active Meta ad accounts configured',
        accounts_synced: 0,
        rows_inserted: 0,
      });
    }

    // ── Create sync log entry ──
    const { data: logEntry, error: logError } = await svc
      .from('meta_sync_log')
      .insert({
        sync_date: new Date().toISOString().split('T')[0],
        date_range_start: dateStart,
        date_range_end: dateEnd,
        status: 'running',
      })
      .select('id')
      .single();

    if (logError) {
      console.error('[meta-sync] Failed to create log entry:', logError);
    }
    const logId = logEntry?.id;

    // ── Fetch insights from Meta API ──
    console.log(`[meta-sync] Fetching insights for ${accounts.length} accounts, range: ${dateStart} to ${dateEnd}`);

    const results = await fetchAllAccountsInsights(
      accounts as MetaAdAccount[],
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
        errors.push(`${result.account_name}: ${result.error}`);
      } else {
        accountsSynced++;
      }
      allRows.push(...result.rows);
    }

    // ── Delete existing Meta API ads for the date range ──
    // Only delete rows tagged as meta_api to preserve Google Sheets data
    {
      const { error: delError } = await svc
        .from('daily_ads_spend')
        .delete()
        .gte('date', dateStart)
        .lte('date', dateEnd)
        .eq('data_source', 'meta_api');

      if (delError) {
        console.error(`[meta-sync] Delete error:`, delError);
      }
    }

    // ── Batch insert new data ──
    let rowsInserted = 0;
    if (allRows.length > 0) {
      for (let i = 0; i < allRows.length; i += 500) {
        const batch = allRows.slice(i, i + 500);
        const { error } = await svc.from('daily_ads_spend').insert(batch);
        if (error) {
          console.error(`[meta-sync] Insert batch error:`, error);
          errors.push(`Insert batch ${Math.floor(i / 500) + 1}: ${error.message}`);
        } else {
          rowsInserted += batch.length;
        }
      }
    }

    // ── Refresh materialized views ──
    if (rowsInserted > 0) {
      triggerViewRefresh();
    }

    // ── Update sync log ──
    const duration = Date.now() - startTime;
    const status = errors.length === 0 ? 'success' : (accountsSynced > 0 ? 'partial' : 'failed');

    if (logId) {
      await svc.from('meta_sync_log').update({
        accounts_synced: accountsSynced,
        rows_inserted: rowsInserted,
        status,
        error_message: errors.length > 0 ? errors.join('; ') : null,
        duration_ms: duration,
      }).eq('id', logId);
    }

    console.log(`[meta-sync] Done: ${accountsSynced}/${accounts.length} accounts, ${rowsInserted} rows, ${duration}ms`);

    return NextResponse.json({
      success: status !== 'failed',
      status,
      accounts_synced: accountsSynced,
      accounts_total: accounts.length,
      rows_inserted: rowsInserted,
      date_range: { start: dateStart, end: dateEnd },
      duration_ms: duration,
      token_warning: tokenWarning,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error('[meta-sync] Fatal error:', err);

    // Try to log the failure
    try {
      const svc = getServiceSupabase();
      await svc.from('meta_sync_log').insert({
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
