'use server';

import { requireDashboardRoles } from './dashboard-access';
import { createServiceSupabase } from './supabase-server';
import {
  getMarketplaceIntakeSourceConfig,
  listMarketplaceIntakeSourceConfigs,
  type MarketplaceIntakeSourceKey,
} from './marketplace-intake-sources';

export type MarketplaceManualRuleListItem = {
  id: number;
  sourceKey: MarketplaceIntakeSourceKey;
  sourceLabel: string;
  businessCode: string;
  platform: string;
  matchSignature: string;
  mpSku: string | null;
  mpProductName: string;
  mpVariation: string | null;
  targetEntityKey: string;
  targetEntityLabel: string;
  targetCustomId: string | null;
  scalevBundleId: number;
  mappedStoreName: string | null;
  usageCount: number;
  isActive: boolean;
  createdByEmail: string | null;
  updatedByEmail: string | null;
  lastConfirmedAt: string | null;
  updatedAt: string | null;
};

export type MarketplaceManualRuleListResult = {
  items: MarketplaceManualRuleListItem[];
  summary: {
    total: number;
    active: number;
    inactive: number;
  };
};

export type UpsertMarketplaceManualRuleInput = {
  id?: number | null;
  sourceKey: MarketplaceIntakeSourceKey;
  mpSku?: string | null;
  mpProductName: string;
  mpVariation?: string | null;
  targetEntityKey: string;
  targetEntityLabel: string;
  targetCustomId?: string | null;
  scalevBundleId: number;
  mappedStoreName?: string | null;
  isActive?: boolean;
  updatedByEmail?: string | null;
};

function cleanText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function normalizeIdentifier(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function buildMatchSignature(input: {
  mpSku?: string | null;
  mpProductName: string | null | undefined;
  mpVariation?: string | null;
}): string {
  return [
    normalizeIdentifier(input.mpSku) || '__blank__',
    normalizeIdentifier(input.mpProductName) || '__blank__',
    normalizeIdentifier(input.mpVariation) || '__blank__',
  ].join('|');
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
  return 'Schema resolver rules marketplace belum siap. Jalankan migration intake terbaru lalu reload schema PostgREST.';
}

function assertSourceKey(sourceKey: unknown): MarketplaceIntakeSourceKey {
  const normalized = cleanText(sourceKey);
  const match = listMarketplaceIntakeSourceConfigs().find((config) => config.sourceKey === normalized);
  if (!match) {
    throw new Error('sourceKey intake tidak valid.');
  }
  return match.sourceKey;
}

async function loadBusinessId(businessCode: string): Promise<number> {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id')
    .eq('business_code', businessCode)
    .single();

  if (error) {
    if (isMissingSchemaError(error)) throw new Error(getSchemaMessage());
    throw new Error(error.message || 'Gagal memuat business untuk resolver rule marketplace.');
  }

  return Number(data.id);
}

export async function listMarketplaceManualRules(params?: {
  sourceKey?: string | null;
  limit?: number;
}): Promise<MarketplaceManualRuleListResult> {
  await requireDashboardRoles(['owner'], 'Hanya owner yang bisa melihat resolver rule marketplace.');

  const svc = createServiceSupabase();
  const limit = Math.min(Math.max(Number(params?.limit || 500), 1), 1000);

  let query = svc
    .from('marketplace_intake_manual_memory')
    .select(`
      id,
      source_key,
      source_label,
      business_code,
      platform,
      match_signature,
      mp_sku,
      mp_product_name,
      mp_variation,
      target_entity_key,
      target_entity_label,
      target_custom_id,
      scalev_bundle_id,
      mapped_store_name,
      usage_count,
      is_active,
      created_by_email,
      updated_by_email,
      last_confirmed_at,
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
    throw new Error(error.message || 'Gagal memuat resolver rule marketplace.');
  }

  const sourceLabelByKey = new Map<string, string>(
    listMarketplaceIntakeSourceConfigs().map((config) => [config.sourceKey, config.sourceLabel]),
  );

  const items = (data || []).map((row: any) => ({
    id: Number(row.id),
    sourceKey: String(row.source_key) as MarketplaceIntakeSourceKey,
    sourceLabel: sourceLabelByKey.get(String(row.source_key)) || String(row.source_label || row.source_key || ''),
    businessCode: String(row.business_code || ''),
    platform: String(row.platform || ''),
    matchSignature: String(row.match_signature || ''),
    mpSku: cleanText(row.mp_sku),
    mpProductName: String(row.mp_product_name || ''),
    mpVariation: cleanText(row.mp_variation),
    targetEntityKey: String(row.target_entity_key || ''),
    targetEntityLabel: String(row.target_entity_label || ''),
    targetCustomId: cleanText(row.target_custom_id),
    scalevBundleId: Number(row.scalev_bundle_id || 0),
    mappedStoreName: cleanText(row.mapped_store_name),
    usageCount: Number(row.usage_count || 0),
    isActive: Boolean(row.is_active),
    createdByEmail: cleanText(row.created_by_email),
    updatedByEmail: cleanText(row.updated_by_email),
    lastConfirmedAt: row.last_confirmed_at || null,
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

export async function upsertMarketplaceManualRule(
  input: UpsertMarketplaceManualRuleInput,
): Promise<MarketplaceManualRuleListItem> {
  await requireDashboardRoles(['owner'], 'Hanya owner yang bisa mengubah resolver rule marketplace.');

  const sourceConfig = getMarketplaceIntakeSourceConfig(assertSourceKey(input.sourceKey));
  const mpProductName = cleanText(input.mpProductName);
  const targetEntityKey = cleanText(input.targetEntityKey);
  const targetEntityLabel = cleanText(input.targetEntityLabel);
  const scalevBundleId = Number(input.scalevBundleId || 0);

  if (!mpProductName) throw new Error('Nama produk marketplace wajib diisi.');
  if (!targetEntityKey || !targetEntityLabel || !Number.isFinite(scalevBundleId) || scalevBundleId <= 0) {
    throw new Error('Target entity Scalev belum lengkap.');
  }

  const mpSku = cleanText(input.mpSku);
  const mpVariation = cleanText(input.mpVariation);
  const matchSignature = buildMatchSignature({ mpSku, mpProductName, mpVariation });
  const businessId = await loadBusinessId(sourceConfig.businessCode);
  const isActive = input.isActive !== false;
  const updatedByEmail = cleanText(input.updatedByEmail);
  const now = new Date().toISOString();

  const payload = {
    source_key: sourceConfig.sourceKey,
    source_label: sourceConfig.sourceLabel,
    platform: sourceConfig.platform,
    business_id: businessId,
    business_code: sourceConfig.businessCode,
    match_signature: matchSignature,
    mp_sku: mpSku,
    mp_product_name: mpProductName,
    mp_variation: mpVariation,
    target_entity_type: 'bundle',
    target_entity_key: targetEntityKey,
    target_entity_label: targetEntityLabel,
    target_custom_id: cleanText(input.targetCustomId),
    scalev_bundle_id: scalevBundleId,
    mapped_store_name: cleanText(input.mappedStoreName),
    updated_by_email: updatedByEmail,
    last_confirmed_at: now,
    is_active: isActive,
  };

  const svc = createServiceSupabase();
  const id = Number(input.id || 0);

  let result: any;
  if (id > 0) {
    result = await svc
      .from('marketplace_intake_manual_memory')
      .update(payload)
      .eq('id', id)
      .select(`
        id,
        source_key,
        source_label,
        business_code,
        platform,
        match_signature,
        mp_sku,
        mp_product_name,
        mp_variation,
        target_entity_key,
        target_entity_label,
        target_custom_id,
        scalev_bundle_id,
        mapped_store_name,
        usage_count,
        is_active,
        created_by_email,
        updated_by_email,
        last_confirmed_at,
        updated_at
      `)
      .single();
  } else {
    const existing = await svc
      .from('marketplace_intake_manual_memory')
      .select('id, usage_count, created_by_email')
      .eq('source_key', sourceConfig.sourceKey)
      .eq('business_code', sourceConfig.businessCode)
      .eq('match_signature', matchSignature)
      .maybeSingle();

    if (existing.error && !isMissingSchemaError(existing.error)) {
      throw new Error(existing.error.message || 'Gagal memeriksa resolver rule marketplace.');
    }

    const usageCount = Number(existing.data?.usage_count || 0) + 1;
    const createPayload = {
      ...payload,
      usage_count: usageCount,
      created_by_email: cleanText(existing.data?.created_by_email) || updatedByEmail,
    };

    result = await svc
      .from('marketplace_intake_manual_memory')
      .upsert(createPayload, { onConflict: 'source_key,business_code,match_signature' })
      .select(`
        id,
        source_key,
        source_label,
        business_code,
        platform,
        match_signature,
        mp_sku,
        mp_product_name,
        mp_variation,
        target_entity_key,
        target_entity_label,
        target_custom_id,
        scalev_bundle_id,
        mapped_store_name,
        usage_count,
        is_active,
        created_by_email,
        updated_by_email,
        last_confirmed_at,
        updated_at
      `)
      .single();
  }

  if (result.error) {
    if (isMissingSchemaError(result.error)) throw new Error(getSchemaMessage());
    throw new Error(result.error.message || 'Gagal menyimpan resolver rule marketplace.');
  }

  const row: any = result.data;
  return {
    id: Number(row.id),
    sourceKey: String(row.source_key) as MarketplaceIntakeSourceKey,
    sourceLabel: String(row.source_label || sourceConfig.sourceLabel),
    businessCode: String(row.business_code || sourceConfig.businessCode),
    platform: String(row.platform || sourceConfig.platform),
    matchSignature: String(row.match_signature || ''),
    mpSku: cleanText(row.mp_sku),
    mpProductName: String(row.mp_product_name || ''),
    mpVariation: cleanText(row.mp_variation),
    targetEntityKey: String(row.target_entity_key || ''),
    targetEntityLabel: String(row.target_entity_label || ''),
    targetCustomId: cleanText(row.target_custom_id),
    scalevBundleId: Number(row.scalev_bundle_id || 0),
    mappedStoreName: cleanText(row.mapped_store_name),
    usageCount: Number(row.usage_count || 0),
    isActive: Boolean(row.is_active),
    createdByEmail: cleanText(row.created_by_email),
    updatedByEmail: cleanText(row.updated_by_email),
    lastConfirmedAt: row.last_confirmed_at || null,
    updatedAt: row.updated_at || null,
  };
}
