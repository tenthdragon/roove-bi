import { createServiceSupabase } from './supabase-server';
import {
  getMarketplaceIntakeSourceConfig,
  listMarketplaceIntakeSourceConfigs,
  type MarketplaceIntakeSourceConfig,
  type MarketplaceIntakeSourceKey,
} from './marketplace-intake-sources';

type ScopeRow = {
  id: number;
  source_key: string;
  store_name: string;
  is_enabled: boolean | null;
};

type StoreChannelRow = {
  store_name: string;
  store_type: string | null;
  is_active: boolean | null;
  channel_override: string | null;
};

export type MarketplaceIntakeStoreScopeStoreItem = {
  storeName: string;
  isSelected: boolean;
  isActive: boolean;
  storeType: string | null;
  channelOverride: string | null;
};

export type MarketplaceIntakeStoreScope = {
  sourceKey: MarketplaceIntakeSourceKey;
  sourceLabel: string;
  businessCode: string;
  platform: string;
  availableStores: MarketplaceIntakeStoreScopeStoreItem[];
  selectedStoreNames: string[];
  hasCustomSelection: boolean;
};

function cleanText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function isMissingSchemaError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42P01'
    || code === '42703'
    || code === 'PGRST205'
    || /does not exist/i.test(message)
    || /schema cache/i.test(message)
    || /column .* does not exist/i.test(message);
}

function getSchemaMessage() {
  return 'Schema store scope marketplace belum siap. Jalankan migration intake terbaru lalu reload schema PostgREST.';
}

export function assertMarketplaceIntakeSourceKey(sourceKey: unknown): MarketplaceIntakeSourceKey {
  const normalized = cleanText(sourceKey);
  const match = listMarketplaceIntakeSourceConfigs().find((config) => config.sourceKey === normalized);
  if (!match) {
    throw new Error('sourceKey intake tidak valid.');
  }
  return match.sourceKey;
}

async function loadBusinessId(sourceConfig: MarketplaceIntakeSourceConfig): Promise<number | null> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id')
    .eq('business_code', sourceConfig.businessCode)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error)) throw new Error(getSchemaMessage());
    throw new Error(error.message || 'Gagal memuat business untuk store scope marketplace.');
  }

  return data?.id ? Number(data.id) : null;
}

async function loadScopeRows(sourceKey: MarketplaceIntakeSourceKey): Promise<ScopeRow[]> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('marketplace_intake_source_store_scopes')
    .select('id, source_key, store_name, is_enabled')
    .eq('source_key', sourceKey)
    .order('store_name', { ascending: true });

  if (error) {
    if (isMissingSchemaError(error)) throw new Error(getSchemaMessage());
    throw new Error(error.message || 'Gagal memuat store scope marketplace.');
  }

  return (data || []) as ScopeRow[];
}

async function loadAvailableStoreRows(businessId: number | null): Promise<StoreChannelRow[]> {
  if (!businessId) return [];
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_store_channels')
    .select('store_name, store_type, is_active, channel_override')
    .eq('business_id', businessId)
    .order('store_name', { ascending: true });

  if (error) {
    if (isMissingSchemaError(error)) throw new Error(getSchemaMessage());
    throw new Error(error.message || 'Gagal memuat daftar store business untuk source marketplace.');
  }

  return (data || []) as StoreChannelRow[];
}

export async function listMarketplaceIntakeStoreScope(sourceKey: unknown): Promise<MarketplaceIntakeStoreScope> {
  const normalizedSourceKey = assertMarketplaceIntakeSourceKey(sourceKey);
  const sourceConfig = getMarketplaceIntakeSourceConfig(normalizedSourceKey);
  const businessId = await loadBusinessId(sourceConfig);
  const [scopeRows, availableRows] = await Promise.all([
    loadScopeRows(normalizedSourceKey),
    loadAvailableStoreRows(businessId),
  ]);

  const enabledScopeNames = scopeRows
    .filter((row) => row.is_enabled !== false)
    .map((row) => String(row.store_name || '').trim())
    .filter(Boolean);
  const availableByName = new Map<string, StoreChannelRow>();
  for (const row of availableRows) {
    const storeName = cleanText(row.store_name);
    if (!storeName) continue;
    availableByName.set(storeName, row);
  }

  const availableStoreNames = Array.from(availableByName.keys());
  const hasCustomSelection = scopeRows.length > 0;
  const selectedStoreNames = hasCustomSelection
    ? Array.from(new Set(enabledScopeNames)).sort((left, right) => left.localeCompare(right))
    : Array.from(new Set(
        availableStoreNames.length > 0
          ? sourceConfig.allowedStores.filter((storeName) => availableByName.has(storeName))
          : sourceConfig.allowedStores,
      )).sort((left, right) => left.localeCompare(right));

  const allNames = Array.from(new Set([
    ...Array.from(availableByName.keys()),
    ...selectedStoreNames,
  ])).sort((left, right) => left.localeCompare(right));

  return {
    sourceKey: sourceConfig.sourceKey,
    sourceLabel: sourceConfig.sourceLabel,
    businessCode: sourceConfig.businessCode,
    platform: sourceConfig.platform,
    selectedStoreNames,
    hasCustomSelection,
    availableStores: allNames.map((storeName) => {
      const row = availableByName.get(storeName);
      return {
        storeName,
        isSelected: selectedStoreNames.includes(storeName),
        isActive: row?.is_active !== false,
        storeType: row?.store_type || null,
        channelOverride: row?.channel_override || null,
      };
    }),
  };
}

export async function upsertMarketplaceIntakeStoreScope(input: {
  sourceKey: MarketplaceIntakeSourceKey;
  selectedStoreNames: string[];
}): Promise<MarketplaceIntakeStoreScope> {
  const sourceConfig = getMarketplaceIntakeSourceConfig(assertMarketplaceIntakeSourceKey(input.sourceKey));
  const businessId = await loadBusinessId(sourceConfig);
  const availableRows = await loadAvailableStoreRows(businessId);
  const availableStoreNames = new Set(
    availableRows
      .map((row) => cleanText(row.store_name))
      .filter((value): value is string => Boolean(value)),
  );

  const selectedStoreNames = Array.from(new Set(
    (input.selectedStoreNames || [])
      .map((storeName) => cleanText(storeName))
      .filter((value): value is string => Boolean(value)),
  ));

  if (selectedStoreNames.length === 0) {
    throw new Error('Pilih minimal satu store untuk whitelist source ini.');
  }

  for (const storeName of selectedStoreNames) {
    if (!availableStoreNames.has(storeName)) {
      throw new Error(`Store "${storeName}" tidak ada di Business Settings untuk business ini.`);
    }
  }

  const svc = createServiceSupabase();
  const existingRows = await loadScopeRows(sourceConfig.sourceKey);
  const existingNames = new Set(existingRows.map((row) => cleanText(row.store_name)).filter((value): value is string => Boolean(value)));

  const payload = Array.from(availableStoreNames).map((storeName) => ({
    source_key: sourceConfig.sourceKey,
    business_id: businessId,
    business_code: sourceConfig.businessCode,
    platform: sourceConfig.platform,
    store_name: storeName,
    is_enabled: selectedStoreNames.includes(storeName),
  }));

  if (payload.length > 0) {
    const { error } = await svc
      .from('marketplace_intake_source_store_scopes')
      .upsert(payload, { onConflict: 'source_key,store_name' });

    if (error) {
      if (isMissingSchemaError(error)) throw new Error(getSchemaMessage());
      throw new Error(error.message || 'Gagal menyimpan store scope marketplace.');
    }
  }

  const obsoleteNames = Array.from(existingNames).filter((storeName) => !availableStoreNames.has(storeName));
  if (obsoleteNames.length > 0) {
    const { error } = await svc
      .from('marketplace_intake_source_store_scopes')
      .delete()
      .eq('source_key', sourceConfig.sourceKey)
      .in('store_name', obsoleteNames);

    if (error) {
      if (isMissingSchemaError(error)) throw new Error(getSchemaMessage());
      throw new Error(error.message || 'Gagal membersihkan store scope marketplace lama.');
    }
  }

  return listMarketplaceIntakeStoreScope(sourceConfig.sourceKey);
}

export async function resolveMarketplaceIntakeSourceConfig(
  sourceKey?: string | null,
): Promise<MarketplaceIntakeSourceConfig> {
  const baseConfig = getMarketplaceIntakeSourceConfig(sourceKey);
  try {
    const scope = await listMarketplaceIntakeStoreScope(baseConfig.sourceKey);
    return {
      ...baseConfig,
      allowedStores: scope.selectedStoreNames.length > 0 ? scope.selectedStoreNames : baseConfig.allowedStores,
    };
  } catch (error: any) {
    if (String(error?.message || '').includes('Schema store scope marketplace belum siap')) {
      return baseConfig;
    }
    throw error;
  }
}
