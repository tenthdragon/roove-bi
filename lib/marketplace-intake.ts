import * as XLSX from 'xlsx';
import { createServiceSupabase } from './service-supabase';

const SHOPEE_RLT_SOURCE = {
  id: null as number | null,
  sourceKey: 'shopee_rlt',
  sourceLabel: 'Shopee RLT',
  platform: 'shopee' as const,
  businessCode: 'RLT',
  allowedStores: [
    'Roove Main Store - Marketplace',
    'Globite Store - Marketplace',
    'Pluve Main Store - Marketplace',
    'Purvu Store - Marketplace',
    'Purvu The Secret Store - Markerplace',
    'YUV Deodorant Serum Store - Marketplace',
    'Osgard Oil Store',
    'drHyun Main Store - Marketplace',
    'Calmara Main Store - Marketplace',
  ],
};

type SheetRow = Record<string, unknown>;

type BusinessRow = {
  id: number;
  business_code: string;
  business_name: string | null;
  is_active: boolean | null;
};

type BundleIdentifierRow = {
  business_id: number;
  entity_type: 'bundle';
  entity_key: string;
  entity_label: string;
  scalev_bundle_id: number | null;
  identifier: string;
  identifier_normalized: string;
  source: 'bundle.custom_id';
};

type BundleCatalogRow = {
  business_id: number;
  scalev_bundle_id: number;
  name: string | null;
  public_name: string | null;
  display: string | null;
  custom_id: string | null;
};

type ManualMemoryRow = {
  id: number;
  source_key: string;
  business_code: string;
  match_signature: string;
  target_entity_key: string;
  target_entity_label: string;
  target_custom_id: string | null;
  scalev_bundle_id: number;
  mapped_store_name: string | null;
  usage_count: number;
  is_active: boolean;
};

type CanonicalLine = {
  sku: string | null;
  productName: string;
  variation: string | null;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  lineDiscount: number;
  rawRow: Record<string, string>;
};

type CanonicalOrder = {
  platform: 'shopee';
  externalId: string;
  status: string | null;
  substatus: string | null;
  paymentMethodLabel: string | null;
  createdAt: string | null;
  paidAt: string | null;
  rtsAt: string | null;
  deliveredAt: string | null;
  trackingNumber: string | null;
  shippingProvider: string | null;
  deliveryOption: string | null;
  customerUsername: string | null;
  customerName: string | null;
  customerPhone: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  postalCode: string | null;
  address: string | null;
  addressNotes: string | null;
  rawAddress: string | null;
  shippingCost: number;
  orderAmount: number;
  lines: CanonicalLine[];
  rawMeta: Record<string, string>;
};

type PreviewLineStatus = 'identified' | 'not_identified' | 'store_unmapped' | 'entity_mismatch';
type PreviewOrderStatus = 'ready' | 'needs_review';
type PreviewStoreResolution = 'single_store' | 'dominant_amount' | 'unclassified' | 'ambiguous';

export type MarketplaceIntakeSuggestionCandidate = {
  entityKey: string;
  entityLabel: string;
  customId: string | null;
  scalevBundleId: number;
  storeName: string | null;
  classifierLabel: string | null;
  score: number;
  source: 'remembered' | 'catalog' | 'manual';
};

export type MarketplaceIntakePreviewLine = {
  lineIndex: number;
  lineStatus: PreviewLineStatus;
  issueCodes: string[];
  mpSku: string | null;
  mpProductName: string;
  mpVariation: string | null;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  lineDiscount: number;
  detectedCustomId: string | null;
  matchedEntityType: 'bundle' | null;
  matchedEntityKey: string | null;
  matchedEntityLabel: string | null;
  matchedEntitySource: string | null;
  matchedScalevProductId: number | null;
  matchedScalevVariantId: number | null;
  matchedScalevBundleId: number | null;
  matchedRuleId: number | null;
  matchedRuleLabel: string | null;
  mappedSourceStoreId: number | null;
  mappedStoreName: string | null;
  matchSignature: string;
  suggestionCandidates: MarketplaceIntakeSuggestionCandidate[];
  selectedSuggestion: MarketplaceIntakeSuggestionCandidate | null;
  rawRow: Record<string, string>;
};

export type MarketplaceIntakePreviewOrder = {
  externalOrderId: string;
  orderStatus: PreviewOrderStatus;
  finalSourceStoreId: number | null;
  finalStoreName: string | null;
  finalStoreResolution: PreviewStoreResolution;
  issueCodes: string[];
  lineCount: number;
  identifiedLineCount: number;
  classifiedLineCount: number;
  issueCount: number;
  isMixedStore: boolean;
  hasUnidentified: boolean;
  customerLabel: string | null;
  recipientName: string | null;
  trackingNumber: string | null;
  paymentMethodLabel: string | null;
  shippingProvider: string | null;
  deliveryOption: string | null;
  orderAmount: number;
  rawMeta: Record<string, unknown>;
  lines: MarketplaceIntakePreviewLine[];
};

export type MarketplaceIntakePreviewSummary = {
  totalOrders: number;
  totalLines: number;
  readyOrders: number;
  needsReviewOrders: number;
  mixedStoreOrders: number;
  identifiedLines: number;
  classifiedLines: number;
  unidentifiedLines: number;
  unresolvedStoreLines: number;
};

export type MarketplaceIntakePreview = {
  source: {
    id: number | null;
    sourceKey: string;
    sourceLabel: string;
    platform: 'shopee';
    businessId: number;
    businessCode: string;
  };
  filename: string;
  sourceOrderDate: string | null;
  rowCount: number;
  platform: 'shopee';
  generatedAt: string;
  summary: MarketplaceIntakePreviewSummary;
  orders: MarketplaceIntakePreviewOrder[];
};

export type MarketplaceIntakeManualSelectionInput = {
  externalOrderId: string;
  lineIndex: number;
  scalevBundleId: number;
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

function toJakartaDateKey(value: string | null | undefined): string | null {
  const text = String(value || '').trim();
  if (!text) return null;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function inferSourceOrderDate(orders: CanonicalOrder[]): string | null {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const key = toJakartaDateKey(order.createdAt) || toJakartaDateKey(order.paidAt);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const ranked = Array.from(counts.entries()).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  });

  return ranked[0]?.[0] || null;
}

function normalizePhone(value: string | null): string | null {
  const digits = String(value || '').replace(/[^\d]+/g, '');
  if (!digits) return null;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('8')) return `62${digits}`;
  return digits;
}

function toRawStringRow(row: SheetRow): Record<string, string> {
  const entries = Object.entries(row).map(([key, value]) => [key, String(value ?? '').trim()]);
  return Object.fromEntries(entries);
}

function isBlankRow(row: Record<string, string>): boolean {
  return Object.values(row).every((value) => !cleanText(value));
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
  }
  return Array.from(grouped.values());
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
    const quantity = Math.max(parseInteger(row.Jumlah) || 1, 1);
    const discountedUnitPrice = parseNumber(row['Harga Setelah Diskon']) || parseNumber(row['Harga Awal']);
    const line: CanonicalLine = {
      sku: cleanText(row['Nomor Referensi SKU']) || cleanText(row['SKU Induk']),
      productName: cleanText(row['Nama Produk']) || 'Produk Marketplace',
      variation: cleanText(row['Nama Variasi']),
      quantity,
      unitPrice: discountedUnitPrice,
      lineSubtotal: discountedUnitPrice * quantity,
      lineDiscount: parseNumber(row['Diskon Dari Penjual']) + parseNumber(row['Diskon Dari Shopee']),
      rawRow: row,
    };

    if (existing) {
      existing.lines.push(line);
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
      deliveredAt: parseDateTime(row['Waktu Pesanan Selesai']),
      trackingNumber: cleanText(row['No. Resi']),
      shippingProvider: cleanText(row['Opsi Pengiriman']),
      deliveryOption: cleanText(row['Antar ke counter/ pick-up']),
      customerUsername: cleanText(row['Username (Pembeli)']),
      customerName: cleanText(row['Nama Penerima']) || cleanText(row['Username (Pembeli)']),
      customerPhone: normalizePhone(cleanText(row['No. Telepon'])),
      province,
      city,
      district: parsedAddress.district,
      postalCode: parsedAddress.postalCode,
      address: parsedAddress.address,
      addressNotes: cleanText(row.Catatan) || cleanText(row['Catatan dari Pembeli']),
      rawAddress: cleanText(row['Alamat Pengiriman']),
      shippingCost: parseNumber(row['Ongkos Kirim Dibayar oleh Pembeli']) || parseNumber(row['Perkiraan Ongkos Kirim']),
      orderAmount: parseNumber(row['Total Pembayaran']) || parseNumber(row['Dibayar Pembeli']),
      lines: [line],
      rawMeta: {
        marketplaceStatus: cleanText(row['Status Pesanan']) || '',
        cancellationStatus: cleanText(row['Status Pembatalan/ Pengembalian']) || '',
      },
    });
  }

  return Array.from(orders.values()).map((order) => ({
    ...order,
    lines: aggregateCanonicalLines(order.lines),
  }));
}

async function parseShopeeWorkbook(file: File): Promise<{ orders: CanonicalOrder[]; rowCount: number }> {
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

  const headers = Object.keys(stringRows[0]);
  if (!headers.includes('No. Pesanan')) {
    throw new Error('Halaman ini saat ini hanya menerima export Shopee/SPX yang memiliki kolom "No. Pesanan".');
  }

  return {
    orders: parseShopeeOrders(stringRows),
    rowCount: stringRows.length,
  };
}

function isMissingTableError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST205'
    || code === '42P01'
    || code === '42703'
    || /does not exist/i.test(message)
    || /schema cache/i.test(message)
    || /column .* does not exist/i.test(message);
}

function getMissingSchemaMessage() {
  return 'Schema marketplace intake atau katalog Scalev belum lengkap. Jalankan migration intake terbaru dan sync katalog Scalev terlebih dahulu.';
}

async function loadRltBusiness(): Promise<BusinessRow> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id, business_code, business_name, is_active')
    .eq('business_code', SHOPEE_RLT_SOURCE.businessCode)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) throw new Error(getMissingSchemaMessage());
    throw error;
  }
  if (!data) {
    throw new Error('Business RLT tidak ditemukan di konfigurasi Scalev.');
  }

  return data as BusinessRow;
}

async function loadBundleIdentifierLookup(businessId: number, normalizedIdentifiers: string[]) {
  const svc = createServiceSupabase();
  if (normalizedIdentifiers.length === 0) return new Map<string, BundleIdentifierRow[]>();

  const { data, error } = await svc
    .from('scalev_catalog_identifiers')
    .select(`
      business_id,
      entity_type,
      entity_key,
      entity_label,
      scalev_bundle_id,
      identifier,
      identifier_normalized,
      source
    `)
    .eq('business_id', businessId)
    .eq('entity_type', 'bundle')
    .eq('source', 'bundle.custom_id')
    .in('identifier_normalized', normalizedIdentifiers);

  if (error) {
    if (isMissingTableError(error)) throw new Error(getMissingSchemaMessage());
    throw error;
  }

  const lookup = new Map<string, BundleIdentifierRow[]>();
  for (const row of (data || []) as BundleIdentifierRow[]) {
    const key = normalizeIdentifier(row.identifier_normalized || row.identifier);
    if (!key) continue;
    if (!lookup.has(key)) lookup.set(key, []);
    lookup.get(key)!.push(row);
  }
  return lookup;
}

async function loadRltBundleCatalog(businessId: number): Promise<BundleCatalogRow[]> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_catalog_bundles')
    .select('business_id, scalev_bundle_id, name, public_name, display, custom_id')
    .eq('business_id', businessId)
    .order('scalev_bundle_id', { ascending: true });

  if (error) {
    if (isMissingTableError(error)) throw new Error(getMissingSchemaMessage());
    throw error;
  }

  return (data || []) as BundleCatalogRow[];
}

async function loadManualMemoryMap(businessId: number): Promise<Map<string, ManualMemoryRow>> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('marketplace_intake_manual_memory')
    .select(`
      id,
      source_key,
      business_code,
      match_signature,
      target_entity_key,
      target_entity_label,
      target_custom_id,
      scalev_bundle_id,
      mapped_store_name,
      usage_count,
      is_active
    `)
    .eq('source_key', SHOPEE_RLT_SOURCE.sourceKey)
    .eq('business_id', businessId)
    .eq('is_active', true);

  if (error) {
    if (isMissingTableError(error)) return new Map<string, ManualMemoryRow>();
    throw error;
  }

  const map = new Map<string, ManualMemoryRow>();
  for (const row of (data || []) as ManualMemoryRow[]) {
    map.set(String(row.match_signature || ''), row);
  }
  return map;
}

function buildMatchSignature(line: Pick<CanonicalLine, 'sku' | 'productName' | 'variation'>): string {
  return [
    normalizeIdentifier(line.sku) || '__blank__',
    normalizeIdentifier(line.productName) || '__blank__',
    normalizeIdentifier(line.variation) || '__blank__',
  ].join('|');
}

function getBundleDisplayLabel(bundle: Pick<BundleCatalogRow, 'display' | 'public_name' | 'name' | 'custom_id'>): string {
  return bundle.display || bundle.public_name || bundle.name || bundle.custom_id || 'Bundle';
}

function buildSuggestionCandidateFromBundle(
  bundle: BundleCatalogRow,
  source: 'remembered' | 'catalog' | 'manual',
  score: number,
): MarketplaceIntakeSuggestionCandidate {
  const classifier = classifyShopeeRltStore({
    customId: bundle.custom_id,
    entityLabel: getBundleDisplayLabel(bundle),
    productName: getBundleDisplayLabel(bundle),
  });

  return {
    entityKey: `bundle:${bundle.scalev_bundle_id}`,
    entityLabel: getBundleDisplayLabel(bundle),
    customId: bundle.custom_id,
    scalevBundleId: bundle.scalev_bundle_id,
    storeName: classifier.storeName,
    classifierLabel: classifier.classifierLabel,
    score,
    source,
  };
}

function scoreBundleCandidateForLine(line: CanonicalLine, bundle: BundleCatalogRow): number {
  const query = normalizeIdentifier([line.productName, line.variation, line.sku].filter(Boolean).join(' '));
  const compactQuery = normalizeLoose([line.productName, line.variation, line.sku].filter(Boolean).join(' '));
  const label = normalizeIdentifier([bundle.display, bundle.public_name, bundle.name].filter(Boolean).join(' '));
  const compactLabel = normalizeLoose([bundle.display, bundle.public_name, bundle.name, bundle.custom_id].filter(Boolean).join(' '));
  const compactCustomId = normalizeLoose(bundle.custom_id);
  const queryTokens = query.split(' ').filter(Boolean);
  const labelTokens = new Set(label.split(' ').filter(Boolean));
  const customIdText = String(bundle.custom_id || '').toUpperCase();

  let score = 0;
  if (!query && !compactQuery) return score;
  if (compactCustomId && compactQuery && compactCustomId === compactQuery) score += 500;
  if (compactCustomId && compactQuery && compactCustomId.startsWith(compactQuery)) score += 300;
  if (compactLabel && compactQuery && compactLabel.includes(compactQuery)) score += 250;
  if (label && query && label === query) score += 220;
  if (label && query && label.includes(query)) score += 180;
  if (query && label && query.includes(label)) score += 150;

  for (const token of queryTokens) {
    if (labelTokens.has(token)) score += 35;
  }

  if (queryTokens.includes('shaker')) {
    if (label.includes('shaker')) score += 160;
    if (compactCustomId.includes('shaker')) score += 160;
    if (label.startsWith('shaker') || compactCustomId.startsWith('shaker')) score += 220;
  }

  if (queryTokens.includes('mini')) {
    if (label.includes('mini')) score += 120;
    if (compactCustomId.includes('mini')) score += 120;
  }

  const comboCount = (customIdText.match(/\+/g) || []).length;
  if (comboCount > 0) {
    score -= comboCount * 40;
  }

  const bundleStore = classifyShopeeRltStore({
    customId: bundle.custom_id,
    entityLabel: getBundleDisplayLabel(bundle),
    productName: line.productName,
  }).storeName;
  if (bundleStore === 'Roove Main Store - Marketplace' && normalizeIdentifier(line.productName).includes('roove')) score += 80;
  if (bundleStore === 'Purvu The Secret Store - Markerplace' && normalizeIdentifier(line.productName).includes('secret')) score += 80;

  return score;
}

function buildSuggestionCandidates(
  line: CanonicalLine,
  bundleCatalog: BundleCatalogRow[],
  remembered: ManualMemoryRow | null,
): {
  suggestions: MarketplaceIntakeSuggestionCandidate[];
  selected: MarketplaceIntakeSuggestionCandidate | null;
} {
  const seen = new Set<string>();
  const suggestions: MarketplaceIntakeSuggestionCandidate[] = [];
  let selected: MarketplaceIntakeSuggestionCandidate | null = null;

  if (remembered) {
    const rememberedBundle = bundleCatalog.find((bundle) => bundle.scalev_bundle_id === remembered.scalev_bundle_id);
    if (rememberedBundle) {
      const candidate = buildSuggestionCandidateFromBundle(rememberedBundle, 'remembered', 10000);
      suggestions.push(candidate);
      selected = candidate;
      seen.add(candidate.entityKey);
    }
  }

  const ranked = bundleCatalog
    .map((bundle) => ({
      bundle,
      score: scoreBundleCandidateForLine(line, bundle),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);

  for (const entry of ranked) {
    const candidate = buildSuggestionCandidateFromBundle(entry.bundle, 'catalog', entry.score);
    if (seen.has(candidate.entityKey)) continue;
    suggestions.push(candidate);
    seen.add(candidate.entityKey);
  }

  return {
    suggestions,
    selected,
  };
}

function buildLineFromBundleCandidate(
  line: CanonicalLine,
  lineIndex: number,
  candidate: MarketplaceIntakeSuggestionCandidate,
  source: 'direct' | 'remembered' | 'manual',
): MarketplaceIntakePreviewLine {
  const issueCodes = source === 'remembered'
    ? ['remembered_manual_match']
    : source === 'manual'
      ? ['manual_match_confirmed']
      : [];

  return {
    lineIndex,
    lineStatus: 'identified',
    issueCodes,
    mpSku: line.sku,
    mpProductName: line.productName,
    mpVariation: line.variation,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineSubtotal: line.lineSubtotal,
    lineDiscount: line.lineDiscount,
    detectedCustomId: candidate.customId,
    matchedEntityType: 'bundle',
    matchedEntityKey: candidate.entityKey,
    matchedEntityLabel: candidate.entityLabel,
    matchedEntitySource: source === 'direct' ? 'bundle.custom_id' : source === 'remembered' ? 'manual.memory' : 'manual.selection',
    matchedScalevProductId: null,
    matchedScalevVariantId: null,
    matchedScalevBundleId: candidate.scalevBundleId,
    matchedRuleId: null,
    matchedRuleLabel: candidate.classifierLabel,
    mappedSourceStoreId: null,
    mappedStoreName: candidate.storeName,
    matchSignature: buildMatchSignature(line),
    suggestionCandidates: [candidate],
    selectedSuggestion: candidate,
    rawRow: line.rawRow,
  };
}

function resolveBundleIdentifierForSku(
  sku: string | null,
  identifierLookup: Map<string, BundleIdentifierRow[]>,
): { status: 'matched'; row: BundleIdentifierRow } | { status: 'missing' } | { status: 'ambiguous'; rows: BundleIdentifierRow[] } {
  const normalized = normalizeIdentifier(sku);
  if (!normalized) return { status: 'missing' };

  const rows = (identifierLookup.get(normalized) || []).slice().sort((left, right) => {
    return String(left.entity_key || '').localeCompare(String(right.entity_key || ''));
  });
  if (rows.length === 0) return { status: 'missing' };

  const distinctEntityKeys = Array.from(new Set(rows.map((row) => row.entity_key)));
  if (distinctEntityKeys.length === 1) return { status: 'matched', row: rows[0] };
  return { status: 'ambiguous', rows };
}

function classifyShopeeRltStore(input: {
  customId: string | null;
  entityLabel: string | null;
  productName: string | null;
}): {
  storeName: string | null;
  classifierLabel: string | null;
} {
  const customId = normalizeLoose(input.customId);
  const label = normalizeIdentifier([input.entityLabel, input.productName].filter(Boolean).join(' '));

  if (customId.startsWith('rov') || label.includes('roove')) {
    return {
      storeName: 'Roove Main Store - Marketplace',
      classifierLabel: 'Classifier: ROV / Roove',
    };
  }
  if (customId.startsWith('glb') || label.includes('globite')) {
    return {
      storeName: 'Globite Store - Marketplace',
      classifierLabel: 'Classifier: GLB / Globite',
    };
  }
  if (customId.startsWith('plv') || label.includes('pluve')) {
    return {
      storeName: 'Pluve Main Store - Marketplace',
      classifierLabel: 'Classifier: PLV / Pluve',
    };
  }
  if (customId.startsWith('ogd') || label.includes('osgard')) {
    return {
      storeName: 'Osgard Oil Store',
      classifierLabel: 'Classifier: OGD / Osgard',
    };
  }
  if (customId.startsWith('srt') || label.includes('the secret') || (label.includes('purvu') && label.includes('secret'))) {
    return {
      storeName: 'Purvu The Secret Store - Markerplace',
      classifierLabel: 'Classifier: SRT / Purvu Secret',
    };
  }
  if (customId.startsWith('pam') || (label.includes('purvu') && !label.includes('secret'))) {
    return {
      storeName: 'Purvu Store - Marketplace',
      classifierLabel: 'Classifier: PAM / Purvu',
    };
  }
  if (customId.startsWith('yuv') || label.includes('yuv')) {
    return {
      storeName: 'YUV Deodorant Serum Store - Marketplace',
      classifierLabel: 'Classifier: YUV',
    };
  }
  if (customId.startsWith('drh') || label.includes('drhyun') || label.includes('dr hyun')) {
    return {
      storeName: 'drHyun Main Store - Marketplace',
      classifierLabel: 'Classifier: DRH / drHyun',
    };
  }
  if (customId.startsWith('clm') || customId.startsWith('cal') || label.includes('calmara')) {
    return {
      storeName: 'Calmara Main Store - Marketplace',
      classifierLabel: 'Classifier: CAL / Calmara',
    };
  }

  return {
    storeName: null,
    classifierLabel: null,
  };
}

function buildOrderCustomerLabel(order: CanonicalOrder): string | null {
  return order.customerName || order.customerUsername || null;
}

function summarizeOrderFromLines(
  order: CanonicalOrder,
  lines: MarketplaceIntakePreviewLine[],
  extraIssueCodes: string[] = [],
): MarketplaceIntakePreviewOrder {
  const issueCodes = new Set<string>(extraIssueCodes);

  const identifiedLineCount = lines.filter((line) => line.lineStatus !== 'not_identified').length;
  const classifiedLineCount = lines.filter((line) => line.lineStatus === 'identified').length;
  const hasUnidentified = lines.some((line) => line.lineStatus === 'not_identified');

  const storeTotals = new Map<string, number>();
  for (const line of lines) {
    (line.issueCodes || []).forEach((code) => issueCodes.add(code));
    if (!line.mappedStoreName || line.lineStatus !== 'identified') continue;
    storeTotals.set(line.mappedStoreName, (storeTotals.get(line.mappedStoreName) || 0) + line.lineSubtotal);
  }

  let finalStoreName: string | null = null;
  let finalStoreResolution: PreviewStoreResolution = 'unclassified';
  let orderStatus: PreviewOrderStatus = 'needs_review';

  if (classifiedLineCount === lines.length && storeTotals.size === 1) {
    finalStoreName = Array.from(storeTotals.keys())[0];
    finalStoreResolution = 'single_store';
    orderStatus = 'ready';
  } else if (classifiedLineCount === lines.length && storeTotals.size > 1) {
    const ranked = Array.from(storeTotals.entries()).sort((left, right) => right[1] - left[1]);
    if (ranked[0] && ranked[1] && ranked[0][1] === ranked[1][1]) {
      issueCodes.add('store_amount_tie');
      finalStoreResolution = 'ambiguous';
    } else if (ranked[0]) {
      finalStoreName = ranked[0][0];
      finalStoreResolution = 'dominant_amount';
      orderStatus = 'ready';
    }
  }

  if (lines.some((line) => line.lineStatus === 'store_unmapped')) {
    issueCodes.add('store_classifier_missing');
  }

  const computedOrderAmount = order.orderAmount > 0
    ? order.orderAmount
    : order.lines.reduce((sum, line) => sum + line.lineSubtotal, 0);

  return {
    externalOrderId: order.externalId,
    orderStatus,
    finalSourceStoreId: null,
    finalStoreName,
    finalStoreResolution,
    issueCodes: Array.from(issueCodes),
    lineCount: lines.length,
    identifiedLineCount,
    classifiedLineCount,
    issueCount: issueCodes.size,
    isMixedStore: storeTotals.size > 1,
    hasUnidentified,
    customerLabel: buildOrderCustomerLabel(order),
    recipientName: order.customerName,
    trackingNumber: order.trackingNumber,
    paymentMethodLabel: order.paymentMethodLabel,
    shippingProvider: order.shippingProvider,
    deliveryOption: order.deliveryOption,
    orderAmount: computedOrderAmount,
    rawMeta: {
      platform: order.platform,
      status: order.status,
      substatus: order.substatus,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      rtsAt: order.rtsAt,
      deliveredAt: order.deliveredAt,
      customerUsername: order.customerUsername,
      customerPhone: order.customerPhone,
      province: order.province,
      city: order.city,
      district: order.district,
      postalCode: order.postalCode,
      address: order.address,
      addressNotes: order.addressNotes,
      rawAddress: order.rawAddress,
      shippingCost: order.shippingCost,
      ...order.rawMeta,
    },
    lines,
  };
}

function classifyOrder(
  order: CanonicalOrder,
  identifierLookup: Map<string, BundleIdentifierRow[]>,
  bundleCatalog: BundleCatalogRow[],
  manualMemoryMap: Map<string, ManualMemoryRow>,
): MarketplaceIntakePreviewOrder {
  const issueCodes = new Set<string>();

  const lines: MarketplaceIntakePreviewLine[] = order.lines.map((line, index) => {
    const matchSignature = buildMatchSignature(line);
    const identifier = resolveBundleIdentifierForSku(line.sku, identifierLookup);
    if (identifier.status === 'missing') {
      const { suggestions, selected } = buildSuggestionCandidates(line, bundleCatalog, manualMemoryMap.get(matchSignature) || null);
      if (selected && selected.storeName) {
        return buildLineFromBundleCandidate(line, index, selected, 'remembered');
      }
      issueCodes.add('custom_id_not_found');
      return {
        lineIndex: index,
        lineStatus: 'not_identified',
        issueCodes: ['custom_id_not_found'],
        mpSku: line.sku,
        mpProductName: line.productName,
        mpVariation: line.variation,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineSubtotal: line.lineSubtotal,
        lineDiscount: line.lineDiscount,
        detectedCustomId: line.sku,
        matchedEntityType: null,
        matchedEntityKey: null,
        matchedEntityLabel: null,
        matchedEntitySource: null,
        matchedScalevProductId: null,
        matchedScalevVariantId: null,
        matchedScalevBundleId: null,
        matchedRuleId: null,
        matchedRuleLabel: null,
        mappedSourceStoreId: null,
        mappedStoreName: null,
        matchSignature,
        suggestionCandidates: suggestions,
        selectedSuggestion: selected,
        rawRow: line.rawRow,
      };
    }

    if (identifier.status === 'ambiguous') {
      const { suggestions, selected } = buildSuggestionCandidates(line, bundleCatalog, manualMemoryMap.get(matchSignature) || null);
      if (selected && selected.storeName) {
        return buildLineFromBundleCandidate(line, index, selected, 'remembered');
      }
      issueCodes.add('custom_id_ambiguous');
      return {
        lineIndex: index,
        lineStatus: 'not_identified',
        issueCodes: ['custom_id_ambiguous'],
        mpSku: line.sku,
        mpProductName: line.productName,
        mpVariation: line.variation,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineSubtotal: line.lineSubtotal,
        lineDiscount: line.lineDiscount,
        detectedCustomId: line.sku,
        matchedEntityType: null,
        matchedEntityKey: null,
        matchedEntityLabel: null,
        matchedEntitySource: null,
        matchedScalevProductId: null,
        matchedScalevVariantId: null,
        matchedScalevBundleId: null,
        matchedRuleId: null,
        matchedRuleLabel: null,
        mappedSourceStoreId: null,
        mappedStoreName: null,
        matchSignature,
        suggestionCandidates: suggestions,
        selectedSuggestion: selected,
        rawRow: line.rawRow,
      };
    }

    const match = identifier.row;
    const directCandidate: MarketplaceIntakeSuggestionCandidate = {
      entityKey: match.entity_key,
      entityLabel: match.entity_label,
      customId: match.identifier,
      scalevBundleId: Number(match.scalev_bundle_id || 0),
      storeName: null,
      classifierLabel: null,
      score: 9999,
      source: 'catalog',
    };
    const storeClassification = classifyShopeeRltStore({
      customId: match.identifier,
      entityLabel: match.entity_label,
      productName: line.productName,
    });
    directCandidate.storeName = storeClassification.storeName;
    directCandidate.classifierLabel = storeClassification.classifierLabel;

    if (!storeClassification.storeName || !SHOPEE_RLT_SOURCE.allowedStores.includes(storeClassification.storeName)) {
      issueCodes.add('store_classifier_missing');
      return {
        lineIndex: index,
        lineStatus: 'store_unmapped',
        issueCodes: ['store_classifier_missing'],
        mpSku: line.sku,
        mpProductName: line.productName,
        mpVariation: line.variation,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineSubtotal: line.lineSubtotal,
        lineDiscount: line.lineDiscount,
        detectedCustomId: match.identifier,
        matchedEntityType: 'bundle',
        matchedEntityKey: match.entity_key,
        matchedEntityLabel: match.entity_label,
        matchedEntitySource: match.source,
        matchedScalevProductId: null,
        matchedScalevVariantId: null,
        matchedScalevBundleId: match.scalev_bundle_id,
        matchedRuleId: null,
        matchedRuleLabel: null,
        mappedSourceStoreId: null,
        mappedStoreName: null,
        matchSignature,
        suggestionCandidates: [directCandidate],
        selectedSuggestion: null,
        rawRow: line.rawRow,
      };
    }

    return buildLineFromBundleCandidate(line, index, directCandidate, 'direct');
  });

  return summarizeOrderFromLines(order, lines, Array.from(issueCodes));
}

function buildPreviewSummary(orders: MarketplaceIntakePreviewOrder[]): MarketplaceIntakePreviewSummary {
  const totalLines = orders.reduce((sum, order) => sum + order.lineCount, 0);
  const identifiedLines = orders.reduce((sum, order) => sum + order.identifiedLineCount, 0);
  const classifiedLines = orders.reduce((sum, order) => sum + order.classifiedLineCount, 0);
  const unidentifiedLines = orders.reduce(
    (sum, order) => sum + order.lines.filter((line) => line.lineStatus === 'not_identified').length,
    0,
  );
  const unresolvedStoreLines = orders.reduce(
    (sum, order) => sum + order.lines.filter((line) => line.lineStatus === 'store_unmapped' || line.lineStatus === 'entity_mismatch').length,
    0,
  );

  return {
    totalOrders: orders.length,
    totalLines,
    readyOrders: orders.filter((order) => order.orderStatus === 'ready').length,
    needsReviewOrders: orders.filter((order) => order.orderStatus === 'needs_review').length,
    mixedStoreOrders: orders.filter((order) => order.isMixedStore).length,
    identifiedLines,
    classifiedLines,
    unidentifiedLines,
    unresolvedStoreLines,
  };
}

export async function previewShopeeRltIntake(input: {
  file: File;
  filenameOverride?: string | null;
}): Promise<MarketplaceIntakePreview> {
  const business = await loadRltBusiness();
  const { orders, rowCount } = await parseShopeeWorkbook(input.file);
  const sourceOrderDate = inferSourceOrderDate(orders);
  const [bundleCatalog, manualMemoryMap] = await Promise.all([
    loadRltBundleCatalog(business.id),
    loadManualMemoryMap(business.id),
  ]);

  const normalizedIdentifiers = Array.from(new Set(
    orders
      .flatMap((order) => order.lines.map((line) => normalizeIdentifier(line.sku)))
      .filter(Boolean),
  ));
  const identifierLookup = await loadBundleIdentifierLookup(business.id, normalizedIdentifiers);

  const previewOrders = orders
    .map((order) => classifyOrder(order, identifierLookup, bundleCatalog, manualMemoryMap))
    .sort((left, right) => left.externalOrderId.localeCompare(right.externalOrderId));

  return {
    source: {
      id: SHOPEE_RLT_SOURCE.id,
      sourceKey: SHOPEE_RLT_SOURCE.sourceKey,
      sourceLabel: SHOPEE_RLT_SOURCE.sourceLabel,
      platform: SHOPEE_RLT_SOURCE.platform,
      businessId: business.id,
      businessCode: business.business_code,
    },
    filename: String(input.filenameOverride || input.file.name || 'shopee-rlt-upload'),
    sourceOrderDate,
    rowCount,
    platform: 'shopee',
    generatedAt: new Date().toISOString(),
    summary: buildPreviewSummary(previewOrders),
    orders: previewOrders,
  };
}

export async function saveMarketplaceIntakePreview(input: {
  preview: MarketplaceIntakePreview;
  uploadedByEmail: string | null;
  manualSelections?: MarketplaceIntakeManualSelectionInput[];
}) {
  const business = await loadRltBusiness();
  const preview = input.preview;

  if (!preview?.source || preview.source.sourceKey !== SHOPEE_RLT_SOURCE.sourceKey) {
    throw new Error('Preview intake tidak valid untuk Shopee RLT.');
  }
  if (Number(preview.source.businessId || 0) !== business.id) {
    throw new Error('Business preview berubah. Refresh preview lalu coba simpan lagi.');
  }

  const bundleCatalog = await loadRltBundleCatalog(business.id);
  const bundleById = new Map<number, BundleCatalogRow>(bundleCatalog.map((bundle) => [bundle.scalev_bundle_id, bundle]));
  const selectionMap = new Map<string, MarketplaceIntakeManualSelectionInput>();
  for (const selection of input.manualSelections || []) {
    const key = `${selection.externalOrderId}::${selection.lineIndex}`;
    selectionMap.set(key, selection);
  }

  const normalizedOrders = (preview.orders || []).map((order) => {
    const lines = (order.lines || []).map((line) => {
      const selection = selectionMap.get(`${order.externalOrderId}::${line.lineIndex}`);
      if (!selection) return line;

      const bundle = bundleById.get(Number(selection.scalevBundleId || 0));
      if (!bundle) return line;

      const candidate = buildSuggestionCandidateFromBundle(bundle, 'manual', 99999);
      if (!candidate.storeName || !SHOPEE_RLT_SOURCE.allowedStores.includes(candidate.storeName)) return line;

      return buildLineFromBundleCandidate({
        sku: line.mpSku,
        productName: line.mpProductName,
        variation: line.mpVariation,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineSubtotal: line.lineSubtotal,
        lineDiscount: line.lineDiscount,
        rawRow: line.rawRow,
      }, line.lineIndex, candidate, 'manual');
    });

    return summarizeOrderFromLines({
      platform: 'shopee',
      externalId: order.externalOrderId,
      status: String(order.rawMeta?.status || '') || null,
      substatus: String(order.rawMeta?.substatus || '') || null,
      paymentMethodLabel: order.paymentMethodLabel,
      createdAt: String(order.rawMeta?.createdAt || '') || null,
      paidAt: String(order.rawMeta?.paidAt || '') || null,
      rtsAt: String(order.rawMeta?.rtsAt || '') || null,
      deliveredAt: String(order.rawMeta?.deliveredAt || '') || null,
      trackingNumber: order.trackingNumber,
      shippingProvider: order.shippingProvider,
      deliveryOption: order.deliveryOption,
      customerUsername: String(order.rawMeta?.customerUsername || '') || null,
      customerName: order.recipientName,
      customerPhone: String(order.rawMeta?.customerPhone || '') || null,
      province: String(order.rawMeta?.province || '') || null,
      city: String(order.rawMeta?.city || '') || null,
      district: String(order.rawMeta?.district || '') || null,
      postalCode: String(order.rawMeta?.postalCode || '') || null,
      address: String(order.rawMeta?.address || '') || null,
      addressNotes: String(order.rawMeta?.addressNotes || '') || null,
      rawAddress: String(order.rawMeta?.rawAddress || '') || null,
      shippingCost: Number(order.rawMeta?.shippingCost || 0) || 0,
      orderAmount: order.orderAmount,
      lines: lines.map((line) => ({
        sku: line.mpSku,
        productName: line.mpProductName,
        variation: line.mpVariation,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineSubtotal: line.lineSubtotal,
        lineDiscount: line.lineDiscount,
        rawRow: line.rawRow,
      })),
      rawMeta: {
        marketplaceStatus: String(order.rawMeta?.marketplaceStatus || ''),
        cancellationStatus: String(order.rawMeta?.cancellationStatus || ''),
      },
    }, lines, []);
  });

  const summary = buildPreviewSummary(normalizedOrders);
  if (summary.needsReviewOrders > 0 || summary.unidentifiedLines > 0 || summary.unresolvedStoreLines > 0) {
    throw new Error('Masih ada order yang belum siap. Selesaikan identifikasi SKU dulu sebelum menyimpan.');
  }

  const sourceOrderDate = preview.sourceOrderDate || inferSourceOrderDate(normalizedOrders.map((order) => ({
    platform: 'shopee',
    externalId: order.externalOrderId,
    status: String(order.rawMeta?.status || '') || null,
    substatus: String(order.rawMeta?.substatus || '') || null,
    paymentMethodLabel: order.paymentMethodLabel,
    createdAt: String(order.rawMeta?.createdAt || '') || null,
    paidAt: String(order.rawMeta?.paidAt || '') || null,
    rtsAt: String(order.rawMeta?.rtsAt || '') || null,
    deliveredAt: String(order.rawMeta?.deliveredAt || '') || null,
    trackingNumber: order.trackingNumber,
    shippingProvider: order.shippingProvider,
    deliveryOption: order.deliveryOption,
    customerUsername: String(order.rawMeta?.customerUsername || '') || null,
    customerName: order.recipientName,
    customerPhone: String(order.rawMeta?.customerPhone || '') || null,
    province: String(order.rawMeta?.province || '') || null,
    city: String(order.rawMeta?.city || '') || null,
    district: String(order.rawMeta?.district || '') || null,
    postalCode: String(order.rawMeta?.postalCode || '') || null,
    address: String(order.rawMeta?.address || '') || null,
    addressNotes: String(order.rawMeta?.addressNotes || '') || null,
    rawAddress: String(order.rawMeta?.rawAddress || '') || null,
    shippingCost: Number(order.rawMeta?.shippingCost || 0) || 0,
    orderAmount: order.orderAmount,
    lines: [],
    rawMeta: {
      marketplaceStatus: String(order.rawMeta?.marketplaceStatus || ''),
      cancellationStatus: String(order.rawMeta?.cancellationStatus || ''),
    },
  })));
  if (!sourceOrderDate) {
    throw new Error('Tanggal order file tidak bisa ditentukan. Pastikan file Shopee memiliki waktu order yang valid.');
  }

  const svc = createServiceSupabase();
  const batchInsert = {
    source_id: null,
    source_key: SHOPEE_RLT_SOURCE.sourceKey,
    source_label: SHOPEE_RLT_SOURCE.sourceLabel,
    platform: SHOPEE_RLT_SOURCE.platform,
    business_id: business.id,
    business_code: business.business_code,
    filename: preview.filename,
    source_order_date: sourceOrderDate,
    file_size_bytes: null,
    review_status: 'confirmed',
    total_orders: summary.totalOrders,
    total_lines: summary.totalLines,
    ready_orders: summary.readyOrders,
    needs_review_orders: summary.needsReviewOrders,
    mixed_store_orders: summary.mixedStoreOrders,
    identified_lines: summary.identifiedLines,
    classified_lines: summary.classifiedLines,
    unidentified_lines: summary.unidentifiedLines,
    unresolved_store_lines: summary.unresolvedStoreLines,
    uploaded_by_email: input.uploadedByEmail,
    summary,
    confirmed_at: new Date().toISOString(),
  };

  const batchRes = await svc
    .from('marketplace_intake_batches')
    .insert(batchInsert)
    .select('id')
    .single();

  if (batchRes.error) {
    if (isMissingTableError(batchRes.error)) throw new Error(getMissingSchemaMessage());
    throw batchRes.error;
  }

  const batchId = Number(batchRes.data.id);
  const orderRows = normalizedOrders.map((order) => ({
    batch_id: batchId,
    external_order_id: order.externalOrderId,
    order_status: order.orderStatus,
    final_source_store_id: null,
    final_store_name: order.finalStoreName,
    final_store_resolution: order.finalStoreResolution,
    issue_codes: order.issueCodes || [],
    line_count: order.lineCount,
    identified_line_count: order.identifiedLineCount,
    classified_line_count: order.classifiedLineCount,
    issue_count: order.issueCount,
    is_mixed_store: order.isMixedStore,
    has_unidentified: order.hasUnidentified,
    customer_label: order.customerLabel,
    recipient_name: order.recipientName,
    tracking_number: order.trackingNumber,
    payment_method_label: order.paymentMethodLabel,
    shipping_provider: order.shippingProvider,
    delivery_option: order.deliveryOption,
    order_amount: order.orderAmount,
    raw_meta: order.rawMeta || {},
  }));

  const ordersRes = await svc
    .from('marketplace_intake_orders')
    .insert(orderRows)
    .select('id, external_order_id');
  if (ordersRes.error) throw ordersRes.error;

  const orderIdByExternalId = new Map<string, number>();
  for (const row of ordersRes.data || []) {
    orderIdByExternalId.set(String(row.external_order_id), Number(row.id));
  }

  const lineRows = normalizedOrders.flatMap((order) => {
    const intakeOrderId = orderIdByExternalId.get(order.externalOrderId);
    if (!intakeOrderId) return [];
    return (order.lines || []).map((line) => ({
      intake_order_id: intakeOrderId,
      line_index: line.lineIndex,
      line_status: line.lineStatus,
      issue_codes: line.issueCodes || [],
      mp_sku: line.mpSku,
      mp_product_name: line.mpProductName,
      mp_variation: line.mpVariation,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      line_subtotal: line.lineSubtotal,
      line_discount: line.lineDiscount,
      detected_custom_id: line.detectedCustomId,
      matched_entity_type: line.matchedEntityType,
      matched_entity_key: line.matchedEntityKey,
      matched_entity_label: line.matchedEntityLabel,
      matched_entity_source: line.matchedEntitySource,
      matched_scalev_product_id: null,
      matched_scalev_variant_id: null,
      matched_scalev_bundle_id: line.matchedScalevBundleId,
      matched_rule_id: null,
      mapped_source_store_id: null,
      mapped_store_name: line.mappedStoreName,
      raw_row: line.rawRow || {},
    }));
  });

  if (lineRows.length > 0) {
    const linesRes = await svc
      .from('marketplace_intake_order_lines')
      .insert(lineRows);
    if (linesRes.error) throw linesRes.error;
  }

  const manualMemoryUpsertMap = new Map<string, {
    source_key: string;
    source_label: string;
    platform: 'shopee';
    business_id: number;
    business_code: string;
    match_signature: string;
    mp_sku: string | null;
    mp_product_name: string;
    mp_variation: string | null;
    target_entity_type: 'bundle';
    target_entity_key: string | null;
    target_entity_label: string | null;
    target_custom_id: string | null;
    scalev_bundle_id: number | null;
    mapped_store_name: string | null;
    usage_count: number;
    created_by_email: string | null;
    updated_by_email: string | null;
    last_confirmed_at: string;
    is_active: true;
  }>();

  for (const order of normalizedOrders) {
    for (const line of order.lines || []) {
      const shouldRemember = (line.issueCodes || []).includes('manual_match_confirmed')
        || (line.issueCodes || []).includes('remembered_manual_match');
      if (!shouldRemember || !line.matchSignature) continue;

      const key = [
        SHOPEE_RLT_SOURCE.sourceKey,
        business.business_code,
        line.matchSignature,
      ].join('::');

      const nextRow = {
        source_key: SHOPEE_RLT_SOURCE.sourceKey,
        source_label: SHOPEE_RLT_SOURCE.sourceLabel,
        platform: SHOPEE_RLT_SOURCE.platform,
        business_id: business.id,
        business_code: business.business_code,
        match_signature: line.matchSignature,
        mp_sku: line.mpSku,
        mp_product_name: line.mpProductName,
        mp_variation: line.mpVariation,
        target_entity_type: 'bundle' as const,
        target_entity_key: line.matchedEntityKey,
        target_entity_label: line.matchedEntityLabel,
        target_custom_id: line.detectedCustomId,
        scalev_bundle_id: line.matchedScalevBundleId,
        mapped_store_name: line.mappedStoreName,
        usage_count: 1,
        created_by_email: input.uploadedByEmail,
        updated_by_email: input.uploadedByEmail,
        last_confirmed_at: new Date().toISOString(),
        is_active: true as const,
      };

      const existing = manualMemoryUpsertMap.get(key);
      if (!existing) {
        manualMemoryUpsertMap.set(key, nextRow);
        continue;
      }

      const hasConflict = existing.scalev_bundle_id !== nextRow.scalev_bundle_id
        || existing.target_entity_key !== nextRow.target_entity_key
        || existing.mapped_store_name !== nextRow.mapped_store_name;
      if (hasConflict) {
        throw new Error(
          `Konflik memory manual untuk item "${line.mpProductName}". Ada lebih dari satu pilihan bundle untuk pola SKU yang sama dalam satu batch. Samakan pilihannya lalu coba simpan lagi.`,
        );
      }

      existing.usage_count += 1;
      existing.updated_by_email = input.uploadedByEmail;
      existing.last_confirmed_at = nextRow.last_confirmed_at;
      if (!existing.mp_sku && nextRow.mp_sku) existing.mp_sku = nextRow.mp_sku;
      if (!existing.mp_variation && nextRow.mp_variation) existing.mp_variation = nextRow.mp_variation;
    }
  }

  const manualMemoryUpserts = Array.from(manualMemoryUpsertMap.values());

  if (manualMemoryUpserts.length > 0) {
    const memoryRes = await svc
      .from('marketplace_intake_manual_memory')
      .upsert(manualMemoryUpserts, { onConflict: 'source_key,business_code,match_signature' });
    if (memoryRes.error && !isMissingTableError(memoryRes.error)) throw memoryRes.error;
  }

  return {
    batchId,
    summary,
  };
}

export type MarketplaceIntakeHistoryBatchRow = {
  id: number;
  filename: string;
  sourceOrderDate: string | null;
  reviewStatus: string;
  totalOrders: number;
  totalLines: number;
  readyOrders: number;
  needsReviewOrders: number;
  identifiedLines: number;
  unidentifiedLines: number;
  unresolvedStoreLines: number;
  confirmedAt: string;
  uploadedByEmail: string | null;
};

export type MarketplaceIntakeHistoryOrderRow = {
  externalOrderId: string;
  customerLabel: string | null;
  recipientName: string | null;
  finalStoreName: string | null;
  lineCount: number;
  orderAmount: number;
  orderStatus: string;
  trackingNumber: string | null;
  issueCodes: string[];
};

export type MarketplaceIntakeHistoryBatchDetail = {
  batch: MarketplaceIntakeHistoryBatchRow;
  orders: MarketplaceIntakeHistoryOrderRow[];
};

function getHistoryMonthRange(month: string): { start: string; end: string } {
  const match = String(month || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error('Format bulan tidak valid. Gunakan YYYY-MM.');
  }

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error('Format bulan tidak valid. Gunakan YYYY-MM.');
  }

  const nextYear = monthNumber === 12 ? year + 1 : year;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const start = `${year}-${String(monthNumber).padStart(2, '0')}-01`;
  const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

  return { start, end };
}

export async function listMarketplaceIntakeHistory(input: {
  month: string;
}): Promise<{ month: string; batches: MarketplaceIntakeHistoryBatchRow[] }> {
  const { start, end } = getHistoryMonthRange(input.month);
  const svc = createServiceSupabase();

  const { data, error } = await svc
    .from('marketplace_intake_batches')
    .select(`
      id,
      filename,
      source_order_date,
      review_status,
      total_orders,
      total_lines,
      ready_orders,
      needs_review_orders,
      identified_lines,
      unidentified_lines,
      unresolved_store_lines,
      confirmed_at,
      uploaded_by_email
    `)
    .eq('source_key', SHOPEE_RLT_SOURCE.sourceKey)
    .eq('business_code', SHOPEE_RLT_SOURCE.businessCode)
    .gte('source_order_date', start)
    .lt('source_order_date', end)
    .order('source_order_date', { ascending: true })
    .order('confirmed_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    if (isMissingTableError(error)) throw new Error(getMissingSchemaMessage());
    throw error;
  }

  const batches = (data || []).map((row: any) => ({
    id: Number(row.id),
    filename: String(row.filename || ''),
    sourceOrderDate: row.source_order_date || null,
    reviewStatus: String(row.review_status || ''),
    totalOrders: Number(row.total_orders || 0),
    totalLines: Number(row.total_lines || 0),
    readyOrders: Number(row.ready_orders || 0),
    needsReviewOrders: Number(row.needs_review_orders || 0),
    identifiedLines: Number(row.identified_lines || 0),
    unidentifiedLines: Number(row.unidentified_lines || 0),
    unresolvedStoreLines: Number(row.unresolved_store_lines || 0),
    confirmedAt: String(row.confirmed_at || ''),
    uploadedByEmail: row.uploaded_by_email || null,
  }));

  return {
    month: input.month,
    batches,
  };
}

export async function getMarketplaceIntakeHistoryBatchDetail(batchId: number): Promise<MarketplaceIntakeHistoryBatchDetail> {
  const svc = createServiceSupabase();

  const batchRes = await svc
    .from('marketplace_intake_batches')
    .select(`
      id,
      filename,
      source_order_date,
      review_status,
      total_orders,
      total_lines,
      ready_orders,
      needs_review_orders,
      identified_lines,
      unidentified_lines,
      unresolved_store_lines,
      confirmed_at,
      uploaded_by_email
    `)
    .eq('id', batchId)
    .eq('source_key', SHOPEE_RLT_SOURCE.sourceKey)
    .eq('business_code', SHOPEE_RLT_SOURCE.businessCode)
    .maybeSingle();

  if (batchRes.error) {
    if (isMissingTableError(batchRes.error)) throw new Error(getMissingSchemaMessage());
    throw batchRes.error;
  }
  if (!batchRes.data) {
    throw new Error('Batch intake tidak ditemukan.');
  }

  const ordersRes = await svc
    .from('marketplace_intake_orders')
    .select(`
      external_order_id,
      customer_label,
      recipient_name,
      final_store_name,
      line_count,
      order_amount,
      order_status,
      tracking_number,
      issue_codes
    `)
    .eq('batch_id', batchId)
    .order('external_order_id', { ascending: true });

  if (ordersRes.error) {
    if (isMissingTableError(ordersRes.error)) throw new Error(getMissingSchemaMessage());
    throw ordersRes.error;
  }

  return {
    batch: {
      id: Number(batchRes.data.id),
      filename: String(batchRes.data.filename || ''),
      sourceOrderDate: batchRes.data.source_order_date || null,
      reviewStatus: String(batchRes.data.review_status || ''),
      totalOrders: Number(batchRes.data.total_orders || 0),
      totalLines: Number(batchRes.data.total_lines || 0),
      readyOrders: Number(batchRes.data.ready_orders || 0),
      needsReviewOrders: Number(batchRes.data.needs_review_orders || 0),
      identifiedLines: Number(batchRes.data.identified_lines || 0),
      unidentifiedLines: Number(batchRes.data.unidentified_lines || 0),
      unresolvedStoreLines: Number(batchRes.data.unresolved_store_lines || 0),
      confirmedAt: String(batchRes.data.confirmed_at || ''),
      uploadedByEmail: batchRes.data.uploaded_by_email || null,
    },
    orders: (ordersRes.data || []).map((row: any) => ({
      externalOrderId: String(row.external_order_id || ''),
      customerLabel: row.customer_label || null,
      recipientName: row.recipient_name || null,
      finalStoreName: row.final_store_name || null,
      lineCount: Number(row.line_count || 0),
      orderAmount: Number(row.order_amount || 0),
      orderStatus: String(row.order_status || ''),
      trackingNumber: row.tracking_number || null,
      issueCodes: Array.isArray(row.issue_codes) ? row.issue_codes : [],
    })),
  };
}
