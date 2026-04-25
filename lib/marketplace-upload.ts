import * as XLSX from 'xlsx';
import util from 'node:util';
import { createServiceSupabase } from './service-supabase';
import { fetchStoreList } from './scalev-api';
import { buildScalevSourceClassFields } from './scalev-source-class';

const SCALEV_BASE_URL = 'https://api.scalev.id/v2';
const MARKETPLACE_API_SOURCE = 'marketplace_api_upload';
const MARKETPLACE_API_SYNC_TYPE = 'marketplace_api_upload';
const PHYSICAL_PAYMENT_METHOD = 'marketplace';
const SCALEV_FALLBACK_CUSTOMER_PHONE = '6281234567890';

type MarketplacePlatform = 'tiktok' | 'shopee' | 'lazada';

type SheetRow = Record<string, unknown>;

type CanonicalLine = {
  sku: string | null;
  productName: string;
  variation: string | null;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  lineDiscount: number;
  weightGrams: number | null;
  rawRow: Record<string, string>;
};

type CanonicalOrder = {
  platform: MarketplacePlatform;
  externalId: string;
  status: string | null;
  substatus: string | null;
  paymentMethodLabel: string | null;
  createdAt: string | null;
  paidAt: string | null;
  rtsAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  canceledAt: string | null;
  trackingNumber: string | null;
  shippingProvider: string | null;
  deliveryOption: string | null;
  customerUsername: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  postalCode: string | null;
  country: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  village: string | null;
  address: string | null;
  addressNotes: string | null;
  rawAddress: string | null;
  shippingCost: number;
  orderAmount: number;
  totalWeightGrams: number | null;
  lines: CanonicalLine[];
  rawMeta: Record<string, string>;
};

type BusinessRow = {
  id: number;
  business_code: string;
  business_name: string;
  api_key: string;
  tax_rate_name: string | null;
};

type StoreChannelRow = {
  id: number;
  business_id: number;
  store_name: string;
  store_type: string;
  channel_override: string | null;
  scalev_store_id: number | null;
  store_unique_id: string | null;
};

type CatalogIdentifierRow = {
  business_id: number;
  business_code: string;
  entity_type: 'product' | 'variant' | 'bundle';
  entity_key: string;
  entity_label: string;
  scalev_product_id: number | null;
  scalev_variant_id: number | null;
  scalev_bundle_id: number | null;
  identifier: string;
  identifier_normalized: string;
  source: string;
};

type CatalogVariantRow = {
  business_id: number;
  scalev_product_id: number;
  scalev_variant_id: number;
  scalev_variant_unique_id: string | null;
  sku: string | null;
  name: string;
  product_name: string | null;
};

type ExistingOrderRow = {
  id: number;
  order_id: string;
  external_id: string | null;
  source: string | null;
  business_code: string | null;
  store_name?: string | null;
};

type ProductMappingRow = {
  sku: string | null;
  product_name: string | null;
  cogs: number | null;
  brand: string | null;
  product_type: string | null;
};

type ResolvedLine = {
  line: CanonicalLine;
  identifier: CatalogIdentifierRow;
  priority: number;
};

type LiveStore = {
  id: number;
  name: string;
  unique_id: string;
  uuid: string;
};

type ResolvedStore = {
  row: StoreChannelRow;
  live: LiveStore;
  score: number;
};

type LocationRow = {
  id: number;
  subdistrict_name: string | null;
  city_name: string | null;
  province_name: string | null;
  display: string | null;
};

type BundlePriceOption = {
  id: number;
  unique_id: string;
  name: string | null;
  slug: string | null;
  price: string | null;
};

type BundleDetailRow = {
  id: number;
  custom_id: string | null;
  weight_bump: number | null;
  bundle_price_options: BundlePriceOption[];
  bundlelines: Array<{
    quantity: number;
    variant: {
      id: number;
      unique_id: string | null;
      sku: string | null;
      weight: number | null;
      item_type: string | null;
      product_name: string | null;
      name: string | null;
    };
  }>;
};

type SearchWarehouseResult = {
  warehouse: {
    id: number;
    unique_id: string;
    name: string;
  };
};

type SearchCourierServiceResult = {
  courier_service: {
    id: number;
    name: string | null;
    code: string | null;
    courier: {
      id: number;
      name: string | null;
      code: string | null;
      courier_type: string | null;
    };
  };
  cost: number | null;
  shipment_provider_code: string | null;
  is_cod: boolean | null;
  is_pickup: boolean | null;
};

type ScalevCreatePayload = Record<string, unknown>;

type ScalevCreateResponse = Record<string, any>;

type ImportStats = {
  totalRows: number;
  totalOrders: number;
  newInserted: number;
  updated: number;
  errors: string[];
  skipped: number;
  lineItems: number;
  scalevCreated: number;
  format: string;
};

type ImportResult = {
  success: boolean;
  filename: string;
  stats: {
    totalRows: number;
    totalOrders: number;
    newInserted: number;
    updated: number;
    errors: number;
    errorDetails: string[];
    skipped: number;
    lineItems: number;
    scalevCreated: number;
    format: string;
  };
  message: string;
};

export type SingleMarketplaceOrderImportResult = {
  externalId: string;
  businessCode: string;
  storeName: string;
  localState: 'inserted' | 'updated';
  scalevOrderId: string | null;
  scalevId: string | null;
  responseStatus: string | null;
};

type ImportContext = {
  svc: ReturnType<typeof createServiceSupabase>;
  businesses: BusinessRow[];
  businessById: Map<number, BusinessRow>;
  storesByBusinessId: Map<number, StoreChannelRow[]>;
  identifiersByBusinessId: Map<number, Map<string, CatalogIdentifierRow[]>>;
  existingByExternalId: Map<string, ExistingOrderRow>;
  productMappings: ProductMappingRow[];
  storeUsageCache: Map<string, number>;
  liveStoreCache: Map<number, LiveStore[]>;
  bundleDetailCache: Map<string, BundleDetailRow>;
  locationSearchCache: Map<string, LocationRow[]>;
  variantCache: Map<string, CatalogVariantRow | null>;
  bundleIdentifiersCache: Map<string, CatalogIdentifierRow[]>;
};

type IntakeOrderCreateRow = {
  id: number;
  external_order_id: string;
  recipient_name: string | null;
  customer_label: string | null;
  tracking_number: string | null;
  payment_method_label: string | null;
  shipping_provider: string | null;
  delivery_option: string | null;
  order_amount: number | null;
  raw_meta: Record<string, unknown> | null;
  mp_order_status: string | null;
  mp_cancel_return_status: string | null;
  mp_order_created_at: string | null;
  mp_payment_paid_at: string | null;
  mp_ready_to_ship_at: string | null;
  mp_order_completed_at: string | null;
  mp_customer_username: string | null;
  mp_customer_phone: string | null;
  mp_shipping_address: string | null;
  mp_shipping_district: string | null;
  mp_shipping_city: string | null;
  mp_shipping_province: string | null;
  mp_shipping_postal_code: string | null;
  mp_raw_shipping_address: string | null;
  mp_buyer_note: string | null;
  mp_shipping_cost_buyer: number | null;
  mp_estimated_shipping_cost: number | null;
};

type IntakeLineCreateRow = {
  intake_order_id: number;
  mp_sku: string | null;
  mp_product_name: string;
  mp_variation: string | null;
  quantity: number;
  unit_price: number | null;
  line_subtotal: number | null;
  line_discount: number | null;
  mp_price_after_discount: number | null;
  raw_row: Record<string, string> | null;
};

function cleanText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeIdentifier(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeLoose(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '')
    .replace(/[^0-9,.-]+/g, '')
    .replace(/\.(?=.*\.)/g, '')
    .replace(/,(\d{2})$/, '.$1')
    .replace(/,/g, '');
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseInteger(value: unknown): number {
  const parsed = Number(String(value ?? '').replace(/[^\d-]+/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseWeightGrams(value: unknown): number | null {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (/kg/.test(text)) {
    const amount = parseNumber(text);
    return amount > 0 ? Math.round(amount * 1000) : null;
  }
  if (/gr|gram/.test(text)) {
    const amount = parseNumber(text);
    return amount > 0 ? Math.round(amount) : null;
  }
  const numeric = parseNumber(text);
  if (numeric <= 0) return null;
  return numeric < 20 ? Math.round(numeric * 1000) : Math.round(numeric);
}

function parseDateTime(value: unknown): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const normalized = text
    .replace(/\./g, ':')
    .replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizePhone(value: string | null): string | null {
  const digits = String(value || '').replace(/[^\d]+/g, '');
  if (!digits) return null;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

function normalizeScalevCustomerPhone(value: string | null): string {
  const normalized = normalizePhone(value);
  if (normalized && normalized.length >= 10 && normalized.length <= 15) return normalized;
  return SCALEV_FALLBACK_CUSTOMER_PHONE;
}

function toRawStringRow(row: SheetRow): Record<string, string> {
  const entries = Object.entries(row).map(([key, value]) => [key, String(value ?? '').trim()]);
  return Object.fromEntries(entries);
}

function detectWorkbookFormat(headers: string[]): MarketplacePlatform {
  const headerSet = new Set(headers);
  if (headerSet.has('Order ID')) return 'tiktok';
  if (headerSet.has('No. Pesanan')) return 'shopee';
  if (headerSet.has('orderNumber')) return 'lazada';
  throw new Error('Format marketplace tidak dikenali. Gunakan export TikTok, Shopee/SPX, atau Lazada.');
}

function isBlankRow(row: Record<string, string>): boolean {
  return Object.values(row).every((value) => !cleanText(value));
}

function shouldSkipOrderStatus(status: string | null): boolean {
  const normalized = normalizeIdentifier(status);
  return normalized.includes('cancel')
    || normalized.includes('return')
    || normalized.includes('refund')
    || normalized.includes('pengembalian')
    || normalized.includes('pembatalan')
    || normalized.includes('selesai')
    || normalized.includes('completed')
    || normalized.includes('delivered');
}

function salesChannelForPlatform(platform: MarketplacePlatform): string {
  if (platform === 'tiktok') return 'TikTok Shop';
  if (platform === 'lazada') return 'Lazada';
  return 'Shopee';
}

function platformSlug(platform: MarketplacePlatform): string {
  if (platform === 'tiktok') return 'tiktokshop';
  return platform;
}

function brandTokensForOrder(order: CanonicalOrder): string[] {
  const text = [
    order.rawMeta.WarehouseName,
    order.rawMeta.StoreName,
    ...order.lines.map((line) => line.sku || ''),
    ...order.lines.map((line) => line.productName),
  ].join(' ');
  const normalized = normalizeIdentifier(text);
  const tokens = new Set<string>();
  if (normalized.includes('purvu')) tokens.add('purvu');
  if (normalized.includes('secret')) tokens.add('secret');
  if (normalized.includes('roove')) tokens.add('roove');
  if (normalized.includes('osgard')) tokens.add('osgard');
  if (normalized.includes('globite')) tokens.add('globite');
  if (normalized.includes('pluve')) tokens.add('pluve');
  if (normalized.includes('drhyun') || normalized.includes('dr hyun')) tokens.add('drhyun');
  if (normalized.includes('calmara')) tokens.add('calmara');
  if (normalized.includes('almona')) tokens.add('almona');
  if (normalized.includes('yuv')) tokens.add('yuv');
  if (normalized.includes('veminine')) tokens.add('veminine');
  if (normalized.includes('orelif')) tokens.add('orelif');
  return Array.from(tokens);
}

function priceTokenFromSku(value: string | null): string | null {
  const text = String(value || '').trim();
  const match = text.match(/-([0-9]{2,5})$/);
  return match ? match[1] : null;
}

function aggregateCanonicalLines(lines: CanonicalLine[]): CanonicalLine[] {
  const grouped = new Map<string, CanonicalLine>();
  for (const line of lines) {
    const key = [
      normalizeIdentifier(line.sku),
      normalizeIdentifier(line.productName),
      normalizeIdentifier(line.variation),
    ].join('|');
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...line });
      continue;
    }
    existing.quantity += line.quantity;
    existing.lineSubtotal += line.lineSubtotal;
    existing.lineDiscount += line.lineDiscount;
    existing.unitPrice = existing.quantity > 0 ? existing.lineSubtotal / existing.quantity : existing.unitPrice;
    if (!existing.weightGrams && line.weightGrams) existing.weightGrams = line.weightGrams;
  }
  return Array.from(grouped.values());
}

function parseTikTokOrders(rows: Record<string, string>[]): CanonicalOrder[] {
  const orders = new Map<string, CanonicalOrder>();

  for (const row of rows) {
    const externalId = cleanText(row['Order ID']);
    if (!externalId || String(externalId).toLowerCase().includes('platform unique')) continue;

    const existing = orders.get(externalId);
    const line: CanonicalLine = {
      sku: cleanText(row['Seller SKU']) || cleanText(row['SKU ID']),
      productName: cleanText(row['Product Name']) || cleanText(row['Variation']) || 'Produk Marketplace',
      variation: cleanText(row['Variation']),
      quantity: Math.max(parseInteger(row.Quantity) || 1, 1),
      unitPrice: parseNumber(row['SKU Subtotal After Discount']) > 0 && (parseInteger(row.Quantity) || 0) > 0
        ? parseNumber(row['SKU Subtotal After Discount']) / Math.max(parseInteger(row.Quantity), 1)
        : parseNumber(row['SKU Unit Original Price']),
      lineSubtotal: parseNumber(row['SKU Subtotal After Discount']) || parseNumber(row['SKU Subtotal Before Discount']),
      lineDiscount: parseNumber(row['SKU Platform Discount']) + parseNumber(row['SKU Seller Discount']),
      weightGrams: parseWeightGrams(row['Weight(kg)']),
      rawRow: row,
    };

    if (existing) {
      existing.lines.push(line);
      existing.totalWeightGrams = existing.totalWeightGrams || line.weightGrams;
      continue;
    }

    orders.set(externalId, {
      platform: 'tiktok',
      externalId,
      status: cleanText(row['Order Status']),
      substatus: cleanText(row['Order Substatus']),
      paymentMethodLabel: cleanText(row['Payment Method']),
      createdAt: parseDateTime(row['Created Time']),
      paidAt: parseDateTime(row['Paid Time']),
      rtsAt: parseDateTime(row['RTS Time']),
      shippedAt: parseDateTime(row['Shipped Time']),
      deliveredAt: parseDateTime(row['Delivered Time']),
      canceledAt: parseDateTime(row['Cancelled Time']),
      trackingNumber: cleanText(row['Tracking ID']),
      shippingProvider: cleanText(row['Shipping Provider Name']),
      deliveryOption: cleanText(row['Delivery Option']),
      customerUsername: cleanText(row['Buyer Username']),
      customerName: cleanText(row.Recipient) || cleanText(row['Buyer Username']),
      customerPhone: normalizePhone(cleanText(row['Phone #'])),
      customerEmail: null,
      postalCode: cleanText(row.Zipcode),
      country: cleanText(row.Country),
      province: cleanText(row.Province),
      city: cleanText(row['Regency and City']),
      district: cleanText(row.Districts),
      village: cleanText(row.Villages),
      address: cleanText(row['Detail Address']),
      addressNotes: cleanText(row['Additional address information']),
      rawAddress: [row['Detail Address'], row['Additional address information']].filter((value) => cleanText(value)).join(', ') || null,
      shippingCost: parseNumber(row['Shipping Fee After Discount']),
      orderAmount: parseNumber(row['Order Amount']),
      totalWeightGrams: parseWeightGrams(row['Weight(kg)']),
      lines: [line],
      rawMeta: {
        WarehouseName: cleanText(row['Warehouse Name']) || '',
        StoreName: cleanText(row['Warehouse Name']) || '',
      },
    });
  }

  return Array.from(orders.values()).map((order) => ({
    ...order,
    lines: aggregateCanonicalLines(order.lines),
  }));
}

function parseShopeeAddress(rawAddress: string | null, city: string | null, province: string | null): {
  address: string | null;
  district: string | null;
  postalCode: string | null;
} {
  const raw = cleanText(rawAddress);
  if (!raw) return { address: null, district: null, postalCode: null };
  const parts = raw.split(',').map((part) => cleanText(part)).filter((part): part is string => Boolean(part));
  const postalCode = parts.find((part) => /^\d{5}$/.test(part)) || null;
  const cityIndex = city ? parts.findIndex((part) => normalizeLoose(part) === normalizeLoose(city)) : -1;
  const provinceIndex = province ? parts.findIndex((part) => normalizeLoose(part) === normalizeLoose(province)) : -1;
  const districtIndex = provinceIndex > 0 ? provinceIndex - 1 : cityIndex > 0 ? cityIndex + 1 : -1;
  const district = districtIndex >= 0 && districtIndex < parts.length ? parts[districtIndex] : null;

  const addressParts = parts.filter((part, index) => {
    if (postalCode && part === postalCode) return false;
    if (cityIndex >= 0 && index === cityIndex) return false;
    if (provinceIndex >= 0 && index === provinceIndex) return false;
    if (districtIndex >= 0 && index === districtIndex) return false;
    if (part.toLowerCase() === 'id') return false;
    return true;
  });

  return {
    address: addressParts.join(', ') || raw,
    district,
    postalCode,
  };
}

function parseShopeeOrders(rows: Record<string, string>[]): CanonicalOrder[] {
  const orders = new Map<string, CanonicalOrder>();

  for (const row of rows) {
    const externalId = cleanText(row['No. Pesanan']);
    if (!externalId) continue;

    const city = cleanText(row['Kota/Kabupaten']);
    const province = cleanText(row.Provinsi);
    const parsedAddress = parseShopeeAddress(cleanText(row['Alamat Pengiriman']), city, province);
    const existing = orders.get(externalId);
    const line: CanonicalLine = {
      sku: cleanText(row['Nomor Referensi SKU']) || cleanText(row['SKU Induk']),
      productName: cleanText(row['Nama Produk']) || 'Produk Marketplace',
      variation: cleanText(row['Nama Variasi']),
      quantity: Math.max(parseInteger(row.Jumlah) || 1, 1),
      unitPrice: parseNumber(row['Harga Setelah Diskon']) || parseNumber(row['Harga Awal']),
      lineSubtotal: (parseNumber(row['Harga Setelah Diskon']) || parseNumber(row['Harga Awal'])) * Math.max(parseInteger(row.Jumlah) || 1, 1),
      lineDiscount: parseNumber(row['Diskon Dari Penjual']) + parseNumber(row['Diskon Dari Shopee']),
      weightGrams: parseWeightGrams(row['Total Berat']) || parseWeightGrams(row['Berat Produk']),
      rawRow: row,
    };

    if (existing) {
      existing.lines.push(line);
      existing.totalWeightGrams = existing.totalWeightGrams || line.weightGrams;
      continue;
    }

    orders.set(externalId, {
      platform: 'shopee',
      externalId,
      status: cleanText(row['Status Pesanan']),
      substatus: cleanText(row['Status Pembatalan/ Pengembalian']),
      paymentMethodLabel: cleanText(row['Metode Pembayaran']),
      createdAt: parseDateTime(row['Waktu Pesanan Dibuat']),
      paidAt: parseDateTime(row['Waktu Pembayaran Dilakukan']),
      rtsAt: parseDateTime(row['Waktu Pengiriman Diatur']),
      shippedAt: null,
      deliveredAt: parseDateTime(row['Waktu Pesanan Selesai']),
      canceledAt: null,
      trackingNumber: cleanText(row['No. Resi']),
      shippingProvider: cleanText(row['Opsi Pengiriman']),
      deliveryOption: cleanText(row['Antar ke counter/ pick-up']),
      customerUsername: cleanText(row['Username (Pembeli)']),
      customerName: cleanText(row['Nama Penerima']) || cleanText(row['Username (Pembeli)']),
      customerPhone: normalizePhone(cleanText(row['No. Telepon'])),
      customerEmail: null,
      postalCode: parsedAddress.postalCode,
      country: 'Indonesia',
      province,
      city,
      district: parsedAddress.district,
      village: null,
      address: parsedAddress.address,
      addressNotes: cleanText(row.Catatan) || cleanText(row['Catatan dari Pembeli']),
      rawAddress: cleanText(row['Alamat Pengiriman']),
      shippingCost: parseNumber(row['Ongkos Kirim Dibayar oleh Pembeli']) || parseNumber(row['Perkiraan Ongkos Kirim']),
      orderAmount: parseNumber(row['Total Pembayaran']) || parseNumber(row['Dibayar Pembeli']),
      totalWeightGrams: parseWeightGrams(row['Total Berat']) || parseWeightGrams(row['Berat Produk']),
      lines: [line],
      rawMeta: {
        WarehouseName: '',
        StoreName: '',
      },
    });
  }

  return Array.from(orders.values()).map((order) => ({
    ...order,
    lines: aggregateCanonicalLines(order.lines),
  }));
}

function parseLazadaOrders(rows: Record<string, string>[]): CanonicalOrder[] {
  const orders = new Map<string, CanonicalOrder>();

  for (const row of rows) {
    const externalId = cleanText(row.orderNumber);
    if (!externalId) continue;
    const existing = orders.get(externalId);
    const line: CanonicalLine = {
      sku: cleanText(row.sellerSku) || cleanText(row.lazadaSku),
      productName: cleanText(row.itemName) || 'Produk Marketplace',
      variation: cleanText(row.variation),
      quantity: 1,
      unitPrice: parseNumber(row.unitPrice),
      lineSubtotal: parseNumber(row.paidPrice) || parseNumber(row.unitPrice),
      lineDiscount: parseNumber(row.sellerDiscountTotal) + parseNumber(row.bundleDiscount),
      weightGrams: null,
      rawRow: row,
    };

    if (existing) {
      existing.lines.push(line);
      continue;
    }

    const addressParts = [
      cleanText(row.shippingAddress),
      cleanText(row.shippingAddress2),
      cleanText(row.shippingAddress3),
      cleanText(row.shippingAddress4),
      cleanText(row.shippingAddress5),
    ].filter((part): part is string => Boolean(part));

    orders.set(externalId, {
      platform: 'lazada',
      externalId,
      status: cleanText(row.status),
      substatus: cleanText(row.buyerFailedDeliveryReason),
      paymentMethodLabel: cleanText(row.payMethod),
      createdAt: parseDateTime(row.createTime),
      paidAt: parseDateTime(row.createTime),
      rtsAt: parseDateTime(row.updateTime),
      shippedAt: null,
      deliveredAt: parseDateTime(row.deliveredDate),
      canceledAt: null,
      trackingNumber: cleanText(row.trackingCode),
      shippingProvider: cleanText(row.shippingProvider) || cleanText(row.shippingProviderFM),
      deliveryOption: cleanText(row.shipmentTypeName) || cleanText(row.deliveryType),
      customerUsername: cleanText(row.customerName),
      customerName: cleanText(row.shippingName) || cleanText(row.customerName),
      customerPhone: normalizePhone(cleanText(row.shippingPhone) || cleanText(row.shippingPhone2)),
      customerEmail: cleanText(row.customerEmail),
      postalCode: cleanText(row.shippingPostCode),
      country: cleanText(row.shippingCountry),
      province: cleanText(row.shippingRegion) || cleanText(row.shippingAddress5),
      city: cleanText(row.shippingCity),
      district: cleanText(row.shippingAddress4),
      village: cleanText(row.shippingAddress3),
      address: cleanText(row.shippingAddress),
      addressNotes: cleanText(row.sellerNote),
      rawAddress: addressParts.join(', ') || null,
      shippingCost: parseNumber(row.shippingFee),
      orderAmount: parseNumber(row.paidPrice) || parseNumber(row.unitPrice),
      totalWeightGrams: null,
      lines: [line],
      rawMeta: {
        WarehouseName: cleanText(row.wareHouse) || '',
        StoreName: cleanText(row.wareHouse) || '',
      },
    });
  }

  return Array.from(orders.values()).map((order) => ({
    ...order,
    lines: aggregateCanonicalLines(order.lines),
  }));
}

async function parseMarketplaceWorkbook(file: File): Promise<{ orders: CanonicalOrder[]; rowCount: number; platform: MarketplacePlatform }> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Workbook tidak memiliki sheet yang bisa dibaca.');
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: '' });
  if (rawRows.length === 0) throw new Error('Workbook kosong.');

  const stringRows = rawRows
    .map((row) => toRawStringRow(row))
    .filter((row) => !isBlankRow(row));
  if (stringRows.length === 0) throw new Error('Workbook tidak memiliki baris data.');

  const platform = detectWorkbookFormat(Object.keys(stringRows[0]));
  const orders = platform === 'tiktok'
    ? parseTikTokOrders(stringRows)
    : platform === 'shopee'
      ? parseShopeeOrders(stringRows)
      : parseLazadaOrders(stringRows);

  return { orders, rowCount: stringRows.length, platform };
}

function getIdentifierSourcePriority(source: string, mode: 'variant_sku' | 'product_name'): number {
  if (mode === 'variant_sku') {
    if (source === 'variant.unique_id') return 100;
    if (source === 'bundle.price_option_unique_id') return 96;
    if (source === 'bundle.price_option_slug') return 94;
    if (source === 'bundle.custom_id') return 92;
    if (source === 'variant.sku') return 90;
    if (source === 'variant.uuid') return 80;
    return 20;
  }

  if (source === 'bundle.custom_id') return 99;
  if (source === 'bundle.price_option_unique_id') return 97;
  if (source === 'bundle.price_option_slug') return 95;
  if (source === 'bundle.display') return 93;
  if (source === 'bundle.public_name') return 91;
  if (source === 'bundle.name') return 89;
  if (source === 'variant.name') return 90;
  if (source === 'product.display') return 80;
  if (source === 'product.public_name') return 75;
  if (source === 'product.name') return 70;
  if (source === 'variant.product_name') return 55;
  if (source === 'product.slug') return 35;
  return 20;
}

function buildIdentifierLookupMap(rows: CatalogIdentifierRow[]): Map<number, Map<string, CatalogIdentifierRow[]>> {
  const byBusinessId = new Map<number, Map<string, CatalogIdentifierRow[]>>();

  for (const row of rows) {
    if (!byBusinessId.has(row.business_id)) {
      byBusinessId.set(row.business_id, new Map<string, CatalogIdentifierRow[]>());
    }
    const identifierMap = byBusinessId.get(row.business_id)!;
    const keys = Array.from(new Set([
      row.identifier_normalized,
      normalizeIdentifier(row.identifier),
    ].filter(Boolean)));

    for (const key of keys) {
      if (!identifierMap.has(key)) identifierMap.set(key, []);
      identifierMap.get(key)!.push(row);
    }
  }

  return byBusinessId;
}

async function loadImportContext(
  svc: ReturnType<typeof createServiceSupabase>,
  orders: CanonicalOrder[],
): Promise<ImportContext> {
  const identifierCandidates = Array.from(new Set(
    orders.flatMap((order) => order.lines.flatMap((line) => [
      normalizeIdentifier(line.sku),
      normalizeIdentifier(line.productName),
      normalizeIdentifier(line.variation),
    ])).filter(Boolean),
  ));

  const externalIds = orders.map((order) => order.externalId);

  const [businessesRes, identifiersRes, existingRes, productMappingsRes] = await Promise.all([
    svc
      .from('scalev_webhook_businesses')
      .select('id, business_code, business_name, api_key, tax_rate_name')
      .eq('is_active', true)
      .not('api_key', 'is', null),
    identifierCandidates.length > 0
      ? svc
          .from('scalev_catalog_identifiers')
          .select(`
            business_id,
            business_code,
            entity_type,
            entity_key,
            entity_label,
            scalev_product_id,
            scalev_variant_id,
            scalev_bundle_id,
            identifier,
            identifier_normalized,
            source
          `)
          .in('identifier_normalized', identifierCandidates)
      : Promise.resolve({ data: [], error: null }),
    externalIds.length > 0
      ? svc
          .from('scalev_orders')
          .select('id, order_id, external_id, source, business_code, store_name')
          .in('external_id', externalIds)
      : Promise.resolve({ data: [], error: null }),
    svc
      .from('product_mapping')
      .select('sku, product_name, cogs, brand, product_type'),
  ]);

  let storesData: StoreChannelRow[] | null = null;
  let storesError: any = null;
  {
    const fullStoresRes = await svc
      .from('scalev_store_channels')
      .select('id, business_id, store_name, store_type, channel_override, scalev_store_id, store_unique_id')
      .eq('is_active', true)
      .eq('store_type', 'marketplace');

    if (fullStoresRes.error) {
      const legacyStoresRes = await svc
        .from('scalev_store_channels')
        .select('id, business_id, store_name, store_type, channel_override')
        .eq('is_active', true)
        .eq('store_type', 'marketplace');

      storesError = legacyStoresRes.error;
      storesData = (legacyStoresRes.data || []).map((row: any) => ({
        ...row,
        scalev_store_id: null,
        store_unique_id: null,
      })) as StoreChannelRow[];
    } else {
      storesData = (fullStoresRes.data || []) as StoreChannelRow[];
    }
  }

  if (businessesRes.error) throw businessesRes.error;
  if (storesError) throw storesError;
  if (identifiersRes.error) throw identifiersRes.error;
  if (existingRes.error) throw existingRes.error;
  if (productMappingsRes.error) throw productMappingsRes.error;

  const businesses = (businessesRes.data || []) as BusinessRow[];
  const stores = (storesData || []) as StoreChannelRow[];
  const identifiers = (identifiersRes.data || []) as CatalogIdentifierRow[];
  const existingOrders = (existingRes.data || []) as ExistingOrderRow[];
  const productMappings = (productMappingsRes.data || []) as ProductMappingRow[];

  const storesByBusinessId = new Map<number, StoreChannelRow[]>();
  for (const store of stores) {
    if (!storesByBusinessId.has(store.business_id)) storesByBusinessId.set(store.business_id, []);
    storesByBusinessId.get(store.business_id)!.push(store);
  }

  const existingByExternalId = new Map<string, ExistingOrderRow>();
  for (const row of existingOrders) {
    if (row.external_id) existingByExternalId.set(String(row.external_id), row);
  }

  return {
    svc,
    businesses,
    businessById: new Map(businesses.map((business) => [business.id, business])),
    storesByBusinessId,
    identifiersByBusinessId: buildIdentifierLookupMap(identifiers),
    existingByExternalId,
    productMappings,
    storeUsageCache: new Map<string, number>(),
    liveStoreCache: new Map<number, LiveStore[]>(),
    bundleDetailCache: new Map<string, BundleDetailRow>(),
    locationSearchCache: new Map<string, LocationRow[]>(),
    variantCache: new Map<string, CatalogVariantRow | null>(),
    bundleIdentifiersCache: new Map<string, CatalogIdentifierRow[]>(),
  };
}

async function getStoreUsageCount(context: ImportContext, businessCode: string, storeName: string): Promise<number> {
  const cacheKey = `${businessCode}:${storeName.toLowerCase()}`;
  const cached = context.storeUsageCache.get(cacheKey);
  if (cached != null) return cached;

  const { count, error } = await context.svc
    .from('scalev_orders')
    .select('id', { count: 'exact', head: true })
    .eq('business_code', businessCode)
    .eq('store_name', storeName);

  if (error) {
    context.storeUsageCache.set(cacheKey, 0);
    return 0;
  }
  const value = Number(count || 0);
  context.storeUsageCache.set(cacheKey, value);
  return value;
}

async function getLiveStoresForBusiness(context: ImportContext, business: BusinessRow): Promise<LiveStore[]> {
  const cached = context.liveStoreCache.get(business.id);
  if (cached) return cached;

  let stores: Awaited<ReturnType<typeof fetchStoreList>>;
  try {
    stores = await fetchStoreList(business.api_key, SCALEV_BASE_URL);
  } catch (error) {
    throw new Error(`fetch live stores gagal untuk business ${business.business_code}: ${describeUnknownError(error)}`);
  }
  const normalized = stores.map((store) => ({
    id: Number(store.id),
    name: String(store.name || ''),
    unique_id: String(store.unique_id || ''),
    uuid: String(store.uuid || ''),
  }));
  context.liveStoreCache.set(business.id, normalized);
  return normalized;
}

function scoreStoreForOrder(
  order: CanonicalOrder,
  store: StoreChannelRow,
  usageCount: number,
  brandTokens: string[],
): number {
  let score = Math.min(usageCount, 250);
  const storeName = normalizeIdentifier(store.store_name);
  if (storeName.includes('marketplace')) score += 15;
  if (order.platform === 'tiktok' && storeName.includes('tiktok')) score += 20;
  if (order.platform === 'shopee' && storeName.includes('shopee')) score += 20;
  if (order.platform === 'lazada' && storeName.includes('lazada')) score += 20;
  for (const token of brandTokens) {
    if (storeName.includes(token)) score += token === 'secret' ? 35 : 45;
  }
  return score;
}

function chooseBestIdentifierForLine(
  line: CanonicalLine,
  businessId: number,
  identifiersByBusinessId: Map<number, Map<string, CatalogIdentifierRow[]>>,
): ResolvedLine | null {
  const identifierMap = identifiersByBusinessId.get(businessId);
  if (!identifierMap) return null;
  const candidates = new Map<string, ResolvedLine>();

  const collect = (rawValue: string | null | undefined, mode: 'variant_sku' | 'product_name') => {
    const normalized = normalizeIdentifier(rawValue);
    if (!normalized) return;
    for (const row of identifierMap.get(normalized) || []) {
      if (mode === 'variant_sku' && row.entity_type === 'product') continue;
      const priority = getIdentifierSourcePriority(row.source, mode);
      const existing = candidates.get(row.entity_key);
      if (existing && existing.priority >= priority) continue;
      candidates.set(row.entity_key, { line, identifier: row, priority });
    }
  };

  collect(line.sku, 'variant_sku');
  collect(line.productName, 'product_name');
  collect(line.variation, 'product_name');

  const ranked = Array.from(candidates.values()).sort((left, right) => right.priority - left.priority);
  return ranked[0] || null;
}

async function pickStoreForBusiness(
  context: ImportContext,
  business: BusinessRow,
  order: CanonicalOrder,
  brandTokens: string[],
): Promise<ResolvedStore | null> {
  const candidateStores = context.storesByBusinessId.get(business.id) || [];
  if (candidateStores.length === 0) return null;

  const scored = await Promise.all(candidateStores.map(async (store) => {
    const usageCount = await getStoreUsageCount(context, business.business_code, store.store_name);
    return {
      row: store,
      score: scoreStoreForOrder(order, store, usageCount, brandTokens),
    };
  }));

  scored.sort((left, right) => right.score - left.score);
  const best = scored[0];
  if (!best) return null;

  const liveStores = await getLiveStoresForBusiness(context, business);
  const live = liveStores.find((store) => normalizeLoose(store.name) === normalizeLoose(best.row.store_name));
  if (!live) return null;

  return {
    row: best.row,
    live,
    score: best.score,
  };
}

async function resolveOrderBusinessAndStore(
  context: ImportContext,
  order: CanonicalOrder,
): Promise<{ business: BusinessRow; store: ResolvedStore; resolvedLines: ResolvedLine[] }> {
  const brandTokens = brandTokensForOrder(order);
  const candidates: Array<{
    business: BusinessRow;
    store: ResolvedStore;
    resolvedLines: ResolvedLine[];
    score: number;
  }> = [];
  const failures: string[] = [];

  for (const business of context.businesses) {
    try {
      const resolvedLines: ResolvedLine[] = [];
      let priorityScore = 0;
      let failed = false;

      for (const line of order.lines) {
        const resolved = chooseBestIdentifierForLine(line, business.id, context.identifiersByBusinessId);
        if (!resolved) {
          failed = true;
          break;
        }
        resolvedLines.push(resolved);
        priorityScore += resolved.priority;
      }

      if (failed) continue;
      const store = await pickStoreForBusiness(context, business, order, brandTokens);
      if (!store) continue;
      candidates.push({
        business,
        store,
        resolvedLines,
        score: priorityScore + store.score,
      });
    } catch (error) {
      failures.push(`${business.business_code}: ${describeUnknownError(error)}`);
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (!best) {
    if (failures.length > 0) {
      throw new Error(`Order ${order.externalId} tidak bisa dipetakan ke business/store Scalev aktif. Kegagalan kandidat: ${failures.join(' | ')}`);
    }
    throw new Error(`Order ${order.externalId} tidak bisa dipetakan ke business/store Scalev aktif.`);
  }

  if (candidates[1] && Math.abs(best.score - candidates[1].score) <= 10) {
    throw new Error(`Order ${order.externalId} ambigu antara business ${best.business.business_code} dan ${candidates[1].business.business_code}.`);
  }

  return {
    business: best.business,
    store: best.store,
    resolvedLines: best.resolvedLines,
  };
}

async function resolveFromExistingAuthoritativeOrder(
  context: ImportContext,
  order: CanonicalOrder,
): Promise<{ business: BusinessRow; store: ResolvedStore; resolvedLines: ResolvedLine[] } | null> {
  const existing = context.existingByExternalId.get(order.externalId);
  if (!existing || existing.source !== MARKETPLACE_API_SOURCE) return null;
  const businessCode = cleanText(existing.business_code);
  const storeName = cleanText(existing.store_name);
  if (!businessCode || !storeName) return null;

  const business = context.businesses.find((row) => row.business_code === businessCode) || null;
  if (!business) return null;

  const { data: storeRows, error } = await context.svc
    .from('scalev_store_channels')
    .select('id, business_id, store_name, store_type, channel_override')
    .eq('is_active', true)
    .eq('business_id', business.id)
    .eq('store_name', storeName)
    .limit(1);
  if (error) {
    throw new Error(`Store authoritative ${businessCode}/${storeName} tidak bisa dibaca: ${describeUnknownError(error)}`);
  }
  const storeRow = ((storeRows || [])[0] || null) as StoreChannelRow | null;
  if (!storeRow) return null;

  const resolvedLines: ResolvedLine[] = [];
  for (const line of order.lines) {
    const resolved = chooseBestIdentifierForLine(line, business.id, context.identifiersByBusinessId);
    if (!resolved) return null;
    resolvedLines.push(resolved);
  }

  const liveStores = await getLiveStoresForBusiness(context, business);
  const live = liveStores.find((row) => normalizeLoose(row.name) === normalizeLoose(storeRow.store_name)) || null;
  if (!live) {
    throw new Error(`Store live authoritative ${businessCode}/${storeName} tidak ditemukan di akun ScaleV.`);
  }

  return {
    business,
    store: {
      row: storeRow,
      live,
      score: 9999,
    },
    resolvedLines,
  };
}

async function maybePersistResolvedStore(context: ImportContext, store: ResolvedStore): Promise<void> {
  try {
    await context.svc
      .from('scalev_store_channels')
      .update({
        scalev_store_id: store.live.id,
        store_unique_id: store.live.unique_id || null,
      })
      .eq('id', store.row.id);
  } catch {
    // best-effort only
  }
}

async function fetchScalevJson<T>(apiKey: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SCALEV_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  let json: Record<string, any>;
  try {
    json = text ? JSON.parse(text) as Record<string, any> : {};
  } catch {
    throw new Error(`Scalev response tidak valid (${response.status}).`);
  }
  if (!response.ok || (json.code != null && Number(json.code) >= 400)) {
    const errorText = json.error
      ? JSON.stringify(json.error)
      : json.status || json.message || text || `HTTP ${response.status}`;
    throw new Error(errorText);
  }
  return json as T;
}

async function searchLocations(context: ImportContext, apiKey: string, query: string): Promise<LocationRow[]> {
  const key = normalizeIdentifier(query);
  if (!key) return [];
  const cached = context.locationSearchCache.get(key);
  if (cached) return cached;
  const params = new URLSearchParams({ search: query });
  const json = await fetchScalevJson<{ data?: { results?: LocationRow[] } }>(apiKey, `/locations?${params.toString()}`);
  const results = json.data?.results || [];
  context.locationSearchCache.set(key, results);
  return results;
}

async function resolveLocation(context: ImportContext, apiKey: string, order: CanonicalOrder): Promise<LocationRow> {
  const queries = Array.from(new Set([
    order.district,
    [order.district, order.city].filter(Boolean).join(' '),
    order.city,
  ].filter((value): value is string => Boolean(cleanText(value)))));

  const allResults = new Map<number, LocationRow>();
  for (const query of queries) {
    for (const row of await searchLocations(context, apiKey, query)) {
      allResults.set(Number(row.id), row);
    }
  }

  const results = Array.from(allResults.values());
  if (results.length === 0) {
    throw new Error(`Lokasi untuk order ${order.externalId} tidak ditemukan di Scalev.`);
  }

  const districtNorm = normalizeLoose(order.district);
  const cityNorm = normalizeLoose(order.city);
  const provinceNorm = normalizeLoose(order.province);

  const exact = results.filter((row) => {
    const districtMatch = !districtNorm || normalizeLoose(row.subdistrict_name) === districtNorm;
    const cityMatch = !cityNorm || normalizeLoose(row.city_name) === cityNorm;
    const provinceMatch = !provinceNorm || normalizeLoose(row.province_name) === provinceNorm;
    return districtMatch && cityMatch && provinceMatch;
  });

  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(`Lokasi order ${order.externalId} ambigu di Scalev (${exact.map((row) => row.display || row.id).join(', ')}).`);
  }

  if (results.length === 1) return results[0];
  throw new Error(`Lokasi order ${order.externalId} ambigu. Tambahkan district/alamat yang lebih spesifik.`);
}

async function fetchBundleDetail(
  context: ImportContext,
  business: BusinessRow,
  store: ResolvedStore,
  bundleId: number,
): Promise<BundleDetailRow> {
  const cacheKey = `${business.id}:${store.live.id}:${bundleId}`;
  const cached = context.bundleDetailCache.get(cacheKey);
  if (cached) return cached;

  const json = await fetchScalevJson<{ data: BundleDetailRow }>(
    business.api_key,
    `/stores/${store.live.id}/bundles/${bundleId}`,
  );
  context.bundleDetailCache.set(cacheKey, json.data);
  return json.data;
}

async function fetchVariantRow(
  context: ImportContext,
  businessId: number,
  variantId: number,
): Promise<CatalogVariantRow | null> {
  const cacheKey = `${businessId}:${variantId}`;
  if (context.variantCache.has(cacheKey)) {
    return context.variantCache.get(cacheKey) || null;
  }

  const { data, error } = await context.svc
    .from('scalev_catalog_variants')
    .select('business_id, scalev_product_id, scalev_variant_id, scalev_variant_unique_id, sku, name, product_name')
    .eq('business_id', businessId)
    .eq('scalev_variant_id', variantId)
    .maybeSingle();

  if (error) throw error;
  const row = (data || null) as CatalogVariantRow | null;
  context.variantCache.set(cacheKey, row);
  return row;
}

async function fetchBundleIdentifiers(
  context: ImportContext,
  businessId: number,
  entityKey: string,
): Promise<CatalogIdentifierRow[]> {
  const cacheKey = `${businessId}:${entityKey}`;
  const cached = context.bundleIdentifiersCache.get(cacheKey);
  if (cached) return cached;

  const { data, error } = await context.svc
    .from('scalev_catalog_identifiers')
    .select(`
      business_id,
      business_code,
      entity_type,
      entity_key,
      entity_label,
      scalev_product_id,
      scalev_variant_id,
      scalev_bundle_id,
      identifier,
      identifier_normalized,
      source
    `)
    .eq('business_id', businessId)
    .eq('entity_key', entityKey)
    .eq('entity_type', 'bundle');

  if (error) throw error;
  const rows = (data || []) as CatalogIdentifierRow[];
  context.bundleIdentifiersCache.set(cacheKey, rows);
  return rows;
}

function matchBundlePriceOption(
  detail: BundleDetailRow,
  identifierRows: CatalogIdentifierRow[],
  line: CanonicalLine,
): BundlePriceOption {
  const options = detail.bundle_price_options || [];
  if (options.length === 0) {
    throw new Error(`Bundle ${detail.id} tidak punya price option aktif di store.`);
  }
  if (options.length === 1) return options[0];

  const valueCandidates = Array.from(new Set([
    normalizeIdentifier(line.sku),
    normalizeIdentifier(line.productName),
    normalizeIdentifier(line.variation),
  ].filter(Boolean)));
  const priceToken = priceTokenFromSku(line.sku);

  const localOptionIds = new Set(
    identifierRows
      .filter((row) => row.source === 'bundle.price_option_unique_id' || row.source === 'bundle.price_option_slug')
      .map((row) => normalizeIdentifier(row.identifier)),
  );

  const matches = options.filter((option) => {
    const normalizedUnique = normalizeIdentifier(option.unique_id);
    const normalizedSlug = normalizeIdentifier(option.slug);
    const normalizedName = normalizeIdentifier(option.name);
    if (valueCandidates.some((value) => value === normalizedUnique || value === normalizedSlug)) return true;
    if (priceToken && normalizeLoose(option.name) === normalizeLoose(priceToken)) return true;
    if (localOptionIds.has(normalizedUnique) || localOptionIds.has(normalizedSlug)) return true;
    return false;
  });

  if (matches.length === 1) return matches[0];
  throw new Error(`Bundle ${detail.custom_id || detail.id} punya banyak price option dan tidak bisa dipilih otomatis.`);
}

function buildWarehouseSearchVariants(detail: BundleDetailRow, quantity: number): Array<{ variant_id: number; qty: number }> {
  const map = new Map<number, number>();
  for (const line of detail.bundlelines || []) {
    const variantId = Number(line.variant?.id || 0);
    if (!variantId) continue;
    const multiplier = Math.max(Number(line.quantity || 0), 1) * Math.max(quantity, 1);
    map.set(variantId, (map.get(variantId) || 0) + multiplier);
  }
  return Array.from(map.entries()).map(([variant_id, qty]) => ({ variant_id, qty }));
}

function estimateBundleWeight(detail: BundleDetailRow, quantity: number): number {
  const lineWeight = (detail.bundlelines || []).reduce((total, line) => {
    const variantWeight = Number(line.variant?.weight || 0);
    const lineQty = Math.max(Number(line.quantity || 0), 1);
    return total + (variantWeight * lineQty);
  }, 0);
  const bundleWeight = lineWeight + Number(detail.weight_bump || 0);
  return Math.max(bundleWeight * Math.max(quantity, 1), 0);
}

async function searchWarehouse(
  business: BusinessRow,
  store: ResolvedStore,
  location: LocationRow,
  variants: Array<{ variant_id: number; qty: number }>,
): Promise<SearchWarehouseResult> {
  const json = await fetchScalevJson<{ data: SearchWarehouseResult[] }>(business.api_key, '/shipping-costs/search-warehouse', {
    method: 'POST',
    body: JSON.stringify({
      store_id: store.live.id,
      destination_id: location.id,
      variants,
    }),
  });
  const results = Array.isArray(json.data) ? json.data : [];
  const first = results[0];
  if (!first) throw new Error(`Warehouse untuk store ${store.live.name} tidak ditemukan.`);
  return first;
}

async function searchCourierService(
  business: BusinessRow,
  store: ResolvedStore,
  location: LocationRow,
  warehouse: SearchWarehouseResult,
  weight: number,
): Promise<SearchCourierServiceResult[]> {
  const json = await fetchScalevJson<{ data: SearchCourierServiceResult[] }>(business.api_key, '/shipping-costs/search-courier-service', {
    method: 'POST',
    body: JSON.stringify({
      store_id: store.live.id,
      warehouse_id: warehouse.warehouse.id,
      location_id: location.id,
      weight: Math.max(Math.round(weight), 1),
      payment_method: PHYSICAL_PAYMENT_METHOD,
    }),
  });
  return Array.isArray(json.data) ? json.data : [];
}

function pickBestCourier(
  order: CanonicalOrder,
  candidates: SearchCourierServiceResult[],
): SearchCourierServiceResult {
  if (candidates.length === 0) {
    throw new Error(`Kurir untuk order ${order.externalId} tidak ditemukan.`);
  }

  const hints = Array.from(new Set([
    normalizeIdentifier(order.shippingProvider),
    normalizeIdentifier(order.deliveryOption),
    normalizeIdentifier(order.paymentMethodLabel),
  ].filter(Boolean)));

  const scored = candidates.map((candidate) => {
    const courierName = normalizeIdentifier(candidate.courier_service?.courier?.name);
    const courierCode = normalizeIdentifier(candidate.courier_service?.courier?.code);
    const serviceName = normalizeIdentifier(candidate.courier_service?.name);
    const serviceCode = normalizeIdentifier(candidate.courier_service?.code);
    let score = 0;
    for (const hint of hints) {
      if (!hint) continue;
      if (hint === courierName || hint === courierCode) score += 100;
      if (hint === serviceName || hint === serviceCode) score += 90;
      if (hint.includes(courierName) || courierName.includes(hint)) score += 60;
      if (hint.includes(serviceName) || serviceName.includes(hint)) score += 55;
      if (hint.includes('cashless') && `${courierName} ${serviceName}`.includes('cashless')) score += 20;
      if (hint.includes('instant') && `${courierName} ${serviceName}`.includes('instant')) score += 20;
      if (hint.includes('same day') && `${courierName} ${serviceName}`.includes('same day')) score += 20;
    }
    return { candidate, score };
  });

  scored.sort((left, right) => right.score - left.score);
  return scored[0].candidate;
}

async function buildScalevPayload(
  context: ImportContext,
  business: BusinessRow,
  store: ResolvedStore,
  order: CanonicalOrder,
  resolvedLines: ResolvedLine[],
): Promise<{ payload: ScalevCreatePayload; totalWeightGrams: number }> {
  const orderVariants = new Map<string, { quantity: number }>();
  const orderBundles = new Map<string, { quantity: number }>();
  const warehouseVariants = new Map<number, number>();
  let computedWeight = 0;

  for (const resolved of resolvedLines) {
    const quantity = Math.max(resolved.line.quantity, 1);
    if (resolved.identifier.entity_type === 'bundle') {
      const bundleId = Number(resolved.identifier.scalev_bundle_id || String(resolved.identifier.entity_key).split(':')[1] || 0);
      if (!bundleId) {
        throw new Error(`Bundle untuk SKU ${resolved.line.sku || resolved.line.productName} tidak valid.`);
      }
      const detail = await fetchBundleDetail(context, business, store, bundleId);
      const identifierRows = await fetchBundleIdentifiers(context, business.id, resolved.identifier.entity_key);
      const option = matchBundlePriceOption(detail, identifierRows, resolved.line);
      const existing = orderBundles.get(option.unique_id);
      orderBundles.set(option.unique_id, { quantity: (existing?.quantity || 0) + quantity });
      for (const item of buildWarehouseSearchVariants(detail, quantity)) {
        warehouseVariants.set(item.variant_id, (warehouseVariants.get(item.variant_id) || 0) + item.qty);
      }
      computedWeight += estimateBundleWeight(detail, quantity);
      continue;
    }

    const variantId = Number(resolved.identifier.scalev_variant_id || 0);
    if (!variantId) {
      throw new Error(`Variant untuk SKU ${resolved.line.sku || resolved.line.productName} tidak valid.`);
    }
    const variantRow = await fetchVariantRow(context, business.id, variantId);
    if (!variantRow?.scalev_variant_unique_id) {
      throw new Error(`Variant ${variantId} belum punya unique_id di cache Scalev.`);
    }
    const existing = orderVariants.get(variantRow.scalev_variant_unique_id);
    orderVariants.set(variantRow.scalev_variant_unique_id, { quantity: (existing?.quantity || 0) + quantity });
    warehouseVariants.set(variantId, (warehouseVariants.get(variantId) || 0) + quantity);
    if (resolved.line.weightGrams) computedWeight += resolved.line.weightGrams;
  }

  const location = await resolveLocation(context, business.api_key, order);
  const address = cleanText(order.address)
    || cleanText(order.rawAddress)
    || cleanText(order.addressNotes);
  if (!address) {
    throw new Error(`Alamat untuk order ${order.externalId} tidak lengkap.`);
  }

  const warehouse = await searchWarehouse(
    business,
    store,
    location,
    Array.from(warehouseVariants.entries()).map(([variant_id, qty]) => ({ variant_id, qty })),
  );

  const totalWeightGrams = order.totalWeightGrams || computedWeight || 100;
  const couriers = await searchCourierService(
    business,
    store,
    location,
    warehouse,
    totalWeightGrams,
  );
  const courier = pickBestCourier(order, couriers);

  const payload: ScalevCreatePayload = {
    store_unique_id: store.live.unique_id,
    external_id: order.externalId,
    customer_name: order.customerName || order.customerUsername || 'Marketplace Customer',
    payment_method: PHYSICAL_PAYMENT_METHOD,
    address,
    location_id: location.id,
    postal_code: order.postalCode,
    warehouse_unique_id: warehouse.warehouse.unique_id,
    courier_service_id: courier.courier_service.id,
    shipping_cost: order.shippingCost > 0 ? Math.round(order.shippingCost) : Math.round(courier.cost || 0),
    shipment_provider_code: courier.shipment_provider_code || undefined,
    notes: `Imported from ${salesChannelForPlatform(order.platform)} via app`,
  };
  payload.customer_phone = normalizeScalevCustomerPhone(order.customerPhone);
  if (order.customerEmail) payload.customer_email = order.customerEmail;

  if (orderVariants.size > 0) {
    payload.ordervariants = Array.from(orderVariants.entries()).map(([variant_unique_id, item]) => ({
      quantity: item.quantity,
      variant_unique_id,
    }));
  }
  if (orderBundles.size > 0) {
    payload.orderbundles = Array.from(orderBundles.entries()).map(([bundle_price_option_unique_id, item]) => ({
      quantity: item.quantity,
      bundle_price_option_unique_id,
    }));
  }
  if (!payload.ordervariants && !payload.orderbundles) {
    throw new Error(`Order ${order.externalId} tidak punya variant/bundle yang bisa dibuat.`);
  }

  return { payload, totalWeightGrams };
}

async function createScalevOrder(apiKey: string, payload: ScalevCreatePayload): Promise<ScalevCreateResponse> {
  return fetchScalevJson<ScalevCreateResponse>(apiKey, '/order', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || util.inspect(error, { depth: 6, breakLength: 120 });
  }
  return util.inspect(error, { depth: 6, breakLength: 120 });
}

function buildProductMappingIndexes(rows: ProductMappingRow[]) {
  const bySku = new Map<string, ProductMappingRow>();
  const byName = new Map<string, ProductMappingRow>();
  for (const row of rows) {
    if (row.sku) bySku.set(String(row.sku).toUpperCase(), row);
    if (row.product_name) byName.set(normalizeIdentifier(row.product_name), row);
  }
  return { bySku, byName };
}

function lookupLineCogs(
  line: CanonicalLine,
  mappingIndexes: ReturnType<typeof buildProductMappingIndexes>,
): { cogs: number; brand: string } {
  const sku = String(line.sku || '').toUpperCase();
  const direct = sku ? mappingIndexes.bySku.get(sku) : null;
  if (direct) {
    return {
      cogs: Number(direct.cogs || 0),
      brand: String(direct.brand || direct.product_type || 'Other'),
    };
  }

  let cogs = 0;
  for (const part of sku.split(/[+,]/).map((value) => value.trim()).filter(Boolean)) {
    const normalized = part.replace(/-\d+$/, '');
    const found = mappingIndexes.bySku.get(normalized);
    if (found) cogs += Number(found.cogs || 0);
  }
  const nameMatch = mappingIndexes.byName.get(normalizeIdentifier(line.productName));
  return {
    cogs: cogs || Number(nameMatch?.cogs || 0),
    brand: String(nameMatch?.brand || nameMatch?.product_type || 'Other'),
  };
}

function inferTaxRate(business: BusinessRow): number {
  return business.tax_rate_name === 'NONE' ? 0 : 11;
}

async function upsertLocalMarketplaceOrder(
  context: ImportContext,
  business: BusinessRow,
  store: ResolvedStore,
  order: CanonicalOrder,
  createResponse: ScalevCreateResponse,
  payload: ScalevCreatePayload,
): Promise<'inserted' | 'updated'> {
  const mappingIndexes = buildProductMappingIndexes(context.productMappings);
  const existing = context.existingByExternalId.get(order.externalId) || null;
  const responseData = createResponse.data || createResponse;
  const orderId = cleanText(responseData?.order_id) || existing?.order_id || order.externalId;
  const status = cleanText(responseData?.status) || 'pending';
  const taxRate = inferTaxRate(business);
  const taxDivisor = 1 + (taxRate / 100);

  const rowPayload: Record<string, any> = {
    order_id: orderId,
    external_id: order.externalId,
    scalev_id: cleanText(responseData?.id) || null,
    customer_type: null,
    status,
    platform: platformSlug(order.platform),
    store_name: store.row.store_name,
    utm_source: null,
    financial_entity: salesChannelForPlatform(order.platform),
    payment_method: PHYSICAL_PAYMENT_METHOD,
    unique_code_discount: 0,
    is_purchase_fb: false,
    is_purchase_tiktok: false,
    is_purchase_kwai: false,
    gross_revenue: order.orderAmount,
    net_revenue: order.orderAmount,
    shipping_cost: order.shippingCost,
    total_quantity: order.lines.reduce((sum, line) => sum + line.quantity, 0),
    customer_name: order.customerName,
    customer_phone: order.customerPhone,
    customer_email: order.customerEmail,
    province: order.province,
    city: order.city,
    subdistrict: order.district,
    handler: null,
    draft_time: order.createdAt,
    pending_time: order.createdAt,
    confirmed_time: order.paidAt || order.createdAt,
    paid_time: order.paidAt,
    shipped_time: order.shippedAt,
    completed_time: order.deliveredAt,
    canceled_time: order.canceledAt,
    source: MARKETPLACE_API_SOURCE,
    business_code: business.business_code,
    business_name_raw: business.business_name,
    origin_business_name_raw: null,
    origin_raw: null,
    seller_business_code: business.business_code,
    origin_operator_business_code: null,
    origin_registry_id: null,
    ...buildScalevSourceClassFields({
      source: MARKETPLACE_API_SOURCE,
      platform: platformSlug(order.platform),
      externalId: order.externalId,
      financialEntity: salesChannelForPlatform(order.platform),
      rawData: {
        marketplace_upload: order,
        scalev_payload: payload,
        scalev_response: responseData,
      },
      storeName: store.row.store_name,
      storeType: store.row.store_type,
    }),
    raw_data: {
      marketplace_upload: order,
      scalev_payload: payload,
      scalev_response: responseData,
    },
    synced_at: new Date().toISOString(),
  };

  let dbOrderId = existing?.id || null;
  let state: 'inserted' | 'updated' = 'updated';

  if (existing) {
    const { error } = await context.svc
      .from('scalev_orders')
      .update(rowPayload)
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { data, error } = await context.svc
      .from('scalev_orders')
      .insert(rowPayload)
      .select('id, order_id, external_id, source, business_code')
      .single();
    if (error) throw error;
    dbOrderId = Number(data.id);
    context.existingByExternalId.set(order.externalId, data as ExistingOrderRow);
    state = 'inserted';
  }

  if (!dbOrderId) throw new Error(`Order lokal ${order.externalId} gagal mendapatkan id.`);

  await context.svc.from('scalev_order_lines').delete().eq('scalev_order_id', dbOrderId);

  const lineMap = new Map<string, Record<string, any>>();
  for (const line of order.lines) {
    const cogs = lookupLineCogs(line, mappingIndexes);
    const productPriceBt = Math.round((line.lineSubtotal || (line.unitPrice * line.quantity)) / taxDivisor);
    const cogsBt = Math.round((cogs.cogs || 0) / taxDivisor);
    const key = `${normalizeIdentifier(line.productName)}|${normalizeIdentifier(line.sku)}`;
    const existingLine = lineMap.get(key);
    if (existingLine) {
      existingLine.quantity += line.quantity;
      existingLine.product_price_bt += productPriceBt;
      existingLine.discount_bt += Math.round((line.lineDiscount || 0) / taxDivisor);
      continue;
    }
    lineMap.set(key, {
      scalev_order_id: dbOrderId,
      order_id: orderId,
      product_name: line.productName,
      item_name_raw: line.productName,
      item_owner_raw: null,
      stock_owner_business_code: null,
      product_type: cogs.brand,
      variant_sku: line.sku,
      quantity: line.quantity,
      product_price_bt: productPriceBt,
      discount_bt: Math.round((line.lineDiscount || 0) / taxDivisor),
      cogs_bt: cogsBt,
      tax_rate: taxRate,
      sales_channel: salesChannelForPlatform(order.platform),
      is_purchase_fb: false,
      is_purchase_tiktok: false,
      is_purchase_kwai: false,
      synced_at: new Date().toISOString(),
    });
  }

  const lines = Array.from(lineMap.values());
  if (lines.length > 0) {
    const { error } = await context.svc
      .from('scalev_order_lines')
      .upsert(lines, { onConflict: 'scalev_order_id,product_name' });
    if (error) throw error;
  }

  return state;
}

export async function importSingleMarketplaceOrderFromWorkbook(input: {
  file: File;
  externalId: string;
  uploadedBy: string | null;
  filenameOverride?: string | null;
}): Promise<SingleMarketplaceOrderImportResult> {
  const svc = createServiceSupabase();
  const targetExternalId = cleanText(input.externalId);
  if (!targetExternalId) {
    throw new Error('externalId wajib diisi.');
  }

  const parsed = await parseMarketplaceWorkbook(input.file);
  const order = parsed.orders.find((candidate) => candidate.externalId === targetExternalId);
  if (!order) {
    throw new Error(`Order ${targetExternalId} tidak ditemukan di workbook.`);
  }

  const context = await loadImportContext(svc, [order]);
  const resolved = await resolveOrderBusinessAndStore(context, order);
  await maybePersistResolvedStore(context, resolved.store);
  const built = await buildScalevPayload(context, resolved.business, resolved.store, order, resolved.resolvedLines);
  const created = await createScalevOrder(resolved.business.api_key, built.payload);
  const localState = await upsertLocalMarketplaceOrder(
    context,
    resolved.business,
    resolved.store,
    order,
    created,
    built.payload,
  );

  const responseData = created.data || created;
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: `${MARKETPLACE_API_SYNC_TYPE}_single`,
    business_code: resolved.business.business_code,
    orders_fetched: 1,
    orders_inserted: localState === 'inserted' ? 1 : 0,
    orders_updated: localState === 'updated' ? 1 : 0,
    uploaded_by: input.uploadedBy,
    filename: cleanText(input.filenameOverride) || input.file.name,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  return {
    externalId: targetExternalId,
    businessCode: resolved.business.business_code,
    storeName: resolved.store.row.store_name,
    localState,
    scalevOrderId: cleanText(responseData?.order_id),
    scalevId: cleanText(responseData?.id),
    responseStatus: cleanText(responseData?.status),
  };
}

function buildCanonicalOrderFromMarketplaceIntake(
  order: IntakeOrderCreateRow,
  lines: IntakeLineCreateRow[],
): CanonicalOrder {
  const rawMeta = (order.raw_meta || {}) as Record<string, string>;
  const normalizedLines: CanonicalLine[] = lines.map((line) => {
    const quantity = Math.max(Number(line.quantity || 0), 1);
    const unitPrice = Number(line.mp_price_after_discount || line.unit_price || 0);
    const lineSubtotal = Number(line.line_subtotal || 0) || (unitPrice * quantity);
    const rawWeight = parseWeightGrams((line.raw_row || {})['Total Berat']) || parseWeightGrams((line.raw_row || {})['Berat Produk']);
    const weightGrams = rawWeight || null;
    return {
      sku: cleanText(line.mp_sku),
      productName: cleanText(line.mp_product_name) || 'Produk Marketplace',
      variation: cleanText(line.mp_variation),
      quantity,
      unitPrice,
      lineSubtotal,
      lineDiscount: Number(line.line_discount || 0),
      weightGrams,
      rawRow: line.raw_row || {},
    };
  });

  const totalWeightGrams = normalizedLines.reduce((sum, line) => sum + Number(line.weightGrams || 0), 0) || null;

  return {
    platform: 'shopee',
    externalId: cleanText(order.external_order_id) || '',
    status: cleanText(order.mp_order_status),
    substatus: cleanText(order.mp_cancel_return_status),
    paymentMethodLabel: cleanText(order.payment_method_label),
    createdAt: cleanText(order.mp_order_created_at),
    paidAt: cleanText(order.mp_payment_paid_at),
    rtsAt: cleanText(order.mp_ready_to_ship_at),
    shippedAt: null,
    deliveredAt: cleanText(order.mp_order_completed_at),
    canceledAt: null,
    trackingNumber: cleanText(order.tracking_number),
    shippingProvider: cleanText(order.shipping_provider),
    deliveryOption: cleanText(order.delivery_option),
    customerUsername: cleanText(order.mp_customer_username),
    customerName: cleanText(order.recipient_name) || cleanText(order.customer_label) || cleanText(order.mp_customer_username),
    customerPhone: normalizePhone(cleanText(order.mp_customer_phone)),
    customerEmail: null,
    postalCode: cleanText(order.mp_shipping_postal_code),
    country: 'Indonesia',
    province: cleanText(order.mp_shipping_province),
    city: cleanText(order.mp_shipping_city),
    district: cleanText(order.mp_shipping_district),
    village: null,
    address: cleanText(order.mp_shipping_address),
    addressNotes: cleanText(order.mp_buyer_note),
    rawAddress: cleanText(order.mp_raw_shipping_address),
    shippingCost: Number(order.mp_shipping_cost_buyer || order.mp_estimated_shipping_cost || 0),
    orderAmount: Number(order.order_amount || 0),
    totalWeightGrams,
    lines: aggregateCanonicalLines(normalizedLines),
    rawMeta,
  };
}

export async function importSingleMarketplaceIntakeOrder(input: {
  intakeOrderId: number;
  uploadedBy: string | null;
  debug?: boolean;
  dryRun?: boolean;
}): Promise<SingleMarketplaceOrderImportResult> {
  const svc = createServiceSupabase();
  const intakeOrderId = Number(input.intakeOrderId || 0);
  if (!Number.isFinite(intakeOrderId) || intakeOrderId <= 0) {
    throw new Error('intakeOrderId tidak valid.');
  }

  const { data: orderRow, error: orderError } = await svc
    .from('marketplace_intake_orders')
    .select(`
      id,
      external_order_id,
      recipient_name,
      customer_label,
      tracking_number,
      payment_method_label,
      shipping_provider,
      delivery_option,
      order_amount,
      raw_meta,
      mp_order_status,
      mp_cancel_return_status,
      mp_order_created_at,
      mp_payment_paid_at,
      mp_ready_to_ship_at,
      mp_order_completed_at,
      mp_customer_username,
      mp_customer_phone,
      mp_shipping_address,
      mp_shipping_district,
      mp_shipping_city,
      mp_shipping_province,
      mp_shipping_postal_code,
      mp_raw_shipping_address,
      mp_buyer_note,
      mp_shipping_cost_buyer,
      mp_estimated_shipping_cost
    `)
    .eq('id', intakeOrderId)
    .single<IntakeOrderCreateRow>();
  if (orderError) throw orderError;

  const { data: lineRows, error: lineError } = await svc
    .from('marketplace_intake_order_lines')
    .select(`
      intake_order_id,
      mp_sku,
      mp_product_name,
      mp_variation,
      quantity,
      unit_price,
      line_subtotal,
      line_discount,
      mp_price_after_discount,
      raw_row
    `)
    .eq('intake_order_id', intakeOrderId)
    .order('line_index', { ascending: true });
  if (lineError) throw lineError;

  const canonicalOrder = buildCanonicalOrderFromMarketplaceIntake(
    orderRow as IntakeOrderCreateRow,
    (lineRows || []) as IntakeLineCreateRow[],
  );
  if (input.debug) {
    console.log('[single-intake] canonical-order', JSON.stringify({
      intakeOrderId,
      externalId: canonicalOrder.externalId,
      platform: canonicalOrder.platform,
      lineCount: canonicalOrder.lines.length,
      shippingProvider: canonicalOrder.shippingProvider,
      orderAmount: canonicalOrder.orderAmount,
    }));
  }
  let context: ImportContext;
  try {
    context = await loadImportContext(svc, [canonicalOrder]);
  } catch (error) {
    throw new Error(`Load import context gagal untuk order ${canonicalOrder.externalId}: ${describeUnknownError(error)}`);
  }
  if (input.debug) {
    console.log('[single-intake] context-loaded', JSON.stringify({
      businessCount: context.businesses.length,
      existingOrderCount: context.existingByExternalId.size,
      productMappingCount: context.productMappings.length,
    }));
  }
  let resolved: { business: BusinessRow; store: ResolvedStore; resolvedLines: ResolvedLine[] };
  try {
    resolved = (await resolveFromExistingAuthoritativeOrder(context, canonicalOrder))
      || await resolveOrderBusinessAndStore(context, canonicalOrder);
  } catch (error) {
    throw new Error(`Resolve business/store gagal untuk order ${canonicalOrder.externalId}: ${describeUnknownError(error)}`);
  }
  if (input.debug) {
    console.log('[single-intake] resolved-store', JSON.stringify({
      businessCode: resolved.business.business_code,
      storeName: resolved.store.row.store_name,
      storeType: resolved.store.row.store_type,
      lineCount: resolved.resolvedLines.length,
    }));
  }
  await maybePersistResolvedStore(context, resolved.store);
  const built = await buildScalevPayload(context, resolved.business, resolved.store, canonicalOrder, resolved.resolvedLines);
  if (input.debug) {
    const orderVariants = Array.isArray((built.payload as any).ordervariants)
      ? (built.payload as any).ordervariants
      : [];
    const orderBundles = Array.isArray((built.payload as any).orderbundles)
      ? (built.payload as any).orderbundles
      : [];
    console.log('[single-intake] payload-summary', JSON.stringify({
      externalId: canonicalOrder.externalId,
      orderVariantCount: orderVariants.length,
      orderBundleCount: orderBundles.length,
      totalWeightGrams: built.totalWeightGrams,
      storeId: built.payload.store_id,
      courierCode: built.payload.courier_code,
    }));
  }
  if (input.dryRun) {
    return {
      externalId: canonicalOrder.externalId,
      businessCode: resolved.business.business_code,
      storeName: resolved.store.row.store_name,
      localState: context.existingByExternalId.has(canonicalOrder.externalId) ? 'updated' : 'inserted',
      scalevOrderId: null,
      scalevId: null,
      responseStatus: 'dry_run',
    };
  }
  let created: ScalevCreateResponse;
  try {
    created = await createScalevOrder(resolved.business.api_key, built.payload);
  } catch (error) {
    throw new Error(`ScaleV create gagal untuk order ${canonicalOrder.externalId}: ${describeUnknownError(error)}`);
  }
  if (input.debug) {
    const responseData = created.data || created;
    console.log('[single-intake] create-response', JSON.stringify({
      orderId: cleanText(responseData?.order_id),
      scalevId: cleanText(responseData?.id),
      status: cleanText(responseData?.status),
    }));
  }
  const localState = await upsertLocalMarketplaceOrder(
    context,
    resolved.business,
    resolved.store,
    canonicalOrder,
    created,
    built.payload,
  );

  const responseData = created.data || created;
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: `${MARKETPLACE_API_SYNC_TYPE}_single_intake`,
    business_code: resolved.business.business_code,
    orders_fetched: 1,
    orders_inserted: localState === 'inserted' ? 1 : 0,
    orders_updated: localState === 'updated' ? 1 : 0,
    uploaded_by: input.uploadedBy,
    filename: `marketplace_intake_order:${intakeOrderId}`,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  return {
    externalId: canonicalOrder.externalId,
    businessCode: resolved.business.business_code,
    storeName: resolved.store.row.store_name,
    localState,
    scalevOrderId: cleanText(responseData?.order_id),
    scalevId: cleanText(responseData?.id),
    responseStatus: cleanText(responseData?.status),
  };
}

export async function importMarketplaceWorkbook(input: {
  file: File;
  uploadedBy: string | null;
  filenameOverride?: string | null;
}): Promise<ImportResult> {
  const svc = createServiceSupabase();
  const filename = cleanText(input.filenameOverride) || input.file.name;
  const parsed = await parseMarketplaceWorkbook(input.file);
  const stats: ImportStats = {
    totalRows: parsed.rowCount,
    totalOrders: parsed.orders.length,
    newInserted: 0,
    updated: 0,
    errors: [],
    skipped: 0,
    lineItems: parsed.orders.reduce((sum, order) => sum + order.lines.length, 0),
    scalevCreated: 0,
    format: 'marketplace-api',
  };

  const importableOrders = parsed.orders.filter((order) => !shouldSkipOrderStatus(order.status));
  const context = await loadImportContext(svc, importableOrders);
  const businessesTouched = new Set<string>();

  for (const order of importableOrders) {
    try {
      const existing = context.existingByExternalId.get(order.externalId);
      if (existing) {
        stats.updated++;
        continue;
      }

      const resolved = await resolveOrderBusinessAndStore(context, order);
      businessesTouched.add(resolved.business.business_code);
      await maybePersistResolvedStore(context, resolved.store);
      const built = await buildScalevPayload(context, resolved.business, resolved.store, order, resolved.resolvedLines);
      const created = await createScalevOrder(resolved.business.api_key, built.payload);
      stats.scalevCreated++;
      const localState = await upsertLocalMarketplaceOrder(
        context,
        resolved.business,
        resolved.store,
        order,
        created,
        built.payload,
      );
      if (localState === 'inserted') stats.newInserted++;
      else stats.updated++;
    } catch (error: any) {
      stats.errors.push(`${order.externalId}: ${error?.message || 'Unknown error'}`);
    }
  }

  stats.skipped = parsed.orders.length - importableOrders.length;

  await svc.from('scalev_sync_log').insert({
    status: stats.errors.length > 0 ? (stats.scalevCreated > 0 ? 'partial' : 'failed') : 'success',
    sync_type: MARKETPLACE_API_SYNC_TYPE,
    business_code: businessesTouched.size === 1 ? Array.from(businessesTouched)[0] : null,
    orders_fetched: stats.totalOrders,
    orders_inserted: stats.newInserted,
    orders_updated: stats.updated,
    uploaded_by: input.uploadedBy,
    filename,
    error_message: stats.errors.length > 0 ? stats.errors.slice(0, 10).join('; ') : null,
    completed_at: new Date().toISOString(),
  });

  return {
    success: true,
    filename,
    stats: {
      totalRows: stats.totalRows,
      totalOrders: stats.totalOrders,
      newInserted: stats.newInserted,
      updated: stats.updated,
      errors: stats.errors.length,
      errorDetails: stats.errors.slice(0, 10),
      skipped: stats.skipped,
      lineItems: stats.lineItems,
      scalevCreated: stats.scalevCreated,
      format: stats.format,
    },
    message: `Upload marketplace selesai. ${stats.scalevCreated} order berhasil dibuat di Scalev, ${stats.newInserted} order masuk ke app, ${stats.errors.length} error.`,
  };
}
