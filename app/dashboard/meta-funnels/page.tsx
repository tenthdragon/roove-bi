'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, ArrowUpDown, Info, X, BellOff, AlertCircle, ChevronDown, LoaderCircle, CheckCircle2, Clock3 } from 'lucide-react';
import { useDateRange } from '@/lib/DateRangeContext';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { usePermissions } from '@/lib/PermissionsContext';
import { archiveMetaFunnel, getMetaFunnelData, getMetaFunnelHistory, getMetaFunnelCreatives, getMetaFunnelSyncStatus, queueMetaFunnelSync, saveMetaFunnel, verifyMetaAdDestination } from '@/lib/meta-funnel-actions';
import { defaultFunnel, MEASURES, metricValue, relativeChange, shiftDay, type FunnelConfig, type FunnelMetric, type Measure, type Totals } from '@/lib/meta-funnel-domain';
import { getTodayWIB } from '@/lib/sync-schedule';
import styles from './page.module.css';
import MetaAdCreative from '@/components/MetaAdCreative';
import MetaAdDimensionFilters from '@/components/MetaAdDimensionFilters';
import type { AdDimensionFilters } from '@/lib/meta-ad-dimensions';
import type { MetaReportInput } from '@/lib/meta-ad-report';
import type { AdCreative } from '@/lib/meta-funnel-domain';
import { metaSyncProgress, restoreMetaSyncRequest, type MetaSyncRequest, type MetaSyncJob } from '@/lib/meta-funnel-sync-status';

type Data = Extract<Awaited<ReturnType<typeof getMetaFunnelData>>, { schemaReady: true }>;
type HistoryData = Extract<Awaited<ReturnType<typeof getMetaFunnelHistory>>, { schemaReady: true }>;
type SyncStatusData = Awaited<ReturnType<typeof getMetaFunnelSyncStatus>>;
type TableSort = { metricId: string | null; direction: 'asc' | 'desc' };
const measureOptions = Object.entries(MEASURES);
const message = (e: unknown) => e instanceof Error ? e.message : 'Permintaan gagal.';
function format(value: number | null, kind: FunnelMetric['format'], currency: string) {
  if (value === null || !Number.isFinite(value)) return '—';
  if (kind === 'percent') return `${(value * 100).toFixed(2)}%`;
  if (kind === 'multiple') return `${value.toFixed(2)}×`;
  return new Intl.NumberFormat('id-ID', kind === 'money' ? { style: 'currency', currency, maximumFractionDigits: 0 } : { maximumFractionDigits: 1 }).format(value);
}
function Change({ value, direction, neutral = false }: { value: number | null; direction: 'higher' | 'lower'; neutral?: boolean }) {
  if (value === null) return <span className={styles.muted}>Belum ada baseline</span>;
  const good = direction === 'higher' ? value >= 0 : value <= 0;
  return <span style={{ color: neutral ? 'var(--dim)' : good ? 'var(--green)' : 'var(--red)' }}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</span>;
}
function SortableHeader({ label, metricId, sort, onSort, description }: { label: string; metricId: string | null; sort: TableSort; onSort: (sort: TableSort) => void; description?: string }) {
  const active = sort.metricId === metricId;
  const nextDirection = active ? (sort.direction === 'asc' ? 'desc' : 'asc') : metricId === null ? 'asc' : 'desc';
  const action = metricId === null ? (nextDirection === 'asc' ? 'A–Z' : 'Z–A') : nextDirection === 'asc' ? 'terendah ke tertinggi' : 'tertinggi ke terendah';
  const Icon = active ? (sort.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return <th scope="col" aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button type="button" className={styles.sortButton} title={`${description ? `${description} · ` : ''}Urutkan ${label}: ${action}`} onClick={() => onSort({ metricId, direction: nextDirection })}>
      <span>{label}</span><Icon size={12} aria-hidden="true" />
    </button>
  </th>;
}

export default function MetaFunnelsPage() {
  const router = useRouter();
  const { dateRange } = useDateRange();
  const { activeWorkspace } = useWorkspace();
  const { can } = usePermissions();
  const canManage = can('admin:meta');
  const [data, setData] = useState<Data | null>(null);
  const [schemaReady, setSchemaReady] = useState(true);
  const [dataKey, setDataKey] = useState('');
  const [historyData, setHistoryData] = useState<{ key: string; result: HistoryData } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const reportVersion = useRef('');
  const [selectedId, setSelectedId] = useState('');
  const [groupKey, setGroupKey] = useState('');
  const [brandId, setBrandId] = useState('');
  useEffect(() => { setBrandId(''); setGroupKey(''); }, [activeWorkspace.id]);
  const [dimensionFilters, setDimensionFilters] = useState<AdDimensionFilters>({});
  const [groupBy, setGroupBy] = useState<'ad'|'landing_page'>('landing_page');
  const [tab, setTab] = useState<'overview' | 'daily' | 'trends'>('overview');
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const [metricId, setMetricId] = useState('outbound_ctr');
  const [search, setSearch] = useState('');
  const [tableSort, setTableSort] = useState<TableSort>({ metricId: 'spent', direction: 'desc' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [syncStarting, setSyncStarting] = useState(false);
  const [syncRequest, setSyncRequest] = useState<{ workspaceId: string; request: MetaSyncRequest | null } | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatusData | null>(null);
  const [syncStatusError, setSyncStatusError] = useState('');
  const [syncRefresh, setSyncRefresh] = useState(0);
  useEffect(() => {
    let saved: MetaSyncRequest | null = null;
    try { saved = restoreMetaSyncRequest(localStorage.getItem(`meta-funnel-sync:${activeWorkspace.id}`)); } catch { /* Storage may be unavailable. */ }
    setSyncRequest({ workspaceId: activeWorkspace.id, request: saved });
    setSyncStatus(null); setSyncStatusError('');
  }, [activeWorkspace.id]);
  const [editor, setEditor] = useState<{ id?: string; version?: number; config: FunnelConfig } | null>(null);
  const [destinationEditor, setDestinationEditor] = useState<{ accountId: string; adId: string; name: string; url: string } | null>(null);
  const request = useRef(0);
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get('view');
    if (view === 'alerts') router.replace('/dashboard/meta-funnels/notifications');
    if (view === 'mapping') router.replace('/dashboard/meta-funnels/mapping');
  }, [router]);
  const reportInput = useMemo<MetaReportInput>(() => ({ from: dateRange.from, to: dateRange.to, brandId: brandId || undefined, funnelId: selectedId || undefined, filters: dimensionFilters, groupBy }),
    [dateRange.from, dateRange.to, brandId, selectedId, dimensionFilters, groupBy]);
  const overviewKey = JSON.stringify([activeWorkspace.id, reportInput]);
  const historyKey = JSON.stringify([overviewKey, data?.reportVersion, tab, tab === 'trends' ? period : 'daily', groupKey]);
  const load = useCallback(async () => {
    if (!reportInput.from || !reportInput.to) return;
    const currentRequest = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await getMetaFunnelData(reportInput);
      if (currentRequest !== request.current) return;
      setSchemaReady(result.schemaReady);
      if (result.schemaReady) { setData(result); setDataKey(overviewKey); reportVersion.current = result.reportVersion; }
    } catch (e) { if (currentRequest === request.current) setError(message(e)); }
    finally { if (currentRequest === request.current) setLoading(false); }
  }, [reportInput, overviewKey]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const guard = request; return () => { guard.current++; }; }, []);
  useEffect(() => { if (dataKey === overviewKey && groupKey && data && !data.groups.some(g => g.key === groupKey)) setGroupKey(''); }, [data, dataKey, overviewKey, groupKey]);
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
        else setData(current => current ? { ...current, jobs: status.jobs } : current);
      } catch (e) { if (alive) setSyncStatusError(message(e)); }
      finally { polling = false; if (alive && again) timer = setTimeout(() => void poll(), 5000); }
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [syncRequest, activeWorkspace.id, schemaReady, syncRefresh, load]);
  const overviewReady = dataKey === overviewKey && !!data && !data.reportingError;
  useEffect(() => {
    if (tab === 'overview' || loading || !overviewReady) return;
    let alive = true;
    setHistoryLoading(true); setHistoryError('');
    void getMetaFunnelHistory({ ...reportInput, groupKey: groupKey || undefined, view: tab, period })
      .then(result => {
        if (!alive) return;
        if (!result.schemaReady) throw new Error('Migration laporan Meta belum tersedia.');
        setHistoryData({ key: historyKey, result });
      }).catch(e => { if (alive) setHistoryError(message(e)); })
      .finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [tab, period, reportInput, groupKey, historyKey, overviewReady, loading]);
  async function sync() {
    setBusy(true); setSyncStarting(true); setError(''); setNotice('');
    try {
      const result = await queueMetaFunnelSync();
      const queued = { jobIds: result.jobs, startedAt: new Date().toISOString() };
      try { localStorage.setItem(`meta-funnel-sync:${activeWorkspace.id}`, JSON.stringify(queued)); } catch { /* Progress still works without persistence. */ }
      setSyncStatus(null); setSyncStatusError('');
      setSyncRequest({ workspaceId: activeWorkspace.id, request: queued });
      await load();
    } catch (e) { setError(message(e)); } finally { setBusy(false); setSyncStarting(false); setSyncRefresh(value => value + 1); }
  }
  async function save() {
    if (!editor) return;
    setBusy(true); setError('');
    try {
      const result = await saveMetaFunnel(editor);
      setEditor(null); setGroupKey(''); setSelectedId(result.id); setNotice(result.warning || 'Konfigurasi funnel tersimpan.');
      await load();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function archive() {
    if (!editor?.id) return;
    setBusy(true); setError('');
    try { await archiveMetaFunnel(editor.id); setEditor(null); setSelectedId(''); setGroupKey(''); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function verifyDestination() {
    if (!destinationEditor) return;
    setBusy(true); setError('');
    try {
      const saved = await verifyMetaAdDestination(destinationEditor);
      setDestinationEditor(null); setGroupKey(''); setNotice(`URL ad terverifikasi: ${saved.url}`); await load();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const config = data?.config || defaultFunnel();
  const monitoredAccounts = data?.accounts.filter(a => data.scopedAccountIds.includes(a.account_id)) || [];
  const metric = config.metrics.find(m => m.id === metricId) || config.metrics[0];
  const group = data?.groups.find(g => g.key === groupKey);
  const sort = tableSort.metricId === null || config.metrics.some(m => m.id === tableSort.metricId) ? tableSort : { ...tableSort, metricId: config.metrics[0].id };
  const sortValue = (g: Data['groups'][number]) => {
    const value = g.metrics.find(m => m.id === sort.metricId)?.current;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const visibleGroups = (groups: Data['groups']) => groups.filter(g => (!groupKey || g.key === groupKey) && [g.name, ...g.ad_ids, ...g.landing_page_urls].some(n => n.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => {
    const byName = a.name.localeCompare(b.name, 'id', { numeric: true, sensitivity: 'base' }) || a.key.localeCompare(b.key);
    const direction = sort.direction === 'asc' ? 1 : -1;
    if (sort.metricId === null) return direction * byName;
    const left = sortValue(a), right = sortValue(b);
    // Undefined ratios remain at the bottom in either direction.
    if (left === null) return right === null ? byName : 1;
    if (right === null) return -1;
    return direction * (left - right) || byName;
  });
  const breakdown = (groups: Data['groups'], summary: Totals, previous: Totals, currency: string, sectionBrand?: string) => <div className={styles.tableWrap}>
            <table className={styles.breakdownTable} aria-label={groupBy === 'ad' ? 'Breakdown per ad' : 'Breakdown per landing page'}>
              <thead><tr><SortableHeader label={groupBy === 'ad' ? 'Ad' : 'URL landing page'} metricId={null} sort={sort} onSort={setTableSort} />{config.metrics.map(m => <SortableHeader key={m.id} label={m.label} metricId={m.id} sort={sort} onSort={setTableSort} description={m.denominator ? `${MEASURES[m.numerator]} ÷ ${MEASURES[m.denominator]}${m.multiplier ? ` × ${m.multiplier}` : ''}` : MEASURES[m.numerator]} />)}</tr></thead>
              <tbody>{visibleGroups(groups).map(g => <tr key={g.key}>
                <td><button className={styles.nameButton} onClick={() => { if (sectionBrand) setBrandId(sectionBrand); setGroupKey(g.key); }}>{g.name}</button><small>{groupBy === 'ad' ? `Ad ${g.ad_ids.join(', ')}` : `${g.ad_ids.length} ad`} · {g.accounts.join(', ')}</small>
                  {g.landing_page_urls.length > 1 && <small>Creative memiliki beberapa tujuan; Meta tidak membagi hasil per URL.</small>}
                  <GroupDetails group={g} currency={currency} input={{ ...reportInput, brandId: sectionBrand || reportInput.brandId }} cacheKey={`${overviewKey}:${data?.reportVersion}`} />
                </td>
                {config.metrics.map(m => { const c = g.metrics.find(v => v.id === m.id)!; return <td key={m.id}>{format(c.current, m.format, currency)}<small><Change value={c.change} direction={m.direction} neutral={!m.monitor} /></small></td>; })}
              </tr>)}</tbody>
              <tfoot><tr><th scope="row">{sectionBrand ? 'Total brand' : 'Total'}<small>Periode & filter aktif</small></th>{config.metrics.map(m => <td key={m.id}>{format(metricValue(summary, m), m.format, currency)}<small><Change value={relativeChange(metricValue(summary, m), metricValue(previous, m))} direction={m.direction} neutral={!m.monitor} /></small></td>)}</tr></tfoot>
            </table>
  </div>;
  const totals = group?.current || data?.summary;
  const prev = group?.previous || data?.previous;
  const historyResult = historyData?.key === historyKey ? historyData.result : null;
  const history = historyResult?.history || [];
  const chartData = history.map(p => ({ date: p.date, value: p.metrics[metric.id] === null ? null : p.metrics[metric.id]! * (metric.format === 'percent' ? 100 : 1) }));
  return <div className={styles.page} aria-busy={loading || (tab !== 'overview' && historyLoading)}>
    <div className={styles.header}>
      <div><div className={styles.eyebrow}>MARKETING / AD PERFORMANCE</div><h1>Meta Ad Funnels</h1><p>Filter ads berdasarkan brand, CEP, intention, dan objective Meta.</p></div>
      <div className={styles.actions}>
        <Link className={styles.button} href="/dashboard/meta-funnels/mapping">Pemetaan Ads</Link>
        <button className={styles.button} onClick={() => { void load(); setSyncRefresh(value => value + 1); }} disabled={loading}>Muat ulang</button>
        {canManage && <><button className={styles.button} disabled={busy || hasPendingJobs || !schemaReady} onClick={() => void sync()}>{syncStarting ? 'Menyiapkan sync…' : hasPendingJobs ? 'Sync berlangsung…' : 'Sync'}</button>
          <button className={styles.primary} disabled={!schemaReady} onClick={() => setEditor({ config: defaultFunnel() })}>+ Funnel baru</button></>}
      </div>
    </div>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {notice && <div role="status" className={styles.info}>{notice}</div>}
    <SyncProgress progress={syncProgress} preparing={syncStarting} checking={!!trackedSync && !currentSyncStatus} status={currentSyncStatus}
      accounts={data?.accounts || []} error={syncStatusError} onRefresh={() => setSyncRefresh(value => value + 1)} />
    {!schemaReady ? <div className={styles.card}>Migration laporan Meta belum terpasang (203).</div> : <>
      {editor && <FunnelEditor value={editor.config} onChange={config => setEditor({ ...editor, config })} accounts={data?.accounts || []} busy={busy}
        onSave={() => void save()} onClose={() => setEditor(null)} onArchive={editor.id ? () => void archive() : undefined} />}
      {destinationEditor && <form className={`${styles.card} ${styles.editor}`} onSubmit={e => { e.preventDefault(); void verifyDestination(); }}>
        <h2>URL terverifikasi dari Ads Manager</h2><p>{destinationEditor.name}</p>
        <p className={styles.muted}>Gunakan Website URL yang sudah diperiksa di Ads Manager. URL ini mengisi data yang tidak terbaca oleh API dan berlaku selama creative ad yang sama digunakan.</p>
        <label>Website URL<input required type="url" maxLength={4096} value={destinationEditor.url} onChange={e => setDestinationEditor({ ...destinationEditor, url: e.target.value })} /></label>
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>Simpan URL terverifikasi</button><button type="button" className={styles.button} disabled={busy} onClick={() => setDestinationEditor(null)}>Batal</button></div>
      </form>}
      <div className={styles.filterArea}><div className={styles.monitoringFilters}>
        <label>Brand<select aria-label="Brand" title="Brand mengikuti pemetaan akun di Admin Meta" value={brandId} onChange={e => { setBrandId(e.target.value); setGroupKey(''); }}>
          <option value="">Semua brand ({data?.brandOptions.total || 0})</option>
          {data?.brandOptions.choices.map(b => <option key={b.value} value={b.value}>{b.label} ({b.count})</option>)}
        </select></label>
        <label>Monitoring<select value={selectedId || data?.selectedId || ''} onChange={e => { setSelectedId(e.target.value); setGroupKey(''); }}>
          {!data?.funnels.length && <option value="">Semua landing page</option>}
          {data?.funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select></label>
        <label>Breakdown<select aria-label="Breakdown" value={groupBy} onChange={e=>{setGroupBy(e.target.value as typeof groupBy);setGroupKey('');setSearch('');}}><option value="landing_page">Per URL landing page</option><option value="ad">Per ad</option></select></label>
        {canManage && data?.selectedId && <button className={styles.button} onClick={() => { const f = data.funnels.find(f => f.id === data.selectedId)!; setEditor({ id: f.id, version: f.version, config: f }); }}>Konfigurasi</button>}
      </div>
      {data && <MetaAdDimensionFilters value={dimensionFilters} options={data.dimensionOptions} ready={data.dimensionsReady} onChange={filters=>{setDimensionFilters(filters);setGroupKey('');}} hasOtherFilters={!!brandId} onReset={()=>{setDimensionFilters({});setBrandId('');setGroupKey('');}} />}
      </div>
      {data && <>
        <div className={styles.contextBar}>
          {group && <button className={styles.selectedGroup} title={group.name} aria-label={`Hapus pilihan ${groupBy === 'ad' ? 'ad' : 'landing page'}: ${group.name}`} onClick={() => setGroupKey('')}><span>{group.name}</span><X size={12} aria-hidden="true" /></button>}
          <span role="status" className={styles.contextCount} title="Ad dengan data performa pada periode dan filter yang dipilih">{data.matchingAds} ad</span>
          {monitoredAccounts.length === 1 ? <span className={styles.contextAccount}>{monitoredAccounts[0].account_name}</span> : <details className={styles.contextDetails}>
            <summary>{monitoredAccounts.length} akun</summary><div className={styles.contextPanel}>{monitoredAccounts.length ? monitoredAccounts.map(a => <p key={a.account_id}>{a.account_name}</p>) : <p>Belum ada akun aktif.</p>}</div>
          </details>}
          {(!groupKey || groupKey === 'landing:unknown' || groupKey.startsWith('landing:multi:')) && (data.destinations.missing_ads > 0 || data.destinations.multi_ads > 0) && <details className={`${styles.contextDetails} ${styles.contextQuality}`}>
            <summary>{[data.destinations.missing_ads > 0 && `URL belum terbaca (${data.destinations.missing_ads})`, data.destinations.multi_ads > 0 && `Multi-URL (${data.destinations.multi_ads})`].filter(Boolean).join(' · ')}</summary>
            <div className={styles.contextPanel}>
              <p>{data.destinations.missing_ads} ad dengan URL belum terbaca · {data.destinations.multi_ads} ad dengan beberapa URL. Metrik tetap dihitung sekali; notifikasi per URL menunggu tujuan tunggal.</p>
              {data.destinations.missing.map(ad => <div className={styles.namingIssue} key={`${ad.account_name}:${ad.ad_id}`}><b>{ad.ad_name}</b><small>{ad.account_name} · ad {ad.ad_id}</small>
                {canManage && data.verifiedDestinationsReady && <button className={styles.button} onClick={() => setDestinationEditor({ accountId: ad.account_id, adId: ad.ad_id, name: ad.ad_name, url: '' })}>Tetapkan URL untuk ad {ad.ad_id}</button>}
              </div>)}
              {canManage && !data.verifiedDestinationsReady && <p>Pasang migration 200_meta_verified_ad_destinations.sql untuk menyimpan URL yang telah diverifikasi.</p>}
              {canManage && <p className={styles.muted}>Sync memperbarui data terbaru sejak sync terakhir, termasuk spend, iklan, dan creative.</p>}
            </div>
          </details>}
          {(!data.selectedId || !config.alerts_enabled) && <span className={styles.notificationState} title="Atur notifikasi di konfigurasi monitoring"><BellOff size={13} aria-hidden="true" />Notifikasi nonaktif</span>}
          {!data.reportingError && data.coverageGaps.length > 0 && <details className={`${styles.contextDetails} ${styles.coverageState}`}>
            <summary><AlertCircle size={13} aria-hidden="true" />{data.coverageGaps.some(g => g.currentMissing > 0) ? 'Data parsial' : 'Pembanding parsial'}<ChevronDown size={12} aria-hidden="true" /></summary>
            <div className={styles.contextPanel}>
              <dl>{data.coverageGaps.map(g => <div className={styles.coverageAccount} key={g.account_id}>
                <dt>{data.accounts.find(a => a.account_id === g.account_id)?.account_name || g.account_id}</dt>
                <dd>{[g.currentMissing > 0 && `Periode: ${g.currentMissing} hari`, g.baselineMissing > 0 && `Pembanding: ${g.baselineMissing} hari`].filter(Boolean).join(' · ')}<small>{g.firstMissing} – {g.lastMissing}</small></dd>
              </div>)}</dl>
              {hasPendingJobs ? <p className={styles.muted}>Sync berjalan…</p> : canManage && <button className={styles.button} disabled={busy} onClick={() => void sync()}>Sync</button>}
            </div>
          </details>}
          {data.objectiveUnknownAds > 0 && <span className={styles.contextQuality}>Objective belum terbaca ({data.objectiveUnknownAds})</span>}
          <details className={`${styles.contextDetails} ${styles.contextInfo}`}>
            <summary aria-label="Informasi data" title="Informasi data"><Info size={15} aria-hidden="true" /></summary>
            <div className={styles.contextPanel}><dl><dt>Objective Meta</dt><dd>Objective campaign</dd><dt>Intention</dt><dd>Tag pada nama ad</dd>{config.description && <><dt>Monitoring</dt><dd>{config.description}</dd></>}</dl>
              {data.objectiveUnknownAds > 0 && <p className={styles.muted}>Gunakan Sync pemetaan untuk melengkapi objective yang belum terbaca.</p>}
            </div>
          </details>
        </div>
      </>}
      {loading && <p role="status" className={styles.muted}>Memuat performa…</p>}
      {data && <>
        {data.reportingError && <div role="alert" className={styles.error}>{data.reportingError}</div>}
        <div className={styles.tabs}>{([
          ['overview', 'Performa'], ['daily', 'Comparison harian'], ['trends', 'Tren'],
        ] as const).map(([id, label]) => <button key={id} className={tab === id ? styles.activeTab : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
        {overviewReady && totals && prev && <>
          <div className={styles.period}>Periode {data.reportRange.from} – {data.reportRange.to} <span>vs {data.prevFrom} – {data.prevTo} · {data.currency}</span></div>
          <div className={styles.cards}>{config.metrics.map(m => <div className={styles.card} key={m.id}><div className={styles.muted}>{m.label}</div><strong>{format(metricValue(totals, m), m.format, data.currency)}</strong><Change value={relativeChange(metricValue(totals, m), metricValue(prev, m))} direction={m.direction} neutral={!m.monitor} /></div>)}</div>
        </>}
        {tab === 'overview' && overviewReady && <>
          <div className={styles.sectionHeader}><h2>{groupBy === 'ad' ? 'Breakdown per ad' : 'Breakdown per landing page'}</h2><input aria-label={groupBy === 'ad' ? 'Cari ad' : 'Cari landing page'} placeholder={groupBy === 'ad' ? 'Cari nama atau ID ad…' : 'Cari URL landing page…'} value={search} onChange={e => setSearch(e.target.value)} /></div>
          {!brandId && data.brandSections.length > 0 ? data.brandSections.map(section => <section key={section.id} className={styles.brandSection} aria-label={`Brand ${section.name}`}>
            <div className={styles.brandHeading}><h3>{section.name}</h3><span className={styles.muted}>{section.matchingAds} ad · {section.currency}</span></div>
            {section.reportingError ? <p role="alert" className={styles.error}>{section.reportingError}</p>
              : <>{visibleGroups(section.groups).length === 0 && <p className={styles.muted}>{search ? 'Tidak ada baris yang sesuai pencarian.' : 'Belum ada data pada periode ini.'}</p>}
                {breakdown(section.groups, section.summary, section.previous, section.currency, section.id)}</>}
          </section>) : visibleGroups(data.groups).length === 0 ? <div className={styles.card}>{data.groups.length ? `Tidak ada ${groupBy === 'ad' ? 'ad' : 'URL'} yang sesuai pencarian.` : 'Belum ada data yang sesuai. Periksa akun yang dipantau atau jalankan Sync.'}</div>
            : breakdown(data.groups, totals!, prev!, data.currency)}

          <details className={styles.card}><summary>Definisi metrik & pengelompokan</summary><p>CTR outbound = outbound clicks ÷ impressions. LPV ratio = LPV ÷ outbound clicks. ATC ratio = ATC ÷ LPV. IC ratio = IC ÷ ATC. Purchase ratio = purchase ÷ IC. CPM = spent ÷ impressions × 1.000. CPIC = spent ÷ IC. CPP = spent ÷ purchase. Semua rasio memakai total event, bukan rata-rata rasio ad.</p><p className={styles.muted}>URL diambil dari destination creative yang terbaca saat sync. Parameter UTM/click ID dan fragment diabaikan; query lain tetap dibedakan. Riwayat tanpa URL memakai metadata creative terkini. Data menggunakan atribusi Meta per adset.</p></details>
        </>}
        {(tab === 'daily' || tab === 'trends') && !data.reportingError && <>
          <div className={styles.sectionHeader}><h2>{tab === 'daily' ? 'Hari dibanding hari sebelumnya' : 'Histori 90 hari'}</h2><div className={styles.actions}>
            {tab === 'trends' && <select aria-label="Periode tren" value={period} onChange={e => setPeriod(e.target.value as typeof period)}><option value="weekly">Mingguan</option><option value="monthly">Bulanan</option></select>}
            <select aria-label="Metrik grafik" value={metric.id} onChange={e => setMetricId(e.target.value)}>{config.metrics.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          </div></div>
          {historyLoading && <p role="status" className={styles.muted}>Memuat {tab === 'daily' ? 'comparison harian' : 'tren'}…</p>}
          {(historyError || historyResult?.reportingError) && <p role="alert" className={styles.error}>{historyError || historyResult?.reportingError}</p>}
          {!historyLoading && historyResult && !historyResult.reportingError && <>
          <div className={styles.chart}><ResponsiveContainer width="100%" height={280}><LineChart data={chartData}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fill: 'var(--dim)', fontSize: 11 }} /><YAxis tick={{ fill: 'var(--dim)', fontSize: 11 }} /><Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} formatter={(value: number) => [format(value / (metric.format === 'percent' ? 100 : 1), metric.format, data.currency), metric.label]} /><Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false} connectNulls={false} /></LineChart></ResponsiveContainer></div>
          <div className={styles.tableWrap}><table><thead><tr><th>Periode mulai</th>{config.metrics.map(m => <th key={m.id}>{m.label} / Δ</th>)}</tr></thead><tbody>{history.map((p, i) => <tr key={p.date}><td>{p.date}{p.partial && <small>Periode parsial</small>}{!p.complete && <small>Data belum lengkap</small>}</td>{config.metrics.map(m => <td key={m.id}>{format(p.metrics[m.id], m.format, data.currency)}<small><Change value={relativeChange(p.metrics[m.id], 'previousMetrics' in p ? (p.previousMetrics as Record<string, number | null>)[m.id] : history[i - 1]?.metrics[m.id] ?? null)} direction={m.direction} neutral={!m.monitor} /></small></td>)}</tr>)}</tbody></table></div>
          <p className={styles.muted}>{tab === 'daily' ? 'Δ dibanding hari sebelumnya, termasuk baseline sebelum awal rentang.' : 'Minggu dimulai Senin. Bulan/minggu pertama dan terakhir dapat mencakup sebagian periode dalam histori 90 hari. Δ periode parsial perlu dibaca dengan hati-hati.'} {(!historyResult.complete && tab === 'trends') && 'Histori belum lengkap; titik tanpa data bukan bukti performa nol.'} Tanggal mengikuti timezone ad account.</p>
          </>}
        </>}
      </>}
    </>}
  </div>;
}

const syncLabels: Record<string, string> = { queued: 'Menunggu', running: 'Berjalan', success: 'Berhasil', partial: 'Sebagian', failed: 'Gagal', canceled: 'Dibatalkan' };
function SyncProgress({ progress, preparing, checking, status, accounts, error, onRefresh }: {
  progress: ReturnType<typeof metaSyncProgress> | null; preparing: boolean; checking: boolean;
  status: SyncStatusData | null; accounts: Data['accounts']; error: string; onRefresh: () => void;
}) {
  const latest = status?.jobs[0];
  if (!preparing && !checking && !progress && !latest && !error && !status?.pending) return null;
  const active = preparing || checking || !!status?.pending || !!progress?.active;
  const issues = progress ? progress.issues > 0 || progress.missing > 0 : latest && !['success', 'queued', 'running'].includes(latest.status);
  const label = preparing ? 'Menyiapkan sync…' : checking ? 'Memeriksa sync…'
    : progress && !progress.active && status?.pending ? 'Melengkapi data iklan…'
    : progress ? (progress.canceled === progress.total ? 'Sync dibatalkan' : progress.failed === progress.total ? 'Sync gagal'
      : { queued: 'Menunggu giliran', running: 'Sync berjalan', complete: 'Sync selesai', issues: 'Sync selesai dengan kendala', unavailable: 'Status sync tidak tersedia' }[progress.state])
      : status?.pending ? (status.running ? 'Sync berjalan' : 'Menunggu giliran') : latest ? `Sync terakhir: ${syncLabels[latest.status]?.toLowerCase() || latest.status}` : 'Status sync tidak tersedia';
  const Icon = preparing || checking || (active && (progress ? progress.state === 'running' : status?.running)) ? LoaderCircle : active ? Clock3 : issues ? AlertCircle : CheckCircle2;
  const jobs: MetaSyncJob[] = status?.trackedJobs || status?.jobs || [];
  const completedAt = progress?.completedAt || latest?.completed_at;
  const stamp = !active && completedAt ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(new Date(completedAt)) : '';
  return <div className={styles.syncArea}>
    <div className={`${styles.syncStatus} ${issues ? styles.syncWarning : !active ? styles.syncSuccess : ''}`} role="status" aria-live="polite">
      <Icon size={15} aria-hidden="true" className={Icon === LoaderCircle ? styles.syncSpinner : undefined} />
      <span>{label}</span>
      {progress && !preparing && !checking && <>
        <span className={styles.muted}>{progress.completed}/{progress.total} batch</span>
        {!progress.missing && <progress aria-label="Progres sync" max={progress.total} value={progress.completed} />}
        {!!progress.failed && <span>{progress.failed} gagal</span>}
        {!!progress.partial && <span>{progress.partial} sebagian</span>}
        {!!progress.canceled && <span>{progress.canceled} dibatalkan</span>}
      </>}
      {!progress && !!status?.pending && <span className={styles.muted}>{status.pending} batch tersisa</span>}
      {stamp && <span className={styles.muted}>{stamp} WIB</span>}
      {error && <button type="button" className={styles.syncRetry} onClick={onRefresh} title={error}>Status belum diperbarui · Coba lagi</button>}
    </div>
    {!!jobs.length && <details className={styles.syncDetails}><summary>Detail</summary>
      <div className={styles.syncJobList}>{jobs.map(job => <div key={job.id} className={styles.syncJob}>
        <span>{job.payload.date_start ? `${job.payload.date_start} – ${job.payload.date_end}` : 'Data terbaru'}</span><span>{syncLabels[job.status] || job.status}</span>
        <span className={styles.syncAccount}>{accounts.find(account => account.account_id === job.payload.account_id)?.account_name || job.payload.account_id || 'Seluruh akun'}</span>
        {job.error_message && <small>{job.error_message}</small>}
      </div>)}</div>
    </details>}
  </div>;
}

function GroupDetails({ group: g, currency, input, cacheKey }: { group: Data['groups'][number]; currency: string; input: MetaReportInput; cacheKey: string }) {
  const [open, setOpen] = useState(false);
  const [creatives, setCreatives] = useState<{ key: string; rows: AdCreative[] } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const key = `${cacheKey}:${g.key}`;
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true); setError('');
    void getMetaFunnelCreatives({ ...input, groupKey: g.key }).then(result => {
      if (!alive) return;
      if (!result.schemaReady) throw new Error('Migration laporan Meta belum tersedia.');
      setCreatives({ key, rows: result.creatives });
    }).catch(e => { if (alive) setError(message(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, key, input, g.key]);
  const rows = creatives?.key === key ? creatives.rows : [];
  return <details><summary>Detail volume & creative</summary><p className={styles.muted}>Impressions {format(g.current.impressions, 'number', currency)} · Outbound clicks {format(g.current.outbound_clicks, 'number', currency)} · ATC {format(g.current.atc, 'number', currency)} · IC {format(g.current.checkout, 'number', currency)} · Purchase {format(g.current.purchases, 'number', currency)}</p>
    {g.landing_page_urls.map(url => <p key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></p>)}
    {g.verified_ad_ids.length > 0 && <><p className={styles.muted}>{g.verified_ad_ids.length} ad menggunakan URL terverifikasi dari Ads Manager sebagai fallback.</p>
      {g.verified_ad_ids.map(id => <p key={id}>{rows.find(c => c.ad_id === id)?.name || `Ad ${id}`}<small className={styles.muted}> · Ad {id}</small></p>)}
    </>}
    <details onToggle={e => setOpen(e.currentTarget.open)}><summary>{g.ad_names.length} nama ad & creative</summary>
      {g.ad_names.map(name => <p className={styles.muted} key={name}>{name}</p>)}
      {loading && <p role="status" className={styles.muted}>Memuat creative…</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {rows.map(c => <MetaAdCreative key={`${c.account_id}:${c.ad_id}`} creative={c} />)}
    </details>
  </details>;
}

function FunnelEditor({ value: c, onChange, accounts, busy, onSave, onClose, onArchive }: {
  value: FunnelConfig; onChange: (c: FunnelConfig) => void; accounts: { account_id: string; account_name: string }[];
  busy: boolean; onSave: () => void; onClose: () => void; onArchive?: () => void;
}) {
  const set = <K extends keyof FunnelConfig>(k: K, v: FunnelConfig[K]) => onChange({ ...c, [k]: v });
  const metricSet = (i: number, changes: Partial<FunnelMetric>) => set('metrics', c.metrics.map((m, n) => n === i ? { ...m, ...changes } : m));
  const [stage, setStage] = useState<Measure>('purchases');
  return <form className={`${styles.card} ${styles.editor}`} onSubmit={e => { e.preventDefault(); onSave(); }}>
    <div className={styles.sectionHeader}><h2>Konfigurasi funnel</h2><button type="button" className={styles.button} disabled={busy} onClick={onClose}>Tutup</button></div>
    <p className={styles.muted}>Performa dikelompokkan berdasarkan URL landing page. Pilih akun dan aturan notifikasi yang ingin dipantau.</p>
    <div className={styles.formGrid}>
      <label>Nama funnel<input required maxLength={120} value={c.name} onChange={e => set('name', e.target.value)} /></label>
      <label>Deskripsi<textarea maxLength={2000} value={c.description} onChange={e => set('description', e.target.value)} /></label>
    </div>
    <label>Akun yang dipantau (tanpa pilihan = semua akun aktif)</label><div className={styles.accountList}>{accounts.map(a => <label key={a.account_id}><input type="checkbox" checked={c.account_ids.includes(a.account_id)} onChange={e => set('account_ids', e.target.checked ? [...c.account_ids, a.account_id] : c.account_ids.filter(id => id !== a.account_id))} />{a.account_name}</label>)}</div>
    <details><summary>Pengaturan metrik lanjutan</summary><div className={styles.advanced}>
    <div className={styles.formGrid}><label>Filter ad name opsional (kosong = semua)<input maxLength={200} value={c.name_filter} onChange={e => set('name_filter', e.target.value)} /></label>
      <label>Pencocokan nama<select value={c.match} onChange={e => set('match', e.target.value as FunnelConfig['match'])}><option value="contains">Mengandung teks</option><option value="exact">Nama sama persis</option></select></label></div>
    <h3>Urutan tahapan</h3><div className={styles.actions}>{c.stages.map((s, i) => <span className={styles.chip} key={s}>{MEASURES[s]}<button aria-label={`Pindahkan ${MEASURES[s]} ke kiri`} type="button" disabled={i === 0} onClick={() => { const stages = [...c.stages]; [stages[i - 1], stages[i]] = [stages[i], stages[i - 1]]; set('stages', stages); }}>←</button><button type="button" aria-label={`Hapus tahap ${MEASURES[s]}`} onClick={() => set('stages', c.stages.filter(v => v !== s))}>×</button></span>)}<select aria-label="Tahap baru" value={stage} onChange={e => setStage(e.target.value as Measure)}>{measureOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select><button type="button" className={styles.button} disabled={c.stages.includes(stage) || c.stages.length >= 12} onClick={() => set('stages', [...c.stages, stage])}>Tambah tahap</button></div>
    <h3>Metrik dan rasio</h3><p className={styles.muted}>Buat rasio dengan pembilang ÷ penyebut, atau pilih tanpa penyebut untuk memantau jumlah. Tentukan arah performa yang baik dan volume minimum.</p>
    {c.metrics.map((m, i) => <div className={styles.metricEditor} key={m.id}>
      <label>Label<input required maxLength={80} value={m.label} onChange={e => metricSet(i, { label: e.target.value })} /></label>
      <label>Pembilang<select value={m.numerator} onChange={e => metricSet(i, { numerator: e.target.value as Measure })}>{measureOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      <label>Penyebut<select value={m.denominator || ''} onChange={e => metricSet(i, { denominator: e.target.value as Measure || null })}><option value="">Tanpa penyebut</option>{measureOptions.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      <label>Format<select value={m.format} onChange={e => metricSet(i, { format: e.target.value as FunnelMetric['format'] })}><option value="percent">Persentase</option><option value="number">Angka</option><option value="money">Mata uang</option><option value="multiple">Kelipatan</option></select></label>
      <label>Arah yang baik<select value={m.direction} onChange={e => metricSet(i, { direction: e.target.value as FunnelMetric['direction'] })}><option value="higher">Lebih tinggi</option><option value="lower">Lebih rendah</option></select></label>
      <label>Min. penyebut<input type="number" min={0} max={1e12} value={m.min_denominator} onChange={e => metricSet(i, { min_denominator: Number(e.target.value) })} /></label>
      <label className={styles.check}><input type="checkbox" checked={m.monitor} onChange={e => metricSet(i, { monitor: e.target.checked })} />Monitor</label>
      <button type="button" className={styles.button} aria-label={`Hapus metrik ${m.label}`} onClick={() => set('metrics', c.metrics.filter((_, n) => n !== i))}>Hapus</button>
    </div>)}
    <button type="button" className={styles.button} disabled={c.metrics.length >= 12} onClick={() => set('metrics', [...c.metrics, { id: `metric_${Date.now()}`, label: 'Metrik baru', numerator: 'purchases', denominator: null, format: 'number', direction: 'higher', monitor: true, min_denominator: 0 }])}>+ Metrik</button>
    </div></details>
    <h3>Notifikasi penurunan</h3><label className={styles.check}><input type="checkbox" checked={c.alerts_enabled} onChange={e => set('alerts_enabled', e.target.checked)} />Aktifkan notifikasi dalam aplikasi</label>
    <div className={styles.formGrid}>{([
      ['window_days', 'Periode dibanding periode sebelumnya (hari)', 1, 30], ['drop_percent', 'Ambang perubahan buruk (%)', 1, 100],
      ['min_impressions', 'Min. impressions per kelompok / periode', 0, 1e9], ['min_spend', 'Min. spend per kelompok / periode', 0, 1e12],
      ['lag_days', 'Jeda atribusi dari hari ini (hari)', 1, 7],
    ] as const).map(([key, label, min, max]) => <label key={key}>{label}<input required type="number" min={min} max={max} value={c[key]} onChange={e => set(key, Number(e.target.value))} /></label>)}</div>
    <div className={styles.actions}><button className={styles.primary} disabled={busy} type="submit">{busy ? 'Memproses…' : 'Simpan funnel'}</button>{onArchive && <button type="button" className={styles.button} disabled={busy} onClick={onArchive}>Arsipkan funnel</button>}</div>
  </form>;
}
