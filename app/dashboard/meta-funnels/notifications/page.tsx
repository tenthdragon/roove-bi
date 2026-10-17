'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getMetaFunnelNotifications, markMetaFunnelAlertRead } from '@/lib/meta-funnel-actions';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { GROUPING_OPTIONS, type AdGrouping } from '@/lib/meta-ad-naming';
import type { FunnelMetric } from '@/lib/meta-funnel-domain';
import MetaAdCreative, { type MetaAdCreativeData } from '@/components/MetaAdCreative';
import MetaAdsNav from '@/components/MetaAdsNav';
import styles from '../page.module.css';

type Data = Extract<Awaited<ReturnType<typeof getMetaFunnelNotifications>>, { schemaReady: true }>;
const message = (error: unknown) => error instanceof Error ? error.message : 'Permintaan gagal.';
function format(value: number | null, kind: FunnelMetric['format'], currency: string) {
  if (value === null || !Number.isFinite(value)) return '—';
  if (kind === 'percent') return `${(value * 100).toFixed(2)}%`;
  if (kind === 'multiple') return `${value.toFixed(2)}×`;
  return new Intl.NumberFormat('id-ID', kind === 'money' ? { style: 'currency', currency, maximumFractionDigits: 0 } : { maximumFractionDigits: 1 }).format(value);
}

export default function MetaFunnelNotificationsPage() {
  const { activeWorkspace } = useWorkspace();
  const [data, setData] = useState<Data | null>(null);
  const [schemaReady, setSchemaReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [marking, setMarking] = useState<string | null>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await getMetaFunnelNotifications();
      if (current !== request.current) return;
      setSchemaReady(result.schemaReady);
      if (result.schemaReady) setData(result);
    } catch (error) { if (current === request.current) setError(message(error)); }
    finally { if (current === request.current) setLoading(false); }
  }, [activeWorkspace.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const guard = request;
    setData(null); void load();
    return () => { guard.current++; };
  }, [load]);
  async function markRead(id: string) {
    setMarking(id); setError('');
    try {
      await markMetaFunnelAlertRead(id);
      window.dispatchEvent(new Event('meta-funnel-notifications-changed'));
      await load();
    } catch (error) { setError(message(error)); }
    finally { setMarking(null); }
  }
  const unread = data?.alerts.filter(alert => !alert.read).length || 0;
  return <div className={styles.page}>
    <MetaAdsNav title="Notifikasi" subtitle={data ? `${unread} belum dibaca · penurunan per landing page menurut template funnel` : undefined}
      actions={<button className={styles.button} disabled={loading} onClick={() => void load()}>Muat ulang</button>} />
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {loading && <p role="status" className={styles.muted}>Memuat notifikasi…</p>}
    {!schemaReady && <div className={styles.card}>Pasang migration 198_meta_ad_funnels.sql untuk mengaktifkan notifikasi.</div>}
    {data && !data.alerts.length && <div className={styles.card}>Belum ada notifikasi penurunan.</div>}
    {data?.alerts.map(alert => <article className={`${styles.card} ${styles.alert}`} key={alert.id}>
      <small className={styles.muted}>{alert.payload.funnel_name || 'Monitoring Meta'} · {GROUPING_OPTIONS[(alert.payload.group_by || 'ad_name') as AdGrouping]}</small>
      <div className={styles.sectionHeader}><h3>{alert.payload.ad_name}</h3>{!alert.read ? <button className={styles.button} disabled={marking !== null} onClick={() => void markRead(alert.id)}>{marking === alert.id ? 'Menyimpan…' : 'Tandai dibaca'}</button> : <span className={styles.muted}>Sudah dibaca</span>}</div>
      <p><b>{alert.payload.metric_label}</b> berubah <span style={{ color: 'var(--red)' }}>{alert.payload.change.toFixed(1)}%</span> · {format(alert.payload.previous, alert.payload.format, alert.payload.currency || 'IDR')} → {format(alert.payload.current, alert.payload.format, alert.payload.currency || 'IDR')}</p>
      <small>{alert.payload.from} – {alert.payload.to} vs {alert.payload.baseline_from} – {alert.payload.baseline_to}</small>
      <ul>{alert.payload.insights.map((insight: string) => <li key={insight}>{insight}</li>)}</ul>
      <h4>Ad yang ikut melemah</h4>{!alert.payload.suspects.length && <p className={styles.muted}>Belum ada ad individual dengan baseline yang cukup. Periksa perubahan komposisi ad.</p>}
      {alert.payload.suspects.map((suspect: { account_id: string; account_name: string; ad_id: string; ad_name?: string; change: number; creative: MetaAdCreativeData | null }) => <div className={styles.suspect} key={`${suspect.account_id}:${suspect.ad_id}`}>
        {suspect.creative && <MetaAdCreative creative={suspect.creative} />}<span>{suspect.ad_name && <b>{suspect.ad_name}<br /></b>}{suspect.account_name} · ad {suspect.ad_id} · {suspect.change.toFixed(1)}%</span>
      </div>)}
    </article>)}
  </div>;
}
