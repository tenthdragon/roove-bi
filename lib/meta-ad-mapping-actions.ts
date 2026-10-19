'use server';

import { requireDashboardPermissionAccess } from './dashboard-access';
import { reportingAccess } from './meta-report-context';
import { scopeMetaAccounts, scopeMetaBrands, type MetaBrandScope } from './meta-brand-access';
import { createServiceSupabase } from './service-supabase';
import { loadTaxonomy } from './meta-taxonomy-store';
import { validateCepSelection, validateIntention, type MappingOverrides } from './meta-ad-taxonomy';
import { enqueueMetaAdMapping } from './meta-ad-mapping-queue';
import { readAll } from './meta-funnel-store';
import { mappingUnit, type AdMapping, type MappingUnit } from './meta-ad-mapping';
import { dimensionOptions, validateDimensionFilters, type AdDimensionFilters, type AdDimensions } from './meta-ad-dimensions';
import { validateMetaAdChannel, type MetaAdChannel } from './meta-ad-channels';
import { validateRange } from './meta-funnel-domain';
import { completedMetaRange } from './meta-report-status';
import { getTodayWIB } from './sync-schedule';
import { getMetaWorklistInventory, getMetaWorklistActivity } from './meta-worklist-data';
import { metaReportResponse } from './meta-report-requests';
import { applyMappingUnitBatch, buildWorklist, WORKLIST_ISSUES, type WorklistIssue } from './meta-ad-worklist';

async function access(manage = false) {
  const ctx = await reportingAccess();
  if (manage) {
    if (ctx.brandIds !== null) throw new Error('Pengaturan Meta hanya dapat diubah oleh pengelola workspace.');
    const admin = await requireDashboardPermissionAccess('admin:meta', 'Kelola pemetaan Meta');
    if (admin.workspaceId !== ctx.workspaceId) throw new Error('Workspace berubah. Muat ulang halaman.');
  }
  return ctx;
}
async function mappingStatus(workspaceId: string, scope: MetaBrandScope) {
  if (scope.brandIds !== null) {
    const result = scope.accountIds!.length ? await createServiceSupabase().from('meta_ad_mapping_sync_state').select('account_id,last_inventory_at,ads_count').eq('workspace_id', workspaceId).in('account_id', scope.accountIds!) : { data: [], error: null };
    if (result.error) throw new Error(result.error.message);
    return { state: result.data || [], jobs: [], pendingJobs: 0 };
  }
  const svc = createServiceSupabase();
  const [accounts, state, jobs, pending] = await Promise.all([
    svc.from('meta_ad_accounts').select('account_id').eq('workspace_id', workspaceId).eq('is_active', true),
    svc.from('meta_ad_mapping_sync_state').select('account_id,last_inventory_at,ads_count').eq('workspace_id', workspaceId),
    svc.from('sync_jobs').select('id,status,mode,error_message,created_at').eq('workspace_id', workspaceId).eq('job_name', 'meta_sync').contains('payload', { ad_mapping_only: true }).order('created_at', { ascending: false }).limit(10),
    svc.from('sync_jobs').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('job_name', 'meta_sync').contains('payload', { ad_mapping_only: true }).in('status', ['queued', 'running']),
  ]);
  for (const r of [accounts, state, jobs, pending]) if (r.error) throw new Error(r.error.message);
  const ids = new Set((accounts.data || []).map(a => a.account_id));
  return { state: (state.data || []).filter(s => ids.has(s.account_id)), jobs: jobs.data || [], pendingJobs: pending.count || 0 };
}
async function mappingRevision(workspaceId: string) {
  const result = await createServiceSupabase().from('meta_ad_report_versions').select('revision').eq('workspace_id', workspaceId).maybeSingle();
  if (result.error) throw new Error(result.error.message);
  return String(result.data?.revision || 0);
}
/** Poll status/revision without rereading or rebuilding the entire worklist. */
export async function getMetaAdMappingStatus() {
  const scope = await access(); const { workspaceId } = scope;
  const [reportVersion, status] = await Promise.all([mappingRevision(workspaceId), mappingStatus(workspaceId, scope)]);
  return { workspaceId, reportVersion, ...status };
}
export type MetaWorklistInput = { from: string; to: string; workspaceId?: string; page?: number; search?: string; accountId?: string; filters?: AdDimensionFilters; channel?: unknown; issue?: unknown; includeInactive?: boolean };
export async function getMetaAdWorklist(input: MetaWorklistInput = { from: '', to: '' }) {
  return metaReportResponse(() => loadMetaAdWorklist(input));
}
async function loadMetaAdWorklist(input: MetaWorklistInput) {
  const scopeAccess = await access(); const { workspaceId } = scopeAccess;
  if (input.workspaceId && input.workspaceId !== workspaceId) throw new Error('Workspace berubah. Muat ulang halaman.');
  const today = getTodayWIB();
  const range = completedMetaRange(input.from && input.to ? { from: input.from, to: input.to } : { from: `${today.slice(0, 7)}-01`, to: today }, today);
  validateRange(range.from, range.to);
  const issue = input.issue === undefined || input.issue === null || input.issue === '' ? null : (WORKLIST_ISSUES as readonly string[]).includes(String(input.issue)) ? input.issue as WorklistIssue : null;
  if (input.issue && !issue) throw new Error('Jenis masalah tidak valid.');
  const channel: MetaAdChannel | null = input.channel ? validateMetaAdChannel(input.channel) : null;
  const filters = validateDimensionFilters(input.filters);
  const reportVersion = await mappingRevision(workspaceId);
  const svc = createServiceSupabase();
  const [inventory, activity, status, units] = await Promise.all([
    getMetaWorklistInventory(workspaceId, reportVersion), getMetaWorklistActivity(workspaceId, reportVersion, range.from, range.to),
    mappingStatus(workspaceId, scopeAccess),
    svc.from('meta_ad_mapping_units').select('dimension,unit_key,label,review_status,first_seen_at,last_seen_at').eq('workspace_id', workspaceId).eq('review_status', 'new').neq('dimension', 'keyword').order('dimension').order('unit_key').limit(200),
  ]);
  if (!inventory.ready) return { ready: false as const };
  if (units.error) throw new Error(units.error.message);
  const accounts = scopeMetaAccounts(inventory.accounts, scopeAccess);
  const mappings = scopeMetaAccounts(inventory.mappings, scopeAccess);
  const taxonomy = { ...inventory.taxonomy, brands: scopeMetaBrands(inventory.taxonomy.brands, scopeAccess),
    catalog: inventory.taxonomy.catalog.filter(c => scopeAccess.brandIds === null || scopeAccess.brandIds.includes(c.brand_id)) };
  // Global vocabulary timestamps/counts must not reveal another brand's ads.
  const visibleUnits = scopeAccess.brandIds === null ? (units.data || []) as MappingUnit[] : [];
  const ids = accounts.map(a => a.account_id);
  if (input.accountId && !ids.includes(input.accountId)) throw new Error('Akun tidak tersedia di workspace ini.');
  // The classification rows already contain every dimension. Reading the same
  // view again used to resolve taxonomy and paginate the inventory twice.
  const dimensions: AdDimensions[] = mappings.map(m => ({ account_id: m.account_id, ad_id: m.ad_id, brand_id: m.brand_id, cep_keys: m.cep_keys,
    cep_key: m.cep_keys?.[0] || null, intention_key: m.intention_key || null, campaign_id: m.campaign_id || null, campaign_name: m.campaign_name || null, campaign_objective: m.campaign_objective || null }));
  const list = buildWorklist({ mappings, activity: scopeMetaAccounts(activity.rows, scopeAccess), verified: scopeMetaAccounts(inventory.verified, scopeAccess), destinations: scopeMetaAccounts(inventory.destinations, scopeAccess), catalog: taxonomy.catalog, accounts, units: visibleUnits,
    includeInactive: !activity.ready || !!input.includeInactive, issue, search: input.search?.slice(0, 200), accountId: input.accountId || null, channel, filters, page: input.page, pageSize: 50 });
  const scope = new Set(input.accountId ? [input.accountId] : ids);
  const delivered = new Set(activity.rows.filter(a => a.impressions > 0).map(a => `${a.account_id}:${a.ad_id}`));
  const candidates = new Set(mappings.filter(m => scope.has(m.account_id) && (!channel || m.ad_channel === channel) && (input.includeInactive || delivered.has(`${m.account_id}:${m.ad_id}`))).map(m => `${m.account_id}:${m.ad_id}`));
  return { ready: true as const, workspaceId, reportVersion, ...list, catalog: taxonomy.catalog, brands: taxonomy.brands, range, activityReady: activity.ready, issue, channel, filters,
    dimensionsReady: mappings.every(m => 'campaign_id' in m), dimensionOptions: dimensionOptions(dimensions.filter(m => scope.has(m.account_id)), dimensions.filter(m => candidates.has(`${m.account_id}:${m.ad_id}`)), filters, taxonomy.catalog.filter(c => accounts.some(a => scope.has(a.account_id) && a.default_brand_id === c.brand_id))),
    newUnits: visibleUnits, accounts, ...status, totalAds: mappings.length };
}
export async function queueMetaAdMappingSync() {
  const { workspaceId, profile } = await access(true);
  const accounts = await createServiceSupabase().from('meta_ad_accounts').select('account_id').eq('workspace_id', workspaceId).eq('is_active', true);
  if (accounts.error) throw new Error(accounts.error.message);
  if (!accounts.data?.length) throw new Error('Belum ada akun Meta aktif.');
  return { jobs: await enqueueMetaAdMapping(workspaceId, accounts.data.map(a => a.account_id), profile.id) };
}
export async function confirmMetaAdMappingUnit(input: { dimension: string; key: string }) {
  const { workspaceId, profile } = await access(true);
  const result = await createServiceSupabase().from('meta_ad_mapping_units').update({ review_status: 'confirmed', reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId).eq('dimension', input.dimension).eq('unit_key', input.key).select('unit_key').maybeSingle();
  if (result.error || !result.data) throw new Error('Unit pemetaan tidak ditemukan.');
}
type OverridePatch = { ceps?: string[] | null; cep?: string; intention?: string | null };
async function overrideScope(workspaceId: string) {
  const [taxonomy, accounts] = await Promise.all([loadTaxonomy(workspaceId, false), createServiceSupabase().from('meta_ad_accounts').select('account_id,default_brand_id').eq('workspace_id', workspaceId).eq('is_active', true)]);
  if (accounts.error) throw new Error('Akun belum berhasil dimuat.');return { taxonomy, accounts: accounts.data || [] };
}
async function writeOverride(workspaceId: string, userId: string, target: { accountId: string; adId: string; revision: number }, patch: OverridePatch, scope: Awaited<ReturnType<typeof overrideScope>>, snapshot?: { overrides: MappingOverrides; revision: number; cep_keys: string[] }) {
  if (!/^act_\d+$/.test(target.accountId) || !/^\d+$/.test(target.adId) || !Number.isInteger(target.revision)) throw new Error('Identitas ad tidak valid.');
  const svc = createServiceSupabase();
  const current = snapshot ? { data: snapshot, error: null } : await svc.from('meta_ad_classifications').select('overrides,revision,cep_keys').eq('workspace_id', workspaceId).eq('account_id', target.accountId).eq('ad_id', target.adId).single();
  const account = scope.accounts.find(a => a.account_id === target.accountId);
  if (current.error || !current.data || !account || current.data.revision !== target.revision) throw new Error('Ad berubah atau tidak tersedia. Muat ulang.');
  const overrides: MappingOverrides = { ...(current.data.overrides || {}) };
  if (patch.ceps !== undefined || patch.cep !== undefined) {
    delete overrides.cep;delete overrides.ceps;
    const values = patch.ceps !== undefined ? patch.ceps : patch.cep ? [mappingUnit('cep', patch.cep).key] : null;
    if (values !== null) overrides.ceps = validateCepSelection(values, account.default_brand_id, scope.taxonomy.catalog, current.data.cep_keys);
  }
  if (patch.intention !== undefined) { delete overrides.intention; if (patch.intention) overrides.intention = validateIntention(patch.intention); }
  const r = await svc.rpc('set_meta_ad_mapping_overrides', { p_workspace_id: workspaceId, p_account_id: target.accountId, p_ad_id: target.adId, p_overrides: overrides, p_user_id: userId, p_revision: target.revision });
  if (r.error) throw new Error('Pemetaan belum tersimpan. Pilih kategori resmi dan muat ulang jika ad berubah.');
}
export async function saveMetaAdMappingOverrides(input: { accountId: string; adId: string; revision: number } & OverridePatch) {
  try { const { workspaceId, profile } = await access(true);await writeOverride(workspaceId, profile.id, input, input, await overrideScope(workspaceId));return { saved: true as const }; }
  catch (error) { console.error('[meta-ad-mapping] Save failed', error);return { error: 'Pemetaan belum tersimpan. Periksa pilihan kategori dan muat ulang jika data atau izin berubah.' }; }
}
export async function saveMetaAdMappingOverridesBulk(input: { ads: { accountId: string; adId: string }[] } & OverridePatch) {
  const { workspaceId, profile } = await access(true);
  if (!Array.isArray(input.ads) || !input.ads.length || input.ads.length > 300) throw new Error('Pilih 1 sampai 300 ad.');
  if (input.ceps === undefined && input.cep === undefined && input.intention === undefined) throw new Error('Pilih dimensi yang diubah.');
  const scope = await overrideScope(workspaceId);
  const failed: { adId: string; error: string }[] = [];let saved = 0;
  for (const target of input.ads) {
    try {
      const current = await createServiceSupabase().from('meta_ad_classifications').select('overrides,revision,cep_keys').eq('workspace_id', workspaceId).eq('account_id', target.accountId).eq('ad_id', target.adId).single();
      if (current.error) throw new Error('Ad tidak ditemukan.');
      await writeOverride(workspaceId, profile.id, { ...target, revision: current.data.revision }, input, scope, current.data);saved++;
    } catch (error) { failed.push({ adId: target.adId, error: error instanceof Error ? error.message : 'Gagal menyimpan.' }); }
  }
  return { saved, failed };
}
/** Maps every ad that still relies on a new bracket term to a chosen key, then marks the term reviewed. */
export async function applyMetaAdMappingUnit(input: { dimension: string; unitKey: string; targetKey: string }) {
  const { workspaceId } = await access(true);
  if (input.dimension !== 'cep' && input.dimension !== 'intention') throw new Error('Dimensi tidak valid.');
  if (typeof input.unitKey !== 'string' || !input.unitKey || typeof input.targetKey !== 'string' || !input.targetKey.trim()) throw new Error('Istilah atau tujuan pemetaan kosong.');
  const dimension = input.dimension;
  const svc = createServiceSupabase();
  const accounts = await svc.from('meta_ad_accounts').select('account_id').eq('workspace_id', workspaceId).eq('is_active', true);
  if (accounts.error) throw new Error(accounts.error.message);
  const ids = new Set((accounts.data || []).map(a => a.account_id));
  const rows = await readAll<Pick<AdMapping, 'account_id' | 'ad_id' | 'auto_mapping' | 'overrides'>>(svc, 'meta_ad_mappings', 'account_id,ad_id,auto_mapping,overrides', workspaceId);
  const targets = rows.filter(r => ids.has(r.account_id) && r.overrides?.[dimension] === undefined && (dimension !== 'cep' || r.overrides?.ceps === undefined) && r.auto_mapping?.tags?.some(t => t.dimension === dimension && t.key === input.unitKey))
    .map(r => ({ accountId: r.account_id, adId: r.ad_id }));
  return applyMappingUnitBatch(targets,
    ads => saveMetaAdMappingOverridesBulk({ ads, [dimension]: input.targetKey }),
    () => confirmMetaAdMappingUnit({ dimension, key: input.unitKey }));
}
