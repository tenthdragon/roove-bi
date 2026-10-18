'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MEASURES, metricValue, relativeChange, type FunnelMetric } from '@/lib/meta-funnel-domain';
import { cepHeat, type CepView } from '@/lib/meta-cep-view';
import { formatChange, formatCompactMoney, formatCount, formatMetric } from '@/lib/meta-format';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

export const CEP_COLORS = ['var(--accent)', 'var(--green)', 'var(--yellow)', '#8b5cf6', '#0ea5e9', '#ec4899', '#f97316'];
export function cepColor(index: number, unknown: boolean) { return unknown ? 'var(--dim)' : CEP_COLORS[index % CEP_COLORS.length]; }

/** Background tint from the signed heat value: green above the CEP median, red below. */
function heatStyle(heat: number | null): React.CSSProperties | undefined {
  if (heat === null || Math.abs(heat) < 0.08) return undefined;
  const strength = Math.round(Math.min(1, Math.abs(heat)) * 32 + 8);
  return { background: `color-mix(in srgb, ${heat > 0 ? 'var(--green)' : 'var(--red)'} ${strength}%, transparent)` };
}
function Delta({ value, direction }: { value: number | null; direction: FunnelMetric['direction'] }) {
  if (value === null) return <span className={styles.neutral}>—</span>;
  const good = direction === 'higher' ? value >= 0 : value <= 0;
  return <span className={good ? styles.good : styles.bad}>{formatChange(value)}</span>;
}

/** CEP × intention matrix plus one row per CEP; the matrix compares against the CEP median, never the brand total. */
export default function MetaCepView({ view, currency, onOpenCep }: { view: CepView; currency: string; onOpenCep: (cep: string) => void }) {
  const [metricId, setMetricId] = useState('');
  const forced = view.metrics.find(m => m.id === metricId) || null;
  if (!view.rows.length) return <div className={styles.card}>Belum ada ad dengan data pada periode dan filter ini.</div>;
  const columnMedian = (columnMetric: FunnelMetric, intention: string) => {
    const values = view.rows.filter(r => !r.unknown).map(r => { const c = r.cells[intention]; return c ? metricValue(c.current, columnMetric) : null; }).filter((v): v is number => v !== null).sort((a, b) => a - b);
    if (!values.length) return null;
    const mid = Math.floor(values.length / 2);
    return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  };
  return <div style={{ display: 'grid', gap: 12 }}>
    <div className={styles.sectionCard}>
      <div className={styles.sectionHead}>
        <div><span className={styles.templateTag}>MATRIKS</span><strong>CEP × intention</strong><span>{view.mapped} CEP terpetakan · {Math.round(view.unknownShare * 100)}% spend tanpa CEP</span></div>
        <div className={styles.actions}>
          <span className={styles.heatLegend}>lebih buruk <i aria-hidden="true" /> lebih baik dari median CEP</span>
          <select aria-label="Metrik sel" value={forced?.id || ''} onChange={e => setMetricId(e.target.value)}>
            <option value="">Metrik per intention (default)</option>
            {view.metrics.map(m => <option key={m.id} value={m.id}>Semua sel: {m.label}</option>)}
          </select>
        </div>
      </div>
      <div className={styles.tableWrap} style={{ border: 0, borderRadius: 0 }}>
        <table className={styles.cepMatrix}>
          <thead><tr><th scope="col">CEP</th>{view.columns.map(col => { const m = forced || col.metric; return <th key={col.intention} scope="col" title={m.denominator ? `${MEASURES[m.numerator]} ÷ ${MEASURES[m.denominator]}` : MEASURES[m.numerator]}>{col.label}<small>{m.label} · {Math.round(col.spendShare * 100)}% spend</small></th>; })}</tr></thead>
          <tbody>{view.rows.map(row => <tr key={row.cep}>
            <td>{row.unknown ? <span className={styles.cepUnknown}>{row.label}</span> : <button type="button" className={styles.cepName} onClick={() => onOpenCep(row.cep)}>{row.label}</button>}
              <small>{formatCompactMoney(row.current.spend, currency)} · {Math.round(row.spendShare * 100)}% · {row.ads} ad</small></td>
            {view.columns.map(col => {
              const cell = row.cells[col.intention]; const m = forced || col.metric;
              if (!cell) return <td key={col.intention}><span className={styles.cepCellEmpty}>—</span></td>;
              const value = metricValue(cell.current, m);
              const heat = row.unknown ? null : cepHeat(value, columnMedian(m, col.intention), m.direction);
              return <td key={col.intention}><div className={styles.cepCell} style={heatStyle(heat)}>
                <strong>{formatMetric(value, m.format, currency)}</strong>
                <small>{formatCompactMoney(cell.current.spend, currency)} · {cell.ads} ad</small>
              </div></td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
    </div>
    <div className={styles.sectionCard}>
      <div className={styles.sectionHead}><div><span className={styles.templateTag}>PER CEP</span><strong>Respon dan hasil per CEP</strong><span>Perubahan dibanding periode lalu · diurutkan menurut spend</span></div>
        <span>Median CEP · {view.resultMetric.label} {formatMetric(view.medians[view.resultMetric.id] ?? null, view.resultMetric.format, currency)}</span></div>
      <div className={styles.tableWrap} style={{ border: 0, borderRadius: 0 }}>
        <table className={styles.cepTable}>
          <thead><tr><th scope="col">CEP</th><th scope="col">Spend</th>{view.metrics.map(m => <th key={m.id} scope="col" title={m.denominator ? `${MEASURES[m.numerator]} ÷ ${MEASURES[m.denominator]}` : MEASURES[m.numerator]}>{m.label}</th>)}<th scope="col">Hasil</th></tr></thead>
          <tbody>{view.rows.map((row, i) => <tr key={row.cep}>
            <td>{row.unknown ? <span className={styles.cepUnknown}>{row.label}</span> : <button type="button" className={styles.cepName} onClick={() => onOpenCep(row.cep)}>{row.label}</button>}
              <div className={styles.shareBar} aria-hidden="true"><i style={{ width: `${row.spendShare * 100}%`, background: cepColor(i, row.unknown) }} /></div>
              {row.unknown && <small><Link href="/dashboard/meta-funnels/mapping">Lengkapi tag CEP di Pemetaan Ads</Link></small>}</td>
            <td><strong>{formatCompactMoney(row.current.spend, currency)}</strong><small>{Math.round(row.spendShare * 100)}% · <Delta value={relativeChange(row.current.spend, row.previous.spend)} direction="higher" /></small></td>
            {view.metrics.map(m => { const now = metricValue(row.current, m), before = metricValue(row.previous, m); const heat = row.unknown ? null : cepHeat(now, view.medians[m.id], m.direction);
              return <td key={m.id}><div className={styles.cepCell} style={heatStyle(heat)}><strong>{formatMetric(now, m.format, currency)}</strong><small><Delta value={relativeChange(now, before)} direction={m.direction} /></small></div></td>; })}
            <td><strong>{formatCount(row.current[view.resultMetric.denominator!] ?? 0)}</strong><small>{MEASURES[view.resultMetric.denominator!]}</small></td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
    <p className={styles.muted}>CEP dan intention dibaca dari dua bracket pertama nama ad, atau koreksi manual di Pemetaan Ads. Warna membandingkan dengan median CEP di kolom yang sama, bukan dengan total brand. Baris "Belum terpetakan" tetap ditampilkan agar porsi spend tanpa tag tidak tersembunyi.</p>
  </div>;
}
