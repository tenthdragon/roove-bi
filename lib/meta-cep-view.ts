// CEP × intention view of one brand and world. Pure rules over the report's
// cep_intention groups: a matrix of cells, one row per CEP with its own
// response and result metrics, medians across CEPs, and CEP-level highlights.
import { metricValue, relativeChange, type FunnelMetric, type Totals } from './meta-funnel-domain';
import { dimensionLabel } from './meta-ad-dimensions';
import { median, responseMetrics, sumTotalsOf, type ReportGroup } from './meta-funnel-templates';
import type { Highlight } from './meta-ad-highlights';

export const UNKNOWN_KEY = '__unknown__';
export const INTENTION_ORDER = ['disc', 'cons', 'conv'] as const;
export type CepCell = { key: string; cep: string; intention: string; current: Totals; previous: Totals; ads: number };
export type CepRow = {
  cep: string; label: string; unknown: boolean; current: Totals; previous: Totals; ads: number; spendShare: number;
  cells: Record<string, CepCell | undefined>;
};
export type CepColumn = { intention: string; label: string; unknown: boolean; metric: FunnelMetric; current: Totals; spendShare: number };
export type CepView = {
  rows: CepRow[]; columns: CepColumn[]; metrics: FunnelMetric[]; resultMetric: FunnelMetric;
  medians: Record<string, number | null>; unknownShare: number; totalSpend: number; mapped: number;
};

const CPP: FunnelMetric = { id: 'cpp', label: 'CPP', numerator: 'spend', denominator: 'purchases', format: 'money', direction: 'lower', monitor: true, min_denominator: 5 };
const CPL: FunnelMetric = { id: 'cpl', label: 'CPL', numerator: 'spend', denominator: 'leads', format: 'money', direction: 'lower', monitor: true, min_denominator: 5 };
const ATC_RATE: FunnelMetric = { id: 'atc_rate', label: 'ATC ratio', numerator: 'atc', denominator: 'lpv', format: 'percent', direction: 'higher', monitor: true, min_denominator: 30 };
const PURCHASE_PER_CLICK: FunnelMetric = { id: 'purchase_per_click', label: 'Purchase per klik', numerator: 'purchases', denominator: 'outbound_clicks', format: 'percent', direction: 'higher', monitor: true, min_denominator: 30 };

export function parseCepKey(key: string): { cep: string; intention: string } | null {
  const match = key.match(/^cep:([^:]*):(.*)$/);
  return match ? { cep: match[1] || UNKNOWN_KEY, intention: match[2] || UNKNOWN_KEY } : null;
}
/** The result cost a brand world is judged by: CPP where purchases dominate, else CPL. */
export function cepResultMetric(world: 'website' | 'cpas', summary: Totals): FunnelMetric {
  if (world === 'cpas') return CPP;
  return summary.purchases >= summary.leads ? CPP : CPL;
}
/** Each intention has its own success measure: discovery is judged by response, conversion by cost. */
export function intentionMetric(intention: string, world: 'website' | 'cpas', result: FunnelMetric): FunnelMetric {
  const response = responseMetrics(world);
  if (intention === 'disc') return response.find(m => m.id === 'outbound_ctr')!;
  if (intention === 'cons') return world === 'website' ? ATC_RATE : PURCHASE_PER_CLICK;
  if (intention === 'conv') return result;
  return response.find(m => m.id === 'outbound_ctr')!;
}
function intentionLabel(intention: string) {
  return intention === UNKNOWN_KEY ? 'Tanpa intention' : dimensionLabel('intention', intention);
}
function cepLabel(cep: string) {
  return cep === UNKNOWN_KEY ? 'Belum terpetakan' : dimensionLabel('cep', cep);
}

export function buildCepView(groups: ReportGroup[], world: 'website' | 'cpas', summary: Totals, previous: Totals): CepView {
  const cells: CepCell[] = [];
  for (const g of groups) {
    const parsed = parseCepKey(g.key);
    if (!parsed) continue;
    cells.push({ key: g.key, cep: parsed.cep, intention: parsed.intention, current: g.current, previous: g.previous, ads: g.ad_ids.length });
  }
  const totalSpend = summary.spend;
  const resultMetric = cepResultMetric(world, summary);
  const intentions = [...new Set(cells.map(c => c.intention))].sort((a, b) => {
    const ia = INTENTION_ORDER.indexOf(a as typeof INTENTION_ORDER[number]), ib = INTENTION_ORDER.indexOf(b as typeof INTENTION_ORDER[number]);
    if (a === UNKNOWN_KEY) return 1; if (b === UNKNOWN_KEY) return -1;
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const columns: CepColumn[] = intentions.map(intention => {
    const current = sumTotalsOf(cells.filter(c => c.intention === intention).map(c => c.current));
    return { intention, label: intentionLabel(intention), unknown: intention === UNKNOWN_KEY, metric: intentionMetric(intention, world, resultMetric), current, spendShare: totalSpend > 0 ? current.spend / totalSpend : 0 };
  });
  const rows: CepRow[] = [...new Set(cells.map(c => c.cep))].map(cep => {
    const own = cells.filter(c => c.cep === cep);
    const current = sumTotalsOf(own.map(c => c.current)), prev = sumTotalsOf(own.map(c => c.previous));
    return { cep, label: cepLabel(cep), unknown: cep === UNKNOWN_KEY, current, previous: prev, ads: own.reduce((s, c) => s + c.ads, 0),
      spendShare: totalSpend > 0 ? current.spend / totalSpend : 0, cells: Object.fromEntries(own.map(c => [c.intention, c])) };
  }).sort((a, b) => Number(a.unknown) - Number(b.unknown) || b.current.spend - a.current.spend || a.label.localeCompare(b.label, 'id'));
  const response = responseMetrics(world);
  const metrics = [...response, ...(world === 'website' ? [ATC_RATE] : []), resultMetric].filter((m, i, all) => all.findIndex(o => o.id === m.id) === i);
  const medians = Object.fromEntries(metrics.map(m => [m.id, median(rows.filter(r => !r.unknown).map(r => metricValue(r.current, m)).filter((v): v is number => v !== null))]));
  const unknownRow = rows.find(r => r.unknown);
  return { rows, columns, metrics, resultMetric, medians, totalSpend, unknownShare: totalSpend > 0 && unknownRow ? unknownRow.current.spend / totalSpend : 0,
    mapped: rows.filter(r => !r.unknown).length };
}

/** How far a value sits from the CEP median, signed so that positive is better: +1 = twice as good, -1 = twice as bad. */
export function cepHeat(value: number | null, medianValue: number | null | undefined, direction: FunnelMetric['direction']): number | null {
  if (value === null || medianValue === null || medianValue === undefined || medianValue <= 0 || value <= 0) return null;
  const ratio = Math.log2(value / medianValue);
  const signed = direction === 'higher' ? ratio : -ratio;
  return Math.max(-1, Math.min(1, signed));
}

const percent = (v: number) => `${(v * 100).toFixed(1)}%`;
function money(value: number, currency: string) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }

/** CEP-level highlights: a costly CEP, a promising CEP, a CEP losing response, and unmapped spend. */
export function cepHighlights(view: CepView, currency: string): Highlight[] {
  const out: Highlight[] = [];
  const mapped = view.rows.filter(r => !r.unknown);
  const result = view.resultMetric, ctr = view.metrics.find(m => m.id === 'outbound_ctr')!;
  const resultMedian = view.medians[result.id], ctrMedian = view.medians[ctr.id];
  const shareMedian = median(mapped.map(r => r.spendShare)) ?? 0;
  if (mapped.length >= 3) for (const r of mapped) {
    const cost = metricValue(r.current, result);
    if (cost !== null && resultMedian && (r.current[result.denominator!] ?? 0) >= result.min_denominator && r.spendShare >= 0.15 && cost >= resultMedian * 1.5) {
      out.push({ kind: 'cep', severity: 'bad', title: 'CEP mahal', groupKey: r.cep, weight: r.current.spend,
        text: `${r.label} menyerap ${Math.round(r.spendShare * 100)}% spend dengan ${result.label} ${money(cost, currency)}, ${(cost / resultMedian).toFixed(2)}× median CEP. Pertimbangkan geser budget.` });
    }
    const response = metricValue(r.current, ctr);
    if (response !== null && ctrMedian && r.current.impressions >= 1000 && response >= ctrMedian * 1.25 && r.spendShare <= shareMedian && (cost === null || !resultMedian || cost <= resultMedian)) {
      out.push({ kind: 'cep', severity: 'good', title: 'CEP berpotensi', groupKey: r.cep, weight: r.current.spend,
        text: `${r.label} punya CTR outbound ${percent(response)}, ${Math.round((response / ctrMedian - 1) * 100)}% di atas median CEP, tapi porsi spend baru ${Math.round(r.spendShare * 100)}%. Kandidat uji penambahan budget.` });
    }
  }
  for (const r of mapped) {
    const now = metricValue(r.current, ctr), before = metricValue(r.previous, ctr);
    const change = relativeChange(now, before);
    if (change !== null && change <= -20 && r.current.impressions >= 1000 && r.previous.impressions >= 1000 && r.spendShare >= 0.1) {
      out.push({ kind: 'cep', severity: 'warn', title: 'Respon CEP melemah', groupKey: r.cep, weight: r.current.spend,
        text: `CTR outbound ${r.label} turun ${change.toFixed(0)}% dibanding periode lalu (${percent(before!)} → ${percent(now!)}). Periksa creative CEP ini sebelum mengubah budget.` });
    }
  }
  if (view.unknownShare >= 0.2) out.push({ kind: 'data', severity: 'warn', title: 'CEP belum terpetakan', weight: 0,
    text: `${Math.round(view.unknownShare * 100)}% spend berasal dari ad tanpa tag CEP. Perbandingan antar CEP belum lengkap; lengkapi di Pemetaan Ads.` });
  return out;
}
