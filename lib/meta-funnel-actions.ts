'use server';

import { requireDashboardPermissionAccess, requireDashboardTabAccess } from './dashboard-access';
import { createServiceSupabase } from './service-supabase';
import { defaultFunnel, daysBetween, hasCoverage, shiftDay, emptyTotals, validateFunnel, validateRange, type FunnelConfig } from './meta-funnel-domain';
import { evaluateWorkspaceAlerts, loadFunnels } from './meta-funnel-store';
import { enqueueMetaAdBatches } from './meta-funnel-sync-queue';
import { getTodayWIB } from './sync-schedule';
import { isWorkspaceModuleEnabled } from './workspaces';
import { canonicalLandingPage } from './meta-ad-destinations';
import { validateDimensionFilters } from './meta-ad-dimensions';
import { metaBrandAccountIds, metaBrandOptions, validateMetaBrandFilter } from './meta-ad-brands';
import { completedMetaRange, metaCoverageGaps } from './meta-report-status';

import { metaReportQuery, metaReportGroups, metaReportOptions, metaReportHistory, type MetaReportInput } from './meta-ad-report';
import { getCachedMetaAdReport } from './meta-ad-report-data';

function uuid(id: string) { if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('ID tidak valid.'); return id; }
async function reportingAccess() {
  const ctx = await requireDashboardTabAccess('marketing', 'Marketing Channel');
  if (!isWorkspaceModuleEnabled(ctx.workspace, 'meta-funnels')) throw new Error('Meta Ad Funnels tidak diaktifkan untuk workspace ini.');
  return ctx;
}
async function manageAccess() {
  const ctx = await reportingAccess();
  const manage = await requireDashboardPermissionAccess('admin:meta', 'Kelola funnel Meta');
  if (manage.workspaceId !== ctx.workspaceId) throw new Error('Workspace berubah. Muat ulang halaman.');
  return ctx;
}
async function reportContext(input: MetaReportInput, includeJobs = false) {
  const { workspaceId } = await reportingAccess();
  validateRange(input.from, input.to);
  if (input.groupBy !== undefined && !['ad', 'landing_page'].includes(input.groupBy)) throw new Error('Tampilan agregasi tidak valid.');
  if (input.groupKey !== undefined && (typeof input.groupKey !== 'string' || input.groupKey.length > 50000)) throw new Error('Pilihan breakdown tidak valid.');
  const reportRange = completedMetaRange(input, getTodayWIB());
  const filters = validateDimensionFilters(input.filters), brandId = validateMetaBrandFilter(input.brandId);
  const svc = createServiceSupabase();
  const [version, funnels, accountsResult, brandsResult, jobsResult] = await Promise.all([
    svc.from('meta_ad_report_versions').select('revision').eq('workspace_id', workspaceId).maybeSingle(),
    loadFunnels(svc, workspaceId).then(saved => saved.filter(f => f.group_by === 'landing_page')),
    svc.from('meta_ad_accounts').select('account_id,account_name,default_brand_id').eq('workspace_id', workspaceId).eq('is_active', true).order('account_name'),
    svc.from('brands').select('id,name').eq('workspace_id', workspaceId).order('name'),
    includeJobs ? reportJobs(svc, workspaceId) : Promise.resolve({ data: [], error: null }),
  ]);
  if (version.error && ['42P01', 'PGRST205'].includes(version.error.code)) return { schemaReady: false as const };
  for (const result of [version, accountsResult, brandsResult, jobsResult]) if (result.error) throw new Error(result.error.message);
  const accounts = accountsResult.data || [], brands = brandsResult.data || [];
  if (brandId && !metaBrandOptions(accounts, brands, []).choices.some(b => b.value === brandId)) throw new Error('Brand tidak tersedia pada akun Meta workspace ini.');
  const selected = funnels.find(f => f.id === input.funnelId) || funnels[0] || null;
  const config: FunnelConfig = { ...(selected || defaultFunnel()), group_by: input.groupBy === 'ad' ? 'ad_id' : 'landing_page' };
  const configuredAccounts = accounts.filter(a => !config.account_ids.length || config.account_ids.includes(a.account_id));
  return { schemaReady: true as const, workspaceId, reportVersion: String(version.data?.revision || 0), reportRange, filters, brandId,
    funnels, selectedId: selected?.id || null, config, accounts, configuredAccounts, brands,
    scopedAccountIds: metaBrandAccountIds(configuredAccounts, brands, brandId), jobs: jobsResult.data || [],
    input: { ...input, ...reportRange, filters, brandId } };
}
function reportJobs(svc: ReturnType<typeof createServiceSupabase>, workspaceId: string) {
  return svc.from('sync_jobs').select('id,status,error_message,created_at,payload').eq('workspace_id', workspaceId)
    .eq('job_name', 'meta_sync').contains('payload', { ad_funnels_only: true }).order('created_at', { ascending: false }).limit(20);
}
const currencyError = 'Funnel mencakup beberapa mata uang. Pilih akun dengan mata uang yang sama pada konfigurasi.';
export async function getMetaFunnelData(input: MetaReportInput) {
  const ctx = await reportContext(input, true);
  if (!ctx.schemaReady) return ctx;
  const raw = await getCachedMetaAdReport(ctx.workspaceId, ctx.reportVersion, metaReportQuery(ctx.input, ctx.config));
  const { from, to } = ctx.reportRange;
  const prevFrom = shiftDay(from, -daysBetween(from, to)), reportingError = raw.currencies.length > 1 ? currencyError : null;
  return { schemaReady: true as const, funnels: ctx.funnels, selectedId: ctx.selectedId, config: ctx.config, accounts: ctx.accounts,
    scopedAccountIds: ctx.scopedAccountIds, brandId: ctx.brandId, reportRange: ctx.reportRange, reportVersion: ctx.reportVersion,
    ...metaReportOptions(raw, ctx.configuredAccounts, ctx.brands), dimensionsReady: true, filters: ctx.filters,
    matchingAds: raw.matchingAds, objectiveUnknownAds: raw.objectiveUnknownAds,
    coverageGaps: metaCoverageGaps(raw.coverage, ctx.scopedAccountIds, ctx.reportRange),
    groups: reportingError ? [] : metaReportGroups(raw, ctx.config), summary: reportingError ? emptyTotals() : raw.summary,
    previous: reportingError ? emptyTotals() : raw.previous, reportingError, currency: raw.currencies[0] || 'IDR',
    destinations: raw.destinations, verifiedDestinationsReady: true,
    currentComplete: hasCoverage(raw.coverage, ctx.scopedAccountIds, from, to),
    baselineComplete: hasCoverage(raw.coverage, ctx.scopedAccountIds, prevFrom, shiftDay(from, -1)),
    prevFrom, prevTo: shiftDay(from, -1), jobs: ctx.jobs };
}
export async function getMetaFunnelHistory(input: MetaReportInput & { view: 'daily' | 'trends'; period?: 'weekly' | 'monthly' }) {
  if (!['daily', 'trends'].includes(input.view) || input.period !== undefined && !['weekly', 'monthly'].includes(input.period)) throw new Error('Periode histori tidak valid.');
  const ctx = await reportContext(input);
  if (!ctx.schemaReady) return ctx;
  const raw = await getCachedMetaAdReport(ctx.workspaceId, ctx.reportVersion, metaReportQuery(ctx.input, ctx.config, input.view, input.period === 'monthly' ? 'month' : 'week'));
  return { schemaReady: true as const, history: metaReportHistory(raw, ctx.config, input.view), complete: raw.historyComplete,
    reportVersion: ctx.reportVersion, reportingError: raw.currencies.length > 1 ? currencyError : null };
}
export async function getMetaFunnelCreatives(input: MetaReportInput) {
  if (!input.groupKey) throw new Error('Pilih ad atau landing page terlebih dahulu.');
  const ctx = await reportContext(input);
  if (!ctx.schemaReady) return ctx;
  const raw = await getCachedMetaAdReport(ctx.workspaceId, ctx.reportVersion, metaReportQuery(ctx.input, ctx.config, 'creatives'));
  return { schemaReady: true as const, creatives: raw.creatives, reportVersion: ctx.reportVersion };
}
export async function getMetaFunnelSyncStatus() {
  const { workspaceId } = await reportingAccess();
  const svc = createServiceSupabase();
  const [version, jobs] = await Promise.all([
    svc.from('meta_ad_report_versions').select('revision').eq('workspace_id', workspaceId).maybeSingle(), reportJobs(svc, workspaceId),
  ]);
  if (version.error || jobs.error) throw new Error(version.error?.message || jobs.error?.message);
  return { reportVersion: String(version.data?.revision || 0), jobs: jobs.data || [] };
}
export async function getMetaFunnelNotifications() {
  const { workspaceId, profile } = await reportingAccess();
  const svc = createServiceSupabase();
  const [alerts, reads] = await Promise.all([
    svc.from('meta_funnel_alerts').select('id,funnel_id,payload,created_at,period_end,meta_ad_funnels!inner(archived,config)').eq('workspace_id', workspaceId)
      .eq('meta_ad_funnels.archived', false).eq('meta_ad_funnels.config->>group_by', 'landing_page').order('period_end', { ascending: false }).order('created_at', { ascending: false }).limit(100),
    svc.from('meta_funnel_alert_reads').select('alert_id').eq('workspace_id', workspaceId).eq('user_id', profile.id),
  ]);
  if ([alerts.error, reads.error].some(error => error && ['42P01', 'PGRST205'].includes(error.code))) return { schemaReady: false as const };
  if (alerts.error || reads.error) throw new Error(alerts.error?.message || reads.error?.message);
  const readIds = new Set((reads.data || []).map(row => row.alert_id));
  return { schemaReady: true as const, alerts: (alerts.data || []).map(alert => ({ ...alert, read: readIds.has(alert.id) })) };
}
export async function getMetaFunnelNotificationCount() {
  const { workspaceId, profile } = await reportingAccess();
  const svc = createServiceSupabase();
  const alerts = await svc.from('meta_funnel_alerts').select('id,meta_ad_funnels!inner(archived,config)').eq('workspace_id', workspaceId)
    .eq('meta_ad_funnels.archived', false).eq('meta_ad_funnels.config->>group_by', 'landing_page').order('period_end', { ascending: false }).order('created_at', { ascending: false }).limit(100);
  if (alerts.error) {
    if (['42P01', 'PGRST205'].includes(alerts.error.code)) return 0;
    throw new Error(alerts.error.message);
  }
  if (!alerts.data?.length) return 0;
  const reads = await svc.from('meta_funnel_alert_reads').select('alert_id').eq('workspace_id', workspaceId).eq('user_id', profile.id).in('alert_id', alerts.data.map(a => a.id));
  if (reads.error) throw new Error(reads.error.message);
  const readIds = new Set((reads.data || []).map(r => r.alert_id));
  return alerts.data.filter(a => !readIds.has(a.id)).length;
}
export async function saveMetaFunnel(input: { id?: string; version?: number; config: FunnelConfig }) {
  const { workspaceId, profile } = await manageAccess();
  const config = validateFunnel(input.config);
  const svc = createServiceSupabase();
  const accountResult = await svc.from('meta_ad_accounts').select('account_id').eq('workspace_id', workspaceId).eq('is_active', true);
  if (accountResult.error) throw new Error(accountResult.error.message);
  const accounts = accountResult.data || [];
  if (config.account_ids.some(a => !accounts.some(r => r.account_id === a))) throw new Error('Akun funnel tidak tersedia di workspace ini.');
  let savedId: string;
  if (input.id) {
    uuid(input.id);
    if (!Number.isInteger(input.version) || !input.version || input.version < 1) throw new Error('Versi funnel tidak valid.');
    const result = await svc.from('meta_ad_funnels').update({ config, version: input.version + 1, updated_at: new Date().toISOString() })
      .eq('id', input.id).eq('workspace_id', workspaceId).eq('archived', false).eq('version', input.version).select('id').maybeSingle();
    if (result.error) throw new Error(result.error.message);
    if (!result.data) throw new Error('Funnel sudah diubah. Muat ulang sebelum menyimpan.');
    savedId = result.data.id;
  } else {
    const result = await svc.from('meta_ad_funnels').insert({ workspace_id: workspaceId, created_by: profile.id, config }).select('id').single();
    if (result.error) throw new Error(result.error.message);
    savedId = result.data.id;
  }
  let warning: string | null = null;
  try { await evaluateWorkspaceAlerts(svc, workspaceId, accounts.map(a => a.account_id)); }
  catch { warning = 'Funnel tersimpan; evaluasi notifikasi akan dicoba lagi saat sync berikutnya.'; }
  return { id: savedId, warning };
}
export async function archiveMetaFunnel(id: string) {
  const { workspaceId } = await manageAccess();
  const result = await createServiceSupabase().from('meta_ad_funnels').update({ archived: true, updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', uuid(id));
  if (result.error) throw new Error(result.error.message);
}
export async function markMetaFunnelAlertRead(id: string) {
  const { workspaceId, profile } = await reportingAccess();
  const svc = createServiceSupabase();
  const alert = await svc.from('meta_funnel_alerts').select('id').eq('workspace_id', workspaceId).eq('id', uuid(id)).maybeSingle();
  if (alert.error || !alert.data) throw new Error('Notifikasi tidak ditemukan.');
  const result = await svc.from('meta_funnel_alert_reads').upsert({ workspace_id: workspaceId, user_id: profile.id, alert_id: id }, { onConflict: 'alert_id,user_id' });
  if (result.error) throw new Error(result.error.message);
}
export async function verifyMetaAdDestination(input: { accountId: string; adId: string; url: string }) {
  const { workspaceId, profile } = await manageAccess();
  const url = canonicalLandingPage(input.url);
  if (!/^act_\d+$/.test(input.accountId) || !/^\d+$/.test(input.adId) || !url) throw new Error('Akun, ad ID, atau URL tidak valid.');
  const svc = createServiceSupabase();
  const account = await svc.from('meta_ad_accounts').select('account_id').eq('workspace_id', workspaceId).eq('account_id', input.accountId).eq('is_active', true).maybeSingle();
  if (account.error || !account.data) throw new Error('Akun Meta tidak tersedia di workspace ini.');
  const creative = await svc.from('meta_ad_creatives').select('creative_id').eq('workspace_id', workspaceId).eq('account_id', input.accountId).eq('ad_id', input.adId).maybeSingle();
  if (creative.error || !creative.data?.creative_id) throw new Error('Creative ad belum tersedia. Sync metadata sebelum menetapkan URL.');
  const result = await svc.from('meta_ad_verified_destinations').upsert({ workspace_id: workspaceId, account_id: input.accountId, ad_id: input.adId,
    creative_id: creative.data.creative_id, landing_page_url: url, verified_by: profile.id, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id,account_id,ad_id' });
  if (result.error) throw new Error(result.error.message);
  return { url };
}
export async function queueMetaFunnelSync(from: string, to: string, funnelId?: string) {
  const { workspaceId, profile } = await manageAccess();
  validateRange(from, to);
  if (to >= getTodayWIB()) throw new Error('Sync funnel sampai kemarin agar periode harian sudah selesai.');
  const svc = createServiceSupabase();
  let scope: string[] = [];
  if (funnelId) {
    const result = await svc.from('meta_ad_funnels').select('config').eq('workspace_id', workspaceId).eq('id', uuid(funnelId)).eq('archived', false).single();
    if (result.error) throw new Error('Funnel tidak ditemukan.');
    scope = result.data.config.account_ids;
  }
  const accounts = await svc.from('meta_ad_accounts').select('account_id').eq('workspace_id', workspaceId).eq('is_active', true);
  if (accounts.error) throw new Error(accounts.error.message);
  const ids = (accounts.data || []).map(a => a.account_id).filter(a => !scope.length || scope.includes(a));
  if (!ids.length) throw new Error('Belum ada akun Meta aktif. Hubungkan akun melalui Admin Meta.');
  const jobs = await enqueueMetaAdBatches(workspaceId, ids, from, to, profile.id);
  return { jobs };
}
