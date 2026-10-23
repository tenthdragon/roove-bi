// Automatic highlights for one brand and world. Pure rules over report totals:
// a stage leak, a cost outlier, a hidden winner, weak ad response, data notes.
import { MEASURES, metricValue, relativeChange, type FunnelMetric, type Measure, type Totals } from './meta-funnel-domain';
import { median, responseMetrics, type TemplateSection, type UnassignedGroup } from './meta-funnel-templates';

export type HighlightKind = 'leak' | 'outlier' | 'winner' | 'weak_response' | 'cep' | 'data' | 'stable';
export type HighlightSeverity = 'bad' | 'warn' | 'good' | 'info';
export type Highlight = {
  kind: HighlightKind; severity: HighlightSeverity; title: string; text: string;
  sectionKey?: string; groupKey?: string; weight: number;
  metric?: FunnelMetric;
  comparison?: { basis: 'period' | 'template_median' | 'brand_average' | 'cep_median'; current: number; reference: number };
  note?: 'coverage' | 'missing_url' | 'unassigned' | 'unmapped_cep' | 'multi_url' | 'objective';
};
export type HighlightInput = {
  world: 'website' | 'cpas'; sections: TemplateSection[]; summary: Totals; previous: Totals; currency: string;
  unassigned?: UnassignedGroup[]; coverageGaps?: { account_id: string; currentMissing: number; baselineMissing: number }[]; missingUrls?: number;
};
const severityRank: Record<HighlightSeverity, number> = { bad: 0, warn: 1, good: 2, info: 3 };
// Versioned alongside the rule, so exported evidence never invents its thresholds.
export const META_STAGE_LEAK_RULE = {
  version: 'meta-stage-leak/v1', minDeclinePercent: 15, minDenominator: 30,
  minSpendShare: 0.03, minSpend: 1,
} as const;
const percent = (v: number) => `${(v * 100).toFixed(1)}%`;
const signed = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`;
export function formatMetric(value: number | null, m: FunnelMetric, currency: string) {
  if (value === null || !Number.isFinite(value)) return '—';
  if (m.format === 'percent') return percent(value);
  if (m.format === 'multiple') return `${value.toFixed(2)}×`;
  return new Intl.NumberFormat('id-ID', m.format === 'money' ? { style: 'currency', currency, maximumFractionDigits: 0 } : { maximumFractionDigits: 1 }).format(value);
}
const shortName = (name: string) => name.replace(/^https?:\/\//, '').replace(/\/$/, '');

export function brandHighlights(input: HighlightInput): Highlight[] {
  const out: Highlight[] = [];
  const total = input.summary.spend;
  for (const section of input.sections) {
    const stages = section.config.stages.filter(s => s !== 'spend');
    for (const g of section.groups) {
      if (g.current.spend < Math.max(total * META_STAGE_LEAK_RULE.minSpendShare, META_STAGE_LEAK_RULE.minSpend) || g.previous.spend <= 0) continue;
      let worst: { from: Measure; to: Measure; now: number; before: number; change: number } | null = null;
      for (let i = 1; i < stages.length; i++) {
        const from = stages[i - 1], to = stages[i];
        const nowFrom = g.current[from], beforeFrom = g.previous[from], nowTo = g.current[to], beforeTo = g.previous[to];
        if (nowFrom == null || beforeFrom == null || nowTo == null || beforeTo == null || nowFrom < META_STAGE_LEAK_RULE.minDenominator || beforeFrom < META_STAGE_LEAK_RULE.minDenominator) continue;
        const now = nowTo / nowFrom, before = beforeTo / beforeFrom;
        const change = relativeChange(now, before);
        if (change !== null && change <= -META_STAGE_LEAK_RULE.minDeclinePercent && (!worst || change < worst.change)) worst = { from, to, now, before, change };
      }
      if (worst) out.push({
        metric: { id: `stage_${worst.to}`, label: `${MEASURES[worst.to]} ÷ ${MEASURES[worst.from]}`, numerator: worst.to, denominator: worst.from, format: 'percent', direction: 'higher', monitor: true, min_denominator: META_STAGE_LEAK_RULE.minDenominator },
        comparison: { basis: 'period', current: worst.now, reference: worst.before }, kind: 'leak', severity: 'bad', title: 'Kebocoran tahap', sectionKey: section.key, groupKey: g.key, weight: g.current.spend,
        text: `${MEASURES[worst.to]} ÷ ${MEASURES[worst.from]} di ${shortName(g.name)} turun dari ${percent(worst.before)} ke ${percent(worst.now)} (${signed(worst.change)}), spend ${formatMetric(g.current.spend, { id: 's', label: '', numerator: 'spend', denominator: null, format: 'money', direction: 'lower', monitor: false, min_denominator: 0 }, input.currency)}.` });
    }
    const main = section.mainMetric;
    if (main && section.groups.length >= 3 && section.mainMedian !== null && section.mainMedian > 0) {
      const spendMedian = median(section.groups.map(g => g.current.spend)) ?? 0;
      for (const g of section.groups) {
        const value = metricValue(g.current, main);
        if (value === null || (main.denominator && (g.current[main.denominator] ?? 0) < main.min_denominator)) continue;
        const ratio = value / section.mainMedian;
        if (ratio >= 1.5) out.push({ metric: main, comparison: { basis: 'template_median', current: value, reference: section.mainMedian }, kind: 'outlier', severity: 'bad', title: 'Pencilan biaya', sectionKey: section.key, groupKey: g.key, weight: g.current.spend,
          text: `${main.label} ${shortName(g.name)} ${formatMetric(value, main, input.currency)}, ${ratio.toFixed(2)}× median template ${section.name}.` });
        else if (ratio <= 0.8 && g.current.spend <= spendMedian) out.push({ metric: main, comparison: { basis: 'template_median', current: value, reference: section.mainMedian }, kind: 'winner', severity: 'good', title: 'Pemenang tersembunyi', sectionKey: section.key, groupKey: g.key, weight: g.current.spend,
          text: `${shortName(g.name)} mencetak ${main.label} ${formatMetric(value, main, input.currency)}, ${Math.round((1 - ratio) * 100)}% di bawah median, dengan porsi spend ${total > 0 ? Math.round(g.current.spend / total * 100) : 0}%. Kandidat penambahan budget.` });
      }
    }
  }
  const response = responseMetrics(input.world);
  for (const id of ['outbound_ctr', 'hook_rate'] as const) {
    const m = response.find(r => r.id === id)!;
    const now = metricValue(input.summary, m), before = metricValue(input.previous, m);
    const change = relativeChange(now, before);
    if (change !== null && change <= -15 && input.summary.impressions >= 1000 && input.previous.impressions >= 1000) out.push({ metric: m, comparison: { basis: 'period', current: now!, reference: before! }, kind: 'weak_response', severity: 'bad', title: 'Respon lemah', weight: total,
      text: `${m.label} turun ${signed(change)} dibanding periode lalu (${formatMetric(before, m, input.currency)} → ${formatMetric(now, m, input.currency)}). Periksa pembukaan creative, pesan, dan audiens.` });
  }
  const ctr = response.find(r => r.id === 'outbound_ctr')!;
  const worldCtr = metricValue(input.summary, ctr);
  if (worldCtr !== null && worldCtr > 0) for (const section of input.sections) for (const g of section.groups) {
    const value = metricValue(g.current, ctr);
    if (value !== null && g.current.impressions >= 1000 && g.current.spend >= total * 0.1 && value < worldCtr * 0.5) out.push({ metric: ctr, comparison: { basis: 'brand_average', current: value, reference: worldCtr }, kind: 'weak_response', severity: 'warn', title: 'Respon lemah', sectionKey: section.key, groupKey: g.key, weight: g.current.spend,
      text: `CTR outbound ${shortName(g.name)} ${percent(value)}, kurang dari setengah rata-rata brand (${percent(worldCtr)}), padahal menyerap ${Math.round(g.current.spend / total * 100)}% spend.` });
  }
  const partial = (input.coverageGaps || []).filter(c => c.currentMissing > 0 || c.baselineMissing > 0);
  if (partial.length) out.push({ kind: 'data', severity: 'warn', title: 'Data parsial', note: 'coverage', weight: 0,
    text: `${partial.length} akun belum lengkap: ${partial.map(c => `${c.currentMissing ? `periode ${c.currentMissing} hari` : ''}${c.currentMissing && c.baselineMissing ? ', ' : ''}${c.baselineMissing ? `pembanding ${c.baselineMissing} hari` : ''}`).join(' · ')}. Perubahan periode dibaca dengan hati-hati.` });
  if (input.missingUrls) out.push({ kind: 'data', severity: 'warn', title: 'URL belum terbaca', note: 'missing_url', weight: 0, text: `${input.missingUrls} ad belum punya URL landing page yang terbaca, sehingga belum masuk template mana pun.` });
  const suggestable = (input.unassigned || []).filter(u => u.reason === 'no_rule');
  if (suggestable.length) out.push({ kind: 'data', severity: 'warn', title: 'Template belum ditetapkan', note: 'unassigned', weight: 0,
    text: `${suggestable.length} landing page belum punya template, ${suggestable.filter(u => u.suggestion.funnelId).length} di antaranya punya saran otomatis.` });
  const sorted = out.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.weight - a.weight);
  if (!sorted.some(h => h.severity === 'bad' || (h.severity === 'warn' && h.kind !== 'data'))) sorted.unshift({ kind: 'stable', severity: 'info', title: 'Stabil', weight: 0, text: 'Tidak ada sinyal penurunan atau pencilan biaya pada periode ini.' });
  return sorted;
}
export function brandHealth(highlights: Highlight[]): 'bad' | 'warn' | 'good' {
  if (highlights.some(h => h.severity === 'bad')) return 'bad';
  if (highlights.some(h => h.severity === 'warn')) return 'warn';
  return 'good';
}
