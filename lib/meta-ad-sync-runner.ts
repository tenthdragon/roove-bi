import { createServiceSupabase } from './service-supabase';
import { resolveWorkspaceCredential } from './workspace-integration-server';
import { fetchAdInsights, metaGraph, normalizeAdInsight } from './meta-ad-insights';
import { shiftDay, validateRange } from './meta-funnel-domain';
import { evaluateWorkspaceAlerts } from './meta-funnel-store';
import { requireExplicitWorkspaceId } from './workspace-scope';
import { getTodayWIB } from './sync-schedule';
import { normalizeLandingPages } from './meta-ad-destinations';

const defaultDependencies = { createServiceSupabase, resolveWorkspaceCredential, fetchAdInsights, metaGraph, evaluateWorkspaceAlerts };
export async function runMetaAdSync(options: { workspaceId: string; dateStart?: string; dateEnd?: string; accountId?: string }, dependencies = defaultDependencies) {
  const workspaceId = requireExplicitWorkspaceId(options.workspaceId, 'Meta ad funnel sync');
  const svc = dependencies.createServiceSupabase();
  const schema = await svc.from('meta_ad_creatives').select('landing_page_urls').eq('workspace_id', workspaceId).limit(1);
  if (schema.error) {
    if (['42P01', 'PGRST205', '42703', 'PGRST204'].includes(schema.error.code)) return { status: 'success' as const, rows_inserted: 0, errors: [], message: 'Migration 198/199 belum terpasang; ad funnel sync dilewati.' };
    throw new Error(schema.error.message);
  }
  const end = options.dateEnd || shiftDay(getTodayWIB(), -1);
  const start = options.dateStart || shiftDay(end, -6);
  validateRange(start, end, 7);
  const token = await dependencies.resolveWorkspaceCredential({ supabase: svc, workspaceId, provider: 'meta', fallbackEnvKeys: ['META_ACCESS_TOKEN'] });
  let accountQuery = svc.from('meta_ad_accounts').select('account_id,account_name').eq('workspace_id', workspaceId).eq('is_active', true);
  if (options.accountId) accountQuery = accountQuery.eq('account_id', options.accountId);
  const { data: accounts, error } = await accountQuery;
  if (error) throw new Error(error.message);
  if (options.accountId && !accounts?.length) throw new Error('Akun Meta tidak aktif atau tidak tersedia dalam workspace.');
  const errors: string[] = []; const warnings: string[] = [];
  let rowsInserted = 0; let synced = 0;
  for (const account of accounts || []) {
    try {
      const info = await dependencies.metaGraph(account.account_id, token, { fields: 'currency,timezone_name' });
      if (!info.currency || !info.timezone_name) throw new Error('Currency/timezone ad account tidak tersedia.');
      const profileObservedAt = new Date().toISOString();
      const raw = await dependencies.fetchAdInsights(account.account_id, start, end, token);
      // The light inventory validates metadata before metric jobs. Rich provider
      // reads belong exclusively to changed-ad mapping jobs, never this path.
      const adIds = [...new Set(raw.map(r => r.ad_id))];
      const destinations = new Map<string, string[]>(), creativeIds = new Map<string, string | null>();
      const states = new Map<string, { creative_id: string; adset_id: string }>();
      for (let offset = 0; offset < adIds.length; offset += 500) {
        const ids = adIds.slice(offset, offset + 500);
        const [cached, certified] = await Promise.all([
          svc.from('meta_ad_creatives').select('ad_id,creative_id,landing_page_urls').eq('workspace_id', workspaceId).eq('account_id', account.account_id).in('ad_id', ids),
          svc.from('meta_ad_metadata_sync_state').select('ad_id,creative_id,adset_id').eq('workspace_id', workspaceId).eq('account_id', account.account_id).in('ad_id', ids),
        ]);
        if (cached.error || certified.error) warnings.push(`${account.account_name}: cache metadata belum tersedia; metrik tetap disimpan.`);
        else {
          for (const state of certified.data || []) states.set(state.ad_id, state);
          for (const c of cached.data || []) if (states.get(c.ad_id)?.creative_id === c.creative_id) {
            destinations.set(c.ad_id, normalizeLandingPages(c.landing_page_urls)); creativeIds.set(c.ad_id, c.creative_id);
          }
        }
      }
      const rows = raw.map(r => {
        const metrics = normalizeAdInsight(r);
        return { ad_id: r.ad_id, ad_name: r.ad_name || '', metric_date: r.date_start,
          creative_id: (!r.adset_id || states.get(r.ad_id)?.adset_id === r.adset_id) ? creativeIds.get(r.ad_id) ?? null : null, metrics,
          raw_insights: { ...r, ig_profile_visit_observation: { observed_at: profileObservedAt,
            status: metrics.instagram_profile_visits === null ? 'not_returned' : 'available', source: 'meta_insights' } },
          landing_page_urls: (!r.adset_id || states.get(r.ad_id)?.adset_id === r.adset_id) ? destinations.get(r.ad_id) ?? [] : [] };
      });
      // Replace only after all pagination completes. Coverage includes successful zero-row days.
      const { error: replaceError } = await svc.rpc('replace_meta_ad_snapshot', {
        p_workspace_id: workspaceId, p_account_id: account.account_id, p_account_name: account.account_name,
        p_start: start, p_end: end, p_currency: info.currency, p_timezone: info.timezone_name, p_rows: rows,
      });
      if (replaceError) throw new Error(replaceError.message);
      rowsInserted += rows.length; synced++;
    } catch (e) { errors.push(`${account.account_name}: ${e instanceof Error ? e.message : 'Ad sync gagal'}`); }
  }
  let alerts = 0;
  try {
    const all = await svc.from('meta_ad_accounts').select('account_id').eq('workspace_id', workspaceId).eq('is_active', true);
    if (all.error) throw new Error(all.error.message);
    alerts = await dependencies.evaluateWorkspaceAlerts(svc, workspaceId, (all.data || []).map(a => a.account_id), { from: start, to: end });
  }
  catch (e) { errors.push(e instanceof Error ? e.message : 'Evaluasi notifikasi gagal'); }
  return { status: errors.length ? synced ? 'partial' as const : 'failed' as const : 'success' as const,
    rows_inserted: rowsInserted, accounts_synced: synced, accounts_total: (accounts || []).length,
    date_range: { start, end }, alerts_evaluated: alerts, errors, warnings };
}
