// Pemetaan Ads as a worklist: ads that delivered in the selected range, ranked
// by spend, with the labels that are still missing. Pure rules; the action
// supplies mapping rows, per-ad delivery, verified URLs and destination metadata.
import { CEP_KEYS, FUNNEL_KEYS } from './meta-ad-naming';
import { effectiveMappingValue, mappingUnit, type AdMapping, type MappingUnit } from './meta-ad-mapping';
import type { CepCategory } from './meta-ad-taxonomy';
import type { MetaAdChannel } from './meta-ad-channels';
import type { AdDimensionFilters } from './meta-ad-dimensions';
import type { VerifiedDestination } from './meta-funnel-domain';

export const WORKLIST_ISSUES = ['cep', 'intention', 'destination', 'channel'] as const;
export type WorklistIssue = typeof WORKLIST_ISSUES[number];
export const WORKLIST_ISSUE_LABELS: Record<WorklistIssue, string> = {
  cep: 'CEP belum terpetakan', intention: 'Intention belum terpetakan', destination: 'Tujuan belum terbaca', channel: 'Jenis iklan perlu verifikasi',
};
export type AdActivity = { account_id: string; ad_id: string; spend: number; impressions: number; last_active: string | null };
export type DestinationHint = { account_id: string; ad_id: string; creative_id: string | null; classification: string | null; metadata: { destination_type?: string | null; urls?: string[] } | null };
export type WorklistLabel = { key: string | null; label: string; manual: boolean; recognized: boolean };
export type WorklistRow = {
  account_id: string; ad_id: string; ad_name: string; account_name: string; effective_status: string | null;
  ad_channel: MetaAdChannel; ad_channel_reason: string | null; campaign_name: string | null; campaign_objective: string | null;
  ceps: WorklistLabel[]; brandId: number | null; cep: WorklistLabel; intention: WorklistLabel; urls: string[]; urlSource: 'meta' | 'verified' | 'whatsapp' | 'shopee' | null;
  spend: number; impressions: number; lastActive: string | null; active: boolean; issues: WorklistIssue[];
  revision: number; creative_id: string | null; overrides: AdMapping['overrides']; auto_mapping: AdMapping['auto_mapping'];
  source: AdMapping['source']; first_seen_at: string; last_seen_at: string;
};
export type WorklistQuery = {
  includeInactive?: boolean; issue?: WorklistIssue | null; search?: string; accountId?: string | null; channel?: MetaAdChannel | null;
  filters?: AdDimensionFilters; page?: number; pageSize?: number;
};
export type WorklistInput = WorklistQuery & {
  mappings: AdMapping[]; activity: AdActivity[]; verified: VerifiedDestination[]; destinations?: DestinationHint[];
  accounts: { account_id: string; account_name: string }[]; units?: MappingUnit[]; catalog?: CepCategory[]; intentions?: CepCategory[];
};
export type WorklistTile = { issue: WorklistIssue; label: string; ads: number; spend: number };
export type UnitUsage = { dimension: string; unit_key: string; label: string; ads: number; spend: number };

const known = { cep: CEP_KEYS as Record<string, string>, intention: FUNNEL_KEYS as Record<string, string> };
function label(ad: AdMapping, dimension: 'cep' | 'intention'): WorklistLabel {
  const key = effectiveMappingValue(ad, dimension);
  if (!key || (dimension === 'intention' && !Object.hasOwn(known.intention, key)) || (dimension === 'cep' && ad.cep_keys === undefined && !Object.hasOwn(known.cep, key))) return { key: null, label: 'Belum terpetakan', manual: dimension === 'cep' ? ad.overrides.ceps !== undefined || ad.overrides.cep !== undefined : ad.overrides.intention !== undefined, recognized: false };
  const unit = mappingUnit(dimension, key);
  return { key: unit.key, label: unit.label.replace(/^Kesehatan /u, ''), manual: ad.overrides[dimension] !== undefined, recognized: Object.hasOwn(known[dimension], unit.key) };
}

/** Rows ranked by spend; issues are what the brand report cannot read for the ad. */
export function buildWorklistRows(input: Pick<WorklistInput, 'mappings' | 'activity' | 'verified' | 'destinations' | 'accounts' | 'catalog' | 'intentions'>): WorklistRow[] {
  const activity = new Map(input.activity.map(a => [`${a.account_id}:${a.ad_id}`, a]));
  const verified = new Map(input.verified.map(v => [`${v.account_id}:${v.ad_id}`, v]));
  const hints = new Map((input.destinations || []).map(d => [`${d.account_id}:${d.ad_id}`, d]));
  const names = new Map(input.accounts.map(a => [a.account_id, a.account_name]));
  return input.mappings.map(ad => {
    const key = `${ad.account_id}:${ad.ad_id}`;
    const delivery = activity.get(key), candidate = hints.get(key), verifiedUrl = verified.get(key);
    const hint = ad.creative_id && candidate?.creative_id === ad.creative_id ? candidate : undefined;
    const channel: MetaAdChannel = ad.ad_channel || 'unknown';
    let urls = ad.landing_page_urls, urlSource: WorklistRow['urlSource'] = ad.landing_page_urls.length ? 'meta' : null;
    if (!urls.length && hint?.metadata?.urls?.length) { urls = hint.metadata.urls; urlSource = 'meta'; }
    if (!urls.length && verifiedUrl && verifiedUrl.creative_id === ad.creative_id) { urls = [verifiedUrl.landing_page_url]; urlSource = 'verified'; }
    if (!urls.length && hint?.metadata?.destination_type === 'WHATSAPP') urlSource = 'whatsapp';
    if (!urls.length && channel === 'cpas') urlSource = 'shopee';
    const ceps = (ad.cep_keys ?? (label(ad, 'cep').key ? [label(ad, 'cep').key!] : [])).map(key => ({ key, label: input.catalog?.find(c => c.brand_id === ad.brand_id && c.key === key)?.label || mappingUnit('cep', key).label.replace(/^Kesehatan /u, ''), manual: ad.cep_source === 'manual' || ad.overrides.ceps !== undefined || ad.overrides.cep !== undefined, recognized: true }));
    const cep = ceps.length ? { ...ceps[0], label: ceps.map(c => c.label).join(' · ') } : label({ ...ad, cep_keys: [] }, 'cep');
    const found = input.intentions?.find(c => c.brand_id === ad.brand_id && c.key === ad.intention_key);
    const intention = found ? { key: found.key, label: found.label, manual: ad.overrides.intention !== undefined, recognized: true } : label(ad, 'intention');
    const issues: WorklistIssue[] = [];
    if (!cep.key) issues.push('cep');
    if (!intention.key) issues.push('intention');
    if (!urlSource) issues.push('destination');
    if (channel === 'unknown') issues.push('channel');
    return { account_id: ad.account_id, ad_id: ad.ad_id, ad_name: ad.ad_name || `(Tanpa nama) ${ad.ad_id}`, account_name: names.get(ad.account_id) || ad.account_id,
      effective_status: ad.effective_status, ad_channel: channel, ad_channel_reason: ad.ad_channel_reason || null,
      campaign_name: ad.campaign_name || null, campaign_objective: ad.campaign_objective || null, ceps, brandId: ad.brand_id ?? null, cep, intention, urls, urlSource,
      spend: delivery?.spend || 0, impressions: delivery?.impressions || 0, lastActive: delivery?.last_active || null, active: !!delivery && delivery.impressions > 0, issues,
      revision: ad.revision, creative_id: ad.creative_id, overrides: ad.overrides, auto_mapping: ad.auto_mapping, source: ad.source, first_seen_at: ad.first_seen_at, last_seen_at: ad.last_seen_at };
  }).sort((a, b) => Number(b.active) - Number(a.active) || b.spend - a.spend || b.impressions - a.impressions || b.last_seen_at.localeCompare(a.last_seen_at) || a.ad_id.localeCompare(b.ad_id));
}

export function matchesWorklistQuery(row: WorklistRow, query: WorklistQuery): boolean {
  if (query.accountId && row.account_id !== query.accountId) return false;
  if (query.channel && row.ad_channel !== query.channel) return false;
  const filters = query.filters || {};
  if (filters.cep && !(row.ceps.length ? row.ceps.map(c => c.key!) : ['__unknown__']).includes(filters.cep)) return false;
  if (filters.intention && (row.intention.key || '__unknown__') !== filters.intention) return false;
  if (filters.objective && (row.campaign_objective || '__unknown__') !== filters.objective) return false;
  return true;
}
function matchesSearch(row: WorklistRow, search: string) {
  const needle = search.trim().toLocaleLowerCase('id-ID');
  if (!needle) return true;
  return [row.ad_name, row.ad_id, row.campaign_name || '', ...row.urls].some(v => v.toLocaleLowerCase('id-ID').includes(needle));
}

/** The page: tiles over the scope, then the issue and search filters, then paging. */
export function buildWorklist(input: WorklistInput) {
  const all = buildWorklistRows(input);
  const scope = all.filter(r => (input.includeInactive || r.active) && matchesWorklistQuery(r, input));
  const tiles: WorklistTile[] = WORKLIST_ISSUES.map(issue => {
    const hit = scope.filter(r => r.issues.includes(issue));
    return { issue, label: WORKLIST_ISSUE_LABELS[issue], ads: hit.length, spend: hit.reduce((s, r) => s + r.spend, 0) };
  });
  const filtered = scope.filter(r => (!input.issue || r.issues.includes(input.issue)) && matchesSearch(r, input.search || ''));
  const pageSize = Math.max(1, Math.min(200, input.pageSize || 50)), page = Math.max(1, input.page || 1);
  const units: UnitUsage[] = (input.units || []).filter(u => u.dimension === 'cep' || u.dimension === 'intention').map(u => {
    const users = all.filter(r => r.overrides[u.dimension as 'cep' | 'intention'] === undefined && (u.dimension !== 'cep' || r.overrides.ceps === undefined) && r.auto_mapping.tags.some(t => t.dimension === u.dimension && t.key === u.unit_key));
    return { dimension: u.dimension, unit_key: u.unit_key, label: u.label, ads: users.length, spend: users.reduce((s, r) => s + r.spend, 0) };
  }).sort((a, b) => b.spend - a.spend || b.ads - a.ads);
  const activeSpend = all.filter(r => r.active).reduce((s, r) => s + r.spend, 0);
  return { rows: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize, tiles,
    scopeAds: scope.length, scopeSpend: scope.reduce((s, r) => s + r.spend, 0), activeAds: all.filter(r => r.active).length, activeSpend,
    inactiveAds: all.filter(r => !r.active).length, clean: scope.every(r => !r.issues.length), units };
}

/** Inline pickers expose only the brand catalog and the three official intentions. */
export function labelOptions(dimension: 'cep' | 'intention', _rows: Pick<WorklistRow, 'cep' | 'intention'>[] = [], _units: Pick<MappingUnit, 'dimension' | 'unit_key' | 'label'>[] = [], catalog?: CepCategory[]) {
  const entries = dimension === 'cep' && catalog ? catalog.map(c => [c.key, c.label]) : Object.entries(known[dimension]);
  return entries.map(([value, text]) => ({ value, label: text.replace(/^Kesehatan /u, '') }));
}

/** Leave an unfinished term in the worklist so the next batch can finish it. */
export async function applyMappingUnitBatch<T>(targets: T[], save: (ads: T[]) => Promise<{ saved: number; failed: { adId: string; error: string }[] }>, confirm: () => Promise<void>) {
  const batch = targets.slice(0, 300);
  const result = batch.length ? await save(batch) : { saved: 0, failed: [] };
  const truncated = targets.length > batch.length;
  if (!result.failed.length && !truncated) await confirm();
  return { ...result, matched: targets.length, truncated };
}
