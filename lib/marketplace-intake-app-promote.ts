import { createServiceSupabase } from './service-supabase';
import {
  buildScalevOpsProjectionForBatch,
  type ScalevOpsCsvRow,
} from './marketplace-intake-scalev-export';
import {
  resolveMarketplaceIntakeShippingFinancials,
  type MarketplaceIntakeShippingFinancials,
} from './marketplace-intake-shipping';
import { buildScalevSourceClassFields } from './scalev-source-class';
import {
  extractMarketplaceTrackingFromProjectionRows,
  extractMarketplaceTrackingFromScalevOrder,
  normalizeMarketplaceTracking,
} from './marketplace-tracking';

const MARKETPLACE_APP_SOURCE = 'marketplace_api_upload';
const DEFAULT_TAX_RATE = 11;
const DEFAULT_TAX_DIVISOR = 1 + DEFAULT_TAX_RATE / 100;

type PromoteBatchRow = {
  id: number;
  source_key: string;
  source_label: string;
  business_id: number;
  business_code: string;
  filename: string;
};

type PromoteOrderRow = {
  id: number;
  external_order_id: string;
  final_store_name: string | null;
  shipment_date: string | null;
  warehouse_status: string;
  customer_label: string | null;
  recipient_name: string | null;
  tracking_number: string | null;
  mp_customer_username: string | null;
  mp_order_created_at: string | null;
  mp_payment_paid_at: string | null;
  raw_meta: Record<string, unknown> | null;
};

type PromoteLineRow = {
  intake_order_id: number;
  line_index: number;
  mp_product_name: string;
  quantity: number;
  matched_entity_label: string | null;
  detected_custom_id: string | null;
  normalized_sku?: string | null;
  mp_sku: string | null;
  mapped_store_name: string | null;
  raw_row: Record<string, string> | null;
};

type ExistingScalevOrderRow = {
  id: number;
  order_id: string;
  external_id: string | null;
  marketplace_tracking_number?: string | null;
  source: string | null;
  business_code: string | null;
  scalev_id: string | null;
  shipping_cost?: number | null;
  shipping_discount?: number | null;
  store_name?: string | null;
  raw_data?: any;
};

type ProductMappingRow = {
  sku: string | null;
  product_name: string | null;
  cogs: number | null;
  brand: string | null;
  product_type: string | null;
};

type ProjectionOrderGroup = {
  externalId: string;
  headerRow: ScalevOpsCsvRow;
  rows: ScalevOpsCsvRow[];
};

export type MarketplaceIntakePromoteToAppInput = {
  batchId: number;
  shipmentDate?: string | null;
  includeWarehouseStatuses?: string[];
  promotedByEmail?: string | null;
};

export type MarketplaceIntakePromoteToAppResult = {
  batchId: number;
  businessCode: string;
  shipmentDate: string | null;
  orderCount: number;
  insertedCount: number;
  updatedCount: number;
  updatedWebhookCount: number;
  updatedAuthoritativeCount: number;
  matchedExternalIdCount: number;
  matchedTrackingCount: number;
  skippedCount: number;
  promotedAt: string;
};

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeShipmentDate(value: string): string {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('shipmentDate tidak valid. Gunakan format YYYY-MM-DD.');
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeIdentifier(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function parseInteger(value: unknown): number {
  const num = Number(String(value ?? '').replace(/[^0-9.-]+/g, ''));
  return Number.isFinite(num) ? Math.round(num) : 0;
}

function parseNullableAmount(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.round(num));
}

function calcBeforeTax(value: number): number {
  return Math.round((Number(value || 0) / DEFAULT_TAX_DIVISOR) || 0);
}

function isMissingColumnError(error: any): boolean {
  const code = cleanText(error?.code);
  const message = cleanText(error?.message).toLowerCase();
  return code === '42703'
    || message.includes('column')
    || message.includes('schema cache');
}

function buildShipmentTimestamp(shipmentDate: string): string {
  return `${shipmentDate}T07:00:00+07:00`;
}

function buildShipmentDayBounds(shipmentDate: string) {
  const dayStart = `${shipmentDate}T00:00:00+07:00`;
  const match = shipmentDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`shipmentDate tidak valid untuk day bounds: ${shipmentDate}`);
  }
  const nextDate = new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + 1,
  ));
  const nextYear = nextDate.getUTCFullYear();
  const nextMonth = String(nextDate.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(nextDate.getUTCDate()).padStart(2, '0');
  const dayEnd = `${nextYear}-${nextMonth}-${nextDay}T00:00:00+07:00`;
  return { dayStart, dayEnd };
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function groupProjectionRows(rows: ScalevOpsCsvRow[]): ProjectionOrderGroup[] {
  const grouped: ProjectionOrderGroup[] = [];
  let current: ProjectionOrderGroup | null = null;

  for (const row of rows || []) {
    const externalId = cleanText(row.external_id);
    if (externalId) {
      if (current) grouped.push(current);
      current = {
        externalId,
        headerRow: row,
        rows: [row],
      };
      continue;
    }

    if (!current) continue;
    current.rows.push(row);
  }

  if (current) grouped.push(current);
  return grouped;
}

function buildProductMappingIndexes(rows: ProductMappingRow[]) {
  const bySku = new Map<string, ProductMappingRow>();
  const byName = new Map<string, ProductMappingRow>();
  for (const row of rows || []) {
    if (row.sku) bySku.set(String(row.sku).toUpperCase(), row);
    if (row.product_name) byName.set(normalizeIdentifier(row.product_name), row);
  }
  return { bySku, byName };
}

function deriveBrandFallback(values: Array<string | null | undefined>): string {
  const joined = values
    .map((value) => cleanText(value).toLowerCase())
    .filter(Boolean)
    .join(' ');

  if (!joined) return 'Other';
  if (joined.includes('osgard')) return 'Osgard';
  if (joined.includes('the secret') || joined.includes('purvu') || joined.includes('srt')) return 'Purvu';
  if (joined.includes('pluve') || joined.includes('plv')) return 'Pluve';
  if (joined.includes('globite') || joined.includes('glb')) return 'Globite';
  if (joined.includes('drhyun') || joined.includes('dr hyun') || joined.includes('drh')) return 'DrHyun';
  if (joined.includes('calmara') || joined.includes('clm') || joined.includes('cal')) return 'Calmara';
  if (joined.includes('yuv')) return 'YUV';
  if (joined.includes('roove') || joined.includes('rov') || joined.includes('shaker')) return 'Roove';
  return 'Other';
}

function lookupLineCogsAndBrand(
  line: PromoteLineRow | null | undefined,
  sku: string,
  indexes: ReturnType<typeof buildProductMappingIndexes>,
  fallbackStoreName: string | null,
): { cogsTotal: number; brand: string } {
  const normalizedSku = String(sku || '').toUpperCase();
  const direct = normalizedSku ? indexes.bySku.get(normalizedSku) : null;
  if (direct) {
    return {
      cogsTotal: Number(direct.cogs || 0),
      brand: cleanText(direct.brand || direct.product_type) || deriveBrandFallback([fallbackStoreName, line?.matched_entity_label, line?.mp_product_name, sku]),
    };
  }

  let cogsTotal = 0;
  for (const part of normalizedSku.split(/[+,]/).map((value) => value.trim()).filter(Boolean)) {
    const normalizedPart = part.replace(/-\d+$/, '');
    const found = indexes.bySku.get(normalizedPart);
    if (found) cogsTotal += Number(found.cogs || 0);
  }

  const nameMatch = indexes.byName.get(normalizeIdentifier(line?.mp_product_name || line?.matched_entity_label || ''));
  if (!cogsTotal && nameMatch?.cogs) {
    cogsTotal = Number(nameMatch.cogs || 0);
  }

  const brand = cleanText(nameMatch?.brand || nameMatch?.product_type)
    || deriveBrandFallback([fallbackStoreName, line?.matched_entity_label, line?.mp_product_name, sku]);

  return {
    cogsTotal,
    brand,
  };
}

function buildUniqueProductName(base: string, sku: string, used: Set<string>): string {
  const fallbackBase = cleanText(base) || cleanText(sku) || 'Unknown Product';
  let candidate = fallbackBase;
  if (!used.has(candidate.toLowerCase())) {
    used.add(candidate.toLowerCase());
    return candidate;
  }

  const skuText = cleanText(sku);
  if (skuText) {
    candidate = `${fallbackBase} (${skuText})`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }

  let counter = 2;
  while (used.has(`${candidate.toLowerCase()} #${counter}`)) {
    counter += 1;
  }
  const finalName = `${candidate} #${counter}`;
  used.add(finalName.toLowerCase());
  return finalName;
}

function resolvePromoteShipping(input: {
  headerRow: ScalevOpsCsvRow;
  intakeOrder: PromoteOrderRow;
  intakeLines: PromoteLineRow[];
  existing: ExistingScalevOrderRow | null;
}): {
  shippingCost: number;
  shippingDiscount: number | null;
  shippingFinancials: MarketplaceIntakeShippingFinancials;
} {
  const projectedShippingCost = parseInteger(input.headerRow.shipping_cost);
  const existingShippingCost = parseNullableAmount(input.existing?.shipping_cost);
  const existingShippingDiscount = parseNullableAmount(input.existing?.shipping_discount);
  const intakeShipping = resolveMarketplaceIntakeShippingFinancials({
    rawMeta: input.intakeOrder.raw_meta,
    rawRows: input.intakeLines.map((line) => line.raw_row || {}),
  });

  const shippingCost = projectedShippingCost > 0
    ? projectedShippingCost
    : intakeShipping.grossPresent
      ? intakeShipping.grossAmount
      : (existingShippingCost || 0);

  let shippingDiscount: number | null = null;
  if (shippingCost === 0) {
    shippingDiscount = 0;
  } else if (intakeShipping.companyDiscountPresent) {
    shippingDiscount = Math.min(intakeShipping.companyDiscountAmount, shippingCost);
  } else if (existingShippingDiscount != null) {
    shippingDiscount = Math.min(existingShippingDiscount, shippingCost);
  }

  return {
    shippingCost,
    shippingDiscount,
    shippingFinancials: {
      ...intakeShipping,
      grossAmount: shippingCost,
      grossPresent: shippingCost > 0 || intakeShipping.grossPresent,
      grossSource: projectedShippingCost > 0 ? 'projection.shipping_cost' : intakeShipping.grossSource,
      companyDiscountAmount: shippingDiscount != null ? Math.min(shippingDiscount, shippingCost) : intakeShipping.companyDiscountAmount,
      companyDiscountPresent: shippingDiscount != null ? true : intakeShipping.companyDiscountPresent,
      companyDiscountSource: shippingDiscount != null && !intakeShipping.companyDiscountPresent
        ? 'existing.shipping_discount'
        : intakeShipping.companyDiscountSource,
    },
  };
}

async function loadPromoteBatch(batchId: number): Promise<PromoteBatchRow> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('marketplace_intake_batches')
    .select('id, source_key, source_label, business_id, business_code, filename')
    .eq('id', batchId)
    .single<PromoteBatchRow>();

  if (error) throw error;
  return data;
}

async function loadPromoteOrdersAndLines(input: {
  batchId: number;
  statuses: string[];
  shipmentDate: string | null;
}) {
  const svc = createServiceSupabase();

  let ordersQuery = svc
    .from('marketplace_intake_orders')
    .select([
      'id',
      'external_order_id',
      'final_store_name',
      'shipment_date',
      'warehouse_status',
      'customer_label',
      'recipient_name',
      'tracking_number',
      'mp_customer_username',
      'mp_order_created_at',
      'mp_payment_paid_at',
      'raw_meta',
    ].join(','))
    .eq('batch_id', input.batchId)
    .order('external_order_id', { ascending: true });

  if (input.statuses.length > 0) {
    ordersQuery = ordersQuery.in('warehouse_status', input.statuses);
  }
  if (input.shipmentDate) {
    ordersQuery = ordersQuery.eq('shipment_date', input.shipmentDate);
  }

  const { data: orders, error: ordersError } = await ordersQuery;
  if (ordersError) throw ordersError;

  const orderIds = (orders || [])
    .map((row: any) => Number(row.id || 0))
    .filter((value) => Number.isFinite(value) && value > 0);

  let linesRes = orderIds.length === 0
    ? { data: [] as PromoteLineRow[], error: null }
    : await svc
        .from('marketplace_intake_order_lines')
        .select([
          'intake_order_id',
          'line_index',
          'mp_product_name',
          'quantity',
          'matched_entity_label',
          'detected_custom_id',
          'normalized_sku',
          'mp_sku',
          'mapped_store_name',
          'raw_row',
        ].join(','))
        .in('intake_order_id', orderIds)
        .order('intake_order_id', { ascending: true })
        .order('line_index', { ascending: true });

  if (linesRes.error && String(linesRes.error?.message || '').toLowerCase().includes('column')) {
    linesRes = await svc
      .from('marketplace_intake_order_lines')
      .select([
        'intake_order_id',
        'line_index',
        'mp_product_name',
        'quantity',
        'matched_entity_label',
        'detected_custom_id',
        'mp_sku',
        'mapped_store_name',
        'raw_row',
      ].join(','))
      .in('intake_order_id', orderIds)
      .order('intake_order_id', { ascending: true })
      .order('line_index', { ascending: true });
  }

  const { data: lines, error: linesError } = linesRes;
  if (linesError) throw linesError;

  const ordersByExternalId = new Map<string, PromoteOrderRow>();
  for (const row of (orders || []) as any[]) {
    const key = cleanText((row as any).external_order_id);
    if (!key) continue;
    ordersByExternalId.set(key, row as PromoteOrderRow);
  }

  const linesByOrderId = new Map<number, PromoteLineRow[]>();
  for (const row of (lines || []) as any[]) {
    const key = Number((row as any).intake_order_id || 0);
    if (!Number.isFinite(key) || key <= 0) continue;
    if (!linesByOrderId.has(key)) linesByOrderId.set(key, []);
    linesByOrderId.get(key)!.push(row as PromoteLineRow);
  }

  return {
    ordersByExternalId,
    linesByOrderId,
  };
}

async function loadExistingScalevOrders(input: {
  externalIds: string[];
  businessCode: string;
  shipmentDate: string | null;
}) {
  const rowsByExternalId = new Map<string, ExistingScalevOrderRow>();
  const rowsByTracking = new Map<string, ExistingScalevOrderRow>();
  if (!input.externalIds.length) {
    return { rowsByExternalId, rowsByTracking };
  }

  const svc = createServiceSupabase();
  for (const chunk of chunkValues(input.externalIds, 25)) {
    const { data, error } = await svc
      .from('scalev_orders')
      .select('id, order_id, external_id, marketplace_tracking_number, source, business_code, scalev_id, shipping_cost, shipping_discount, store_name')
      .eq('business_code', input.businessCode)
      .eq('source', MARKETPLACE_APP_SOURCE)
      .in('external_id', chunk);

    if (error) throw error;

    for (const row of (data || []) as any[]) {
      const externalId = cleanText((row as any).external_id);
      if (!externalId || rowsByExternalId.has(externalId)) continue;
      rowsByExternalId.set(externalId, row as ExistingScalevOrderRow);
    }
  }

  if (!input.shipmentDate) {
    return { rowsByExternalId, rowsByTracking };
  }

  const { dayStart, dayEnd } = buildShipmentDayBounds(input.shipmentDate);

  const { data: webhookRows, error: webhookError } = await svc
    .from('scalev_orders')
    .select('id, order_id, external_id, marketplace_tracking_number, source, business_code, scalev_id, shipping_cost, shipping_discount, store_name, shipped_time')
    .eq('business_code', input.businessCode)
    .eq('source', 'webhook')
    .gte('shipped_time', dayStart)
    .lt('shipped_time', dayEnd)
    .limit(500);
  if (webhookError) throw webhookError;

  for (const row of (webhookRows || []) as any[]) {
    const tracking = extractMarketplaceTrackingFromScalevOrder(row as ExistingScalevOrderRow);
    if (!tracking) continue;
    if (!rowsByTracking.has(tracking)) {
      rowsByTracking.set(tracking, row as ExistingScalevOrderRow);
      continue;
    }
    rowsByTracking.delete(tracking);
  }

  return { rowsByExternalId, rowsByTracking };
}

async function findExistingWebhookOrderByTracking(input: {
  businessCode: string;
  shipmentDate: string;
  trackingNumber: string;
  storeName: string | null;
}) {
  const svc = createServiceSupabase();
  const { dayStart, dayEnd } = buildShipmentDayBounds(input.shipmentDate);

  let query = svc
    .from('scalev_orders')
    .select('id, order_id, external_id, marketplace_tracking_number, source, business_code, scalev_id, shipping_cost, shipping_discount, store_name, shipped_time')
    .eq('business_code', input.businessCode)
    .eq('source', 'webhook')
    .eq('marketplace_tracking_number', input.trackingNumber)
    .gte('shipped_time', dayStart)
    .lt('shipped_time', dayEnd)
    .limit(2);

  const normalizedStoreName = cleanText(input.storeName);
  if (normalizedStoreName) {
    query = query.eq('store_name', normalizedStoreName);
  }

  const { data, error } = await query;
  if (error) throw error;

  const matches = data || [];
  if (matches.length > 1) {
    throw new Error(`Tracking ${input.trackingNumber} cocok ke lebih dari satu webhook row.`);
  }

  return (matches[0] as ExistingScalevOrderRow | undefined) || null;
}

async function loadProductMappings() {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('product_mapping')
    .select('sku, product_name, cogs, brand, product_type');
  if (error) throw error;
  return buildProductMappingIndexes((data || []) as ProductMappingRow[]);
}

async function replaceOrderLines(input: {
  dbOrderId: number;
  orderId: string;
  projectionRows: ScalevOpsCsvRow[];
  intakeLines: PromoteLineRow[];
  fallbackStoreName: string | null;
  mappingIndexes: ReturnType<typeof buildProductMappingIndexes>;
}) {
  const svc = createServiceSupabase();
  await svc.from('scalev_order_lines').delete().eq('scalev_order_id', input.dbOrderId);

  const usedProductNames = new Set<string>();
  const lineRows: Record<string, unknown>[] = [];

  for (const [index, projectionRow] of input.projectionRows.entries()) {
    const intakeLine = input.intakeLines[index] || null;
    const sku = cleanText(projectionRow.sku)
      || cleanText(intakeLine?.detected_custom_id)
      || cleanText(intakeLine?.normalized_sku)
      || cleanText(intakeLine?.mp_sku);
    const quantity = parseInteger(projectionRow.quantity) || Number(intakeLine?.quantity || 0) || 1;
    const price = parseInteger(projectionRow.price);
    const cogsInfo = lookupLineCogsAndBrand(intakeLine, sku, input.mappingIndexes, input.fallbackStoreName);
    const productName = buildUniqueProductName(
      cleanText(intakeLine?.matched_entity_label)
        || cleanText(intakeLine?.mp_product_name)
        || sku,
      sku,
      usedProductNames,
    );

    lineRows.push({
      scalev_order_id: input.dbOrderId,
      order_id: input.orderId,
      product_name: productName,
      product_type: cogsInfo.brand,
      variant_sku: sku || null,
      quantity,
      product_price_bt: calcBeforeTax(price),
      discount_bt: 0,
      cogs_bt: calcBeforeTax((Number(cogsInfo.cogsTotal || 0) || 0) * quantity),
      tax_rate: DEFAULT_TAX_RATE,
      sales_channel: 'Shopee',
      is_purchase_fb: false,
      is_purchase_tiktok: false,
      is_purchase_kwai: false,
      synced_at: new Date().toISOString(),
    });
  }

  if (!lineRows.length) return;

  const { error } = await svc
    .from('scalev_order_lines')
    .upsert(lineRows, { onConflict: 'scalev_order_id,product_name' });

  if (error) throw error;
}

async function persistBatchPromoteResult(batchId: number, payload: Record<string, unknown>) {
  const svc = createServiceSupabase();
  const promoteAuditKeys = new Set([
    'app_last_promote_updated_webhook_count',
    'app_last_promote_updated_authoritative_count',
    'app_last_promote_matched_external_id_count',
    'app_last_promote_matched_tracking_count',
  ]);
  const runUpdate = async (nextPayload: Record<string, unknown>) => svc
    .from('marketplace_intake_batches')
    .update(nextPayload)
    .eq('id', batchId);

  let { error } = await runUpdate(payload);

  if (error) {
    if (isMissingColumnError(error)) {
      const legacyPayload = Object.fromEntries(
        Object.entries(payload).filter(([key]) => !promoteAuditKeys.has(key)),
      );
      ({ error } = await runUpdate(legacyPayload));
      if (!error) return;
      if (isMissingColumnError(error)) return;
    }
    throw error;
  }
}

async function logPromoteSync(input: {
  batch: PromoteBatchRow;
  status: 'success' | 'failed';
  promotedByEmail: string | null;
  orderCount: number;
  errorMessage: string | null;
}) {
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('scalev_sync_log')
    .insert({
      status: input.status,
      sync_type: 'marketplace_intake_app_promote',
      business_code: input.batch.business_code,
      orders_fetched: input.orderCount,
      orders_inserted: 0,
      orders_updated: 0,
      uploaded_by: input.promotedByEmail,
      filename: input.batch.filename,
      error_message: input.errorMessage,
      completed_at: new Date().toISOString(),
    });

  if (error) throw error;
}

export async function promoteMarketplaceIntakeBatchToApp(
  input: MarketplaceIntakePromoteToAppInput,
): Promise<MarketplaceIntakePromoteToAppResult> {
  const batchId = Number(input.batchId || 0);
  if (!Number.isFinite(batchId) || batchId <= 0) {
    throw new Error('batchId tidak valid.');
  }

  const includeWarehouseStatuses = Array.from(new Set(
    (input.includeWarehouseStatuses || ['scheduled'])
      .map((value) => cleanText(value))
      .filter(Boolean),
  ));
  const shipmentDate = cleanText(input.shipmentDate)
    ? normalizeShipmentDate(String(input.shipmentDate))
    : null;

  const batch = await loadPromoteBatch(batchId);
  const projection = await buildScalevOpsProjectionForBatch({
    batchId,
    includeWarehouseStatuses,
    shipmentDate,
  });

  const groupedOrders = groupProjectionRows(projection.rows);
  if (!groupedOrders.length) {
    throw new Error('Batch ini belum memiliki row operasional yang siap dipromosikan ke app.');
  }

  const [{ ordersByExternalId, linesByOrderId }, existingRows, mappingIndexes] = await Promise.all([
    loadPromoteOrdersAndLines({ batchId, statuses: includeWarehouseStatuses, shipmentDate }),
    loadExistingScalevOrders({
      externalIds: groupedOrders.map((row) => row.externalId),
      businessCode: batch.business_code,
      shipmentDate,
    }),
    loadProductMappings(),
  ]);

  const svc = createServiceSupabase();
  const promotedAt = new Date().toISOString();
  let insertedCount = 0;
  let updatedCount = 0;
  let updatedWebhookCount = 0;
  let updatedAuthoritativeCount = 0;
  let matchedExternalIdCount = 0;
  let matchedTrackingCount = 0;
  let skippedCount = 0;

  try {
    for (const group of groupedOrders) {
      const intakeOrder = ordersByExternalId.get(group.externalId);
      if (!intakeOrder) {
        skippedCount += 1;
        continue;
      }

      const headerRow = group.headerRow;
      const targetShipmentDate = normalizeShipmentDate(
        cleanText(intakeOrder.shipment_date)
        || cleanText(headerRow.timestamp)
        || shipmentDate
        || cleanText(projection.batch.sourceOrderDate),
      );
      const trackingNumber = extractMarketplaceTrackingFromProjectionRows(group.rows)
        || normalizeMarketplaceTracking(intakeOrder.tracking_number);
      let matchedBy: 'external_id' | 'tracking' | null = null;
      let existing = existingRows.rowsByExternalId.get(group.externalId) || null;
      if (existing) {
        matchedBy = 'external_id';
      } else if (trackingNumber) {
        existing = existingRows.rowsByTracking.get(trackingNumber) || null;
        if (existing) matchedBy = 'tracking';
      }

      if (!existing && trackingNumber) {
        existing = await findExistingWebhookOrderByTracking({
          businessCode: batch.business_code,
          shipmentDate: targetShipmentDate,
          trackingNumber,
          storeName: cleanText(headerRow.store) || intakeOrder.final_store_name || null,
        });

        if (existing) {
          existingRows.rowsByTracking.set(trackingNumber, existing);
          matchedBy = 'tracking';
        }
      }

      if (!existing) {
        const contextLabel = trackingNumber
          ? `tracking ${trackingNumber}`
          : `external_id ${group.externalId}`;
        throw new Error(
          `Order marketplace ${group.externalId} tidak bisa diikat ke row webhook existing (${contextLabel}). Promote dihentikan untuk mencegah duplicate order.`,
        );
      }

      if (existing && existing.source && existing.source !== MARKETPLACE_APP_SOURCE && existing.source !== 'webhook') {
        skippedCount += 1;
        continue;
      }

      if (matchedBy === 'external_id') matchedExternalIdCount += 1;
      if (matchedBy === 'tracking') matchedTrackingCount += 1;
      if (existing.source === 'webhook') updatedWebhookCount += 1;
      if (existing.source === MARKETPLACE_APP_SOURCE) updatedAuthoritativeCount += 1;

      const orderId = cleanText(existing?.order_id) || group.externalId;
      const shippedTime = buildShipmentTimestamp(targetShipmentDate);
      const totalRevenue = group.rows.reduce((sum, row) => {
        const unitPrice = parseInteger(row.price);
        const quantity = parseInteger(row.quantity) || 1;
        return sum + (unitPrice * quantity);
      }, 0);
      const totalQuantity = group.rows.reduce((sum, row) => sum + parseInteger(row.quantity), 0);
      const intakeLines = linesByOrderId.get(intakeOrder.id) || [];
      const promoteShipping = resolvePromoteShipping({
        headerRow,
        intakeOrder,
        intakeLines,
        existing,
      });
      const shippingCost = promoteShipping.shippingCost;
      const shippingDiscount = promoteShipping.shippingDiscount;
      const projectionRows = group.rows.map((row, index) => (
        index === 0
          ? { ...row, shipping_cost: String(shippingCost) }
          : row
      ));
      const rawData = {
        kind: 'marketplace_intake_promote',
        version: 1,
        promoted_at: promotedAt,
        marketplace_intake_batch_id: batch.id,
        marketplace_intake_order_id: intakeOrder.id,
        source_key: batch.source_key,
        source_label: batch.source_label,
        include_warehouse_statuses: includeWarehouseStatuses,
        shipment_date: targetShipmentDate,
        shipping_cost: shippingCost,
        shipping_discount: shippingDiscount,
        shipping_financials: promoteShipping.shippingFinancials,
        raw_meta: intakeOrder.raw_meta || {},
        projection_rows: projectionRows,
      };
      const orderPayload: Record<string, unknown> = {
        order_id: orderId,
        external_id: group.externalId,
        marketplace_tracking_number: trackingNumber,
        marketplace_intake_batch_id: batch.id,
        marketplace_intake_order_id: intakeOrder.id,
        scalev_id: cleanText(existing?.scalev_id) || null,
        customer_type: null,
        status: 'shipped',
        platform: cleanText(headerRow.platform) || 'shopee',
        store_name: cleanText(headerRow.store) || intakeOrder.final_store_name || null,
        utm_source: null,
        financial_entity: 'shopee',
        payment_method: cleanText(headerRow.payment_method) || 'marketplace',
        unique_code_discount: 0,
        is_purchase_fb: false,
        is_purchase_tiktok: false,
        is_purchase_kwai: false,
        gross_revenue: totalRevenue,
        net_revenue: totalRevenue,
        shipping_cost: shippingCost,
        shipping_discount: shippingDiscount,
        discount_code_discount: null,
        total_quantity: totalQuantity,
        customer_name: cleanText(headerRow.username) || cleanText(headerRow.name) || intakeOrder.recipient_name || intakeOrder.customer_label || null,
        customer_phone: null,
        customer_email: null,
        province: null,
        city: null,
        subdistrict: null,
        handler: null,
        draft_time: intakeOrder.mp_order_created_at || null,
        pending_time: intakeOrder.mp_order_created_at || null,
        confirmed_time: intakeOrder.mp_payment_paid_at || null,
        paid_time: intakeOrder.mp_payment_paid_at || shippedTime,
        shipped_time: shippedTime,
        completed_time: null,
        canceled_time: null,
        source: MARKETPLACE_APP_SOURCE,
        business_code: batch.business_code,
        ...buildScalevSourceClassFields({
          source: MARKETPLACE_APP_SOURCE,
          platform: cleanText(headerRow.platform) || 'shopee',
          externalId: group.externalId,
          financialEntity: 'shopee',
          rawData,
          storeName: cleanText(headerRow.store) || intakeOrder.final_store_name || null,
        }),
        raw_data: rawData,
        synced_at: promotedAt,
      };

      let dbOrderId = Number(existing?.id || 0);
      const { error } = await svc
        .from('scalev_orders')
        .update(orderPayload)
        .eq('id', existing.id);
      if (error) throw error;
      updatedCount += 1;

      existingRows.rowsByExternalId.set(group.externalId, {
        ...existing,
        ...orderPayload,
        id: existing.id,
      } as ExistingScalevOrderRow);
      if (trackingNumber) {
        existingRows.rowsByTracking.set(trackingNumber, {
          ...existing,
          ...orderPayload,
          id: existing.id,
        } as ExistingScalevOrderRow);
      }

      if (!Number.isFinite(dbOrderId) || dbOrderId <= 0) {
        throw new Error(`Order ${group.externalId} gagal mendapatkan id app.`);
      }

      await replaceOrderLines({
        dbOrderId,
        orderId,
        projectionRows,
        intakeLines,
        fallbackStoreName: intakeOrder.final_store_name,
        mappingIndexes,
      });
    }

    await persistBatchPromoteResult(batchId, {
      app_last_promote_status: 'success',
      app_last_promote_at: promotedAt,
      app_last_promote_order_count: groupedOrders.length,
      app_last_promote_inserted_count: insertedCount,
      app_last_promote_updated_count: updatedCount,
      app_last_promote_updated_webhook_count: updatedWebhookCount,
      app_last_promote_updated_authoritative_count: updatedAuthoritativeCount,
      app_last_promote_matched_external_id_count: matchedExternalIdCount,
      app_last_promote_matched_tracking_count: matchedTrackingCount,
      app_last_promote_skipped_count: skippedCount,
      app_last_promote_error: null,
    });

    await logPromoteSync({
      batch,
      status: 'success',
      promotedByEmail: input.promotedByEmail || null,
      orderCount: groupedOrders.length,
      errorMessage: null,
    });

    return {
      batchId: batch.id,
      businessCode: batch.business_code,
      shipmentDate,
      orderCount: groupedOrders.length,
      insertedCount,
      updatedCount,
      updatedWebhookCount,
      updatedAuthoritativeCount,
      matchedExternalIdCount,
      matchedTrackingCount,
      skippedCount,
      promotedAt,
    };
  } catch (error: any) {
    await persistBatchPromoteResult(batchId, {
      app_last_promote_status: 'failed',
      app_last_promote_at: promotedAt,
      app_last_promote_order_count: groupedOrders.length,
      app_last_promote_inserted_count: insertedCount,
      app_last_promote_updated_count: updatedCount,
      app_last_promote_updated_webhook_count: updatedWebhookCount,
      app_last_promote_updated_authoritative_count: updatedAuthoritativeCount,
      app_last_promote_matched_external_id_count: matchedExternalIdCount,
      app_last_promote_matched_tracking_count: matchedTrackingCount,
      app_last_promote_skipped_count: skippedCount,
      app_last_promote_error: error?.message || 'Promosi batch intake ke app gagal.',
    });

    await logPromoteSync({
      batch,
      status: 'failed',
      promotedByEmail: input.promotedByEmail || null,
      orderCount: groupedOrders.length,
      errorMessage: error?.message || 'Promosi batch intake ke app gagal.',
    });

    throw error;
  }
}
