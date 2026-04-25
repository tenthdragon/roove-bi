import { createServiceSupabase } from './service-supabase';
import {
  buildScalevOpsProjectionForBatch,
  type ScalevOpsCsvRow,
} from './marketplace-intake-scalev-export';
import { buildScalevSourceClassFields } from './scalev-source-class';

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
  mp_sku: string | null;
  mapped_store_name: string | null;
  raw_row: Record<string, string> | null;
};

type ExistingScalevOrderRow = {
  id: number;
  order_id: string;
  external_id: string | null;
  source: string | null;
  business_code: string | null;
  scalev_id: string | null;
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

  const { data: lines, error: linesError } = orderIds.length === 0
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
          'mp_sku',
          'mapped_store_name',
          'raw_row',
        ].join(','))
        .in('intake_order_id', orderIds)
        .order('intake_order_id', { ascending: true })
        .order('line_index', { ascending: true });

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

async function loadExistingScalevOrders(externalIds: string[], businessCode: string) {
  if (!externalIds.length) return new Map<string, ExistingScalevOrderRow>();

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_orders')
    .select('id, order_id, external_id, source, business_code, scalev_id')
    .in('external_id', externalIds);

  if (error) throw error;

  const rowsByExternalId = new Map<string, ExistingScalevOrderRow>();
  for (const row of (data || []) as any[]) {
    const externalId = cleanText((row as any).external_id);
    if (!externalId) continue;
    const rowBusinessCode = cleanText((row as any).business_code);
    if (rowBusinessCode && rowBusinessCode !== businessCode) continue;
    const current = rowsByExternalId.get(externalId);
    if (!current) {
      rowsByExternalId.set(externalId, row as ExistingScalevOrderRow);
      continue;
    }
    if (!cleanText(current.business_code) && rowBusinessCode === businessCode) {
      rowsByExternalId.set(externalId, row as ExistingScalevOrderRow);
    }
  }
  return rowsByExternalId;
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
  const { error } = await svc
    .from('marketplace_intake_batches')
    .update(payload)
    .eq('id', batchId);

  if (error) {
    if (isMissingColumnError(error)) return;
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

  const [{ ordersByExternalId, linesByOrderId }, existingByExternalId, mappingIndexes] = await Promise.all([
    loadPromoteOrdersAndLines({ batchId, statuses: includeWarehouseStatuses, shipmentDate }),
    loadExistingScalevOrders(groupedOrders.map((row) => row.externalId), batch.business_code),
    loadProductMappings(),
  ]);

  const svc = createServiceSupabase();
  const promotedAt = new Date().toISOString();
  let insertedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  try {
    for (const group of groupedOrders) {
      const intakeOrder = ordersByExternalId.get(group.externalId);
      if (!intakeOrder) {
        skippedCount += 1;
        continue;
      }

      const existing = existingByExternalId.get(group.externalId) || null;
      const hasWebhookIdentity = Boolean(cleanText(existing?.scalev_id))
        || (existing ? cleanText(existing.order_id) !== group.externalId : false);

      if (existing && existing.source && existing.source !== MARKETPLACE_APP_SOURCE) {
        skippedCount += 1;
        continue;
      }

      if (existing && hasWebhookIdentity) {
        skippedCount += 1;
        continue;
      }

      const headerRow = group.headerRow;
      const orderId = cleanText(existing?.order_id) || group.externalId;
      const targetShipmentDate = normalizeShipmentDate(
        cleanText(intakeOrder.shipment_date)
        || cleanText(headerRow.timestamp)
        || shipmentDate
        || cleanText(projection.batch.sourceOrderDate),
      );
      const shippedTime = buildShipmentTimestamp(targetShipmentDate);
      const totalRevenue = group.rows.reduce((sum, row) => sum + parseInteger(row.price), 0);
      const totalQuantity = group.rows.reduce((sum, row) => sum + parseInteger(row.quantity), 0);
      const orderPayload: Record<string, unknown> = {
        order_id: orderId,
        external_id: group.externalId,
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
        shipping_cost: parseInteger(headerRow.shipping_cost),
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
          rawData: {
            kind: 'marketplace_intake_promote',
            version: 1,
            promoted_at: promotedAt,
            marketplace_intake_batch_id: batch.id,
            marketplace_intake_order_id: intakeOrder.id,
            source_key: batch.source_key,
            source_label: batch.source_label,
            include_warehouse_statuses: includeWarehouseStatuses,
            shipment_date: targetShipmentDate,
            raw_meta: intakeOrder.raw_meta || {},
            projection_rows: group.rows,
          },
          storeName: cleanText(headerRow.store) || intakeOrder.final_store_name || null,
        }),
        raw_data: {
          kind: 'marketplace_intake_promote',
          version: 1,
          promoted_at: promotedAt,
          marketplace_intake_batch_id: batch.id,
          marketplace_intake_order_id: intakeOrder.id,
          source_key: batch.source_key,
          source_label: batch.source_label,
          include_warehouse_statuses: includeWarehouseStatuses,
          shipment_date: targetShipmentDate,
          raw_meta: intakeOrder.raw_meta || {},
          projection_rows: group.rows,
        },
        synced_at: promotedAt,
      };

      let dbOrderId = Number(existing?.id || 0);
      if (existing) {
        const { error } = await svc
          .from('scalev_orders')
          .update(orderPayload)
          .eq('id', existing.id);
        if (error) throw error;
        updatedCount += 1;
      } else {
        const { data, error } = await svc
          .from('scalev_orders')
          .insert(orderPayload)
          .select('id, external_id, order_id, source, business_code, scalev_id')
          .single();
        if (error) throw error;
        dbOrderId = Number((data as any).id || 0);
        existingByExternalId.set(group.externalId, data as ExistingScalevOrderRow);
        insertedCount += 1;
      }

      if (!Number.isFinite(dbOrderId) || dbOrderId <= 0) {
        throw new Error(`Order ${group.externalId} gagal mendapatkan id app.`);
      }

      await replaceOrderLines({
        dbOrderId,
        orderId,
        projectionRows: group.rows,
        intakeLines: linesByOrderId.get(intakeOrder.id) || [],
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
