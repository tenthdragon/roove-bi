'use server';

import { requireDashboardPermissionAccess, requireDashboardTabAccess } from './dashboard-access';
import { createServiceSupabase } from './service-supabase';
import { compareGroups, defaultFunnel, daysBetween, hasCoverage, shiftDay, totalFacts, trend, validateFunnel, validateRange,
  matchesFunnel, destinationQuality, withLandingPages, type AdFact, type Coverage, type AdCreative, type FunnelConfig } from './meta-funnel-domain';
import { evaluateWorkspaceAlerts, loadFunnels, loadVerifiedDestinations, loadAdDimensions, readAll } from './meta-funnel-store';
import { enqueueMetaAdBatches } from './meta-funnel-sync-queue';
import { getTodayWIB } from './sync-schedule';
import { isWorkspaceModuleEnabled } from './workspaces';
import { canonicalLandingPage } from './meta-ad-destinations';
import { dimensionOptions, validateDimensionFilters, withAdDimensions, matchesAdDimensions, type AdDimensionFilters } from './meta-ad-dimensions';

const FACT_FIELDS = 'account_id,account_name,ad_id,ad_name,creative_id,metric_date,currency,metrics,landing_page_urls,campaign_id:raw_insights->>campaign_id,campaign_objective:raw_insights->>objective';
const CREATIVE_FIELDS = 'account_id,ad_id,creative_id,name,thumbnail_url,video_id,body,landing_page_urls';
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
export async function getMetaFunnelData(input: { from: string; to: string; funnelId?: string; groupKey?: string; filters?: AdDimensionFilters; groupBy?: 'ad'|'landing_page' }) {
  const { workspaceId } = await reportingAccess();
  validateRange(input.from, input.to);
  const filters = validateDimensionFilters(input.filters);
  if (input.groupBy !== undefined && !['ad','landing_page'].includes(input.groupBy)) throw new Error('Tampilan agregasi tidak valid.');
  const svc = createServiceSupabase();
  const schema = await svc.from('meta_ad_creatives').select('landing_page_urls').eq('workspace_id', workspaceId).limit(1);
  if (schema.error && ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(schema.error.code)) return { schemaReady: false as const };
  if (schema.error) throw new Error(schema.error.message);
  const [funnels, accountsResult, jobsResult] = await Promise.all([
    loadFunnels(svc, workspaceId).then(saved => saved.filter(f => f.group_by === 'landing_page')),
    svc.from('meta_ad_accounts').select('account_id,account_name').eq('workspace_id', workspaceId).eq('is_active', true).order('account_name'),
    svc.from('sync_jobs').select('id,status,error_message,created_at,payload').eq('workspace_id', workspaceId).eq('job_name', 'meta_sync').contains('payload', { ad_funnels_only: true }).order('created_at', { ascending: false }).limit(20),
  ]);
  if (accountsResult.error) throw new Error(accountsResult.error.message);
  if (jobsResult.error) throw new Error(jobsResult.error.message);
  const accounts = accountsResult.data || [];
  const selected = funnels.find(f => f.id === input.funnelId) || funnels[0] || null;
  const config: FunnelConfig = { ...(selected || defaultFunnel()), group_by:input.groupBy === 'ad' ? 'ad_id' : 'landing_page' };
  const prevFrom = shiftDay(input.from, -daysBetween(input.from, input.to));
  const historyFrom = [prevFrom, shiftDay(input.to, -89)].sort()[0];
  const [facts, coverage, creatives, verified, dimensions] = await Promise.all([
    readAll<AdFact>(svc, 'meta_ad_daily_metrics', FACT_FIELDS, workspaceId, historyFrom, input.to),
    readAll<Coverage>(svc, 'meta_ad_sync_coverage', 'account_id,metric_date', workspaceId, historyFrom, input.to),
    readAll<AdCreative>(svc, 'meta_ad_creatives', CREATIVE_FIELDS, workspaceId),
    loadVerifiedDestinations(svc, workspaceId),
    loadAdDimensions(svc,workspaceId),
  ]);
  const activeIds = accounts.map(a => a.account_id);
  if (!dimensions.ready && Object.keys(filters).length) throw new Error('Pasang migration 202_meta_ad_campaign_dimensions.sql untuk memfilter CEP dan objective.');
  const scopedMappings = dimensions.rows.filter(m => activeIds.includes(m.account_id) && (!config.account_ids.length || config.account_ids.includes(m.account_id)));
  const enriched = withAdDimensions(withLandingPages(facts, creatives, verified.rows),scopedMappings);
  const configuredRows = enriched.filter(r => activeIds.includes(r.account_id) && matchesFunnel(r, config));
  const scoped = configuredRows.filter(r => matchesAdDimensions(r, filters));
  const currencies = [...new Set(scoped.map(r => r.currency))];
  const reportingError = currencies.length > 1 ? 'Funnel mencakup beberapa mata uang. Pilih akun dengan mata uang yang sama pada konfigurasi.' : null;
  // Keep account/configuration controls available so users can fix a mixed-currency scope.
  const reportRows = reportingError ? [] : scoped;
  const scopedAccounts = activeIds.filter(a => !config.account_ids.length || config.account_ids.includes(a));
  const groups = compareGroups(reportRows, config, input.from, input.to, creatives);
  const summary = totalFacts(reportRows.filter(r => r.metric_date >= input.from));
  const previous = totalFacts(reportRows.filter(r => r.metric_date >= prevFrom && r.metric_date < input.from));
  const trendFrom = shiftDay(input.to, -89);
  const groupKey = input.groupKey && groups.some(g => g.key === input.groupKey) ? input.groupKey : undefined;
  const coveredTrend = (from: string, period: 'day' | 'week' | 'month') => trend(reportRows, config, from, input.to, period, groupKey).map(p => {
    const bucketEnd = period === 'day' ? p.date : period === 'week' ? shiftDay(p.date, 6)
      : new Date(Date.UTC(Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const start = [p.date, from].sort()[1]; const end = [bucketEnd, input.to].sort()[0];
    const complete = !reportingError && hasCoverage(coverage, scopedAccounts, start, end);
    return { ...p, complete, partial: start !== p.date || end !== bucketEnd,
      metrics: complete ? p.metrics : Object.fromEntries(config.metrics.map(m => [m.id, null])) as Record<string, number | null> };
  });
  const daily = coveredTrend(shiftDay(input.from, -1), 'day');
  const currentRows = scoped.filter(r => r.metric_date >= input.from);
  return { schemaReady: true as const, funnels, selectedId: selected?.id || null, config, accounts,
    dimensionsReady:dimensions.ready, dimensionOptions:dimensionOptions(scopedMappings, configuredRows.filter(r => r.metric_date >= input.from), filters), filters,
    matchingAds:new Set(currentRows.map(r=>`${r.account_id}:${r.ad_id}`)).size,
    objectiveUnknownAds:new Set(enriched.filter(r=>activeIds.includes(r.account_id) && matchesFunnel(r,config) && r.metric_date >= input.from && !r.campaign_objective).map(r=>`${r.account_id}:${r.ad_id}`)).size,
    groups, summary, previous, reportingError, currency: currencies[0] || 'IDR',
    destinations: destinationQuality(scoped, config, input.from, input.to), verifiedDestinationsReady: verified.ready,
    daily: daily.slice(1).map((p, i) => ({ ...p, previousMetrics: daily[i].metrics })),
    weekly: coveredTrend(trendFrom, 'week'), monthly: coveredTrend(trendFrom, 'month'),
    currentComplete: hasCoverage(coverage, scopedAccounts, input.from, input.to),
    baselineComplete: hasCoverage(coverage, scopedAccounts, prevFrom, shiftDay(input.from, -1)),
    prevFrom, prevTo: shiftDay(input.from, -1),
    trendCoverageComplete: hasCoverage(coverage, scopedAccounts, trendFrom, input.to),
    jobs: jobsResult.data || [],
  };
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
