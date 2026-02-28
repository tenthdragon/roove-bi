// app/api/scalev-sync/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getScalevConfig,
  fetchOrderList,
  parseOrderForDb,
  clearProductMappingCache,
} from '@/lib/scalev-api';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export const maxDuration = 250;

// ── Fetch orders by status + date range from Scalev API ──
async function fetchByStatusAndDate(
  apiKey: string,
  baseUrl: string,
  status: string,
  timeSinceParam: string,  // e.g. 'shipped_time_since'
  sinceDate: string,       // ISO 8601: '2026-01-01T00:00:00'
  pageSize: number = 25,
): Promise<{ results: any[]; error?: string }> {
  const orders: any[] = [];
  let lastId = 0;
  let hasNext = true;
  const MAX_PAGES = 200;
  let page = 0;

  while (hasNext && page < MAX_PAGES) {
    page++;
    let url = `${baseUrl}/order?status=${status}&${timeSinceParam}=${encodeURIComponent(sinceDate)}&page_size=${pageSize}`;
    if (lastId > 0) url += `&last_id=${lastId}`;

    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!res.ok) {
        const text = await res.text();
        // If filter combo not supported, return what we have
        if (res.status === 400 || res.status === 404) {
          return { results: orders, error: `Filter not supported: ${res.status} - ${text}` };
        }
        throw new Error(`Scalev API ${res.status}: ${text}`);
      }

      const json = await res.json();
      if (json.code !== 200) {
        return { results: orders, error: `Scalev code ${json.code}` };
      }

      const batch = json.data?.results || [];
      if (batch.length === 0) break;

      orders.push(...batch);
      hasNext = json.data?.has_next || false;
      lastId = json.data?.last_id || 0;
    } catch (err: any) {
      return { results: orders, error: err.message };
    }
  }

  return { results: orders };
}

// ── Upsert a single order + lines ──
async function upsertOrder(svc: any, order: any): Promise<{ ok: boolean; error?: string }> {
  try {
    const { orderHeader, orderLines } = await parseOrderForDb(order);

    const { data: upserted, error: orderErr } = await svc
      .from('scalev_orders')
      .upsert(orderHeader, { onConflict: 'scalev_id' })
      .select('id')
      .single();

    if (orderErr) return { ok: false, error: `Upsert ${order.order_id}: ${orderErr.message}` };

    // Replace order lines
    await svc.from('scalev_order_lines').delete().eq('order_id', order.order_id);
    if (orderLines.length > 0) {
      const linesWithFk = orderLines.map((l: any) => ({ ...l, scalev_order_id: upserted.id }));
      await svc.from('scalev_order_lines').insert(linesWithFk);
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `Parse ${order.order_id}: ${err.message}` };
  }
}

// ══ POST: trigger sync ══
export async function POST(req: NextRequest) {
  try {
    let mode = 'status';
    try {
      const body = await req.json();
      if (body.mode === 'incremental' || body.mode === 'full') mode = body.mode;
    } catch {}

    const config = await getScalevConfig();
    if (!config) return NextResponse.json({ error: 'Scalev not configured' }, { status: 400 });

    const svc = getServiceSupabase();
    clearProductMappingCache();

    // Create sync log
    const { data: syncLog } = await svc
      .from('scalev_sync_log')
      .insert({ status: 'running', sync_type: mode })
      .select('id')
      .single();
    const logId = syncLog?.id;

    const START = Date.now();
    let totalFetched = 0;
    let totalUpserted = 0;
    const errors: string[] = [];

    // ══════════════════════════════════════════
    // STATUS MODE: only in-flight, last 2 months
    // ══════════════════════════════════════════
    if (mode === 'status') {
      // Date: first day of previous month
      const now = new Date();
      const sinceDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const sinceISO = sinceDate.toISOString();

      // Fetch in-flight orders with appropriate date filter
      const statusQueries = [
        { status: 'shipped',     timeParam: 'shipped_time_since' },
        { status: 'shipped_rts', timeParam: 'shipped_time_since' },
        { status: 'confirmed',   timeParam: 'confirmed_time_since' },
        { status: 'in_process',  timeParam: 'confirmed_time_since' },
        { status: 'ready',       timeParam: 'confirmed_time_since' },
      ];

      for (const q of statusQueries) {
        const { results, error: fetchErr } = await fetchByStatusAndDate(
          config.api_key, config.base_url,
          q.status, q.timeParam, sinceISO,
        );

        if (fetchErr) {
          errors.push(`${q.status}: ${fetchErr}`);
          // If filter not supported, don't continue — will show error to user
          if (fetchErr.includes('not supported')) break;
        }

        totalFetched += results.length;

        for (const order of results) {
          const { ok, error: upsertErr } = await upsertOrder(svc, order);
          if (ok) totalUpserted++;
          else if (upsertErr) errors.push(upsertErr);
        }
      }

      const elapsed = Math.round((Date.now() - START) / 1000);

      if (logId) {
        await svc.from('scalev_sync_log').update({
          completed_at: new Date().toISOString(),
          status: errors.length > 0 ? 'completed_with_warnings' : 'success',
          orders_fetched: totalFetched,
          orders_inserted: totalUpserted,
          error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
        }).eq('id', logId);
      }

      return NextResponse.json({
        success: true,
        sync_type: 'status',
        orders_fetched: totalFetched,
        orders_inserted: totalUpserted,
        elapsed_seconds: elapsed,
        timed_out: false,
        warnings: errors.length,
        message: `Sync complete! ${totalFetched} in-flight orders checked, ${totalUpserted} updated (${elapsed}s).`,
      });
    }

    // ══════════════════════════════════════════
    // INCREMENTAL / FULL MODE (legacy fallback)
    // ══════════════════════════════════════════
    let currentLastId = mode === 'full' ? 0 : config.last_sync_id;
    let maxScalevId = currentLastId;
    let hasMore = true;
    let timedOut = false;
    const TIME_LIMIT_MS = 240000;
    let iterations = 0;

    while (hasMore && iterations < 10000) {
      if (Date.now() - START > TIME_LIMIT_MS) { timedOut = true; break; }
      iterations++;

      const page = await fetchOrderList(config.api_key, config.base_url, currentLastId, 25);
      if (!page.results || page.results.length === 0) { hasMore = false; break; }

      for (const order of page.results) {
        totalFetched++;
        if (order.id > maxScalevId) maxScalevId = order.id;
        const { ok } = await upsertOrder(svc, order);
        if (ok) totalUpserted++;
      }

      hasMore = page.hasNext;
      currentLastId = page.lastId;

      // Save progress every 250
      if (totalFetched % 250 === 0) {
        await svc.from('scalev_config').update({
          last_sync_id: maxScalevId,
          updated_at: new Date().toISOString(),
        }).eq('id', config.id);
      }
    }

    // Save final cursor
    await svc.from('scalev_config').update({
      last_sync_id: maxScalevId,
      updated_at: new Date().toISOString(),
    }).eq('id', config.id);

    const elapsed = Math.round((Date.now() - START) / 1000);

    if (logId) {
      await svc.from('scalev_sync_log').update({
        completed_at: new Date().toISOString(),
        status: timedOut ? 'partial' : 'success',
        orders_fetched: totalFetched,
        orders_inserted: totalUpserted,
        error_message: timedOut ? `Time limit after ${elapsed}s. Run again to continue.` : null,
      }).eq('id', logId);
    }

    return NextResponse.json({
      success: true,
      sync_type: mode,
      orders_fetched: totalFetched,
      orders_inserted: totalUpserted,
      last_id: maxScalevId,
      elapsed_seconds: elapsed,
      timed_out: timedOut,
      message: timedOut
        ? `Synced ${totalFetched} orders in ${elapsed}s. Click again to continue.`
        : `Sync complete! ${totalFetched} orders synced in ${elapsed}s.`,
    });
  } catch (err: any) {
    console.error('Scalev sync error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ══ GET: sync status ══
export async function GET() {
  const svc = getServiceSupabase();

  try {
    const { data: logs } = await svc
      .from('scalev_sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(5);

    const { data: config } = await svc
      .from('scalev_config')
      .select('base_url, is_active, last_sync_id, updated_at')
      .eq('is_active', true)
      .single();

    const { count: totalOrders } = await svc
      .from('scalev_orders')
      .select('*', { count: 'exact', head: true });

    const { count: shippedOrders } = await svc
      .from('scalev_orders')
      .select('*', { count: 'exact', head: true })
      .not('shipped_time', 'is', null);

    return NextResponse.json({
      configured: !!config,
      lastSyncId: config?.last_sync_id || 0,
      totalOrders: totalOrders || 0,
      shippedOrders: shippedOrders || 0,
      recentSyncs: logs || [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
