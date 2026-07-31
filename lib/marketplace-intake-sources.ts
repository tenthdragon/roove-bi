export type MarketplaceIntakeSourceKey = string;
export type MarketplaceIntakePlatform = 'shopee' | 'tiktok' | 'blibli' | 'lazada';
export type MarketplaceIntakeParserFamily = MarketplaceIntakePlatform | 'none';

export type MarketplaceIntakeSourceConfig = {
  id: number | null;
  sourceKey: MarketplaceIntakeSourceKey;
  sourceLabel: string;
  platform: MarketplaceIntakePlatform;
  parserFamily: MarketplaceIntakeParserFamily;
  uploadEnabled: boolean;
  businessCode: string;
  allowedStores: string[];
  uploadTitle: string;
  uploadDescription: string;
  dragDropTitle: string;
  readingLabel: string;
  previewLabel: string;
  searchPlaceholder: string;
  pageDescription: string;
};

export const MARKETPLACE_INTAKE_PLATFORMS: MarketplaceIntakePlatform[] = [
  'shopee',
  'tiktok',
  'blibli',
  'lazada',
];

const PLATFORM_LABELS: Record<MarketplaceIntakePlatform, string> = {
  shopee: 'Shopee',
  tiktok: 'TikTok',
  blibli: 'Blibli',
  lazada: 'Lazada',
};

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

export function isMarketplaceIntakePlatform(value: unknown): value is MarketplaceIntakePlatform {
  return MARKETPLACE_INTAKE_PLATFORMS.includes(cleanText(value).toLowerCase() as MarketplaceIntakePlatform);
}

export function buildMarketplaceIntakeSourceKey(
  platform: MarketplaceIntakePlatform,
  businessCode: string,
): MarketplaceIntakeSourceKey {
  const normalizedBusinessCode = cleanText(businessCode)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!normalizedBusinessCode) throw new Error('Business code source marketplace tidak valid.');
  return `${platform}_${normalizedBusinessCode}`;
}

export function buildMarketplaceIntakeSourceConfig(input: {
  id?: number | null;
  platform: MarketplaceIntakePlatform;
  businessCode: string;
  sourceKey?: string | null;
  sourceLabel?: string | null;
  uploadEnabled?: boolean;
  allowedStores?: string[];
}): MarketplaceIntakeSourceConfig {
  const businessCode = cleanText(input.businessCode).toUpperCase();
  if (!businessCode) throw new Error('Business code source marketplace wajib diisi.');
  const platformLabel = PLATFORM_LABELS[input.platform];
  const sourceLabel = cleanText(input.sourceLabel) || `${platformLabel} ${businessCode}`;
  const sourceKey = cleanText(input.sourceKey)
    || buildMarketplaceIntakeSourceKey(input.platform, businessCode);

  return {
    id: input.id ?? null,
    sourceKey,
    sourceLabel,
    platform: input.platform,
    parserFamily: input.platform,
    uploadEnabled: input.uploadEnabled !== false,
    businessCode,
    allowedStores: Array.from(new Set((input.allowedStores || []).map(cleanText).filter(Boolean))),
    uploadTitle: `Upload ${sourceLabel}`,
    uploadDescription: `Baca export ${platformLabel} untuk business ${businessCode}, cocokkan SKU ke katalog ScaleV workspace aktif, lalu review store sebelum disimpan.`,
    dragDropTitle: `Drag & drop file ${sourceLabel} di sini`,
    readingLabel: `Membaca file ${sourceLabel}…`,
    previewLabel: `Preview Mapping ${sourceLabel}`,
    searchPlaceholder: `Cari bundle ${businessCode}…`,
    pageDescription: `Upload order ${platformLabel} untuk business ${businessCode}. Semua mapping, store, order, dan hasil warehouse tetap berada di workspace aktif.`,
  };
}
