import * as XLSX from 'xlsx';
import { createServiceSupabase } from './service-supabase';

const SHOPEE_RLT_SOURCE_KEY = 'shopee_rlt';

type SheetRow = Record<string, unknown>;

type MarketplaceUploadSourceRow = {
  id: number;
  source_key: string;
  source_label: string;
  platform: 'shopee' | 'tiktok' | 'lazada' | 'blibli';
  business_id: number;
  business_code: string;
  description: string | null;
  is_active: boolean;
};

type MarketplaceUploadSourceStoreRow = {
  id: number;
  source_id: number;
  store_name: string;
  sort_order: number;
};

type MarketplaceStoreMappingRuleRow = {
  id: number;
  source_id: number;
  source_store_id: number;
  business_id: number;
  business_code: string;
  match_field: 'sku' | 'product_name';
  match_type: 'exact' | 'prefix' | 'contains';
  match_value: string;
  match_value_normalized: string;
  target_entity_type: 'product' | 'variant' | 'bundle' | null;
  target_entity_key: string | null;
  scalev_product_id: number | null;
  scalev_variant_id: number | null;
  scalev_bundle_id: number | null;
  target_entity_label: string | null;
  notes: string | null;
  is_active: boolean;
  source_store_name: string | null;
};

type CatalogIdentifierRow = {
  business_id: number;
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

type IdentifierMatch = {
  status: 'matched';
  row: CatalogIdentifierRow;
};

type IdentifierMiss = {
  status: 'missing';
};

type IdentifierAmbiguous = {
  status: 'ambiguous';
  rows: CatalogIdentifierRow[];
};

type IdentifierResolution = IdentifierMatch | IdentifierMiss | IdentifierAmbiguous;

type RuleMatch = {
  status: 'matched';
  rule: MarketplaceStoreMappingRuleRow;
  score: number;
};

type RuleMiss = {
  status: 'missing';
};

type RuleAmbiguous = {
  status: 'ambiguous';
  rules: MarketplaceStoreMappingRuleRow[];
};

type RuleResolution = RuleMatch | RuleMiss | RuleAmbiguous;

type PreviewLineStatus = 'identified' | 'not_identified' | 'store_unmapped' | 'entity_mismatch';
type PreviewOrderStatus = 'ready' | 'needs_review';
type PreviewStoreResolution = 'single_store' | 'dominant_amount' | 'unclassified' | 'ambiguous';

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
  matchedEntityType: 'product' | 'variant' | 'bundle' | null;
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
    id: number;
    sourceKey: string;
    sourceLabel: string;
    platform: 'shopee';
    businessId: number;
    businessCode: string;
  };
  filename: string;
  rowCount: number;
  platform: 'shopee';
  generatedAt: string;
  summary: MarketplaceIntakePreviewSummary;
  orders: MarketplaceIntakePreviewOrder[];
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

function getIdentifierSourcePriority(source: string): number {
  if (source === 'bundle.custom_id') return 100;
  if (source === 'variant.sku') return 90;
  if (source === 'variant.unique_id') return 80;
  if (source === 'bundle.price_option_unique_id') return 70;
  if (source === 'bundle.price_option_slug') return 60;
  return 10;
}

function getRuleTypePriority(type: 'exact' | 'prefix' | 'contains'): number {
  if (type === 'exact') return 300;
  if (type === 'prefix') return 200;
  return 100;
}

function getRuleFieldPriority(field: 'sku' | 'product_name'): number {
  if (field === 'sku') return 1000;
  return 500;
}

function isMissingTableError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST205' || code === '42P01' || /does not exist/i.test(message) || /schema cache/i.test(message);
}

function getMissingSchemaMessage() {
  return 'Tabel marketplace intake/mapping belum tersedia. Jalankan migration 118 dan 119 terlebih dahulu.';
}

async function loadShopeeRltSourceConfig() {
  const svc = createServiceSupabase();
  const sourceRes = await svc
    .from('marketplace_upload_sources')
    .select('id, source_key, source_label, platform, business_id, business_code, description, is_active')
    .eq('source_key', SHOPEE_RLT_SOURCE_KEY)
    .maybeSingle();

  if (sourceRes.error) {
    if (isMissingTableError(sourceRes.error)) throw new Error(getMissingSchemaMessage());
    throw sourceRes.error;
  }
  if (!sourceRes.data) {
    throw new Error('Source account Shopee RLT belum tersedia di marketplace mapping.');
  }

  const source = sourceRes.data as MarketplaceUploadSourceRow;
  if (source.platform !== 'shopee') {
    throw new Error('Source Shopee RLT tidak valid.');
  }

  const [storesRes, rulesRes] = await Promise.all([
    svc
      .from('marketplace_upload_source_stores')
      .select('id, source_id, store_name, sort_order')
      .eq('source_id', source.id)
      .order('sort_order', { ascending: true })
      .order('store_name', { ascending: true }),
    svc
      .from('marketplace_store_mapping_rules')
      .select(`
        id,
        source_id,
        source_store_id,
        business_id,
        business_code,
        match_field,
        match_type,
        match_value,
        match_value_normalized,
        target_entity_type,
        target_entity_key,
        scalev_product_id,
        scalev_variant_id,
        scalev_bundle_id,
        target_entity_label,
        notes,
        is_active
      `)
      .eq('source_id', source.id)
      .eq('is_active', true)
      .order('match_field', { ascending: true })
      .order('match_type', { ascending: true })
      .order('match_value', { ascending: true }),
  ]);

  for (const response of [storesRes, rulesRes]) {
    if (response.error) {
      if (isMissingTableError(response.error)) throw new Error(getMissingSchemaMessage());
      throw response.error;
    }
  }

  const stores = (storesRes.data || []) as MarketplaceUploadSourceStoreRow[];
  const storeNameById = new Map<number, string>(stores.map((store) => [store.id, store.store_name]));
  const rules = ((rulesRes.data || []) as MarketplaceStoreMappingRuleRow[]).map((rule) => ({
    ...rule,
    source_store_name: storeNameById.get(rule.source_store_id) || null,
  }));

  return {
    source,
    stores,
    rules,
  };
}

async function loadIdentifierLookup(businessId: number, normalizedIdentifiers: string[]) {
  const svc = createServiceSupabase();
  if (normalizedIdentifiers.length === 0) return new Map<string, CatalogIdentifierRow[]>();

  const { data, error } = await svc
    .from('scalev_catalog_identifiers')
    .select(`
      business_id,
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
    .in('identifier_normalized', normalizedIdentifiers)
    .in('source', ['bundle.custom_id', 'variant.sku', 'variant.unique_id', 'bundle.price_option_unique_id', 'bundle.price_option_slug']);

  if (error) throw error;

  const lookup = new Map<string, CatalogIdentifierRow[]>();
  for (const row of (data || []) as CatalogIdentifierRow[]) {
    const key = normalizeIdentifier(row.identifier_normalized || row.identifier);
    if (!key) continue;
    if (!lookup.has(key)) lookup.set(key, []);
    lookup.get(key)!.push(row);
  }
  return lookup;
}

function resolveIdentifierForSku(
  sku: string | null,
  identifierLookup: Map<string, CatalogIdentifierRow[]>,
): IdentifierResolution {
  const normalized = normalizeIdentifier(sku);
  if (!normalized) return { status: 'missing' };

  const matches = (identifierLookup.get(normalized) || []).slice().sort((left, right) => {
    const priorityDiff = getIdentifierSourcePriority(right.source) - getIdentifierSourcePriority(left.source);
    if (priorityDiff !== 0) return priorityDiff;
    return String(left.entity_key || '').localeCompare(String(right.entity_key || ''));
  });

  if (matches.length === 0) return { status: 'missing' };
  if (matches.length === 1) return { status: 'matched', row: matches[0] };

  const bestPriority = getIdentifierSourcePriority(matches[0].source);
  const topMatches = matches.filter((row) => getIdentifierSourcePriority(row.source) === bestPriority);
  const uniqueEntityKeys = Array.from(new Set(topMatches.map((row) => row.entity_key)));
  if (uniqueEntityKeys.length === 1) return { status: 'matched', row: topMatches[0] };
  return { status: 'ambiguous', rows: topMatches };
}

function ruleMatchesField(
  value: string | null,
  rule: MarketplaceStoreMappingRuleRow,
): boolean {
  const normalizedValue = normalizeIdentifier(value);
  const normalizedRule = normalizeIdentifier(rule.match_value_normalized || rule.match_value);
  if (!normalizedValue || !normalizedRule) return false;
  if (rule.match_type === 'exact') return normalizedValue === normalizedRule;
  if (rule.match_type === 'prefix') return normalizedValue.startsWith(normalizedRule);
  return normalizedValue.includes(normalizedRule);
}

function resolveRuleForLine(
  line: CanonicalLine,
  rules: MarketplaceStoreMappingRuleRow[],
): RuleResolution {
  const candidates: Array<{ rule: MarketplaceStoreMappingRuleRow; score: number }> = [];

  for (const rule of rules) {
    const targetValue = rule.match_field === 'sku' ? line.sku : line.productName;
    if (!ruleMatchesField(targetValue, rule)) continue;
    const score =
      getRuleFieldPriority(rule.match_field) +
      getRuleTypePriority(rule.match_type) +
      normalizeIdentifier(rule.match_value_normalized || rule.match_value).length;
    candidates.push({ rule, score });
  }

  if (candidates.length === 0) return { status: 'missing' };

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return left.rule.id - right.rule.id;
  });

  const bestScore = candidates[0].score;
  const bestCandidates = candidates.filter((candidate) => candidate.score === bestScore);
  if (bestCandidates.length === 1) {
    return { status: 'matched', rule: bestCandidates[0].rule, score: bestScore };
  }

  const distinctTargets = Array.from(new Set(bestCandidates.map((candidate) => [
    candidate.rule.source_store_id,
    candidate.rule.target_entity_key || '',
  ].join('|'))));
  if (distinctTargets.length === 1) {
    return { status: 'matched', rule: bestCandidates[0].rule, score: bestScore };
  }

  return { status: 'ambiguous', rules: bestCandidates.map((candidate) => candidate.rule) };
}

function buildOrderCustomerLabel(order: CanonicalOrder): string | null {
  return order.customerName || order.customerUsername || null;
}

function classifyOrder(
  order: CanonicalOrder,
  rules: MarketplaceStoreMappingRuleRow[],
  identifierLookup: Map<string, CatalogIdentifierRow[]>,
): MarketplaceIntakePreviewOrder {
  const lines: MarketplaceIntakePreviewLine[] = [];

  for (let index = 0; index < order.lines.length; index += 1) {
    const line = order.lines[index];
    const issueCodes: string[] = [];
    let lineStatus: PreviewLineStatus = 'identified';
    let matchedEntity: CatalogIdentifierRow | null = null;
    let mappedRule: MarketplaceStoreMappingRuleRow | null = null;
    let mappedStoreId: number | null = null;
    let mappedStoreName: string | null = null;
    let matchedRuleLabel: string | null = null;

    const identifier = resolveIdentifierForSku(line.sku, identifierLookup);
    if (identifier.status === 'missing') {
      lineStatus = 'not_identified';
      issueCodes.push('custom_id_not_found');
    } else if (identifier.status === 'ambiguous') {
      lineStatus = 'not_identified';
      issueCodes.push('custom_id_ambiguous');
    } else {
      matchedEntity = identifier.row;
      const ruleResolution = resolveRuleForLine(line, rules);
      if (ruleResolution.status === 'missing') {
        lineStatus = 'store_unmapped';
        issueCodes.push('store_rule_missing');
      } else if (ruleResolution.status === 'ambiguous') {
        lineStatus = 'store_unmapped';
        issueCodes.push('store_rule_ambiguous');
      } else {
        mappedRule = ruleResolution.rule;
        mappedStoreId = Number(mappedRule.source_store_id || 0) || null;
        mappedStoreName = mappedRule.source_store_name || null;
        matchedRuleLabel = `${mappedRule.match_field}:${mappedRule.match_type}:${mappedRule.match_value}`;
        if (mappedRule.target_entity_key && mappedRule.target_entity_key !== matchedEntity.entity_key) {
          lineStatus = 'entity_mismatch';
          issueCodes.push('rule_entity_mismatch');
        }
      }
    }

    lines.push({
      lineIndex: index,
      lineStatus,
      issueCodes,
      mpSku: line.sku,
      mpProductName: line.productName,
      mpVariation: line.variation,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineSubtotal: line.lineSubtotal,
      lineDiscount: line.lineDiscount,
      detectedCustomId: line.sku,
      matchedEntityType: matchedEntity?.entity_type || null,
      matchedEntityKey: matchedEntity?.entity_key || null,
      matchedEntityLabel: matchedEntity?.entity_label || null,
      matchedEntitySource: matchedEntity?.source || null,
      matchedScalevProductId: matchedEntity?.scalev_product_id ?? null,
      matchedScalevVariantId: matchedEntity?.scalev_variant_id ?? null,
      matchedScalevBundleId: matchedEntity?.scalev_bundle_id ?? null,
      matchedRuleId: mappedRule?.id ?? null,
      matchedRuleLabel,
      mappedSourceStoreId: mappedStoreId,
      mappedStoreName,
      rawRow: line.rawRow,
    });
  }

  const identifiedLineCount = lines.filter((line) => line.lineStatus !== 'not_identified').length;
  const classifiedLineCount = lines.filter((line) => line.lineStatus === 'identified').length;
  const hasUnidentified = lines.some((line) => line.lineStatus === 'not_identified');
  const issueCodes = new Set<string>();
  lines.forEach((line) => line.issueCodes.forEach((code) => issueCodes.add(code)));

  const storeTotals = new Map<number, { storeName: string; total: number }>();
  for (const line of lines) {
    if (!line.mappedSourceStoreId || !line.mappedStoreName || line.lineStatus === 'not_identified') continue;
    const existing = storeTotals.get(line.mappedSourceStoreId);
    if (!existing) {
      storeTotals.set(line.mappedSourceStoreId, {
        storeName: line.mappedStoreName,
        total: line.lineSubtotal,
      });
      continue;
    }
    existing.total += line.lineSubtotal;
  }

  let finalSourceStoreId: number | null = null;
  let finalStoreName: string | null = null;
  let finalStoreResolution: PreviewStoreResolution = 'unclassified';
  let orderStatus: PreviewOrderStatus = 'needs_review';
  const isMixedStore = storeTotals.size > 1;

  const hasBlockingIssue = lines.some((line) => line.lineStatus !== 'identified');
  if (!hasBlockingIssue && storeTotals.size === 1) {
    const [storeId, store] = Array.from(storeTotals.entries())[0];
    finalSourceStoreId = storeId;
    finalStoreName = store.storeName;
    finalStoreResolution = 'single_store';
    orderStatus = 'ready';
  } else if (!hasBlockingIssue && storeTotals.size > 1) {
    const rankedStores = Array.from(storeTotals.entries()).sort((left, right) => right[1].total - left[1].total);
    if (rankedStores[0] && rankedStores[1] && rankedStores[0][1].total === rankedStores[1][1].total) {
      issueCodes.add('store_amount_tie');
      finalStoreResolution = 'ambiguous';
    } else if (rankedStores[0]) {
      finalSourceStoreId = rankedStores[0][0];
      finalStoreName = rankedStores[0][1].storeName;
      finalStoreResolution = 'dominant_amount';
      orderStatus = 'ready';
    }
  } else {
    finalStoreResolution = storeTotals.size > 1 ? 'ambiguous' : 'unclassified';
  }

  if (orderStatus !== 'ready' && isMixedStore && finalStoreResolution === 'unclassified') {
    finalStoreResolution = 'ambiguous';
  }

  const computedOrderAmount = order.orderAmount > 0
    ? order.orderAmount
    : order.lines.reduce((sum, line) => sum + line.lineSubtotal, 0);

  return {
    externalOrderId: order.externalId,
    orderStatus,
    finalSourceStoreId,
    finalStoreName,
    finalStoreResolution,
    issueCodes: Array.from(issueCodes),
    lineCount: lines.length,
    identifiedLineCount,
    classifiedLineCount,
    issueCount: Array.from(issueCodes).length,
    isMixedStore,
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
  const { source, rules } = await loadShopeeRltSourceConfig();
  const { orders, rowCount } = await parseShopeeWorkbook(input.file);

  const normalizedIdentifiers = Array.from(new Set(
    orders
      .flatMap((order) => order.lines.map((line) => normalizeIdentifier(line.sku)))
      .filter(Boolean),
  ));
  const identifierLookup = await loadIdentifierLookup(source.business_id, normalizedIdentifiers);

  const previewOrders = orders
    .map((order) => classifyOrder(order, rules, identifierLookup))
    .sort((left, right) => left.externalOrderId.localeCompare(right.externalOrderId));

  return {
    source: {
      id: source.id,
      sourceKey: source.source_key,
      sourceLabel: source.source_label,
      platform: 'shopee',
      businessId: source.business_id,
      businessCode: source.business_code,
    },
    filename: String(input.filenameOverride || input.file.name || 'shopee-rlt-upload'),
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
}) {
  const current = await loadShopeeRltSourceConfig();
  const preview = input.preview;
  if (!preview?.source || preview.source.sourceKey !== SHOPEE_RLT_SOURCE_KEY) {
    throw new Error('Preview intake tidak valid untuk Shopee RLT.');
  }
  if (Number(preview.source.id || 0) !== current.source.id) {
    throw new Error('Source mapping berubah. Refresh preview lalu coba simpan lagi.');
  }

  const summary = buildPreviewSummary(preview.orders || []);
  if (summary.needsReviewOrders > 0 || summary.unidentifiedLines > 0 || summary.unresolvedStoreLines > 0) {
    throw new Error('Masih ada order yang belum siap. Selesaikan mapping dulu sebelum menyimpan.');
  }

  const svc = createServiceSupabase();
  const batchInsert = {
    source_id: current.source.id,
    source_key: current.source.source_key,
    source_label: current.source.source_label,
    platform: current.source.platform,
    business_id: current.source.business_id,
    business_code: current.source.business_code,
    filename: preview.filename,
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
  const orderRows = (preview.orders || []).map((order) => ({
    batch_id: batchId,
    external_order_id: order.externalOrderId,
    order_status: order.orderStatus,
    final_source_store_id: order.finalSourceStoreId,
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

  const lineRows = (preview.orders || []).flatMap((order) => {
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
      matched_scalev_product_id: line.matchedScalevProductId,
      matched_scalev_variant_id: line.matchedScalevVariantId,
      matched_scalev_bundle_id: line.matchedScalevBundleId,
      matched_rule_id: line.matchedRuleId,
      mapped_source_store_id: line.mappedSourceStoreId,
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

  return {
    batchId,
    summary,
  };
}
