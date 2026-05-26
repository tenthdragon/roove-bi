import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

import {
  deriveChannelFromStoreType,
  fetchOrderDetail,
  guessStoreType,
  type StoreType,
} from '../../lib/scalev-api';
import { parseScalevHeaderFinancialFields } from '../../lib/scalev-header-financials';
import { buildScalevSourceClassFields } from '../../lib/scalev-source-class';
import { extractMarketplaceTrackingFromWebhookData } from '../../lib/marketplace-tracking';
import { resolveWarehouseOrderContextFromLookups } from '../../lib/warehouse-order-context';
import {
  extractScalevLineItemNameRaw,
  extractScalevLineItemOwnerRaw,
  fetchWarehouseBusinessDirectoryRows,
  fetchWarehouseOriginRegistryRows,
  resolveWarehouseBusinessCode,
} from '../../lib/warehouse-domain-helpers';
import { reconcileScalevOrderWarehouse } from '../../lib/warehouse-ledger-actions';

const DEFAULT_FROM = '2026-05-01';
const DEFAULT_TO = '2026-05-25';
const CONNECTED_BUSINESSES = new Set(['RTI', 'RLB', 'RLT', 'JHN', 'RLBPP']);

type BusinessConfig = {
  id: number;
  business_code: string;
  api_key: string;
  tax_rate_name: string | null;
};

type StoreChannelRow = {
  business_id: number;
  store_name: string;
  store_type: StoreType;
  channel_override: string | null;
};

function parseEnvFile(path: string) {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const idx = line.indexOf('=');
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return [line.slice(0, idx), value];
      }),
  );
}

function parseArgs() {
  const from = process.argv.find((arg) => arg.startsWith('--from='))?.split('=')[1] || DEFAULT_FROM;
  const to = process.argv.find((arg) => arg.startsWith('--to='))?.split('=')[1] || DEFAULT_TO;
  const onlyBusiness = process.argv.find((arg) => arg.startsWith('--business='))?.split('=')[1] || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error('Gunakan format tanggal YYYY-MM-DD untuk --from dan --to.');
  }
  if (from > to) {
    throw new Error(`Tanggal awal ${from} tidak boleh lebih besar dari tanggal akhir ${to}.`);
  }

  return {
    apply: process.argv.includes('--apply'),
    repairDbEmptyLines: process.argv.includes('--repair-db-empty-lines'),
    includeReseller: process.argv.includes('--include-reseller'),
    repairEmptyLines: process.argv.includes('--repair-empty-lines'),
    skipWarehouse: process.argv.includes('--skip-warehouse'),
    from,
    to,
    onlyBusiness,
  };
}

function jakartaDate(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
}

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function num(value: unknown) {
  if (value == null) return 0;
  const parsed = Number.parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function ts(value: unknown): string | null {
  const text = cleanText(value);
  return text || null;
}

function calcBeforeTax(value: number, divisor: number) {
  return value / divisor;
}

function getOrderDate(order: any) {
  return jakartaDate(order?.shipped_time || order?.completed_time || order?.paid_time || order?.confirmed_time);
}

function getOrderLines(order: any) {
  const lines = order?.orderlines || order?.order_line || order?.items || [];
  return Array.isArray(lines) ? lines : [];
}

function getStoreName(order: any) {
  return cleanText(order?.store?.name || order?.store_name || '');
}

function getFinancialEntity(order: any) {
  const entity = order?.financial_entity;
  if (typeof entity === 'string') return cleanText(entity) || null;
  return cleanText(entity?.name || entity?.code || '') || null;
}

function isOrderIdFromToday(orderId: string) {
  return orderId.startsWith('260526');
}

function orderIdPrefixForDate(date: string) {
  const [year, month, day] = date.split('-');
  return `${year.slice(2)}${month}${day}`;
}

function formatMoney(value: number) {
  return Math.round(value).toLocaleString('id-ID');
}

async function withRetries<T>(label: string, fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      const delayMs = Math.min(10_000, attempt * 1_000);
      console.warn(JSON.stringify({ label, attempt, retry_in_ms: delayMs, error: error instanceof Error ? error.message : String(error) }));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function createStoreMaps(rows: StoreChannelRow[]) {
  const storeTypes = new Map<string, StoreType>();
  const channelOverrides = new Map<string, string>();

  for (const row of rows) {
    const key = `${row.business_id}:${row.store_name.toLowerCase()}`;
    storeTypes.set(key, row.store_type);
    if (row.channel_override) channelOverrides.set(key, row.channel_override);
  }

  return { storeTypes, channelOverrides };
}

function deriveChannel(order: any, businessId: number, maps: ReturnType<typeof createStoreMaps>) {
  const storeName = getStoreName(order);
  const key = `${businessId}:${storeName.toLowerCase()}`;
  const override = maps.channelOverrides.get(key);
  if (override) return override;

  const isPurchaseFb = order?.is_purchase_fb === true
    || order?.is_purchase_fb === 'true'
    || !!cleanText(order?.message_variables?.advertiser);
  const storeType = maps.storeTypes.get(key) || guessStoreType(storeName);

  return deriveChannelFromStoreType(storeType, isPurchaseFb, {
    external_id: order?.external_id,
    financial_entity: order?.financial_entity,
    raw_data: order,
    courier_service: order?.courier_service,
    platform: order?.platform,
  });
}

function deriveSourceClassFields(order: any, businessId: number, maps: ReturnType<typeof createStoreMaps>) {
  const storeName = getStoreName(order);
  const storeType = maps.storeTypes.get(`${businessId}:${storeName.toLowerCase()}`) || null;
  return buildScalevSourceClassFields({
    source: 'webhook',
    platform: order?.platform,
    externalId: order?.external_id,
    financialEntity: order?.financial_entity,
    rawData: order,
    courierService: order?.courier_service,
    courier: order?.courier,
    storeName,
    storeType,
  });
}

async function getTax(supabase: any, taxRateName: string | null) {
  if (taxRateName === 'NONE') return { rate: 0, divisor: 1 };

  const { data, error } = await supabase
    .from('tax_rates')
    .select('name, rate, effective_from')
    .eq('name', taxRateName || 'PPN')
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const rate = Number(data?.rate ?? 11);
  return { rate, divisor: 1 + rate / 100 };
}

async function deriveBrandFromProduct(supabase: any, productName: string, cache: { rows?: Array<{ name: string; keywords: string[] }> }) {
  if (!cache.rows) {
    const { data, error } = await supabase
      .from('brands')
      .select('name, keywords')
      .eq('is_active', true);
    if (error) throw error;
    cache.rows = (data || []).map((brand: any) => ({
      name: brand.name,
      keywords: brand.keywords
        ? String(brand.keywords).split(',').map((keyword) => keyword.trim().toLowerCase()).filter(Boolean)
        : [String(brand.name || '').toLowerCase()],
    }));
  }

  const normalized = productName.toLowerCase();
  for (const brand of cache.rows) {
    if (brand.keywords.some((keyword) => normalized.includes(keyword))) return brand.name;
  }
  return 'Other';
}

async function buildOrderLines(args: {
  supabase: any;
  order: any;
  dbOrderId: number;
  businessId: number;
  taxRateName: string | null;
  storeMaps: ReturnType<typeof createStoreMaps>;
  businessDirectoryRows: Awaited<ReturnType<typeof fetchWarehouseBusinessDirectoryRows>>;
  brandCache: { rows?: Array<{ name: string; keywords: string[] }> };
}) {
  const orderId = cleanText(args.order?.order_id);
  const salesChannel = deriveChannel(args.order, args.businessId, args.storeMaps);
  const tax = await getTax(args.supabase, args.taxRateName);
  const lines = [];

  for (const line of getOrderLines(args.order)) {
    const itemNameRaw = extractScalevLineItemNameRaw(line);
    const itemOwnerRaw = extractScalevLineItemOwnerRaw(line);
    const productName = cleanText(line?.product_name || itemNameRaw || 'Unknown') || 'Unknown';
    const ownerResolution = resolveWarehouseBusinessCode({
      rawValue: itemOwnerRaw,
      fallbackBusinessCode: null,
      directoryRows: args.businessDirectoryRows,
    });

    lines.push({
      scalev_order_id: args.dbOrderId,
      order_id: orderId,
      product_name: productName,
      product_type: await deriveBrandFromProduct(args.supabase, productName, args.brandCache),
      variant_sku: cleanText(line?.variant_unique_id || line?.variant?.sku || line?.sku || '') || null,
      quantity: num(line?.quantity) || 1,
      item_name_raw: itemNameRaw || productName,
      item_owner_raw: itemOwnerRaw,
      stock_owner_business_code: ownerResolution.business_code || null,
      product_price_bt: calcBeforeTax(num(line?.product_price ?? line?.price ?? line?.product_price_bt), tax.divisor),
      discount_bt: calcBeforeTax(num(line?.discount ?? line?.discount_bt), tax.divisor),
      cogs_bt: calcBeforeTax(num(line?.cogs ?? line?.variant_cogs ?? line?.cogs_bt), tax.divisor),
      tax_rate: tax.rate,
      sales_channel: salesChannel,
      is_purchase_fb: args.order?.is_purchase_fb === true || args.order?.is_purchase_fb === 'true' || !!cleanText(args.order?.message_variables?.advertiser),
      is_purchase_tiktok: args.order?.is_purchase_tiktok === true || args.order?.is_purchase_tiktok === 'true',
      is_purchase_kwai: args.order?.is_purchase_kwai === true || args.order?.is_purchase_kwai === 'true',
      synced_at: new Date().toISOString(),
    });
  }

  return lines;
}

async function fetchV3OrderPage(args: {
  apiKey: string;
  status: string;
  cursor?: string | null;
}) {
  const columns = [
    'id',
    'order_id',
    'external_id',
    'status',
    'platform',
    'store',
    'destination_address',
    'customer',
    'gross_revenue',
    'net_revenue',
    'shipping_cost',
    'shipping_discount',
    'discount_code_discount',
    'unique_code_discount',
    'total_quantity',
    'financial_entity',
    'payment_method',
    'is_purchase_fb',
    'is_purchase_tiktok',
    'is_purchase_kwai',
    'draft_time',
    'pending_time',
    'confirmed_time',
    'paid_time',
    'shipped_time',
    'completed_time',
    'canceled_time',
    'warehouse',
    'origin_address',
    'orderlines',
    'message_variables',
    'utm_source',
    'courier_service',
    'shipment_receipt',
  ].join(',');
  const params = new URLSearchParams({
    page_size: '25',
    status: args.status,
    columns,
  });
  if (args.cursor) params.set('next_cursor', args.cursor);

  const response = await fetch(`https://api.scalev.id/v3/orders?${params.toString()}`, {
    headers: { Authorization: `Bearer ${args.apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`Scalev v3 API error ${response.status}: ${await response.text()}`);
  }

  const json = await response.json();
  return {
    results: Array.isArray(json?.data) ? json.data : [],
    hasNext: Boolean(json?.has_next),
    nextCursor: cleanText(json?.next_cursor) || null,
  };
}

async function fetchScalevOrdersForBusiness(business: BusinessConfig, from: string, to: string) {
  const candidates: any[] = [];
  const seenOrderIds = new Set<string>();
  const fromPrefix = orderIdPrefixForDate(from);
  const toPrefix = orderIdPrefixForDate(to);

  for (const status of ['shipped', 'completed']) {
    let cursor: string | null = null;
    let pages = 0;
    let olderPageStreak = 0;
    for (;;) {
      const page = await withRetries(
        `scalev-v3-list:${business.business_code}:${status}:${pages}`,
        () => fetchV3OrderPage({
          apiKey: business.api_key,
          status,
          cursor,
        }),
      );
      pages++;

      let pageAllOlder = page.results.length > 0;

      for (const row of page.results) {
        const orderDate = getOrderDate(row);
        const orderId = cleanText(row?.order_id);
        const prefix = orderId.slice(0, 6);
        if (prefix >= fromPrefix) pageAllOlder = false;
        if (seenOrderIds.has(orderId)) continue;
        if (!orderDate || orderDate < from || orderDate > to) continue;
        if (!orderId || isOrderIdFromToday(orderId)) continue;
        if (prefix < fromPrefix || prefix > toPrefix) continue;
        if (!['shipped', 'completed'].includes(cleanText(row?.status))) continue;
        seenOrderIds.add(orderId);
        candidates.push(row);
      }

      if (pages % 50 === 0) {
        console.log(JSON.stringify({
          business: business.business_code,
          status,
          pages,
          candidates: candidates.length,
        }));
      }

      olderPageStreak = pageAllOlder ? olderPageStreak + 1 : 0;
      if (olderPageStreak >= 2) break;
      if (!page.hasNext || !page.nextCursor) break;
      cursor = page.nextCursor;
    }
  }

  return candidates;
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function fetchExistingOrders(supabase: any, businessCode: string, orderIds: string[]) {
  const existing = new Map<string, { id: number; order_id: string }>();
  for (const chunk of chunkArray(Array.from(new Set(orderIds)).filter(Boolean), 500)) {
    const { data, error } = await withRetries(
      `existing:${businessCode}:${chunk[0]}`,
      async () => await supabase
        .from('scalev_orders')
        .select('id, order_id')
        .eq('business_code', businessCode)
        .in('order_id', chunk),
    );
    if (error) throw error;
    for (const row of data || []) {
      existing.set(cleanText(row.order_id), {
        id: Number(row.id),
        order_id: cleanText(row.order_id),
      });
    }
  }
  return existing;
}

async function fetchLineCounts(supabase: any, scalevOrderIds: number[]) {
  const counts = new Map<number, number>();
  for (const id of scalevOrderIds) counts.set(id, 0);

  for (const chunk of chunkArray(Array.from(new Set(scalevOrderIds)).filter(Boolean), 500)) {
    for (let offset = 0;; offset += 1000) {
      const { data, error } = await withRetries(
        `line-counts:${chunk[0]}:${offset}`,
        async () => await supabase
          .from('scalev_order_lines')
          .select('scalev_order_id')
          .in('scalev_order_id', chunk)
          .range(offset, offset + 999),
      );
      if (error) throw error;
      for (const row of data || []) {
        const id = Number(row.scalev_order_id);
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      if (!data || data.length < 1000) break;
    }
  }

  return counts;
}

async function repairDbEmptyLines(args: {
  supabase: any;
  businesses: BusinessConfig[];
  storeMaps: ReturnType<typeof createStoreMaps>;
  businessDirectoryRows: Awaited<ReturnType<typeof fetchWarehouseBusinessDirectoryRows>>;
  brandCache: { rows?: Array<{ name: string; keywords: string[] }> };
  config: ReturnType<typeof parseArgs>;
}) {
  const businessesByCode = new Map(args.businesses.map((business) => [business.business_code, business]));
  const fromPrefix = orderIdPrefixForDate(args.config.from);
  const toPrefix = `${orderIdPrefixForDate(args.config.to)}ZZZZZZZ`;
  const orders: any[] = [];
  for (let offset = 0;; offset += 1000) {
    const { data, error } = await args.supabase
      .from('scalev_orders')
      .select('id, order_id, business_code, store_name, status, gross_revenue, raw_data')
      .gte('order_id', fromPrefix)
      .lte('order_id', toPrefix)
      .in('business_code', args.businesses.map((business) => business.business_code))
      .in('status', ['shipped', 'completed'])
      .order('id', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    orders.push(...(data || []));
    if (!data || data.length < 1000) break;
  }

  const lineCounts = await fetchLineCounts(args.supabase, (orders || []).map((order: any) => Number(order.id)));
  const summary = {
    apply: args.config.apply,
    repairDbEmptyLines: true,
    includeReseller: args.config.includeReseller,
    from: args.config.from,
    to: args.config.to,
    scanned: orders.length,
    empty: 0,
    target: 0,
    lineInserted: 0,
    skippedNonTargetChannel: 0,
    skippedNoRawLines: 0,
    warehouse: {} as Record<string, number>,
    byBusiness: {} as Record<string, { orders: number; gross: number }>,
    byChannel: {} as Record<string, { orders: number; gross: number }>,
    byStore: {} as Record<string, { orders: number; gross: number }>,
  };

  for (const order of orders) {
    const orderId = cleanText(order.order_id);
    if ((lineCounts.get(Number(order.id)) || 0) > 0) continue;
    summary.empty++;

    const business = businessesByCode.get(cleanText(order.business_code));
    if (!business) continue;

    const rawData = {
      ...(order.raw_data || {}),
      order_id: orderId,
      status: order.status,
      store: order.raw_data?.store || { name: order.store_name },
      gross_revenue: order.raw_data?.gross_revenue ?? order.gross_revenue,
    };
    const channel = deriveChannel(rawData, business.id, args.storeMaps);
    const targetChannel = channel === 'CS Manual' || (args.config.includeReseller && channel === 'Reseller');
    if (!targetChannel) {
      summary.skippedNonTargetChannel++;
      continue;
    }

    summary.target++;
    const gross = num(order.gross_revenue);
    const storeName = getStoreName(rawData);
    for (const [bucket, key] of [
      ['byBusiness', business.business_code],
      ['byChannel', channel],
      ['byStore', storeName || '(unknown)'],
    ] as const) {
      summary[bucket][key] ||= { orders: 0, gross: 0 };
      summary[bucket][key].orders++;
      summary[bucket][key].gross += gross;
    }

    const rawLines = getOrderLines(rawData);
    if (rawLines.length === 0) {
      summary.skippedNoRawLines++;
      continue;
    }

    const lines = await buildOrderLines({
      supabase: args.supabase,
      order: rawData,
      dbOrderId: Number(order.id),
      businessId: business.id,
      taxRateName: business.tax_rate_name,
      storeMaps: args.storeMaps,
      businessDirectoryRows: args.businessDirectoryRows,
      brandCache: args.brandCache,
    });

    if (args.config.apply && lines.length > 0) {
      const { error: lineError } = await args.supabase
        .from('scalev_order_lines')
        .upsert(lines, { onConflict: 'scalev_order_id,product_name' });
      if (lineError) throw lineError;

      if (!args.config.skipWarehouse) {
        const warehouseResult = await reconcileScalevOrderWarehouse(orderId, Number(order.id));
        const action = cleanText(warehouseResult?.action) || 'unknown';
        summary.warehouse[action] = (summary.warehouse[action] || 0) + 1;
      }
    }
    summary.lineInserted += lines.length;
  }

  for (const bucket of [summary.byBusiness, summary.byChannel, summary.byStore]) {
    for (const value of Object.values(bucket)) {
      value.gross = Math.round(value.gross);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  const config = parseArgs();
  const env = parseEnvFile('.env.local');
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: businessRows, error: businessError } = await supabase
    .from('scalev_webhook_businesses')
    .select('id, business_code, api_key, tax_rate_name')
    .eq('is_active', true)
    .not('api_key', 'is', null);
  if (businessError) throw businessError;

  const businesses = ((businessRows || []) as BusinessConfig[])
    .filter((business) => CONNECTED_BUSINESSES.has(business.business_code))
    .filter((business) => !config.onlyBusiness || business.business_code === config.onlyBusiness);

  const { data: storeRows, error: storeError } = await supabase
    .from('scalev_store_channels')
    .select('business_id, store_name, store_type, channel_override')
    .eq('is_active', true);
  if (storeError) throw storeError;

  const storeMaps = createStoreMaps((storeRows || []) as StoreChannelRow[]);
  const [businessDirectoryRows, originRegistryRows] = await Promise.all([
    fetchWarehouseBusinessDirectoryRows(supabase as any),
    fetchWarehouseOriginRegistryRows(supabase as any),
  ]);

  const brandCache: { rows?: Array<{ name: string; keywords: string[] }> } = {};

  if (config.repairDbEmptyLines) {
    await repairDbEmptyLines({
      supabase,
      businesses,
      storeMaps,
      businessDirectoryRows,
      brandCache,
      config,
    });
    return;
  }

  const summary = {
    apply: config.apply,
    includeReseller: config.includeReseller,
    repairEmptyLines: config.repairEmptyLines,
    skipWarehouse: config.skipWarehouse,
    from: config.from,
    to: config.to,
    scanned: 0,
    missing: 0,
    inserted: 0,
    repaired: 0,
    lineInserted: 0,
    skippedExisting: 0,
    skippedNonTargetChannel: 0,
    warehouse: {} as Record<string, number>,
    byBusiness: {} as Record<string, { orders: number; gross: number }>,
    byChannel: {} as Record<string, { orders: number; gross: number }>,
    byStore: {} as Record<string, { orders: number; gross: number }>,
  };

  for (const business of businesses) {
    const candidates = await fetchScalevOrdersForBusiness(business, config.from, config.to);
    console.log(JSON.stringify({ business: business.business_code, candidates: candidates.length }));
    const existingOrders = await fetchExistingOrders(
      supabase,
      business.business_code,
      candidates.map((candidate) => cleanText(candidate?.order_id)),
    );
    const lineCounts = config.repairEmptyLines
      ? await fetchLineCounts(supabase, Array.from(existingOrders.values()).map((row) => row.id))
      : new Map<number, number>();

    for (const candidate of candidates) {
      summary.scanned++;
      const orderId = cleanText(candidate?.order_id);
      if (!orderId || isOrderIdFromToday(orderId)) continue;

      const channel = deriveChannel(candidate, business.id, storeMaps);
      const targetChannel = channel === 'CS Manual' || (config.includeReseller && channel === 'Reseller');
      if (!targetChannel) {
        summary.skippedNonTargetChannel++;
        continue;
      }

      const existing = existingOrders.get(orderId) || null;
      const shouldRepair = Boolean(config.repairEmptyLines && existing && (lineCounts.get(existing.id) || 0) === 0);
      if (existing && !shouldRepair) {
        summary.skippedExisting++;
        continue;
      }

      if (existing) {
        summary.repaired++;
      } else {
        summary.missing++;
      }

      const detailId = cleanText(candidate?.id || candidate?.order_id);
      const detail = await withRetries(
        `scalev-detail:${business.business_code}:${detailId}`,
        () => fetchOrderDetail(business.api_key, 'https://api.scalev.id/v2', detailId),
      );
      const gross = num(detail?.gross_revenue);
      const storeName = getStoreName(detail);
      for (const [bucket, key] of [
        ['byBusiness', business.business_code],
        ['byChannel', channel],
        ['byStore', storeName || '(unknown)'],
      ] as const) {
        summary[bucket][key] ||= { orders: 0, gross: 0 };
        summary[bucket][key].orders++;
        summary[bucket][key].gross += gross;
      }

      if (!config.apply) continue;

      const dest = detail?.destination_address || detail?.address || {};
      const sourceClassFields = deriveSourceClassFields(detail, business.id, storeMaps);
      const parsedHeaderFinancials = parseScalevHeaderFinancialFields(detail);
      const warehouseContext = resolveWarehouseOrderContextFromLookups({
        data: detail,
        businessCode: business.business_code,
        businessDirectoryRows,
        originRegistryRows,
      });
      const trackingNumber = extractMarketplaceTrackingFromWebhookData(detail);

      const orderRow = {
        scalev_id: cleanText(detail?.id) || null,
        order_id: orderId,
        external_id: cleanText(detail?.external_id) || null,
        marketplace_tracking_number: trackingNumber,
        customer_name: cleanText(dest?.name || detail?.customer_name) || null,
        customer_phone: cleanText(dest?.phone || detail?.customer_phone) || null,
        customer_email: cleanText(dest?.email || detail?.customer_email) || null,
        province: cleanText(dest?.province) || null,
        city: cleanText(dest?.city) || null,
        subdistrict: cleanText(dest?.subdistrict) || null,
        status: cleanText(detail?.status) || 'unknown',
        platform: cleanText(detail?.platform) || null,
        store_name: storeName || null,
        utm_source: cleanText(detail?.utm_source) || null,
        financial_entity: getFinancialEntity(detail),
        payment_method: cleanText(detail?.payment_method) || null,
        is_purchase_fb: detail?.is_purchase_fb === true || detail?.is_purchase_fb === 'true' || !!cleanText(detail?.message_variables?.advertiser),
        is_purchase_tiktok: detail?.is_purchase_tiktok === true || detail?.is_purchase_tiktok === 'true',
        is_purchase_kwai: detail?.is_purchase_kwai === true || detail?.is_purchase_kwai === 'true',
        gross_revenue: num(detail?.gross_revenue),
        net_revenue: num(detail?.net_revenue),
        shipping_cost: num(detail?.shipping_cost),
        shipping_discount: parsedHeaderFinancials.shippingDiscountPresent ? parsedHeaderFinancials.shippingDiscount : null,
        discount_code_discount: parsedHeaderFinancials.discountCodeDiscountPresent ? parsedHeaderFinancials.discountCodeDiscount : null,
        unique_code_discount: num(detail?.unique_code_discount),
        total_quantity: num(detail?.total_quantity),
        handler: null,
        draft_time: ts(detail?.draft_time),
        pending_time: ts(detail?.pending_time),
        confirmed_time: ts(detail?.confirmed_time),
        paid_time: ts(detail?.paid_time),
        shipped_time: ts(detail?.shipped_time),
        completed_time: ts(detail?.completed_time),
        canceled_time: ts(detail?.canceled_time),
        source: 'webhook',
        business_code: business.business_code,
        business_name_raw: warehouseContext.businessNameRaw,
        origin_business_name_raw: warehouseContext.originBusinessNameRaw,
        origin_raw: warehouseContext.originRaw,
        seller_business_code: warehouseContext.sellerBusinessCode,
        origin_operator_business_code: warehouseContext.originOperatorBusinessCode,
        origin_registry_id: warehouseContext.originRegistryId,
        ...sourceClassFields,
        raw_data: detail,
        synced_at: new Date().toISOString(),
      };

      const inserted = existing
        ? existing
        : null;

      let dbOrderId = inserted?.id || 0;
      if (existing) {
        const { error: updateError } = await supabase
          .from('scalev_orders')
          .update(orderRow)
          .eq('id', existing.id);
        if (updateError) throw updateError;
        dbOrderId = existing.id;
      } else {
        const { data: insertedRow, error: insertError } = await supabase
          .from('scalev_orders')
          .insert(orderRow)
          .select('id, order_id')
          .single();
        if (insertError) throw insertError;
        dbOrderId = Number(insertedRow.id);
        summary.inserted++;
      }

      const lines = await buildOrderLines({
        supabase,
        order: detail,
        dbOrderId,
        businessId: business.id,
        taxRateName: business.tax_rate_name,
        storeMaps,
        businessDirectoryRows,
        brandCache,
      });

      if (lines.length > 0) {
        const { error: lineError } = await supabase
          .from('scalev_order_lines')
          .upsert(lines, { onConflict: 'scalev_order_id,product_name' });
        if (lineError) throw lineError;
        summary.lineInserted += lines.length;
      }

      if (!config.skipWarehouse) {
        const warehouseResult = await reconcileScalevOrderWarehouse(orderId, dbOrderId);
        const action = cleanText(warehouseResult?.action) || 'unknown';
        summary.warehouse[action] = (summary.warehouse[action] || 0) + 1;
      }

      if (!existing) await supabase.from('scalev_sync_log').insert({
        status: 'success',
        sync_type: 'ops_backfill_missing_cs_manual',
        business_code: business.business_code,
        orders_fetched: 1,
        orders_updated: 0,
        orders_inserted: 1,
        error_message: null,
        completed_at: new Date().toISOString(),
      });
    }
  }

  for (const bucket of [summary.byBusiness, summary.byChannel, summary.byStore]) {
    for (const value of Object.values(bucket)) {
      value.gross = Math.round(value.gross);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Missing gross target: Rp ${formatMoney(Object.values(summary.byBusiness).reduce((sum, row) => sum + row.gross, 0))}`);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
