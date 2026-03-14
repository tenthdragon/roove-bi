// app/api/scalev-sync/route.ts
// Targeted sync: checks pending orders in DB against Scalev API,
// updates status/timestamps/lines for orders that have been shipped/completed.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getScalevConfig, fetchOrderDetail, deriveSalesChannel, lookupProductType, clearProductMappingCache } from '@/lib/scalev-api';
import { triggerViewRefresh } from '@/lib/refresh-views';

export const maxDuration = 120;

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// GET handler for Vercel Cron
export async function GET(req: NextRequest) {
  const proxyReq = new NextRequest(new URL(req.url), {
    method: 'POST',
    headers: req.headers,
  });
  return POST(proxyReq);
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // ── Auth: cron or owner/finance ──
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

    // ── Get Scalev config ──
    const config = await getScalevConfig();
    if (!config) {
      return NextResponse.json({ error: 'Scalev not configured' }, { status: 500 });
    }

    const svc = getServiceSupabase();

    // ── Query pending orders ──
    const { data: pendingOrders, error: queryErr } = await svc
      .from('scalev_orders')
      .select('id, order_id, scalev_id, status, store_name, raw_data')
      .eq('status', 'pending');

    if (queryErr) throw queryErr;

    if (!pendingOrders || pendingOrders.length === 0) {
      return NextResponse.json({
        success: true,
        pending_checked: 0,
        orders_updated: 0,
        orders_still_pending: 0,
        orders_errored: 0,
        duration_ms: Date.now() - startTime,
        message: 'No pending orders',
      });
    }

    // ── Insert sync log ──
    const { data: logEntry } = await svc
      .from('scalev_sync_log')
      .insert({
        status: 'running',
        sync_type: 'pending_reconcile',
        orders_fetched: pendingOrders.length,
        orders_updated: 0,
        orders_inserted: 0,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    const logId = logEntry?.id;

    // Clear product mapping cache for fresh lookups
    clearProductMappingCache();

    let updatedCount = 0;
    let stillPendingCount = 0;
    let erroredCount = 0;
    const details: any[] = [];
    const errors: string[] = [];

    // ── Check each pending order against Scalev API ──
    for (const dbOrder of pendingOrders) {
      try {
        // Determine Scalev integer ID
        const scalevId = dbOrder.scalev_id || dbOrder.raw_data?.id;
        if (!scalevId) {
          details.push({ order_id: dbOrder.order_id, error: 'No Scalev ID available' });
          erroredCount++;
          continue;
        }

        // Fetch current status from Scalev API
        let apiOrder: any;
        try {
          apiOrder = await fetchOrderDetail(config.api_key, config.base_url, String(scalevId));
        } catch (apiErr: any) {
          if (apiErr.message.includes('404')) {
            details.push({ order_id: dbOrder.order_id, error: 'Order not found in Scalev (404)' });
          } else if (apiErr.message.includes('429')) {
            // Rate limited — wait and retry once
            await new Promise(r => setTimeout(r, 2000));
            try {
              apiOrder = await fetchOrderDetail(config.api_key, config.base_url, String(scalevId));
            } catch {
              details.push({ order_id: dbOrder.order_id, error: `API error after retry: ${apiErr.message}` });
              erroredCount++;
              continue;
            }
          } else {
            details.push({ order_id: dbOrder.order_id, error: `API error: ${apiErr.message}` });
            erroredCount++;
            continue;
          }
          if (!apiOrder) {
            erroredCount++;
            continue;
          }
        }

        const newStatus = apiOrder.status;

        // Still pending — skip
        if (newStatus === 'pending' || newStatus === 'draft' || newStatus === 'confirmed' || newStatus === 'paid') {
          stillPendingCount++;
          continue;
        }

        // Status changed — update order
        const now = new Date().toISOString();
        const updateData: Record<string, any> = {
          status: newStatus,
          synced_at: now,
          raw_data: apiOrder,
        };

        // Map timestamp fields from API response
        const tsFields = ['draft_time', 'pending_time', 'confirmed_time', 'paid_time', 'shipped_time', 'completed_time', 'canceled_time'];
        for (const f of tsFields) {
          if (apiOrder[f]) updateData[f] = apiOrder[f];
        }
        if (apiOrder.gross_revenue != null) updateData.gross_revenue = apiOrder.gross_revenue;
        if (apiOrder.net_revenue != null) updateData.net_revenue = apiOrder.net_revenue;

        await svc.from('scalev_orders').update(updateData).eq('id', dbOrder.id);

        // For shipped/completed: enrich line items
        if (newStatus === 'shipped' || newStatus === 'completed') {
          await enrichLineItems(svc, dbOrder.id, apiOrder);
        }

        details.push({
          order_id: dbOrder.order_id,
          old_status: 'pending',
          new_status: newStatus,
        });
        updatedCount++;

        // Rate limit delay between API calls
        await new Promise(r => setTimeout(r, 200));

      } catch (err: any) {
        details.push({ order_id: dbOrder.order_id, error: err.message });
        errors.push(`${dbOrder.order_id}: ${err.message}`);
        erroredCount++;
      }
    }

    // ── Refresh MVs if any orders were updated to shipped/completed ──
    if (updatedCount > 0) {
      triggerViewRefresh();
    }

    // ── Update sync log ──
    if (logId) {
      await svc.from('scalev_sync_log').update({
        status: errors.length === 0 ? 'success' : 'partial',
        orders_updated: updatedCount,
        error_message: errors.length > 0 ? errors.join('; ') : null,
        completed_at: new Date().toISOString(),
      }).eq('id', logId);
    }

    return NextResponse.json({
      success: true,
      pending_checked: pendingOrders.length,
      orders_updated: updatedCount,
      orders_still_pending: stillPendingCount,
      orders_errored: erroredCount,
      duration_ms: Date.now() - startTime,
      details,
    });

  } catch (err: any) {
    console.error('[scalev-sync] Fatal error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── Enrich line items after status change to shipped/completed ──
async function enrichLineItems(svc: any, dbOrderId: number, apiOrder: any) {
  const shippedTime = apiOrder.shipped_time || apiOrder.completed_time || null;

  // 1. Propagate shipped_time to lines
  if (shippedTime) {
    await svc
      .from('scalev_order_lines')
      .update({ shipped_time: shippedTime })
      .eq('scalev_order_id', dbOrderId)
      .is('shipped_time', null);
  }

  // 2. Re-derive sales_channel
  const newChannel = deriveSalesChannel(apiOrder);
  await svc
    .from('scalev_order_lines')
    .update({
      sales_channel: newChannel,
      is_purchase_fb: apiOrder.is_purchase_fb || false,
      is_purchase_tiktok: apiOrder.is_purchase_tiktok || false,
      is_purchase_kwai: apiOrder.is_purchase_kwai || false,
    })
    .eq('scalev_order_id', dbOrderId);

  // 3. Re-derive brand (product_type) for each line
  const { data: lines } = await svc
    .from('scalev_order_lines')
    .select('id, product_name')
    .eq('scalev_order_id', dbOrderId);

  for (const line of lines || []) {
    const brand = await lookupProductType(line.product_name || '');
    await svc
      .from('scalev_order_lines')
      .update({ product_type: brand })
      .eq('id', line.id);
  }
}
