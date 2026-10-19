import { createServiceSupabase } from './service-supabase';

export type MetaBrandScope = { brandIds: number[] | null; accountIds: string[] | null; accessKey: string };
export const NO_META_ACCOUNT = '__no_authorized_meta_account__';
/** null means unrestricted; [] always means no access, never all brands. */
export async function loadMetaBrandScope(workspaceId: string, userId: string, role: string): Promise<MetaBrandScope> {
  if (role !== 'advertiser') return { brandIds: null, accountIds: null, accessKey: 'all' };
  const svc = createServiceSupabase();
  const [grants, accounts] = await Promise.all([
    svc.from('workspace_advertiser_brands').select('brand_id').eq('workspace_id', workspaceId).eq('user_id', userId),
    svc.from('meta_ad_accounts').select('account_id,default_brand_id').eq('workspace_id', workspaceId).eq('is_active', true),
  ]);
  if (grants.error || accounts.error) throw new Error('Alokasi brand belum dapat diverifikasi. Hubungi owner workspace.');
  const brandIds = [...new Set<number>((grants.data || []).map(r => r.brand_id))].sort((a, b) => a - b);
  const accountIds = (accounts.data || []).filter(a => brandIds.includes(a.default_brand_id)).map(a => String(a.account_id)).sort();
  return { brandIds, accountIds, accessKey: JSON.stringify([brandIds, accountIds]) };
}
export function scopeMetaAccounts<T extends { account_id: string }>(rows: T[], scope: MetaBrandScope): T[] {
  return scope.accountIds === null ? rows : rows.filter(r => scope.accountIds!.includes(r.account_id));
}
export function scopeMetaBrands<T extends { id: number }>(rows: T[], scope: MetaBrandScope): T[] {
  return scope.brandIds === null ? rows : rows.filter(r => scope.brandIds!.includes(r.id));
}
export function assertMetaBrand(scope: MetaBrandScope, brandId?: string) {
  if (brandId && scope.brandIds !== null && !scope.brandIds.includes(Number(brandId))) throw new Error('Anda tidak memiliki akses ke brand ini.');
}
export function scopeMetaAccountIds(ids: string[], scope: MetaBrandScope): string[] {
  if (scope.accountIds === null) return ids;
  const allowed = scope.accountIds.filter(id => !ids.length || ids.includes(id));
  return allowed.length ? allowed : [NO_META_ACCOUNT];
}
