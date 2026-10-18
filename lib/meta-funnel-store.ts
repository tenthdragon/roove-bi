import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdFact, AdCreative, Coverage, SavedFunnel, VerifiedDestination } from './meta-funnel-domain';
import { evaluateDeclines, hasCoverage, shiftDay, validateFunnel, withLandingPages } from './meta-funnel-domain';
import { matchDestinationTemplate, TEMPLATE_MATCH_KINDS, type TemplateRule } from './meta-funnel-templates';
import { ctwaDestination } from './meta-ctwa-destinations';
import { getTodayWIB } from './sync-schedule';
import type { AdDimensions } from './meta-ad-dimensions';

export async function readAll<T>(svc: SupabaseClient, table: string, fields: string, workspaceId: string, from?: string, to?: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = svc.from(table).select(fields).eq('workspace_id', workspaceId);
    if (from) query = query.gte('metric_date', from);
    if (to) query = query.lte('metric_date', to);
    // Stable order for PostgREST pagination, including multiple ads on the same date.
    query = ['meta_ad_creatives', 'meta_ad_verified_destinations', 'meta_ad_mappings', 'meta_ad_mapping_channels', 'meta_ad_destination_metadata'].includes(table) ? query.order('account_id').order('ad_id')
      : query.order('metric_date').order('account_id');
    if (table === 'meta_ad_daily_metrics') query = query.order('ad_id');
    const result = await query.range(offset, offset + 999);
    if (result.error) throw new Error(`Gagal memuat ${table}: ${result.error.message}`);
    rows.push(...(result.data || []) as unknown as T[]);
    if ((result.data || []).length < 1000) return rows;
    if (rows.length >= 200000) throw new Error('Rentang data terlalu besar. Persempit tanggal.');
  }
}
export async function loadAdDimensions(svc: SupabaseClient, workspaceId: string) {
  const schema = await svc.from('meta_ad_mappings').select('campaign_objective').eq('workspace_id',workspaceId).limit(1);
  if (schema.error && ['42P01','PGRST205','42703','PGRST204'].includes(schema.error.code)) return { ready:false, rows:[] as AdDimensions[] };
  if (schema.error) throw new Error(schema.error.message);
  return { ready:true, rows:await readAll<AdDimensions>(svc,'meta_ad_mappings','account_id,ad_id,cep_key,intention_key,campaign_id,campaign_name,campaign_objective',workspaceId) };
}
export async function loadVerifiedDestinations(svc: SupabaseClient, workspaceId: string) {
  const schema = await svc.from('meta_ad_verified_destinations').select('ad_id').eq('workspace_id', workspaceId).limit(1);
  if (schema.error && ['42P01', 'PGRST205'].includes(schema.error.code)) return { ready: false, rows: [] as VerifiedDestination[] };
  if (schema.error) throw new Error(schema.error.message);
  return { ready: true, rows: await readAll<VerifiedDestination>(svc, 'meta_ad_verified_destinations', 'account_id,ad_id,creative_id,landing_page_url', workspaceId) };
}
export async function loadFunnels(svc: SupabaseClient, workspaceId: string): Promise<(SavedFunnel & { version: number })[]> {
  const { data, error } = await svc.from('meta_ad_funnels').select('id,config,version,updated_at').eq('workspace_id', workspaceId).eq('archived', false).order('created_at');
  if (error) throw new Error(`Funnel belum tersedia: ${error.message}`);
  return (data || []).map(r => ({ ...validateFunnel(r.config), id: r.id, version: r.version, updated_at: r.updated_at }));
}
export async function loadTemplateRules(svc: SupabaseClient, workspaceId: string): Promise<{ ready: boolean; rows: TemplateRule[] }> {
  const { data, error } = await svc.from('meta_landing_page_templates').select('id,funnel_id,match_kind,pattern').eq('workspace_id', workspaceId).order('created_at');
  if (error && ['42P01', 'PGRST205'].includes(error.code)) return { ready: false, rows: [] };
  if (error) throw new Error(`Aturan template belum tersedia: ${error.message}`);
  return { ready: true, rows: (data || []).filter(r => TEMPLATE_MATCH_KINDS.includes(r.match_kind)) as TemplateRule[] };
}
export async function evaluateWorkspaceAlerts(svc: SupabaseClient, workspaceId: string, accountIds: string[], refreshed?: { from: string; to: string }) {
  const funnels = await loadFunnels(svc, workspaceId);
  const today = getTodayWIB();
  // Incremental sync may refresh only yesterday while the alert window ends
  // two or more days ago. Evaluate that complete cached window as well, so
  // template edits do not depend on an overlapping historical backfill.
  const enabled = funnels.filter(f => f.group_by === 'landing_page' && f.alerts_enabled
    && (!refreshed || shiftDay(today, -f.lag_days) <= refreshed.to));
  if (!enabled.length) return 0;
  const earliest = enabled.map(f => shiftDay(today, -f.lag_days - f.window_days * 2 + 1)).sort()[0];
  const coverage = await readAll<Coverage>(svc, 'meta_ad_sync_coverage', 'account_id,metric_date', workspaceId, earliest, today);
  const eligible = enabled.filter(f => hasCoverage(coverage, accountIds.filter(a => !f.account_ids.length || f.account_ids.includes(a)),
    shiftDay(today, -f.lag_days - f.window_days * 2 + 1), shiftDay(today, -f.lag_days)));
  if (!eligible.length) return 0;
  const [facts, creatives, verified, rules, contacts, accounts] = await Promise.all([
    readAll<AdFact>(svc, 'meta_ad_daily_metrics', 'account_id,account_name,ad_id,ad_name,creative_id,raw_insights,metric_date,currency,metrics,landing_page_urls', workspaceId, earliest, today),
    readAll<AdCreative>(svc, 'meta_ad_creatives', 'account_id,ad_id,creative_id,name,thumbnail_url,video_id,body,landing_page_urls', workspaceId),
    loadVerifiedDestinations(svc, workspaceId),
    loadTemplateRules(svc, workspaceId),
    readAll<{ account_id: string; ad_id: string; creative_id: string; adset_id: string; classification: string; metadata: Record<string, any> }>(svc,
      'meta_ad_destination_metadata', 'account_id,ad_id,creative_id,adset_id,classification,metadata', workspaceId),
    svc.from('meta_ad_accounts').select('account_id,default_brand_id').eq('workspace_id', workspaceId).eq('is_active', true),
  ]);
  if (accounts.error) throw new Error(accounts.error.message);
  const byAd = new Map(contacts.map(d => [`${d.account_id}:${d.ad_id}`, d]));
  const brandByAccount = new Map((accounts.data || []).map(a => [a.account_id, String(a.default_brand_id || '__unmapped__')]));
  const enriched = withLandingPages(facts, creatives, verified.rows).map(r => {
    const d = byAd.get(`${r.account_id}:${r.ad_id}`);
    const creative = r.creative_id || creatives.find(c => c.account_id === r.account_id && c.ad_id === r.ad_id)?.creative_id;
    const current = d && d.creative_id === creative && (!r.raw_insights?.adset_id || d.adset_id === r.raw_insights.adset_id);
    // Strong CPAS classification takes priority over WhatsApp contact evidence.
    const destination = current && d.classification === 'cpas' ? null : ctwaDestination({
      accountId: r.account_id, adId: r.ad_id, brandId: brandByAccount.get(r.account_id) || '__unmapped__',
      urls: r.landing_page_urls || [], metadata: current ? d.metadata : null,
    });
    return { ...r, destination };
  });
  let count = 0;
  for (const funnel of eligible) {
    const end = shiftDay(today, -funnel.lag_days);
    // A template with URL rules monitors only its own landing pages. Templates
    // without rules keep the earlier behavior and monitor every landing page.
    const ownRules = rules.rows.some(r => r.funnel_id === funnel.id);
    const scoped = enriched.filter(r => accountIds.includes(r.account_id) && (!funnel.account_ids.length || funnel.account_ids.includes(r.account_id))
      && (!ownRules || ((r.destination || r.landing_page_urls?.length === 1) && matchDestinationTemplate({
        destination: r.destination, landing_page_urls: r.landing_page_urls,
      }, rules.rows)?.funnel_id === funnel.id)));
    // Never combine monetary performance from different account currencies.
    if (new Set(scoped.map(r => r.currency)).size > 1) continue;
    const declines = evaluateDeclines(scoped, coverage, funnel, accountIds, end, creatives);
    for (const payload of declines) {
      const { error } = await svc.from('meta_funnel_alerts').upsert({
        workspace_id: workspaceId, funnel_id: funnel.id, rule_version: funnel.version,
        group_key: payload.group_key, metric_id: payload.metric_id, period_end: end,
        payload: { ...payload, currency: scoped[0]?.currency || 'IDR', funnel_name: funnel.name },
      }, { onConflict: 'funnel_id,rule_version,group_key,metric_id,period_end', ignoreDuplicates: true });
      if (error) throw new Error(`Gagal menyimpan notifikasi funnel: ${error.message}`);
      count++;
    }
  }
  return count;
}
