'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDateRange } from '@/lib/DateRangeContext';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { usePermissions } from '@/lib/PermissionsContext';
import { getMetaFunnelSyncStatus, queueMetaFunnelSync } from '@/lib/meta-funnel-actions';
import { getMetaBrandOverview } from '@/lib/meta-brand-actions';
import { metaSyncProgress, restoreMetaSyncRequest, type MetaSyncRequest } from '@/lib/meta-funnel-sync-status';
import { WORLD_LABELS } from '@/lib/meta-funnel-templates';
import type { AdDimensionFilters } from '@/lib/meta-ad-dimensions';
import { formatChange, formatCompactMoney, formatDate, formatMetric } from '@/lib/meta-format';
import MetaAdsNav from '@/components/MetaAdsNav';
import MetaSyncProgress from '@/components/MetaSyncProgress';
import MetaAdDimensionFilters from '@/components/MetaAdDimensionFilters';
import styles from './page.module.css';

type Data = Extract<Awaited<ReturnType<typeof getMetaBrandOverview>>, { schemaReady: true }>;
type SyncStatusData = Awaited<ReturnType<typeof getMetaFunnelSyncStatus>>;
const message = (e: unknown) => e instanceof Error ? e.message : 'Permintaan gagal.';
const healthLabel = { good: 'Sehat', warn: 'Perlu perhatian', bad: 'Bermasalah' } as const;
const severityClass = { bad: styles.bad, warn: styles.warn, good: styles.good, info: styles.neutral } as const;

function Delta({ value, direction = 'higher', neutral = false }: { value: number | null; direction?: 'higher' | 'lower'; neutral?: boolean }) {
  if (value === null) return <span className={styles.neutral}>—</span>;
  const good = direction === 'higher' ? value >= 0 : value <= 0;
  return <span className={neutral ? styles.neutral : good ? styles.good : styles.bad}>{formatChange(value)}</span>;
}

export default function MetaBrandOverviewPage() {
  const router = useRouter();
  const { dateRange } = useDateRange();
  const { activeWorkspace } = useWorkspace();
  const { can } = usePermissions();
  const canManage = can('admin:meta');
  const [data, setData] = useState<Data | null>(null);
  const [schemaReady, setSchemaReady] = useState(true);
  const [filters, setFilters] = useState<AdDimensionFilters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncStarting, setSyncStarting] = useState(false);
  const [syncRequest, setSyncRequest] = useState<{ workspaceId: string; request: MetaSyncRequest | null } | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusData | null>(null);
  const [syncStatusError, setSyncStatusError] = useState('');
  const [syncRefresh, setSyncRefresh] = useState(0);
  const request = useRef(0);
  const reportVersion = useRef('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    if (view === 'alerts') router.replace('/dashboard/meta-funnels/notifications');
    if (view === 'mapping') router.replace('/dashboard/meta-funnels/mapping');
  }, [router]);
  useEffect(() => {
    let saved: MetaSyncRequest | null = null;
    try { saved = restoreMetaSyncRequest(localStorage.getItem(`meta-funnel-sync:${activeWorkspace.id}`)); } catch { /* Storage may be unavailable. */ }
    setSyncRequest({ workspaceId: activeWorkspace.id, request: saved });
    setSyncStatus(null); setSyncStatusError(''); setFilters({});
  }, [activeWorkspace.id]);
  const input = useMemo(() => ({ from: dateRange.from, to: dateRange.to, filters }), [dateRange.from, dateRange.to, filters]);
  const load = useCallback(async () => {
    if (!input.from || !input.to) return;
    const current = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await getMetaBrandOverview(input);
      if (current !== request.current) return;
      setSchemaReady(result.schemaReady);
      if (result.schemaReady) { setData(result); reportVersion.current = result.reportVersion; }
    } catch (e) { if (current === request.current) setError(message(e)); }
    finally { if (current === request.current) setLoading(false); }
  }, [input]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const guard = request; return () => { guard.current++; }; }, []);
  const trackedSync = syncRequest?.workspaceId === activeWorkspace.id ? syncRequest.request : null;
  const currentSyncStatus = syncStatus?.workspaceId === activeWorkspace.id ? syncStatus : null;
  const syncProgress = trackedSync && currentSyncStatus?.trackedJobs ? metaSyncProgress(trackedSync.jobIds, currentSyncStatus.trackedJobs) : null;
  const hasPendingJobs = currentSyncStatus ? currentSyncStatus.pending > 0 : data?.jobs.some(j => ['queued', 'running'].includes(j.status));
  useEffect(() => {
    if (!schemaReady || syncRequest?.workspaceId !== activeWorkspace.id) return;
    let alive = true, polling = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (polling) return;
      polling = true;
      let again = true;
      try {
        const status = await getMetaFunnelSyncStatus(syncRequest?.request?.jobIds);
        if (!alive || status.workspaceId !== activeWorkspace.id) return;
        setSyncStatus(status); setSyncStatusError('');
        const tracked = syncRequest?.request;
        again = status.pending > 0 || !!(tracked && status.trackedJobs && metaSyncProgress(tracked.jobIds, status.trackedJobs).active);
        if (status.reportVersion !== reportVersion.current) await load();
      } catch (e) { if (alive) setSyncStatusError(message(e)); }
      finally { polling = false; if (alive && again) timer = setTimeout(() => void poll(), 5000); }
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [syncRequest, activeWorkspace.id, schemaReady, syncRefresh, load]);
  async function sync() {
    setBusy(true); setSyncStarting(true); setError(''); setNotice('');
    try {
      const result = await queueMetaFunnelSync();
      const queued = { jobIds: result.jobs, startedAt: new Date().toISOString() };
      try { localStorage.setItem(`meta-funnel-sync:${activeWorkspace.id}`, JSON.stringify(queued)); } catch { /* Progress still works without persistence. */ }
      setSyncStatus(null); setSyncStatusError('');
      setSyncRequest({ workspaceId: activeWorkspace.id, request: queued });
      setNotice('Sync masuk antrean. Laporan diperbarui otomatis setelah data baru tersimpan.');
    } catch (e) { setError(message(e)); } finally { setBusy(false); setSyncStarting(false); setSyncRefresh(v => v + 1); }
  }
  const lastSync = data?.jobs.find(j => j.completed_at)?.completed_at;
  const subtitle = data ? `Periode ${formatDate(data.reportRange.from)} – ${formatDate(data.reportRange.to)} dibanding ${formatDate(data.prevFrom)} – ${formatDate(data.prevTo)}${lastSync ? ` · sync terakhir ${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(lastSync))} WIB` : ''}` : 'Respon iklan dinilai sama di kedua dunia. Hasil dinilai per dunia.';
  const hasFilters = !!(filters.cep || filters.intention || filters.objective);
  const currency = data?.currency || 'IDR';
  return <div className={styles.page} aria-busy={loading}>
    <MetaAdsNav title="Ringkasan brand" subtitle={subtitle} actions={<>
      <button className={styles.button} onClick={() => { void load(); setSyncRefresh(v => v + 1); }} disabled={loading}>Muat ulang</button>
      {canManage && <button className={styles.primary} disabled={busy || hasPendingJobs || !schemaReady} onClick={() => void sync()}>{syncStarting ? 'Menyiapkan sync…' : hasPendingJobs ? 'Sync berlangsung…' : 'Sync'}</button>}
    </>} />
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {notice && <div role="status" className={styles.info}>{notice}</div>}
    <MetaSyncProgress progress={syncProgress} preparing={syncStarting} checking={!!trackedSync && !currentSyncStatus} status={currentSyncStatus}
      accounts={data?.accounts || []} error={syncStatusError} onRefresh={() => setSyncRefresh(v => v + 1)} />
    {!schemaReady ? <div className={styles.card}>Pengelompokan iklan belum tersedia. Hubungi admin untuk mengaktifkannya.</div> : <>
      {data && <div className={styles.kpiGrid}>
        <div className={styles.kpi}><span className={styles.muted}>Total spend</span><span className={styles.kpiValue}>{formatCompactMoney(data.totals.spend, currency)}</span><span className={styles.kpiDelta}><Delta value={data.totals.spendChange} neutral /> vs periode lalu</span></div>
        <div className={styles.kpi}><span className={styles.muted}>Porsi dunia</span>
          <div className={styles.split} aria-hidden="true"><div className={styles.splitWeb} style={{ width: `${data.totals.spend > 0 ? data.totals.website / data.totals.spend * 100 : 0}%` }} /><div className={styles.splitCpas} style={{ width: `${data.totals.spend > 0 ? data.totals.cpas / data.totals.spend * 100 : 0}%` }} /></div>
          <span className={styles.legend}><span><i className={styles.splitWeb} />Website {data.totals.spend > 0 ? Math.round(data.totals.website / data.totals.spend * 100) : 0}%</span><span><i className={styles.splitCpas} />CPAS {data.totals.spend > 0 ? Math.round(data.totals.cpas / data.totals.spend * 100) : 0}%</span></span></div>
        <div className={styles.kpi}><span className={styles.muted}>CTR outbound · semua brand</span><span className={styles.kpiValue}>{formatMetric(data.totals.ctr.current, 'percent', currency)}</span><span className={styles.kpiDelta}><Delta value={data.totals.ctr.change} /> vs periode lalu</span></div>
        <div className={styles.kpi}><span className={styles.muted}>Catatan data</span><span className={`${styles.kpiValue} ${data.dataNotes ? styles.warn : ''}`}>{data.dataNotes ? `${data.dataNotes} catatan` : 'Lengkap'}</span>
          <span className={styles.kpiDelta}>{data.templates.length ? `${data.templates.length} template funnel` : <Link href="/dashboard/meta-funnels/templates">Belum ada template funnel · buat</Link>}</span></div>
      </div>}
      <details className={styles.filterDetails}><summary>Filter{hasFilters ? ' · aktif' : ''}</summary>
        <div className={styles.filterPanel}>{data && <MetaAdDimensionFilters value={filters} options={data.dimensionOptions} ready={data.dimensionsReady} onChange={setFilters} onReset={() => setFilters({})} />}</div>
      </details>
      {loading && !data && <p role="status" className={styles.muted}>Memuat ringkasan brand…</p>}
      {data && <div className={styles.sectionCard}>
        <div className={styles.sectionHead}><div><strong>Kualitas iklan per brand</strong><span>Klik brand untuk melihat tahap mana yang bocor dan landing page mana penyebabnya.</span></div></div>
        {!data.brands.length ? <p className={styles.card} style={{ border: 0 }}>Belum ada akun Meta aktif yang terpetakan ke brand. Petakan akun di Admin Meta.</p> : <div className={styles.tableWrap} style={{ border: 0, borderRadius: 0 }}>
          <table className={styles.brandTable}>
            <thead><tr>
              <th scope="col">Brand</th><th scope="col" className={styles.num}>Spend</th><th scope="col" className={styles.num} title="Lapisan bersama: respon terhadap iklan">CTR outbound</th>
              <th scope="col" className={`${styles.num} ${styles.worldCol}`}>Website · CPP</th><th scope="col" className={styles.num}>Website · CPL</th>
              <th scope="col" className={`${styles.num} ${styles.worldCol}`}>CPAS · CPP</th><th scope="col" className={styles.num}>CPAS · ROAS</th>
              <th scope="col" className={styles.worldCol}>Sorotan</th>
            </tr></thead>
            <tbody>{data.brands.map(b => <tr key={b.id}>
              <td><Link className={styles.brandName} href={`/dashboard/meta-funnels/brand/${b.id}`}><span className={`${styles.healthDot} ${b.health === 'good' ? styles.healthGood : b.health === 'warn' ? styles.healthWarn : styles.healthBad}`} aria-hidden="true" />{b.name}</Link>
                <small>{healthLabel[b.health]} · {b.adCount} ad{b.reportingError ? ` · ${b.reportingError}` : ''}</small></td>
              <td className={styles.num}><strong>{formatCompactMoney(b.spend.total, b.currency)}</strong><small>Web {formatCompactMoney(b.spend.website, b.currency)} · CPAS {formatCompactMoney(b.spend.cpas, b.currency)}</small></td>
              <td className={styles.num}><strong>{formatMetric(b.ctr.current, 'percent', b.currency)}</strong><small><Delta value={b.ctr.change} /></small></td>
              <td className={`${styles.num} ${styles.worldCol}`}>{b.website.cpp ? <><strong>{formatMetric(b.website.cpp.current, 'money', b.currency)}</strong><small><Delta value={b.website.cpp.change} direction="lower" /></small></> : <><span className={styles.neutral}>—</span><small>tidak ada template Transaksi</small></>}</td>
              <td className={styles.num}>{b.website.cpl ? <><strong>{formatMetric(b.website.cpl.current, 'money', b.currency)}</strong><small><Delta value={b.website.cpl.change} direction="lower" />{b.website.cplLabel !== 'CPL' ? ` · ${b.website.cplLabel}` : ''}</small></> : <><span className={styles.neutral}>—</span><small>tidak ada template Lead</small></>}</td>
              <td className={`${styles.num} ${styles.worldCol}`}>{b.cpas ? <><strong>{formatMetric(b.cpas.cpp.current, 'money', b.currency)}</strong><small><Delta value={b.cpas.cpp.change} direction="lower" /></small></> : <><span className={styles.neutral}>—</span><small>tidak beriklan CPAS</small></>}</td>
              <td className={styles.num}>{b.cpas ? <><strong>{formatMetric(b.cpas.roas.current, 'multiple', b.currency)}</strong><small><Delta value={b.cpas.roas.change} /></small></> : <span className={styles.neutral}>—</span>}</td>
              <td className={styles.worldCol} style={{ minWidth: 300 }}>{b.highlights.length ? b.highlights.map((h, i) => <div key={i} className={styles.highlightInline}><b className={severityClass[h.severity]}>{h.title}</b> · {WORLD_LABELS[h.world]} · {h.text}</div>)
                : <div className={styles.highlightInline}><b className={styles.neutral}>Stabil</b> · tidak ada sinyal penurunan pada periode ini</div>}
                {b.website.unassigned > 0 && <div className={styles.highlightInline}><b className={styles.warn}>Template</b> · {b.website.unassigned} landing page belum ditetapkan, <Link href="/dashboard/meta-funnels/templates">tetapkan</Link></div>}</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </div>}
      <div className={styles.kpiGrid}>
        <div className={styles.kpi}><span><b>Respon iklan</b> dihitung sama untuk semua ad: CPM, CTR outbound, hook rate, LPV ratio.</span></div>
        <div className={styles.kpi}><span><b className={styles.good} style={{ color: 'var(--accent)' }}>Website</b> dinilai per template funnel landing page: Transaksi memakai CPP dan ROAS, Lead memakai CPL.</span></div>
        <div className={styles.kpi}><span><b className={styles.warn}>CPAS</b> dinilai dari purchase Shopee: CPP dan ROAS. Atribusi shared items 1 hari / 7 hari belum dipisahkan.</span></div>
      </div>
    </>}
  </div>;
}
