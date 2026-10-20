import { reportingAccess, editAccess } from './meta-report-context';
import { createServiceSupabase } from './service-supabase';
import { readAll } from './meta-funnel-store';
import type { CepCategory, TaxonomyRule } from './meta-ad-taxonomy';
export async function taxonomyAccess(manage = false) {
  return manage ? editAccess('meta:taxonomy') : reportingAccess();
}
export async function loadTaxonomy(workspaceId: string, includeRules = true) {
  const svc = createServiceSupabase();
  const [catalog, intentions, rules, brands] = await Promise.all([
    readAll<CepCategory>(svc, 'meta_ad_cep_catalog', 'brand_id,key,label,description,revision,is_active', workspaceId),
    readAll<CepCategory>(svc, 'meta_ad_intention_catalog', 'brand_id,key,label,description,revision,is_active', workspaceId),
    includeRules ? readAll<TaxonomyRule>(svc, 'meta_ad_taxonomy_rules', 'brand_id,dimension,raw_key,cep_keys,intention_key,revision', workspaceId) : Promise.resolve([] as TaxonomyRule[]),
    svc.from('brands').select('id,name').eq('workspace_id', workspaceId).order('name'),
  ]);
  if (brands.error) throw new Error('Kategori iklan belum tersedia. Pasang migration 218 sebelum mengaktifkan fitur ini.');
  return { catalog, intentions, rules, brands: (brands.data || []) as { id: number; name: string }[] };
}
