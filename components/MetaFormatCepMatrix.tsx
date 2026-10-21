'use client';

import { useState } from 'react';
import { MEASURES, metricValue } from '@/lib/meta-funnel-domain';
import { MATRIX_METRICS, type FormatCepMatrix } from '@/lib/meta-format-cep-matrix';
import { CREATIVE_FORMAT_LABELS } from '@/lib/meta-creative-format';
import { formatCompactMoney, formatCount, formatMetric } from '@/lib/meta-format';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

export default function MetaFormatCepMatrix({ matrix, currency }: { matrix: FormatCepMatrix; currency: string }) {
  const [selected, setSelected] = useState('');
  const universe = matrix.universes.find(u => u.key === selected) || matrix.universes[0];
  if (!universe) return <div className={styles.card}>Belum ada iklan pada periode dan filter ini.</div>;
  return <div className={styles.sectionCard}>
    <div className={styles.sectionHead}>
      <div><strong>CEP × format iklan</strong><span>{universe.ads} ads · {formatCompactMoney(universe.current.spend, currency)}</span>
        {universe.overlapAds > 0 && <span title="Iklan yang memiliki beberapa CEP dihitung penuh pada setiap CEP. Jumlah dan spend di header menghitung setiap iklan sekali.">{universe.overlapAds} ad di beberapa CEP</span>}
      </div>
      <div><select aria-label="Optimasi Matrix" value={universe.key} title={`${universe.description} · Konfigurasi optimasi terbaru yang tersinkron.`} onChange={e => setSelected(e.target.value)}>
        {matrix.universes.map(u => <option key={u.key} value={u.key}>{u.label}</option>)}
      </select></div>
    </div>
    <div className={styles.tableWrap} style={{ border: 0, borderRadius: 0 }}>
      <table className={styles.formatCepMatrix} aria-label={`Matrix CEP × format iklan · ${universe.label}`}>
        <thead><tr><th scope="col">CEP</th>{universe.columns.map(format => <th key={format} scope="col">{CREATIVE_FORMAT_LABELS[format]}</th>)}</tr></thead>
        <tbody>{universe.rows.map(row => <tr key={row.cep}>
          <th scope="row"><strong className={row.unknown ? styles.muted : undefined}>{row.label}</strong><small>{row.ads} ads · {formatCompactMoney(row.current.spend, currency)}</small></th>
          {universe.columns.map(format => {
            const cell = row.cells[format];
            if (!cell) return <td key={format}><span className={styles.cepCellEmpty} aria-label={`Belum ada iklan ${CREATIVE_FORMAT_LABELS[format]} untuk ${row.label}`}>—</span></td>;
            return <td key={format}><div className={styles.matrixCell}>
              <span className={styles.matrixAdCount} title={cell.latestFormatAds ? `${cell.latestFormatAds} iklan memakai format creative terbaru yang cocok dengan inventori karena ID creative historis belum tersedia.` : undefined}>{cell.ads} ads</span>
              <dl className={styles.matrixMetrics}>{MATRIX_METRICS.map(metric => <div key={metric.id} className={metric.id === 'cpp' ? styles.matrixResultMetric : undefined}
                title={metric.denominator ? `${formatCount(cell.current[metric.numerator] ?? 0)} ${MEASURES[metric.numerator]} ÷ ${formatCount(cell.current[metric.denominator] ?? 0)} ${MEASURES[metric.denominator]}${metric.multiplier ? ` × ${metric.multiplier}` : ''}` : MEASURES[metric.numerator]}>
                <dt>{metric.label}</dt><dd>{formatMetric(metricValue(cell.current, metric), metric, currency)}</dd>
              </div>)}</dl>
            </div></td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
