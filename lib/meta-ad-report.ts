import type { MetaAdChannel } from './meta-ad-channels';
import { emptyTotals, metricValue, relativeChange, type Totals, type FunnelConfig, type GroupComparison, type Coverage, type AdCreative } from './meta-funnel-domain';
import { dimensionLabel, objectiveLabel, type AdDimensionFilters } from './meta-ad-dimensions';
import { metaBrandOptions, type MetaAccountBrand, type MetaBrand } from './meta-ad-brands';
import { parseRooveAdName } from './meta-ad-naming';
import type { CtwaDestination } from './meta-ctwa-destinations';
import { parseCepKey } from './meta-cep-key';

export type MetaReportInput = { from: string; to: string; channel?: MetaAdChannel; funnelId?: string; brandId?: string; groupKey?: string; filters?: AdDimensionFilters; groupBy?: ReportGroupBy };
export type ReportGroupBy = 'ad' | 'landing_page' | 'cep_intention';
export type ReportQuery = {
  from: string; to: string; config: Pick<FunnelConfig, 'account_ids' | 'name_filter' | 'match'>;
  filters: AdDimensionFilters; channel: MetaAdChannel | null; brand: string | null; groupBy: ReportGroupBy;
  view: 'overview' | 'daily' | 'trends' | 'creatives'; period: 'week' | 'month'; groupKey: string | null;
};
export type ReportBucket = { date: string; totals: Totals; complete: boolean; partial: boolean };
export type RawMetaReport = { intentionLabels?: Record<string, string>;
  cepLabels?: Record<string, string>; intentionTotals?: { intention: string; current: Totals }[]; multiCepAds?: number;
  currencies: string[]; summary: Totals; previous: Totals;
  groups: (Omit<GroupComparison, 'metrics' | 'creatives' | 'categories' | 'classified' | 'destination'> & { destination?: CtwaDestination | null; currencies?: string[]; format_breakdown?: import('./meta-funnel-templates').FormatBreakdown[] })[];
  coverage: Coverage[]; facets: { dimension: keyof AdDimensionFilters; value: string; count: number }[];
  facetTotals: Partial<Record<keyof AdDimensionFilters, number>>; brandCounts: Record<string, number>;
  channelCounts?: Partial<Record<MetaAdChannel, number>>; matchingAds: number; objectiveUnknownAds: number;
  destinations: { urls: number; missing_ads: number; multi_ads: number; missing: { account_id: string; ad_id: string; account_name: string; ad_name: string }[] };
  history: ReportBucket[]; historyComplete: boolean; creatives: AdCreative[];
};
export function metaReportQuery(input: MetaReportInput, config: FunnelConfig, view: ReportQuery['view'] = 'overview', period: ReportQuery['period'] = 'week'): ReportQuery {
  return { from: input.from, to: input.to, config: { account_ids: [...config.account_ids].sort(), name_filter: config.name_filter, match: config.match },
    filters: { cep: input.filters?.cep, intention: input.filters?.intention, objective: input.filters?.objective },
    channel: input.channel || null, brand: input.brandId || null, groupBy: input.groupBy || 'landing_page', view, period,
    groupKey: view === 'overview' ? null : input.groupKey || null };
}
export function metaReportGroups(raw: RawMetaReport, config: FunnelConfig): GroupComparison[] {
  return raw.groups.map(({ currencies: _currencies, destination, ...g }) => {
    const current = { ...emptyTotals(), ...g.current }, previous = { ...emptyTotals(), ...g.previous };
    const categories = new Map<string, GroupComparison['categories'][number]>();
    for (const name of g.ad_names) { const parsed = parseRooveAdName(name); if (parsed.valid) categories.set(`${parsed.cep}:${parsed.funnel}`, { cep: parsed.cep!, funnel: parsed.funnel! }); }
    return { ...g, ...(destination ? { destination } : {}), name: g.name || g.ad_ids[0] || g.key, current, previous, categories: [...categories.values()], classified: categories.size > 0, creatives: [],
      metrics: config.metrics.map(m => { const a = metricValue(current, m), b = metricValue(previous, m); return { id: m.id, current: a, previous: b, change: relativeChange(a, b) }; }) };
  });
}
export function metaReportOptions(raw: RawMetaReport, accounts: MetaAccountBrand[], brands: MetaBrand[]) {
  const choices = (dimension: keyof AdDimensionFilters) => raw.facets.filter(f => f.dimension === dimension).map(f => ({ value: f.value, count: f.count,
    label: dimension === 'objective' ? objectiveLabel(f.value) : dimension === 'cep' ? raw.cepLabels?.[f.value] || dimensionLabel(dimension, f.value) : raw.intentionLabels?.[f.value] || dimensionLabel(dimension, f.value) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'id'));
  const brandOptions = metaBrandOptions(accounts, brands, []);
  brandOptions.choices = brandOptions.choices.map(b => ({ ...b, count: raw.brandCounts[b.value] || 0 })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'id'));
  brandOptions.total = Object.values(raw.brandCounts).reduce((sum, n) => sum + n, 0);
  return { brandOptions, dimensionOptions: { ceps: choices('cep'), cepTotal: raw.facetTotals.cep || 0,
    intentions: choices('intention'), intentionTotal: raw.facetTotals.intention || 0, objectives: choices('objective'), objectiveTotal: raw.facetTotals.objective || 0 } };
}
export function metaReportHistory(raw: RawMetaReport, config: FunnelConfig, view: 'daily' | 'trends') {
  const valid = raw.currencies.length <= 1;
  const points = raw.history.map(p => ({ ...p, complete: valid && p.complete,
    metrics: Object.fromEntries(config.metrics.map(m => [m.id, valid && p.complete ? metricValue(p.totals, m) : null])) as Record<string, number | null> }));
  return view === 'daily' ? points.slice(1).map((p, i) => ({ ...p, previousMetrics: points[i].metrics })) : points;
}

// Match the brand overview's Website + CPAS spend. Unverified-channel ads are
// outside both worlds and must not dilute their CEP shares.
export async function metaReportCepShares(input: MetaReportInput, config: FunnelConfig, fetchReport: (query: ReportQuery) => Promise<RawMetaReport>) {
  const reports = await Promise.all((['non_cpas', 'cpas'] as const).map(channel =>
    fetchReport(metaReportQuery({ ...input, channel, groupBy: 'cep_intention' }, config))));
  const byCep = new Map<string, number>();
  for (const raw of reports) for (const g of raw.groups) {
    const parsed = parseCepKey(g.key);
    if (!parsed) continue;
    const cep = parsed.cep;
    byCep.set(cep, (byCep.get(cep) || 0) + (Number(g.current.spend) || 0));
  }
  const total = reports.reduce((sum, r) => sum + r.summary.spend, 0);
  const labels = Object.assign({}, ...reports.map(r => r.cepLabels || {})) as Record<string, string>;
  return [...byCep].map(([cep, spend]) => ({ cep, label: cep === '__unknown__' ? 'Belum terpetakan' : labels[cep] || dimensionLabel('cep', cep), share: total > 0 ? spend / total : 0 }))
    .sort((a, b) => Number(a.cep === '__unknown__') - Number(b.cep === '__unknown__') || b.share - a.share);
}

// Fetch each brand before aggregation: a landing page or ad name can be shared
// across brands, and its global totals cannot be split safely in the browser.
export async function metaReportBrandSections(
  input: MetaReportInput, config: FunnelConfig, accounts: MetaAccountBrand[], brands: MetaBrand[],
  fetchReport: (query: ReportQuery) => Promise<RawMetaReport>,
) {
  if (input.brandId) return [];
  const choices = metaBrandOptions(accounts, brands, []).choices;
  const sections: {
    id: string; name: string; summary: Totals; previous: Totals; groups: GroupComparison[];
    currency: string; matchingAds: number; reportingError: string | null;
  }[] = [];
  // Bound concurrent database work even in workspaces with many brands.
  for (let offset = 0; offset < choices.length; offset += 2) {
    const batch = await Promise.all(choices.slice(offset, offset + 2).map(async brand => {
      const raw = await fetchReport(metaReportQuery({ ...input, brandId: brand.value }, config));
      const reportingError = raw.currencies.length > 1 ? 'Brand mencakup beberapa mata uang. Pilih akun dengan mata uang yang sama.' : null;
      return { id: brand.value, name: brand.label, summary: reportingError ? emptyTotals() : raw.summary,
        previous: reportingError ? emptyTotals() : raw.previous, groups: reportingError ? [] : metaReportGroups(raw, config),
        currency: raw.currencies[0] || 'IDR', matchingAds: raw.matchingAds, reportingError };
    }));
    sections.push(...batch);
  }
  return sections.sort((a, b) => a.name.localeCompare(b.name, 'id'));
}
