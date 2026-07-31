import { createServiceSupabase } from './supabase-server';
import {
  buildMarketplaceIntakeSourceConfig,
  type MarketplaceIntakeSourceConfig,
  type MarketplaceIntakePlatform,
} from './marketplace-intake-sources';

type MarketplaceSourceRow = {
  id: number;
  source_key: string;
  source_label: string;
  platform: MarketplaceIntakePlatform;
  business_id: number;
  business_code: string;
  is_active: boolean | null;
};

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function isMissingSchemaError(error: any): boolean {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42P01'
    || code === '42703'
    || code === 'PGRST205'
    || /does not exist/i.test(message)
    || /schema cache/i.test(message);
}

export async function listWorkspaceMarketplaceIntakeSourceConfigs(
  workspaceId: string,
  options?: { uploadOnly?: boolean },
): Promise<MarketplaceIntakeSourceConfig[]> {
  const normalizedWorkspaceId = cleanText(workspaceId);
  if (!normalizedWorkspaceId) throw new Error('Workspace source marketplace tidak valid.');

  const svc = createServiceSupabase();
  let query = svc
    .from('marketplace_intake_sources')
    .select('id, source_key, source_label, platform, business_id, business_code, is_active')
    .eq('workspace_id', normalizedWorkspaceId)
    .order('platform', { ascending: true })
    .order('business_code', { ascending: true });

  if (options?.uploadOnly) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) {
    if (isMissingSchemaError(error)) {
      throw new Error('Schema source marketplace workspace belum siap. Jalankan migration 175.');
    }
    throw new Error(error.message || 'Gagal memuat source marketplace workspace.');
  }

  const configs = (data || []).flatMap((row: MarketplaceSourceRow) => {
    const businessCode = cleanText(row.business_code);
    if (!businessCode || !row.platform) return [];
    return [buildMarketplaceIntakeSourceConfig({
      id: Number(row.id),
      platform: row.platform,
      businessCode,
      sourceKey: row.source_key,
      sourceLabel: row.source_label,
      uploadEnabled: row.is_active !== false,
    })];
  });

  const seen = new Set<string>();
  for (const config of configs) {
    if (seen.has(config.sourceKey)) {
      throw new Error(`Business code ScaleV menghasilkan source marketplace duplikat: ${config.sourceKey}.`);
    }
    seen.add(config.sourceKey);
  }

  return configs;
}

export async function resolveWorkspaceMarketplaceIntakeSourceConfig(
  workspaceId: string,
  sourceKey: unknown,
  options?: { uploadOnly?: boolean },
): Promise<MarketplaceIntakeSourceConfig> {
  const normalizedSourceKey = cleanText(sourceKey).toLowerCase();
  if (!normalizedSourceKey) throw new Error('Source marketplace wajib dipilih.');
  const configs = await listWorkspaceMarketplaceIntakeSourceConfigs(workspaceId, options);
  const match = configs.find((config) => config.sourceKey === normalizedSourceKey);
  if (!match) {
    throw new Error('Source marketplace tidak terdaftar pada workspace aktif. Hubungkan business ScaleV terlebih dahulu.');
  }
  return match;
}
