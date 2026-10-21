import type { Highlight } from './meta-ad-highlights';
import type { FunnelMetric } from './meta-funnel-domain';

export type HighlightPeriod = { from: string; to: string; prevFrom: string; prevTo: string };

/** Match the actual formula, not an editable metric ID or label. */
export function highlightsForMetric(highlights: Highlight[], metric: FunnelMetric): Highlight[] {
  return highlights.filter(h => h.metric && h.metric.numerator === metric.numerator
    && h.metric.denominator === metric.denominator && (h.metric.multiplier ?? 1) === (metric.multiplier ?? 1));
}
export function destinationHighlights(highlights: Highlight[], sectionKey: string, groupKey: string): Highlight[] {
  return highlights.filter(h => h.kind !== 'data' && h.kind !== 'cep' && h.sectionKey === sectionKey && h.groupKey === groupKey);
}
export function cepRowHighlights(highlights: Highlight[], cep: string): Highlight[] {
  return highlights.filter(h => h.kind === 'cep' && h.groupKey === cep);
}
export function brandMetricHighlights(highlights: Highlight[], metric: FunnelMetric): Highlight[] {
  return highlightsForMetric(highlights.filter(h => !h.groupKey && h.kind !== 'data' && h.kind !== 'stable'), metric);
}
export function highlightSymbol(h: Highlight): '↘' | '↗' | '★' | '!' {
  if (h.comparison?.basis === 'period') return h.comparison.current < h.comparison.reference ? '↘' : '↗';
  return h.severity === 'good' ? '★' : '!';
}

/** One count per issue category, shared by the toolbar preview and notes drawer. */
export function metaDataNotes(input: { highlights: Highlight[]; destinations: { missing_ads: number; multi_ads: number }; objectiveUnknownAds: number }): Highlight[] {
  const notes = input.highlights.filter(h => h.kind === 'data');
  const add = (note: Highlight['note'], title: string, text: string) => {
    if (!notes.some(h => h.note === note)) notes.push({ kind: 'data', severity: 'warn', weight: 0, note, title, text });
  };
  if (input.destinations.missing_ads) add('missing_url', 'URL belum terbaca', `${input.destinations.missing_ads} ad belum memiliki URL landing page yang terbaca.`);
  if (input.destinations.multi_ads) add('multi_url', 'Beberapa URL dalam satu creative', `${input.destinations.multi_ads} ad memiliki beberapa URL. Metrik dihitung sekali; tujuan perlu diperiksa.`);
  if (input.objectiveUnknownAds) add('objective', 'Objective belum terbaca', `${input.objectiveUnknownAds} ad belum memiliki objective yang terbaca.`);
  return notes;
}
