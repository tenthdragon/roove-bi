'use server';
import { mutateMeta } from './meta-edit-mutations';
import { createServiceSupabase } from './service-supabase';
import { taxonomyAccess, loadTaxonomy } from './meta-taxonomy-store';
import { mappingUnit } from './meta-ad-mapping';
import { newCepKey, validateCepSelection, validateIntention } from './meta-ad-taxonomy';
import { validateRange } from './meta-funnel-domain';
import { getTodayWIB } from './sync-schedule';
import { shiftDay } from './meta-funnel-domain';
import { scopeMetaBrands, assertMetaBrand } from './meta-brand-access';
type RuleInput = { brandId: number; dimension: 'cep' | 'intention'; raw: string; ceps: string[]; intention: string; revision: number };
async function result<T>(work: () => Promise<T>) {
  try { return { data: await work() }; }
  catch (error) { console.error('[meta-taxonomy]', error); return { error: 'Perubahan belum tersimpan. Periksa kategori, izin akses, dan versi data; lalu muat ulang.' }; }
}
export async function getMetaTaxonomyConfiguration() {
  return result(async () => { const scope = await taxonomyAccess(); const data = await loadTaxonomy(scope.workspaceId);
    return { brands: scopeMetaBrands(data.brands, scope), catalog: data.catalog.filter(c => scope.brandIds === null || scope.brandIds.includes(c.brand_id)),
      intentions: data.intentions.filter(c => scope.brandIds === null || scope.brandIds.includes(c.brand_id)),
      rules: data.rules.filter(r => scope.brandIds === null || scope.brandIds.includes(r.brand_id)) }; });
}
async function ruleScope(input: RuleInput) {
  const ctx = await taxonomyAccess(true); assertMetaBrand(ctx, String(input.brandId)); const { workspaceId, profile } = ctx; const config = await loadTaxonomy(workspaceId);
  if (!config.brands.some(b => b.id === input.brandId) || !['cep', 'intention'].includes(input.dimension) || typeof input.raw !== 'string' || !input.raw.trim() || input.raw.length > 500 || !Number.isInteger(input.revision)) throw new Error('Aturan tidak valid.');
  const raw_key = mappingUnit(input.dimension, input.raw).key;
  const ceps = input.dimension === 'cep' ? validateCepSelection(input.ceps, input.brandId, config.catalog, config.rules.find(r => r.brand_id === input.brandId && r.dimension === input.dimension && r.raw_key === raw_key)?.cep_keys || []) : [];
  if (input.dimension === 'cep' && !ceps.length) throw new Error('Pilih setidaknya satu CEP.');
  const intention_key = input.dimension === 'intention' ? validateIntention(input.intention, input.brandId, config.intentions, config.rules.find(r => r.brand_id === input.brandId && r.dimension === input.dimension && r.raw_key === raw_key)?.intention_key) : null;
  return { workspaceId, profile, row: { brand_id: input.brandId, dimension: input.dimension, raw_key, cep_keys: ceps, intention_key } };
}
export async function previewMetaTaxonomyRule(input: RuleInput & { from?: string; to?: string }) {
  return result(async () => {
    const { workspaceId, row } = await ruleScope(input); const today = getTodayWIB(), from = input.from || shiftDay(today, -29), to = input.to || today; validateRange(from, to);
    const r = await createServiceSupabase().rpc('preview_meta_taxonomy_rule', { w: workspaceId, b: row.brand_id, d: row.dimension, raw: row.raw_key, f: from, t: to });
    if (r.error) throw new Error(r.error.message);
    return r.data as { matched: number; eligible: number; manualPreserved: number; spendByCurrency: Record<string, number>; samples: { account_id: string; ad_id: string; ad_name: string }[] };
  });
}
export async function saveMetaTaxonomyRule(input: RuleInput) {
  return result(async () => {
    const { workspaceId, profile, row } = await ruleScope(input);
    await mutateMeta({ workspaceId, profile }, 'taxonomy_rule', { ...row, brandId: input.brandId, revision: input.revision }); return { saved: true };
  });
}
async function saveCategory(kind: 'cep' | 'intention', input: { brandId: number; key: string; label: string; description: string; revision: number }) {
  return result(async () => {
    const ctx = await taxonomyAccess(true); assertMetaBrand(ctx, String(input.brandId)); const { workspaceId, profile } = ctx;
    const config = await loadTaxonomy(workspaceId);
    const brand = config.brands.find(b => b.id === input.brandId);
    if (!brand || !Number.isInteger(input.revision) || input.revision < 0 || typeof input.label !== 'string'
      || !input.label.trim() || input.label.length > 100 || typeof input.description !== 'string' || input.description.length > 1000) throw new Error('Kategori tidak valid.');
    const existing = (kind === 'cep' ? config.catalog : config.intentions).find(c => c.brand_id === brand.id && c.key === input.key);
    if (input.revision > 0 && (!existing || existing.revision !== input.revision)) throw new Error('Kategori berubah. Muat ulang.');
    const key = input.revision === 0 ? newCepKey(brand.id, input.label) : existing!.key;
    await mutateMeta({ workspaceId, profile }, kind, { ...input, key, label: input.label.trim(), description: input.description.trim() });
    return { saved: true };
  });
}
type CategoryInput = { brandId: number; key: string; label: string; description: string; revision: number };
export async function saveMetaCepCategory(input: CategoryInput) { return saveCategory('cep', input); }
export async function saveMetaIntentionCategory(input: CategoryInput) { return saveCategory('intention', input); }
type StatusInput = { brandId: number; key: string; revision: number; active: boolean };
async function setCategoryActive(kind: 'cep_status' | 'intention_status', input: StatusInput) {
  return result(async () => {
    const ctx = await taxonomyAccess(true); assertMetaBrand(ctx, String(input.brandId));
    if (typeof input.active !== 'boolean' || !Number.isInteger(input.revision) || input.revision < 1) throw new Error('Status tidak valid.');
    await mutateMeta(ctx, kind, input); return { saved: true };
  });
}
export async function setMetaCepCategoryActive(input: StatusInput) { return setCategoryActive('cep_status', input); }
export async function setMetaIntentionCategoryActive(input: StatusInput) { return setCategoryActive('intention_status', input); }
