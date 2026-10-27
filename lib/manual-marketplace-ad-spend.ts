export type ManualMarketplacePlatform = 'shopee_ads' | 'tiktok_ads';

export const MANUAL_MARKETPLACE_PLATFORMS: ManualMarketplacePlatform[] = [
  'shopee_ads',
  'tiktok_ads',
];

export const MANUAL_MARKETPLACE_LABELS: Record<ManualMarketplacePlatform, string> = {
  shopee_ads: 'Shopee Ads',
  tiktok_ads: 'TikTok Ads',
};

export function isManualMarketplacePlatform(value: unknown): value is ManualMarketplacePlatform {
  return value === 'shopee_ads' || value === 'tiktok_ads';
}

/** A manual row owns only its exact workspace-local platform, brand, and day. */
export function selectActiveSheetFallbackRows<
  T extends { platform: ManualMarketplacePlatform; brand_id: number; date: string },
>(
  manual: Array<{ platform: ManualMarketplacePlatform; brand_id: number; spend_date: string }>,
  sheet: T[],
): T[] {
  const manualKeys = new Set(manual.map((row) =>
    `${row.platform}|${row.brand_id}|${row.spend_date}`));
  return sheet.filter((row) => !manualKeys.has(`${row.platform}|${row.brand_id}|${row.date}`));
}

/** The legacy streams replaced by manual BI costs, excluding Meta CPAS and Shopee Live. */
export function isLegacyMarketplaceSpendAfterCutover(
  row: { date: string; source?: string | null; data_source?: string | null; import_id?: number | null },
  startsOn: string | null,
): boolean {
  if (!startsOn || row.date < startsOn) return false;
  if (!['google_sheets', 'xlsx_upload', 'shopee_ads_api'].includes(row.data_source || '')
    && !(row.data_source == null && row.import_id != null)) return false;
  const source = String(row.source || '').toLowerCase();
  if (source.includes('tiktok')) return true;
  return source.includes('shopee')
    && !source.includes('live')
    && !source.includes('cpas')
    && !source.includes('facebook');
}
