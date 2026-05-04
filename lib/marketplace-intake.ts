import { createHash } from 'crypto';
import * as XLSX from 'xlsx';
import { createServiceSupabase } from './service-supabase';
import {
  guessMarketplaceStoreFromTexts,
} from './marketplace-intake-store';
import {
  type MarketplaceIntakePlatform,
  type MarketplaceIntakeParserFamily,
  type MarketplaceIntakeSourceConfig,
  listMarketplaceIntakeUploadSourceConfigs,
} from './marketplace-intake-sources';
import { resolveMarketplaceIntakeSourceConfig } from './marketplace-intake-source-store-scopes';
import { resolveMarketplaceIntakeFeeFinancials } from './marketplace-intake-fee';
import { resolveMarketplaceIntakeShippingFinancials } from './marketplace-intake-shipping';

type SheetRow = Record<string, unknown>;

type BusinessRow = {
  id: number;
  business_code: string;
  business_name: string | null;
  api_key: string | null;
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

type SkuAliasRuleRow = {
  id: number;
  source_key: string;
  business_code: string;
  platform: MarketplaceIntakePlatform;
  raw_platform_sku_id: string | null;
  raw_seller_sku: string | null;
  raw_product_name: string | null;
  raw_variation: string | null;
  normalized_sku: string;
  reason: string | null;
  is_active: boolean;
};

type CanonicalLine = {
  rawPlatformSkuId?: string | null;
  rawSellerSku?: string | null;
  parentSku?: string | null;
  referenceSku?: string | null;
  sku: string | null;
  normalizedSku?: string | null;
  skuNormalizationSource?: string | null;
  skuNormalizationReason?: string | null;
  productName: string;
  variation: string | null;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  lineDiscount: number;
  priceInitial?: number;
  priceAfterDiscount?: number;
  returnedQuantity?: number;
  totalDiscount?: number;
  discountSeller?: number;
  discountShopee?: number;
  productWeightGrams?: number;
  orderProductCount?: number;
  totalWeightGrams?: number;
  voucherSeller?: number;
  cashbackCoin?: number;
  voucherShopee?: number;
  bundleDiscount?: number;
  bundleDiscountShopee?: number;
  bundleDiscountSeller?: number;
  shopeeCoinDiscount?: number;
  creditCardDiscount?: number;
  rawRow: Record<string, string>;
};

type CanonicalOrder = {
  platform: MarketplaceIntakePlatform;
  externalId: string;
  status: string | null;
  substatus: string | null;
  paymentMethodLabel: string | null;
  shipByDeadlineAt?: string | null;
  createdAt: string | null;
  paidAt: string | null;
  rtsAt: string | null;
  shippedAt?: string | null;
  deliveredAt: string | null;
  canceledAt?: string | null;
  trackingNumber: string | null;
  shippingProvider: string | null;
  deliveryOption: string | null;
  customerUsername: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail?: string | null;
  country?: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  village?: string | null;
  postalCode: string | null;
  address: string | null;
  addressNotes: string | null;
  buyerNote?: string | null;
  rawAddress: string | null;
  shippingCost: number;
  orderAmount: number;
  totalWeightGrams?: number | null;
  buyerPaidAmount?: number;
  totalPaymentAmount?: number;
  estimatedShippingCost?: number;
  shippingFeeEstimatedDeduction?: number;
  returnShippingCost?: number;
  lines: CanonicalLine[];
  rawMeta: Record<string, unknown>;
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
  storeCandidates: string[];
  classifierLabel: string | null;
  score: number;
  source: 'remembered' | 'catalog' | 'manual' | 'companion';
};

export type MarketplaceIntakePreviewLine = {
  lineIndex: number;
  lineStatus: PreviewLineStatus;
  issueCodes: string[];
  rawPlatformSkuId: string | null;
  rawSellerSku: string | null;
  mpSku: string | null;
  normalizedSku: string | null;
  skuNormalizationSource: string | null;
  skuNormalizationReason: string | null;
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
    platform: MarketplaceIntakePlatform;
    businessId: number;
    businessCode: string;
    allowedStores: string[];
  };
  filename: string;
  sourceOrderDate: string | null;
  sourceHeaders: string[];
  fingerprint: string;
  rowCount: number;
  platform: MarketplaceIntakePlatform;
  generatedAt: string;
  summary: MarketplaceIntakePreviewSummary;
  orders: MarketplaceIntakePreviewOrder[];
};

export type MarketplaceIntakeManualSelectionInput = {
  externalOrderId: string;
  lineIndex: number;
  scalevBundleId: number;
  mappedStoreName?: string | null;
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
  const raw = String(value ?? '').trim();
  if (!raw) return 0;

  const text = raw.replace(/[^0-9,.-]+/g, '');
  if (!text) return 0;

  let normalized = text;
  const hasDot = normalized.includes('.');
  const hasComma = normalized.includes(',');

  if (hasDot && hasComma) {
    const lastDot = normalized.lastIndexOf('.');
    const lastComma = normalized.lastIndexOf(',');
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasDot) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/\./g, '');
    } else if (!/^-?\d+\.\d+$/.test(normalized)) {
      normalized = normalized.replace(/\./g, '');
    }
  } else if (hasComma) {
    if (/^-?\d{1,3}(,\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/,/g, '');
    } else if (/^-?\d+,\d+$/.test(normalized)) {
      normalized = normalized.replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  }

  const parsed = Number(normalized);
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
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  const wibMatch = text.match(/^(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+WIB\s+(\d{4})$/i);
  if (wibMatch) {
    const monthMap: Record<string, string> = {
      jan: '01',
      feb: '02',
      mar: '03',
      apr: '04',
      may: '05',
      jun: '06',
      jul: '07',
      aug: '08',
      sep: '09',
      oct: '10',
      nov: '11',
      dec: '12',
    };
    const month = monthMap[wibMatch[1].slice(0, 3).toLowerCase()];
    const day = String(wibMatch[2]).padStart(2, '0');
    const time = wibMatch[3].length === 5 ? `${wibMatch[3]}:00` : wibMatch[3];
    const year = wibMatch[4];
    if (month) {
      const fallback = new Date(`${year}-${month}-${day}T${time}+07:00`);
      if (!Number.isNaN(fallback.getTime())) return fallback.toISOString();
    }
  }

  return null;
}

function parseWeightGrams(value: unknown): number | null {
  const parsed = parseNumber(value);
  if (parsed <= 0) return null;
  return Math.round(parsed * 1000);
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

function buildPreviewFingerprint(input: {
  sourceKey: string;
  businessCode: string;
  sourceOrderDate: string | null;
  orders: CanonicalOrder[];
}): string {
  const normalized = {
    sourceKey: input.sourceKey,
    businessCode: input.businessCode,
    sourceOrderDate: input.sourceOrderDate,
    orders: input.orders
      .slice()
      .sort((left, right) => left.externalId.localeCompare(right.externalId))
      .map((order) => ({
        externalId: order.externalId,
        createdAt: order.createdAt,
        paidAt: order.paidAt,
        trackingNumber: order.trackingNumber,
        orderAmount: order.orderAmount,
        lines: (order.lines || [])
          .slice()
          .sort((left, right) => {
            const leftKey = [left.sku || '', left.productName, left.variation || ''].join('|');
            const rightKey = [right.sku || '', right.productName, right.variation || ''].join('|');
            return leftKey.localeCompare(rightKey);
          })
          .map((line) => ({
            sku: line.sku,
            productName: line.productName,
            variation: line.variation,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineSubtotal: line.lineSubtotal,
            lineDiscount: line.lineDiscount,
          })),
      })),
  };

  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
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

function detectParserFamilyFromHeaders(headers: string[]): MarketplaceIntakeParserFamily {
  const headerSet = new Set(headers);
  if (headerSet.has('No. Pesanan')) return 'shopee';
  if (headerSet.has('Order ID')) return 'tiktok';
  if (headerSet.has('No. Order') && headerSet.has('Merchant Sku')) return 'blibli';
  if (headerSet.has('orderNumber') && headerSet.has('sellerSku')) return 'lazada';
  return 'none';
}

function scoreSourceByFilename(sourceConfig: MarketplaceIntakeSourceConfig, filename: string): number {
  const haystack = normalizeIdentifier(filename);
  if (!haystack) return 0;

  let score = 0;
  const businessToken = normalizeIdentifier(sourceConfig.businessCode);
  if (businessToken && haystack.includes(businessToken)) score += 5000;

  const labelTokens = normalizeIdentifier(sourceConfig.sourceLabel)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !['upload', 'marketplace'].includes(token));
  for (const token of labelTokens) {
    if (haystack.includes(token)) score += token === businessToken ? 0 : 250;
  }

  return score;
}

async function detectMarketplaceIntakeSourceConfig(input: {
  file: File;
  filenameOverride?: string | null;
}): Promise<MarketplaceIntakeSourceConfig> {
  const workbook = XLSX.read(await input.file.arrayBuffer(), { type: 'array' });
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
  const parserFamily = detectParserFamilyFromHeaders(headers);
  if (parserFamily === 'none') {
    throw new Error('Format marketplace tidak dikenali. Gunakan export Shopee, TikTok Shop, Blibli, atau Lazada yang didukung.');
  }

  const candidates = listMarketplaceIntakeUploadSourceConfigs()
    .filter((config) => config.parserFamily === parserFamily);
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) {
    throw new Error('Source marketplace untuk format file ini belum aktif di intake.');
  }

  const genericOrders = parserFamily === 'shopee'
    ? parseShopeeOrders(stringRows)
    : parserFamily === 'tiktok'
      ? parseTikTokOrders(
        stringRows.filter((row) => {
          const orderId = cleanText(row['Order ID']);
          return !orderId || !orderId.toLowerCase().includes('platform unique');
        }),
      )
      : parserFamily === 'blibli'
        ? parseBlibliOrders(stringRows)
        : parseLazadaOrders(stringRows);

  const normalizedIdentifiers = Array.from(new Set(
    genericOrders
      .flatMap((order) => order.lines.map((line) => normalizeIdentifier(line.normalizedSku || line.sku)))
      .filter(Boolean),
  ));

  const sourceScores = await Promise.all(candidates.map(async (candidate) => {
    const business = await loadBusinessForSource(candidate);
    const identifierLookup = await loadBundleIdentifierLookup(business.id, normalizedIdentifiers);

    let bundleMatchCount = 0;
    let guessedStoreCount = 0;
    for (const order of genericOrders) {
      for (const line of order.lines || []) {
        const normalizedSku = normalizeIdentifier(line.normalizedSku || line.sku);
        if (normalizedSku && (identifierLookup.get(normalizedSku)?.length || 0) > 0) {
          bundleMatchCount += 1;
        }

        const guessedStore = guessMarketplaceStoreFromTexts(
          [line.productName, line.variation, line.rawSellerSku, line.sku],
          candidate.allowedStores,
        );
        if (guessedStore.resolution === 'guessed' && guessedStore.storeName) {
          guessedStoreCount += 1;
        }
      }
    }

    return {
      sourceConfig: candidate,
      score: (bundleMatchCount * 100) + (guessedStoreCount * 10) + scoreSourceByFilename(candidate, String(input.filenameOverride || input.file.name || '')),
      bundleMatchCount,
      guessedStoreCount,
    };
  }));

  sourceScores.sort((left, right) => right.score - left.score);
  const best = sourceScores[0];
  const second = sourceScores[1];
  if (!best || best.score <= 0 || (second && best.score === second.score)) {
    const candidateLabels = sourceScores.map((item) => item.sourceConfig.sourceLabel).join(', ');
    throw new Error(`Source file ini ambigu. Saya mengenali format ${parserFamily.toUpperCase()}, tetapi tidak bisa memilih business secara unik antara: ${candidateLabels}. Gunakan nama file yang lebih jelas atau pecah file sesuai business.`);
  }

  return best.sourceConfig;
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
      normalizeIdentifier(line.referenceSku || line.sku),
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
    existing.returnedQuantity = (existing.returnedQuantity || 0) + (line.returnedQuantity || 0);
    existing.totalDiscount = (existing.totalDiscount || 0) + (line.totalDiscount || 0);
    existing.discountSeller = (existing.discountSeller || 0) + (line.discountSeller || 0);
    existing.discountShopee = (existing.discountShopee || 0) + (line.discountShopee || 0);
    existing.productWeightGrams = (existing.productWeightGrams || 0) + (line.productWeightGrams || 0);
    existing.orderProductCount = (existing.orderProductCount || 0) + (line.orderProductCount || 0);
    existing.totalWeightGrams = (existing.totalWeightGrams || 0) + (line.totalWeightGrams || 0);
    existing.voucherSeller = (existing.voucherSeller || 0) + (line.voucherSeller || 0);
    existing.cashbackCoin = (existing.cashbackCoin || 0) + (line.cashbackCoin || 0);
    existing.voucherShopee = (existing.voucherShopee || 0) + (line.voucherShopee || 0);
    existing.bundleDiscount = (existing.bundleDiscount || 0) + (line.bundleDiscount || 0);
    existing.bundleDiscountShopee = (existing.bundleDiscountShopee || 0) + (line.bundleDiscountShopee || 0);
    existing.bundleDiscountSeller = (existing.bundleDiscountSeller || 0) + (line.bundleDiscountSeller || 0);
    existing.shopeeCoinDiscount = (existing.shopeeCoinDiscount || 0) + (line.shopeeCoinDiscount || 0);
    existing.creditCardDiscount = (existing.creditCardDiscount || 0) + (line.creditCardDiscount || 0);
    existing.unitPrice = existing.quantity > 0 ? existing.lineSubtotal / existing.quantity : existing.unitPrice;
    existing.priceAfterDiscount = existing.unitPrice;
  }
  return Array.from(grouped.values());
}

function inferTikTokSku(row: Record<string, string>): string | null {
  const sellerSku = cleanText(row['Seller SKU']);
  if (sellerSku) return sellerSku;

  const productName = normalizeIdentifier(row['Product Name']);
  const variation = normalizeIdentifier(row.Variation);

  if (productName.includes('shaker mini roove collagen')) {
    return 'SMini-0';
  }

  if (productName.includes('roove collagen drink kemasan 20 sachet') || productName.includes('roove collagen drink 20 sachet')) {
    if (variation.includes('strawberry')) return 'ROVSTR20-295';
    if (variation.includes('kurma')) return 'ROVKRM20-295';
    if (variation.includes('cafe')) return 'ROVCF20-295';
    if (variation.includes('blueberry')) return 'ROV20-295';
  }

  if (productName.includes('roove collagen drink 10 sachet')) {
    return 'ROV10-155';
  }

  return cleanText(row['SKU ID']);
}

function parseTikTokOrders(rows: Record<string, string>[]): CanonicalOrder[] {
  const orders = new Map<string, CanonicalOrder>();

  for (const row of rows) {
    const externalId = cleanText(row['Order ID']);
    if (!externalId || externalId.toLowerCase().includes('platform unique')) continue;

    const existing = orders.get(externalId);
    const rawPlatformSkuId = cleanText(row['SKU ID']);
    const rawSellerSku = cleanText(row['Seller SKU']);
    const effectiveSku = inferTikTokSku(row);
    const quantity = Math.max(parseInteger(row.Quantity) || 1, 1);
    const sellerDiscount = parseNumber(row['SKU Seller Discount']);
    const platformDiscount = parseNumber(row['SKU Platform Discount']);
    const afterDiscountSubtotal = parseNumber(row['SKU Subtotal After Discount']) || parseNumber(row['SKU Subtotal Before Discount']);
    const unitAfterDiscount = afterDiscountSubtotal > 0
      ? afterDiscountSubtotal / Math.max(quantity, 1)
      : parseNumber(row['SKU Unit Original Price']);

    const line: CanonicalLine = {
      rawPlatformSkuId,
      rawSellerSku,
      sku: rawSellerSku || effectiveSku,
      normalizedSku: effectiveSku,
      skuNormalizationSource: rawSellerSku ? 'marketplace_seller_sku' : 'tiktok_fallback_inference',
      skuNormalizationReason: rawSellerSku ? null : 'Seller SKU kosong; intake memakai fallback inference untuk melanjutkan klasifikasi.',
      productName: cleanText(row['Product Name']) || cleanText(row.Variation) || 'Produk Marketplace',
      variation: cleanText(row.Variation),
      quantity,
      unitPrice: unitAfterDiscount,
      lineSubtotal: afterDiscountSubtotal,
      lineDiscount: sellerDiscount + platformDiscount,
      priceInitial: parseNumber(row['SKU Unit Original Price']),
      priceAfterDiscount: unitAfterDiscount,
      totalDiscount: sellerDiscount + platformDiscount,
      discountSeller: sellerDiscount,
      discountShopee: platformDiscount,
      productWeightGrams: parseWeightGrams(row['Weight(kg)']) || undefined,
      totalWeightGrams: parseWeightGrams(row['Weight(kg)']) || undefined,
      rawRow: row,
    };

    if (existing) {
      existing.lines.push(line);
      if (!existing.totalWeightGrams && line.totalWeightGrams) {
        existing.totalWeightGrams = line.totalWeightGrams;
      }
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
      country: cleanText(row.Country),
      province: cleanText(row.Province),
      city: cleanText(row['Regency and City']),
      district: cleanText(row.Districts),
      village: cleanText(row.Villages),
      postalCode: cleanText(row.Zipcode),
      address: cleanText(row['Detail Address']),
      addressNotes: cleanText(row['Additional address information']),
      rawAddress: [row['Detail Address'], row['Additional address information']]
        .map((value) => cleanText(value))
        .filter((value): value is string => Boolean(value))
        .join(', ') || null,
      shippingCost: parseNumber(row['Shipping Fee After Discount']),
      orderAmount: parseNumber(row['Order Amount']),
      totalWeightGrams: parseWeightGrams(row['Weight(kg)']),
      lines: [line],
      rawMeta: {
        warehouseName: cleanText(row['Warehouse Name']) || '',
        packageId: cleanText(row['Package ID']) || '',
        purchaseChannel: cleanText(row['Purchase Channel']) || '',
        shippingProviderName: cleanText(row['Shipping Provider Name']) || '',
        buyerServiceFee: parseNumber(row['Buyer Service Fee']),
        handlingFee: parseNumber(row['Handling Fee']),
        shippingInsurance: parseNumber(row['Shipping Insurance']),
        itemInsurance: parseNumber(row['Item Insurance']),
        originalShippingFee: parseNumber(row['Original Shipping Fee']),
        shippingFeeAfterDiscount: parseNumber(row['Shipping Fee After Discount']),
        shippingFeeSellerDiscount: parseNumber(row['Shipping Fee Seller Discount']),
        shippingFeePlatformDiscount: parseNumber(row['Shipping Fee Platform Discount']),
      },
    });
  }

  return Array.from(orders.values()).map((order) => ({
    ...order,
    lines: aggregateCanonicalLines(order.lines),
  }));
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
    const initialUnitPrice = parseNumber(row['Harga Awal']);
    const discountedUnitPrice = parseNumber(row['Harga Setelah Diskon']) || initialUnitPrice;
    const totalDiscount = parseNumber(row['Total Diskon']);
    const discountSeller = parseNumber(row['Diskon Dari Penjual']);
    const discountShopee = parseNumber(row['Diskon Dari Shopee']);
    const rawSellerSku = cleanText(row['Nomor Referensi SKU']) || cleanText(row['SKU Induk']);
    const line: CanonicalLine = {
      parentSku: cleanText(row['SKU Induk']),
      referenceSku: cleanText(row['Nomor Referensi SKU']),
      rawSellerSku,
      sku: rawSellerSku,
      normalizedSku: rawSellerSku,
      skuNormalizationSource: rawSellerSku ? 'marketplace_seller_sku' : null,
      skuNormalizationReason: null,
      productName: cleanText(row['Nama Produk']) || 'Produk Marketplace',
      variation: cleanText(row['Nama Variasi']),
      quantity,
      unitPrice: discountedUnitPrice,
      lineSubtotal: discountedUnitPrice * quantity,
      lineDiscount: discountSeller + discountShopee,
      priceInitial: initialUnitPrice,
      priceAfterDiscount: discountedUnitPrice,
      returnedQuantity: parseInteger(row['Returned quantity']),
      totalDiscount,
      discountSeller,
      discountShopee,
      productWeightGrams: parseNumber(row['Berat Produk']),
      orderProductCount: parseInteger(row['Jumlah Produk di Pesan']),
      totalWeightGrams: parseNumber(row['Total Berat']),
      voucherSeller: parseNumber(row['Voucher Ditanggung Penjual']),
      cashbackCoin: parseNumber(row['Cashback Koin']),
      voucherShopee: parseNumber(row['Voucher Ditanggung Shopee']),
      bundleDiscount: parseNumber(row['Paket Diskon']),
      bundleDiscountShopee: parseNumber(row['Paket Diskon (Diskon dari Shopee)']),
      bundleDiscountSeller: parseNumber(row['Paket Diskon (Diskon dari Penjual)']),
      shopeeCoinDiscount: parseNumber(row['Potongan Koin Shopee']),
      creditCardDiscount: parseNumber(row['Diskon Kartu Kredit']),
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
      shipByDeadlineAt: parseDateTime(row['Pesanan Harus Dikirimkan Sebelum (Menghindari keterlambatan)']),
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
      buyerNote: cleanText(row['Catatan dari Pembeli']),
      rawAddress: cleanText(row['Alamat Pengiriman']),
      shippingCost: parseNumber(row['Ongkos Kirim Dibayar oleh Pembeli']) || parseNumber(row['Perkiraan Ongkos Kirim']),
      orderAmount: parseNumber(row['Total Pembayaran']) || parseNumber(row['Dibayar Pembeli']),
      buyerPaidAmount: parseNumber(row['Dibayar Pembeli']),
      totalPaymentAmount: parseNumber(row['Total Pembayaran']),
      estimatedShippingCost: parseNumber(row['Perkiraan Ongkos Kirim']),
      shippingFeeEstimatedDeduction: parseNumber(row['Estimasi Potongan Biaya Pengiriman']),
      returnShippingCost: parseNumber(row['Ongkos Kirim Pengembalian Barang']),
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

function parseBlibliOrders(rows: Record<string, string>[]): CanonicalOrder[] {
  const orders = new Map<string, CanonicalOrder>();

  for (const row of rows) {
    const externalId = cleanText(row['No. Order']);
    if (!externalId) continue;

    const existing = orders.get(externalId);
    const quantity = Math.max(parseInteger(row['Total Barang']) || 1, 1);
    const unitPrice = parseNumber(row['Harga Produk']);
    const rawSellerSku = cleanText(row['Merchant Sku']) || cleanText(row['Blibli SKU']);
    const line: CanonicalLine = {
      rawPlatformSkuId: cleanText(row['Blibli SKU']),
      rawSellerSku,
      sku: rawSellerSku,
      normalizedSku: rawSellerSku,
      skuNormalizationSource: rawSellerSku ? 'marketplace_seller_sku' : null,
      skuNormalizationReason: null,
      productName: cleanText(row['Nama Produk']) || 'Produk Marketplace',
      variation: null,
      quantity,
      unitPrice,
      lineSubtotal: unitPrice * quantity,
      lineDiscount: 0,
      priceInitial: unitPrice,
      priceAfterDiscount: unitPrice,
      rawRow: row,
    };

    if (existing) {
      existing.lines.push(line);
      existing.orderAmount += line.lineSubtotal;
      existing.buyerPaidAmount = (existing.buyerPaidAmount || 0) + line.lineSubtotal;
      existing.rawMeta = {
        ...existing.rawMeta,
        orderItemIds: Array.from(new Set([
          ...((Array.isArray(existing.rawMeta?.orderItemIds) ? existing.rawMeta.orderItemIds : []) as unknown[]),
          cleanText(row['No. Order Item']),
        ].filter(Boolean))),
      };
      continue;
    }

    orders.set(externalId, {
      platform: 'blibli',
      externalId,
      status: cleanText(row['Order Status']),
      substatus: null,
      paymentMethodLabel: 'marketplace',
      createdAt: parseDateTime(row['Tanggal Order']),
      paidAt: parseDateTime(row['Tanggal Order']),
      rtsAt: null,
      deliveredAt: null,
      trackingNumber: cleanText(row['No. Awb']),
      shippingProvider: cleanText(row['Merchant Delivery Type']),
      deliveryOption: cleanText(row['Merchant Delivery Type']),
      customerUsername: cleanText(row['Nama Pemesan']),
      customerName: cleanText(row['Nama Pemesan']),
      customerPhone: null,
      customerEmail: null,
      country: 'Indonesia',
      province: null,
      city: null,
      district: null,
      village: null,
      postalCode: null,
      address: null,
      addressNotes: null,
      rawAddress: null,
      shippingCost: 0,
      orderAmount: line.lineSubtotal,
      buyerPaidAmount: line.lineSubtotal,
      totalPaymentAmount: undefined,
      lines: [line],
      rawMeta: {
        orderItemIds: [cleanText(row['No. Order Item'])].filter(Boolean),
        marketplaceOrderNumber: externalId,
        packageNumber: cleanText(row['No. Paket']),
        deliveryType: cleanText(row['Merchant Delivery Type']),
        pickupPointCode: cleanText(row['Pickup Point Code']),
        blibliSku: cleanText(row['Blibli SKU']),
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
  const orderKeyToExternalIdCandidates = new Map<string, string[]>();

  for (const row of rows) {
    const orderNumber = cleanText(row.orderNumber);
    if (!orderNumber) continue;

    const orderKey = orderNumber;
    const externalIdCandidates = [
      cleanText(row.orderItemId),
      cleanText(row.lazadaId),
      orderNumber,
    ].filter((value): value is string => Boolean(value));
    const knownCandidates = orderKeyToExternalIdCandidates.get(orderKey) || [];
    for (const candidate of externalIdCandidates) {
      if (!knownCandidates.includes(candidate)) knownCandidates.push(candidate);
    }
    knownCandidates.sort((left, right) => left.localeCompare(right, 'en', { numeric: true }));
    orderKeyToExternalIdCandidates.set(orderKey, knownCandidates);
    const externalId = knownCandidates[0] || orderNumber;

    const existing = orders.get(orderKey);
    const quantity = 1;
    const unitPrice = parseNumber(row.unitPrice);
    const paidPrice = parseNumber(row.paidPrice) || unitPrice;
    const sellerDiscount = parseNumber(row.sellerDiscountTotal);
    const bundleDiscount = parseNumber(row.bundleDiscount);
    const platformDiscount = Math.abs(parseNumber(row.platformDiscountTotal));
    const rawSellerSku = cleanText(row.sellerSku) || cleanText(row.lazadaSku);
    const line: CanonicalLine = {
      rawPlatformSkuId: cleanText(row.orderItemId) || cleanText(row.lazadaId),
      rawSellerSku,
      sku: rawSellerSku,
      normalizedSku: rawSellerSku,
      skuNormalizationSource: rawSellerSku ? 'marketplace_seller_sku' : null,
      skuNormalizationReason: null,
      productName: cleanText(row.itemName) || 'Produk Marketplace',
      variation: cleanText(row.variation),
      quantity,
      unitPrice,
      lineSubtotal: unitPrice * quantity,
      lineDiscount: sellerDiscount + bundleDiscount + platformDiscount,
      priceInitial: unitPrice,
      priceAfterDiscount: paidPrice,
      totalDiscount: sellerDiscount + bundleDiscount + platformDiscount,
      rawRow: row,
    };

    if (existing) {
      existing.lines.push(line);
      existing.orderAmount += paidPrice;
      existing.buyerPaidAmount = (existing.buyerPaidAmount || 0) + paidPrice;
      existing.rawMeta = {
        ...existing.rawMeta,
        orderItemIds: Array.from(new Set([
          ...((Array.isArray(existing.rawMeta?.orderItemIds) ? existing.rawMeta.orderItemIds : []) as unknown[]),
          cleanText(row.orderItemId) || cleanText(row.lazadaId),
        ].filter(Boolean))),
        unitPriceTotal: Number(existing.rawMeta?.unitPriceTotal || 0) + unitPrice,
        paidPriceTotal: Number(existing.rawMeta?.paidPriceTotal || 0) + paidPrice,
        platformDiscountTotal: Number(existing.rawMeta?.platformDiscountTotal || 0) + platformDiscount,
        sellerDiscountTotal: Number(existing.rawMeta?.sellerDiscountTotal || 0) + sellerDiscount,
        bundleDiscountTotal: Number(existing.rawMeta?.bundleDiscountTotal || 0) + bundleDiscount,
      };
      continue;
    }

    const addressParts = [
      cleanText(row.shippingAddress),
      cleanText(row.shippingAddress2),
      cleanText(row.shippingAddress3),
      cleanText(row.shippingAddress4),
      cleanText(row.shippingAddress5),
    ].filter((part): part is string => Boolean(part));

    orders.set(orderKey, {
      platform: 'lazada',
      externalId,
      status: cleanText(row.status),
      substatus: cleanText(row.buyerFailedDeliveryReason),
      paymentMethodLabel: cleanText(row.payMethod),
      createdAt: parseDateTime(row.createTime),
      paidAt: parseDateTime(row.createTime),
      rtsAt: parseDateTime(row.updateTime),
      deliveredAt: parseDateTime(row.deliveredDate),
      trackingNumber: cleanText(row.trackingCode) || cleanText(row.cdTrackingCode),
      shippingProvider: cleanText(row.shippingProvider) || cleanText(row.shippingProviderFM),
      deliveryOption: cleanText(row.shipmentTypeName) || cleanText(row.deliveryType),
      customerUsername: cleanText(row.customerName),
      customerName: cleanText(row.shippingName) || cleanText(row.customerName),
      customerPhone: normalizePhone(cleanText(row.shippingPhone) || cleanText(row.shippingPhone2)),
      customerEmail: cleanText(row.customerEmail),
      country: cleanText(row.shippingCountry) || 'Indonesia',
      province: cleanText(row.shippingRegion) || cleanText(row.shippingAddress5),
      city: cleanText(row.shippingCity),
      district: cleanText(row.shippingAddress4),
      village: cleanText(row.shippingAddress3),
      postalCode: cleanText(row.shippingPostCode),
      address: cleanText(row.shippingAddress),
      addressNotes: cleanText(row.sellerNote),
      rawAddress: addressParts.join(', ') || null,
      shippingCost: 0,
      orderAmount: paidPrice,
      buyerPaidAmount: paidPrice,
      totalPaymentAmount: undefined,
      lines: [line],
      rawMeta: {
        marketplaceOrderNumber: orderNumber,
        orderItemIds: [cleanText(row.orderItemId) || cleanText(row.lazadaId)].filter(Boolean),
        lazadaSku: cleanText(row.lazadaSku),
        shippingFeeRaw: parseNumber(row.shippingFee),
        unitPriceTotal: unitPrice,
        paidPriceTotal: paidPrice,
        platformDiscountTotal: platformDiscount,
        sellerDiscountTotal: sellerDiscount,
        bundleDiscountTotal: bundleDiscount,
        walletCredit: parseNumber(row.walletCredit),
      },
    });
  }

  return Array.from(orders.values()).map((order) => ({
    ...order,
    lines: aggregateCanonicalLines(order.lines),
  }));
}

async function parseMarketplaceWorkbook(input: {
  file: File;
  sourceConfig: MarketplaceIntakeSourceConfig;
}): Promise<{ orders: CanonicalOrder[]; rowCount: number; headers: string[] }> {
  const workbook = XLSX.read(await input.file.arrayBuffer(), { type: 'array' });
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
  if (input.sourceConfig.parserFamily === 'none' || input.sourceConfig.uploadEnabled === false) {
    throw new Error(`Source ${input.sourceConfig.sourceLabel} sudah terdaftar, tetapi parser upload intake-nya belum diaktifkan.`);
  }

  if (input.sourceConfig.parserFamily === 'shopee') {
    if (!headers.includes('No. Pesanan')) {
      throw new Error('Halaman ini saat ini hanya menerima export Shopee/SPX yang memiliki kolom "No. Pesanan".');
    }
    return {
      orders: parseShopeeOrders(stringRows),
      rowCount: stringRows.length,
      headers,
    };
  }

  if (input.sourceConfig.parserFamily === 'blibli') {
    if (!headers.includes('No. Order') || !headers.includes('Merchant Sku')) {
      throw new Error('Halaman ini saat ini hanya menerima export Blibli yang memiliki kolom "No. Order" dan "Merchant Sku".');
    }
    return {
      orders: parseBlibliOrders(stringRows),
      rowCount: stringRows.length,
      headers,
    };
  }

  if (input.sourceConfig.parserFamily === 'lazada') {
    if (!headers.includes('orderNumber') || !headers.includes('sellerSku')) {
      throw new Error('Halaman ini saat ini hanya menerima export Lazada yang memiliki kolom "orderNumber" dan "sellerSku".');
    }
    return {
      orders: parseLazadaOrders(stringRows),
      rowCount: stringRows.length,
      headers,
    };
  }

  if (!headers.includes('Order ID')) {
    throw new Error('Halaman ini saat ini hanya menerima export TikTok/Tokopedia seller center yang memiliki kolom "Order ID".');
  }

  const dataRows = stringRows.filter((row) => {
    const orderId = cleanText(row['Order ID']);
    return !orderId || !orderId.toLowerCase().includes('platform unique');
  });

  return {
    orders: parseTikTokOrders(dataRows),
    rowCount: dataRows.length,
    headers,
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

function extractMissingSchemaColumnName(error: any, tableName: string): string | null {
  const message = String(error?.message || '');
  const pattern = new RegExp(`Could not find the '([^']+)' column of '${tableName}' in the schema cache`, 'i');
  const match = message.match(pattern);
  return match?.[1] ? String(match[1]) : null;
}

async function insertRowsWithSchemaFallback<T extends Record<string, any>>(input: {
  table: string;
  rows: T[];
  removableColumns: string[];
  select?: string;
}) {
  const svc = createServiceSupabase();
  const removable = new Set(input.removableColumns);
  const removed = new Set<string>();
  let rows = input.rows.map((row) => ({ ...row }));

  while (true) {
    let query: any = svc.from(input.table).insert(rows);
    if (input.select) {
      query = query.select(input.select);
    }

    const result = await query;
    if (!result.error) return result;

    const missingColumn = extractMissingSchemaColumnName(result.error, input.table);
    if (!missingColumn || !removable.has(missingColumn) || removed.has(missingColumn)) {
      if (isMissingTableError(result.error)) {
        throw new Error(getMissingSchemaMessage());
      }
      throw result.error;
    }

    rows = rows.map((row) => {
      const next = { ...row };
      delete next[missingColumn];
      return next;
    });
    removed.add(missingColumn);
  }
}

async function loadBusinessForSource(source: MarketplaceIntakeSourceConfig): Promise<BusinessRow> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id, business_code, business_name, api_key, is_active')
    .eq('business_code', source.businessCode)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) throw new Error(getMissingSchemaMessage());
    throw error;
  }
  if (!data) {
    throw new Error(`Business ${source.businessCode} tidak ditemukan di konfigurasi Scalev.`);
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

async function loadBundleCatalog(businessId: number): Promise<BundleCatalogRow[]> {
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

async function loadManualMemoryMap(
  businessId: number,
  source: MarketplaceIntakeSourceConfig,
): Promise<Map<string, ManualMemoryRow>> {
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
    .eq('source_key', source.sourceKey)
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

async function loadSkuAliasRules(
  source: MarketplaceIntakeSourceConfig,
  business: BusinessRow,
): Promise<SkuAliasRuleRow[]> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('marketplace_intake_sku_aliases')
    .select(`
      id,
      source_key,
      business_code,
      platform,
      raw_platform_sku_id,
      raw_seller_sku,
      raw_product_name,
      raw_variation,
      normalized_sku,
      reason,
      is_active
    `)
    .eq('source_key', source.sourceKey)
    .eq('business_code', business.business_code)
    .eq('platform', source.platform)
    .eq('is_active', true)
    .order('id', { ascending: true });

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }

  return (data || []) as SkuAliasRuleRow[];
}

function countDefinedAliasMatchers(rule: SkuAliasRuleRow): number {
  return [
    rule.raw_platform_sku_id,
    rule.raw_seller_sku,
    rule.raw_product_name,
    rule.raw_variation,
  ].filter((value) => normalizeIdentifier(value).length > 0).length;
}

function matchSkuAliasRule(
  line: CanonicalLine,
  rule: SkuAliasRuleRow,
): { matched: boolean; specificity: number } {
  const checks: Array<[string | null | undefined, string | null | undefined]> = [
    [rule.raw_platform_sku_id, line.rawPlatformSkuId],
    [rule.raw_seller_sku, line.rawSellerSku || line.sku],
    [rule.raw_product_name, line.productName],
    [rule.raw_variation, line.variation],
  ];

  let specificity = 0;
  for (const [expected, actual] of checks) {
    const expectedNormalized = normalizeIdentifier(expected);
    if (!expectedNormalized) continue;
    const actualNormalized = normalizeIdentifier(actual);
    if (!actualNormalized || actualNormalized !== expectedNormalized) {
      return { matched: false, specificity: 0 };
    }
    specificity += 1;
  }

  return { matched: specificity > 0, specificity };
}

function applySkuAliasesToOrders(
  orders: CanonicalOrder[],
  aliasRules: SkuAliasRuleRow[],
): CanonicalOrder[] {
  if (aliasRules.length === 0) return orders;

  return orders.map((order) => ({
    ...order,
    lines: order.lines.map((line) => {
      const rankedMatches = aliasRules
        .map((rule) => {
          const result = matchSkuAliasRule(line, rule);
          return result.matched ? { rule, specificity: result.specificity } : null;
        })
        .filter((entry): entry is { rule: SkuAliasRuleRow; specificity: number } => Boolean(entry))
        .sort((left, right) => {
          if (right.specificity !== left.specificity) return right.specificity - left.specificity;
          return countDefinedAliasMatchers(right.rule) - countDefinedAliasMatchers(left.rule);
        });

      if (rankedMatches.length === 0) return line;

      const strongestSpecificity = rankedMatches[0].specificity;
      const strongestMatches = rankedMatches.filter((entry) => entry.specificity === strongestSpecificity);
      const distinctNormalizedSkus = Array.from(new Set(
        strongestMatches.map((entry) => cleanText(entry.rule.normalized_sku)).filter(Boolean),
      ));

      if (distinctNormalizedSkus.length > 1) {
        throw new Error(
          `Konflik SKU alias untuk "${line.productName}". Ada lebih dari satu normalized SKU aktif untuk matcher yang sama.`,
        );
      }

      const winner = strongestMatches[0]?.rule;
      const normalizedSku = cleanText(winner?.normalized_sku);
      if (!winner || !normalizedSku) return line;

      const previousNormalizedSku = cleanText(line.normalizedSku) || cleanText(line.sku);
      const aliasReason = cleanText(winner.reason);
      const nextSource = normalizeIdentifier(winner.raw_platform_sku_id) && normalizeIdentifier(line.rawPlatformSkuId) === normalizeIdentifier(winner.raw_platform_sku_id)
        ? 'platform_sku_alias'
        : normalizeIdentifier(winner.raw_seller_sku)
          ? 'seller_sku_alias'
          : 'product_name_alias';

      if (normalizedSku === previousNormalizedSku) {
        return {
          ...line,
          skuNormalizationSource: line.skuNormalizationSource || nextSource,
          skuNormalizationReason: line.skuNormalizationReason || aliasReason,
        };
      }

      return {
        ...line,
        normalizedSku,
        skuNormalizationSource: nextSource,
        skuNormalizationReason: aliasReason,
      };
    }),
  }));
}

function buildMatchSignature(line: Pick<CanonicalLine, 'sku' | 'normalizedSku' | 'productName' | 'variation'>): string {
  return [
    normalizeIdentifier(line.normalizedSku || line.sku) || '__blank__',
    normalizeIdentifier(line.productName) || '__blank__',
    normalizeIdentifier(line.variation) || '__blank__',
  ].join('|');
}

function getBundleDisplayLabel(bundle: Pick<BundleCatalogRow, 'display' | 'public_name' | 'name' | 'custom_id'>): string {
  return bundle.display || bundle.public_name || bundle.name || bundle.custom_id || 'Bundle';
}

async function buildSuggestionCandidateFromBundle(
  bundle: BundleCatalogRow,
  sourceConfig: MarketplaceIntakeSourceConfig,
  source: 'remembered' | 'catalog' | 'manual',
  score: number,
  options?: {
    preferredStoreName?: string | null;
    textHints?: Array<string | null | undefined>;
    fallbackStoreCandidates?: string[] | null;
  },
): Promise<MarketplaceIntakeSuggestionCandidate> {
  const normalizedPreferredStore = String(options?.preferredStoreName || '').trim();
  if (normalizedPreferredStore && sourceConfig.allowedStores.includes(normalizedPreferredStore)) {
    return {
      entityKey: `bundle:${bundle.scalev_bundle_id}`,
      entityLabel: getBundleDisplayLabel(bundle),
      customId: bundle.custom_id,
      scalevBundleId: bundle.scalev_bundle_id,
      storeName: normalizedPreferredStore,
      storeCandidates: [normalizedPreferredStore],
      classifierLabel: 'Manual store selection',
      score,
      source,
    };
  }

  const guessedStore = guessMarketplaceStoreFromTexts(
    [
      bundle.display,
      bundle.public_name,
      bundle.name,
      ...(options?.textHints || []),
    ],
    sourceConfig.allowedStores,
  );
  const fallbackStoreCandidates = Array.from(new Set((options?.fallbackStoreCandidates || []).filter(Boolean)));
  const resolvedStoreCandidates = guessedStore.storeCandidates.length > 0
    ? guessedStore.storeCandidates
    : fallbackStoreCandidates;
  const resolvedClassifierLabel = guessedStore.classifierLabel
    || (resolvedStoreCandidates.length > 0 ? 'Pilih store manual' : null);

  return {
    entityKey: `bundle:${bundle.scalev_bundle_id}`,
    entityLabel: getBundleDisplayLabel(bundle),
    customId: bundle.custom_id,
    scalevBundleId: bundle.scalev_bundle_id,
    storeName: guessedStore.storeName,
    storeCandidates: resolvedStoreCandidates,
    classifierLabel: resolvedClassifierLabel,
    score,
    source,
  };
}

function scoreBundleCandidateForLine(line: CanonicalLine, bundle: BundleCatalogRow): number {
  const skuHint = line.normalizedSku || line.sku;
  const query = normalizeIdentifier([line.productName, line.variation, skuHint].filter(Boolean).join(' '));
  const compactQuery = normalizeLoose([line.productName, line.variation, skuHint].filter(Boolean).join(' '));
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

  return score;
}

async function buildSuggestionCandidates(
  line: CanonicalLine,
  bundleCatalog: BundleCatalogRow[],
  remembered: ManualMemoryRow | null,
  sourceConfig: MarketplaceIntakeSourceConfig,
): Promise<{
  suggestions: MarketplaceIntakeSuggestionCandidate[];
  selected: MarketplaceIntakeSuggestionCandidate | null;
}> {
  const seen = new Set<string>();
  const suggestions: MarketplaceIntakeSuggestionCandidate[] = [];
  let selected: MarketplaceIntakeSuggestionCandidate | null = null;

  if (remembered) {
    const rememberedBundle = bundleCatalog.find((bundle) => bundle.scalev_bundle_id === remembered.scalev_bundle_id);
    if (rememberedBundle) {
      const candidate = await buildSuggestionCandidateFromBundle(
        rememberedBundle,
        sourceConfig,
        'remembered',
        10000,
        {
          preferredStoreName: remembered.mapped_store_name || null,
          textHints: [line.productName, line.variation],
          fallbackStoreCandidates: sourceConfig.allowedStores,
        },
      );
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
    const candidate = await buildSuggestionCandidateFromBundle(
      entry.bundle,
      sourceConfig,
      'catalog',
      entry.score,
      {
        textHints: [line.productName, line.variation],
        fallbackStoreCandidates: sourceConfig.allowedStores,
      },
    );
    if (seen.has(candidate.entityKey)) continue;
    suggestions.push(candidate);
    seen.add(candidate.entityKey);
  }

  return {
    suggestions,
    selected,
  };
}

function buildSkuNormalizationIssueCodes(line: Pick<CanonicalLine, 'skuNormalizationSource'>): string[] {
  return String(line.skuNormalizationSource || '').includes('alias')
    ? ['sku_alias_applied']
    : [];
}

function buildLineFromBundleCandidate(
  line: CanonicalLine,
  lineIndex: number,
  candidate: MarketplaceIntakeSuggestionCandidate,
  source: 'direct' | 'remembered' | 'manual' | 'companion',
): MarketplaceIntakePreviewLine {
  const issueCodes = [
    ...buildSkuNormalizationIssueCodes(line),
    ...(source === 'remembered'
      ? ['remembered_manual_match']
      : source === 'manual'
        ? ['manual_match_confirmed']
        : []),
  ];

  return {
    lineIndex,
    lineStatus: 'identified',
    issueCodes,
    rawPlatformSkuId: line.rawPlatformSkuId || null,
    rawSellerSku: line.rawSellerSku || null,
    mpSku: line.sku,
    normalizedSku: line.normalizedSku || line.sku,
    skuNormalizationSource: line.skuNormalizationSource || null,
    skuNormalizationReason: line.skuNormalizationReason || null,
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
    matchedEntitySource: source === 'direct'
      ? 'bundle.custom_id'
      : source === 'remembered'
        ? 'manual.memory'
        : source === 'manual'
          ? 'manual.selection'
          : 'order.companion_store',
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

function mapSuggestionSourceToLineSource(
  source: MarketplaceIntakeSuggestionCandidate['source'] | null | undefined,
): 'direct' | 'remembered' | 'manual' | 'companion' {
  if (source === 'remembered') return 'remembered';
  if (source === 'manual') return 'manual';
  if (source === 'companion') return 'companion';
  return 'direct';
}

function buildCanonicalLineFromPreviewLine(line: MarketplaceIntakePreviewLine): CanonicalLine {
  return {
    rawPlatformSkuId: line.rawPlatformSkuId,
    rawSellerSku: line.rawSellerSku,
    sku: line.mpSku,
    normalizedSku: line.normalizedSku,
    skuNormalizationSource: line.skuNormalizationSource,
    skuNormalizationReason: line.skuNormalizationReason,
    productName: line.mpProductName,
    variation: line.mpVariation,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    lineSubtotal: line.lineSubtotal,
    lineDiscount: line.lineDiscount,
    rawRow: line.rawRow,
  };
}

function inheritCompanionStoreForOrder(
  lines: MarketplaceIntakePreviewLine[],
): MarketplaceIntakePreviewLine[] {
  return lines.map((line, index) => {
    if (line.lineStatus !== 'store_unmapped') return line;

    const candidate = line.selectedSuggestion;
    if (!candidate || candidate.storeName || candidate.storeCandidates.length === 0) {
      return line;
    }

    const companionStores = Array.from(new Set(
      lines
        .filter((otherLine, otherIndex) => otherIndex !== index && otherLine.lineStatus === 'identified' && otherLine.mappedStoreName)
        .map((otherLine) => String(otherLine.mappedStoreName || ''))
        .filter(Boolean),
    ));
    if (companionStores.length !== 1) return line;

    const companionStoreName = companionStores[0];
    if (!candidate.storeCandidates.includes(companionStoreName)) return line;

    return buildLineFromBundleCandidate({
      rawPlatformSkuId: line.rawPlatformSkuId,
      rawSellerSku: line.rawSellerSku,
      sku: line.mpSku,
      normalizedSku: line.normalizedSku,
      skuNormalizationSource: line.skuNormalizationSource,
      skuNormalizationReason: line.skuNormalizationReason,
      productName: line.mpProductName,
      variation: line.mpVariation,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      lineSubtotal: line.lineSubtotal,
      lineDiscount: line.lineDiscount,
      rawRow: line.rawRow,
    }, line.lineIndex, {
      ...candidate,
      storeName: companionStoreName,
      classifierLabel: 'Inherited from companion order line',
      source: 'companion',
    }, 'companion');
  });
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

function buildOrderCustomerLabel(order: CanonicalOrder): string | null {
  return order.customerName || order.customerUsername || null;
}

function summarizeOrderFromLines(
  order: CanonicalOrder,
  lines: MarketplaceIntakePreviewLine[],
  extraIssueCodes: string[] = [],
): MarketplaceIntakePreviewOrder {
  const issueCodes = new Set<string>(extraIssueCodes);
  const shipping = resolveMarketplaceIntakeShippingFinancials({
    rawMeta: order.rawMeta || {},
    rawRows: order.lines.map((line) => line.rawRow || {}),
  });

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
      shipByDeadlineAt: order.shipByDeadlineAt,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      rtsAt: order.rtsAt,
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      canceledAt: order.canceledAt,
      customerUsername: order.customerUsername,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail,
      country: order.country,
      province: order.province,
      city: order.city,
      district: order.district,
      village: order.village,
      postalCode: order.postalCode,
      address: order.address,
      buyerNote: order.buyerNote,
      addressNotes: order.addressNotes,
      rawAddress: order.rawAddress,
      buyerPaidAmount: order.buyerPaidAmount,
      totalPaymentAmount: order.totalPaymentAmount,
      returnShippingCost: order.returnShippingCost,
      ...order.rawMeta,
      shippingCost: shipping.grossPresent ? shipping.grossAmount : order.shippingCost,
      shippingCostBuyer: shipping.buyerPresent ? shipping.buyerAmount : order.shippingCost,
      shippingCostGross: shipping.grossPresent ? shipping.grossAmount : order.shippingCost,
      shippingDiscountCompany: shipping.companyDiscountPresent ? shipping.companyDiscountAmount : 0,
      shippingDiscountPlatform: shipping.platformDiscountPresent ? shipping.platformDiscountAmount : 0,
      estimatedShippingCost: shipping.estimatedGrossPresent
        ? shipping.estimatedGrossAmount
        : Number(order.rawMeta?.estimatedShippingCost ?? order.estimatedShippingCost ?? 0) || 0,
      shippingFeeEstimatedDeduction: shipping.platform === 'shopee'
        ? (shipping.companyDiscountPresent ? shipping.companyDiscountAmount : 0)
        : Number(order.rawMeta?.shippingFeeEstimatedDeduction ?? order.shippingFeeEstimatedDeduction ?? 0) || 0,
    },
    lines,
  };
}

async function classifyOrder(
  order: CanonicalOrder,
  identifierLookup: Map<string, BundleIdentifierRow[]>,
  bundleCatalog: BundleCatalogRow[],
  manualMemoryMap: Map<string, ManualMemoryRow>,
  business: BusinessRow,
  sourceConfig: MarketplaceIntakeSourceConfig,
): Promise<MarketplaceIntakePreviewOrder> {
  const issueCodes = new Set<string>();

  const lines: MarketplaceIntakePreviewLine[] = [];
  for (const [index, line] of order.lines.entries()) {
    const matchSignature = buildMatchSignature(line);
    const normalizedSku = line.normalizedSku || line.sku;
    const baseIssueCodes = buildSkuNormalizationIssueCodes(line);
    const identifier = resolveBundleIdentifierForSku(normalizedSku, identifierLookup);
    if (identifier.status === 'missing') {
      const { suggestions, selected } = await buildSuggestionCandidates(
        line,
        bundleCatalog,
        manualMemoryMap.get(matchSignature) || null,
        sourceConfig,
      );
      if (selected && selected.storeName) {
        lines.push(buildLineFromBundleCandidate(line, index, selected, 'remembered'));
        continue;
      }
      issueCodes.add('custom_id_not_found');
      lines.push({
        lineIndex: index,
        lineStatus: 'not_identified',
        issueCodes: [...baseIssueCodes, 'custom_id_not_found'],
        rawPlatformSkuId: line.rawPlatformSkuId || null,
        rawSellerSku: line.rawSellerSku || null,
        mpSku: line.sku,
        normalizedSku,
        skuNormalizationSource: line.skuNormalizationSource || null,
        skuNormalizationReason: line.skuNormalizationReason || null,
        mpProductName: line.productName,
        mpVariation: line.variation,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineSubtotal: line.lineSubtotal,
        lineDiscount: line.lineDiscount,
        detectedCustomId: normalizedSku,
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
      });
      continue;
    }

    if (identifier.status === 'ambiguous') {
      const { suggestions, selected } = await buildSuggestionCandidates(
        line,
        bundleCatalog,
        manualMemoryMap.get(matchSignature) || null,
        sourceConfig,
      );
      if (selected && selected.storeName) {
        lines.push(buildLineFromBundleCandidate(line, index, selected, 'remembered'));
        continue;
      }
      issueCodes.add('custom_id_ambiguous');
      lines.push({
        lineIndex: index,
        lineStatus: 'not_identified',
        issueCodes: [...baseIssueCodes, 'custom_id_ambiguous'],
        rawPlatformSkuId: line.rawPlatformSkuId || null,
        rawSellerSku: line.rawSellerSku || null,
        mpSku: line.sku,
        normalizedSku,
        skuNormalizationSource: line.skuNormalizationSource || null,
        skuNormalizationReason: line.skuNormalizationReason || null,
        mpProductName: line.productName,
        mpVariation: line.variation,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineSubtotal: line.lineSubtotal,
        lineDiscount: line.lineDiscount,
        detectedCustomId: normalizedSku,
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
      });
      continue;
    }

    const match = identifier.row;
    const matchedBundle = bundleCatalog.find((bundle) => bundle.scalev_bundle_id === Number(match.scalev_bundle_id || 0)) || {
      business_id: business.id,
      scalev_bundle_id: Number(match.scalev_bundle_id || String(match.entity_key).split(':')[1] || 0),
      name: match.entity_label,
      public_name: match.entity_label,
      display: match.entity_label,
      custom_id: match.identifier,
    };
    const directCandidate = await buildSuggestionCandidateFromBundle(
      matchedBundle,
      sourceConfig,
      'catalog',
      9999,
      {
        textHints: [line.productName, line.variation],
        fallbackStoreCandidates: sourceConfig.allowedStores,
      },
    );

    if (!directCandidate.storeName || !sourceConfig.allowedStores.includes(directCandidate.storeName)) {
      issueCodes.add('store_classifier_missing');
      lines.push({
        lineIndex: index,
        lineStatus: 'store_unmapped',
        issueCodes: [...baseIssueCodes, 'store_classifier_missing'],
        rawPlatformSkuId: line.rawPlatformSkuId || null,
        rawSellerSku: line.rawSellerSku || null,
        mpSku: line.sku,
        normalizedSku,
        skuNormalizationSource: line.skuNormalizationSource || null,
        skuNormalizationReason: line.skuNormalizationReason || null,
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
        selectedSuggestion: directCandidate,
        rawRow: line.rawRow,
      });
      continue;
    }

    lines.push(buildLineFromBundleCandidate(line, index, directCandidate, 'direct'));
  }

  const normalizedLines = inheritCompanionStoreForOrder(lines);
  return summarizeOrderFromLines(order, normalizedLines, Array.from(issueCodes));
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

export async function previewMarketplaceIntake(input: {
  file: File;
  filenameOverride?: string | null;
  sourceKey?: string | null;
}): Promise<MarketplaceIntakePreview> {
  const sourceConfig = cleanText(input.sourceKey)
    ? await resolveMarketplaceIntakeSourceConfig(input.sourceKey)
    : await detectMarketplaceIntakeSourceConfig({
      file: input.file,
      filenameOverride: input.filenameOverride,
    });
  const business = await loadBusinessForSource(sourceConfig);
  const { orders, rowCount, headers } = await parseMarketplaceWorkbook({
    file: input.file,
    sourceConfig,
  });
  const sourceOrderDate = inferSourceOrderDate(orders);
  const fingerprint = buildPreviewFingerprint({
    sourceKey: sourceConfig.sourceKey,
    businessCode: business.business_code,
    sourceOrderDate,
    orders,
  });
  const [bundleCatalog, manualMemoryMap, skuAliasRules] = await Promise.all([
    loadBundleCatalog(business.id),
    loadManualMemoryMap(business.id, sourceConfig),
    loadSkuAliasRules(sourceConfig, business),
  ]);
  const normalizedOrders = applySkuAliasesToOrders(orders, skuAliasRules);

  const normalizedIdentifiers = Array.from(new Set(
    normalizedOrders
      .flatMap((order) => order.lines.map((line) => normalizeIdentifier(line.normalizedSku || line.sku)))
      .filter(Boolean),
  ));
  const identifierLookup = await loadBundleIdentifierLookup(business.id, normalizedIdentifiers);

  const previewOrders: MarketplaceIntakePreviewOrder[] = [];
  for (const order of normalizedOrders) {
    previewOrders.push(await classifyOrder(order, identifierLookup, bundleCatalog, manualMemoryMap, business, sourceConfig));
  }
  previewOrders.sort((left, right) => left.externalOrderId.localeCompare(right.externalOrderId));

  return {
    source: {
      id: sourceConfig.id,
      sourceKey: sourceConfig.sourceKey,
      sourceLabel: sourceConfig.sourceLabel,
      platform: sourceConfig.platform,
      businessId: business.id,
      businessCode: business.business_code,
      allowedStores: sourceConfig.allowedStores,
    },
    filename: String(input.filenameOverride || input.file.name || `${sourceConfig.sourceKey}-upload`),
    sourceOrderDate,
    sourceHeaders: headers,
    fingerprint,
    rowCount,
    platform: sourceConfig.platform,
    generatedAt: new Date().toISOString(),
    summary: buildPreviewSummary(previewOrders),
    orders: previewOrders,
  };
}

export async function previewShopeeRltIntake(input: {
  file: File;
  filenameOverride?: string | null;
}): Promise<MarketplaceIntakePreview> {
  return previewMarketplaceIntake({ ...input, sourceKey: 'shopee_rlt' });
}

export async function saveMarketplaceIntakePreview(input: {
  preview: MarketplaceIntakePreview;
  uploadedByEmail: string | null;
  manualSelections?: MarketplaceIntakeManualSelectionInput[];
}) {
  const preview = input.preview;
  const sourceConfig = await resolveMarketplaceIntakeSourceConfig(preview?.source?.sourceKey);
  const business = await loadBusinessForSource(sourceConfig);

  if (!preview?.source || preview.source.sourceKey !== sourceConfig.sourceKey) {
    throw new Error(`Preview intake tidak valid untuk ${sourceConfig.sourceLabel}.`);
  }
  if (Number(preview.source.businessId || 0) !== business.id) {
    throw new Error('Business preview berubah. Refresh preview lalu coba simpan lagi.');
  }

  const bundleCatalog = await loadBundleCatalog(business.id);
  const bundleById = new Map<number, BundleCatalogRow>(bundleCatalog.map((bundle) => [bundle.scalev_bundle_id, bundle]));
  const selectionMap = new Map<string, MarketplaceIntakeManualSelectionInput>();
  for (const selection of input.manualSelections || []) {
    const key = `${selection.externalOrderId}::${selection.lineIndex}`;
    selectionMap.set(key, selection);
  }

  const normalizedOrders = await Promise.all((preview.orders || []).map(async (order) => {
    const lines = await Promise.all((order.lines || []).map(async (line) => {
      const canonicalLine = buildCanonicalLineFromPreviewLine(line);
      const selection = selectionMap.get(`${order.externalOrderId}::${line.lineIndex}`);

      if (selection) {
        const bundle = bundleById.get(Number(selection.scalevBundleId || 0));
        if (bundle) {
          const selectedStoreName = cleanText(selection.mappedStoreName);
          const fallbackStoreCandidates = selectedStoreName ? [selectedStoreName] : sourceConfig.allowedStores;
          const candidate = await buildSuggestionCandidateFromBundle(
            bundle,
            sourceConfig,
            'manual',
            99999,
            {
              preferredStoreName: selectedStoreName,
              textHints: [line.mpProductName, line.mpVariation],
              fallbackStoreCandidates,
            },
          );

          if (selectedStoreName && sourceConfig.allowedStores.includes(selectedStoreName)) {
            return buildLineFromBundleCandidate(canonicalLine, line.lineIndex, {
              ...candidate,
              storeName: selectedStoreName,
              storeCandidates: Array.from(new Set([selectedStoreName, ...(candidate.storeCandidates || [])])),
              source: 'manual',
            }, 'manual');
          }

          if (candidate.storeName && sourceConfig.allowedStores.includes(candidate.storeName)) {
            return buildLineFromBundleCandidate(canonicalLine, line.lineIndex, candidate, 'manual');
          }
        }
      }

      const previewCandidate = line.selectedSuggestion;
      if (previewCandidate?.storeName && sourceConfig.allowedStores.includes(previewCandidate.storeName)) {
        return buildLineFromBundleCandidate(
          canonicalLine,
          line.lineIndex,
          previewCandidate,
          mapSuggestionSourceToLineSource(previewCandidate.source),
        );
      }

      return line;
    }));

    return summarizeOrderFromLines({
      platform: sourceConfig.platform,
      externalId: order.externalOrderId,
      status: String(order.rawMeta?.status || '') || null,
      substatus: String(order.rawMeta?.substatus || '') || null,
      paymentMethodLabel: order.paymentMethodLabel,
      createdAt: String(order.rawMeta?.createdAt || '') || null,
      paidAt: String(order.rawMeta?.paidAt || '') || null,
      rtsAt: String(order.rawMeta?.rtsAt || '') || null,
      shippedAt: String(order.rawMeta?.shippedAt || '') || null,
      deliveredAt: String(order.rawMeta?.deliveredAt || '') || null,
      canceledAt: String(order.rawMeta?.canceledAt || '') || null,
      trackingNumber: order.trackingNumber,
      shippingProvider: order.shippingProvider,
      deliveryOption: order.deliveryOption,
      customerUsername: String(order.rawMeta?.customerUsername || '') || null,
      customerName: order.recipientName,
      customerPhone: String(order.rawMeta?.customerPhone || '') || null,
      customerEmail: String(order.rawMeta?.customerEmail || '') || null,
      country: String(order.rawMeta?.country || '') || null,
      province: String(order.rawMeta?.province || '') || null,
      city: String(order.rawMeta?.city || '') || null,
      district: String(order.rawMeta?.district || '') || null,
      village: String(order.rawMeta?.village || '') || null,
      postalCode: String(order.rawMeta?.postalCode || '') || null,
      address: String(order.rawMeta?.address || '') || null,
      addressNotes: String(order.rawMeta?.addressNotes || '') || null,
      rawAddress: String(order.rawMeta?.rawAddress || '') || null,
      shippingCost: Number(order.rawMeta?.shippingCost || 0) || 0,
      orderAmount: order.orderAmount,
      lines: lines.map((line) => ({
        rawPlatformSkuId: line.rawPlatformSkuId,
        rawSellerSku: line.rawSellerSku,
        sku: line.mpSku,
        normalizedSku: line.normalizedSku,
        skuNormalizationSource: line.skuNormalizationSource,
        skuNormalizationReason: line.skuNormalizationReason,
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
        shipByDeadlineAt: String(order.rawMeta?.shipByDeadlineAt || ''),
        buyerPaidAmount: Number(order.rawMeta?.buyerPaidAmount || 0) || 0,
        totalPaymentAmount: Number(order.rawMeta?.totalPaymentAmount || 0) || 0,
        estimatedShippingCost: Number(order.rawMeta?.estimatedShippingCost || 0) || 0,
        shippingFeeEstimatedDeduction: Number(order.rawMeta?.shippingFeeEstimatedDeduction || 0) || 0,
        returnShippingCost: Number(order.rawMeta?.returnShippingCost || 0) || 0,
      },
    }, lines, []);
  }));

  const summary = buildPreviewSummary(normalizedOrders);
  if (summary.needsReviewOrders > 0 || summary.unidentifiedLines > 0 || summary.unresolvedStoreLines > 0) {
    throw new Error('Masih ada order yang belum siap. Selesaikan identifikasi SKU dulu sebelum menyimpan.');
  }

  const sourceOrderDate = preview.sourceOrderDate || inferSourceOrderDate(normalizedOrders.map((order) => ({
    platform: sourceConfig.platform,
    externalId: order.externalOrderId,
    status: String(order.rawMeta?.status || '') || null,
    substatus: String(order.rawMeta?.substatus || '') || null,
    paymentMethodLabel: order.paymentMethodLabel,
    createdAt: String(order.rawMeta?.createdAt || '') || null,
    paidAt: String(order.rawMeta?.paidAt || '') || null,
    rtsAt: String(order.rawMeta?.rtsAt || '') || null,
    shippedAt: String(order.rawMeta?.shippedAt || '') || null,
    deliveredAt: String(order.rawMeta?.deliveredAt || '') || null,
    canceledAt: String(order.rawMeta?.canceledAt || '') || null,
    trackingNumber: order.trackingNumber,
    shippingProvider: order.shippingProvider,
    deliveryOption: order.deliveryOption,
    customerUsername: String(order.rawMeta?.customerUsername || '') || null,
    customerName: order.recipientName,
    customerPhone: String(order.rawMeta?.customerPhone || '') || null,
    customerEmail: String(order.rawMeta?.customerEmail || '') || null,
    country: String(order.rawMeta?.country || '') || null,
    province: String(order.rawMeta?.province || '') || null,
    city: String(order.rawMeta?.city || '') || null,
    district: String(order.rawMeta?.district || '') || null,
    village: String(order.rawMeta?.village || '') || null,
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
      shipByDeadlineAt: String(order.rawMeta?.shipByDeadlineAt || ''),
      buyerPaidAmount: Number(order.rawMeta?.buyerPaidAmount || 0) || 0,
      totalPaymentAmount: Number(order.rawMeta?.totalPaymentAmount || 0) || 0,
      estimatedShippingCost: Number(order.rawMeta?.estimatedShippingCost || 0) || 0,
      shippingFeeEstimatedDeduction: Number(order.rawMeta?.shippingFeeEstimatedDeduction || 0) || 0,
      returnShippingCost: Number(order.rawMeta?.returnShippingCost || 0) || 0,
    },
  })));
  if (!sourceOrderDate) {
    throw new Error(`Tanggal order file tidak bisa ditentukan. Pastikan file ${sourceConfig.sourceLabel} memiliki waktu order yang valid.`);
  }

  const sourceHeaders = Array.from(new Set(
    Array.isArray(preview.sourceHeaders)
      ? preview.sourceHeaders.map((header) => String(header || '').trim()).filter(Boolean)
      : normalizedOrders.flatMap((order) => order.lines.flatMap((line) => Object.keys(line.rawRow || {}))),
  ));

  const rawSnapshot = {
    kind: 'marketplace_intake_raw_snapshot',
    version: 1,
    source: preview.source,
    filename: preview.filename,
    sourceOrderDate,
    sourceHeaders,
    fingerprint: preview.fingerprint,
    rowCount: preview.rowCount,
    generatedAt: preview.generatedAt,
    summary,
    orders: normalizedOrders.map((order) => ({
      externalOrderId: order.externalOrderId,
      customerLabel: order.customerLabel,
      recipientName: order.recipientName,
      trackingNumber: order.trackingNumber,
      rawMeta: order.rawMeta || {},
      lines: (order.lines || []).map((line) => ({
        lineIndex: line.lineIndex,
        rawRow: line.rawRow || {},
      })),
    })),
  };

  const fingerprint = String(preview.fingerprint || '').trim();
  if (!fingerprint) {
    throw new Error('Fingerprint preview tidak valid. Refresh preview lalu coba simpan lagi.');
  }

  const duplicateRes = await createServiceSupabase()
    .from('marketplace_intake_batches')
    .select('id')
    .eq('source_key', sourceConfig.sourceKey)
    .eq('business_code', business.business_code)
    .eq('batch_fingerprint', fingerprint)
    .maybeSingle();

  if (duplicateRes.error && !isMissingTableError(duplicateRes.error)) {
    throw duplicateRes.error;
  }
  if (duplicateRes.data?.id) {
    throw new Error(`File identik ini sudah pernah disimpan sebagai batch #${duplicateRes.data.id}. Upload duplikat tidak diizinkan.`);
  }

  const svc = createServiceSupabase();
  const batchInsert = {
    source_id: null,
    source_key: sourceConfig.sourceKey,
    source_label: sourceConfig.sourceLabel,
    platform: sourceConfig.platform,
    business_id: business.id,
    business_code: business.business_code,
    filename: preview.filename,
    source_order_date: sourceOrderDate,
    batch_fingerprint: fingerprint,
    source_headers: sourceHeaders,
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
    raw_snapshot: rawSnapshot,
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
  let insertedOrderIds: number[] = [];

  try {
    const orderRows = normalizedOrders.map((order) => {
      const marketplaceFeeFinancials = resolveMarketplaceIntakeFeeFinancials({
        platform: String(order.rawMeta?.platform || ''),
        orderAmount: order.orderAmount,
        buyerPaidAmount: Number(order.rawMeta?.buyerPaidAmount || 0) || 0,
        totalPaymentAmount: Number(order.rawMeta?.totalPaymentAmount || 0) || 0,
        shippingCost: Number(order.rawMeta?.shippingCostBuyer ?? order.rawMeta?.shippingCost ?? 0) || 0,
        lines: (order.lines || []).map((line) => ({
          lineSubtotal: line.lineSubtotal,
          quantity: line.quantity,
          rawRow: line.rawRow,
        })),
      });
      const rawMeta = {
        ...(order.rawMeta || {}),
        marketplaceFeeAmount: marketplaceFeeFinancials.amount,
        marketplaceFeeSource: marketplaceFeeFinancials.source,
        marketplaceFeeFinancials,
      };

      return {
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
        mp_order_status: String(order.rawMeta?.marketplaceStatus || order.rawMeta?.status || '') || null,
        mp_cancel_return_status: String(order.rawMeta?.cancellationStatus || order.rawMeta?.substatus || '') || null,
        mp_ship_by_deadline_at: String(order.rawMeta?.shipByDeadlineAt || '') || null,
        mp_order_created_at: String(order.rawMeta?.createdAt || '') || null,
        mp_payment_paid_at: String(order.rawMeta?.paidAt || '') || null,
        mp_ready_to_ship_at: String(order.rawMeta?.rtsAt || '') || null,
        mp_order_completed_at: String(order.rawMeta?.deliveredAt || '') || null,
        mp_customer_username: String(order.rawMeta?.customerUsername || '') || null,
        mp_customer_phone: String(order.rawMeta?.customerPhone || '') || null,
        mp_shipping_address: String(order.rawMeta?.address || '') || null,
        mp_shipping_district: String(order.rawMeta?.district || '') || null,
        mp_shipping_city: String(order.rawMeta?.city || '') || null,
        mp_shipping_province: String(order.rawMeta?.province || '') || null,
        mp_shipping_postal_code: String(order.rawMeta?.postalCode || '') || null,
        mp_raw_shipping_address: String(order.rawMeta?.rawAddress || '') || null,
        mp_buyer_note: String(order.rawMeta?.buyerNote || '') || null,
        mp_seller_note: String(order.rawMeta?.addressNotes || '') || null,
        mp_buyer_paid_amount: Number(order.rawMeta?.buyerPaidAmount || 0) || 0,
        mp_total_payment_amount: Number(order.rawMeta?.totalPaymentAmount || 0) || 0,
        mp_shipping_cost_buyer: Number(order.rawMeta?.shippingCostBuyer ?? order.rawMeta?.shippingCost ?? 0) || 0,
        mp_estimated_shipping_cost: Number(order.rawMeta?.estimatedShippingCost || 0) || 0,
        mp_shipping_fee_estimated_deduction: Number(
          order.rawMeta?.shippingFeeEstimatedDeduction
          ?? order.rawMeta?.shippingDiscountCompany
          ?? 0,
        ) || 0,
        mp_return_shipping_cost: Number(order.rawMeta?.returnShippingCost || 0) || 0,
        mp_marketplace_fee_amount: marketplaceFeeFinancials.present ? marketplaceFeeFinancials.amount : null,
        shipment_date: null,
        warehouse_status: 'staged',
        warehouse_note: null,
        warehouse_updated_at: null,
        warehouse_updated_by_email: null,
        raw_meta: rawMeta,
      };
    });

    const ordersRes = await insertRowsWithSchemaFallback({
      table: 'marketplace_intake_orders',
      rows: orderRows,
      select: 'id, external_order_id',
      removableColumns: [
        'mp_order_status',
        'mp_cancel_return_status',
        'mp_ship_by_deadline_at',
        'mp_order_created_at',
        'mp_payment_paid_at',
        'mp_ready_to_ship_at',
        'mp_order_completed_at',
        'mp_customer_username',
        'mp_customer_phone',
        'mp_shipping_address',
        'mp_shipping_district',
        'mp_shipping_city',
        'mp_shipping_province',
        'mp_shipping_postal_code',
        'mp_raw_shipping_address',
        'mp_buyer_note',
        'mp_seller_note',
        'mp_buyer_paid_amount',
        'mp_total_payment_amount',
        'mp_shipping_cost_buyer',
        'mp_estimated_shipping_cost',
        'mp_shipping_fee_estimated_deduction',
        'mp_return_shipping_cost',
        'mp_marketplace_fee_amount',
      ],
    });

    const orderIdByExternalId = new Map<string, number>();
    insertedOrderIds = (ordersRes.data || [])
      .map((row: any) => Number(row.id || 0))
      .filter((id: number) => Number.isFinite(id) && id > 0);
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
      raw_platform_sku_id: line.rawPlatformSkuId,
      raw_seller_sku: line.rawSellerSku,
      mp_sku: line.mpSku,
      normalized_sku: line.normalizedSku,
      sku_normalization_source: line.skuNormalizationSource,
      sku_normalization_reason: line.skuNormalizationReason,
      mp_product_name: line.mpProductName,
      mp_variation: line.mpVariation,
      mp_parent_sku: String(line.rawRow?.['SKU Induk'] || '') || null,
      mp_reference_sku: String(line.rawRow?.['Nomor Referensi SKU'] || '') || null,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      line_subtotal: line.lineSubtotal,
      line_discount: line.lineDiscount,
      mp_price_initial: parseNumber(line.rawRow?.['Harga Awal']) || parseNumber(line.rawRow?.['SKU Unit Original Price']),
      mp_price_after_discount: parseNumber(line.rawRow?.['Harga Setelah Diskon'])
        || (
          parseNumber(line.rawRow?.['SKU Subtotal After Discount']) > 0
            ? parseNumber(line.rawRow?.['SKU Subtotal After Discount']) / Math.max(line.quantity, 1)
            : 0
        )
        || line.unitPrice,
      mp_returned_quantity: parseInteger(line.rawRow?.['Returned quantity']),
      mp_total_discount: parseNumber(line.rawRow?.['Total Diskon'])
        || parseNumber(line.rawRow?.['SKU Seller Discount']) + parseNumber(line.rawRow?.['SKU Platform Discount']),
      mp_discount_seller: parseNumber(line.rawRow?.['Diskon Dari Penjual']) || parseNumber(line.rawRow?.['SKU Seller Discount']),
      mp_discount_shopee: parseNumber(line.rawRow?.['Diskon Dari Shopee']) || parseNumber(line.rawRow?.['SKU Platform Discount']),
      mp_product_weight_grams: parseNumber(line.rawRow?.['Berat Produk']) || parseWeightGrams(line.rawRow?.['Weight(kg)']) || 0,
      mp_order_product_count: parseInteger(line.rawRow?.['Jumlah Produk di Pesan']) || parseInteger(line.rawRow?.Quantity),
      mp_total_weight_grams: parseNumber(line.rawRow?.['Total Berat']) || parseWeightGrams(line.rawRow?.['Weight(kg)']) || 0,
      mp_voucher_seller: parseNumber(line.rawRow?.['Voucher Ditanggung Penjual']),
      mp_cashback_coin: parseNumber(line.rawRow?.['Cashback Koin']),
      mp_voucher_shopee: parseNumber(line.rawRow?.['Voucher Ditanggung Shopee']),
      mp_bundle_discount: parseNumber(line.rawRow?.['Paket Diskon']),
      mp_bundle_discount_shopee: parseNumber(line.rawRow?.['Paket Diskon (Diskon dari Shopee)']),
      mp_bundle_discount_seller: parseNumber(line.rawRow?.['Paket Diskon (Diskon dari Penjual)']),
      mp_shopee_coin_discount: parseNumber(line.rawRow?.['Potongan Koin Shopee']),
      mp_credit_card_discount: parseNumber(line.rawRow?.['Diskon Kartu Kredit']),
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
      await insertRowsWithSchemaFallback({
        table: 'marketplace_intake_order_lines',
        rows: lineRows,
        removableColumns: [
          'raw_platform_sku_id',
          'raw_seller_sku',
          'normalized_sku',
          'sku_normalization_source',
          'sku_normalization_reason',
          'mp_parent_sku',
          'mp_reference_sku',
          'mp_price_initial',
          'mp_price_after_discount',
          'mp_returned_quantity',
          'mp_total_discount',
          'mp_discount_seller',
          'mp_discount_shopee',
          'mp_product_weight_grams',
          'mp_order_product_count',
          'mp_total_weight_grams',
          'mp_voucher_seller',
          'mp_cashback_coin',
          'mp_voucher_shopee',
          'mp_bundle_discount',
          'mp_bundle_discount_shopee',
          'mp_bundle_discount_seller',
          'mp_shopee_coin_discount',
          'mp_credit_card_discount',
        ],
      });
    }

    const manualMemoryUpsertMap = new Map<string, {
    source_key: string;
    source_label: string;
    platform: MarketplaceIntakePlatform;
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
          sourceConfig.sourceKey,
          business.business_code,
          line.matchSignature,
        ].join('::');

        const nextRow = {
          source_key: sourceConfig.sourceKey,
          source_label: sourceConfig.sourceLabel,
          platform: sourceConfig.platform,
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
  } catch (error) {
    try {
      if (insertedOrderIds.length > 0) {
        await svc.from('marketplace_intake_order_lines').delete().in('intake_order_id', insertedOrderIds);
        await svc.from('marketplace_intake_orders').delete().in('id', insertedOrderIds);
      }
      await svc.from('marketplace_intake_batches').delete().eq('id', batchId);
    } catch (cleanupError) {
      console.error('Marketplace intake cleanup after failed save error:', cleanupError);
    }
    throw error;
  }
}

export type MarketplaceIntakeWarehouseStatus = 'staged' | 'scheduled' | 'hold' | 'canceled';

export type MarketplaceIntakeWorkspaceLineRow = {
  lineIndex: number;
  rawPlatformSkuId: string | null;
  rawSellerSku: string | null;
  mpSku: string | null;
  normalizedSku: string | null;
  skuNormalizationSource: string | null;
  skuNormalizationReason: string | null;
  mpProductName: string;
  mpVariation: string | null;
  quantity: number;
  lineSubtotal: number;
  detectedCustomId: string | null;
  matchedEntityLabel: string | null;
  mappedStoreName: string | null;
  lineStatus: string;
  issueCodes: string[];
};

export type MarketplaceIntakeWorkspaceOrderRow = {
  id: number;
  batchId: number;
  batchFilename: string;
  uploadedAt: string | null;
  uploadedByEmail: string | null;
  batchAppLastPromoteStatus: string | null;
  batchAppLastPromoteAt: string | null;
  batchAppLastPromoteOrderCount: number;
  batchAppLastPromoteInsertedCount: number;
  batchAppLastPromoteUpdatedCount: number;
  batchAppLastPromoteUpdatedWebhookCount: number;
  batchAppLastPromoteUpdatedAuthoritativeCount: number;
  batchAppLastPromoteMatchedExternalIdCount: number;
  batchAppLastPromoteMatchedTrackingCount: number;
  batchAppLastPromoteSkippedCount: number;
  batchAppLastPromoteError: string | null;
  batchScalevLastSendStatus: string | null;
  batchScalevLastSendAt: string | null;
  batchScalevLastSendRowCount: number;
  batchScalevLastSendError: string | null;
  batchScalevLastReconcileStatus: string | null;
  batchScalevLastReconcileAt: string | null;
  batchScalevLastReconcileTargetCount: number;
  batchScalevLastReconcileMatchedCount: number;
  batchScalevLastReconcileUpdatedCount: number;
  batchScalevLastReconcileAlreadyLinkedCount: number;
  batchScalevLastReconcileUnmatchedCount: number;
  batchScalevLastReconcileConflictCount: number;
  batchScalevLastReconcileErrorCount: number;
  batchScalevLastReconcileError: string | null;
  externalOrderId: string;
  customerLabel: string | null;
  recipientName: string | null;
  finalStoreName: string | null;
  lineCount: number;
  orderAmount: number;
  orderStatus: string;
  trackingNumber: string | null;
  issueCodes: string[];
  shipmentDate: string | null;
  warehouseStatus: MarketplaceIntakeWarehouseStatus;
  warehouseNote: string | null;
  warehouseUpdatedAt: string | null;
  warehouseUpdatedByEmail: string | null;
  lines: MarketplaceIntakeWorkspaceLineRow[];
};

export type MarketplaceIntakeWorkspaceResponse = {
  shipmentDate: string;
  summary: {
    stagedCount: number;
    scheduledCount: number;
    holdCount: number;
    canceledCount: number;
  };
  stagedOrders: MarketplaceIntakeWorkspaceOrderRow[];
  shipmentOrders: MarketplaceIntakeWorkspaceOrderRow[];
};

export type MarketplaceIntakeWorkspaceUpdateInput = {
  orderIds: number[];
  shipmentDate: string | null;
  warehouseStatus: MarketplaceIntakeWarehouseStatus;
  sourceKey?: string | null;
  warehouseNote?: string | null;
  updatedByEmail: string | null;
};

type MarketplaceIntakeBatchMetaRow = {
  id: number;
  filename: string;
  confirmedAt: string | null;
  uploadedByEmail: string | null;
  appLastPromoteStatus: string | null;
  appLastPromoteAt: string | null;
  appLastPromoteOrderCount: number;
  appLastPromoteInsertedCount: number;
  appLastPromoteUpdatedCount: number;
  appLastPromoteUpdatedWebhookCount: number;
  appLastPromoteUpdatedAuthoritativeCount: number;
  appLastPromoteMatchedExternalIdCount: number;
  appLastPromoteMatchedTrackingCount: number;
  appLastPromoteSkippedCount: number;
  appLastPromoteError: string | null;
  scalevLastSendStatus: string | null;
  scalevLastSendAt: string | null;
  scalevLastSendRowCount: number;
  scalevLastSendError: string | null;
  scalevLastReconcileStatus: string | null;
  scalevLastReconcileAt: string | null;
  scalevLastReconcileTargetCount: number;
  scalevLastReconcileMatchedCount: number;
  scalevLastReconcileUpdatedCount: number;
  scalevLastReconcileAlreadyLinkedCount: number;
  scalevLastReconcileUnmatchedCount: number;
  scalevLastReconcileConflictCount: number;
  scalevLastReconcileErrorCount: number;
  scalevLastReconcileError: string | null;
};

function normalizeShipmentDate(value: string): string {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error('Format tanggal tidak valid. Gunakan YYYY-MM-DD.');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+07:00`);
  if (
    !Number.isFinite(year)
    || !Number.isFinite(month)
    || !Number.isFinite(day)
    || Number.isNaN(parsed.getTime())
  ) {
    throw new Error('Format tanggal tidak valid. Gunakan YYYY-MM-DD.');
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

async function loadWorkspaceBatchMeta(
  sourceConfigs: MarketplaceIntakeSourceConfig[],
): Promise<Map<number, MarketplaceIntakeBatchMetaRow>> {
  const svc = createServiceSupabase();
  const sourceKeys = Array.from(new Set(sourceConfigs.map((config) => config.sourceKey)));
  let data: any[] | null = null;
  let error: any = null;

  let primaryQuery: any = svc
    .from('marketplace_intake_batches')
    .select(`
      id,
      filename,
      confirmed_at,
      uploaded_by_email,
      app_last_promote_status,
      app_last_promote_at,
      app_last_promote_order_count,
      app_last_promote_inserted_count,
      app_last_promote_updated_count,
      app_last_promote_updated_webhook_count,
      app_last_promote_updated_authoritative_count,
      app_last_promote_matched_external_id_count,
      app_last_promote_matched_tracking_count,
      app_last_promote_skipped_count,
      app_last_promote_error,
      scalev_last_send_status,
      scalev_last_send_at,
      scalev_last_send_row_count,
      scalev_last_send_error,
      scalev_last_reconcile_status,
      scalev_last_reconcile_at,
      scalev_last_reconcile_target_count,
      scalev_last_reconcile_matched_count,
      scalev_last_reconcile_updated_count,
      scalev_last_reconcile_already_linked_count,
      scalev_last_reconcile_unmatched_count,
      scalev_last_reconcile_conflict_count,
      scalev_last_reconcile_error_count,
      scalev_last_reconcile_error
    `)
    .order('confirmed_at', { ascending: false })
    .order('id', { ascending: false });
  primaryQuery = sourceKeys.length === 1
    ? primaryQuery.eq('source_key', sourceKeys[0])
    : primaryQuery.in('source_key', sourceKeys);

  const primaryRes = await primaryQuery;

  data = primaryRes.data;
  error = primaryRes.error;

  if (error) {
    let fallbackQuery: any = svc
      .from('marketplace_intake_batches')
      .select(`
        id,
        filename,
        confirmed_at,
        uploaded_by_email,
        app_last_promote_status,
        app_last_promote_at,
        app_last_promote_order_count,
        app_last_promote_inserted_count,
        app_last_promote_updated_count,
        app_last_promote_updated_webhook_count,
        app_last_promote_updated_authoritative_count,
        app_last_promote_matched_external_id_count,
        app_last_promote_matched_tracking_count,
        app_last_promote_skipped_count,
        app_last_promote_error,
        scalev_last_send_status,
        scalev_last_send_at,
        scalev_last_send_row_count,
        scalev_last_send_error
      `)
      .order('confirmed_at', { ascending: false })
      .order('id', { ascending: false });
    fallbackQuery = sourceKeys.length === 1
      ? fallbackQuery.eq('source_key', sourceKeys[0])
      : fallbackQuery.in('source_key', sourceKeys);

    const fallbackRes = await fallbackQuery;

    data = fallbackRes.data;
    error = fallbackRes.error;
  }

  if (error) {
    let fallbackQuery: any = svc
      .from('marketplace_intake_batches')
      .select(`
        id,
        filename,
        confirmed_at,
        uploaded_by_email,
        scalev_last_send_status,
        scalev_last_send_at,
        scalev_last_send_row_count,
        scalev_last_send_error
      `)
      .order('confirmed_at', { ascending: false })
      .order('id', { ascending: false });
    fallbackQuery = sourceKeys.length === 1
      ? fallbackQuery.eq('source_key', sourceKeys[0])
      : fallbackQuery.in('source_key', sourceKeys);

    const fallbackRes = await fallbackQuery;

    data = fallbackRes.data;
    error = fallbackRes.error;
  }

  if (error) {
    if (isMissingTableError(error)) throw new Error(getMissingSchemaMessage());
    throw error;
  }

  const batchMetaById = new Map<number, MarketplaceIntakeBatchMetaRow>();
  for (const row of data || []) {
    const id = Number((row as any).id || 0);
    if (!Number.isFinite(id) || id <= 0) continue;
    batchMetaById.set(id, {
      id,
      filename: String((row as any).filename || ''),
      confirmedAt: (row as any).confirmed_at || null,
      uploadedByEmail: (row as any).uploaded_by_email || null,
      appLastPromoteStatus: (row as any).app_last_promote_status || null,
      appLastPromoteAt: (row as any).app_last_promote_at || null,
      appLastPromoteOrderCount: Number((row as any).app_last_promote_order_count || 0),
      appLastPromoteInsertedCount: Number((row as any).app_last_promote_inserted_count || 0),
      appLastPromoteUpdatedCount: Number((row as any).app_last_promote_updated_count || 0),
      appLastPromoteUpdatedWebhookCount: Number((row as any).app_last_promote_updated_webhook_count || 0),
      appLastPromoteUpdatedAuthoritativeCount: Number((row as any).app_last_promote_updated_authoritative_count || 0),
      appLastPromoteMatchedExternalIdCount: Number((row as any).app_last_promote_matched_external_id_count || 0),
      appLastPromoteMatchedTrackingCount: Number((row as any).app_last_promote_matched_tracking_count || 0),
      appLastPromoteSkippedCount: Number((row as any).app_last_promote_skipped_count || 0),
      appLastPromoteError: (row as any).app_last_promote_error || null,
      scalevLastSendStatus: (row as any).scalev_last_send_status || null,
      scalevLastSendAt: (row as any).scalev_last_send_at || null,
      scalevLastSendRowCount: Number((row as any).scalev_last_send_row_count || 0),
      scalevLastSendError: (row as any).scalev_last_send_error || null,
      scalevLastReconcileStatus: (row as any).scalev_last_reconcile_status || null,
      scalevLastReconcileAt: (row as any).scalev_last_reconcile_at || null,
      scalevLastReconcileTargetCount: Number((row as any).scalev_last_reconcile_target_count || 0),
      scalevLastReconcileMatchedCount: Number((row as any).scalev_last_reconcile_matched_count || 0),
      scalevLastReconcileUpdatedCount: Number((row as any).scalev_last_reconcile_updated_count || 0),
      scalevLastReconcileAlreadyLinkedCount: Number((row as any).scalev_last_reconcile_already_linked_count || 0),
      scalevLastReconcileUnmatchedCount: Number((row as any).scalev_last_reconcile_unmatched_count || 0),
      scalevLastReconcileConflictCount: Number((row as any).scalev_last_reconcile_conflict_count || 0),
      scalevLastReconcileErrorCount: Number((row as any).scalev_last_reconcile_error_count || 0),
      scalevLastReconcileError: (row as any).scalev_last_reconcile_error || null,
    });
  }

  return batchMetaById;
}

function mapWorkspaceLineRow(row: any): MarketplaceIntakeWorkspaceLineRow {
  return {
    lineIndex: Number(row.line_index || 0),
    rawPlatformSkuId: row.raw_platform_sku_id || null,
    rawSellerSku: row.raw_seller_sku || null,
    mpSku: row.mp_sku || null,
    normalizedSku: row.normalized_sku || null,
    skuNormalizationSource: row.sku_normalization_source || null,
    skuNormalizationReason: row.sku_normalization_reason || null,
    mpProductName: String(row.mp_product_name || ''),
    mpVariation: row.mp_variation || null,
    quantity: Number(row.quantity || 0),
    lineSubtotal: Number(row.line_subtotal || 0),
    detectedCustomId: row.detected_custom_id || null,
    matchedEntityLabel: row.matched_entity_label || null,
    mappedStoreName: row.mapped_store_name || null,
    lineStatus: String(row.line_status || ''),
    issueCodes: Array.isArray(row.issue_codes) ? row.issue_codes : [],
  };
}

async function loadWorkspaceLinesByOrderIds(orderIds: number[]): Promise<Map<number, MarketplaceIntakeWorkspaceLineRow[]>> {
  const linesByOrderId = new Map<number, MarketplaceIntakeWorkspaceLineRow[]>();
  if (orderIds.length === 0) return linesByOrderId;

  const svc = createServiceSupabase();
  let linesRes: any = await svc
    .from('marketplace_intake_order_lines')
    .select(`
      intake_order_id,
      line_index,
      raw_platform_sku_id,
      raw_seller_sku,
      mp_sku,
      normalized_sku,
      sku_normalization_source,
      sku_normalization_reason,
      mp_product_name,
      mp_variation,
      quantity,
      line_subtotal,
      detected_custom_id,
      matched_entity_label,
      mapped_store_name,
      line_status,
      issue_codes
    `)
    .in('intake_order_id', orderIds)
    .order('intake_order_id', { ascending: true })
    .order('line_index', { ascending: true });

  if (linesRes.error && isMissingTableError(linesRes.error)) {
    linesRes = await svc
      .from('marketplace_intake_order_lines')
      .select(`
        intake_order_id,
        line_index,
        mp_sku,
        mp_product_name,
        mp_variation,
        quantity,
        line_subtotal,
        detected_custom_id,
        matched_entity_label,
        mapped_store_name,
        line_status,
        issue_codes
      `)
      .in('intake_order_id', orderIds)
      .order('intake_order_id', { ascending: true })
      .order('line_index', { ascending: true });
  }

  if (linesRes.error) {
    if (isMissingTableError(linesRes.error)) throw new Error(getMissingSchemaMessage());
    throw linesRes.error;
  }

  for (const row of linesRes.data || []) {
    const orderId = Number((row as any).intake_order_id || 0);
    if (!linesByOrderId.has(orderId)) linesByOrderId.set(orderId, []);
    linesByOrderId.get(orderId)!.push(mapWorkspaceLineRow(row));
  }

  return linesByOrderId;
}

function mapWorkspaceOrderRow(
  row: any,
  batchMetaById: Map<number, MarketplaceIntakeBatchMetaRow>,
  linesByOrderId: Map<number, MarketplaceIntakeWorkspaceLineRow[]>,
): MarketplaceIntakeWorkspaceOrderRow | null {
  const id = Number(row.id || 0);
  const batchId = Number(row.batch_id || 0);
  const batchMeta = batchMetaById.get(batchId);
  if (!Number.isFinite(id) || id <= 0 || !batchMeta) return null;

  return {
    id,
    batchId,
    batchFilename: batchMeta.filename,
    uploadedAt: batchMeta.confirmedAt,
    uploadedByEmail: batchMeta.uploadedByEmail,
    batchAppLastPromoteStatus: batchMeta.appLastPromoteStatus,
    batchAppLastPromoteAt: batchMeta.appLastPromoteAt,
    batchAppLastPromoteOrderCount: batchMeta.appLastPromoteOrderCount,
    batchAppLastPromoteInsertedCount: batchMeta.appLastPromoteInsertedCount,
    batchAppLastPromoteUpdatedCount: batchMeta.appLastPromoteUpdatedCount,
    batchAppLastPromoteUpdatedWebhookCount: batchMeta.appLastPromoteUpdatedWebhookCount,
    batchAppLastPromoteUpdatedAuthoritativeCount: batchMeta.appLastPromoteUpdatedAuthoritativeCount,
    batchAppLastPromoteMatchedExternalIdCount: batchMeta.appLastPromoteMatchedExternalIdCount,
    batchAppLastPromoteMatchedTrackingCount: batchMeta.appLastPromoteMatchedTrackingCount,
    batchAppLastPromoteSkippedCount: batchMeta.appLastPromoteSkippedCount,
    batchAppLastPromoteError: batchMeta.appLastPromoteError,
    batchScalevLastSendStatus: batchMeta.scalevLastSendStatus,
    batchScalevLastSendAt: batchMeta.scalevLastSendAt,
    batchScalevLastSendRowCount: batchMeta.scalevLastSendRowCount,
    batchScalevLastSendError: batchMeta.scalevLastSendError,
    batchScalevLastReconcileStatus: batchMeta.scalevLastReconcileStatus,
    batchScalevLastReconcileAt: batchMeta.scalevLastReconcileAt,
    batchScalevLastReconcileTargetCount: batchMeta.scalevLastReconcileTargetCount,
    batchScalevLastReconcileMatchedCount: batchMeta.scalevLastReconcileMatchedCount,
    batchScalevLastReconcileUpdatedCount: batchMeta.scalevLastReconcileUpdatedCount,
    batchScalevLastReconcileAlreadyLinkedCount: batchMeta.scalevLastReconcileAlreadyLinkedCount,
    batchScalevLastReconcileUnmatchedCount: batchMeta.scalevLastReconcileUnmatchedCount,
    batchScalevLastReconcileConflictCount: batchMeta.scalevLastReconcileConflictCount,
    batchScalevLastReconcileErrorCount: batchMeta.scalevLastReconcileErrorCount,
    batchScalevLastReconcileError: batchMeta.scalevLastReconcileError,
    externalOrderId: String(row.external_order_id || ''),
    customerLabel: row.customer_label || null,
    recipientName: row.recipient_name || null,
    finalStoreName: row.final_store_name || null,
    lineCount: Number(row.line_count || 0),
    orderAmount: Number(row.order_amount || 0),
    orderStatus: String(row.order_status || ''),
    trackingNumber: row.tracking_number || null,
    issueCodes: Array.isArray(row.issue_codes) ? row.issue_codes : [],
    shipmentDate: row.shipment_date || null,
    warehouseStatus: String(row.warehouse_status || 'staged') as MarketplaceIntakeWarehouseStatus,
    warehouseNote: row.warehouse_note || null,
    warehouseUpdatedAt: row.warehouse_updated_at || null,
    warehouseUpdatedByEmail: row.warehouse_updated_by_email || null,
    lines: linesByOrderId.get(id) || [],
  };
}

async function loadWorkspaceOrders(input: {
  batchIds: number[];
  stagedOnly?: boolean;
  shipmentDate?: string;
  batchMetaById: Map<number, MarketplaceIntakeBatchMetaRow>;
}): Promise<MarketplaceIntakeWorkspaceOrderRow[]> {
  if (input.batchIds.length === 0) return [];

  const svc = createServiceSupabase();
  let query = svc
    .from('marketplace_intake_orders')
    .select(`
      id,
      batch_id,
      external_order_id,
      customer_label,
      recipient_name,
      final_store_name,
      line_count,
      order_amount,
      order_status,
      tracking_number,
      issue_codes,
      shipment_date,
      warehouse_status,
      warehouse_note,
      warehouse_updated_at,
      warehouse_updated_by_email
    `)
    .in('batch_id', input.batchIds);

  if (input.stagedOnly) {
    query = query
      .is('shipment_date', null)
      .eq('warehouse_status', 'staged')
      .order('created_at', { ascending: false })
      .order('external_order_id', { ascending: true });
  } else if (input.shipmentDate) {
    query = query
      .eq('shipment_date', input.shipmentDate)
      .order('warehouse_status', { ascending: true })
      .order('updated_at', { ascending: false })
      .order('external_order_id', { ascending: true });
  }

  const ordersRes = await query;
  if (ordersRes.error) {
    if (isMissingTableError(ordersRes.error)) throw new Error(getMissingSchemaMessage());
    throw ordersRes.error;
  }

  const orderIds = (ordersRes.data || [])
    .map((row: any) => Number(row.id || 0))
    .filter((id) => Number.isFinite(id) && id > 0);
  const linesByOrderId = await loadWorkspaceLinesByOrderIds(orderIds);

  return (ordersRes.data || [])
    .map((row: any) => mapWorkspaceOrderRow(row, input.batchMetaById, linesByOrderId))
    .filter((row): row is MarketplaceIntakeWorkspaceOrderRow => Boolean(row));
}

export async function listMarketplaceIntakeWorkspace(input: {
  shipmentDate: string;
  sourceKey?: string | null;
}): Promise<MarketplaceIntakeWorkspaceResponse> {
  const shipmentDate = normalizeShipmentDate(input.shipmentDate);
  const normalizedSourceKey = cleanText(input.sourceKey);
  const sourceConfigs = !normalizedSourceKey || normalizedSourceKey === 'all'
    ? listMarketplaceIntakeUploadSourceConfigs()
    : [await resolveMarketplaceIntakeSourceConfig(normalizedSourceKey)];
  const batchMetaById = await loadWorkspaceBatchMeta(sourceConfigs);
  const batchIds = Array.from(batchMetaById.keys());

  const [stagedOrders, shipmentOrders] = await Promise.all([
    loadWorkspaceOrders({
      batchIds,
      stagedOnly: true,
      batchMetaById,
    }),
    loadWorkspaceOrders({
      batchIds,
      shipmentDate,
      batchMetaById,
    }),
  ]);

  return {
    shipmentDate,
    summary: {
      stagedCount: stagedOrders.length,
      scheduledCount: shipmentOrders.filter((order) => order.warehouseStatus === 'scheduled').length,
      holdCount: shipmentOrders.filter((order) => order.warehouseStatus === 'hold').length,
      canceledCount: shipmentOrders.filter((order) => order.warehouseStatus === 'canceled').length,
    },
    stagedOrders,
    shipmentOrders,
  };
}

export async function updateMarketplaceIntakeWorkspace(input: MarketplaceIntakeWorkspaceUpdateInput) {
  const orderIds = Array.from(new Set(
    (input.orderIds || [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0),
  ));
  if (orderIds.length === 0) {
    throw new Error('Pilih minimal satu order untuk diubah.');
  }

  if (!['staged', 'scheduled', 'hold', 'canceled'].includes(String(input.warehouseStatus || ''))) {
    throw new Error('Status warehouse tidak valid.');
  }

  const shipmentDate = input.warehouseStatus === 'staged'
    ? null
    : normalizeShipmentDate(String(input.shipmentDate || ''));

  const normalizedSourceKey = cleanText(input.sourceKey);
  const sourceConfigs = !normalizedSourceKey || normalizedSourceKey === 'all'
    ? listMarketplaceIntakeUploadSourceConfigs()
    : [await resolveMarketplaceIntakeSourceConfig(normalizedSourceKey)];
  const batchMetaById = await loadWorkspaceBatchMeta(sourceConfigs);
  const allowedBatchIds = new Set<number>(batchMetaById.keys());
  const svc = createServiceSupabase();
  const existingRes = await svc
    .from('marketplace_intake_orders')
    .select('id, batch_id')
    .in('id', orderIds);

  if (existingRes.error) {
    if (isMissingTableError(existingRes.error)) throw new Error(getMissingSchemaMessage());
    throw existingRes.error;
  }

  const rows = existingRes.data || [];
  if (rows.length !== orderIds.length) {
    throw new Error('Sebagian order workspace tidak ditemukan.');
  }

  for (const row of rows) {
    const batchId = Number((row as any).batch_id || 0);
    if (!allowedBatchIds.has(batchId)) {
      throw new Error('Ada order yang tidak termasuk workspace marketplace yang sedang aktif.');
    }
  }

  const updateRes = await svc
    .from('marketplace_intake_orders')
    .update({
      shipment_date: shipmentDate,
      warehouse_status: input.warehouseStatus,
      warehouse_note: cleanText(input.warehouseNote),
      warehouse_updated_at: new Date().toISOString(),
      warehouse_updated_by_email: input.updatedByEmail,
    })
    .in('id', orderIds);

  if (updateRes.error) {
    if (isMissingTableError(updateRes.error)) throw new Error(getMissingSchemaMessage());
    throw updateRes.error;
  }

  return {
    updatedCount: orderIds.length,
    shipmentDate,
    warehouseStatus: input.warehouseStatus,
  };
}
