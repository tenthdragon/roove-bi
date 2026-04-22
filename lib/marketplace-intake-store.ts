import { createServiceSupabase } from './service-supabase';
import { fetchStoreList } from './scalev-api';

const SCALEV_BASE_URL = 'https://api.scalev.id/v2';
const STORE_LINK_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const SCALEV_MAX_RETRIES = 4;
const SCALEV_RETRY_BASE_MS = 1500;

export const SHOPEE_RLT_ALLOWED_STORE_NAMES = [
  'Roove Main Store - Marketplace',
  'Globite Store - Marketplace',
  'Pluve Main Store - Marketplace',
  'Purvu Store - Marketplace',
  'Purvu The Secret Store - Markerplace',
  'YUV Deodorant Serum Store - Marketplace',
  'Osgard Oil Store',
  'drHyun Main Store - Marketplace',
  'Calmara Main Store - Marketplace',
];

type IntakeBusiness = {
  id: number;
  business_code: string;
  api_key: string | null;
};

type StoreChannelRow = {
  store_name: string;
  store_type: string | null;
  is_active: boolean | null;
};

type LiveStore = {
  id: number;
  name: string;
  unique_id: string;
  uuid: string;
};

type CandidateStore = {
  storeName: string;
  scalevStoreId: number;
  storeUniqueId: string | null;
};

type BundleStoreLinkRow = {
  business_id: number;
  scalev_bundle_id: number;
  store_name: string;
  scalev_store_id: number | null;
  store_unique_id: string | null;
  is_available: boolean;
  last_checked_at: string | null;
};

export type ExactBundleStoreResolution = {
  storeName: string | null;
  classifierLabel: string | null;
  scalevStoreId: number | null;
  storeUniqueId: string | null;
  storeCandidates: string[];
  resolution: 'exact_live' | 'exact_cache' | 'exact_cache_stale' | 'ambiguous' | 'missing';
};

export type GuessedStoreResolution = {
  storeName: string | null;
  classifierLabel: string | null;
  storeCandidates: string[];
  resolution: 'guessed' | 'ambiguous' | 'missing';
};

export type ShopeeRltStoreResolverContext = {
  bundleResolutionCache: Map<number, Promise<ExactBundleStoreResolution>>;
  candidateStoresPromise: Promise<CandidateStore[]> | null;
};

function normalizeLoose(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeReadable(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SHOPEE_RLT_STORE_ALIASES: Array<{ storeName: string; aliases: string[] }> = [
  {
    storeName: 'Purvu The Secret Store - Markerplace',
    aliases: ['purvu the secret', 'the secret'],
  },
  {
    storeName: 'Roove Main Store - Marketplace',
    aliases: ['roove'],
  },
  {
    storeName: 'Globite Store - Marketplace',
    aliases: ['globite'],
  },
  {
    storeName: 'Pluve Main Store - Marketplace',
    aliases: ['pluve'],
  },
  {
    storeName: 'Purvu Store - Marketplace',
    aliases: ['purvu'],
  },
  {
    storeName: 'YUV Deodorant Serum Store - Marketplace',
    aliases: ['yuv deodorant serum', 'yuv'],
  },
  {
    storeName: 'Osgard Oil Store',
    aliases: ['osgard oil', 'osgard'],
  },
  {
    storeName: 'drHyun Main Store - Marketplace',
    aliases: ['drhyun'],
  },
  {
    storeName: 'Calmara Main Store - Marketplace',
    aliases: ['calmara'],
  },
];

export function guessShopeeRltStoreFromTexts(
  texts: Array<string | null | undefined>,
  allowedStoreNames: string[] = SHOPEE_RLT_ALLOWED_STORE_NAMES,
): GuessedStoreResolution {
  const allowed = new Set(allowedStoreNames);
  const haystack = normalizeReadable(texts.filter(Boolean).join(' '));
  if (!haystack) {
    return {
      storeName: null,
      classifierLabel: null,
      storeCandidates: [],
      resolution: 'missing',
    };
  }

  const matches = SHOPEE_RLT_STORE_ALIASES
    .filter((entry) => allowed.has(entry.storeName))
    .map((entry) => ({
      storeName: entry.storeName,
      matchedScore: Math.max(
        ...entry.aliases
          .map((alias) => normalizeReadable(alias))
          .filter(Boolean)
          .filter((alias) => haystack.includes(alias))
          .map((alias) => {
            const index = haystack.indexOf(alias);
            let score = (alias.length * 100) - Math.max(index, 0);
            if (index === 0) score += 10000;
            if (haystack.startsWith(`${alias} `)) score += 3000;
            if (index > 0 && haystack.slice(Math.max(0, index - 3), index) === 'by ') {
              score -= 2500;
            }
            return score;
          }),
        0,
      ),
    }))
    .filter((entry) => entry.matchedScore > 0);

  if (matches.length === 0) {
    return {
      storeName: null,
      classifierLabel: null,
      storeCandidates: [],
      resolution: 'missing',
    };
  }

  const strongestAliasLength = Math.max(...matches.map((entry) => entry.matchedScore));
  const strongestMatches = matches
    .filter((entry) => entry.matchedScore === strongestAliasLength)
    .map((entry) => entry.storeName)
    .sort((left, right) => left.localeCompare(right));

  if (strongestMatches.length === 1) {
    return {
      storeName: strongestMatches[0],
      classifierLabel: 'Guessed from bundle/product label',
      storeCandidates: strongestMatches,
      resolution: 'guessed',
    };
  }

  return {
    storeName: null,
    classifierLabel: 'Nama produk cocok ke lebih dari satu store',
    storeCandidates: strongestMatches,
    resolution: 'ambiguous',
  };
}

function isMissingTableError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST205'
    || code === '42P01'
    || /does not exist/i.test(message)
    || /schema cache/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitedError(error: any): boolean {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = Number(error?.code || 0);
  const message = String(error?.message || '');
  return status === 429 || code === 429 || /429/.test(message) || /too many requests/i.test(message);
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;

  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const targetMs = Date.parse(headerValue);
  if (!Number.isFinite(targetMs)) return null;

  return Math.max(0, targetMs - Date.now());
}

function getScalevRetryDelayMs(response: Response, attempt: number): number {
  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
  if (retryAfterMs != null && retryAfterMs > 0) {
    return retryAfterMs;
  }

  return SCALEV_RETRY_BASE_MS * Math.max(1, attempt + 1);
}

async function fetchScalevStoreBundleAvailability(
  apiKey: string,
  scalevStoreId: number,
  bundleId: number,
): Promise<boolean> {
  for (let attempt = 0; attempt <= SCALEV_MAX_RETRIES; attempt += 1) {
    const response = await fetch(`${SCALEV_BASE_URL}/stores/${scalevStoreId}/bundles/${bundleId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (response.ok && (!json || json.code == null || Number(json.code) < 400)) {
      return true;
    }

    const errorText = String(
      json?.status
      || json?.message
      || (typeof json?.error === 'string' ? json.error : '')
      || text
      || `HTTP ${response.status}`,
    ).toLowerCase();

    if (
      response.status === 404
      || Number(json?.code || 0) === 404
      || errorText.includes('not found')
      || errorText.includes('tidak ditemukan')
    ) {
      return false;
    }

    const error = new Error(`Scalev store bundle lookup gagal (${response.status}): ${text || errorText}`) as Error & { status?: number };
    error.status = response.status;

    const shouldRetry = response.status === 429 || response.status >= 500;
    if (shouldRetry && attempt < SCALEV_MAX_RETRIES) {
      await sleep(getScalevRetryDelayMs(response, attempt));
      continue;
    }

    throw error;
  }

  throw new Error('Scalev store bundle lookup gagal setelah retry.');
}

async function loadCandidateStores(
  business: IntakeBusiness,
  allowedStoreNames: string[],
): Promise<CandidateStore[]> {
  if (!business.api_key) {
    throw new Error(`Business ${business.business_code} belum punya API key.`);
  }

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_store_channels')
    .select('store_name, store_type, is_active')
    .eq('business_id', business.id)
    .eq('is_active', true)
    .in('store_name', allowedStoreNames);

  if (error) {
    if (isMissingTableError(error)) {
      throw new Error('Tabel store channel Scalev belum siap. Jalankan migration store channel terbaru terlebih dahulu.');
    }
    throw error;
  }

  const allowedMap = new Map<string, StoreChannelRow>();
  for (const row of (data || []) as StoreChannelRow[]) {
    if (row.store_type && String(row.store_type).toLowerCase() !== 'marketplace') continue;
    allowedMap.set(normalizeLoose(row.store_name), row);
  }

  const liveStores = await fetchStoreList(business.api_key, SCALEV_BASE_URL);
  const candidates: CandidateStore[] = [];

  for (const liveStore of liveStores) {
    const key = normalizeLoose(liveStore.name);
    const matched = allowedMap.get(key);
    if (!matched) continue;
    candidates.push({
      storeName: matched.store_name,
      scalevStoreId: Number(liveStore.id || 0),
      storeUniqueId: liveStore.unique_id || null,
    });
  }

  return candidates.sort((left, right) => left.storeName.localeCompare(right.storeName));
}

async function loadBundleStoreLinks(
  businessId: number,
  bundleId: number,
  storeNames: string[],
): Promise<BundleStoreLinkRow[]> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_catalog_bundle_store_links')
    .select('business_id, scalev_bundle_id, store_name, scalev_store_id, store_unique_id, is_available, last_checked_at')
    .eq('business_id', businessId)
    .eq('scalev_bundle_id', bundleId)
    .in('store_name', storeNames);

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }

  return (data || []) as BundleStoreLinkRow[];
}

async function saveBundleStoreLinks(
  business: IntakeBusiness,
  bundleId: number,
  rows: CandidateStore[],
  availability: Map<string, boolean>,
) {
  const svc = createServiceSupabase();
  const timestamp = new Date().toISOString();
  const payload = rows.map((row) => ({
    business_id: business.id,
    business_code: business.business_code,
    scalev_bundle_id: bundleId,
    scalev_store_id: row.scalevStoreId,
    store_unique_id: row.storeUniqueId,
    store_name: row.storeName,
    is_available: Boolean(availability.get(row.storeName)),
    last_checked_at: timestamp,
    availability_source: 'scalev.store_bundle_detail',
  }));

  const { error } = await svc
    .from('scalev_catalog_bundle_store_links')
    .upsert(payload, { onConflict: 'business_id,scalev_bundle_id,store_name' });

  if (error && !isMissingTableError(error)) {
    throw error;
  }
}

function buildResolutionFromRows(
  rows: Array<{
    storeName: string;
    scalevStoreId: number | null;
    storeUniqueId: string | null;
    isAvailable: boolean;
  }>,
  label: ExactBundleStoreResolution['resolution'],
): ExactBundleStoreResolution {
  const available = rows.filter((row) => row.isAvailable);
  if (available.length === 1) {
    return {
      storeName: available[0].storeName,
      classifierLabel: label === 'exact_live' ? 'Exact bundle->store from Scalev' : 'Exact bundle->store from cache',
      scalevStoreId: available[0].scalevStoreId,
      storeUniqueId: available[0].storeUniqueId,
      storeCandidates: [available[0].storeName],
      resolution: label,
    };
  }

  if (available.length > 1) {
    return {
      storeName: null,
      classifierLabel: 'Bundle tersedia di lebih dari satu store marketplace',
      scalevStoreId: null,
      storeUniqueId: null,
      storeCandidates: available.map((row) => row.storeName).sort((left, right) => left.localeCompare(right)),
      resolution: 'ambiguous',
    };
  }

  return {
    storeName: null,
    classifierLabel: 'Bundle tidak tersedia di store marketplace yang aktif',
    scalevStoreId: null,
    storeUniqueId: null,
    storeCandidates: [],
    resolution: 'missing',
  };
}

export function createShopeeRltStoreResolverContext(): ShopeeRltStoreResolverContext {
  return {
    bundleResolutionCache: new Map<number, Promise<ExactBundleStoreResolution>>(),
    candidateStoresPromise: null,
  };
}

export async function resolveShopeeRltStoreForBundle(
  business: IntakeBusiness,
  bundleId: number,
  allowedStoreNames: string[],
  context: ShopeeRltStoreResolverContext,
): Promise<ExactBundleStoreResolution> {
  const cachedPromise = context.bundleResolutionCache.get(bundleId);
  if (cachedPromise) return cachedPromise;

  const nextPromise = (async () => {
    if (!context.candidateStoresPromise) {
      context.candidateStoresPromise = loadCandidateStores(business, allowedStoreNames);
    }
    const candidateStores = await context.candidateStoresPromise;
    if (candidateStores.length === 0) {
      return {
        storeName: null,
        classifierLabel: 'Store marketplace aktif untuk business ini tidak ditemukan',
        scalevStoreId: null,
        storeUniqueId: null,
        storeCandidates: [],
        resolution: 'missing' as const,
      } satisfies ExactBundleStoreResolution;
    }

    const cachedRows = await loadBundleStoreLinks(
      business.id,
      bundleId,
      candidateStores.map((row) => row.storeName),
    );
    const cacheByStoreName = new Map(cachedRows.map((row) => [row.store_name, row]));
    const now = Date.now();

    const freshRows = candidateStores
      .map((row) => {
        const cached = cacheByStoreName.get(row.storeName);
        if (!cached) return null;
        const checkedAt = cached.last_checked_at ? Date.parse(cached.last_checked_at) : 0;
        if (!checkedAt || Number.isNaN(checkedAt)) return null;
        if ((now - checkedAt) > STORE_LINK_CACHE_MAX_AGE_MS) return null;
        return {
          storeName: row.storeName,
          scalevStoreId: cached.scalev_store_id,
          storeUniqueId: cached.store_unique_id,
          isAvailable: Boolean(cached.is_available),
        };
      })
      .filter(Boolean) as Array<{
        storeName: string;
        scalevStoreId: number | null;
        storeUniqueId: string | null;
        isAvailable: boolean;
      }>;

    if (freshRows.length === candidateStores.length) {
      return buildResolutionFromRows(freshRows, 'exact_cache');
    }

    const staleRows = candidateStores
      .map((row) => {
        const cached = cacheByStoreName.get(row.storeName);
        if (!cached) return null;
        return {
          storeName: row.storeName,
          scalevStoreId: cached.scalev_store_id,
          storeUniqueId: cached.store_unique_id,
          isAvailable: Boolean(cached.is_available),
        };
      })
      .filter(Boolean) as Array<{
        storeName: string;
        scalevStoreId: number | null;
        storeUniqueId: string | null;
        isAvailable: boolean;
      }>;

    const availability = new Map<string, boolean>();
    for (const row of freshRows) {
      availability.set(row.storeName, row.isAvailable);
    }

    try {
      for (const store of candidateStores) {
        if (availability.has(store.storeName)) continue;
        const isAvailable = await fetchScalevStoreBundleAvailability(
          business.api_key!,
          store.scalevStoreId,
          bundleId,
        );
        availability.set(store.storeName, isAvailable);

        const availableStoreNames = Array.from(availability.entries())
          .filter(([, value]) => value)
          .map(([storeName]) => storeName);
        if (availableStoreNames.length > 1) {
          return {
            storeName: null,
            classifierLabel: 'Bundle tersedia di lebih dari satu store marketplace',
            scalevStoreId: null,
            storeUniqueId: null,
            storeCandidates: availableStoreNames.sort((left, right) => left.localeCompare(right)),
            resolution: 'ambiguous',
          } satisfies ExactBundleStoreResolution;
        }
      }
    } catch (error: any) {
      if (isRateLimitedError(error) && staleRows.length === candidateStores.length) {
        return buildResolutionFromRows(staleRows, 'exact_cache_stale');
      }
      throw error;
    }

    await saveBundleStoreLinks(business, bundleId, candidateStores, availability);

    const resolvedRows = candidateStores.map((row) => ({
      storeName: row.storeName,
      scalevStoreId: row.scalevStoreId,
      storeUniqueId: row.storeUniqueId,
      isAvailable: Boolean(availability.get(row.storeName)),
    }));

    return buildResolutionFromRows(resolvedRows, freshRows.length > 0 ? 'exact_cache_stale' : 'exact_live');
  })();

  context.bundleResolutionCache.set(bundleId, nextPromise);
  try {
    return await nextPromise;
  } catch (error) {
    context.bundleResolutionCache.delete(bundleId);
    throw error;
  }
}
