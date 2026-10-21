import { emptyTotals, metaPerformanceMetrics, sumMetricTotals, type FunnelMetric, type Totals } from './meta-funnel-domain';
import { CREATIVE_FORMAT_ORDER, type CreativeFormat } from './meta-creative-format';
import { optimizationLabel, optimizationDescription, type MetaOptimization } from './meta-ad-optimization';
import { dimensionLabel } from './meta-ad-dimensions';
import type { RawMetaReport } from './meta-ad-report';

export type MatrixAdMetadata = { cep_keys: string[]; creative_format: CreativeFormat; uses_latest_metadata: boolean };
export type MatrixCell = { current: Totals; ads: number; latestFormatAds: number };
export type MatrixCepRow = { cep: string; label: string; unknown: boolean; current: Totals; ads: number; cells: Partial<Record<CreativeFormat, MatrixCell>> };
export type MatrixUniverse = { key: string; label: string; description: string; optimization: MetaOptimization; current: Totals; ads: number;
  overlapAds: number; latestFormatAds: number; columns: CreativeFormat[]; rows: MatrixCepRow[] };
export type FormatCepMatrix = { universes: MatrixUniverse[]; current: Totals; ads: number };
export const MATRIX_METRICS: FunnelMetric[] = ['spent','cpm','atc_rate','ic_rate','purchase_rate','cpp'].map(id => {
  const metric = metaPerformanceMetrics().find(m => m.id === id)!;
  return { ...metric, label: id === 'atc_rate' ? 'ATC rate' : id === 'ic_rate' ? 'IC rate' : id === 'purchase_rate' ? 'Purchase rate' : metric.label };
});

/** Sum facts before dividing. CEP memberships may overlap; each universe counts an ad/account only once. */
export function buildFormatCepMatrix(raw: Pick<RawMetaReport, 'groups' | 'cepLabels'>): FormatCepMatrix {
  const universes = new Map<string, MatrixUniverse>(), rows = new Map<string, Map<string, MatrixCepRow>>();
  const seen = new Set<string>();
  for (const ad of raw.groups) {
    if (seen.has(ad.key)) throw new Error('Duplikat iklan pada Matrix.');
    seen.add(ad.key);
    const metadata = ad.matrix_metadata, optimizations = ad.optimization_breakdown;
    if (!metadata || !Array.isArray(metadata.cep_keys) || optimizations?.length !== 1) throw new Error('Metadata Matrix belum tersedia.');
    const { objective, optimization_goal, conversion_event, custom_conversion_id } = optimizations[0];
    const optimization = { objective, optimization_goal, conversion_event, custom_conversion_id };
    const key = JSON.stringify([objective,optimization_goal,conversion_event,custom_conversion_id]);
    let universe = universes.get(key);
    if (!universe) {
      universe = { key, label: optimizationLabel(optimization), description: optimizationDescription(optimization), optimization,
        current: emptyTotals(), ads: 0, overlapAds: 0, latestFormatAds: 0, columns: ['image','video','carousel'], rows: [] };
      universes.set(key, universe); rows.set(key, new Map());
    }
    const current = { ...emptyTotals(), ...ad.current };
    const format: CreativeFormat = CREATIVE_FORMAT_ORDER.includes(metadata.creative_format) ? metadata.creative_format : 'unknown';
    const latest = metadata.uses_latest_metadata ? 1 : 0;
    const ceps = [...new Set(metadata.cep_keys.filter(c => typeof c === 'string' && c))];
    if (!ceps.length) ceps.push('__unknown__');
    universe.current = sumMetricTotals([universe.current, current]); universe.ads++;
    universe.overlapAds += Number(ceps.length > 1); universe.latestFormatAds += latest;
    if (!universe.columns.includes(format)) universe.columns.push(format);
    for (const cep of ceps) {
      let row = rows.get(key)!.get(cep);
      if (!row) {
        row = { cep, label: cep === '__unknown__' ? 'Belum terpetakan' : raw.cepLabels?.[cep] || dimensionLabel('cep', cep), unknown: cep === '__unknown__',
          current: emptyTotals(), ads: 0, cells: {} }; rows.get(key)!.set(cep, row);
      }
      row.current = sumMetricTotals([row.current, current]); row.ads++;
      const cell = row.cells[format] ||= { current: emptyTotals(), ads: 0, latestFormatAds: 0 };
      cell.current = sumMetricTotals([cell.current, current]); cell.ads++; cell.latestFormatAds += latest;
    }
  }
  for (const universe of universes.values()) {
    universe.columns.sort((a,b) => CREATIVE_FORMAT_ORDER.indexOf(a)-CREATIVE_FORMAT_ORDER.indexOf(b));
    universe.rows = [...rows.get(universe.key)!.values()].sort((a,b) => Number(a.unknown)-Number(b.unknown) || b.current.spend-a.current.spend || a.label.localeCompare(b.label,'id'));
  }
  const list = [...universes.values()].sort((a,b) => b.current.spend-a.current.spend || a.label.localeCompare(b.label,'id'));
  return { universes: list, current: sumMetricTotals(list.map(u => u.current)), ads: seen.size };
}
