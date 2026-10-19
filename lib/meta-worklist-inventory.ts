import type { AdMapping } from './meta-ad-mapping';
import { resolveTaxonomy, type CepCategory, type TaxonomyRule } from './meta-ad-taxonomy';

/** Same classification as meta_ad_classifications, with taxonomy loaded once.
 * Callers supply only the authorized workspace's active accounts and catalog.
 * Keep channel/destination evidence from the database view unchanged.
 */
export function classifyWorklistInventory(mappings: AdMapping[], accounts: { account_id: string; default_brand_id: number | null }[], catalog: CepCategory[], rules: TaxonomyRule[]): AdMapping[] {
  const brands = new Map(accounts.map(a => [a.account_id, a.default_brand_id]));
  return mappings.filter(m => brands.has(m.account_id)).map(m => {
    const brand_id = brands.get(m.account_id) ?? null;
    return { ...m, brand_id, ...resolveTaxonomy(brand_id, m.auto_mapping, m.overrides, catalog, rules) };
  });
}
