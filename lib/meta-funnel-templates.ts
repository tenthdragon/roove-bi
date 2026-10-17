// Funnel templates: a saved funnel configuration describes the stages and result
// columns of one kind of landing page. URL rules assign landing pages to a
// template; observed events only suggest one, never assign it.
import { canonicalLandingPage } from './meta-ad-destinations';
import { emptyTotals, metricValue, relativeChange, type FunnelConfig, type FunnelMetric, type SavedFunnel, type Totals } from './meta-funnel-domain';
import { CTWA_KEY_PATTERN, type CtwaDestination } from './meta-ctwa-destinations';

export type MetaBrandWorld = 'website' | 'cpas';
export const WORLD_CHANNEL = { website: 'non_cpas', cpas: 'cpas' } as const;
export const WORLD_LABELS: Record<MetaBrandWorld, string> = { website: 'Website & WhatsApp', cpas: 'CPAS Shopee' };
export const TEMPLATE_MATCH_KINDS = ['exact', 'prefix', 'domain', 'ctwa'] as const;
export type TemplateMatchKind = typeof TEMPLATE_MATCH_KINDS[number];
export type TemplateRule = { id: string; funnel_id: string; match_kind: TemplateMatchKind; pattern: string };
export type TemplateKind = 'transaction' | 'lead' | 'other';
export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = { transaction: 'Transaksi', lead: 'Lead', other: 'Lainnya' };

export type ReportGroup = {
  key: string; name: string; current: Totals; previous: Totals; ad_ids: string[];
  accounts: string[]; ad_names: string[]; landing_page_urls: string[]; verified_ad_ids: string[];
  destination?: CtwaDestination | null;
  currencies?: string[];
};
export type MetricComparison = { id: string; current: number | null; previous: number | null; change: number | null };
export type TemplateGroup = ReportGroup & { metrics: MetricComparison[] };
export type TemplateSection = {
  key: string; funnelId: string | null; name: string; kind: TemplateKind; config: FunnelConfig;
  groups: TemplateGroup[]; summary: Totals; previous: Totals; metrics: MetricComparison[];
  mainMetric: FunnelMetric | null; mainMedian: number | null;
};
export type UnassignedGroup = ReportGroup & {
  reason: 'no_rule' | 'no_url' | 'multi_url'; suggestion: { funnelId: string | null; reason: string };
};

function hostname(url: string) { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } }
function validDomain(value: string) { return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value); }

export function validateTemplateRule(input: { match_kind?: unknown; pattern?: unknown }): { match_kind: TemplateMatchKind; pattern: string } {
  const kind = input.match_kind;
  if (typeof kind !== 'string' || !TEMPLATE_MATCH_KINDS.includes(kind as TemplateMatchKind)) throw new Error('Jenis pencocokan tidak valid.');
  const raw = typeof input.pattern === 'string' ? input.pattern.trim() : '';
  if (!raw || raw.length > 4096) throw new Error('Pola URL wajib diisi.');
  if (kind === 'ctwa') {
    if (!CTWA_KEY_PATTERN.test(raw)) throw new Error('Tujuan WhatsApp tidak valid. Pilih tujuan dari tabel pencocokan.');
    return { match_kind: 'ctwa', pattern: raw };
  }
  if (kind === 'domain') {
    const domain = raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (!validDomain(domain)) throw new Error('Domain tidak valid. Contoh: purvu.id');
    return { match_kind: 'domain', pattern: domain };
  }
  const canonical = canonicalLandingPage(raw);
  if (!canonical) throw new Error('URL tidak valid. Gunakan URL lengkap dengan https://');
  return { match_kind: kind as TemplateMatchKind, pattern: canonical };
}

/** Exact beats prefix beats domain; within a kind, the longest pattern wins. */
export function matchTemplateRule(url: string, rules: TemplateRule[]): TemplateRule | null {
  const canonical = canonicalLandingPage(url);
  if (!canonical) return null;
  const host = hostname(canonical);
  const byLength = (a: TemplateRule, b: TemplateRule) => b.pattern.length - a.pattern.length || a.id.localeCompare(b.id);
  const exact = rules.filter(r => r.match_kind === 'exact' && r.pattern === canonical).sort(byLength);
  if (exact.length) return exact[0];
  const prefix = rules.filter(r => r.match_kind === 'prefix' && (canonical === r.pattern || canonical.startsWith(r.pattern.endsWith('/') ? r.pattern : `${r.pattern}/`) || canonical.startsWith(r.pattern))).sort(byLength);
  if (prefix.length) return prefix[0];
  const domain = rules.filter(r => r.match_kind === 'domain' && host && (host === r.pattern || host.endsWith(`.${r.pattern}`))).sort(byLength);
  return domain[0] || null;
}

/** A CTWA assignment belongs to its brand and phone; URL rules remain a shared fallback. */
export function matchDestinationTemplate(group: { key?: string; url?: string; landing_page_urls?: string[]; destination?: CtwaDestination | null }, rules: TemplateRule[]) {
  if (group.destination) {
    const scoped = rules.find(r => r.match_kind === 'ctwa' && r.pattern === group.destination!.key);
    if (scoped) return scoped;
  }
  const urls = group.landing_page_urls || (group.url ? [group.url] : []);
  // CTWA may have several URL variants leading to the same number. A fallback
  // applies only if every URL resolves to the same template; never pick one URL.
  if (!urls.length) return null;
  const matches = urls.map(url => matchTemplateRule(url, rules));
  return matches.every(r => r && r.funnel_id === matches[0]?.funnel_id) ? matches[0] : null;
}

export function templateKind(config: Pick<FunnelConfig, 'stages' | 'metrics'>): TemplateKind {
  const measures = new Set([...config.stages, ...config.metrics.flatMap(m => [m.numerator, m.denominator].filter((v): v is NonNullable<typeof v> => !!v))]);
  if (measures.has('purchases') || measures.has('purchase_value')) return 'transaction';
  if (measures.has('leads') || measures.has('conversations') || measures.has('replies')) return 'lead';
  return 'other';
}
/** The cost metric a template is judged by: CPP for transactions, CPL for leads. */
export function templateMainMetric(config: Pick<FunnelConfig, 'stages' | 'metrics'>): FunnelMetric | null {
  const kind = templateKind(config);
  const denominators = kind === 'transaction' ? ['purchases'] : kind === 'lead' ? ['leads', 'conversations', 'replies'] : [];
  for (const d of denominators) { const found = config.metrics.find(m => m.numerator === 'spend' && m.denominator === d); if (found) return found; }
  const last = [...config.stages].reverse()[0];
  return last && last !== 'spend' ? { id: `cost_${last}`, label: `Biaya per ${last}`, numerator: 'spend', denominator: last, format: 'money', direction: 'lower', monitor: false, min_denominator: 1 } : null;
}

export function defaultLeadFunnel(): FunnelConfig {
  return {
    name: 'Lead WhatsApp', description: 'Outbound click → landing page → lead → percakapan WhatsApp',
    name_filter: '', match: 'contains', account_ids: [], group_by: 'landing_page', cep_keys: [], funnel_keys: [], naming_status: 'all',
    stages: ['impressions', 'outbound_clicks', 'lpv', 'leads', 'conversations'],
    metrics: [
      { id: 'spent', label: 'Spent', numerator: 'spend', denominator: null, format: 'money', direction: 'lower', monitor: false, min_denominator: 0 },
      { id: 'lpv_rate', label: 'LPV ratio', numerator: 'lpv', denominator: 'outbound_clicks', format: 'percent', direction: 'higher', monitor: true, min_denominator: 30 },
      { id: 'lead_rate', label: 'Lead ratio', numerator: 'leads', denominator: 'lpv', format: 'percent', direction: 'higher', monitor: true, min_denominator: 30 },
      { id: 'cpl', label: 'CPL', numerator: 'spend', denominator: 'leads', format: 'money', direction: 'lower', monitor: true, min_denominator: 10 },
      { id: 'conversation_rate', label: 'Conversation ratio', numerator: 'conversations', denominator: 'leads', format: 'percent', direction: 'higher', monitor: false, min_denominator: 10 },
      { id: 'cost_per_conversation', label: 'Biaya / conversation', numerator: 'spend', denominator: 'conversations', format: 'money', direction: 'lower', monitor: false, min_denominator: 10 },
    ],
    alerts_enabled: true, window_days: 7, drop_percent: 20, min_impressions: 1000, min_spend: 50000, lag_days: 2,
  };
}

/** Suggests a template from observed events. Both or neither kind of result leaves no suggestion. */
export function suggestTemplate(totals: Pick<Totals, 'purchases' | 'leads' | 'conversations'>, funnels: Pick<SavedFunnel, 'id' | 'stages' | 'metrics'>[]) {
  const leads = totals.leads + totals.conversations;
  const kind: TemplateKind | null = totals.purchases > 0 && leads === 0 ? 'transaction' : leads > 0 && totals.purchases === 0 ? 'lead' : null;
  const evidence = `Purchase ${Math.round(totals.purchases)} · lead ${Math.round(leads)}`;
  if (!kind) return { funnelId: null, kind: null, reason: `${evidence} · tidak ada saran` };
  const funnel = funnels.find(f => templateKind(f) === kind);
  if (!funnel) return { funnelId: null, kind, reason: `${evidence} · belum ada template ${TEMPLATE_KIND_LABELS[kind]}` };
  return { funnelId: funnel.id, kind, reason: `${evidence} → saran ${TEMPLATE_KIND_LABELS[kind]}` };
}

function compare(current: Totals, previous: Totals, metrics: FunnelMetric[]): MetricComparison[] {
  return metrics.map(m => { const a = metricValue(current, m), b = metricValue(previous, m); return { id: m.id, current: a, previous: b, change: relativeChange(a, b) }; });
}
function sum(groups: ReportGroup[], field: 'current' | 'previous'): Totals {
  const total = emptyTotals();
  for (const g of groups) for (const key of Object.keys(total) as (keyof Totals)[]) total[key] += Number(g[field][key]) || 0;
  return total;
}
export function median(values: number[]): number | null {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Splits landing-page groups into one section per template plus unassigned groups. */
export function assignTemplateSections(groups: ReportGroup[], funnels: SavedFunnel[], rules: TemplateRule[]) {
  const byFunnel = new Map<string, ReportGroup[]>(funnels.map(f => [f.id, []]));
  const unassigned: UnassignedGroup[] = [];
  for (const g of groups) {
    const urls = g.landing_page_urls;
    const rule = g.destination || urls.length === 1 ? matchDestinationTemplate(g, rules) : null;
    if (rule && byFunnel.has(rule.funnel_id)) { byFunnel.get(rule.funnel_id)!.push(g); continue; }
    unassigned.push({ ...g, reason: g.destination ? 'no_rule' : !urls.length ? 'no_url' : urls.length > 1 ? 'multi_url' : 'no_rule', suggestion: suggestTemplate(g.current, funnels) });
  }
  const sections: TemplateSection[] = funnels.map(f => {
    const members = byFunnel.get(f.id)!;
    const summary = sum(members, 'current'), previous = sum(members, 'previous');
    const mainMetric = templateMainMetric(f);
    const withMetrics = members.map(g => ({ ...g, metrics: compare(g.current, g.previous, f.metrics) })).sort((a, b) => b.current.spend - a.current.spend);
    return { key: f.id, funnelId: f.id, name: f.name, kind: templateKind(f), config: f, groups: withMetrics, summary, previous,
      metrics: compare(summary, previous, f.metrics), mainMetric,
      mainMedian: mainMetric ? median(members.map(g => metricValue(g.current, mainMetric)).filter((v): v is number => v !== null)) : null };
  });
  return { sections, unassigned: unassigned.sort((a, b) => b.current.spend - a.current.spend) };
}

/** Shared ad-response layer: judged the same way for website and CPAS ads. */
export function responseMetrics(world: 'website' | 'cpas'): FunnelMetric[] {
  return [
    { id: 'cpm', label: 'CPM', numerator: 'spend', denominator: 'impressions', multiplier: 1000, format: 'money', direction: 'lower', monitor: true, min_denominator: 1000 },
    { id: 'outbound_ctr', label: 'CTR outbound', numerator: 'outbound_clicks', denominator: 'impressions', format: 'percent', direction: 'higher', monitor: true, min_denominator: 1000 },
    { id: 'hook_rate', label: 'Hook rate', numerator: 'video_3s', denominator: 'impressions', format: 'percent', direction: 'higher', monitor: true, min_denominator: 1000 },
    world === 'website'
      ? { id: 'lpv_rate', label: 'LPV ratio', numerator: 'lpv', denominator: 'outbound_clicks', format: 'percent', direction: 'higher', monitor: true, min_denominator: 30 }
      : { id: 'purchase_per_click', label: 'Purchase per klik', numerator: 'purchases', denominator: 'outbound_clicks', format: 'percent', direction: 'higher', monitor: true, min_denominator: 30 },
  ];
}
/** CPAS results: Shopee purchases under Meta attribution, per ad. */
export function cpasMetrics(): FunnelMetric[] {
  return [
    { id: 'spent', label: 'Spent', numerator: 'spend', denominator: null, format: 'money', direction: 'lower', monitor: false, min_denominator: 0 },
    { id: 'outbound_ctr', label: 'CTR outbound', numerator: 'outbound_clicks', denominator: 'impressions', format: 'percent', direction: 'higher', monitor: true, min_denominator: 1000 },
    { id: 'outbound', label: 'Klik ke Shopee', numerator: 'outbound_clicks', denominator: null, format: 'number', direction: 'higher', monitor: false, min_denominator: 0 },
    { id: 'purchases', label: 'Purchases', numerator: 'purchases', denominator: null, format: 'number', direction: 'higher', monitor: false, min_denominator: 0 },
    { id: 'purchase_value', label: 'Purchase value', numerator: 'purchase_value', denominator: null, format: 'money', direction: 'higher', monitor: false, min_denominator: 0 },
    { id: 'cpp', label: 'CPP', numerator: 'spend', denominator: 'purchases', format: 'money', direction: 'lower', monitor: true, min_denominator: 10 },
    { id: 'roas', label: 'ROAS', numerator: 'purchase_value', denominator: 'spend', format: 'multiple', direction: 'higher', monitor: true, min_denominator: 1 },
  ];
}
export function cpasSection(groups: ReportGroup[], summary: Totals, previous: Totals): TemplateSection {
  const metrics = cpasMetrics();
  const config: FunnelConfig = { ...defaultLeadFunnel(), name: 'Purchase Shopee', description: 'Outbound → Shopee → purchase', stages: ['impressions', 'outbound_clicks', 'purchases'], metrics };
  const mainMetric = metrics.find(m => m.id === 'cpp')!;
  const members = groups.map(g => ({ ...g, metrics: compare(g.current, g.previous, metrics) })).sort((a, b) => b.current.spend - a.current.spend);
  return { key: 'cpas', funnelId: null, name: 'Purchase Shopee', kind: 'transaction', config, groups: members, summary, previous,
    metrics: compare(summary, previous, metrics), mainMetric, mainMedian: median(members.map(g => metricValue(g.current, mainMetric)).filter((v): v is number => v !== null)) };
}
export function compareMetrics(current: Totals, previous: Totals, metrics: FunnelMetric[]) { return compare(current, previous, metrics); }
