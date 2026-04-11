// app/api/scalev-sync/route.ts
// Per-business sync: checks pending orders in DB against Scalev API,
// using each business's own API key. Updates status/timestamps/lines
// for orders that have been shipped/completed.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { fetchOrderDetail, deriveChannelFromStoreType, guessStoreType, lookupProductType, clearProductMappingCache, type StoreType } from '@/lib/scalev-api';
import { reverseWarehouseDeductions } from '@/lib/warehouse-ledger-actions';


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
    // ── Auth: cron or admin sync permission ──
    const authHeader = req.headers.get('authorization');
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    if (!isCron) {
      try {
        await requireDashboardPermissionAccess('admin:sync', 'Admin Sync');
      } catch (authErr: any) {
        console.error('[scalev-sync] Auth error:', authErr.message);
        const status = /sesi|login/i.test(authErr.message || '') ? 401 : 403;
        return NextResponse.json({ error: authErr.message }, { status });
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
        .select('store_name, store_type, business_id, channel_override')
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
    const channelOverrideMap = new Map<string, string>();
    for (const row of storeRes.data || []) {
      const key = `${row.business_id}:${row.store_name.toLowerCase()}`;
      storeTypeMap.set(key, row.store_type as StoreType);
      if (row.channel_override) {
        channelOverrideMap.set(key, row.channel_override);
      }
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
        .in('status', ['pending', 'ready', 'draft', 'confirmed', 'paid', 'in_process']);
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
        // Chunked query to avoid PostgREST default 1000-row limit
        const shippedIds = shippedForDate.map(o => o.id);
        const idsWithLines = new Set<number>();
        const chunkSize = 200;
        for (let i = 0; i < shippedIds.length; i += chunkSize) {
          const chunk = shippedIds.slice(i, i + chunkSize);
          const { data: withLines } = await svc
            .from('scalev_order_lines')
            .select('scalev_order_id')
            .in('scalev_order_id', chunk)
            .limit(10000);
          (withLines || []).forEach(r => idsWithLines.add(r.scalev_order_id));
        }
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
        .in('status', ['pending', 'ready', 'draft', 'confirmed', 'paid', 'in_process']);
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

    // ── Process a single order: fetch from API + update DB ──
    async function syncOneOrder(dbOrder: any) {
      try {
        let scalevId = dbOrder.scalev_id;
        if (!scalevId) {
          const { data: rawRow } = await svc
            .from('scalev_orders')
            .select('raw_data')
            .eq('id', dbOrder.id)
            .single();
          scalevId = rawRow?.raw_data?.id;
        }
        // Fallback: use order_id if it looks like a ScaleV format (alphanumeric, <20 chars)
        if (!scalevId && dbOrder.order_id && dbOrder.order_id.length < 20 && /[A-Z]/.test(dbOrder.order_id)) {
          scalevId = dbOrder.order_id;
        }
        if (!scalevId) {
          details.push({ order_id: dbOrder.order_id, store_name: dbOrder.store_name, business_code: dbOrder.business_code, error: 'No Scalev ID available' });
          erroredCount++;
          return;
        }

        let bizCode = dbOrder.business_code;
        if (!bizCode && dbOrder.store_name) {
          const bizId = storeToBizId.get(dbOrder.store_name.toLowerCase());
          if (bizId) bizCode = bizIdToCode.get(bizId) || null;
        }

        if (!bizCode || !bizApiKeys.has(bizCode)) {
          let found = false;
          for (const [code, config] of bizApiKeys) {
            try {
              const apiOrder = await fetchOrderDetail(config.api_key, config.base_url, String(scalevId));
              if (apiOrder) {
                await svc.from('scalev_orders').update({ business_code: code }).eq('id', dbOrder.id);
                dbOrder.business_code = code;
                await processOrder(svc, dbOrder, apiOrder, storeTypeMap, bizCodeToId, bizCodeToTaxRateName, taxRatesMap, details, syncMode === 'order_id' || syncMode === 'repair', syncMode === 'full' || syncMode === 'date', channelOverrideMap);
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
          return;
        }

        const config = bizApiKeys.get(bizCode)!;
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
              return;
            }
          } else {
            details.push({ order_id: dbOrder.order_id, store_name: dbOrder.store_name, business_code: bizCode, error: `API error: ${apiErr.message}` });
            erroredCount++;
            return;
          }
          if (!apiOrder) { erroredCount++; return; }
        }

        const forceUpdate = syncMode === 'order_id' || syncMode === 'repair';
        const lightweight = syncMode === 'full' || syncMode === 'date';
        const result = await processOrder(svc, dbOrder, apiOrder, storeTypeMap, bizCodeToId, bizCodeToTaxRateName, taxRatesMap, details, forceUpdate, lightweight, channelOverrideMap);
        if (result === 'updated') updatedCount++;
        else if (result === 'still_pending') stillPendingCount++;
      } catch (err: any) {
        details.push({ order_id: dbOrder.order_id, store_name: dbOrder.store_name, business_code: dbOrder.business_code, error: err.message });
        errors.push(`${dbOrder.order_id}: ${err.message}`);
        erroredCount++;
      }
    }

    // ── Process orders in parallel batches of 5 ──
    const BATCH_SIZE = 5;
    for (let i = 0; i < pendingOrders.length; i += BATCH_SIZE) {
      const batch = pendingOrders.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(syncOneOrder));
    }

    // Repair pass removed from full sync — use dedicated "Perbaikan" mode instead.
    // Full sync now only checks pre-terminal orders, keeping it fast and within Vercel timeout.
    const repairedCount = syncMode === 'repair' ? updatedCount : 0;



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
// lightweight=true: only update status/timestamps, skip line enrichment (for full/date sync)
async function processOrder(
  svc: any,
  dbOrder: any,
  apiOrder: any,
  storeTypeMap: Map<string, StoreType>,
  bizCodeToId: Map<string, number>,
  bizCodeToTaxRateName: Map<string, string>,
  taxRatesMap: Map<string, { rate: number; divisor: number }>,
  details: any[],
  forceUpdate = false,
  lightweight = false,
  channelOverrideMap: Map<string, string> = new Map(),
): Promise<'updated' | 'still_pending'> {
  const newStatus = apiOrder.status;

  // No change — skip entirely (saves DB IO)
  if (newStatus === dbOrder.status && !forceUpdate) {
    return 'still_pending';
  }

  // Still pre-terminal — skip (unless forced)
  if (['pending', 'draft', 'ready', 'confirmed', 'paid', 'in_process'].includes(newStatus)) {
    if (!forceUpdate) return 'still_pending';
    // Force: refresh raw_data even if status unchanged
    await svc.from('scalev_orders').update({
      status: newStatus,
      raw_data: apiOrder,
      synced_at: new Date().toISOString(),
    }).eq('id', dbOrder.id);
    if (!lightweight) {
      const bizId = bizCodeToId.get(dbOrder.business_code) || 0;
      const taxRateName = bizCodeToTaxRateName.get(dbOrder.business_code) || 'PPN';
      await enrichLineItems(svc, dbOrder.id, dbOrder.order_id, apiOrder, storeTypeMap, bizId, taxRateName, taxRatesMap, channelOverrideMap);
    }
    details.push({
      order_id: dbOrder.order_id, store_name: dbOrder.store_name, business_code: dbOrder.business_code,
      old_status: dbOrder.status, new_status: newStatus, action: lightweight ? 'status_updated' : 'force_refreshed',
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

  // For shipped/completed: enrich line items (skip in lightweight mode — use Perbaikan mode instead)
  if (!lightweight && (newStatus === 'shipped' || newStatus === 'completed')) {
    const bizId = bizCodeToId.get(dbOrder.business_code) || 0;
    const taxRateName = bizCodeToTaxRateName.get(dbOrder.business_code) || 'PPN';
    await enrichLineItems(svc, dbOrder.id, dbOrder.order_id, apiOrder, storeTypeMap, bizId, taxRateName, taxRatesMap, channelOverrideMap);
  }

  // For deleted/canceled: reverse warehouse deductions if any
  let reversedCount = 0;
  if (newStatus === 'deleted' || newStatus === 'canceled') {
    try {
      reversedCount = await reverseWarehouseDeductions(dbOrder.order_id);
    } catch (e: any) {
      console.error(`[Sync] Failed to reverse warehouse for ${dbOrder.order_id}:`, e.message);
    }
  }

  details.push({
    order_id: dbOrder.order_id,
    store_name: dbOrder.store_name,
    business_code: dbOrder.business_code,
    old_status: dbOrder.status,
    new_status: newStatus,
    ...(reversedCount > 0 && { warehouse_reversed: reversedCount }),
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
  taxRatesMap: Map<string, { rate: number; divisor: number }>,
  channelOverrideMap: Map<string, string>,
) {
  const shippedTime = apiOrder.shipped_time || apiOrder.completed_time || null;

  // Derive sales channel (check store-specific override first)
  const storeName = (apiOrder.store?.name || '').toLowerCase();
  const overrideKey = `${businessId}:${storeName}`;
  const channelOverride = channelOverrideMap.get(overrideKey);
  let newChannel: string;
  if (channelOverride) {
    newChannel = channelOverride;
  } else {
    const isPurchaseFb = apiOrder.is_purchase_fb || false;
    const storeType = storeTypeMap.get(overrideKey) ?? guessStoreType(apiOrder.store?.name || '');
    newChannel = deriveChannelFromStoreType(storeType, isPurchaseFb, {
      external_id: apiOrder.external_id,
      financial_entity: apiOrder.financial_entity,
      raw_data: apiOrder,
      courier_service: apiOrder.courier_service,
      platform: apiOrder.platform,
    });
  }

  function calcBT(price: number, tax: { rate: number; divisor: number }): number {
    return price / tax.divisor;
  }

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
        product_price_bt: calcBT(productPrice, tax),
        discount_bt: calcBT(discount, tax),
        cogs_bt: calcBT(cogs, tax),
        tax_rate: tax.rate,
        sales_channel: newChannel,
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

  // 1. Re-derive sales_channel
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
