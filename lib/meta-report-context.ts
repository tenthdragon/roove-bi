import { requireDashboardPermissionAccess, requireDashboardTabAccess } from './dashboard-access';
import { createServiceSupabase } from './service-supabase';
import { defaultFunnel, metaPerformanceMetrics, validateRange, type FunnelConfig } from './meta-funnel-domain';
import { loadFunnels } from './meta-funnel-store';
import { getTodayWIB } from './sync-schedule';
import { isWorkspaceModuleEnabled } from './workspaces';
import { validateMetaAdChannel } from './meta-ad-channels';
import { validateDimensionFilters } from './meta-ad-dimensions';
import { metaBrandAccountIds, metaBrandOptions, validateMetaBrandFilter } from './meta-ad-brands';
import { completedMetaRange } from './meta-report-status';
import type { MetaReportInput } from './meta-ad-report';
import { META_SYNC_JOB_FIELDS } from './meta-funnel-sync-status';

export function uuid(id: string) { if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('ID tidak valid.'); return id; }
export async function reportingAccess() {
  const ctx = await requireDashboardTabAccess('marketing', 'Marketing Channel');
  if (!isWorkspaceModuleEnabled(ctx.workspace, 'meta-funnels')) throw new Error('Meta Ad Funnels tidak diaktifkan untuk workspace ini.');
  return ctx;
}
export async function manageAccess() {
  const ctx = await reportingAccess();
  const manage = await requireDashboardPermissionAccess('admin:meta', 'Kelola funnel Meta');
  if (manage.workspaceId !== ctx.workspaceId) throw new Error('Workspace berubah. Muat ulang halaman.');
  return ctx;
}
export const currencyError = 'Funnel mencakup beberapa mata uang. Pilih akun dengan mata uang yang sama pada konfigurasi.';
export function reportJobs(svc: ReturnType<typeof createServiceSupabase>, workspaceId: string) {
  return svc.from('sync_jobs').select(META_SYNC_JOB_FIELDS).eq('workspace_id', workspaceId)
    .eq('job_name', 'meta_sync').in('mode', ['cron', 'incremental', 'ad_funnels']).order('created_at', { ascending: false }).limit(20);
}
export async function reportContext(input: MetaReportInput, includeJobs = false) {
  const { workspaceId } = await reportingAccess();
  validateRange(input.from, input.to);
  if (input.groupBy !== undefined && !['ad', 'landing_page'].includes(input.groupBy)) throw new Error('Tampilan agregasi tidak valid.');
  if (input.groupKey !== undefined && (typeof input.groupKey !== 'string' || input.groupKey.length > 50000)) throw new Error('Pilihan breakdown tidak valid.');
  if (input.funnelId !== undefined && input.funnelId !== '') uuid(input.funnelId);
  const channel = validateMetaAdChannel(input.channel);
  const reportRange = completedMetaRange(input, getTodayWIB());
  const filters = validateDimensionFilters(input.filters), brandId = validateMetaBrandFilter(input.brandId);
  const svc = createServiceSupabase();
  const [version, funnels, accountsResult, brandsResult, jobsResult, channelSchema] = await Promise.all([
    svc.from('meta_ad_report_versions').select('revision').eq('workspace_id', workspaceId).maybeSingle(),
    loadFunnels(svc, workspaceId).then(saved => saved.filter(f => f.group_by === 'landing_page')),
    svc.from('meta_ad_accounts').select('account_id,account_name,default_brand_id').eq('workspace_id', workspaceId).eq('is_active', true).order('account_name'),
    svc.from('brands').select('id,name').eq('workspace_id', workspaceId).order('name'),
    includeJobs ? reportJobs(svc, workspaceId) : Promise.resolve({ data: [], error: null }),
    svc.from('meta_ad_mapping_channels').select('ad_channel').eq('workspace_id', workspaceId).limit(1),
  ]);
  if ([version, channelSchema].some(r => r.error && ['42P01', 'PGRST205'].includes(r.error.code))) return { schemaReady: false as const };
  for (const result of [version, accountsResult, brandsResult, jobsResult, channelSchema]) if (result.error) throw new Error(result.error.message);
  const accounts = accountsResult.data || [], brands = brandsResult.data || [];
  if (brandId && !metaBrandOptions(accounts, brands, []).choices.some(b => b.value === brandId)) throw new Error('Brand tidak tersedia pada akun Meta workspace ini.');
  // A template is applied only when explicitly selected: its stages and metrics
  // then drive the report. Without one, the report covers every active account
  // with the standard performance columns.
  const selected = input.funnelId ? funnels.find(f => f.id === input.funnelId) || null : null;
  const config: FunnelConfig = { ...(selected || { ...defaultFunnel(), metrics: metaPerformanceMetrics() }), group_by: input.groupBy === 'ad' ? 'ad_id' : 'landing_page' };
  const configuredAccounts = accounts.filter(a => !config.account_ids.length || config.account_ids.includes(a.account_id));
  return { schemaReady: true as const, workspaceId, reportVersion: String(version.data?.revision || 0), reportRange, filters, brandId, channel,
    funnels, selectedId: selected?.id || null, config, accounts, configuredAccounts, brands,
    scopedAccountIds: metaBrandAccountIds(configuredAccounts, brands, brandId), jobs: jobsResult.data || [],
    input: { ...input, ...reportRange, filters, brandId, channel } };
}
