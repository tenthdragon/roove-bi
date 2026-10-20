'use server';

import { mutateMeta } from './meta-edit-mutations';
import { assertMetaBrand } from './meta-brand-access';
import { createServiceSupabase } from './service-supabase';
import { daysBetween, hasCoverage, shiftDay, emptyTotals, validateFunnel, type FunnelConfig } from './meta-funnel-domain';
import { enqueueIncrementalMetaSync } from './meta-sync-queue';
import { metaAdChannelCounts } from './meta-ad-channels';
import { canonicalLandingPage } from './meta-ad-destinations';
import { metaCoverageGaps } from './meta-report-status';
import { currencyError, editAccess, manageAccess, reportContext, reportJobs, reportingAccess, uuid } from './meta-report-context';

import { metaReportBrandSections, metaReportQuery, metaReportGroups, metaReportOptions, metaReportHistory, type MetaReportInput } from './meta-ad-report';
import { getCachedMetaAdReport } from './meta-ad-report-data';
import { validateMetaSyncJobIds } from './meta-funnel-sync-status';
import { loadMetaSyncJobTree } from './meta-sync-job-tree';

export async function getMetaFunnelData(input: MetaReportInput) {
  const ctx = await reportContext(input, true);
  if (!ctx.schemaReady) return ctx;
  const raw = await getCachedMetaAdReport(ctx.workspaceId, ctx.reportVersion, metaReportQuery(ctx.input, ctx.config));
  const brandSections = await metaReportBrandSections(ctx.input, ctx.config, ctx.configuredAccounts, ctx.brands,
    query => getCachedMetaAdReport(ctx.workspaceId, ctx.reportVersion, query));
  const { from, to } = ctx.reportRange;
  const prevFrom = shiftDay(from, -daysBetween(from, to)), reportingError = raw.currencies.length > 1 ? currencyError : null;
  return { schemaReady: true as const, funnels: ctx.funnels, selectedId: ctx.selectedId, config: ctx.config, accounts: ctx.accounts,
    scopedAccountIds: ctx.scopedAccountIds, brandId: ctx.brandId, reportRange: ctx.reportRange, reportVersion: ctx.reportVersion,
    ...metaReportOptions(raw, ctx.accounts, ctx.brands), dimensionsReady: true, filters: ctx.filters,
    channel: ctx.channel, channelCounts: metaAdChannelCounts(raw.channelCounts), matchingAds: raw.matchingAds, objectiveUnknownAds: raw.objectiveUnknownAds,
    coverageGaps: metaCoverageGaps(raw.coverage, ctx.scopedAccountIds, ctx.reportRange),
    brandSections, groups: reportingError ? [] : metaReportGroups(raw, ctx.config), summary: reportingError ? emptyTotals() : raw.summary,
    previous: reportingError ? emptyTotals() : raw.previous, reportingError, currency: raw.currencies[0] || 'IDR',
    destinations: raw.destinations, verifiedDestinationsReady: true,
    currentComplete: hasCoverage(raw.coverage, ctx.scopedAccountIds, from, to),
    baselineComplete: hasCoverage(raw.coverage, ctx.scopedAccountIds, prevFrom, shiftDay(from, -1)),
    prevFrom, prevTo: shiftDay(from, -1), jobs: ctx.jobs };
}
export async function getMetaFunnelHistory(input: MetaReportInput & { view: 'daily' | 'trends'; period?: 'weekly' | 'monthly'; workspaceId?: string }) {
  if (!['daily', 'trends'].includes(input.view) || input.period !== undefined && !['weekly', 'monthly'].includes(input.period)) throw new Error('Periode histori tidak valid.');
  const ctx = await reportContext(input);
  if (!ctx.schemaReady) return ctx;
  if (input.workspaceId && input.workspaceId !== ctx.workspaceId) throw new Error('Workspace berubah. Muat ulang halaman.');
  const config = ctx.brandId && ctx.scopedAccountIds.length ? { ...ctx.config, account_ids: ctx.scopedAccountIds } : ctx.config;
  const raw = await getCachedMetaAdReport(ctx.workspaceId, ctx.reportVersion, metaReportQuery(ctx.input, config, input.view, input.period === 'monthly' ? 'month' : 'week'));
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
export async function getMetaFunnelSyncStatus(jobIds?: string[]) {
  const scope = await reportingAccess(); const { workspaceId } = scope;
  if (scope.brandIds !== null) {
    const r = await createServiceSupabase().from('meta_ad_report_versions').select('revision').eq('workspace_id', workspaceId).maybeSingle();
    if (r.error) throw new Error(r.error.message);
    return { workspaceId, reportVersion: String(r.data?.revision || 0), jobs: [], trackedJobs: jobIds ? [] : null, pending: 0, running: false };
  }
  const svc = createServiceSupabase();
  const [version, jobs, trackedJobs, active] = await Promise.all([
    svc.from('meta_ad_report_versions').select('revision').eq('workspace_id', workspaceId).maybeSingle(), loadMetaSyncJobTree(svc, workspaceId),
    jobIds ? loadMetaSyncJobTree(svc, workspaceId, validateMetaSyncJobIds(jobIds)) : Promise.resolve(null),
    svc.from('sync_jobs').select('status', { count: 'exact' }).eq('workspace_id', workspaceId).eq('job_name', 'meta_sync')
      .in('status', ['queued', 'running']).order('status', { ascending: false }).limit(1),
  ]);
  if (version.error || active.error) throw new Error(version.error?.message || active.error?.message);
  return { workspaceId, reportVersion: String(version.data?.revision || 0), jobs, trackedJobs,
    pending: active.count || 0, running: active.data?.[0]?.status === 'running' };
}
/** Cheap freshness check for cached detail/navigation reads. */
export async function getMetaReportRevision() {
  const { workspaceId } = await reportingAccess();
  const r = await createServiceSupabase().from('meta_ad_report_versions').select('revision').eq('workspace_id', workspaceId).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return { workspaceId, reportVersion: String(r.data?.revision || 0) };
}
/** Revalidate assignments before the browser reuses a previous report. */
export async function getMetaViewerScope() {
  try {
    const scope = await reportingAccess();
    return { workspaceId: scope.workspaceId, accessKey: scope.accessKey, brandIds: scope.brandIds };
  } catch {
    return { error: 'Akses brand belum dapat diverifikasi. Muat ulang atau hubungi owner workspace.' };
  }
}
export async function getMetaFunnelNotifications() {
  const scope = await reportingAccess(); const { workspaceId, profile } = scope;
  // Historical alerts are workspace/template aggregates without immutable brand
  // provenance. Never expose those precomputed totals to restricted viewers.
  if (scope.brandIds !== null) return { schemaReady: true as const, alerts: [] };
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
  const scope = await reportingAccess(); const { workspaceId, profile } = scope;
  if (scope.brandIds !== null) return 0;
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
export async function saveMetaFunnel(input: { id?: string; version?: number; brandId?: number | null; config: FunnelConfig }) {
  const ctx = await editAccess('meta:funnels');
  const config = validateFunnel(input.config);
  if (input.id) uuid(input.id);
  else if (input.brandId != null) assertMetaBrand(ctx, String(input.brandId));
  if (!input.id && ctx.brandIds !== null && !input.brandId) throw new Error('Pilih brand untuk funnel baru.');
  const saved = await mutateMeta(ctx, 'funnel', { ...input, config });
  return { id: saved.id as string, warning: null as string | null };
}
export async function archiveMetaFunnel(id: string) {
  const ctx = await editAccess('meta:funnels');
  await mutateMeta(ctx, 'archive_funnel', { id: uuid(id) });
}
export async function markMetaFunnelAlertRead(id: string) {
  const scope = await reportingAccess(); const { workspaceId, profile } = scope;
  if (scope.brandIds !== null) throw new Error('Notifikasi tidak tersedia dalam akses Anda.');
  const svc = createServiceSupabase();
  const alert = await svc.from('meta_funnel_alerts').select('id').eq('workspace_id', workspaceId).eq('id', uuid(id)).maybeSingle();
  if (alert.error || !alert.data) throw new Error('Notifikasi tidak ditemukan.');
  const result = await svc.from('meta_funnel_alert_reads').upsert({ workspace_id: workspaceId, user_id: profile.id, alert_id: id }, { onConflict: 'alert_id,user_id' });
  if (result.error) throw new Error(result.error.message);
}
export async function verifyMetaAdDestination(input: { accountId: string; adId: string; url: string }) {
  const ctx = await editAccess('meta:mapping'); const { workspaceId } = ctx;
  const url = canonicalLandingPage(input.url);
  if (!/^act_\d+$/.test(input.accountId) || !/^\d+$/.test(input.adId) || !url) throw new Error('Akun, ad ID, atau URL tidak valid.');
  if (ctx.accountIds !== null && !ctx.accountIds.includes(input.accountId)) throw new Error('Akun Meta tidak tersedia dalam akses brand Anda.');
  const svc = createServiceSupabase();
  const account = await svc.from('meta_ad_accounts').select('account_id').eq('workspace_id', workspaceId).eq('account_id', input.accountId).eq('is_active', true).maybeSingle();
  if (account.error || !account.data) throw new Error('Akun Meta tidak tersedia di workspace ini.');
  const creative = await svc.from('meta_ad_creatives').select('creative_id').eq('workspace_id', workspaceId).eq('account_id', input.accountId).eq('ad_id', input.adId).maybeSingle();
  if (creative.error || !creative.data?.creative_id) throw new Error('Creative ad belum tersedia. Sync metadata sebelum menetapkan URL.');
  await mutateMeta(ctx, 'destination', { ...input, url, creativeId: creative.data.creative_id });
  return { url };
}
export async function queueMetaFunnelSync() {
  const { workspaceId, profile } = await manageAccess();
  const svc = createServiceSupabase();
  const accounts = await svc.from('meta_ad_accounts').select('account_id').eq('workspace_id', workspaceId).eq('is_active', true).limit(1);
  if (accounts.error) throw new Error(accounts.error.message);
  if (!accounts.data?.length) throw new Error('Belum ada akun Meta aktif. Hubungkan akun melalui Admin Meta.');
  const jobs = await enqueueIncrementalMetaSync(svc, workspaceId, profile.id);
  if (!jobs.length) throw new Error('Belum ada akun Meta aktif. Hubungkan akun melalui Admin Meta.');
  return { jobs };
}
