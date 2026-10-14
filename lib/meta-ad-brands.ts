import type { AdFact } from './meta-funnel-domain';

export type MetaAccountBrand = { account_id: string; default_brand_id: number | null };
export type MetaBrand = { id: number; name: string };
export const UNMAPPED_META_BRAND = '__unmapped__';

export function validateMetaBrandFilter(value?: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || (value !== UNMAPPED_META_BRAND
    && (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))))) {
    throw new Error('Filter brand tidak valid.');
  }
  return value;
}
function brandKey(account: MetaAccountBrand, brands: MetaBrand[]) {
  return brands.some(b => b.id === account.default_brand_id) ? String(account.default_brand_id) : UNMAPPED_META_BRAND;
}
export function metaBrandAccountIds(accounts: MetaAccountBrand[], brands: MetaBrand[], brandId?: string) {
  return accounts.filter(a => !brandId || brandKey(a, brands) === brandId).map(a => a.account_id);
}
export function metaBrandOptions(accounts: MetaAccountBrand[], brands: MetaBrand[], rows: Pick<AdFact, 'account_id' | 'ad_id'>[]) {
  const byAccount = new Map(accounts.map(a => [a.account_id, brandKey(a, brands)]));
  const counts = new Map<string, Set<string>>([...new Set(byAccount.values())].map(key => [key, new Set()]));
  const all = new Set<string>();
  for (const row of rows) {
    const key = byAccount.get(row.account_id);
    if (!key) continue;
    const ad = `${row.account_id}:${row.ad_id}`;
    counts.get(key)!.add(ad); all.add(ad);
  }
  const labels = new Map(brands.map(b => [String(b.id), b.name]));
  const choices = [...counts].map(([value, ads]) => ({ value,
    label: labels.get(value) || 'Brand belum dipetakan', count: ads.size,
  })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'id'));
  return { choices, total: all.size };
}
