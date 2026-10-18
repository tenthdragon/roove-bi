'use server';
import { createServiceSupabase } from './service-supabase';
import { taxonomyAccess, loadTaxonomy } from './meta-taxonomy-store';
import { mappingUnit } from './meta-ad-mapping';
import { newCepKey, validateCepSelection, validateIntention } from './meta-ad-taxonomy';
import { validateRange } from './meta-funnel-domain';
import { getTodayWIB } from './sync-schedule';
import { shiftDay } from './meta-funnel-domain';
type RuleInput = { brandId: number; dimension: 'cep' | 'intention'; raw: string; ceps: string[]; intention: string; revision: number };
async function result<T>(work: () => Promise<T>) {
  try { return { data: await work() }; }
  catch (error) { console.error('[meta-taxonomy]', error); return { error: 'Perubahan belum tersimpan. Periksa kategori, izin akses, dan versi data; lalu muat ulang.' }; }
}
export async function getMetaTaxonomyConfiguration() {
  return result(async () => { const { workspaceId } = await taxonomyAccess(); return loadTaxonomy(workspaceId); });
}
async function ruleScope(input: RuleInput) {
  const { workspaceId, profile } = await taxonomyAccess(true); const config = await loadTaxonomy(workspaceId);
  if (!config.brands.some(b => b.id === input.brandId) || !['cep', 'intention'].includes(input.dimension) || typeof input.raw !== 'string' || !input.raw.trim() || input.raw.length > 500 || !Number.isInteger(input.revision)) throw new Error('Aturan tidak valid.');
  const raw_key = mappingUnit(input.dimension, input.raw).key;
  const ceps = input.dimension === 'cep' ? validateCepSelection(input.ceps, input.brandId, config.catalog, config.rules.find(r => r.brand_id === input.brandId && r.dimension === input.dimension && r.raw_key === raw_key)?.cep_keys || []) : [];
  if (input.dimension === 'cep' && !ceps.length) throw new Error('Pilih setidaknya satu CEP.');
  const intention_key = input.dimension === 'intention' ? validateIntention(input.intention) : null;
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
    const { workspaceId, profile, row } = await ruleScope(input); const svc = createServiceSupabase();
    const record = { ...row, workspace_id: workspaceId, updated_by: profile.id, updated_at: new Date().toISOString(), revision: input.revision + 1 };
    const r = input.revision === 0 ? await svc.from('meta_ad_taxonomy_rules').insert(record).select('revision').single()
      : await svc.from('meta_ad_taxonomy_rules').update(record).eq('workspace_id', workspaceId).eq('brand_id', row.brand_id).eq('dimension', row.dimension).eq('raw_key', row.raw_key).eq('revision', input.revision).select('revision').single();
    if (r.error) throw new Error('Aturan berubah. Muat ulang sebelum menyimpan.');return { saved: true };
  });
}
export async function saveMetaCepCategory(input: { brandId: number; key: string; label: string; description: string; revision: number }) {
  return result(async () => {
    const { workspaceId, profile } = await taxonomyAccess(true);
    const config = await loadTaxonomy(workspaceId);
    const brand = config.brands.find(b => b.id === input.brandId);
    if (!brand || !Number.isInteger(input.revision) || input.revision < 0 || typeof input.label !== 'string'
      || !input.label.trim() || input.label.length > 100 || typeof input.description !== 'string' || input.description.length > 1000) throw new Error('Kategori tidak valid.');
    const existing = config.catalog.find(c => c.brand_id === brand.id && c.key === input.key);
    if (input.revision > 0 && (!existing || existing.revision !== input.revision)) throw new Error('Kategori berubah. Muat ulang.');
    const key = input.revision === 0 ? newCepKey(brand.id, input.label) : existing!.key;
    const record = {
      workspace_id: workspaceId, brand_id: brand.id, key, label: input.label.trim(), description: input.description.trim(),
      revision: input.revision + 1, updated_by: profile.id, updated_at: new Date().toISOString(),
    };
    const svc = createServiceSupabase();
    const r = input.revision === 0
      ? await svc.from('meta_ad_cep_catalog').insert(record).select('key').single()
      : await svc.from('meta_ad_cep_catalog').update(record).eq('workspace_id', workspaceId).eq('brand_id', brand.id).eq('key', key).eq('revision', input.revision).select('key').single();
    if (r.error) throw new Error(r.error.message);
    return { saved: true };
  });
}
export async function setMetaCepCategoryActive(input: { brandId: number; key: string; revision: number; active: boolean }) {
  return result(async () => {
    const { workspaceId, profile } = await taxonomyAccess(true);
    if (typeof input.active !== 'boolean' || !Number.isInteger(input.revision) || input.revision < 1) throw new Error('Status tidak valid.');
    const r = await createServiceSupabase().from('meta_ad_cep_catalog')
      .update({ is_active: input.active, revision: input.revision + 1, updated_by: profile.id, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('brand_id', input.brandId).eq('key', input.key).eq('revision', input.revision).select('key').single();
    if (r.error) throw new Error('Kategori berubah atau tidak ditemukan. Muat ulang.');
    return { saved: true };
  });
}
