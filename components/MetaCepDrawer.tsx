'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getMetaFunnelHistory } from '@/lib/meta-funnel-actions';
import { getMetaCepDetail } from '@/lib/meta-brand-actions';
import { metricValue, relativeChange, type FunnelMetric, type Totals } from '@/lib/meta-funnel-domain';
import { WORLD_CHANNEL, WORLD_LABELS, type MetaBrandWorld } from '@/lib/meta-funnel-templates';
import type { MetaAnalysisFilters } from '@/lib/meta-analysis-filters';
import { formatChange, formatCompactMoney, formatMetric } from '@/lib/meta-format';
import { cepProgressMetrics } from '@/lib/meta-cep-view';
import MetaSparkline from './MetaSparkline';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

type Detail = Extract<Awaited<ReturnType<typeof getMetaCepDetail>>, { schemaReady: true }>;
const message = (e: unknown) => e instanceof Error ? e.message : 'Permintaan gagal.';

/** Centered detail dialog for one CEP: its 90-day trend, the destinations carrying it, and its top ads. */
export default function MetaCepDrawer({ cep, label, world, input, metrics, resultMetric, currency, onClose }: {
  cep: string; label: string; world: MetaBrandWorld; input: { from: string; to: string; brandId: string; filters: MetaAnalysisFilters };
  metrics: FunnelMetric[]; resultMetric: FunnelMetric; currency: string; onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [history, setHistory] = useState<{ date: string; totals: Totals; complete: boolean }[]>([]);
  const [metricId, setMetricId] = useState(resultMetric.id);
  const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const metric = metrics.find(m => m.id === metricId) || resultMetric;
  useEffect(() => {
    let alive = true; setLoading(true); setError(''); setDetail(null); setHistory([]); setHistoryError('');
    const filters = { ...input.filters, cep };
    Promise.all([
      getMetaCepDetail({ from: input.from, to: input.to, brandId: input.brandId, filters: input.filters, world, cep }),
      getMetaFunnelHistory({ from: input.from, to: input.to, brandId: input.brandId, filters, channel: WORLD_CHANNEL[world], groupBy: 'ad', view: 'trends', period: 'weekly' })
        .catch(() => { if (alive) setHistoryError('Tren CEP belum berhasil dimuat.'); return null; }),
    ]).then(([result, trend]) => {
      if (!alive) return;
      if (!result.schemaReady) throw new Error('Laporan Meta belum siap. Hubungi admin.');
      setDetail(result);
      if (trend?.schemaReady) setHistory(trend.history);
      else if (trend) setHistoryError('Tren CEP belum tersedia. Hubungi admin.');
    }).catch(e => { if (alive) setError(message(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [cep, world, input.from, input.to, input.brandId, input.filters]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const now = detail ? metricValue(detail.summary, resultMetric) : null, before = detail ? metricValue(detail.previous, resultMetric) : null;
  const change = relativeChange(now, before);
  const good = change === null ? null : resultMetric.direction === 'higher' ? change >= 0 : change <= 0;
  const progress = cepProgressMetrics(world, resultMetric);
  const Row = ({ name, sub, current, previous, funnel }: { name: string; sub: string; current: Totals; previous: Totals; funnel?: boolean }) => {
    const a = metricValue(current, resultMetric), b = metricValue(previous, resultMetric), d = relativeChange(a, b);
    return <div className={styles.adRow}><div><b title={name}>{name}</b><small>{sub} · {formatCompactMoney(current.spend, currency)}</small>
      {funnel && <small>{progress.map(m => `${m.label} ${formatMetric(metricValue(current, m), m, currency)}`).join(' · ')}</small>}</div>
      <div className={styles.adResult}>{resultMetric.label} {formatMetric(a, resultMetric, currency)}<br /><small className={d === null ? styles.neutral : (resultMetric.direction === 'higher' ? d >= 0 : d <= 0) ? styles.good : styles.bad}>{formatChange(d)}</small></div></div>;
  };
  return <>
    <div className={styles.drawerBackdrop} onClick={onClose} aria-hidden="true" />
    <aside className={`${styles.drawer} ${styles.detailModal}`} role="dialog" aria-modal="true" aria-label={`Detail CEP ${label}`}>
      <div className={styles.drawerHead}>
        <div><div className={styles.muted}>CEP · {WORLD_LABELS[world]}</div><h2>{label}</h2><div className={styles.muted}>{detail ? `${detail.matchingAds} ad pada periode ini` : loading ? 'Memuat…' : 'Data belum tersedia'}</div></div>
        <button type="button" className={styles.drawerClose} aria-label="Tutup detail" onClick={onClose}><X size={16} aria-hidden="true" /></button>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.miniGrid}>
        <div className={styles.mini}><span className={styles.muted}>Spend</span><strong>{detail ? formatCompactMoney(detail.summary.spend, currency) : '—'}</strong></div>
        <div className={styles.mini}><span className={styles.muted}>{resultMetric.label}</span><strong className={good === null ? '' : good ? styles.good : styles.bad}>{formatMetric(now, resultMetric, currency)}</strong></div>
        <div className={styles.mini}><span className={styles.muted}>vs periode lalu</span><strong className={good === null ? '' : good ? styles.good : styles.bad}>{formatChange(change)}</strong></div>
      </div>
      <div>
        <div className={styles.sectionTitle}><h3 style={{ margin: 0, fontSize: 13 }}>Tren 90 hari</h3>
          <select aria-label="Metrik tren CEP" value={metric.id} onChange={e => setMetricId(e.target.value)} style={{ minHeight: 32, padding: '4px 8px' }}>{metrics.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></div>
        <div style={{ marginTop: 8 }}><MetaSparkline values={history.map(p => p.complete ? metricValue(p.totals, metric) : null)} label={`Tren ${metric.label} CEP ${label}`} /></div>
        {historyError && <p role="status" className={styles.muted}>{historyError}</p>}
        <div className={styles.muted} style={{ fontSize: 11 }}>Mingguan · {history.filter(p => p.complete).length} minggu lengkap</div>
      </div>
      {world === 'website' && <div>
        <div className={styles.sectionTitle}><h3 style={{ margin: 0, fontSize: 13 }}>Tujuan yang dipakai CEP ini</h3><span>{detail?.destinations.length || 0} tujuan · progres funnel per tujuan</span></div>
        {loading && <p role="status" className={styles.muted}>Memuat…</p>}
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>{detail?.destinations.map(d => <Row key={d.key} name={d.name} sub={`${d.ads} ad · ${d.accounts.join(', ')}`} current={d.current} previous={d.previous} funnel />)}</div>
      </div>}
      <div>
        <div className={styles.sectionTitle}><h3 style={{ margin: 0, fontSize: 13 }}>Ad teratas</h3><span>{detail?.ads.length || 0} ad · urut spend</span></div>
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>{detail?.ads.map(a => <Row key={a.key} name={a.name} sub={`Ad ${a.ad_id} · ${a.accounts.join(', ')}`} current={a.current} previous={a.previous} />)}</div>
      </div>
    </aside>
  </>;
}
