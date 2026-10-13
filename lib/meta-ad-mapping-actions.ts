'use server';

import { requireDashboardPermissionAccess, requireDashboardTabAccess } from './dashboard-access';
import { createServiceSupabase } from './service-supabase';
import { isWorkspaceModuleEnabled } from './workspaces';
import { enqueueMetaAdMapping } from './meta-ad-mapping-queue';
import { loadVerifiedDestinations, loadAdDimensions } from './meta-funnel-store';
import { mappingUnit, type AdMapping, type MappingUnit } from './meta-ad-mapping';
import { dimensionOptions, validateDimensionFilters, type AdDimensionFilters } from './meta-ad-dimensions';

async function access(manage = false) {
  const ctx = await requireDashboardTabAccess('marketing', 'Pemetaan Ads');
  if (!isWorkspaceModuleEnabled(ctx.workspace, 'meta-funnels')) throw new Error('Meta Ad Funnels tidak diaktifkan untuk workspace ini.');
  if (manage) {
    const admin = await requireDashboardPermissionAccess('admin:meta', 'Kelola pemetaan Meta');
    if (admin.workspaceId !== ctx.workspaceId) throw new Error('Workspace berubah. Muat ulang halaman.');
  }
  return ctx;
}
export async function getMetaAdMappingData(input: { page?: number; search?: string; accountId?: string; filters?: AdDimensionFilters } = {}) {
  const { workspaceId } = await access(); const svc = createServiceSupabase();
  const schema = await svc.from('meta_ad_mappings').select('ad_id').eq('workspace_id', workspaceId).limit(1);
  if (schema.error && ['42P01', 'PGRST205'].includes(schema.error.code)) return { ready: false as const };
  if (schema.error) throw new Error(schema.error.message);
  const accounts = await svc.from('meta_ad_accounts').select('account_id,account_name').eq('workspace_id', workspaceId).eq('is_active', true).order('account_name');
  if (accounts.error) throw new Error(accounts.error.message);
  const ids = (accounts.data || []).map(a => a.account_id);
  if (input.accountId && !ids.includes(input.accountId)) throw new Error('Akun tidak tersedia di workspace ini.');
  const scope = input.accountId ? [input.accountId] : ids;
  const dimensions = await loadAdDimensions(svc,workspaceId);
  const filters = validateDimensionFilters(input.filters);
  if (!dimensions.ready && Object.keys(filters).length) throw new Error('Pemetaan dimensi membutuhkan migration 202_meta_ad_campaign_dimensions.sql.');
  const page = Math.max(1, Math.floor(input.page || 1)); const size = 50;
  let query = svc.from('meta_ad_mappings').select(`account_id,ad_id,ad_name,creative_id,effective_status,landing_page_urls,auto_mapping,overrides,source,first_seen_at,last_seen_at,revision${dimensions.ready ? ',campaign_id,campaign_name,campaign_objective' : ''}`, { count: 'exact' }).eq('workspace_id', workspaceId).in('account_id', scope);
  for (const dimension of ['cep','intention','objective'] as const) {
    const value=filters[dimension]; if (!value) continue;
    const field=dimension === 'objective' ? 'campaign_objective' : `${dimension}_key`;
    query=value === '__unknown__' ? query.is(field,null) : query.eq(field,value);
  }
  if (input.search?.trim()) {
    // Literal substring search; PostgREST syntax and LIKE wildcards are escaped.
    const search = input.search.trim().slice(0, 200).replace(/[\\%_]/g, '\\$&');
    query = query.ilike('ad_name', `%${search}%`);
  }
  const [rows, total, units, newUnits, state, jobs, pendingJobs, verified] = await Promise.all([
    query.order('account_id').order('ad_id').range((page - 1) * size, page * size - 1),
    svc.from('meta_ad_mappings').select('ad_id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).in('account_id', ids),
    svc.from('meta_ad_mapping_units').select('dimension,unit_key,label,review_status,first_seen_at,last_seen_at').eq('workspace_id', workspaceId).eq('review_status', 'new').neq('dimension', 'keyword').order('dimension').order('unit_key').limit(200),
    svc.from('meta_ad_mapping_units').select('unit_key', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('review_status', 'new').neq('dimension', 'keyword'),
    svc.from('meta_ad_mapping_sync_state').select('account_id,last_inventory_at,ads_count').eq('workspace_id', workspaceId).in('account_id', ids),
    svc.from('sync_jobs').select('id,status,mode,error_message,created_at').eq('workspace_id', workspaceId).eq('job_name', 'meta_sync').contains('payload', { ad_mapping_only: true }).order('created_at', { ascending: false }).limit(10),
    svc.from('sync_jobs').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('job_name', 'meta_sync').contains('payload', { ad_mapping_only: true }).in('status', ['queued', 'running']),
    loadVerifiedDestinations(svc, workspaceId),
  ]);
  for (const result of [rows, total, units, newUnits, state, jobs, pendingJobs]) if (result.error) throw new Error(result.error.message);
  return { ready: true as const, rows: (rows.data || []) as unknown as AdMapping[], units: (units.data || []) as unknown as MappingUnit[],
    dimensionsReady:dimensions.ready, dimensionOptions:dimensionOptions(dimensions.rows.filter(m=>scope.includes(m.account_id))),
    totalAds: total.count || 0, newUnitCount: newUnits.count || 0, count: rows.count || 0, page, pageSize: size,
    accounts: accounts.data || [], state: state.data || [], jobs: jobs.data || [], pendingJobs: pendingJobs.count || 0, verified: verified.rows };
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
export async function saveMetaAdMappingOverrides(input: { accountId: string; adId: string; revision: number; cep: string; intention: string }) {
  const { workspaceId, profile } = await access(true);
  if (!/^act_\d+$/.test(input.accountId) || !/^\d+$/.test(input.adId) || !Number.isInteger(input.revision)) throw new Error('Identitas ad tidak valid.');
  const overrides: Record<string, string> = {};
  for (const dimension of ['cep', 'intention'] as const) {
    if (input[dimension].trim()) {
      if (input[dimension].length > 500) throw new Error('Nilai pemetaan maksimal 500 karakter.');
      overrides[dimension] = mappingUnit(dimension, input[dimension]).key;
    }
  }
  const result = await createServiceSupabase().rpc('set_meta_ad_mapping_overrides', { p_workspace_id: workspaceId, p_account_id: input.accountId, p_ad_id: input.adId, p_overrides: overrides, p_user_id: profile.id, p_revision: input.revision });
  if (result.error) throw new Error(result.error.message);
}
