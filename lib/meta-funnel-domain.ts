// Pure reporting rules shared by the dashboard, sync worker, and tests.
import { CEP_KEYS, FUNNEL_KEYS, GROUPING_OPTIONS, parseRooveAdName, type AdGrouping, type CepKey, type NamingFunnelKey } from './meta-ad-naming';
import { landingPageGroup, normalizeLandingPages } from './meta-ad-destinations';
import { ctwaLabel, type CtwaDestination } from './meta-ctwa-destinations';
import { cepGroupKey } from './meta-cep-key';
export const MEASURES = {
  spend: 'Spent', impressions: 'Impressions', clicks: 'All clicks', link_clicks: 'Link clicks',
  outbound_clicks: 'Outbound clicks', lpv: 'Landing page views', view_content: 'View content',
  atc: 'Add to cart', checkout: 'Initiate checkout', purchases: 'Purchases', purchase_value: 'Purchase value',
  video_plays: 'Video plays', video_3s: 'Video views 3s', thruplay: 'ThruPlay',
  video_25: 'Video 25%', video_50: 'Video 50%', video_75: 'Video 75%', video_100: 'Video 100%',
  leads: 'Leads', conversations: 'Messaging conversations', replies: 'Messaging first replies',
  instagram_profile_visits: 'Instagram profile visits',
} as const;
export type Measure = keyof typeof MEASURES;
export type Totals = Record<Exclude<Measure, 'instagram_profile_visits'>, number> & { instagram_profile_visits: number | null };
export type FunnelMetric = {
  id: string; label: string; numerator: Measure; denominator: Measure | null;
  format: 'number' | 'percent' | 'money' | 'multiple'; direction: 'higher' | 'lower'; monitor: boolean;
  min_denominator: number; multiplier?: number;
};
export type FunnelConfig = {
  name: string; description: string; name_filter: string; match: 'contains' | 'exact';
  account_ids: string[]; stages: Measure[]; metrics: FunnelMetric[];
  alerts_enabled: boolean; window_days: number; drop_percent: number;
  min_impressions: number; min_spend: number; lag_days: number;
  group_by?: AdGrouping; cep_keys?: CepKey[]; funnel_keys?: NamingFunnelKey[];
  naming_status?: 'all' | 'tagged' | 'untagged';
};
export type SavedFunnel = FunnelConfig & { id: string; updated_at: string };
export type AdFact = {
  account_id: string; account_name: string; ad_id: string; ad_name: string;
  metric_date: string; currency: string; metrics: Totals; creative_id?: string | null;
  landing_page_urls?: string[];
  campaign_id?: string | null; campaign_objective?: string | null;
  cep_key?: string | null; intention_key?: string | null;
  landing_page_source?: 'meta' | 'cache' | 'verified' | 'unknown';
  destination?: CtwaDestination | null;
  raw_insights?: { adset_id?: string };
};
export type Coverage = { account_id: string; metric_date: string };
export type AdCreative = {
  account_id: string; ad_id: string; creative_id: string | null; name: string;
  thumbnail_url: string | null; video_id: string | null; body: string | null;
  landing_page_urls?: string[];
};
export type VerifiedDestination = { account_id: string; ad_id: string; creative_id: string; landing_page_url: string };
export type GroupComparison = {
  key: string; name: string; current: Totals; previous: Totals; ad_ids: string[];
  accounts: string[]; creatives: AdCreative[];
  ad_names: string[]; categories: { cep: CepKey; funnel: NamingFunnelKey }[];
  classified: boolean;
  landing_page_urls: string[];
  verified_ad_ids: string[];
  destination?: CtwaDestination;
  metrics: { id: string; current: number | null; previous: number | null; change: number | null }[];
};

export function metaPerformanceMetrics(): FunnelMetric[] {
  return [
    { id: 'spent', label: 'Spent', numerator: 'spend', denominator: null, format: 'money', direction: 'lower', monitor: false, min_denominator: 0 },
    { id: 'cpm', label: 'CPM', numerator: 'spend', denominator: 'impressions', multiplier: 1000, format: 'money', direction: 'lower', monitor: true, min_denominator: 1000 },
    { id: 'outbound_ctr', label: 'CTR (outbound link)', numerator: 'outbound_clicks', denominator: 'impressions', format: 'percent', direction: 'higher', monitor: true, min_denominator: 1000 },
    { id: 'lpv_rate', label: 'LPV ratio', numerator: 'lpv', denominator: 'outbound_clicks', format: 'percent', direction: 'higher', monitor: true, min_denominator: 30 },
    { id: 'atc_rate', label: 'ATC ratio', numerator: 'atc', denominator: 'lpv', format: 'percent', direction: 'higher', monitor: true, min_denominator: 30 },
    { id: 'ic_rate', label: 'IC ratio', numerator: 'checkout', denominator: 'atc', format: 'percent', direction: 'higher', monitor: true, min_denominator: 30 },
    { id: 'purchase_rate', label: 'Purchase ratio', numerator: 'purchases', denominator: 'checkout', format: 'percent', direction: 'higher', monitor: true, min_denominator: 10 },
    { id: 'cpic', label: 'CPIC', numerator: 'spend', denominator: 'checkout', format: 'money', direction: 'lower', monitor: true, min_denominator: 10 },
    { id: 'cpp', label: 'CPP', numerator: 'spend', denominator: 'purchases', format: 'money', direction: 'lower', monitor: true, min_denominator: 10 },
  ];
}

export function defaultFunnel(): FunnelConfig {
  return {
    name: 'Landing page performance', description: 'Outbound click → landing page → add to cart / initiate checkout → purchase',
    name_filter: '', match: 'contains', account_ids: [],
    group_by: 'landing_page', cep_keys: [], funnel_keys: [], naming_status: 'all',
    stages: ['impressions', 'outbound_clicks', 'lpv', 'atc', 'checkout', 'purchases'],
    metrics: metaPerformanceMetrics(),
    alerts_enabled: true, window_days: 7, drop_percent: 20, min_impressions: 1000, min_spend: 50000, lag_days: 2,
  };
}

export function validateFunnel(input: unknown): FunnelConfig {
  if (!input || typeof input !== 'object') throw new Error('Konfigurasi funnel tidak valid.');
  const c = input as FunnelConfig;
  const validMeasure = (v: unknown): v is Measure => typeof v === 'string' && Object.hasOwn(MEASURES, v);
  const bounded = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 120
    || typeof c.description !== 'string' || c.description.length > 2000
    || typeof c.name_filter !== 'string' || c.name_filter.length > 200
    || !['contains', 'exact'].includes(c.match)
    || !Array.isArray(c.account_ids) || c.account_ids.length > 100 || c.account_ids.some(a => typeof a !== 'string' || !/^act_\d+$/.test(a))
    || !Array.isArray(c.stages) || c.stages.length < 2 || c.stages.length > 12 || !c.stages.every(validMeasure)
    || new Set(c.stages).size !== c.stages.length
    || !Array.isArray(c.metrics) || !c.metrics.length || c.metrics.length > 12
    || !Number.isInteger(c.window_days) || !bounded(c.window_days, 1, 30)
    || !Number.isInteger(c.lag_days) || !bounded(c.lag_days, 1, 7)
    || !bounded(c.drop_percent, 1, 100) || !bounded(c.min_impressions, 0, 1e9) || !bounded(c.min_spend, 0, 1e12)
    || typeof c.alerts_enabled !== 'boolean') throw new Error('Nama, tahapan, periode, atau ambang funnel tidak valid.');
  for (const m of c.metrics) {
    if (!m || typeof m.id !== 'string' || !/^[a-zA-Z0-9_-]{1,50}$/.test(m.id)
      || typeof m.label !== 'string' || !m.label.trim() || m.label.length > 80
      || !validMeasure(m.numerator) || (m.denominator !== null && !validMeasure(m.denominator))
      || !['number', 'percent', 'money', 'multiple'].includes(m.format)
      || !['higher', 'lower'].includes(m.direction) || typeof m.monitor !== 'boolean'
      || !bounded(m.min_denominator, 0, 1e12) || (m.multiplier !== undefined && !bounded(m.multiplier, 1, 1000))) throw new Error('Definisi metrik tidak valid.');
  }
  if (new Set(c.metrics.map(m => m.id)).size !== c.metrics.length) throw new Error('ID metrik harus unik.');
  const validKeys = (v: unknown, keys: object) => Array.isArray(v) && v.length <= Object.keys(keys).length && v.every(k => typeof k === 'string' && Object.hasOwn(keys, k));
  if ((c.group_by !== undefined && !Object.hasOwn(GROUPING_OPTIONS, c.group_by))
    || !validKeys(c.cep_keys ?? [], CEP_KEYS) || !validKeys(c.funnel_keys ?? [], FUNNEL_KEYS)
    || !['all', 'tagged', 'untagged'].includes(c.naming_status ?? 'all')) throw new Error('Agregasi atau filter naming Roove tidak valid.');
  return {
    name: c.name.trim(), description: c.description.trim(), name_filter: c.name_filter.trim(), match: c.match,
    account_ids: [...new Set(c.account_ids)], stages: [...c.stages], metrics: c.metrics.map(m => ({ ...m })),
    alerts_enabled: c.alerts_enabled, window_days: c.window_days, drop_percent: c.drop_percent,
    min_impressions: c.min_impressions, min_spend: c.min_spend, lag_days: c.lag_days,
    // Preserve ad-name monitoring for configurations saved before naming support.
    group_by: c.group_by ?? 'ad_name', cep_keys: [...new Set(c.cep_keys ?? [])], funnel_keys: [...new Set(c.funnel_keys ?? [])], naming_status: c.naming_status ?? 'all',
  };
}

export function shiftDay(date: string, days: number) {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string) { return Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1; }
export function validateRange(from: string, to: string, maxDays = 93) {
  for (const d of [from, to]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) throw new Error('Tanggal tidak valid.');
  }
  if (from > to || daysBetween(from, to) > maxDays) throw new Error(`Pilih rentang maksimal ${maxDays} hari.`);
}
export function normalizedName(name: string) { return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID'); }
export function matchesFunnel(row: AdFact, config: FunnelConfig) {
  if (!matchesNameAndAccount(row, config)) return false;
  if (config.group_by === 'landing_page' || config.group_by === 'ad_id' || config.group_by === 'cep_intention') return true;
  const parsed = parseRooveAdName(row.ad_name);
  if (config.naming_status === 'tagged' && !parsed.valid || config.naming_status === 'untagged' && parsed.valid) return false;
  if (config.cep_keys?.length && (!parsed.cep || !config.cep_keys.includes(parsed.cep))) return false;
  if (config.funnel_keys?.length && (!parsed.funnel || !config.funnel_keys.includes(parsed.funnel))) return false;
  return true;
}
function matchesNameAndAccount(row: AdFact, config: FunnelConfig) {
  if (config.account_ids.length && !config.account_ids.includes(row.account_id)) return false;
  const name = normalizedName(row.ad_name); const filter = normalizedName(config.name_filter);
  return !filter || (config.match === 'exact' ? name === filter : name.includes(filter));
}
export function adGroup(row: AdFact, config: FunnelConfig) {
  if (config.group_by === 'ad_id') return { key: `ad:${row.account_id}:${row.ad_id}`, name: row.ad_name || row.ad_id };
  if (config.group_by === 'landing_page') return row.destination ? { key: row.destination.key, name: ctwaLabel(row.destination) } : landingPageGroup(row.landing_page_urls);
  // Mirrors migration 216: mapped CEP/intention keys, '__unknown__' when absent.
  if (config.group_by === 'cep_intention') { const key = cepGroupKey(row.cep_key, row.intention_key); return { key, name: key }; }
  const parsed = parseRooveAdName(row.ad_name);
  const nameKey = normalizedName(row.ad_name) || `(unnamed:${row.ad_id})`;
  if (!config.group_by || config.group_by === 'ad_name') return { key: nameKey, name: row.ad_name || row.ad_id };
  // Never merge unrelated legacy names into one alarm group or guess tags from copy.
  if (!parsed.valid) return { key: `unclassified:${nameKey}`, name: `Belum terklasifikasi · ${row.ad_name || row.ad_id}` };
  if (config.group_by === 'cep') return { key: `cep:${parsed.cep}`, name: CEP_KEYS[parsed.cep!] };
  if (config.group_by === 'funnel_stage') return { key: `funnel:${parsed.funnel}`, name: FUNNEL_KEYS[parsed.funnel!] };
  return { key: `cep_funnel:${parsed.cep}:${parsed.funnel}`, name: `${CEP_KEYS[parsed.cep!]} · ${FUNNEL_KEYS[parsed.funnel!]}` };
}
export function withLandingPages(rows: AdFact[], creatives: AdCreative[], verified: VerifiedDestination[] = []): AdFact[] {
  const cache = new Map(creatives.map(c => [`${c.account_id}:${c.ad_id}`, c]));
  const overrides = new Map(verified.map(v => [`${v.account_id}:${v.ad_id}`, v]));
  return rows.map(row => {
    const key = `${row.account_id}:${row.ad_id}`; const creative = cache.get(key); const override = overrides.get(key);
    const observed = normalizeLandingPages(row.landing_page_urls); const cached = normalizeLandingPages(creative?.landing_page_urls);
    // Preserve observed historical destinations. Verified URLs only fill missing API data.
    if (observed.length) return { ...row, landing_page_urls: observed, landing_page_source: 'meta' as const };
    if (cached.length && (!row.creative_id || row.creative_id === creative?.creative_id)) return { ...row, landing_page_urls: cached, landing_page_source: 'cache' as const };
    if (override && (row.creative_id || creative?.creative_id) === override.creative_id) {
      const urls = normalizeLandingPages([override.landing_page_url]);
      if (urls.length) return { ...row, landing_page_urls: urls, landing_page_source: 'verified' as const };
    }
    return { ...row, landing_page_urls: [], landing_page_source: 'unknown' as const };
  });
}
export function destinationQuality(rows: AdFact[], config: FunnelConfig, from: string, to: string) {
  const missing = new Map<string, { account_id: string; ad_id: string; account_name: string; ad_name: string }>(); const multiple = new Set<string>(); const known = new Set<string>();
  for (const row of rows) {
    if (row.metric_date < from || row.metric_date > to || !matchesFunnel(row, config)) continue;
    const key = `${row.account_id}:${row.ad_id}`; const urls = normalizeLandingPages(row.landing_page_urls);
    if (!urls.length) missing.set(key, { account_id: row.account_id, ad_id: row.ad_id, account_name: row.account_name, ad_name: row.ad_name });
    else if (urls.length > 1) multiple.add(key); else known.add(urls[0]);
  }
  return { urls: known.size, missing_ads: missing.size, multi_ads: multiple.size, missing: [...missing.values()].slice(0, 20) };
}
export function namingQuality(rows: AdFact[], config: FunnelConfig, from: string, to: string) {
  const names = new Map<string, { name: string; valid: boolean; reason: string | null; spend: number; ad_ids: Set<string> }>();
  for (const row of rows) {
    if (row.metric_date < from || row.metric_date > to || !matchesNameAndAccount(row, config)) continue;
    const parsed = parseRooveAdName(row.ad_name); const key = row.ad_name.trim() || row.ad_id;
    if (!names.has(key)) names.set(key, { name: row.ad_name || row.ad_id, valid: parsed.valid, reason: parsed.reason, spend: 0, ad_ids: new Set() });
    const entry = names.get(key)!; entry.spend += row.metrics.spend; entry.ad_ids.add(`${row.account_id}:${row.ad_id}`);
  }
  const entries = [...names.values()]; const invalid = entries.filter(n => !n.valid).sort((a, b) => b.spend - a.spend);
  return { valid_names: entries.length - invalid.length, invalid_names: invalid.length,
    valid_spend: entries.filter(n => n.valid).reduce((sum, n) => sum + n.spend, 0), invalid_spend: invalid.reduce((sum, n) => sum + n.spend, 0),
    invalid: invalid.slice(0, 30).map(n => ({ name: n.name, reason: n.reason, spend: n.spend, ads: n.ad_ids.size })) };
}
export function emptyTotals(): Totals { return Object.fromEntries(Object.keys(MEASURES).map(k => [k, 0])) as Totals; }
/** An omitted/new metric is unknown, rather than silently converted to zero. */
export function sumMetricTotals(items: Partial<Totals>[]): Totals {
  const total = emptyTotals();
  for (const row of items) for (const key of Object.keys(MEASURES) as Measure[]) {
    if (key === 'instagram_profile_visits') {
      total[key] = total[key] === null || row[key] == null ? null : total[key]! + row[key]!;
    } else total[key] += Number(row[key]) || 0;
  }
  return total;
}
export function totalFacts(rows: AdFact[]): Totals { return sumMetricTotals(rows.map(r => r.metrics)); }
export function metricValue(total: Totals, m: FunnelMetric): number | null {
  const numerator = total[m.numerator];
  if (numerator == null) return null;
  if (m.denominator === null) return numerator * (m.multiplier ?? 1);
  const denominator = total[m.denominator];
  return denominator != null && denominator > 0 ? numerator / denominator * (m.multiplier ?? 1) : null;
}
export function relativeChange(current: number | null, previous: number | null) {
  return current === null || previous === null || previous <= 0 ? null : (current - previous) / previous * 100;
}
export function compareGroups(rows: AdFact[], config: FunnelConfig, from: string, to: string, creatives: AdCreative[] = []): GroupComparison[] {
  const prevTo = shiftDay(from, -1); const prevFrom = shiftDay(from, -daysBetween(from, to));
  const groups = new Map<string, AdFact[]>();
  for (const row of rows) {
    if (!matchesFunnel(row, config) || row.metric_date < prevFrom || row.metric_date > to) continue;
    const key = adGroup(row, config).key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return [...groups].map(([key, facts]) => {
    const current = totalFacts(facts.filter(r => r.metric_date >= from));
    const previous = totalFacts(facts.filter(r => r.metric_date >= prevFrom && r.metric_date <= prevTo));
    const ids = new Set(facts.map(r => `${r.account_id}:${r.ad_id}`));
    const categories = new Map<string, { cep: CepKey; funnel: NamingFunnelKey }>();
    for (const row of facts) { const parsed = parseRooveAdName(row.ad_name); if (parsed.valid) categories.set(`${parsed.cep}:${parsed.funnel}`, { cep: parsed.cep!, funnel: parsed.funnel! }); }
    return {
      key, name: adGroup(facts[facts.length - 1], config).name, current, previous,
      ...(config.group_by === 'landing_page' && facts[0].destination ? { destination: facts[0].destination } : {}),
      ad_names: [...new Set(facts.map(r => r.ad_name))], categories: [...categories.values()], classified: categories.size > 0,
      landing_page_urls: normalizeLandingPages(facts.flatMap(r => r.landing_page_urls ?? [])),
      verified_ad_ids: [...new Set(facts.filter(r => r.landing_page_source === 'verified').map(r => r.ad_id))],
      ad_ids: [...new Set(facts.map(r => r.ad_id))], accounts: [...new Set(facts.map(r => r.account_name))],
      creatives: creatives.filter(c => ids.has(`${c.account_id}:${c.ad_id}`)),
      metrics: config.metrics.map(m => {
        const a = metricValue(current, m); const b = metricValue(previous, m);
        return { id: m.id, current: a, previous: b, change: relativeChange(a, b) };
      }),
    };
  }).sort((a, b) => b.current.spend - a.current.spend);
}
export function trend(rows: AdFact[], config: FunnelConfig, from: string, to: string, period: 'day' | 'week' | 'month', groupKey?: string) {
  const buckets = new Map<string, AdFact[]>();
  const bucket = (date: string) => {
    if (period === 'month') return date.slice(0, 7) + '-01';
    if (period === 'day') return date;
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    return shiftDay(date, -(weekday + 6) % 7);
  };
  for (let date = from; date <= to; date = shiftDay(date, 1)) buckets.set(bucket(date), []);
  for (const r of rows) {
    if (r.metric_date < from || r.metric_date > to || !matchesFunnel(r, config)
      || (groupKey && adGroup(r, config).key !== groupKey)) continue;
    buckets.get(bucket(r.metric_date))?.push(r);
  }
  return [...buckets].map(([date, facts]) => {
    const totals = totalFacts(facts);
    return { date, totals, metrics: Object.fromEntries(config.metrics.map(m => [m.id, metricValue(totals, m)])) };
  });
}

export function hasCoverage(coverage: Coverage[], accounts: string[], from: string, to: string) {
  if (!accounts.length) return false;
  const dates = new Set(coverage.map(c => `${c.account_id}:${c.metric_date}`));
  for (const account of accounts) for (let d = from; d <= to; d = shiftDay(d, 1)) if (!dates.has(`${account}:${d}`)) return false;
  return true;
}
export function diagnose(group: GroupComparison, config?: FunnelConfig): string[] {
  const a = group.current; const b = group.previous;
  const ratio = (n: Measure, d: Measure, t: Totals) => { const numerator = t[n], denominator = t[d]; return numerator != null && denominator != null && denominator > 0 ? numerator / denominator : null; };
  const fell = (n: Measure, d: Measure) => {
    const x = ratio(n, d, a); const y = ratio(n, d, b);
    return x !== null && y !== null && y > 0 && x < y * 0.85;
  };
  const insights: string[] = [];
  // Tiny video events can appear on image ads; do not diagnose a video hook from them.
  const videoSample = a.video_3s >= 100 && b.video_3s >= 100 && (group.creatives.some(c => c.video_id)
    || a.video_3s >= a.impressions * .05 && b.video_3s >= b.impressions * .05);
  if (videoSample && fell('video_3s', 'impressions')) insights.push('Hook video melemah: rasio video 3 detik terhadap impression turun. Uji pembukaan dan pesan utama creative.');
  if (videoSample && fell('thruplay', 'video_3s')) insights.push('Retensi video turun setelah pembukaan. Periksa tempo, durasi, dan relevansi isi video.');
  if (insights.length && group.creatives.some(c => c.video_id) && group.creatives.some(c => !c.video_id)) insights.push('Kelompok mencampur video dan creative lain. Perubahan proporsi delivery juga dapat mengubah rasio video agregat.');
  const landing = config?.group_by === 'landing_page';
  if (fell(landing ? 'outbound_clicks' : 'link_clicks', 'impressions')) insights.push(`${landing ? 'Outbound CTR' : 'Link CTR'} turun: respons terhadap creative/offer melemah. Bandingkan pesan, CTA, dan distribusi audiens.`);
  if (fell('lpv', landing ? 'outbound_clicks' : 'link_clicks')) insights.push('Klik ke landing page view turun. Periksa kecepatan halaman, URL, serta tracking LPV.');
  if (landing && fell('atc', 'lpv')) insights.push('ATC terhadap LPV turun. Periksa relevansi landing page, penawaran, dan tombol add to cart.');
  if (landing && fell('checkout', 'lpv')) insights.push('IC terhadap LPV turun. Periksa alur menuju checkout, stok, dan tracking initiate checkout.');
  if (fell('purchases', landing ? 'checkout' : 'lpv')) insights.push(`${landing ? 'Purchase terhadap IC' : 'LPV ke purchase'} turun. Periksa offer, stok, checkout, dan tracking; creative belum tentu penyebabnya.`);
  const cpmA = ratio('spend', 'impressions', a); const cpmB = ratio('spend', 'impressions', b);
  if (cpmA !== null && cpmB !== null && cpmB > 0 && cpmA > cpmB * 1.15) insights.push('Biaya impression naik. Perubahan auction, audiens, atau placement dapat ikut menekan efisiensi.');
  if (!insights.length) insights.push('Perubahan belum terlokalisasi ke satu tahap. Periksa perubahan budget, distribusi ad, dan keterlambatan atribusi.');
  return insights;
}

export function evaluateDeclines(rows: AdFact[], coverage: Coverage[], config: FunnelConfig, accountIds: string[], end: string, creatives: AdCreative[] = []) {
  const from = shiftDay(end, 1 - config.window_days);
  const baselineFrom = shiftDay(from, -config.window_days);
  const scopedAccounts = accountIds.filter(a => !config.account_ids.length || config.account_ids.includes(a));
  if (!config.alerts_enabled || !hasCoverage(coverage, scopedAccounts, baselineFrom, end)) return [];
  return compareGroups(rows, config, from, end, creatives).flatMap(group => {
    if (config.group_by === 'landing_page' && !group.destination && group.landing_page_urls.length !== 1) return [];
    if (group.current.impressions < config.min_impressions || group.previous.impressions < config.min_impressions
      || group.current.spend < config.min_spend || group.previous.spend < config.min_spend) return [];
    return config.metrics.flatMap(metric => {
      const comparison = group.metrics.find(m => m.id === metric.id)!;
      if (!metric.monitor || comparison.change === null
        || (metric.denominator && ((group.current[metric.denominator] ?? 0) < metric.min_denominator || (group.previous[metric.denominator] ?? 0) < metric.min_denominator))) return [];
      const decline = metric.direction === 'higher' ? -comparison.change : comparison.change;
      if (decline < config.drop_percent) return [];
      // Rank individual ad IDs within the name group, preserving their account identity.
      const details = new Map<string, AdFact[]>();
      for (const r of rows) if (matchesFunnel(r, config) && adGroup(r, config).key === group.key
        && r.metric_date >= baselineFrom && r.metric_date <= end) {
        const key = `${r.account_id}:${r.ad_id}`;
        if (!details.has(key)) details.set(key, []);
        details.get(key)!.push(r);
      }
      const suspects = [...details.values()].flatMap(facts => {
        const current = totalFacts(facts.filter(r => r.metric_date >= from));
        const previous = totalFacts(facts.filter(r => r.metric_date < from));
        const change = relativeChange(metricValue(current, metric), metricValue(previous, metric));
        if (change === null || (metric.direction === 'higher' ? -change : change) <= 0
          || (metric.denominator && ((current[metric.denominator] ?? 0) < metric.min_denominator || (previous[metric.denominator] ?? 0) < metric.min_denominator))) return [];
        return [{ ad_id: facts[0].ad_id, ad_name: facts[facts.length - 1].ad_name, account_name: facts[0].account_name,
          account_id: facts[0].account_id, spend: current.spend, change,
          creative: creatives.find(c => c.account_id === facts[0].account_id && c.ad_id === facts[0].ad_id) || null }];
      }).sort((a, b) => b.spend - a.spend).slice(0, 5);
      return [{ group_key: group.key, ad_name: group.name, metric_id: metric.id, metric_label: metric.label,
        group_by: config.group_by ?? 'ad_name', categories: group.categories,
        current: comparison.current, previous: comparison.previous, change: comparison.change,
        format: metric.format, from, to: end, baseline_from: baselineFrom, baseline_to: shiftDay(from, -1),
        insights: diagnose(group, config), suspects }];
    });
  });
}
