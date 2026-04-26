import { createServiceSupabase } from './service-supabase';

export const SCALEV_OPS_CSV_HEADERS = [
  'external_id',
  'platform',
  'id',
  'timestamp',
  'store',
  'name',
  'username',
  'phone',
  'email',
  'address',
  'subdistrict',
  'city',
  'payment_method',
  'bank',
  'account_holder',
  'account_number',
  'item_type',
  'sku',
  'price',
  'quantity',
  'shipping_cost',
  'other_income',
  'weight_bump',
  'courier',
  'courier_service',
  'warehouse',
  'shipment_receipt',
  'notes',
] as const;

export type ScalevOpsCsvHeader = (typeof SCALEV_OPS_CSV_HEADERS)[number];

export type ScalevOpsCsvRow = Record<ScalevOpsCsvHeader, string>;

export type ScalevOpsProjectionWarning = {
  externalOrderId: string;
  lineIndex: number | null;
  code: string;
  message: string;
};

type IntakeBatchRow = {
  id: number;
  source_key: string;
  source_label: string;
  business_code: string;
  filename: string;
  source_order_date: string | null;
  raw_snapshot: Record<string, unknown> | null;
};

type IntakeOrderRow = {
  id: number;
  external_order_id: string;
  final_store_name: string | null;
  tracking_number: string | null;
  recipient_name: string | null;
  shipping_provider: string | null;
  delivery_option: string | null;
  shipment_date: string | null;
  warehouse_status: string;
  mp_customer_username: string | null;
  raw_meta: Record<string, unknown> | null;
};

type IntakeLineRow = {
  intake_order_id: number;
  line_index: number;
  matched_entity_type: string | null;
  matched_entity_key: string | null;
  detected_custom_id: string | null;
  normalized_sku?: string | null;
  mp_sku: string | null;
  unit_price: number | null;
  mp_price_after_discount: number | null;
  quantity: number;
  raw_row: Record<string, string> | null;
};

export type ScalevOpsProjectionResult = {
  batch: {
    id: number;
    sourceKey: string;
    sourceLabel: string;
    businessCode: string;
    filename: string;
    sourceOrderDate: string | null;
    rawSnapshot: Record<string, unknown> | null;
  };
  rows: ScalevOpsCsvRow[];
  warnings: ScalevOpsProjectionWarning[];
  csv: string;
};

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function parseLocalizedNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = cleanText(value);
  if (!raw) return 0;
  const normalized = raw.replace(/[^0-9,.-]+/g, '');
  if (!normalized) return 0;
  if (normalized.includes(',') && normalized.includes('.')) {
    return Number(normalized.replace(/\./g, '').replace(',', '.')) || 0;
  }
  if (normalized.includes(',') && !normalized.includes('.')) {
    return Number(normalized.replace(',', '.')) || 0;
  }
  const dotParts = normalized.split('.');
  if (dotParts.length > 2) {
    return Number(dotParts.join('')) || 0;
  }
  if (dotParts.length === 2 && dotParts[1] && dotParts[1].length === 3 && /^\d+$/.test(dotParts[0] || '')) {
    return Number(dotParts.join('')) || 0;
  }
  return Number(normalized) || 0;
}

function formatDate(value: string | null | undefined): string {
  const text = cleanText(value);
  if (!text) return '';
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : text;
}

function formatInteger(value: unknown): string {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0';
  return String(Math.round(num));
}

function escapeCsv(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function metaString(order: IntakeOrderRow, key: string): string {
  return cleanText((order.raw_meta || {})[key]);
}

function rawString(line: IntakeLineRow, key: string): string {
  return cleanText((line.raw_row || {})[key]);
}

function resolveOpsCustomerName(order: IntakeOrderRow): string {
  const username = cleanText(order.mp_customer_username) || metaString(order, 'customerUsername');
  if (username) return username;
  return cleanText(order.recipient_name);
}

function resolveOpsItemType(line: IntakeLineRow): string {
  const entityType = cleanText(line.matched_entity_type || '');
  if (entityType === 'bundle' || entityType === 'variant' || entityType === 'product') {
    return entityType;
  }
  return 'bundle';
}

function resolveOpsSku(line: IntakeLineRow): string {
  const direct = cleanText(line.detected_custom_id);
  if (direct) return direct;
  const entityKey = cleanText(line.matched_entity_key);
  if (entityKey && !entityKey.startsWith('bundle:') && !entityKey.startsWith('variant:') && !entityKey.startsWith('product:')) {
    return entityKey;
  }
  return rawString(line, 'Nomor Referensi SKU')
    || entityKey
    || cleanText(line.normalized_sku)
    || cleanText(line.mp_sku);
}

function resolveOpsPrice(sourceKey: string, line: IntakeLineRow): string {
  if (sourceKey === 'tiktok_rti') {
    const sellerSkuDiscount = parseLocalizedNumber(rawString(line, 'SKU Seller Discount'));
    const tiktokOriginalUnitPrice = parseLocalizedNumber(rawString(line, 'SKU Unit Original Price'));
    const quantity = Math.max(Number(line.quantity || 0), 1);
    const sellerDiscountPerUnit = sellerSkuDiscount > 0 ? sellerSkuDiscount / quantity : 0;
    if (tiktokOriginalUnitPrice > 0) {
      return formatInteger(tiktokOriginalUnitPrice - sellerDiscountPerUnit);
    }
  }

  const price = Number(line.mp_price_after_discount || 0)
    || parseLocalizedNumber(rawString(line, 'Harga Setelah Diskon'))
    || Number(line.unit_price || 0);
  return formatInteger(price);
}

function resolveOpsWarehouse(sourceKey: string, storeName: string | null): string {
  if (sourceKey === 'tiktok_rti') {
    switch (cleanText(storeName)) {
      case 'Purvu The Secret Store - Markerplace':
      case 'Purvu The Secret Store - Marketplace':
      case 'Purvu The Secret Store':
        return "Jejak Herba Nusantara's Warehouse";
      case 'Roove Main Store - Marketplace':
      case 'Globite Store - Marketplace':
      case 'Pluve Main Store - Marketplace':
      case 'Purvu Store - Marketplace':
      case 'YUV Deodorant Serum Store - Marketplace':
      case 'Osgard Oil Store - Marketplace':
      case 'drHyun Main Store - Marketplace':
      case 'Osgard Oil Store':
        return "Roove Lautan Barat's Warehouse";
      default:
        return '';
    }
  }

  if (sourceKey === 'shopee_jhn') {
    switch (cleanText(storeName)) {
      case 'Purvu Store':
      case 'Purvu The Secret Store':
      case 'drHyun Main Store':
      case 'Calmara Main Store':
        return "Jejak Herba Nusantara's Warehouse";
      default:
        return '';
    }
  }

  switch (cleanText(storeName)) {
    case 'Purvu The Secret Store - Markerplace':
      return "Jejak Herba Nusantara's Warehouse";
    case 'Roove Main Store - Marketplace':
    case 'Globite Store - Marketplace':
    case 'Pluve Main Store - Marketplace':
    case 'Purvu Store - Marketplace':
    case 'YUV Deodorant Serum Store - Marketplace':
    case 'Osgard Oil Store':
    case 'drHyun Main Store - Marketplace':
    case 'Calmara Main Store - Marketplace':
      return "Roove Lautan Barat's Warehouse";
    default:
      return '';
  }
}

function resolveOpsCourier(
  sourceKey: string,
  shippingProvider: string | null,
  trackingNumber: string | null,
): { courier: string; courierService: string } {
  if (sourceKey === 'tiktok_rti') {
    return { courier: 'J&T Express Cashless', courierService: 'EZ' };
  }

  const text = cleanText(shippingProvider).toLowerCase();
  const tracking = cleanText(trackingNumber).toUpperCase();

  if (text.includes('jne') || tracking.startsWith('CM')) {
    return { courier: 'JNE Express Cashless', courierService: 'REG' };
  }

  if (sourceKey === 'shopee_rlt' || sourceKey === 'shopee_jhn') {
    return { courier: 'SiCepat Express Cashless', courierService: 'REG' };
  }

  if (text.includes('sicepat')) {
    return { courier: 'SiCepat Express Cashless', courierService: 'REG' };
  }

  if (text.includes('spx') || text.includes('shopee express')) {
    return { courier: 'Shopee Express', courierService: 'REGULER' };
  }

  return {
    courier: cleanText(shippingProvider),
    courierService: '',
  };
}

function resolveOpsPlatform(sourceKey: string): string {
  if (sourceKey === 'tiktok_rti') return 'tiktokshop';
  return 'shopee';
}

function resolveOpsBank(sourceKey: string): string {
  if (sourceKey === 'tiktok_rti') return 'tiktokshop';
  return 'shopee';
}

function buildCsv(rows: ScalevOpsCsvRow[]): string {
  const headerRow = SCALEV_OPS_CSV_HEADERS.join(',');
  const dataRows = rows.map((row) => SCALEV_OPS_CSV_HEADERS
    .map((header) => escapeCsv(cleanText(row[header])))
    .join(','));
  return `${[headerRow, ...dataRows].join('\r\n')}\r\n`;
}

export async function buildScalevOpsProjectionForBatch(input: {
  batchId: number;
  includeWarehouseStatuses?: string[];
  shipmentDate?: string | null;
}): Promise<ScalevOpsProjectionResult> {
  const svc = createServiceSupabase();

  const { data: batch, error: batchError } = await svc
    .from('marketplace_intake_batches')
    .select('id, source_key, source_label, business_code, filename, source_order_date, raw_snapshot')
    .eq('id', input.batchId)
    .single<IntakeBatchRow>();
  if (batchError) throw batchError;

  let ordersQuery = svc
    .from('marketplace_intake_orders')
    .select([
      'id',
      'external_order_id',
      'final_store_name',
      'tracking_number',
      'recipient_name',
      'shipping_provider',
      'delivery_option',
      'shipment_date',
      'warehouse_status',
      'mp_customer_username',
      'raw_meta',
    ].join(','))
    .eq('batch_id', input.batchId)
    .order('external_order_id', { ascending: true });

  const statuses = (input.includeWarehouseStatuses || []).map((value) => cleanText(value)).filter(Boolean);
  if (statuses.length > 0) {
    ordersQuery = ordersQuery.in('warehouse_status', statuses);
  }
  if (cleanText(input.shipmentDate)) {
    ordersQuery = ordersQuery.eq('shipment_date', cleanText(input.shipmentDate));
  }

  const { data: orders, error: ordersError } = await ordersQuery;
  if (ordersError) throw ordersError;

  const orderIds = (orders || []).map((row: any) => Number(row.id)).filter((id) => Number.isFinite(id));
  let linesRes = orderIds.length === 0
    ? { data: [] as IntakeLineRow[], error: null }
    : await svc
        .from('marketplace_intake_order_lines')
        .select([
          'intake_order_id',
          'line_index',
          'matched_entity_type',
          'matched_entity_key',
          'detected_custom_id',
          'normalized_sku',
          'mp_sku',
          'unit_price',
          'mp_price_after_discount',
          'quantity',
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
        'matched_entity_type',
        'matched_entity_key',
        'detected_custom_id',
        'mp_sku',
        'unit_price',
        'mp_price_after_discount',
        'quantity',
        'raw_row',
      ].join(','))
      .in('intake_order_id', orderIds)
      .order('intake_order_id', { ascending: true })
      .order('line_index', { ascending: true });
  }
  const { data: lines, error: linesError } = linesRes;
  if (linesError) throw linesError;

  const linesByOrderId = new Map<number, IntakeLineRow[]>();
  for (const rawLine of (lines || []) as any[]) {
    const orderId = Number(rawLine.intake_order_id);
    if (!linesByOrderId.has(orderId)) linesByOrderId.set(orderId, []);
    linesByOrderId.get(orderId)!.push(rawLine as IntakeLineRow);
  }

  const warnings: ScalevOpsProjectionWarning[] = [];
  const rows: ScalevOpsCsvRow[] = [];
  let rowNumber = 1;

  for (const rawOrder of (orders || []) as any[]) {
    const order = rawOrder as IntakeOrderRow;
    const orderLines = (linesByOrderId.get(Number(order.id)) || []).slice().sort((left, right) => left.line_index - right.line_index);
    if (orderLines.length === 0) {
      warnings.push({
        externalOrderId: order.external_order_id,
        lineIndex: null,
        code: 'missing_lines',
        message: 'Order intake tidak memiliki line item untuk dibentuk ke format Scalev.',
      });
      continue;
    }

    const timestamp = formatDate(order.shipment_date) || formatDate(batch.source_order_date);
    const customerName = resolveOpsCustomerName(order);
    const { courier, courierService } = resolveOpsCourier(batch.source_key, order.shipping_provider, order.tracking_number);
    const warehouse = resolveOpsWarehouse(batch.source_key, order.final_store_name);

    if (!cleanText(order.final_store_name)) {
      warnings.push({
        externalOrderId: order.external_order_id,
        lineIndex: null,
        code: 'missing_store',
        message: 'Order belum memiliki final_store_name untuk formatter Scalev.',
      });
    }
    if (!timestamp) {
      warnings.push({
        externalOrderId: order.external_order_id,
        lineIndex: null,
        code: 'missing_timestamp',
        message: 'Order belum punya shipment_date dan batch juga belum punya source_order_date.',
      });
    }

    for (const [index, line] of orderLines.entries()) {
      const sku = resolveOpsSku(line);
      if (!sku) {
        warnings.push({
          externalOrderId: order.external_order_id,
          lineIndex: line.line_index,
          code: 'missing_sku',
          message: 'Line belum memiliki SKU/custom_id export untuk Scalev.',
        });
      }

      rows.push({
        external_id: index === 0 ? order.external_order_id : '',
        platform: index === 0 ? resolveOpsPlatform(batch.source_key) : '',
        id: String(rowNumber),
        timestamp: index === 0 ? timestamp : '',
        store: index === 0 ? cleanText(order.final_store_name) : '',
        name: index === 0 ? customerName : '',
        username: index === 0 ? (cleanText(order.mp_customer_username) || metaString(order, 'customerUsername')) : '',
        phone: '',
        email: '',
        address: '',
        subdistrict: '',
        city: '',
        payment_method: index === 0 ? 'marketplace' : '',
        bank: index === 0 ? resolveOpsBank(batch.source_key) : '',
        account_holder: '',
        account_number: '',
        item_type: resolveOpsItemType(line),
        sku,
        price: resolveOpsPrice(batch.source_key, line),
        quantity: formatInteger(line.quantity),
        shipping_cost: '0',
        other_income: '0',
        weight_bump: '0',
        courier: index === 0 ? courier : '',
        courier_service: index === 0 ? courierService : '',
        warehouse: index === 0 ? warehouse : '',
        shipment_receipt: index === 0 ? cleanText(order.tracking_number) : '',
        notes: '',
      });
      rowNumber += 1;
    }
  }

  return {
    batch: {
      id: batch.id,
      sourceKey: batch.source_key,
      sourceLabel: batch.source_label,
      businessCode: batch.business_code,
      filename: batch.filename,
      sourceOrderDate: batch.source_order_date,
      rawSnapshot: batch.raw_snapshot || null,
    },
    rows,
    warnings,
    csv: buildCsv(rows),
  };
}
