import { createServiceSupabase } from './service-supabase';

export function isMissingManualMarketplaceSchema(error: { code?: string } | null) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function getManualMarketplaceCutover(workspaceId: string): Promise<string | null> {
  const { data, error } = await createServiceSupabase()
    .from('manual_marketplace_ad_spend_cutovers')
    .select('starts_on')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (isMissingManualMarketplaceSchema(error)) return null;
  if (error) throw new Error(`Gagal memuat kebijakan input iklan: ${error.message}`);
  return data?.starts_on || null;
}
