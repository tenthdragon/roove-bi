"use client";
import { X } from 'lucide-react';
import { dimensionLabel, objectiveLabel, type dimensionOptions } from '@/lib/meta-ad-dimensions';
import { ANALYSIS_FILTER_LABELS, analysisFilterLabel, type AnalysisOptions, type MetaAnalysisFilters } from '@/lib/meta-analysis-filters';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

type DimensionOptions = ReturnType<typeof dimensionOptions>;
const labels = { optimization: 'Optimasi', format: 'Format iklan', partnership: 'Partnership', cep: 'CEP', intention: 'Intention', objective: 'Objective Meta' };
const order = ['optimization', 'format', 'partnership', 'cep', 'intention', 'objective'] as const;
export function activeMetaFilters(value: MetaAnalysisFilters) { return order.filter(key => !!value[key]); }
function label(key: keyof MetaAnalysisFilters, value: string, options?: DimensionOptions) {
  if (key in ANALYSIS_FILTER_LABELS) return analysisFilterLabel(key as keyof typeof ANALYSIS_FILTER_LABELS, value);
  const choices = key === 'cep' ? options?.ceps : key === 'intention' ? options?.intentions : options?.objectives;
  return choices?.find(c => c.value === value)?.label || (key === 'objective' ? objectiveLabel(value) : dimensionLabel(key as 'cep' | 'intention', value));
}
export function MetaActiveFilters({ value, options, onChange }: { value: MetaAnalysisFilters; options?: DimensionOptions; onChange: (value: MetaAnalysisFilters) => void }) {
  const active = activeMetaFilters(value);
  if (!active.length) return null;
  return <div className={styles.activeFilterChips} aria-label="Filter aktif">
    {active.map(key => { const selectedLabel = label(key, value[key]!, options); const text = key === 'partnership' && value[key] !== 'unknown' ? selectedLabel : `${labels[key]}: ${selectedLabel}`; return <button type="button" className={styles.filterChip} key={key} title={text} aria-label={`Hapus filter ${labels[key]}`}
      onClick={() => { const next = { ...value }; delete next[key]; onChange(next); }}><span>{text}</span><X size={13} aria-hidden="true" /></button>; })}
    <button type="button" className={styles.filterReset} onClick={() => onChange({})}>Reset filter</button>
  </div>;
}
export default function MetaAnalysisFilters({ value, dimensions, analysis, ready, analysisReady, loading, onChange }: {
  value: MetaAnalysisFilters; dimensions?: DimensionOptions; analysis?: AnalysisOptions; ready: boolean; analysisReady: boolean; loading: boolean;
  onChange: (value: MetaAnalysisFilters) => void;
}) {
  return <div className={styles.analysisFilterGrid}>
    {order.map(key => {
      const advanced = key === 'optimization' || key === 'format' || key === 'partnership';
      const choices = advanced ? analysis?.[key].choices : key === 'cep' ? dimensions?.ceps : key === 'intention' ? dimensions?.intentions : dimensions?.objectives;
      const total = advanced ? analysis?.[key].total : key === 'cep' ? dimensions?.cepTotal : key === 'intention' ? dimensions?.intentionTotal : dimensions?.objectiveTotal;
      const available = ready && (!advanced || analysisReady) && !loading;
      return <label key={key}>{labels[key]}<select aria-label={`Filter ${labels[key]}`} value={value[key] || ''} disabled={!available}
        title={advanced ? 'Metadata terbaru untuk iklan pada periode ini. Jumlah ad memperhitungkan filter lainnya.' : 'Jumlah ad pada periode ini dengan filter lainnya.'}
        onChange={e => { const next = { ...value }; if (e.target.value) Object.assign(next, { [key]: e.target.value }); else delete next[key]; onChange(next); }}>
        <option value="">Semua{available ? ` (${total || 0})` : ''}</option>
        {value[key] && !choices?.some(c => c.value === value[key]) && <option value={value[key]}>{label(key, value[key]!, dimensions)}{available ? ' (0)' : ''}</option>}
        {(choices || []).map(c => <option key={c.value} value={c.value}>{c.label}{available ? ` (${c.count})` : ''}</option>)}
      </select></label>;
    })}
    {loading && <span role="status" className={styles.muted}>Memuat pilihan filter…</span>}
    {ready && !analysisReady && <span role="status" className={styles.muted}>Filter optimasi, format, dan partnership belum tersedia.</span>}
  </div>;
}
