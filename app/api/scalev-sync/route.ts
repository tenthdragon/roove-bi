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

// POST: trigger sync (from cron or manual)
export async function POST(req: NextRequest) {
  try {
    // Auth: check for CRON_SECRET
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse mode
    let syncMode: 'incremental' | 'full' = 'incremental';
    try {
      const body = await req.json();
      if (body.mode === 'full') syncMode = 'full';
    } catch {
      // default incremental
    }

    // Get Scalev config
    const config = await getScalevConfig();
    if (!config) {
      return NextResponse.json({ error: 'Scalev not configured' }, { status: 400 });
    }

    const svc = getServiceSupabase();

    // Create sync log entry
    const { data: syncLog, error: logError } = await svc
      .from('scalev_sync_log')
      .insert({
        status: 'running',
        sync_type: syncMode,
      })
      .select('id')
      .single();

    if (logError) throw logError;
    const syncLogId = syncLog.id;

    // Clear product mapping cache for fresh lookups
    clearProductMappingCache();

    let totalFetched = 0;
    let totalInserted = 0;
    let totalUpdated = 0;
    let currentLastId = syncMode === 'full' ? 0 : config.last_sync_id;
    let maxScalevId = currentLastId;
    let hasMore = true;

    // Scalev API quirk: page_size=1 is most reliable
    const PAGE_SIZE = 1;
    // Safety limit to prevent infinite loops
    const MAX_ITERATIONS = 50000;
    let iterations = 0;

    try {
      while (hasMore && iterations < MAX_ITERATIONS) {
        iterations++;

        const page = await fetchOrderList(
          config.api_key,
          config.base_url,
          currentLastId,
          PAGE_SIZE
        );

        if (!page.results || page.results.length === 0) {
          hasMore = false;
          break;
        }

        for (const order of page.results) {
          totalFetched++;

          // Track max scalev_id for incremental sync
          if (order.id > maxScalevId) {
            maxScalevId = order.id;
          }

          // Parse order data
          const { orderHeader, orderLines } = await parseOrderForDb(order);

          // Upsert order header
          const { data: upsertedOrder, error: orderError } = await svc
            .from('scalev_orders')
            .upsert(orderHeader, { onConflict: 'scalev_id' })
            .select('id')
            .single();

          if (orderError) {
            console.error(`Error upserting order ${order.order_id}:`, orderError);
            continue;
          }

          // Delete existing lines for this order (for upsert behavior)
          await svc
            .from('scalev_order_lines')
            .delete()
            .eq('order_id', order.order_id);

          // Insert order lines
          if (orderLines.length > 0) {
            const linesWithFk = orderLines.map(line => ({
              ...line,
              scalev_order_id: upsertedOrder.id,
            }));

            const { error: lineError } = await svc
              .from('scalev_order_lines')
              .insert(linesWithFk);

            if (lineError) {
              console.error(`Error inserting lines for ${order.order_id}:`, lineError);
            }
          }

          totalInserted++;
        }

        hasMore = page.hasNext;
        currentLastId = page.lastId;

        // Update progress every 100 orders
        if (totalFetched % 100 === 0) {
          await svc
            .from('scalev_sync_log')
            .update({
              orders_fetched: totalFetched,
              orders_inserted: totalInserted,
            })
            .eq('id', syncLogId);
        }
      }

      // Update config with last sync ID
      await svc
        .from('scalev_config')
        .update({
          last_sync_id: maxScalevId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', config.id);

      // Finalize sync log
      await svc
        .from('scalev_sync_log')
        .update({
          completed_at: new Date().toISOString(),
          status: 'success',
          orders_fetched: totalFetched,
          orders_inserted: totalInserted,
          orders_updated: totalUpdated,
        })
        .eq('id', syncLogId);

      return NextResponse.json({
        success: true,
        sync_type: syncMode,
        orders_fetched: totalFetched,
        orders_inserted: totalInserted,
        last_id: maxScalevId,
      });

    } catch (syncErr: any) {
      // Update sync log with error
      await svc
        .from('scalev_sync_log')
        .update({
          completed_at: new Date().toISOString(),
          status: 'error',
          orders_fetched: totalFetched,
          orders_inserted: totalInserted,
          error_message: syncErr.message,
        })
        .eq('id', syncLogId);

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
