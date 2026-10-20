import type { SavedFunnel } from './meta-funnel-domain';
import type { TemplateRule } from './meta-funnel-templates';
import type { MetaBrandScope } from './meta-brand-access';

export function visibleMetaTemplates<T extends SavedFunnel>(templates: T[], scope: MetaBrandScope, brandId?: string | number | null): T[] {
  return templates.filter(f => (f.brand_id == null || (scope.brandIds === null || scope.brandIds.includes(f.brand_id))
    && (!brandId || String(f.brand_id) === String(brandId)))
    && (scope.accountIds === null || scope.brandIds!.length > 0 && (f.brand_id != null || scope.accountIds.length > 0 && (!f.account_ids.length || f.account_ids.some(id => scope.accountIds!.includes(id))))));
}
/** Never pass rules for another brand into URL matching, even for shared URLs. */
export function brandTemplateRules(rules: TemplateRule[], brandId?: string | number | null) {
  return rules.filter(r => r.brand_id == null || String(r.brand_id) === String(brandId))
    .sort((a, b) => Number(b.brand_id != null) - Number(a.brand_id != null));
}
