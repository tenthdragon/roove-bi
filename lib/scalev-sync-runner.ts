import {
  fetchOrderDetail,
  deriveChannelFromStoreType,
  guessStoreType,
  lookupProductType,
  clearProductMappingCache,
  type StoreType,
} from './scalev-api';
import { parseScalevHeaderFinancialFields } from './scalev-header-financials';
import { buildScalevSourceClassFields } from './scalev-source-class';
import { reverseWarehouseDeductions } from './warehouse-ledger-actions';
import { createServiceSupabase } from './service-supabase';

export type ScalevSyncMode = 'full' | 'date' | 'order_id' | 'repair';

export type ScalevSyncOptions = {
  syncMode?: ScalevSyncMode;
  targetDate?: string | null;
  targetOrderIds?: string[] | null;
};

export type ScalevSyncResult = {
  success: boolean;
  sync_mode: ScalevSyncMode;
  pending_checked: number;
  orders_updated: number;
  orders_repaired: number;
  orders_still_pending: number;
  orders_errored: number;
  duration_ms: number;
  details: Array<Record<string, any>>;
};

const TERMINAL_SCALEV_STATUSES = new Set(['shipped', 'completed']);

function getSyncLogType(syncMode: ScalevSyncMode) {
  return syncMode === 'full'
    ? 'pending_reconcile'
    : syncMode === 'repair'
      ? 'repair_missing_lines'
      : `targeted_${syncMode}`;
}

function shouldReverseWarehouseForStatusChange(oldStatus?: string | null, newStatus?: string | null) {
  return TERMINAL_SCALEV_STATUSES.has(oldStatus || '') && !!newStatus && !TERMINAL_SCALEV_STATUSES.has(newStatus);
}

function buildSyncSourceClassFields(args: {
  apiOrder: any;
  dbOrder: any;
  businessId: number;
  storeTypeMap: Map<string, StoreType>;
}) {
  const storeName = String(args.apiOrder?.store?.name || args.dbOrder?.store_name || '').trim();
  const storeType = storeName
    ? args.storeTypeMap.get(`${args.businessId}:${storeName.toLowerCase()}`) ?? null
    : null;

  return buildScalevSourceClassFields({
    source: args.dbOrder?.source || 'webhook',
    platform: args.apiOrder?.platform ?? args.dbOrder?.platform ?? null,
    externalId: args.apiOrder?.external_id ?? args.dbOrder?.external_id ?? null,
    financialEntity: args.apiOrder?.financial_entity ?? args.dbOrder?.financial_entity ?? null,
    rawData: args.apiOrder || args.dbOrder?.raw_data || null,
    courierService: args.apiOrder?.courier_service ?? args.dbOrder?.raw_data?.courier_service ?? null,
    courier: args.apiOrder?.courier ?? args.dbOrder?.raw_data?.courier ?? null,
    storeName: storeName || null,
    storeType,
  });
}

export async function runScalevSync(options: ScalevSyncOptions = {}): Promise<ScalevSyncResult> {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  const syncMode: ScalevSyncMode = options.syncMode || 'full';
  const targetDate = options.targetDate || null;
  const targetOrderIds = options.targetOrderIds || null;
  const svc = createServiceSupabase();

  let pendingOrdersCount = 0;
  let logId: number | null = null;

  try {
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
    if (taxRes.error) throw taxRes.error;
    if (storeRes.error) throw storeRes.error;

    const businesses = (bizRes.data || []).filter((business: { api_key: string | null }) => business.api_key);

    const taxRatesMap = new Map<string, { rate: number; divisor: number }>();
    for (const row of taxRes.data || []) {
      if (!taxRatesMap.has(row.name)) {
        const rate = Number(row.rate);
        taxRatesMap.set(row.name, { rate, divisor: 1 + rate / 100 });
      }
    }
    taxRatesMap.set('NONE', { rate: 0, divisor: 1.0 });

    if (businesses.length === 0) throw new Error('No businesses with API keys configured');

    const storeTypeMap = new Map<string, StoreType>();
    const channelOverrideMap = new Map<string, string>();
    for (const row of storeRes.data || []) {
      const key = `${row.business_id}:${String(row.store_name || '').toLowerCase()}`;
      storeTypeMap.set(key, row.store_type as StoreType);
      if (row.channel_override) {
        channelOverrideMap.set(key, row.channel_override);
      }
    }

    let pendingOrders: any[] = [];
    const lightCols = 'id, order_id, scalev_id, status, store_name, business_code, source, platform, external_id, financial_entity, raw_data';

    if (syncMode === 'order_id' && targetOrderIds && targetOrderIds.length > 0) {
      const { data, error } = await svc
        .from('scalev_orders')
        .select(lightCols)
        .in('order_id', targetOrderIds);
      if (error) throw error;
      pendingOrders = data || [];
    } else if (syncMode === 'date' && targetDate) {
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
        const shippedIds = shippedForDate.map((order: { id: number }) => order.id);
        const idsWithLines = new Set<number>();
        const chunkSize = 200;
        for (let i = 0; i < shippedIds.length; i += chunkSize) {
          const chunk = shippedIds.slice(i, i + chunkSize);
          const { data: withLines, error: withLinesError } = await svc
            .from('scalev_order_lines')
            .select('scalev_order_id')
            .in('scalev_order_id', chunk)
            .limit(10000);
          if (withLinesError) throw withLinesError;
          (withLines || []).forEach((row: { scalev_order_id: number }) => idsWithLines.add(row.scalev_order_id));
        }

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
    pendingOrdersCount = pendingOrders.length;

    const { data: logEntry } = await svc
      .from('scalev_sync_log')
      .insert({
        status: 'running',
        sync_type: getSyncLogType(syncMode),
        orders_fetched: pendingOrdersCount,
        orders_updated: 0,
        orders_inserted: 0,
        started_at: startedAt,
      })
      .select('id')
      .single();
    logId = logEntry?.id ?? null;

    clearProductMappingCache();

    const bizApiKeys = new Map<string, { api_key: string; base_url: string }>();
    for (const business of businesses) {
      bizApiKeys.set(business.business_code, { api_key: business.api_key, base_url: 'https://api.scalev.id/v2' });
    }

    const storeToBizId = new Map<string, number>();
    for (const row of storeRes.data || []) {
      storeToBizId.set(String(row.store_name || '').toLowerCase(), row.business_id);
    }

    const bizIdToCode = new Map<number, string>();
    const bizCodeToId = new Map<string, number>();
    const bizCodeToTaxRateName = new Map<string, string>();
    for (const business of businesses) {
      bizIdToCode.set(business.id, business.business_code);
      bizCodeToId.set(business.business_code, business.id);
      bizCodeToTaxRateName.set(business.business_code, business.tax_rate_name || 'PPN');
    }

    let updatedCount = 0;
    let stillPendingCount = 0;
    let erroredCount = 0;
    const details: Array<Record<string, any>> = [];
    const errors: string[] = [];

    async function syncOneOrder(dbOrder: any) {
      try {
        let scalevId = dbOrder.scalev_id;
        if (!scalevId) {
          const { data: rawRow, error: rawRowError } = await svc
            .from('scalev_orders')
            .select('raw_data')
            .eq('id', dbOrder.id)
            .single();
          if (rawRowError) throw rawRowError;
          scalevId = rawRow?.raw_data?.id;
        }

        if (!scalevId && dbOrder.order_id && dbOrder.order_id.length < 20 && /[A-Z]/.test(dbOrder.order_id)) {
          scalevId = dbOrder.order_id;
        }

        if (!scalevId) {
          details.push({
            order_id: dbOrder.order_id,
            store_name: dbOrder.store_name,
            business_code: dbOrder.business_code,
            error: 'No Scalev ID available',
          });
          erroredCount++;
          return;
        }

        let bizCode = dbOrder.business_code;
        if (!bizCode && dbOrder.store_name) {
          const bizId = storeToBizId.get(String(dbOrder.store_name).toLowerCase());
          if (bizId) {
            bizCode = bizIdToCode.get(bizId) || null;
          }
        }

        if (!bizCode || !bizApiKeys.has(bizCode)) {
          let found = false;
          for (const [code, config] of bizApiKeys) {
            try {
              const apiOrder = await fetchOrderDetail(config.api_key, config.base_url, String(scalevId));
              if (apiOrder) {
                await svc.from('scalev_orders').update({ business_code: code }).eq('id', dbOrder.id);
                dbOrder.business_code = code;
                await processOrder(
                  svc,
                  dbOrder,
                  apiOrder,
                  storeTypeMap,
                  bizCodeToId,
                  bizCodeToTaxRateName,
                  taxRatesMap,
                  details,
                  syncMode === 'order_id' || syncMode === 'repair',
                  syncMode === 'full' || syncMode === 'date',
                  channelOverrideMap
                );
                found = true;
                updatedCount++;
                break;
              }
            } catch {}
          }

          if (!found) {
            details.push({
              order_id: dbOrder.order_id,
              store_name: dbOrder.store_name,
              business_code: dbOrder.business_code,
              error: 'No matching business API key found',
            });
            erroredCount++;
          }
          return;
        }

        const config = bizApiKeys.get(bizCode);
        if (!config) {
          throw new Error(`Missing Scalev config for business ${bizCode}`);
        }

        let apiOrder: any;
        try {
          apiOrder = await fetchOrderDetail(config.api_key, config.base_url, String(scalevId));
        } catch (apiErr: any) {
          if (apiErr.message.includes('404')) {
            details.push({
              order_id: dbOrder.order_id,
              store_name: dbOrder.store_name,
              business_code: bizCode,
              error: 'Order not found in Scalev (404)',
            });
          } else if (apiErr.message.includes('429')) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            try {
              apiOrder = await fetchOrderDetail(config.api_key, config.base_url, String(scalevId));
            } catch {
              details.push({
                order_id: dbOrder.order_id,
                store_name: dbOrder.store_name,
                business_code: bizCode,
                error: `API error after retry: ${apiErr.message}`,
              });
              erroredCount++;
              return;
            }
          } else {
            details.push({
              order_id: dbOrder.order_id,
              store_name: dbOrder.store_name,
              business_code: bizCode,
              error: `API error: ${apiErr.message}`,
            });
            erroredCount++;
            return;
          }
          if (!apiOrder) {
            erroredCount++;
            return;
          }
        }

        const forceUpdate = syncMode === 'order_id' || syncMode === 'repair';
        const lightweight = syncMode === 'full' || syncMode === 'date';
        const result = await processOrder(
          svc,
          dbOrder,
          apiOrder,
          storeTypeMap,
          bizCodeToId,
          bizCodeToTaxRateName,
          taxRatesMap,
          details,
          forceUpdate,
          lightweight,
          channelOverrideMap
        );
        if (result === 'updated') updatedCount++;
        if (result === 'still_pending') stillPendingCount++;
      } catch (err: any) {
        details.push({
          order_id: dbOrder.order_id,
          store_name: dbOrder.store_name,
          business_code: dbOrder.business_code,
          error: err.message,
        });
        errors.push(`${dbOrder.order_id}: ${err.message}`);
        erroredCount++;
      }
    }

    const batchSize = 5;
    for (let i = 0; i < pendingOrders.length; i += batchSize) {
      const batch = pendingOrders.slice(i, i + batchSize);
      await Promise.all(batch.map(syncOneOrder));
    }

    const repairedCount = syncMode === 'repair' ? updatedCount : 0;

    if (logId) {
      const succeededCount = updatedCount + stillPendingCount;
      await svc.from('scalev_sync_log').update({
        status: erroredCount === 0 ? 'success' : succeededCount === 0 ? 'failed' : 'partial',
        orders_updated: updatedCount,
        error_message: errors.length > 0 ? errors.join('; ') : null,
        completed_at: new Date().toISOString(),
      }).eq('id', logId);
    }

    return {
      success: true,
      sync_mode: syncMode,
      pending_checked: pendingOrders.length,
      orders_updated: updatedCount,
      orders_repaired: repairedCount,
      orders_still_pending: stillPendingCount,
      orders_errored: erroredCount,
      duration_ms: Date.now() - startTime,
      details,
    };
  } catch (err: any) {
    console.error('[scalev-sync] Fatal error:', err.message);
    try {
      const failedLog = {
        status: 'failed',
        sync_type: getSyncLogType(syncMode),
        orders_fetched: pendingOrdersCount,
        orders_updated: 0,
        orders_inserted: 0,
        error_message: err.message || 'Unknown fatal error',
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      };
      if (logId) {
        await svc.from('scalev_sync_log').update(failedLog).eq('id', logId);
      } else {
        await svc.from('scalev_sync_log').insert(failedLog);
      }
    } catch (logErr: any) {
      console.error('[scalev-sync] Failed to persist fatal sync log:', logErr.message);
    }

    throw err;
  }
}

async function processOrder(
  svc: any,
  dbOrder: any,
  apiOrder: any,
  storeTypeMap: Map<string, StoreType>,
  bizCodeToId: Map<string, number>,
  bizCodeToTaxRateName: Map<string, string>,
  taxRatesMap: Map<string, { rate: number; divisor: number }>,
  details: Array<Record<string, any>>,
  forceUpdate = false,
  lightweight = false,
  channelOverrideMap: Map<string, string> = new Map(),
): Promise<'updated' | 'still_pending'> {
  const newStatus = apiOrder.status;
  let reversedCount = 0;
  const businessId = bizCodeToId.get(dbOrder.business_code) || 0;
  const sourceClassFields = buildSyncSourceClassFields({
    apiOrder,
    dbOrder,
    businessId,
    storeTypeMap,
  });
  const parsedHeaderFinancials = parseScalevHeaderFinancialFields(apiOrder);

  if (newStatus === dbOrder.status && !forceUpdate) {
    return 'still_pending';
  }

  if (['pending', 'draft', 'ready', 'confirmed', 'paid', 'in_process'].includes(newStatus)) {
    if (!forceUpdate) return 'still_pending';

    await svc.from('scalev_orders').update({
      status: newStatus,
      ...sourceClassFields,
      ...(parsedHeaderFinancials.shippingDiscountPresent ? { shipping_discount: parsedHeaderFinancials.shippingDiscount } : {}),
      ...(parsedHeaderFinancials.discountCodeDiscountPresent ? { discount_code_discount: parsedHeaderFinancials.discountCodeDiscount } : {}),
      raw_data: apiOrder,
      synced_at: new Date().toISOString(),
    }).eq('id', dbOrder.id);

    if (shouldReverseWarehouseForStatusChange(dbOrder.status, newStatus)) {
      try {
        reversedCount = await reverseWarehouseDeductions(dbOrder.order_id, dbOrder.id);
      } catch (err: any) {
        console.error(`[Sync] Failed to reverse warehouse for ${dbOrder.order_id}:`, err.message);
      }
    }

    if (!lightweight) {
      const taxRateName = bizCodeToTaxRateName.get(dbOrder.business_code) || 'PPN';
      await enrichLineItems(
        svc,
        dbOrder.id,
        dbOrder.order_id,
        apiOrder,
        storeTypeMap,
        businessId,
        taxRateName,
        taxRatesMap,
        channelOverrideMap
      );
    }

    details.push({
      order_id: dbOrder.order_id,
      store_name: dbOrder.store_name,
      business_code: dbOrder.business_code,
      old_status: dbOrder.status,
      new_status: newStatus,
      action: lightweight ? 'status_updated' : 'force_refreshed',
      ...(reversedCount > 0 ? { warehouse_reversed: reversedCount } : {}),
    });
    return 'updated';
  }

  const now = new Date().toISOString();
  const updateData: Record<string, any> = {
    status: newStatus,
    ...sourceClassFields,
    synced_at: now,
    raw_data: apiOrder,
  };

  const tsFields = ['draft_time', 'pending_time', 'confirmed_time', 'paid_time', 'shipped_time', 'completed_time', 'canceled_time'];
  for (const field of tsFields) {
    if (apiOrder[field]) {
      updateData[field] = apiOrder[field];
    }
  }
  if (apiOrder.gross_revenue != null) updateData.gross_revenue = apiOrder.gross_revenue;
  if (apiOrder.net_revenue != null) updateData.net_revenue = apiOrder.net_revenue;
  if (apiOrder.shipping_cost != null) updateData.shipping_cost = apiOrder.shipping_cost;
  if (apiOrder.unique_code_discount != null) updateData.unique_code_discount = apiOrder.unique_code_discount;
  if (parsedHeaderFinancials.shippingDiscountPresent) updateData.shipping_discount = parsedHeaderFinancials.shippingDiscount;
  if (parsedHeaderFinancials.discountCodeDiscountPresent) updateData.discount_code_discount = parsedHeaderFinancials.discountCodeDiscount;

  await svc.from('scalev_orders').update(updateData).eq('id', dbOrder.id);

  if (!lightweight && (newStatus === 'shipped' || newStatus === 'completed')) {
    const taxRateName = bizCodeToTaxRateName.get(dbOrder.business_code) || 'PPN';
    await enrichLineItems(
      svc,
      dbOrder.id,
      dbOrder.order_id,
      apiOrder,
      storeTypeMap,
      businessId,
      taxRateName,
      taxRatesMap,
      channelOverrideMap
    );
  }

  if (shouldReverseWarehouseForStatusChange(dbOrder.status, newStatus)) {
    try {
      reversedCount = await reverseWarehouseDeductions(dbOrder.order_id, dbOrder.id);
    } catch (err: any) {
      console.error(`[Sync] Failed to reverse warehouse for ${dbOrder.order_id}:`, err.message);
    }
  }

  details.push({
    order_id: dbOrder.order_id,
    store_name: dbOrder.store_name,
    business_code: dbOrder.business_code,
    old_status: dbOrder.status,
    new_status: newStatus,
    ...(reversedCount > 0 ? { warehouse_reversed: reversedCount } : {}),
  });

  return 'updated';
}

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
  const storeName = String(apiOrder.store?.name || '').toLowerCase();
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

  function calcBT(price: number, tax: { rate: number; divisor: number }) {
    return price / tax.divisor;
  }

  const tax = taxRateName === 'NONE'
    ? { rate: 0, divisor: 1.0 }
    : (taxRatesMap.get(taxRateName) || { rate: 11, divisor: 1.11 });

  if (apiOrder.orderlines?.length > 0) {
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
        is_purchase_fb: apiOrder.is_purchase_fb === true || apiOrder.is_purchase_fb === 'true' || !!String(apiOrder.message_variables?.advertiser || '').trim(),
        is_purchase_tiktok: apiOrder.is_purchase_tiktok === true || apiOrder.is_purchase_tiktok === 'true',
        is_purchase_kwai: apiOrder.is_purchase_kwai === true || apiOrder.is_purchase_kwai === 'true',
        synced_at: new Date().toISOString(),
      });
    }

    await svc
      .from('scalev_order_lines')
      .delete()
      .eq('scalev_order_id', dbOrderId);

    if (newLines.length > 0) {
      await svc
        .from('scalev_order_lines')
        .upsert(newLines, { onConflict: 'scalev_order_id,product_name' });
    }
    return;
  }

  await svc
    .from('scalev_order_lines')
    .update({
      sales_channel: newChannel,
      is_purchase_fb: apiOrder.is_purchase_fb || false,
      is_purchase_tiktok: apiOrder.is_purchase_tiktok || false,
      is_purchase_kwai: apiOrder.is_purchase_kwai || false,
    })
    .eq('scalev_order_id', dbOrderId);

  const { data: lines, error: linesError } = await svc
    .from('scalev_order_lines')
    .select('id, product_name')
    .eq('scalev_order_id', dbOrderId);
  if (linesError) throw linesError;

  for (const line of lines || []) {
    const brand = await lookupProductType(line.product_name || '');
    await svc
      .from('scalev_order_lines')
      .update({ product_type: brand })
      .eq('id', line.id);
  }
}
