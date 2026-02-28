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

// ── Fetch ALL pages for a single status+date combo ──
async function fetchAllPages(
  apiKey: string,
  baseUrl: string,
  status: string,
  timeSinceParam: string,
  sinceDate: string,
): Promise<{ results: any[]; error?: string }> {
  const orders: any[] = [];
  let lastId = 0;
  let hasNext = true;
  let page = 0;

  while (hasNext && page < 200) {
    page++;
    let url = `${baseUrl}/order?status=${status}&${timeSinceParam}=${encodeURIComponent(sinceDate)}&page_size=25`;
    if (lastId > 0) url += `&last_id=${lastId}`;

    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!res.ok) {
        const text = await res.text();
        if (res.status === 400 || res.status === 404) {
          return { results: orders, error: `Filter not supported: ${res.status}` };
        }
        throw new Error(`Scalev API ${res.status}: ${text}`);
      }

      const json = await res.json();
      if (json.code !== 200) return { results: orders, error: `Code ${json.code}` };

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

// ── Load existing order statuses from DB for diff ──
async function loadExistingStatuses(svc: any, orderIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // Query in chunks of 500 to avoid URL length limits
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = orderIds.slice(i, i + 500);
    const { data } = await svc
      .from('scalev_orders')
      .select('order_id, status')
      .in('order_id', chunk);
    for (const row of data || []) {
      map.set(row.order_id, row.status);
    }
  }
  return map;
}

// ── Batch upsert ONLY changed orders ──
async function batchUpsertChanged(
  svc: any,
  orders: any[],
  existingStatuses: Map<string, string>,
): Promise<{ upserted: number; skipped: number; errors: string[] }> {
  const BATCH_SIZE = 100;
  let totalUpserted = 0;
  let totalSkipped = 0;
  const errors: string[] = [];

  // Step 1: Parse all orders (parallel) and filter changed
  const parsed = await Promise.all(
    orders.map(async (order) => {
      try {
        const existingStatus = existingStatuses.get(order.order_id);
        // Skip if status unchanged AND order exists in DB
        if (existingStatus && existingStatus === order.status) {
          return { skip: true };
        }
        const { orderHeader, orderLines } = await parseOrderForDb(order);
        return { orderHeader, orderLines, orderId: order.order_id, skip: false };
      } catch (err: any) {
        errors.push(`Parse ${order.order_id}: ${err.message}`);
        return { skip: true };
      }
    })
  );

  const changed = parsed.filter((p) => !p.skip) as {
    orderHeader: any;
    orderLines: any[];
    orderId: string;
    skip: false;
  }[];
  totalSkipped = parsed.length - changed.length;

  if (changed.length === 0) {
    return { upserted: 0, skipped: totalSkipped, errors };
  }

  // Step 2: Process batches in parallel (2 at a time to avoid overwhelming DB)
  const batches: typeof changed[] = [];
  for (let i = 0; i < changed.length; i += BATCH_SIZE) {
    batches.push(changed.slice(i, i + BATCH_SIZE));
  }

  const PARALLEL_BATCHES = 2;
  for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
    const parallelChunk = batches.slice(i, i + PARALLEL_BATCHES);

    const results = await Promise.all(
      parallelChunk.map(async (batch) => {
        let batchUpserted = 0;
        const batchErrors: string[] = [];

        try {
          const headers = batch.map((o) => o.orderHeader);

          const { data: upsertedRows, error: upsertErr } = await svc
            .from('scalev_orders')
            .upsert(headers, { onConflict: 'order_id', ignoreDuplicates: false })
            .select('id, order_id');

          if (upsertErr) {
            batchErrors.push(`Upsert: ${upsertErr.message}`);
            return { upserted: 0, errors: batchErrors };
          }

          // Build id lookup
          const idMap = new Map<string, string>();
          for (const row of upsertedRows || []) {
            idMap.set(row.order_id, row.id);
          }

          // Batch delete old lines
          const orderIds = batch.map((o) => o.orderId);
          await svc.from('scalev_order_lines').delete().in('order_id', orderIds);

          // Batch insert new lines
          const allLines: any[] = [];
          for (const o of batch) {
            const internalId = idMap.get(o.orderId);
            if (!internalId || o.orderLines.length === 0) continue;
            for (const line of o.orderLines) {
              allLines.push({ ...line, scalev_order_id: internalId });
            }
          }

          // Insert lines in sub-batches of 500
          if (allLines.length > 0) {
            const linePromises: Promise<any>[] = [];
            for (let j = 0; j < allLines.length; j += 500) {
              const lineBatch = allLines.slice(j, j + 500);
              linePromises.push(
                svc.from('scalev_order_lines').insert(lineBatch)
                  .then(({ error }: any) => {
                    if (error) batchErrors.push(`Lines: ${error.message}`);
                  })
              );
            }
            await Promise.all(linePromises);
          }

          batchUpserted = batch.length;
        } catch (err: any) {
          batchErrors.push(`Batch error: ${err.message}`);
        }

        return { upserted: batchUpserted, errors: batchErrors };
      })
    );

    for (const r of results) {
      totalUpserted += r.upserted;
      errors.push(...r.errors);
    }
  }

  return { upserted: totalUpserted, skipped: totalSkipped, errors };
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

    const { data: syncLog } = await svc
      .from('scalev_sync_log')
      .insert({ status: 'running', sync_type: mode })
      .select('id')
      .single();
    const logId = syncLog?.id;

    const START = Date.now();

    // ══════════════════════════════════════════
    // STATUS MODE: parallel fetch, diff, batch upsert changed only
    // ══════════════════════════════════════════
    if (mode === 'status') {
      const now = new Date();
      const sinceDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const sinceISO = sinceDate.toISOString();

      const statusQueries = [
        { status: 'shipped',     timeParam: 'shipped_time_since' },
        { status: 'shipped_rts', timeParam: 'shipped_time_since' },
        { status: 'confirmed',   timeParam: 'confirmed_time_since' },
        { status: 'in_process',  timeParam: 'confirmed_time_since' },
        { status: 'ready',       timeParam: 'confirmed_time_since' },
      ];

      // Step 1: Parallel fetch all statuses from Scalev
      const fetchResults = await Promise.all(
        statusQueries.map((q) =>
          fetchAllPages(config.api_key, config.base_url, q.status, q.timeParam, sinceISO)
            .then((r) => ({ ...r, queryStatus: q.status }))
        )
      );

      const allOrders: any[] = [];
      const allErrors: string[] = [];

      for (const fr of fetchResults) {
        if (fr.error) allErrors.push(`${fr.queryStatus}: ${fr.error}`);
        allOrders.push(...fr.results);
      }

      const totalFetched = allOrders.length;

      // Deduplicate
      const seen = new Set<number>();
      const uniqueOrders = allOrders.filter((o) => {
        if (seen.has(o.id)) return false;
        seen.add(o.id);
        return true;
      });

      // Step 2: Load existing statuses from DB (one fast query)
      const orderIds = uniqueOrders.map((o) => o.order_id);
      const existingStatuses = await loadExistingStatuses(svc, orderIds);

      // Step 3: Only upsert changed orders
      const { upserted, skipped, errors: upsertErrors } = await batchUpsertChanged(svc, uniqueOrders, existingStatuses);
      allErrors.push(...upsertErrors);

      const elapsed = Math.round((Date.now() - START) / 1000);

      if (logId) {
        await svc.from('scalev_sync_log').update({
          completed_at: new Date().toISOString(),
          status: allErrors.length > 0 ? 'completed_with_warnings' : 'success',
          orders_fetched: totalFetched,
          orders_inserted: upserted,
          error_message: allErrors.length > 0 ? allErrors.slice(0, 5).join('; ') : null,
        }).eq('id', logId);
      }

      return NextResponse.json({
        success: true,
        sync_type: 'status',
        orders_fetched: totalFetched,
        orders_unique: uniqueOrders.length,
        orders_changed: upserted,
        orders_skipped: skipped,
        elapsed_seconds: elapsed,
        timed_out: false,
        warnings: allErrors.length,
        message: `Sync done! ${totalFetched} fetched, ${upserted} changed, ${skipped} unchanged (${elapsed}s).`,
      });
    }

    // ══════════════════════════════════════════
    // INCREMENTAL / FULL MODE (batch version)
    // ══════════════════════════════════════════
    let currentLastId = mode === 'full' ? 0 : config.last_sync_id;
    let maxScalevId = currentLastId;
    let hasMore = true;
    let timedOut = false;
    const TIME_LIMIT_MS = 240000;
    let totalFetched = 0;
    let totalUpserted = 0;
    const allErrors: string[] = [];
    const buffer: any[] = [];
    const FLUSH_SIZE = 100;

    while (hasMore) {
      if (Date.now() - START > TIME_LIMIT_MS) { timedOut = true; break; }

      const page = await fetchOrderList(config.api_key, config.base_url, currentLastId, 25);
      if (!page.results || page.results.length === 0) { hasMore = false; break; }

      for (const order of page.results) {
        totalFetched++;
        if (order.id > maxScalevId) maxScalevId = order.id;
        buffer.push(order);
      }

      if (buffer.length >= FLUSH_SIZE) {
        const ids = buffer.map((o) => o.order_id);
        const existing = await loadExistingStatuses(svc, ids);
        const { upserted, errors } = await batchUpsertChanged(svc, buffer.splice(0), existing);
        totalUpserted += upserted;
        allErrors.push(...errors);

        await svc.from('scalev_config').update({
          last_sync_id: maxScalevId,
          updated_at: new Date().toISOString(),
        }).eq('id', config.id);
      }

      hasMore = page.hasNext;
      currentLastId = page.lastId;
    }

    if (buffer.length > 0) {
      const ids = buffer.map((o) => o.order_id);
      const existing = await loadExistingStatuses(svc, ids);
      const { upserted, errors } = await batchUpsertChanged(svc, buffer, existing);
      totalUpserted += upserted;
      allErrors.push(...errors);
    }

    await svc.from('scalev_config').update({
      last_sync_id: maxScalevId,
      updated_at: new Date().toISOString(),
    }).eq('id', config.id);

    const elapsed = Math.round((Date.now() - START) / 1000);

    if (logId) {
      await svc.from('scalev_sync_log').update({
        completed_at: new Date().toISOString(),
        status: timedOut ? 'partial' : (allErrors.length > 0 ? 'completed_with_warnings' : 'success'),
        orders_fetched: totalFetched,
        orders_inserted: totalUpserted,
        error_message: timedOut
          ? `Time limit after ${elapsed}s. Run again to continue.`
          : (allErrors.length > 0 ? allErrors.slice(0, 5).join('; ') : null),
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
