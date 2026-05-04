export type ShopeeSpendStreamKey = 'shopee_ads';
export type ShopeeSpendSyncMode = 'api' | 'manual';

export type ShopeeSpendStreamDefinition = {
  key: ShopeeSpendStreamKey;
  label: string;
  defaultSource: string;
  defaultSyncMode: ShopeeSpendSyncMode;
  defaultEnabled: boolean;
  apiSupported: boolean;
  description: string;
};

export type ShopeeSpendStreamRowLike = {
  stream_key: string | null;
  default_source: string | null;
  default_advertiser: string | null;
  sync_mode: ShopeeSpendSyncMode | null;
  is_enabled: boolean | null;
};

const SHOPEE_SPEND_STREAMS: Record<ShopeeSpendStreamKey, ShopeeSpendStreamDefinition> = {
  shopee_ads: {
    key: 'shopee_ads',
    label: 'Shopee Ads',
    defaultSource: 'Shopee Ads',
    defaultSyncMode: 'api',
    defaultEnabled: true,
    apiSupported: true,
    description: 'Spend iklan CPC Shopee yang saat ini kita sink lewat Open Platform Ads API.',
  },
};

export function listShopeeSpendStreamDefinitions(): ShopeeSpendStreamDefinition[] {
  return Object.values(SHOPEE_SPEND_STREAMS);
}

export function isShopeeSpendStreamKey(key: string | null | undefined): key is ShopeeSpendStreamKey {
  return String(key || '').trim().toLowerCase() === 'shopee_ads';
}

export function getShopeeSpendStreamDefinition(key: string | null | undefined): ShopeeSpendStreamDefinition {
  return SHOPEE_SPEND_STREAMS.shopee_ads;
}

export function getShopeeApiDataSourceForStream(key: ShopeeSpendStreamKey) {
  return 'shopee_ads_api';
}

export function buildDefaultShopeeSpendStreams(shopName: string, _legacyAdsSource?: string | null, legacyAdvertiser?: string | null) {
  return listShopeeSpendStreamDefinitions().map((definition) => ({
    stream_key: definition.key,
    default_source: definition.defaultSource,
    default_advertiser: String(legacyAdvertiser || '').trim() || shopName || 'Shopee Shop',
    sync_mode: definition.defaultSyncMode,
    is_enabled: definition.defaultEnabled,
  }));
}

export function normalizeShopeeSpendStreamConfig(
  stream: Partial<ShopeeSpendStreamRowLike> & { stream_key: string | null | undefined },
) {
  const definition = getShopeeSpendStreamDefinition(stream.stream_key);
  const desiredMode = stream.sync_mode === 'api' || stream.sync_mode === 'manual'
    ? stream.sync_mode
    : definition.defaultSyncMode;
  const syncMode: ShopeeSpendSyncMode =
    definition.apiSupported
      ? desiredMode
      : 'manual';

  return {
    stream_key: definition.key,
    default_source: definition.defaultSource,
    default_advertiser: String(stream.default_advertiser || '').trim() || 'Shopee Shop',
    sync_mode: syncMode,
    is_enabled: Boolean(stream.is_enabled),
  };
}
