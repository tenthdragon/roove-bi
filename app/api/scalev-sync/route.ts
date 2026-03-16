// app/api/scalev-sync/route.ts
// Per-business sync: checks pending orders in DB against Scalev API,
// using each business's own API key. Updates status/timestamps/lines
// for orders that have been shipped/completed.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchOrderDetail, deriveChannelFromStoreType, guessStoreType, lookupProductType, clearProductMappingCache, type StoreType } from '@/lib/scalev-api';
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
      let user: any = null;
      try {
        const { createServerSupabase } = await import('@/lib/supabase-server');
        const supabase = createServerSupabase();
        const { data } = await supabase.auth.getUser();
        user = data?.user;
      } catch (authErr: any) {
        console.error('[scalev-sync] Auth error:', authErr.message);
        return NextResponse.json({ error: 'Sesi kedaluwarsa, silakan refresh halaman' }, { status: 401 });
      }
      if (!user) {
        return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      }
      const svcAuth = getServiceSupabase();
      const { data: profile } = await svcAuth
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profile?.role !== 'owner' && profile?.role !== 'finance') {
        return NextResponse.json({ error: 'Only owners and finance users can sync' }, { status: 403 });
      }
    }

    // ── Parse optional body for targeted sync ──
    let syncMode: 'full' | 'date' | 'order_id' | 'repair' = 'full';
    let targetDate: string | null = null;
    let targetOrderIds: string[] | null = null;

    try {
      const ct = req.headers.get('content-type');
      if (ct?.includes('application/json')) {
        const body = await req.json();
        if (body.mode === 'date' && body.date) {
          syncMode = 'date';
          targetDate = body.date;
        } else if (body.mode === 'repair' && body.date) {
          syncMode = 'repair';
          targetDate = body.date;
        } else if (body.mode === 'order_id' && body.order_ids?.length > 0) {
          syncMode = 'order_id';
          targetOrderIds = body.order_ids;
        }
      }
    } catch {
      // No body or invalid JSON — full sync
    }

    const svc = getServiceSupabase();

    // ── Parallel setup: fetch all config data in one round-trip ──
    const [bizRes, taxRes, storeRes] = await Promise.all([
      svc.from('scalev_webhook_businesses')
        .select('id, business_code, api_key, tax_rate_name')
        .eq('is_active', true)
        .not('api_key', 'is', null),
      svc.from('tax_rates')
        .select('name, rate')
        .order('effective_from', { ascending: false }),
      svc.from('scalev_store_channels')
        .select('store_name, store_type, business_id')
        .eq('is_active', true),
    ]);

    if (bizRes.error) throw bizRes.error;
    const businesses = (bizRes.data || []).filter(b => b.api_key);

    const taxRatesMap = new Map<string, { rate: number; divisor: number }>();
    for (const r of taxRes.data || []) {
      if (!taxRatesMap.has(r.name)) {
        const rate = Number(r.rate);
        taxRatesMap.set(r.name, { rate, divisor: 1 + rate / 100 });
      }
    }
    taxRatesMap.set('NONE', { rate: 0, divisor: 1.0 });
    if (businesses.length === 0) {
      return NextResponse.json({ error: 'No businesses with API keys configured' }, { status: 500 });
    }

    const storeTypeMap = new Map<string, StoreType>();
    for (const row of storeRes.data || []) {
      storeTypeMap.set(`${row.business_id}:${row.store_name.toLowerCase()}`, row.store_type as StoreType);
    }

    // ── Query orders based on sync mode ──
    let pendingOrders: any[] = [];

    // Omit raw_data from initial query — it's large JSON that causes timeouts
    // We only need scalev_id; raw_data is fetched per-order when scalev_id is null
    const lightCols = 'id, order_id, scalev_id, status, store_name, business_code';

    if (syncMode === 'order_id' && targetOrderIds) {
      const { data, error } = await svc
        .from('scalev_orders')
        .select(lightCols)
        .in('order_id', targetOrderIds);
      if (error) throw error;
      pendingOrders = data || [];
    } else if (syncMode === 'date' && targetDate) {
      // Date mode: ONLY pre-terminal orders (the ones that might have changed)
      const dayStart = `${targetDate}T00:00:00+07:00`;
      const dayEnd = `${targetDate}T23:59:59+07:00`;
      const { data, error } = await svc
        .from('scalev_orders')
        .select(lightCols)
        .gte('pending_time', dayStart)
        .lte('pending_time', dayEnd)
        .in('status', ['pending', 'ready', 'draft', 'confirmed', 'paid']);
      if (error) throw error;
      pendingOrders = data || [];
    } else if (syncMode === 'repair' && targetDate) {
      // Repair mode: shipped/completed orders with 0 lines for this date
      // Single query: get shipped orders, then batch-check which have lines
      const dayStart = `${targetDate}T00:00:00+07:00`;
      const dayEnd = `${targetDate}T23:59:59+07:00`;
      const { data: shippedForDate, error } = await svc
        .from('scalev_orders')
        .select(lightCols)
        .gte('pending_time', dayStart)
        .lte('pending_time', dayEnd)
        .in('status', ['shipped', 'completed']);
      if (error) throw error;
      if (shippedForDate && shippedForDate.length > 0) {
        // Single query: get all order IDs that DO have lines
        const shippedIds = shippedForDate.map(o => o.id);
        const { data: withLines } = await svc
          .from('scalev_order_lines')
          .select('scalev_order_id')
          .in('scalev_order_id', shippedIds);
        const idsWithLines = new Set((withLines || []).map(r => r.scalev_order_id));
        // Only include orders that have NO lines
        for (const order of shippedForDate) {
          if (!idsWithLines.has(order.id)) {
            pendingOrders.push(order);
          }
        }
      }
    } else {
      const { data, error } = await svc
        .from('scalev_orders')
        .select(lightCols)
        .in('status', ['pending', 'ready', 'draft', 'confirmed', 'paid']);
      if (error) throw error;
      pendingOrders = data || [];
    }

    // ── Insert sync log ──
    const { data: logEntry } = await svc
      .from('scalev_sync_log')
      .insert({
        status: 'running',
        sync_type: syncMode === 'full' ? 'pending_reconcile' : syncMode === 'repair' ? 'repair_missing_lines' : `targeted_${syncMode}`,
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

    // ── Build business_code → API key lookup ──
    const bizApiKeys = new Map<string, { api_key: string; base_url: string }>();
    for (const b of businesses) {
      bizApiKeys.set(b.business_code, { api_key: b.api_key, base_url: 'https://api.scalev.id/v2' });
    }

    // ── Build store_name → business_id lookup (reuse storeRes, no extra query) ──
    const storeToBizId = new Map<string, number>();
    for (const row of storeRes.data || []) {
      storeToBizId.set(row.store_name.toLowerCase(), row.business_id);
    }

    // business_id ↔ business_code + tax config
    const bizIdToCode = new Map<number, string>();
    const bizCodeToId = new Map<string, number>();
    const bizCodeToTaxRateName = new Map<string, string>();
    for (const b of businesses) {
      bizIdToCode.set(b.id, b.business_code);
      bizCodeToId.set(b.business_code, b.id);
      bizCodeToTaxRateName.set(b.business_code, b.tax_rate_name || 'PPN');
    }

    let updatedCount = 0;
    let stillPendingCount = 0;
    let erroredCount = 0;
    const details: any[] = [];
    const errors: string[] = [];

    // ── Check each pending order against Scalev API ──
    for (const dbOrder of pendingOrders || []) {
      try {
        // Determine Scalev integer ID (raw_data not loaded in initial query)
        let scalevId = dbOrder.scalev_id;
        if (!scalevId) {
          const { data: rawRow } = await svc
            .from('scalev_orders')
            .select('raw_data')
            .eq('id', dbOrder.id)
            .single();
          scalevId = rawRow?.raw_data?.id;
        }
        if (!scalevId) {
          details.push({ order_id: dbOrder.order_id, store_name: dbOrder.store_name, business_code: dbOrder.business_code, error: 'No Scalev ID available' });
          erroredCount++;
          continue;
        }

        // Determine which business API key to use
        let bizCode = dbOrder.business_code;
        if (!bizCode && dbOrder.store_name) {
          const bizId = storeToBizId.get(dbOrder.store_name.toLowerCase());
          if (bizId) bizCode = bizIdToCode.get(bizId) || null;
        }

        if (!bizCode || !bizApiKeys.has(bizCode)) {
          // Try all business API keys as fallback
          let found = false;
          for (const [code, config] of bizApiKeys) {
            try {
              const apiOrder = await fetchOrderDetail(config.api_key, config.base_url, String(scalevId));
              if (apiOrder) {
                // Update business_code on the order
                await svc.from('scalev_orders').update({ business_code: code }).eq('id', dbOrder.id);
                dbOrder.business_code = code;
                await processOrder(svc, dbOrder, apiOrder, storeTypeMap, bizCodeToId, bizCodeToTaxRateName, taxRatesMap, details, syncMode === 'order_id' || syncMode === 'repair');
                found = true;
                updatedCount++;
                break;
              }
            } catch {
              // This API key doesn't have access, try next
            }
          }
          if (!found) {
            details.push({ order_id: dbOrder.order_id, store_name: dbOrder.store_name, business_code: dbOrder.business_code, error: 'No matching business API key found' });
            erroredCount++;
          }
          await new Promise(r => setTimeout(r, 200));
          continue;
        }

        const config = bizApiKeys.get(bizCode)!;

        // Fetch current status from Scalev API
        let apiOrder: any;
        try {
          apiOrder = await fetchOrderDetail(config.api_key, config.base_url, String(scalevId));
        } catch (apiErr: any) {
          if (apiErr.message.includes('404')) {
            details.push({ order_id: dbOrder.order_id, store_name: dbOrder.store_name, business_code: bizCode, error: `Order not found in Scalev (404)` });
          } else if (apiErr.message.includes('429')) {
            await new Promise(r => setTimeout(r, 2000));
            try {
              apiOrder = await fetchOrderDetail(config.api_key, config.base_url, String(scalevId));
            } catch {
              details.push({ order_id: dbOrder.order_id, store_name: dbOrder.store_name, business_code: bizCode, error: `API error after retry: ${apiErr.message}` });
              erroredCount++;
              continue;
            }
          } else {
            details.push({ order_id: dbOrder.order_id, store_name: dbOrder.store_name, business_code: bizCode, error: `API error: ${apiErr.message}` });
            erroredCount++;
            continue;
          }
          if (!apiOrder) {
            erroredCount++;
            continue;
          }
        }

        const result = await processOrder(svc, dbOrder, apiOrder, storeTypeMap, bizCodeToId, bizCodeToTaxRateName, taxRatesMap, details, syncMode === 'order_id' || syncMode === 'repair');
        if (result === 'updated') updatedCount++;
        else if (result === 'still_pending') stillPendingCount++;

        // Rate limit delay between API calls (shorter for targeted sync)
        await new Promise(r => setTimeout(r, syncMode === 'full' ? 200 : 50));

      } catch (err: any) {
        details.push({ order_id: dbOrder.order_id, store_name: dbOrder.store_name, business_code: dbOrder.business_code, error: err.message });
        errors.push(`${dbOrder.order_id}: ${err.message}`);
        erroredCount++;
      }
    }

    // ── Repair pass: shipped/completed orders with 0 lines (last 14 days) — full sync only ──
    let repairedCount = 0;
    if (syncMode === 'full') try {
      const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data: shippedOrders } = await svc
        .from('scalev_orders')
        .select('id, order_id, scalev_id, status, store_name, business_code, raw_data')
        .in('status', ['shipped', 'completed'])
        .gte('shipped_time', cutoff);

      // Batch-check which shipped orders have lines (1 query instead of N)
      const shippedIds = (shippedOrders || []).map(o => o.id);
      const idsWithLines = new Set<number>();
      if (shippedIds.length > 0) {
        const { data: withLines } = await svc
          .from('scalev_order_lines')
          .select('scalev_order_id')
          .in('scalev_order_id', shippedIds);
        for (const r of withLines || []) idsWithLines.add(r.scalev_order_id);
      }

      for (const order of shippedOrders || []) {
        if (idsWithLines.has(order.id)) continue;

        // Try to insert lines from raw_data first
        const rawData = order.raw_data;
        if (rawData?.orderlines?.length > 0) {
          const bizId = bizCodeToId.get(order.business_code) || 0;
          const taxRateName = bizCodeToTaxRateName.get(order.business_code) || 'PPN';
          await enrichLineItems(svc, order.id, order.order_id, rawData, storeTypeMap, bizId, taxRateName, taxRatesMap);
          repairedCount++;
          details.push({ order_id: order.order_id, store_name: order.store_name, business_code: order.business_code, action: 'repaired_lines_from_raw_data' });
          continue;
        }

        // If raw_data has no orderlines, try fetching from API
        const bizCode = order.business_code;
        if (!bizCode || !bizApiKeys.has(bizCode)) continue;
        const config = bizApiKeys.get(bizCode)!;
        const scalevId = order.scalev_id || rawData?.id;
        if (!scalevId) continue;

        try {
          const apiOrder = await fetchOrderDetail(config.api_key, config.base_url, String(scalevId));
          if (apiOrder?.orderlines?.length > 0) {
            // Update raw_data with fresh API response
            await svc.from('scalev_orders').update({ raw_data: apiOrder, synced_at: new Date().toISOString() }).eq('id', order.id);
            const bizId = bizCodeToId.get(bizCode) || 0;
            const taxRateName = bizCodeToTaxRateName.get(bizCode) || 'PPN';
            await enrichLineItems(svc, order.id, order.order_id, apiOrder, storeTypeMap, bizId, taxRateName, taxRatesMap);
            repairedCount++;
            details.push({ order_id: order.order_id, store_name: order.store_name, business_code: bizCode, action: 'repaired_lines_from_api' });
          }
          await new Promise(r => setTimeout(r, 200));
        } catch {
          // Skip on API error
        }
      }
    } catch (repairErr: any) {
      console.error('[scalev-sync] Repair pass error:', repairErr.message);
    }

    // ── Refresh MVs if any orders were updated to shipped/completed ──
    if (updatedCount > 0 || repairedCount > 0) {
      triggerViewRefresh();
    }

    // ── Update sync log ──
    if (logId) {
      await svc.from('scalev_sync_log').update({
        status: erroredCount === 0 ? 'success' : 'partial',
        orders_updated: updatedCount,
        error_message: errors.length > 0 ? errors.join('; ') : null,
        completed_at: new Date().toISOString(),
      }).eq('id', logId);
    }

    return NextResponse.json({
      success: true,
      sync_mode: syncMode,
      pending_checked: pendingOrders.length,
      orders_updated: updatedCount,
      orders_repaired: repairedCount,
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

// ── Process a single order from API response ──
async function processOrder(
  svc: any,
  dbOrder: any,
  apiOrder: any,
  storeTypeMap: Map<string, StoreType>,
  bizCodeToId: Map<string, number>,
  bizCodeToTaxRateName: Map<string, string>,
  taxRatesMap: Map<string, { rate: number; divisor: number }>,
  details: any[],
  forceUpdate = false
): Promise<'updated' | 'still_pending'> {
  const newStatus = apiOrder.status;

  // No change — skip entirely (saves DB IO)
  if (newStatus === dbOrder.status && !forceUpdate) {
    return 'still_pending';
  }

  // Still pre-terminal — skip (unless forced)
  if (['pending', 'draft', 'ready', 'confirmed', 'paid'].includes(newStatus)) {
    if (!forceUpdate) return 'still_pending';
    // Force: refresh raw_data even if status unchanged
    await svc.from('scalev_orders').update({
      status: newStatus,
      raw_data: apiOrder,
      synced_at: new Date().toISOString(),
    }).eq('id', dbOrder.id);
    // Also enrich lines if they exist in API data
    const bizId = bizCodeToId.get(dbOrder.business_code) || 0;
    const taxRateName = bizCodeToTaxRateName.get(dbOrder.business_code) || 'PPN';
    await enrichLineItems(svc, dbOrder.id, dbOrder.order_id, apiOrder, storeTypeMap, bizId, taxRateName, taxRatesMap);
    details.push({
      order_id: dbOrder.order_id, store_name: dbOrder.store_name, business_code: dbOrder.business_code,
      old_status: dbOrder.status, new_status: newStatus, action: 'force_refreshed',
    });
    return 'updated';
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
    const bizId = bizCodeToId.get(dbOrder.business_code) || 0;
    const taxRateName = bizCodeToTaxRateName.get(dbOrder.business_code) || 'PPN';
    await enrichLineItems(svc, dbOrder.id, dbOrder.order_id, apiOrder, storeTypeMap, bizId, taxRateName, taxRatesMap);
  }

  details.push({
    order_id: dbOrder.order_id,
    store_name: dbOrder.store_name,
    business_code: dbOrder.business_code,
    old_status: dbOrder.status,
    new_status: newStatus,
  });

  return 'updated';
}

// ── Enrich line items after status change to shipped/completed ──
async function enrichLineItems(
  svc: any,
  dbOrderId: number,
  orderId: string,
  apiOrder: any,
  storeTypeMap: Map<string, StoreType>,
  businessId: number,
  taxRateName: string,
  taxRatesMap: Map<string, { rate: number; divisor: number }>
) {
  const shippedTime = apiOrder.shipped_time || apiOrder.completed_time || null;

  // Derive sales channel
  const storeName = (apiOrder.store?.name || '').toLowerCase();
  const isPurchaseFb = apiOrder.is_purchase_fb || false;
  const storeType = storeTypeMap.get(`${businessId}:${storeName}`) ?? guessStoreType(apiOrder.store?.name || '');
  const newChannel = deriveChannelFromStoreType(storeType, isPurchaseFb, {
    external_id: apiOrder.external_id,
    financial_entity: apiOrder.financial_entity,
    raw_data: apiOrder,
    courier_service: apiOrder.courier_service,
    platform: apiOrder.platform,
  });

  // Check if order has any existing lines
  const { count: lineCount } = await svc
    .from('scalev_order_lines')
    .select('id', { count: 'exact', head: true })
    .eq('scalev_order_id', dbOrderId);

  if ((lineCount === 0 || lineCount === null) && apiOrder.orderlines?.length > 0) {
    // ── Insert missing lines from API data ──
    const tax = taxRateName === 'NONE'
      ? { rate: 0, divisor: 1.0 }
      : (taxRatesMap.get(taxRateName) || { rate: 11, divisor: 1.11 });

    const newLines: any[] = [];
    for (const line of apiOrder.orderlines) {
      const qty = line.quantity || 1;
      const productPrice = Number(line.product_price) || 0;
      const discount = Number(line.discount) || 0;
      const cogs = Number(line.cogs || line.variant_cogs) || 0;
      const brand = await lookupProductType(line.product_name || '');

      newLines.push({
        scalev_order_id: dbOrderId,
        order_id: orderId,
        product_name: line.product_name || null,
        product_type: brand,
        variant_sku: line.variant_unique_id || null,
        quantity: qty,
        product_price_bt: productPrice / tax.divisor,
        discount_bt: discount / tax.divisor,
        cogs_bt: cogs / tax.divisor,
        tax_rate: tax.rate,
        sales_channel: newChannel,
        shipped_time: shippedTime,
        is_purchase_fb: apiOrder.is_purchase_fb === true || apiOrder.is_purchase_fb === 'true' || !!(apiOrder.message_variables?.advertiser || '').trim(),
        is_purchase_tiktok: apiOrder.is_purchase_tiktok === true || apiOrder.is_purchase_tiktok === 'true',
        is_purchase_kwai: apiOrder.is_purchase_kwai === true || apiOrder.is_purchase_kwai === 'true',
        synced_at: new Date().toISOString(),
      });
    }

    if (newLines.length > 0) {
      await svc
        .from('scalev_order_lines')
        .upsert(newLines, { onConflict: 'scalev_order_id,product_name' });
    }
    return;
  }

  // ── Update existing lines ──

  // 1. Propagate shipped_time to lines
  if (shippedTime) {
    await svc
      .from('scalev_order_lines')
      .update({ shipped_time: shippedTime })
      .eq('scalev_order_id', dbOrderId)
      .is('shipped_time', null);
  }

  // 2. Re-derive sales_channel
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
