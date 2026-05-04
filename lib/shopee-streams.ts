export type ShopeeSpendStreamKey = 'shopee_ads' | 'shopee_live';
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
  stream_key: ShopeeSpendStreamKey;
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
    description: 'Spend iklan CPC Shopee yang saat ini sudah kita sink lewat Open Platform Ads API.',
  },
  shopee_live: {
    key: 'shopee_live',
    label: 'Shopee Live',
    defaultSource: 'Shopee Live',
    defaultSyncMode: 'manual',
    defaultEnabled: false,
    apiSupported: false,
    description: 'Spend Shopee Live untuk saat ini masih diperlakukan sebagai feed manual sampai jalur API yang tepat siap dipakai.',
  },
};

export function listShopeeSpendStreamDefinitions(): ShopeeSpendStreamDefinition[] {
  return Object.values(SHOPEE_SPEND_STREAMS);
}

export function getShopeeSpendStreamDefinition(key: string | null | undefined): ShopeeSpendStreamDefinition {
  const normalizedKey = String(key || '').trim().toLowerCase() as ShopeeSpendStreamKey;
  return SHOPEE_SPEND_STREAMS[normalizedKey] || SHOPEE_SPEND_STREAMS.shopee_ads;
}

export function getShopeeApiDataSourceForStream(key: ShopeeSpendStreamKey) {
  return key === 'shopee_live' ? 'shopee_live_api' : 'shopee_ads_api';
}

export function buildDefaultShopeeSpendStreams(shopName: string, legacyAdsSource?: string | null, legacyAdvertiser?: string | null) {
  return listShopeeSpendStreamDefinitions().map((definition) => ({
    stream_key: definition.key,
    default_source:
      definition.key === 'shopee_ads'
        ? String(legacyAdsSource || '').trim() || definition.defaultSource
        : definition.defaultSource,
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
    default_source: String(stream.default_source || '').trim() || definition.defaultSource,
    default_advertiser: String(stream.default_advertiser || '').trim() || 'Shopee Shop',
    sync_mode: syncMode,
    is_enabled: Boolean(stream.is_enabled),
  };
}
