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

const DEFAULT_FROM = '2026-05-01';
const DEFAULT_TO = '2026-05-25';
const TERMINAL_STATUSES = new Set(['shipped', 'completed']);
const SUPPORTED_STATUSES = new Set([
  'draft',
  'pending',
  'ready',
  'confirmed',
  'paid',
  'in_process',
  'shipped',
  'completed',
  'canceled',
  'rts',
  'shipped_rts',
  'deleted',
]);

type BusinessConfig = {
  id: number;
  workspace_id: string;
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

type ExistingOrder = {
  id: number;
  order_id: string | null;
  business_code: string | null;
  status: string | null;
  gross_revenue: number | null;
  net_revenue: number | null;
  source: string | null;
  scalev_id: string | null;
  external_id: string | null;
  marketplace_tracking_number: string | null;
  store_name: string | null;
  platform: string | null;
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
  const workspace = process.argv.find((arg) => arg.startsWith('--workspace='))?.split('=')[1] || null;
  const onlyBusiness = process.argv.find((arg) => arg.startsWith('--business='))?.split('=')[1] || null;
  const statusArg = process.argv.find((arg) => arg.startsWith('--statuses='))?.split('=')[1] || null;
  const statuses = statusArg
    ? statusArg.split(',').map((status) => status.trim()).filter(Boolean)
    : Array.from(TERMINAL_STATUSES);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error('Use YYYY-MM-DD for --from and --to.');
  }
  if (from > to) {
    throw new Error(`Invalid range: ${from} is after ${to}.`);
  }
  if (!workspace) {
    throw new Error('Use --workspace=SLUG_OR_UUID so the repair is explicitly tenant-scoped.');
  }
  const unsupportedStatuses = statuses.filter((status) => !SUPPORTED_STATUSES.has(status));
  if (statuses.length === 0 || unsupportedStatuses.length > 0) {
    throw new Error(`Invalid --statuses value${unsupportedStatuses.length ? `: ${unsupportedStatuses.join(', ')}` : ''}.`);
  }

  const repairMissing = !process.argv.includes('--no-repair-missing');
  const repairAmounts = !process.argv.includes('--no-repair-amounts');

  return {
    apply: process.argv.includes('--apply'),
    includeToday: process.argv.includes('--include-today'),
    skipWarehouse: process.argv.includes('--skip-warehouse'),
    repairMissing,
    repairAmounts,
    from,
    to,
    workspace,
    onlyBusiness,
    statuses,
  };
}

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function scalevDbId(value: unknown): string | null {
  const text = cleanText(value);
  return /^\d+$/.test(text) ? text : null;
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

function jakartaDate(value: unknown): string | null {
  const text = cleanText(value);
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

function getOrderDate(order: any) {
  return jakartaDate(
    order?.shipped_time
    || order?.completed_time
    || order?.paid_time
    || order?.confirmed_time
    || order?.pending_time
    || order?.draft_time
    || order?.canceled_time,
  );
}

function orderIdPrefixForDate(date: string) {
  const [year, month, day] = date.split('-');
  return `${year.slice(2)}${month}${day}`;
}

function isOrderIdFromToday(orderId: string) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [year, month, day] = today.split('-');
  return orderId.startsWith(`${year.slice(2)}${month}${day}`);
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

function formatMoney(value: number) {
  return Math.round(value).toLocaleString('id-ID');
}

async function withRetries<T>(label: string, fn: () => Promise<T>, maxAttempts = 6): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      const message = error instanceof Error ? error.message : String(error);
      const delayMs = message.includes('429')
        ? Math.min(60_000, attempt * 10_000)
        : Math.min(10_000, attempt * 1_000);
      console.warn(JSON.stringify({
        label,
        attempt,
        retry_in_ms: delayMs,
        error: message,
      }));
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

async function getTax(supabase: any, workspaceId: string, taxRateName: string | null) {
  if (taxRateName === 'NONE') return { rate: 0, divisor: 1 };

  const { data, error } = await supabase
    .from('tax_rates')
    .select('name, rate, effective_from')
    .eq('workspace_id', workspaceId)
    .eq('name', taxRateName || 'PPN')
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const rate = Number(data?.rate ?? 11);
  return { rate, divisor: 1 + rate / 100 };
}

async function deriveBrandFromProduct(
  supabase: any,
  workspaceId: string,
  productName: string,
  cache: { rows?: Array<{ name: string; keywords: string[] }> },
) {
  if (!cache.rows) {
    const { data, error } = await supabase
      .from('brands')
      .select('name, keywords')
      .eq('workspace_id', workspaceId)
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
  workspaceId: string;
  businessId: number;
  taxRateName: string | null;
  storeMaps: ReturnType<typeof createStoreMaps>;
  businessDirectoryRows: Awaited<ReturnType<typeof fetchWarehouseBusinessDirectoryRows>>;
  brandCache: { rows?: Array<{ name: string; keywords: string[] }> };
}) {
  const orderId = cleanText(args.order?.order_id);
  const salesChannel = deriveChannel(args.order, args.businessId, args.storeMaps);
  const tax = await getTax(args.supabase, args.workspaceId, args.taxRateName);
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
      workspace_id: args.workspaceId,
      scalev_order_id: args.dbOrderId,
      order_id: orderId,
      product_name: productName,
      product_type: await deriveBrandFromProduct(args.supabase, args.workspaceId, productName, args.brandCache),
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

async function fetchScalevOrdersForBusiness(
  business: BusinessConfig,
  from: string,
  to: string,
  statuses: string[],
) {
  const candidates: any[] = [];
  const seenOrderIds = new Set<string>();
  const fromPrefix = orderIdPrefixForDate(from);
  const toPrefix = orderIdPrefixForDate(to);

  const requestedStatuses = new Set(statuses);
  for (const status of statuses) {
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
        if (!orderId) continue;
        if (prefix < fromPrefix || prefix > toPrefix) continue;
        if (!requestedStatuses.has(cleanText(row?.status))) continue;
        seenOrderIds.add(orderId);
        candidates.push(row);
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

const EXISTING_COLUMNS = [
  'id',
  'order_id',
  'business_code',
  'status',
  'gross_revenue',
  'net_revenue',
  'source',
  'scalev_id',
  'external_id',
  'marketplace_tracking_number',
  'store_name',
  'platform',
].join(',');

async function fetchExistingOrdersByOrderId(
  supabase: any,
  workspaceId: string,
  businessCode: string,
  orderIds: string[],
) {
  const existing = new Map<string, ExistingOrder>();
  for (const chunk of chunkArray(Array.from(new Set(orderIds)).filter(Boolean), 500)) {
    const { data, error } = await withRetries(
      `existing-order-id:${businessCode}:${chunk[0]}`,
      async () => await supabase
        .from('scalev_orders')
        .select(EXISTING_COLUMNS)
        .eq('workspace_id', workspaceId)
        .eq('business_code', businessCode)
        .in('order_id', chunk),
    );
    if (error) throw error;
    for (const row of data || []) {
      existing.set(cleanText(row.order_id), row as ExistingOrder);
    }
  }
  return existing;
}

async function fetchTransferredOutOrderIds(
  supabase: any,
  workspaceId: string,
  businessCode: string,
  orderIds: string[],
) {
  const transferred = new Set<string>();
  for (const chunk of chunkArray(Array.from(new Set(orderIds)).filter(Boolean), 500)) {
    const { data, error } = await withRetries(
      `transferred-order-id:${businessCode}:${chunk[0]}`,
      async () => await supabase
        .from('scalev_order_workspace_transfers')
        .select('order_id')
        .eq('source_workspace_id', workspaceId)
        .eq('source_business_code', businessCode)
        .eq('is_active', true)
        .in('order_id', chunk),
    );
    if (error) throw error;
    for (const row of data || []) {
      transferred.add(cleanText(row.order_id));
    }
  }
  return transferred;
}

async function findMarketplaceShadowOrder(args: {
  supabase: any;
  workspaceId: string;
  businessCode: string;
  storeName: string | null;
  externalId: string | null;
  trackingNumber: string | null;
}) {
  if (args.externalId) {
    const { data, error } = await args.supabase
      .from('scalev_orders')
      .select(EXISTING_COLUMNS)
      .eq('workspace_id', args.workspaceId)
      .eq('business_code', args.businessCode)
      .eq('external_id', args.externalId)
      .limit(2);
    if (error) throw error;
    if ((data || []).length > 1) return { match: null, reason: 'ambiguous_external_id' };
    if ((data || []).length === 1) return { match: data[0] as ExistingOrder, reason: 'external_id' };
  }

  if (!args.trackingNumber) return { match: null, reason: 'no_tracking' };

  let query = args.supabase
    .from('scalev_orders')
    .select(EXISTING_COLUMNS)
    .eq('workspace_id', args.workspaceId)
    .eq('business_code', args.businessCode)
    .eq('marketplace_tracking_number', args.trackingNumber)
    .in('source', ['marketplace_api_upload', 'webhook', 'ops_upload'])
    .limit(2);

  if (args.storeName) query = query.eq('store_name', args.storeName);
  const { data, error } = await query;
  if (error) throw error;
  if ((data || []).length > 1) return { match: null, reason: 'ambiguous_tracking' };
  if ((data || []).length === 1) return { match: data[0] as ExistingOrder, reason: 'tracking' };
  return { match: null, reason: 'unmatched' };
}

function needsHeaderRepair(existing: ExistingOrder, candidate: any) {
  const scalevStatus = cleanText(candidate?.status);
  const scalevGross = Math.round(num(candidate?.gross_revenue));
  const scalevNet = Math.round(num(candidate?.net_revenue));
  const appGross = Math.round(num(existing.gross_revenue));
  const appNet = Math.round(num(existing.net_revenue));

  return cleanText(existing.status) !== scalevStatus
    || appGross !== scalevGross
    || appNet !== scalevNet;
}

function addBucket(summary: any, bucket: string, key: string, gross: number) {
  summary[bucket][key] ||= { orders: 0, gross: 0 };
  summary[bucket][key].orders++;
  summary[bucket][key].gross += gross;
}

function buildOrderRow(args: {
  detail: any;
  business: BusinessConfig;
  storeMaps: ReturnType<typeof createStoreMaps>;
  businessDirectoryRows: Awaited<ReturnType<typeof fetchWarehouseBusinessDirectoryRows>>;
  originRegistryRows: Awaited<ReturnType<typeof fetchWarehouseOriginRegistryRows>>;
}) {
  const detail = args.detail;
  const dest = detail?.destination_address || detail?.address || {};
  const storeName = getStoreName(detail);
  const sourceClassFields = deriveSourceClassFields(detail, args.business.id, args.storeMaps);
  const parsedHeaderFinancials = parseScalevHeaderFinancialFields(detail);
  const warehouseContext = resolveWarehouseOrderContextFromLookups({
    data: detail,
    businessCode: args.business.business_code,
    businessDirectoryRows: args.businessDirectoryRows,
    originRegistryRows: args.originRegistryRows,
  });
  const trackingNumber = extractMarketplaceTrackingFromWebhookData(detail);

  return {
    workspace_id: args.business.workspace_id,
    // scalev_orders.scalev_id is a legacy BIGINT column, while newer ScaleV
    // accounts return UUID identifiers. Keep the UUID in raw_data and let
    // order_id remain the stable lookup key for those accounts.
    scalev_id: scalevDbId(detail?.id),
    order_id: cleanText(detail?.order_id),
    external_id: cleanText(detail?.external_id) || null,
    marketplace_tracking_number: trackingNumber,
    customer_name: cleanText(dest?.name || detail?.customer_name || detail?.customer?.name) || null,
    customer_phone: cleanText(dest?.phone || detail?.customer_phone || detail?.customer?.phone) || null,
    customer_email: cleanText(dest?.email || detail?.customer_email || detail?.customer?.email) || null,
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
    business_code: args.business.business_code,
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
}

async function replaceOrderLines(args: {
  supabase: any;
  detail: any;
  dbOrderId: number;
  workspaceId: string;
  business: BusinessConfig;
  storeMaps: ReturnType<typeof createStoreMaps>;
  businessDirectoryRows: Awaited<ReturnType<typeof fetchWarehouseBusinessDirectoryRows>>;
  brandCache: { rows?: Array<{ name: string; keywords: string[] }> };
}) {
  const lines = await buildOrderLines({
    supabase: args.supabase,
    order: args.detail,
    dbOrderId: args.dbOrderId,
    workspaceId: args.workspaceId,
    businessId: args.business.id,
    taxRateName: args.business.tax_rate_name,
    storeMaps: args.storeMaps,
    businessDirectoryRows: args.businessDirectoryRows,
    brandCache: args.brandCache,
  });

  const { error: deleteError } = await args.supabase
    .from('scalev_order_lines')
    .delete()
    .eq('workspace_id', args.workspaceId)
    .eq('scalev_order_id', args.dbOrderId);
  if (deleteError) throw deleteError;

  if (lines.length === 0) return 0;

  const { error: insertError } = await args.supabase
    .from('scalev_order_lines')
    .insert(lines);
  if (insertError) throw insertError;
  return lines.length;
}

let aliasResolutionRegistered = false;
function registerNextAliasResolution() {
  if (aliasResolutionRegistered) return;
  aliasResolutionRegistered = true;
  const mod = require('module');
  const path = require('path');
  const originalResolve = mod._resolveFilename;
  mod._resolveFilename = function resolveFilename(request: string, parent: unknown, isMain: boolean, options: unknown) {
    if (request.startsWith('@/')) {
      return originalResolve.call(this, path.join(process.cwd(), request.slice(2)), parent, isMain, options);
    }
    return originalResolve.call(this, request, parent, isMain, options);
  };
}

async function reconcileWarehouse(workspaceId: string, orderId: string, dbOrderId: number) {
  registerNextAliasResolution();
  const mod = await import('../../lib/warehouse-ledger-actions');
  return mod.reconcileScalevOrderWarehouse(orderId, dbOrderId, workspaceId);
}

function preserveAuthoritativeSource(orderRow: Record<string, any>, existing: ExistingOrder | null) {
  const source = cleanText(existing?.source);
  if (source === 'marketplace_api_upload' || source === 'ops_upload') {
    return {
      ...orderRow,
      source,
    };
  }
  return orderRow;
}

async function main() {
  const config = parseArgs();
  const env = parseEnvFile('.env.local');
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let workspaceQuery = supabase
    .from('workspaces')
    .select('id, slug, name');
  workspaceQuery = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(config.workspace)
    ? workspaceQuery.eq('id', config.workspace)
    : workspaceQuery.eq('slug', config.workspace);
  const { data: workspace, error: workspaceError } = await workspaceQuery.maybeSingle();
  if (workspaceError) throw workspaceError;
  if (!workspace) throw new Error(`Workspace not found: ${config.workspace}`);
  const workspaceId = String(workspace.id);

  const { data: businessRows, error: businessError } = await supabase
    .from('scalev_webhook_businesses')
    .select('id, workspace_id, business_code, api_key, tax_rate_name')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .not('api_key', 'is', null);
  if (businessError) throw businessError;

  const businesses = ((businessRows || []) as BusinessConfig[])
    .filter((business) => !config.onlyBusiness || business.business_code === config.onlyBusiness);
  if (businesses.length === 0) {
    throw new Error(`No active ScaleV business found in workspace ${workspace.slug}${config.onlyBusiness ? ` for ${config.onlyBusiness}` : ''}.`);
  }

  const { data: storeRows, error: storeError } = await supabase
    .from('scalev_store_channels')
    .select('business_id, store_name, store_type, channel_override')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);
  if (storeError) throw storeError;

  const storeMaps = createStoreMaps((storeRows || []) as StoreChannelRow[]);
  const [businessDirectoryRows, originRegistryRows] = await Promise.all([
    fetchWarehouseBusinessDirectoryRows(supabase as any, workspaceId),
    fetchWarehouseOriginRegistryRows(supabase as any, workspaceId),
  ]);
  const brandCache: { rows?: Array<{ name: string; keywords: string[] }> } = {};

  const summary = {
    apply: config.apply,
    skipWarehouse: config.skipWarehouse,
    includeToday: config.includeToday,
    workspace_id: workspaceId,
    workspace_slug: workspace.slug,
    statuses: config.statuses,
    from: config.from,
    to: config.to,
    scanned: 0,
    cleanExisting: 0,
    transferredOut: 0,
    missing: 0,
    stale: 0,
    inserted: 0,
    promoted: 0,
    updated: 0,
    linesRebuilt: 0,
    ambiguous: [] as any[],
    issues: [] as any[],
    warehouseErrors: [] as any[],
    warehouse: {} as Record<string, number>,
    byBusiness: {} as Record<string, { orders: number; gross: number }>,
    byChannel: {} as Record<string, { orders: number; gross: number }>,
    byPlatform: {} as Record<string, { orders: number; gross: number }>,
    byStore: {} as Record<string, { orders: number; gross: number }>,
  };

  for (const business of businesses) {
    const candidates = await fetchScalevOrdersForBusiness(
      business,
      config.from,
      config.to,
      config.statuses,
    );
    console.log(JSON.stringify({ business: business.business_code, candidates: candidates.length }));
    const existingByOrderId = await fetchExistingOrdersByOrderId(
      supabase,
      workspaceId,
      business.business_code,
      candidates.map((candidate) => cleanText(candidate?.order_id)),
    );
    const transferredOutOrderIds = await fetchTransferredOutOrderIds(
      supabase,
      workspaceId,
      business.business_code,
      candidates.map((candidate) => cleanText(candidate?.order_id)),
    );

    for (const candidate of candidates) {
      summary.scanned++;
      const orderId = cleanText(candidate?.order_id);
      if (!orderId) continue;
      if (!config.includeToday && isOrderIdFromToday(orderId)) continue;
      if (transferredOutOrderIds.has(orderId)) {
        summary.transferredOut++;
        continue;
      }

      const exactExisting = existingByOrderId.get(orderId) || null;
      let action: 'clean' | 'missing' | 'stale' = 'clean';
      if (!exactExisting) {
        action = 'missing';
      } else if (needsHeaderRepair(exactExisting, candidate)) {
        action = 'stale';
      }

      if (action === 'clean') {
        summary.cleanExisting++;
        continue;
      }

      if (action === 'missing' && !config.repairMissing) continue;
      if (action === 'stale' && !config.repairAmounts) continue;

      if (summary.issues.length < 25) summary.issues.push({
        business_code: business.business_code,
        order_id: orderId,
        action,
        scalev_id: cleanText(candidate?.id) || null,
        app_status: exactExisting?.status || null,
        scalev_status: cleanText(candidate?.status) || null,
        app_gross: exactExisting ? num(exactExisting.gross_revenue) : null,
        scalev_gross: num(candidate?.gross_revenue),
        app_net: exactExisting ? num(exactExisting.net_revenue) : null,
        scalev_net: num(candidate?.net_revenue),
        platform: cleanText(candidate?.platform) || null,
        store_name: getStoreName(candidate) || null,
      });

      const detailId = cleanText(candidate?.id || candidate?.order_id);
      const detail = await withRetries(
        `scalev-detail:${business.business_code}:${detailId}`,
        () => fetchOrderDetail(business.api_key, 'https://api.scalev.id/v2', detailId),
      );
      const channel = deriveChannel(detail, business.id, storeMaps);
      const gross = num(detail?.gross_revenue);
      const platform = cleanText(detail?.platform) || '(none)';
      const storeName = getStoreName(detail) || '(unknown)';

      addBucket(summary, 'byBusiness', business.business_code, gross);
      addBucket(summary, 'byChannel', channel, gross);
      addBucket(summary, 'byPlatform', `${business.business_code}:${platform}`, gross);
      addBucket(summary, 'byStore', `${business.business_code}:${storeName}`, gross);

      if (action === 'missing') summary.missing++;
      if (action === 'stale') summary.stale++;
      if (!config.apply) continue;

      const orderRow = buildOrderRow({
        detail,
        business,
        storeMaps,
        businessDirectoryRows,
        originRegistryRows,
      });

      let dbOrderId: number;
      let finalAction: 'inserted' | 'promoted' | 'updated';
      if (exactExisting) {
        const { error: updateError } = await supabase
          .from('scalev_orders')
          .update(preserveAuthoritativeSource(orderRow, exactExisting))
          .eq('workspace_id', workspaceId)
          .eq('id', exactExisting.id);
        if (updateError) throw updateError;
        dbOrderId = exactExisting.id;
        finalAction = 'updated';
        summary.updated++;
      } else {
        const shadow = await findMarketplaceShadowOrder({
          supabase,
          workspaceId,
          businessCode: business.business_code,
          storeName: getStoreName(detail) || null,
          externalId: cleanText(detail?.external_id) || null,
          trackingNumber: extractMarketplaceTrackingFromWebhookData(detail),
        });

        if (shadow.match) {
          const { error: updateError } = await supabase
            .from('scalev_orders')
            .update(preserveAuthoritativeSource(orderRow, shadow.match))
            .eq('workspace_id', workspaceId)
            .eq('id', shadow.match.id);
          if (updateError) throw updateError;
          dbOrderId = shadow.match.id;
          finalAction = 'promoted';
          summary.promoted++;
        } else if (shadow.reason.startsWith('ambiguous')) {
          summary.ambiguous.push({
            business_code: business.business_code,
            order_id: orderId,
            scalev_id: cleanText(detail?.id) || null,
            reason: shadow.reason,
          });
          continue;
        } else {
          const { data: insertedRow, error: insertError } = await supabase
            .from('scalev_orders')
            .insert(orderRow)
            .select('id')
            .single();
          if (insertError) throw insertError;
          dbOrderId = Number(insertedRow.id);
          finalAction = 'inserted';
          summary.inserted++;
        }
      }

      summary.linesRebuilt += await replaceOrderLines({
        supabase,
        detail,
        dbOrderId,
        workspaceId,
        business,
        storeMaps,
        businessDirectoryRows,
        brandCache,
      });

      let warehouseErrorMessage: string | null = null;
      if (!config.skipWarehouse) {
        try {
          const warehouseResult = await reconcileWarehouse(workspaceId, orderId, dbOrderId);
          const warehouseAction = cleanText(warehouseResult?.action) || 'unknown';
          summary.warehouse[warehouseAction] = (summary.warehouse[warehouseAction] || 0) + 1;
        } catch (error) {
          warehouseErrorMessage = error instanceof Error ? error.message : String(error);
          summary.warehouseErrors.push({
            business_code: business.business_code,
            order_id: orderId,
            scalev_order_db_id: dbOrderId,
            repair_action: finalAction,
            error: warehouseErrorMessage,
          });
          summary.warehouse.warehouse_reconcile_failed = (summary.warehouse.warehouse_reconcile_failed || 0) + 1;
          console.warn(JSON.stringify({
            business_code: business.business_code,
            order_id: orderId,
            warehouse_error: warehouseErrorMessage,
          }));
        }
      }

      await supabase.from('scalev_sync_log').insert({
        workspace_id: workspaceId,
        status: warehouseErrorMessage ? 'partial' : 'success',
        sync_type: `ops_repair_terminal_${finalAction}`,
        business_code: business.business_code,
        orders_fetched: 1,
        orders_updated: finalAction === 'inserted' ? 0 : 1,
        orders_inserted: finalAction === 'inserted' ? 1 : 0,
        error_message: warehouseErrorMessage,
        completed_at: new Date().toISOString(),
      });
    }
  }

  for (const bucket of [summary.byBusiness, summary.byChannel, summary.byPlatform, summary.byStore]) {
    for (const value of Object.values(bucket)) {
      value.gross = Math.round(value.gross);
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Repair target gross: Rp ${formatMoney(Object.values(summary.byBusiness).reduce((sum, row) => sum + row.gross, 0))}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  if (error?.cause) console.error('cause:', error.cause);
  process.exit(1);
});
