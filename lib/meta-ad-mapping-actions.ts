'use server';

import { requireDashboardPermissionAccess, requireDashboardTabAccess } from './dashboard-access';
import { createServiceSupabase } from './service-supabase';
import { isWorkspaceModuleEnabled } from './workspaces';
import { enqueueMetaAdMapping } from './meta-ad-mapping-queue';
import { loadVerifiedDestinations, loadAdDimensions, readAll } from './meta-funnel-store';
import { mappingUnit, type AdMapping, type MappingUnit } from './meta-ad-mapping';
import { dimensionOptions, validateDimensionFilters, type AdDimensionFilters } from './meta-ad-dimensions';
import { validateMetaAdChannel, type MetaAdChannel } from './meta-ad-channels';
import { validateRange } from './meta-funnel-domain';
import { completedMetaRange } from './meta-report-status';
import { getTodayWIB } from './sync-schedule';
import { applyMappingUnitBatch, buildWorklist, WORKLIST_ISSUES, type AdActivity, type DestinationHint, type WorklistIssue } from './meta-ad-worklist';

const MISSING_SCHEMA = ['42P01', 'PGRST205', '42883', 'PGRST202'];
async function access(manage = false) {
  const ctx = await requireDashboardTabAccess('marketing', 'Pemetaan Ads');
  if (!isWorkspaceModuleEnabled(ctx.workspace, 'meta-funnels')) throw new Error('Meta Ad Funnels tidak diaktifkan untuk workspace ini.');
  if (manage) {
    const admin = await requireDashboardPermissionAccess('admin:meta', 'Kelola pemetaan Meta');
    if (admin.workspaceId !== ctx.workspaceId) throw new Error('Workspace berubah. Muat ulang halaman.');
  }
  return ctx;
}
const MAPPING_FIELDS = 'account_id,ad_id,ad_name,creative_id,effective_status,landing_page_urls,auto_mapping,overrides,source,first_seen_at,last_seen_at,revision,ad_channel,ad_channel_reason';

/** Per-ad delivery in the range; absent until migration 217 is installed. */
async function loadActivity(svc: ReturnType<typeof createServiceSupabase>, workspaceId: string, from: string, to: string) {
  const result = await svc.rpc('get_meta_ad_activity', { p_workspace_id: workspaceId, p_from: from, p_to: to, p_account_id: null });
  if (result.error && MISSING_SCHEMA.includes(result.error.code)) return { ready: false, rows: [] as AdActivity[] };
  if (result.error) throw new Error(result.error.message);
  return { ready: true, rows: (Array.isArray(result.data) ? result.data : []).map((r: any) => ({ account_id: String(r.account_id), ad_id: String(r.ad_id), spend: Number(r.spend) || 0, impressions: Number(r.impressions) || 0, last_active: r.last_active || null })) };
}

export async function getMetaAdWorklist(input: { from: string; to: string; page?: number; search?: string; accountId?: string; filters?: AdDimensionFilters; channel?: unknown; issue?: unknown; includeInactive?: boolean } = { from: '', to: '' }) {
  const { workspaceId } = await access(); const svc = createServiceSupabase();
  const schema = await svc.from('meta_ad_mapping_channels').select('ad_id').eq('workspace_id', workspaceId).limit(1);
  if (schema.error && MISSING_SCHEMA.includes(schema.error.code)) return { ready: false as const };
  if (schema.error) throw new Error(schema.error.message);
  const today = getTodayWIB();
  const range = completedMetaRange(input.from && input.to ? { from: input.from, to: input.to } : { from: `${today.slice(0, 7)}-01`, to: today }, today);
  validateRange(range.from, range.to);
  const accounts = await svc.from('meta_ad_accounts').select('account_id,account_name').eq('workspace_id', workspaceId).eq('is_active', true).order('account_name');
  if (accounts.error) throw new Error(accounts.error.message);
  const ids = (accounts.data || []).map(a => a.account_id);
  if (input.accountId && !ids.includes(input.accountId)) throw new Error('Akun tidak tersedia di workspace ini.');
  const issue = input.issue === undefined || input.issue === null || input.issue === '' ? null : (WORKLIST_ISSUES as readonly string[]).includes(String(input.issue)) ? input.issue as WorklistIssue : null;
  if (input.issue && !issue) throw new Error('Jenis masalah tidak valid.');
  const channel: MetaAdChannel | null = input.channel ? validateMetaAdChannel(input.channel) : null;
  const filters = validateDimensionFilters(input.filters);
  const [mappings, dimensions, activity, verified, hints, units, state, jobs, pendingJobs] = await Promise.all([
    readAll<AdMapping>(svc, 'meta_ad_mapping_channels', `${MAPPING_FIELDS},campaign_id,campaign_name,campaign_objective`, workspaceId).catch(async e => {
      // Older schemas lack campaign columns on the view; fall back without them.
      if (/campaign/.test(String(e?.message))) return readAll<AdMapping>(svc, 'meta_ad_mapping_channels', MAPPING_FIELDS, workspaceId);
      throw e;
    }),
    loadAdDimensions(svc, workspaceId),
    loadActivity(svc, workspaceId, range.from, range.to),
    loadVerifiedDestinations(svc, workspaceId),
    readAll<{ account_id: string; ad_id: string; creative_id: string | null; classification: string | null; destination_type: string | null; urls: string[] | null }>(svc, 'meta_ad_destination_metadata', 'account_id,ad_id,creative_id,classification,destination_type:metadata->>destination_type,urls:metadata->urls', workspaceId)
      .catch(e => { if (MISSING_SCHEMA.includes(e?.code) || /meta_ad_destination_metadata/.test(String(e?.message))) return []; throw e; }),
    svc.from('meta_ad_mapping_units').select('dimension,unit_key,label,review_status,first_seen_at,last_seen_at').eq('workspace_id', workspaceId).eq('review_status', 'new').neq('dimension', 'keyword').order('dimension').order('unit_key').limit(200),
    svc.from('meta_ad_mapping_sync_state').select('account_id,last_inventory_at,ads_count').eq('workspace_id', workspaceId).in('account_id', ids),
    svc.from('sync_jobs').select('id,status,mode,error_message,created_at').eq('workspace_id', workspaceId).eq('job_name', 'meta_sync').contains('payload', { ad_mapping_only: true }).order('created_at', { ascending: false }).limit(10),
    svc.from('sync_jobs').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('job_name', 'meta_sync').contains('payload', { ad_mapping_only: true }).in('status', ['queued', 'running']),
  ]);
  for (const result of [units, state, jobs, pendingJobs]) if (result.error) throw new Error(result.error.message);
  const scopedMappings = mappings.filter(m => ids.includes(m.account_id));
  const destinations: DestinationHint[] = hints.map(h => ({ account_id: h.account_id, ad_id: h.ad_id, creative_id: h.creative_id, classification: h.classification, metadata: { destination_type: h.destination_type, urls: Array.isArray(h.urls) ? h.urls : [] } }));
  const list = buildWorklist({ mappings: scopedMappings, activity: activity.rows, verified: verified.rows, destinations, accounts: accounts.data || [], units: (units.data || []) as MappingUnit[],
    includeInactive: !activity.ready || !!input.includeInactive, issue, search: input.search?.slice(0, 200), accountId: input.accountId || null, channel, filters, page: input.page, pageSize: 50 });
  const scope = input.accountId ? [input.accountId] : ids;
  return { ready: true as const, ...list, range, activityReady: activity.ready, issue, channel, filters,
    dimensionsReady: dimensions.ready, dimensionOptions: dimensionOptions(dimensions.rows.filter(m => scope.includes(m.account_id))),
    newUnits: (units.data || []) as MappingUnit[], accounts: accounts.data || [], state: state.data || [], jobs: jobs.data || [], pendingJobs: pendingJobs.count || 0, totalAds: scopedMappings.length };
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
function overrideValue(dimension: 'cep' | 'intention', value: string) {
  if (value.length > 500) throw new Error('Nilai pemetaan maksimal 500 karakter.');
  return mappingUnit(dimension, value).key;
}
export async function saveMetaAdMappingOverrides(input: { accountId: string; adId: string; revision: number; cep: string; intention: string }) {
  const { workspaceId, profile } = await access(true);
  if (!/^act_\d+$/.test(input.accountId) || !/^\d+$/.test(input.adId) || !Number.isInteger(input.revision)) throw new Error('Identitas ad tidak valid.');
  const overrides: Record<string, string> = {};
  for (const dimension of ['cep', 'intention'] as const) if (input[dimension].trim()) overrides[dimension] = overrideValue(dimension, input[dimension]);
  const result = await createServiceSupabase().rpc('set_meta_ad_mapping_overrides', { p_workspace_id: workspaceId, p_account_id: input.accountId, p_ad_id: input.adId, p_overrides: overrides, p_user_id: profile.id, p_revision: input.revision });
  if (result.error) throw new Error(result.error.message);
}
/** Sets or clears one label on many ads. '' clears the manual value, undefined leaves it alone. */
export async function saveMetaAdMappingOverridesBulk(input: { ads: { accountId: string; adId: string }[]; cep?: string; intention?: string }) {
  const { workspaceId, profile } = await access(true);
  if (!Array.isArray(input.ads) || !input.ads.length || input.ads.length > 300) throw new Error('Pilih 1 sampai 300 ad.');
  if (input.ads.some(a => !/^act_\d+$/.test(a.accountId) || !/^\d+$/.test(a.adId))) throw new Error('Identitas ad tidak valid.');
  if (input.cep === undefined && input.intention === undefined) throw new Error('Pilih label yang ingin diubah.');
  const svc = createServiceSupabase();
  const failed: { adId: string; error: string }[] = []; let saved = 0;
  for (const target of input.ads) {
    try {
      const current = await svc.from('meta_ad_mappings').select('overrides,revision').eq('workspace_id', workspaceId).eq('account_id', target.accountId).eq('ad_id', target.adId).maybeSingle();
      if (current.error || !current.data) throw new Error('Ad tidak ditemukan.');
      const overrides: Record<string, string> = { ...(current.data.overrides || {}) };
      for (const dimension of ['cep', 'intention'] as const) {
        const value = input[dimension];
        if (value === undefined) continue;
        if (value.trim()) overrides[dimension] = overrideValue(dimension, value); else delete overrides[dimension];
      }
      const result = await svc.rpc('set_meta_ad_mapping_overrides', { p_workspace_id: workspaceId, p_account_id: target.accountId, p_ad_id: target.adId, p_overrides: overrides, p_user_id: profile.id, p_revision: current.data.revision });
      if (result.error) throw new Error(result.error.message);
      saved++;
    } catch (e) { failed.push({ adId: target.adId, error: e instanceof Error ? e.message : 'Gagal menyimpan.' }); }
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
  const targets = rows.filter(r => ids.has(r.account_id) && r.overrides?.[dimension] === undefined && r.auto_mapping?.tags?.some(t => t.dimension === dimension && t.key === input.unitKey))
    .map(r => ({ accountId: r.account_id, adId: r.ad_id }));
  return applyMappingUnitBatch(targets,
    ads => saveMetaAdMappingOverridesBulk({ ads, [dimension]: input.targetKey }),
    () => confirmMetaAdMappingUnit({ dimension, key: input.unitKey }));
}
