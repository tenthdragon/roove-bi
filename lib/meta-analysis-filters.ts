import { validateDimensionFilters, type AdDimensionFilters } from './meta-ad-dimensions';
import { CREATIVE_FORMAT_LABELS, CREATIVE_FORMAT_ORDER, type CreativeFormat } from './meta-creative-format';
import { PARTNERSHIP_LABELS, PARTNERSHIP_ORDER, type PartnershipStatus } from './meta-ad-partnership';
import { optimizationLabel, type MetaOptimization } from './meta-ad-optimization';

export type MetaAnalysisFilters = AdDimensionFilters & { optimization?: string; format?: CreativeFormat; partnership?: PartnershipStatus };
export type AnalysisDimension = 'optimization' | 'format' | 'partnership';
export type AnalysisFacet = { dimension: AnalysisDimension; value: string; count: number };
export type AnalysisOptions = Record<AnalysisDimension, { choices: { value: string; label: string; count: number }[]; total: number }>;
export const ANALYSIS_FILTER_LABELS = { optimization: 'Optimasi', format: 'Format iklan', partnership: 'Partnership' };
export function optimizationFilterKey(value: MetaOptimization) {
  return JSON.stringify([value.objective, value.optimization_goal, value.conversion_event, value.custom_conversion_id]);
}
export function parseOptimizationFilter(value: string): MetaOptimization {
  let parts: unknown;
  try { parts = JSON.parse(value); } catch { throw new Error('Filter optimasi tidak valid.'); }
  if (!Array.isArray(parts) || parts.length !== 4 || !parts.every((v, i) => v === null || typeof v === 'string' && (i === 3 ? /^[0-9]{1,100}$/ : /^[A-Z0-9_]{1,100}$/).test(v))) throw new Error('Filter optimasi tidak valid.');
  const [objective, optimization_goal, conversion_event, custom_conversion_id] = parts as (string | null)[];
  return { objective, optimization_goal, conversion_event, custom_conversion_id };
}
export function validateAnalysisFilters(input: MetaAnalysisFilters = {}): MetaAnalysisFilters {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Filter tidak valid.');
  const result: MetaAnalysisFilters = validateDimensionFilters(input);
  if (input.optimization !== undefined && input.optimization !== '') {
    if (typeof input.optimization !== 'string' || input.optimization.length > 500) throw new Error('Filter optimasi tidak valid.');
    result.optimization = optimizationFilterKey(parseOptimizationFilter(input.optimization));
  }
  for (const [key, values] of [['format', CREATIVE_FORMAT_ORDER], ['partnership', PARTNERSHIP_ORDER]] as const) {
    const value: unknown = input[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) throw new Error('Filter ' + ANALYSIS_FILTER_LABELS[key] + ' tidak valid.');
    Object.assign(result, { [key]: value });
  }
  return result;
}
export function analysisFilterLabel(key: AnalysisDimension, value: string) {
  if (key === 'format') return CREATIVE_FORMAT_LABELS[value as CreativeFormat] || value;
  if (key === 'partnership') return PARTNERSHIP_LABELS[value as PartnershipStatus] || value;
  try { return optimizationLabel(parseOptimizationFilter(value)); } catch { return 'Optimasi belum terbaca'; }
}
export function analysisFilterOptions(raw: { analysisFacets?: AnalysisFacet[]; analysisFacetTotals?: Partial<Record<AnalysisDimension, number>> }): AnalysisOptions {
  const options = (key: AnalysisDimension) => ({
    choices: (raw.analysisFacets || []).filter(f => f.dimension === key).map(f => ({
      ...f, value: key === 'optimization' ? optimizationFilterKey(parseOptimizationFilter(f.value)) : f.value, label: analysisFilterLabel(key, f.value),
    })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'id')),
    total: raw.analysisFacetTotals?.[key] || 0,
  });
  return { optimization: options('optimization'), format: options('format'), partnership: options('partnership') };
}
