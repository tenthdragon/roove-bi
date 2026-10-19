'use server';

import { requireDashboardRoles } from './dashboard-access';
import { createServiceSupabase } from './service-supabase';
import { createServerSupabase } from './supabase-server';

export async function getAdvertiserBrandAssignments(userId: string) {
  const { workspaceId } = await requireDashboardRoles(['owner'], 'Hanya owner workspace yang bisa mengalokasikan brand.');
  const svc = createServiceSupabase();
  const member = await svc.from('workspace_memberships').select('role,status').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
  if (member.error || member.data?.role !== 'advertiser' || member.data.status !== 'active') throw new Error('Advertiser tidak tersedia di workspace ini.');
  const [brands, grants] = await Promise.all([
    svc.from('brands').select('id,name').eq('workspace_id', workspaceId).order('name'),
    svc.from('workspace_advertiser_brands').select('brand_id').eq('workspace_id', workspaceId).eq('user_id', userId),
  ]);
  if (brands.error || grants.error) throw new Error('Alokasi brand belum tersedia. Pastikan migrasi 224 sudah terpasang.');
  return { workspaceId, brands: (brands.data || []) as { id: number; name: string }[], brandIds: (grants.data || []).map(r => Number(r.brand_id)) };
}
export async function saveAdvertiserBrandAssignments(userId: string, brandIds: number[], expectedWorkspaceId: string) {
  const { workspaceId } = await requireDashboardRoles(['owner'], 'Hanya owner workspace yang bisa mengalokasikan brand.');
  if (workspaceId !== expectedWorkspaceId) throw new Error('Workspace berubah. Muat ulang sebelum menyimpan.');
  if (!Array.isArray(brandIds) || brandIds.length > 500 || brandIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Alokasi brand tidak valid.');
  const r = await createServerSupabase().rpc('set_workspace_advertiser_brands', { p_workspace_id: workspaceId, p_user_id: userId, p_brand_ids: [...new Set(brandIds)].sort((a, b) => a - b) });
  if (r.error) throw new Error(r.error.message);
  return { saved: true };
}
