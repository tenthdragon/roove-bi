import { guessStoreType, type StoreType } from './scalev-api';

export type ScalevSourceClass = 'marketplace' | 'non_marketplace';

export type ScalevSourceClassReason =
  | 'financial_entity'
  | 'platform'
  | 'external_id'
  | 'courier'
  | 'store_type'
  | 'store_guess'
  | 'marketplace_api_upload'
  | 'fallback_non_marketplace';

export type ScalevSourceClassInput = {
  source?: string | null;
  platform?: string | null;
  externalId?: string | null;
  financialEntity?: unknown;
  rawData?: any;
  courierService?: unknown;
  courier?: unknown;
  storeName?: string | null;
  storeType?: StoreType | string | null;
};

export type ScalevSourceClassResult = {
  sourceClass: ScalevSourceClass;
  sourceClassReason: ScalevSourceClassReason;
};

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeToken(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeMarketplacePlatform(value: unknown): string | null {
  const token = normalizeToken(value);
  if (!token) return null;
  if (token === 'marketplace') return 'marketplace';
  if (token === 'shopee') return 'shopee';
  if (token === 'tiktokshop' || token === 'tiktok') return 'tiktokshop';
  if (token === 'lazada') return 'lazada';
  if (token === 'tokopedia') return 'tokopedia';
  if (token === 'blibli') return 'blibli';
  return null;
}

function normalizeStoreType(value: unknown): StoreType | null {
  const token = normalizeToken(value);
  if (token === 'marketplace') return 'marketplace';
  if (token === 'scalev') return 'scalev';
  if (token === 'reseller') return 'reseller';
  return null;
}

function resolveFinancialEntityCode(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    return normalizeMarketplacePlatform(value);
  }
  if (typeof value === 'object') {
    const candidate = (value as any)?.code ?? (value as any)?.name ?? null;
    return normalizeMarketplacePlatform(candidate);
  }
  return null;
}

function deriveMarketplaceFromExternalId(externalId: string | null | undefined): string | null {
  const eid = cleanText(externalId);
  if (!/^\d+$/.test(eid)) return null;
  if (eid.length >= 17) return 'tiktokshop';
  if (eid.length >= 15) return 'lazada';
  if (eid.length >= 10) return 'shopee';
  return null;
}

function deriveMarketplaceFromCourier(input: {
  courierService?: unknown;
  courier?: unknown;
  rawData?: any;
}): string | null {
  const courierCandidates = [
    (input.courierService as any)?.courier?.code,
    (input.courierService as any)?.courier?.name,
    (input.courierService as any)?.code,
    (input.courierService as any)?.name,
    input.courier,
    input.rawData?.courier_service?.courier?.code,
    input.rawData?.courier_service?.courier?.name,
    input.rawData?.courier_service?.code,
    input.rawData?.courier_service?.name,
    input.rawData?.courier,
  ];

  for (const candidate of courierCandidates) {
    const token = normalizeToken(candidate);
    if (!token) continue;
    if (token.includes('shopee')) return 'shopee';
    if (token.includes('tiktok')) return 'tiktokshop';
    if (token.includes('lazada')) return 'lazada';
    if (token.includes('tokopedia')) return 'tokopedia';
    if (token.includes('blibli')) return 'blibli';
  }

  return null;
}

export function deriveScalevSourceClass(input: ScalevSourceClassInput): ScalevSourceClassResult {
  const source = cleanText(input.source).toLowerCase();
  if (source === 'marketplace_api_upload') {
    return {
      sourceClass: 'marketplace',
      sourceClassReason: 'marketplace_api_upload',
    };
  }

  const rawData = input.rawData || {};

  const financialEntity = resolveFinancialEntityCode(
    input.financialEntity
    ?? rawData?.financial_entity
    ?? rawData?.raw_data?.financial_entity
    ?? null,
  );
  if (financialEntity) {
    return {
      sourceClass: 'marketplace',
      sourceClassReason: 'financial_entity',
    };
  }

  const platform = normalizeMarketplacePlatform(
    input.platform
    ?? rawData?.platform
    ?? null,
  );
  if (platform && platform !== 'marketplace') {
    return {
      sourceClass: 'marketplace',
      sourceClassReason: 'platform',
    };
  }

  const externalId = cleanText(
    input.externalId
    ?? rawData?.external_id
    ?? null,
  );
  if (deriveMarketplaceFromExternalId(externalId)) {
    return {
      sourceClass: 'marketplace',
      sourceClassReason: 'external_id',
    };
  }

  if (deriveMarketplaceFromCourier({
    courierService: input.courierService,
    courier: input.courier,
    rawData,
  })) {
    return {
      sourceClass: 'marketplace',
      sourceClassReason: 'courier',
    };
  }

  const explicitStoreType = normalizeStoreType(input.storeType);
  if (explicitStoreType === 'marketplace') {
    return {
      sourceClass: 'marketplace',
      sourceClassReason: 'store_type',
    };
  }

  const storeName = cleanText(
    input.storeName
    ?? rawData?.store_name
    ?? rawData?.store?.name
    ?? null,
  );
  if (storeName && guessStoreType(storeName) === 'marketplace') {
    return {
      sourceClass: 'marketplace',
      sourceClassReason: 'store_guess',
    };
  }

  return {
    sourceClass: 'non_marketplace',
    sourceClassReason: 'fallback_non_marketplace',
  };
}

export function buildScalevSourceClassFields(input: ScalevSourceClassInput) {
  const derived = deriveScalevSourceClass(input);
  return {
    source_class: derived.sourceClass,
    source_class_reason: derived.sourceClassReason,
  };
}
