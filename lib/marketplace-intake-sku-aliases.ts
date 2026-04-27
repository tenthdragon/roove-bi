'use server';

import { requireDashboardRoles } from './dashboard-access';
import { createServiceSupabase } from './supabase-server';
import {
  getMarketplaceIntakeSourceConfig,
  listMarketplaceIntakeSourceConfigs,
  type MarketplaceIntakeSourceKey,
} from './marketplace-intake-sources';

export type MarketplaceSkuAliasListItem = {
  id: number;
  sourceKey: MarketplaceIntakeSourceKey;
  sourceLabel: string;
  businessCode: string;
  platform: string;
  rawPlatformSkuId: string | null;
  rawSellerSku: string | null;
  rawProductName: string | null;
  rawVariation: string | null;
  normalizedSku: string;
  reason: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type MarketplaceSkuAliasListResult = {
  items: MarketplaceSkuAliasListItem[];
  summary: {
    total: number;
    active: number;
    inactive: number;
  };
};

export type UpsertMarketplaceSkuAliasInput = {
  id?: number | null;
  sourceKey: MarketplaceIntakeSourceKey;
  rawPlatformSkuId?: string | null;
  rawSellerSku?: string | null;
  rawProductName?: string | null;
  rawVariation?: string | null;
  normalizedSku: string;
  reason?: string | null;
  isActive?: boolean;
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
  return 'Schema SKU alias marketplace belum siap. Jalankan migration 135 lalu reload schema PostgREST.';
}

function assertSourceKey(sourceKey: unknown): MarketplaceIntakeSourceKey {
  const normalized = cleanText(sourceKey);
  const match = listMarketplaceIntakeSourceConfigs().find((config) => config.sourceKey === normalized);
  if (!match) {
    throw new Error('sourceKey intake tidak valid.');
  }
  return match.sourceKey;
}

async function loadBusinessId(businessCode: string): Promise<number | null> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id')
    .eq('business_code', businessCode)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error)) throw new Error(getSchemaMessage());
    throw new Error(error.message || 'Gagal memuat business untuk SKU alias.');
  }

  return data?.id ? Number(data.id) : null;
}

export async function listMarketplaceSkuAliases(params?: {
  sourceKey?: string | null;
  limit?: number;
}): Promise<MarketplaceSkuAliasListResult> {
  await requireDashboardRoles(['owner'], 'Hanya owner yang bisa melihat SKU alias marketplace.');

  const svc = createServiceSupabase();
  const limit = Math.min(Math.max(Number(params?.limit || 500), 1), 1000);

  let query = svc
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
      is_active,
      created_at,
      updated_at
    `)
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(limit);

  const sourceKey = cleanText(params?.sourceKey);
  if (sourceKey) {
    query = query.eq('source_key', sourceKey);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) throw new Error(getSchemaMessage());
    throw new Error(error.message || 'Gagal memuat SKU alias marketplace.');
  }

  const sourceLabelByKey = new Map<string, string>(
    listMarketplaceIntakeSourceConfigs().map((config) => [config.sourceKey, config.sourceLabel]),
  );

  const items = (data || []).map((row: any) => ({
    id: Number(row.id),
    sourceKey: String(row.source_key) as MarketplaceIntakeSourceKey,
    sourceLabel: sourceLabelByKey.get(String(row.source_key)) || String(row.source_key || ''),
    businessCode: String(row.business_code || ''),
    platform: String(row.platform || ''),
    rawPlatformSkuId: cleanText(row.raw_platform_sku_id),
    rawSellerSku: cleanText(row.raw_seller_sku),
    rawProductName: cleanText(row.raw_product_name),
    rawVariation: cleanText(row.raw_variation),
    normalizedSku: String(row.normalized_sku || ''),
    reason: cleanText(row.reason),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }));

  return {
    items,
    summary: {
      total: items.length,
      active: items.filter((item) => item.isActive).length,
      inactive: items.filter((item) => !item.isActive).length,
    },
  };
}

export async function upsertMarketplaceSkuAlias(
  input: UpsertMarketplaceSkuAliasInput,
): Promise<MarketplaceSkuAliasListItem> {
  await requireDashboardRoles(['owner'], 'Hanya owner yang bisa mengubah SKU alias marketplace.');

  const sourceConfig = getMarketplaceIntakeSourceConfig(assertSourceKey(input.sourceKey));
  const normalizedSku = cleanText(input.normalizedSku);
  const rawPlatformSkuId = cleanText(input.rawPlatformSkuId);
  const rawSellerSku = cleanText(input.rawSellerSku);
  const rawProductName = cleanText(input.rawProductName);
  const rawVariation = cleanText(input.rawVariation);
  const reason = cleanText(input.reason);
  const isActive = input.isActive !== false;

  if (!normalizedSku) {
    throw new Error('Normalized SKU wajib diisi.');
  }

  if (!rawPlatformSkuId && !rawSellerSku && !rawProductName) {
    throw new Error('Isi minimal salah satu matcher: platform SKU ID, seller SKU, atau nama produk.');
  }

  const businessId = await loadBusinessId(sourceConfig.businessCode);

  const payload = {
    source_key: sourceConfig.sourceKey,
    business_id: businessId,
    business_code: sourceConfig.businessCode,
    platform: sourceConfig.platform,
    raw_platform_sku_id: rawPlatformSkuId,
    raw_seller_sku: rawSellerSku,
    raw_product_name: rawProductName,
    raw_variation: rawVariation,
    normalized_sku: normalizedSku,
    reason,
    is_active: isActive,
  };

  const svc = createServiceSupabase();
  const id = Number(input.id || 0);
  const result = id > 0
    ? await svc
        .from('marketplace_intake_sku_aliases')
        .update(payload)
        .eq('id', id)
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
          is_active,
          created_at,
          updated_at
        `)
        .single()
    : await svc
        .from('marketplace_intake_sku_aliases')
        .insert(payload)
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
          is_active,
          created_at,
          updated_at
        `)
        .single();

  if (result.error) {
    if (isMissingSchemaError(result.error)) throw new Error(getSchemaMessage());
    throw new Error(result.error.message || 'Gagal menyimpan SKU alias marketplace.');
  }

  const row: any = result.data;
  return {
    id: Number(row.id),
    sourceKey: String(row.source_key) as MarketplaceIntakeSourceKey,
    sourceLabel: sourceConfig.sourceLabel,
    businessCode: String(row.business_code || ''),
    platform: String(row.platform || ''),
    rawPlatformSkuId: cleanText(row.raw_platform_sku_id),
    rawSellerSku: cleanText(row.raw_seller_sku),
    rawProductName: cleanText(row.raw_product_name),
    rawVariation: cleanText(row.raw_variation),
    normalizedSku: String(row.normalized_sku || ''),
    reason: cleanText(row.reason),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}
