'use server';

import { requireDashboardRoles } from './dashboard-access';
import { createServiceSupabase } from './service-supabase';
import { createServerSupabase } from './supabase-server';
import { loadAdvertiserParserAccess } from './advertiser-parser-access';

export async function getAdvertiserParserAccess(userId: string, expectedWorkspaceId: string) {
  const { workspaceId } = await requireDashboardRoles(['owner'], 'Hanya owner workspace yang dapat mengatur akses MP Data Parser.');
  if (workspaceId !== expectedWorkspaceId) throw new Error('Workspace berubah. Muat ulang sebelum melanjutkan.');
  const service = createServiceSupabase();
  const member = await service.from('workspace_memberships').select('role,status')
    .eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
  if (member.error || member.data?.role !== 'advertiser' || member.data.status !== 'active') {
    throw new Error('Advertiser tidak aktif di workspace ini.');
  }
  return { workspaceId, enabled: await loadAdvertiserParserAccess(service, workspaceId, userId) };
}

export async function saveAdvertiserParserAccess(userId: string, enabled: boolean, expectedWorkspaceId: string) {
  const { workspaceId } = await requireDashboardRoles(['owner'], 'Hanya owner workspace yang dapat mengatur akses MP Data Parser.');
  if (workspaceId !== expectedWorkspaceId) throw new Error('Workspace berubah. Muat ulang sebelum menyimpan.');
  if (typeof enabled !== 'boolean') throw new Error('Pilihan akses tidak valid.');
  const { data, error } = await createServerSupabase().rpc('set_workspace_advertiser_parser_access', {
    p_workspace_id: workspaceId,
    p_user_id: userId,
    p_enabled: enabled,
  });
  if (error) throw new Error(error.message);
  return { workspaceId, enabled: data as boolean };
}
