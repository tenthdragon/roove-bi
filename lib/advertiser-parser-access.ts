import type { SupabaseClient } from '@supabase/supabase-js';

export async function loadAdvertiserParserAccess(client: SupabaseClient, workspaceId: string, userId: string) {
  const { data, error } = await client.from('workspace_advertiser_parser_access')
    .select('user_id').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
  // Rolling deployments may serve the profile before the new table is available.
  if (error && ['42P01', 'PGRST205'].includes(error.code)) return false;
  if (error) throw new Error('Gagal memverifikasi akses MP Data Parser.');
  return Boolean(data);
}
