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

// Fetch orders filtered by status (paginate through all pages)
async function fetchOrdersByStatus(
  apiKey: string,
  baseUrl: string,
  status: string,
  pageSize: number = 25
): Promise<{ results: any[]; error?: string }> {
  const orders: any[] = [];
  let lastId = 0;
  let hasNext = true;
  const MAX_PAGES = 200; // safety limit
  let page = 0;

  while (hasNext && page < MAX_PAGES) {
    page++;
    let url = `${baseUrl}/order?status=${status}&page_size=${pageSize}`;
    if (lastId > 0) url += `&last_id=${lastId}`;

    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });

      if (!res.ok) {
        // If status filter returns 404/400, it's not supported
        if (res.status === 404 || res.status === 400) {
          return { results: [], error: `Status filter '${status}' not supported (${res.status})` };
        }
        throw new Error(`Scalev API ${res.status}: ${await res.text()}`);
      }

      const json = await res.json();
      if (json.code !== 200) {
        return { results: [], error: `Scalev API code ${json.code}` };
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

// Set max duration for Vercel Pro
export const maxDuration = 250;

// POST: trigger sync
export async function POST(req: NextRequest) {
  try {
    // Parse mode
    let syncMode: 'incremental' | 'full' | 'status' = 'status';
    try {
      const body = await req.json();
      if (body.mode === 'full') syncMode = 'full';
      else if (body.mode === 'incremental') syncMode = 'incremental';
    } catch {
      // default to status-based sync
    }

    const config = await getScalevConfig();
    if (!config) {
      return NextResponse.json({ error: 'Scalev not configured' }, { status: 400 });
    }

    const svc = getServiceSupabase();

    // Create sync log
    const { data: syncLog, error: logError } = await svc
      .from('scalev_sync_log')
      .insert({ status: 'running', sync_type: syncMode })
      .select('id')
      .single();
    if (logError) throw logError;
    const syncLogId = syncLog.id;

    clearProductMappingCache();

    const START_TIME = Date.now();
    let totalFetched = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let errors: string[] = [];

    // ══ STATUS-BASED SYNC (new default) ══
    // Only fetch in-flight orders: confirmed → shipped (not completed)
    if (syncMode === 'status') {
      const IN_FLIGHT_STATUSES = ['pending', 'confirmed', 'in_process', 'ready', 'shipped', 'shipped_rts'];

      for (const status of IN_FLIGHT_STATUSES) {
        const { results, error: fetchErr } = await fetchOrdersByStatus(
          config.api_key, config.base_url, status
        );

        if (fetchErr) {
          // If status filter not supported, fall back to incremental
          if (fetchErr.includes('not supported')) {
            console.warn(`Status filter not supported, falling back to incremental`);
            syncMode = 'incremental';
            break;
          }
          errors.push(`${status}: ${fetchErr}`);
          continue;
        }

        totalFetched += results.length;

        // Upsert each order
        for (const order of results) {
          try {
            const { orderHeader, orderLines } = await parseOrderForDb(order);

            const { data: upsertedOrder, error: orderError } = await svc
              .from('scalev_orders')
              .upsert(orderHeader, { onConflict: 'scalev_id' })
              .select('id')
              .single();

            if (orderError) {
              errors.push(`Upsert ${order.order_id}: ${orderError.message}`);
              continue;
            }

            // Replace order lines
            await svc.from('scalev_order_lines').delete().eq('order_id', order.order_id);
            if (orderLines.length > 0) {
              const linesWithFk = orderLines.map(line => ({
                ...line,
                scalev_order_id: upsertedOrder.id,
              }));
              await svc.from('scalev_order_lines').insert(linesWithFk);
            }

            totalInserted++;
          } catch (err: any) {
            errors.push(`Parse ${order.order_id}: ${err.message}`);
          }
        }
      }

      // If status filter worked, we're done
      if (syncMode === 'status') {
        const elapsed = Math.round((Date.now() - START_TIME) / 1000);

        await svc.from('scalev_sync_log').update({
          completed_at: new Date().toISOString(),
          status: errors.length > 0 ? 'completed_with_warnings' : 'success',
          orders_fetched: totalFetched,
          orders_inserted: totalInserted,
          error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
        }).eq('id', syncLogId);

        return NextResponse.json({
          success: true,
          sync_type: 'status',
          orders_fetched: totalFetched,
          orders_inserted: totalInserted,
          elapsed_seconds: elapsed,
          timed_out: false,
          warnings: errors.length,
          message: `Sync complete! ${totalFetched} in-flight orders checked in ${elapsed}s.`,
        });
      }
    }

    // ══ INCREMENTAL / FULL SYNC (fallback or explicit) ══
    let currentLastId = syncMode === 'full' ? 0 : config.last_sync_id;
    let maxScalevId = currentLastId;
    let hasMore = true;
    let timedOut = false;
    const PAGE_SIZE = 25;
    const MAX_ITERATIONS = 10000;
    const TIME_LIMIT_MS = 240000;
    let iterations = 0;

    try {
      while (hasMore && iterations < MAX_ITERATIONS) {
        if (Date.now() - START_TIME > TIME_LIMIT_MS) {
          timedOut = true;
          break;
        }

        iterations++;
        const page = await fetchOrderList(config.api_key, config.base_url, currentLastId, PAGE_SIZE);

        if (!page.results || page.results.length === 0) {
          hasMore = false;
          break;
        }

        for (const order of page.results) {
          totalFetched++;
          if (order.id > maxScalevId) maxScalevId = order.id;

          const { orderHeader, orderLines } = await parseOrderForDb(order);

          const { data: upsertedOrder, error: orderError } = await svc
            .from('scalev_orders')
            .upsert(orderHeader, { onConflict: 'scalev_id' })
            .select('id')
            .single();

          if (orderError) {
            console.error(`Error upserting order ${order.order_id}:`, orderError);
            continue;
          }

          await svc.from('scalev_order_lines').delete().eq('order_id', order.order_id);
          if (orderLines.length > 0) {
            const linesWithFk = orderLines.map(line => ({
              ...line,
              scalev_order_id: upsertedOrder.id,
            }));
            const { error: lineError } = await svc.from('scalev_order_lines').insert(linesWithFk);
            if (lineError) console.error(`Error lines for ${order.order_id}:`, lineError);
          }

          totalInserted++;
        }

        hasMore = page.hasNext;
        currentLastId = page.lastId;

        if (totalFetched % 250 === 0) {
          await svc.from('scalev_sync_log').update({
            orders_fetched: totalFetched,
            orders_inserted: totalInserted,
          }).eq('id', syncLogId);

          await svc.from('scalev_config').update({
            last_sync_id: maxScalevId,
            updated_at: new Date().toISOString(),
          }).eq('id', config.id);
        }
      }

      await svc.from('scalev_config').update({
        last_sync_id: maxScalevId,
        updated_at: new Date().toISOString(),
      }).eq('id', config.id);

      const elapsed = Math.round((Date.now() - START_TIME) / 1000);

      await svc.from('scalev_sync_log').update({
        completed_at: new Date().toISOString(),
        status: timedOut ? 'partial' : 'success',
        orders_fetched: totalFetched,
        orders_inserted: totalInserted,
        orders_updated: totalUpdated,
        error_message: timedOut
          ? `Time limit reached after ${elapsed}s. Synced ${totalFetched} orders. Run again to continue.`
          : null,
      }).eq('id', syncLogId);

      return NextResponse.json({
        success: true,
        sync_type: syncMode,
        orders_fetched: totalFetched,
        orders_inserted: totalInserted,
        last_id: maxScalevId,
        elapsed_seconds: elapsed,
        timed_out: timedOut,
        message: timedOut
          ? `Synced ${totalFetched} orders in ${elapsed}s. Click Sync again to continue.`
          : `Sync complete! ${totalFetched} orders synced in ${elapsed}s.`,
      });
    } catch (syncErr: any) {
      if (maxScalevId > config.last_sync_id) {
        await svc.from('scalev_config').update({
          last_sync_id: maxScalevId,
          updated_at: new Date().toISOString(),
        }).eq('id', config.id);
      }

      await svc.from('scalev_sync_log').update({
        completed_at: new Date().toISOString(),
        status: 'error',
        orders_fetched: totalFetched,
        orders_inserted: totalInserted,
        error_message: syncErr.message,
      }).eq('id', syncLogId);

      throw syncErr;
    }
  } catch (err: any) {
    console.error('Scalev sync error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET: return sync status
export async function GET(req: NextRequest) {
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
