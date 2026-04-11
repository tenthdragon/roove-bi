import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import {
  listMessageTemplates,
  fetchTemplateAnalyticsRaw,
  type MessageTemplate,
} from '@/lib/meta-whatsapp';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export const maxDuration = 250;

const AUTO_GENERATED_RE = /^[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}$/;

/**
 * GET handler — called by Vercel Cron.
 * Syncs templates + last 3 days analytics (self-healing).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  url.searchParams.set('mode', 'cron');

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
      try {
        await requireDashboardPermissionAccess('admin:meta', 'Admin Meta');
      } catch (err: any) {
        const status = /sesi|login/i.test(err.message || '') ? 401 : 403;
        return NextResponse.json({ error: err.message }, { status });
      }
    }

    // ── Validate environment ──
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
    if (!accessToken) {
      return NextResponse.json(
        { error: 'WHATSAPP_ACCESS_TOKEN or META_ACCESS_TOKEN not configured' },
        { status: 500 }
      );
    }

    const svc = getServiceSupabase();

    // ── Determine mode ──
    const { searchParams } = new URL(req.url);
    let body: Record<string, string> = {};
    try { body = await req.json(); } catch { /* no body */ }
    const mode = searchParams.get('mode') || body.mode || 'cron';

    // ── Get active WABA accounts ──
    const { data: accounts, error: accountsError } = await svc
      .from('waba_accounts')
      .select('waba_id')
      .eq('is_active', true);

    if (accountsError) throw accountsError;
    if (!accounts || accounts.length === 0) {
      return NextResponse.json({
        message: 'No active WABA accounts configured',
        templates_synced: 0,
        analytics_rows_upserted: 0,
      });
    }

    // ── Create sync log entry ──
    const now = new Date();
    const endDate = now.toISOString().split('T')[0];
    const startDateObj = new Date(now);
    startDateObj.setDate(startDateObj.getDate() - (mode === 'full' ? 89 : 3));
    const startDate = startDateObj.toISOString().split('T')[0];

    const { data: logEntry } = await svc
      .from('waba_template_sync_log')
      .insert({
        sync_type: mode === 'full' ? 'manual' : 'cron',
        date_range_start: startDate,
        date_range_end: endDate,
        status: 'running',
      })
      .select('id')
      .single();

    const logId = logEntry?.id;
    const errors: string[] = [];

    // ════════════════════════════════════════════
    // Phase 1: Template metadata sync
    // ════════════════════════════════════════════
    const syncStart = new Date();
    let templatesSynced = 0;

    for (const account of accounts) {
      try {
        // Paginate through all templates
        const allTemplates: MessageTemplate[] = [];
        let after: string | undefined;

        do {
          const page = await listMessageTemplates(account.waba_id, accessToken, after);
          allTemplates.push(...page.data);
          after = page.paging.after;
        } while (after);

        console.log(`[waba-template-sync] Fetched ${allTemplates.length} templates for ${account.waba_id}`);

        // Batch upsert into waba_templates (500 at a time)
        for (let i = 0; i < allTemplates.length; i += 500) {
          const batch = allTemplates.slice(i, i + 500).map(t => ({
            id: t.id,
            waba_id: account.waba_id,
            name: t.name,
            status: t.status,
            category: t.category,
            language: t.language,
            components: t.components,
            is_auto_generated: AUTO_GENERATED_RE.test(t.name),
            synced_at: syncStart.toISOString(),
            deleted_at: null, // Restore if previously soft-deleted
          }));

          const { error } = await svc
            .from('waba_templates')
            .upsert(batch, { onConflict: 'id' });

          if (error) {
            console.error(`[waba-template-sync] Upsert templates error:`, error);
            errors.push(`Templates upsert batch ${Math.floor(i / 500) + 1}: ${error.message}`);
          } else {
            templatesSynced += batch.length;
          }
        }

        // Soft-delete templates not seen in this sync
        const { error: deleteError } = await svc
          .from('waba_templates')
          .update({ deleted_at: syncStart.toISOString() })
          .eq('waba_id', account.waba_id)
          .lt('synced_at', syncStart.toISOString())
          .is('deleted_at', null);

        if (deleteError) {
          console.error(`[waba-template-sync] Soft-delete error:`, deleteError);
        }
      } catch (err: any) {
        console.error(`[waba-template-sync] Templates error for ${account.waba_id}:`, err.message);
        errors.push(`Templates ${account.waba_id}: ${err.message}`);
      }
    }

    // ════════════════════════════════════════════
    // Phase 2: Template analytics sync
    // ════════════════════════════════════════════
    let analyticsRowsUpserted = 0;

    for (const account of accounts) {
      try {
        // Get APPROVED non-deleted templates for this account
        const { data: approvedTemplates } = await svc
          .from('waba_templates')
          .select('id')
          .eq('waba_id', account.waba_id)
          .eq('status', 'APPROVED')
          .is('deleted_at', null);

        const templateIds = (approvedTemplates || []).map(t => t.id);
        if (templateIds.length === 0) continue;

        console.log(`[waba-template-sync] Fetching analytics for ${templateIds.length} templates, range: ${startDate} to ${endDate}`);

        const rows = await fetchTemplateAnalyticsRaw(
          account.waba_id,
          accessToken,
          templateIds,
          startDate,
          endDate
        );

        console.log(`[waba-template-sync] Got ${rows.length} analytics rows`);

        // Batch upsert analytics rows (500 at a time)
        for (let i = 0; i < rows.length; i += 500) {
          const batch = rows.slice(i, i + 500).map(r => ({
            ...r,
            synced_at: new Date().toISOString(),
          }));

          const { error } = await svc
            .from('waba_template_daily_analytics')
            .upsert(batch, { onConflict: 'template_id,date' });

          if (error) {
            console.error(`[waba-template-sync] Upsert analytics error:`, error);
            errors.push(`Analytics upsert batch ${Math.floor(i / 500) + 1}: ${error.message}`);
          } else {
            analyticsRowsUpserted += batch.length;
          }
        }
      } catch (err: any) {
        console.error(`[waba-template-sync] Analytics error for ${account.waba_id}:`, err.message);
        errors.push(`Analytics ${account.waba_id}: ${err.message}`);
      }
    }

    // ── Update sync log ──
    const duration = Date.now() - startTime;
    const status = errors.length === 0 ? 'success' : (templatesSynced > 0 ? 'partial' : 'failed');

    if (logId) {
      await svc.from('waba_template_sync_log').update({
        templates_synced: templatesSynced,
        analytics_rows_upserted: analyticsRowsUpserted,
        status,
        error_message: errors.length > 0 ? errors.join('; ') : null,
        duration_ms: duration,
      }).eq('id', logId);
    }

    console.log(`[waba-template-sync] Done: ${templatesSynced} templates, ${analyticsRowsUpserted} analytics rows, ${duration}ms`);

    return NextResponse.json({
      success: status !== 'failed',
      status,
      mode,
      templates_synced: templatesSynced,
      analytics_rows_upserted: analyticsRowsUpserted,
      date_range: { start: startDate, end: endDate },
      duration_ms: duration,
      errors: errors.length > 0 ? errors : undefined,
    });

  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error('[waba-template-sync] Fatal error:', err);

    try {
      const svc = getServiceSupabase();
      await svc.from('waba_template_sync_log').insert({
        sync_type: 'cron',
        status: 'failed',
        error_message: err.message,
        duration_ms: duration,
      });
    } catch {}

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
