import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import {
  fetchAllWabaInsights,
  getYesterdayWIB,
  type WabaAccount,
} from '@/lib/meta-whatsapp';
import { type DailyAdSpendRow } from '@/lib/meta-marketing';
import { resolveWorkspaceCredential } from '@/lib/workspace-integration-server';
import { resolveScheduledWorkspaceIds } from '@/lib/workspace-scheduler';


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
  let dateStart = getYesterdayWIB();
  let dateEnd = dateStart;
  let logId: number | null = null;
  let workspaceId: string | null = null;

  try {
    // ── Auth ──
    const authHeader = req.headers.get('authorization');
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    if (!isCron) {
      const originError = rejectUntrustedOrigin(req);
      if (originError) return originError;

      const sessionError = rejectMissingDashboardSession(req);
      if (sessionError) return sessionError;

      const rateLimitError = limitByIp(
        req,
        'whatsapp-sync',
        8,
        10 * 60 * 1000,
        'Terlalu banyak permintaan WhatsApp sync. Coba lagi beberapa menit lagi.',
      );
      if (rateLimitError) return rateLimitError;

      try {
        const access = await requireDashboardPermissionAccess('admin:meta', 'Admin Meta');
        workspaceId = access.workspaceId;
      } catch (err: any) {
        const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
        return NextResponse.json({ error: err.message }, { status });
      }
    }

    const svc = getServiceSupabase();

    // ── Determine date range ──
    const { searchParams } = new URL(req.url);
    let body: Record<string, string> = {};
    try { body = await req.json(); } catch { /* no body */ }
    dateStart = searchParams.get('date_start') || body.startDate || getYesterdayWIB();
    dateEnd = searchParams.get('date_end') || body.endDate || dateStart;
    if (isCron) {
      const requestedWorkspaceId = searchParams.get('workspace_id') || body.workspace_id;
      if (!requestedWorkspaceId) {
        const workspaceIds = await resolveScheduledWorkspaceIds(null, 'whatsapp');
        const results = [];
        for (const scheduledWorkspaceId of workspaceIds) {
          const childUrl = new URL(req.url);
          childUrl.searchParams.set('workspace_id', scheduledWorkspaceId);
          childUrl.searchParams.set('date_start', dateStart);
          childUrl.searchParams.set('date_end', dateEnd);
          const response = await fetch(childUrl, {
            method: 'POST',
            headers: { authorization: req.headers.get('authorization') || '' },
          });
          results.push({
            workspace_id: scheduledWorkspaceId,
            ok: response.ok,
            result: await response.json().catch(() => ({})),
          });
        }
        return NextResponse.json({
          workspaces_processed: results.length,
          results,
        }, { status: results.some((item) => !item.ok) ? 207 : 200 });
      }
      [workspaceId] = await resolveScheduledWorkspaceIds(requestedWorkspaceId, 'whatsapp');
    }

    const accessToken = await resolveWorkspaceCredential({
      supabase: svc,
      workspaceId: workspaceId!,
      provider: 'whatsapp',
      fallbackEnvKeys: ['WHATSAPP_ACCESS_TOKEN', 'META_ACCESS_TOKEN'],
    });

    // ── Get active WABA accounts ──
    const { data: accounts, error: accountsError } = await svc
      .from('waba_accounts')
      .select('*')
      .eq('workspace_id', workspaceId!)
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
        workspace_id: workspaceId,
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
    logId = logEntry?.id ?? null;

    // ── Fetch analytics from WABA API ──
    console.log(`[whatsapp-sync] Fetching analytics for ${accounts.length} accounts, range: ${dateStart} to ${dateEnd}`);

    const results = await fetchAllWabaInsights(
      accounts as WabaAccount[],
      dateStart,
      dateEnd,
      accessToken
    );

    // ── Replace per-account slices so failed WABA accounts keep their previous data ──
    const errors: string[] = [];
    let accountsSynced = 0;
    let rowsInserted = 0;
    for (const result of results) {
      if (result.error) {
        errors.push(`${result.waba_name}: ${result.error}`);
        continue;
      }

      const { error: delError } = await svc
        .from('daily_ads_spend')
        .delete()
        .eq('workspace_id', workspaceId)
        .gte('date', dateStart)
        .lte('date', dateEnd)
        .eq('data_source', 'whatsapp_api')
        .eq('ad_account', result.waba_name);

      if (delError) {
        console.error(`[whatsapp-sync] Delete error for ${result.waba_name}:`, delError);
        errors.push(`Delete ${result.waba_name}: ${delError.message}`);
        continue;
      }

      let accountInsertFailed = false;
      for (let i = 0; i < result.rows.length; i += 500) {
        const batch = result.rows.slice(i, i + 500).map((row) => ({
          ...row,
          workspace_id: workspaceId,
        }));
        const { error } = await svc.from('daily_ads_spend').insert(batch);
        if (error) {
          console.error(`[whatsapp-sync] Insert batch error for ${result.waba_name}:`, error);
          errors.push(`Insert ${result.waba_name} batch ${Math.floor(i / 500) + 1}: ${error.message}`);
          accountInsertFailed = true;
          break;
        }
        rowsInserted += batch.length;
      }

      if (!accountInsertFailed) {
        accountsSynced++;
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
      }).eq('id', logId)
        .eq('workspace_id', workspaceId);
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
      const payload = {
        workspace_id: workspaceId,
        sync_date: new Date().toISOString().split('T')[0],
        date_range_start: dateStart,
        date_range_end: dateEnd,
        status: 'failed',
        error_message: err.message,
        duration_ms: duration,
      };
      if (logId) {
        await svc.from('waba_sync_log').update(payload).eq('id', logId).eq('workspace_id', workspaceId);
      } else {
        await svc.from('waba_sync_log').insert(payload);
      }
    } catch {}

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
