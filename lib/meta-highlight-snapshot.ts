// Server-side, read-only evidence capture. No storage, publishing, or credentials.
import { createHash } from 'node:crypto';
import { META_STAGE_LEAK_RULE, type Highlight } from './meta-ad-highlights';
import type { MetaAnalysisFilters } from './meta-analysis-filters';
import { MEASURES, relativeChange, type Measure, type Totals } from './meta-funnel-domain';
import { WORLD_CHANNEL, type MetaBrandWorld, type TemplateSection } from './meta-funnel-templates';

type CoverageGap = { account_id: string; currentMissing: number; baselineMissing: number };
export type MetaLeakSnapshotReport = {
  workspaceId: string; world: MetaBrandWorld; brand: { id: string; name: string };
  reportRange: { from: string; to: string }; prevFrom: string; prevTo: string; reportVersion: string;
  currency: string; reportingError: string | null; rulesReady: boolean;
  accounts: { account_id: string; account_name: string }[];
  summary: Totals; sections: TemplateSection[]; highlights: Highlight[]; coverageGaps: CoverageGap[];
  destinations: { missing_ads: number; multi_ads: number }; objectiveUnknownAds: number;
};
export type MetaLeakSnapshot = {
  schema_version: 'meta-funnel.leak-snapshot/v1'; finding_id: string; snapshot_id: string; generated_at: string;
  mode: 'preview_only';
  source: { app: 'roove-bi'; report: 'meta-ads-funnel'; revision: string; report_path: string; snapshot_url: null };
  rule: typeof META_STAGE_LEAK_RULE;
  scope: {
    workspace: { id: string; name: string }; brand: { id: string; name: string };
    world: MetaBrandWorld; channel: 'non_cpas' | 'cpas';
    template: { key: string; id: string | null; name: string; stages: Measure[] };
    group: { key: string; name: string; ad_ids: string[]; account_names: string[]; landing_page_urls: string[] };
    report_accounts: { id: string; name: string }[];
    filters: MetaAnalysisFilters;
    // Meta funnel attribution is not a store/business attribution.
    business: null; store: null;
  };
  period: { current: { from: string; to: string }; reference: { from: string; to: string }; timezone: 'Asia/Jakarta' };
  finding: {
    kind: 'leak'; severity: 'bad'; title: 'Kebocoran tahap';
    metric: { id: string; label: string; numerator: Measure; denominator: Measure; multiplier: 1; format: 'percent' };
    comparison: { basis: 'period'; current: number; reference: number; change_percent: number };
    evidence: { current: { numerator: number; denominator: number }; reference: { numerator: number; denominator: number } };
    spend: { current: number; reference: number; report_current: number; currency: string };
  };
  quality: {
    status: 'ready_for_review' | 'blocked'; blockers: string[]; notes: string[];
    coverage_gaps: CoverageGap[]; closed_period: boolean;
  };
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const sortedUnique = (values: string[]) => [...new Set(values)].sort();
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Call only after reportContext authorization, using the SAME detail report as the UI.
 * Invalid evidence is omitted; incomplete but valid evidence remains visibly blocked.
 * IDs are content identities, NOT signatures, durable delivery receipts, or permissions.
 */
export function createMetaLeakSnapshots(input: {
  report: MetaLeakSnapshotReport; workspaceName: string; filters: MetaAnalysisFilters; currencies: string[]; generatedAt: string;
}): MetaLeakSnapshot[] {
  const { report: r } = input;
  const generated = new Date(input.generatedAt);
  if (!Number.isFinite(generated.valueOf())) throw new Error('Waktu snapshot tidak valid.');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(generated);
  const closedPeriod = r.reportRange.to < today && r.prevTo < today;
  const blockers: string[] = [];
  if (!closedPeriod) blockers.push('Periode belum selesai dalam WIB.');
  if (r.coverageGaps.some(g => g.currentMissing > 0 || g.baselineMissing > 0)) blockers.push('Data periode utama atau pembanding belum lengkap.');
  if (r.reportingError) blockers.push(r.reportingError);
  if (input.currencies.length !== 1 || input.currencies[0] !== r.currency || !/^[A-Z]{3}$/.test(r.currency)) blockers.push('Mata uang tunggal belum terverifikasi.');
  if (!r.workspaceId || !r.brand.id || r.brand.id === '__unmapped__' || !r.accounts.length) blockers.push('Cakupan workspace, brand, atau akun belum terverifikasi.');
  if (r.world === 'website' && !r.rulesReady) blockers.push('Pemetaan template belum tersedia.');
  const notes: string[] = [];
  if (r.destinations.missing_ads) notes.push(`${r.destinations.missing_ads} ad dalam laporan belum memiliki URL terbaca.`);
  if (r.destinations.multi_ads) notes.push(`${r.destinations.multi_ads} ad dalam laporan memiliki beberapa URL.`);
  if (r.objectiveUnknownAds) notes.push(`${r.objectiveUnknownAds} ad dalam laporan belum memiliki objective terbaca.`);
  const snapshots: MetaLeakSnapshot[] = [];
  for (const h of r.highlights) {
    if (h.kind !== 'leak' || !h.metric?.denominator || h.comparison?.basis !== 'period') continue;
    const section = r.sections.find(s => s.key === h.sectionKey);
    const group = section?.groups.find(g => g.key === h.groupKey);
    if (!section || !group) continue;
    const { numerator, denominator } = h.metric;
    if (denominator === 'spend') continue;
    const stages = section.config.stages.filter(s => s !== 'spend'), index = stages.indexOf(denominator);
    if (index < 0 || stages[index + 1] !== numerator || (h.metric.multiplier ?? 1) !== 1) continue;
    const currentN = group.current[numerator], currentD = group.current[denominator];
    const referenceN = group.previous[numerator], referenceD = group.previous[denominator];
    if (!nonnegative(currentN) || !nonnegative(currentD) || !nonnegative(referenceN) || !nonnegative(referenceD)
      || currentD < META_STAGE_LEAK_RULE.minDenominator || referenceD < META_STAGE_LEAK_RULE.minDenominator || referenceN === 0
      || !nonnegative(group.current.spend) || !nonnegative(group.previous.spend) || !nonnegative(r.summary.spend)
      || group.previous.spend <= 0 || group.current.spend < Math.max(r.summary.spend * META_STAGE_LEAK_RULE.minSpendShare, META_STAGE_LEAK_RULE.minSpend)) continue;
    const current = currentN / currentD, reference = referenceN / referenceD;
    const change = relativeChange(current, reference);
    if (change === null || !Number.isFinite(change) || change > -META_STAGE_LEAK_RULE.minDeclinePercent
      || !Number.isFinite(h.comparison.current) || !Number.isFinite(h.comparison.reference)
      || Math.abs(h.comparison.current - current) > 1e-12 || Math.abs(h.comparison.reference - reference) > 1e-12) continue;
    const period: MetaLeakSnapshot['period'] = { current: { ...r.reportRange }, reference: { from: r.prevFrom, to: r.prevTo }, timezone: 'Asia/Jakarta' };
    const filters = Object.fromEntries(Object.entries(input.filters).filter(([, value]) => value !== undefined && value !== '').sort(([a], [b]) => a.localeCompare(b)));
    const accounts = r.accounts.map(a => ({ id: a.account_id, name: a.account_name || a.account_id })).sort((a, b) => a.id.localeCompare(b.id));
    // A report revision / rename / recapture must not create a new logical finding.
    const findingId = hash({ workspace: r.workspaceId, brand: r.brand.id, world: r.world, section: section.key, group: group.key,
      numerator, denominator, basis: 'period', period, filters, accounts: sortedUnique(accounts.map(a => a.id)) });
    const content: Omit<MetaLeakSnapshot, 'snapshot_id' | 'generated_at'> = {
      schema_version: 'meta-funnel.leak-snapshot/v1', finding_id: findingId, mode: 'preview_only',
      source: { app: 'roove-bi', report: 'meta-ads-funnel', revision: r.reportVersion,
        report_path: `/dashboard/meta-funnels/brand/${encodeURIComponent(r.brand.id)}?world=${r.world}`, snapshot_url: null },
      rule: { ...META_STAGE_LEAK_RULE },
      scope: { workspace: { id: r.workspaceId, name: input.workspaceName || r.workspaceId }, brand: { ...r.brand },
        world: r.world, channel: WORLD_CHANNEL[r.world], template: { key: section.key, id: section.funnelId, name: section.name, stages: [...section.config.stages] },
        group: { key: group.key, name: group.name, ad_ids: sortedUnique(group.ad_ids), account_names: sortedUnique(group.accounts), landing_page_urls: sortedUnique(group.landing_page_urls) },
        report_accounts: accounts, filters, business: null, store: null },
      period,
      finding: { kind: 'leak', severity: 'bad', title: 'Kebocoran tahap',
        metric: { id: h.metric.id, label: `${MEASURES[numerator]} ÷ ${MEASURES[denominator]}`, numerator, denominator, multiplier: 1, format: 'percent' },
        comparison: { basis: 'period', current, reference, change_percent: change },
        evidence: { current: { numerator: currentN, denominator: currentD }, reference: { numerator: referenceN, denominator: referenceD } },
        spend: { current: group.current.spend, reference: group.previous.spend, report_current: r.summary.spend, currency: r.currency } },
      quality: { status: blockers.length ? 'blocked' : 'ready_for_review', blockers: [...blockers], notes: [...notes], closed_period: closedPeriod,
        coverage_gaps: r.coverageGaps.map(g => ({ account_id: g.account_id, currentMissing: g.currentMissing, baselineMissing: g.baselineMissing })).sort((a, b) => a.account_id.localeCompare(b.account_id)) },
    };
    snapshots.push({ ...content, snapshot_id: hash(content), generated_at: generated.toISOString() });
  }
  return snapshots;
}
