'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, ArrowUpDown, Info } from 'lucide-react';
import { useDateRange } from '@/lib/DateRangeContext';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { usePermissions } from '@/lib/PermissionsContext';
import { archiveMetaFunnel, getMetaFunnelData, queueMetaFunnelSync, saveMetaFunnel, verifyMetaAdDestination } from '@/lib/meta-funnel-actions';
import { defaultFunnel, MEASURES, metricValue, relativeChange, shiftDay, type FunnelConfig, type FunnelMetric, type Measure } from '@/lib/meta-funnel-domain';
import { getTodayWIB } from '@/lib/sync-schedule';
import styles from './page.module.css';
import MetaAdCreative from '@/components/MetaAdCreative';
import MetaAdDimensionFilters from '@/components/MetaAdDimensionFilters';
import type { AdDimensionFilters } from '@/lib/meta-ad-dimensions';

type Data = Extract<Awaited<ReturnType<typeof getMetaFunnelData>>, { schemaReady: true }>;
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
  const [selectedId, setSelectedId] = useState('');
  const [groupKey, setGroupKey] = useState('');
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
  const [editor, setEditor] = useState<{ id?: string; version?: number; config: FunnelConfig } | null>(null);
  const [destinationEditor, setDestinationEditor] = useState<{ accountId: string; adId: string; name: string; url: string } | null>(null);
  const request = useRef(0);
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get('view');
    if (view === 'alerts') router.replace('/dashboard/meta-funnels/notifications');
    if (view === 'mapping') router.replace('/dashboard/meta-funnels/mapping');
  }, [router]);
  const load = useCallback(async () => {
    if (!dateRange.from || !dateRange.to) return;
    const currentRequest = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await getMetaFunnelData({ ...dateRange, funnelId: selectedId || undefined, groupKey: groupKey || undefined, filters:dimensionFilters, groupBy });
      if (currentRequest !== request.current) return;
      setSchemaReady(result.schemaReady);
      if (result.schemaReady) { setData(result); if (groupKey && !result.groups.some(g => g.key === groupKey)) setGroupKey(''); }
    } catch (e) { if (currentRequest === request.current) setError(message(e)); }
    finally { if (currentRequest === request.current) setLoading(false); }
  }, [dateRange.from, dateRange.to, selectedId, groupKey, activeWorkspace.id, dimensionFilters.cep, dimensionFilters.objective, dimensionFilters.intention, groupBy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const guard = request; return () => { guard.current++; }; }, []);
  const hasPendingJobs = data?.jobs.some(j => ['queued', 'running'].includes(j.status));
  useEffect(() => {
    if (!hasPendingJobs) return;
    const timer = setInterval(() => { void load(); }, 15000);
    return () => clearInterval(timer);
  }, [hasPendingJobs, load]);
  async function sync() {
    setBusy(true); setError('');
    try {
      const to = shiftDay(getTodayWIB(), -1);
      const result = await queueMetaFunnelSync(shiftDay(to, -89), to, data?.selectedId || undefined);
      setNotice(`${result.jobs.length} batch sync 90 hari masuk antrean. Data dan notifikasi diperbarui oleh worker.`);
      await load();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
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
  const monitoredAccounts = data?.accounts.filter(a => !config.account_ids.length || config.account_ids.includes(a.account_id)) || [];
  const metric = config.metrics.find(m => m.id === metricId) || config.metrics[0];
  const group = data?.groups.find(g => g.key === groupKey);
  const sort = tableSort.metricId === null || config.metrics.some(m => m.id === tableSort.metricId) ? tableSort : { ...tableSort, metricId: config.metrics[0].id };
  const sortValue = (g: Data['groups'][number]) => {
    const value = g.metrics.find(m => m.id === sort.metricId)?.current;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const visibleGroups = (data?.groups.filter(g => (!groupKey || g.key === groupKey) && [g.name, ...g.ad_ids, ...g.landing_page_urls].some(n => n.toLowerCase().includes(search.toLowerCase()))) || []).sort((a, b) => {
    const byName = a.name.localeCompare(b.name, 'id', { numeric: true, sensitivity: 'base' }) || a.key.localeCompare(b.key);
    const direction = sort.direction === 'asc' ? 1 : -1;
    if (sort.metricId === null) return direction * byName;
    const left = sortValue(a), right = sortValue(b);
    // Undefined ratios remain at the bottom in either direction.
    if (left === null) return right === null ? byName : 1;
    if (right === null) return -1;
    return direction * (left - right) || byName;
  });
  const totals = group?.current || data?.summary;
  const prev = group?.previous || data?.previous;
  const history = data ? tab === 'daily' ? data.daily : data[period] : [];
  const chartData = history.map(p => ({ date: p.date, value: p.metrics[metric.id] === null ? null : p.metrics[metric.id]! * (metric.format === 'percent' ? 100 : 1) }));
  return <div className={styles.page}>
    <div className={styles.header}>
      <div><div className={styles.eyebrow}>MARKETING / AD PERFORMANCE</div><h1>Meta Ad Funnels</h1><p>Filter ads berdasarkan CEP dan objective Meta, lalu bandingkan performanya.</p></div>
      <div className={styles.actions}>
        <Link className={styles.button} href="/dashboard/meta-funnels/mapping">Pemetaan Ads</Link>
        <button className={styles.button} onClick={() => void load()} disabled={loading}>Muat ulang</button>
        {canManage && <><button className={styles.button} disabled={busy || !schemaReady} onClick={() => void sync()}>Sync 90 hari</button>
          <button className={styles.primary} disabled={!schemaReady} onClick={() => setEditor({ config: defaultFunnel() })}>+ Funnel baru</button></>}
      </div>
    </div>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {notice && <div role="status" className={styles.info}>{notice}</div>}
    {!schemaReady ? <div className={styles.card}>Fitur membutuhkan migration 198_meta_ad_funnels.sql dan 199_meta_ad_landing_pages.sql. Setelah migrasi dipasang, muat ulang halaman.</div> : <>
      {editor && <FunnelEditor value={editor.config} onChange={config => setEditor({ ...editor, config })} accounts={data?.accounts || []} busy={busy}
        onSave={() => void save()} onClose={() => setEditor(null)} onArchive={editor.id ? () => void archive() : undefined} />}
      {destinationEditor && <form className={`${styles.card} ${styles.editor}`} onSubmit={e => { e.preventDefault(); void verifyDestination(); }}>
        <h2>URL terverifikasi dari Ads Manager</h2><p>{destinationEditor.name}</p>
        <p className={styles.muted}>Gunakan Website URL yang sudah diperiksa di Ads Manager. URL ini mengisi data yang tidak terbaca oleh API dan berlaku selama creative ad yang sama digunakan.</p>
        <label>Website URL<input required type="url" maxLength={4096} value={destinationEditor.url} onChange={e => setDestinationEditor({ ...destinationEditor, url: e.target.value })} /></label>
        <div className={styles.actions}><button type="submit" className={styles.primary} disabled={busy}>Simpan URL terverifikasi</button><button type="button" className={styles.button} disabled={busy} onClick={() => setDestinationEditor(null)}>Batal</button></div>
      </form>}
      <div className={styles.filterArea}><div className={styles.monitoringFilters}>
        <label>Monitoring<select value={selectedId || data?.selectedId || ''} onChange={e => { setSelectedId(e.target.value); setGroupKey(''); }}>
          {!data?.funnels.length && <option value="">Semua landing page (preview)</option>}
          {data?.funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select></label>
        <label>Tampilkan<select value={groupBy} onChange={e=>{setGroupBy(e.target.value as typeof groupBy);setGroupKey('');setSearch('');}}><option value="landing_page">Per URL landing page</option><option value="ad">Per ad</option></select></label>
        <label>{groupBy === 'ad' ? 'Ad' : 'URL landing page'}<select aria-label={groupBy === 'ad' ? 'Ad' : 'URL landing page'} value={groupKey} onChange={e => setGroupKey(e.target.value)}><option value="">{groupBy === 'ad' ? 'Semua ad' : 'Semua landing page'}</option>{data?.groups.map(g => <option key={g.key} value={g.key}>{g.name}</option>)}</select></label>
        {canManage && data?.selectedId && <button className={styles.button} onClick={() => { const f = data.funnels.find(f => f.id === data.selectedId)!; setEditor({ id: f.id, version: f.version, config: f }); }}>Konfigurasi</button>}
      </div>
      {data && <MetaAdDimensionFilters value={dimensionFilters} options={data.dimensionOptions} ready={data.dimensionsReady} onChange={filters=>{setDimensionFilters(filters);setGroupKey('');}} />}
      </div>
      {data && <>
        <div className={styles.contextBar}>
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
              {canManage && <p className={styles.muted}>Sync 90 hari memperbarui URL creative dan histori.</p>}
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
      {!data?.funnels.length && !loading && <div className={styles.info}>Ini preview funnel default. Simpan funnel untuk mengaktifkan monitoring dan notifikasi otomatis.</div>}
      {loading && <p role="status" className={styles.muted}>Memuat performa…</p>}
      {data && <>
        {data.reportingError && <div role="alert" className={styles.error}>{data.reportingError}</div>}
        {(!data.currentComplete || !data.baselineComplete) && <div className={styles.info}>Data periode atau baseline belum lengkap. Perbandingan bersifat sementara; alarm menunggu seluruh akun dan tanggal tersinkron. {canManage && 'Gunakan Sync 90 hari untuk mengisi histori.'}</div>}
        <div className={styles.tabs}>{([
          ['overview', 'Performa'], ['daily', 'Comparison harian'], ['trends', 'Tren'],
        ] as const).map(([id, label]) => <button key={id} className={tab === id ? styles.activeTab : ''} onClick={() => setTab(id)}>{label}</button>)}</div>
        {!data.reportingError && totals && prev && <>
          <div className={styles.period}>Periode {dateRange.from} – {dateRange.to} <span>vs {data.prevFrom} – {data.prevTo} · {data.currency}</span></div>
          {(tab !== 'overview' || !groupKey) && <div className={styles.cards}>{config.metrics.filter(m => tab !== 'overview' || groupBy === 'ad' || Object.values(dimensionFilters).some(Boolean) || ['spent', 'outbound_ctr', 'lpv'].includes(m.id)).map(m => <div className={styles.card} key={m.id}><div className={styles.muted}>{m.label}</div><strong>{format(metricValue(totals, m), m.format, data.currency)}</strong><Change value={relativeChange(metricValue(totals, m), metricValue(prev, m))} direction={m.direction} neutral={!m.monitor} /></div>)}</div>}
        </>}
        {tab === 'overview' && !data.reportingError && <>
          <div className={styles.sectionHeader}><h2>{groupBy === 'ad' ? 'Breakdown per ad' : 'Breakdown per landing page'}</h2><input aria-label={groupBy === 'ad' ? 'Cari ad' : 'Cari landing page'} placeholder={groupBy === 'ad' ? 'Cari nama atau ID ad…' : 'Cari URL landing page…'} value={search} onChange={e => setSearch(e.target.value)} /></div>
          {!visibleGroups.length ? <div className={styles.card}>{data.groups.length ? `Tidak ada ${groupBy === 'ad' ? 'ad' : 'URL'} yang sesuai pencarian.` : 'Belum ada data yang sesuai. Periksa akun yang dipantau atau jalankan sync histori.'}</div> : <div className={styles.tableWrap}>
            <table className={styles.breakdownTable} aria-label={groupBy === 'ad' ? 'Breakdown per ad' : 'Breakdown per landing page'}>
              <thead><tr><SortableHeader label={groupBy === 'ad' ? 'Ad' : 'URL landing page'} metricId={null} sort={sort} onSort={setTableSort} />{config.metrics.map(m => <SortableHeader key={m.id} label={m.label} metricId={m.id} sort={sort} onSort={setTableSort} description={m.denominator ? `${MEASURES[m.numerator]} ÷ ${MEASURES[m.denominator]}` : MEASURES[m.numerator]} />)}</tr></thead>
              <tbody>{visibleGroups.map(g => <tr key={g.key}>
                <td><button className={styles.nameButton} onClick={() => setGroupKey(g.key)}>{g.name}</button><small>{groupBy === 'ad' ? `Ad ${g.ad_ids.join(', ')}` : `${g.ad_ids.length} ad`} · {g.accounts.join(', ')}</small>
                  {g.landing_page_urls.length > 1 && <small>Creative memiliki beberapa tujuan; Meta tidak membagi hasil per URL.</small>}
                  <GroupDetails group={g} currency={data.currency} />
                </td>
                {config.metrics.map(m => { const c = g.metrics.find(v => v.id === m.id)!; return <td key={m.id}>{format(c.current, m.format, data.currency)}<small><Change value={c.change} direction={m.direction} neutral={!m.monitor} /></small></td>; })}
              </tr>)}</tbody>
            </table>
          </div>}
          <details className={styles.card}><summary>Definisi metrik & pengelompokan</summary><p>CTR outbound = outbound clicks ÷ impressions. LPV ratio = LPV ÷ outbound clicks. ATC ratio = ATC ÷ LPV. IC ratio = IC ÷ LPV. Purchase ratio = purchase ÷ IC. Semua rasio memakai total event, bukan rata-rata rasio ad.</p><p className={styles.muted}>URL diambil dari destination creative yang terbaca saat sync. Parameter UTM/click ID dan fragment diabaikan; query lain tetap dibedakan. Riwayat tanpa URL memakai metadata creative terkini. Data menggunakan atribusi Meta per adset.</p></details>
        </>}
        {(tab === 'daily' || tab === 'trends') && !data.reportingError && <>
          <div className={styles.sectionHeader}><h2>{tab === 'daily' ? 'Hari dibanding hari sebelumnya' : 'Histori 90 hari'}</h2><div className={styles.actions}>
            {tab === 'trends' && <select aria-label="Periode tren" value={period} onChange={e => setPeriod(e.target.value as typeof period)}><option value="weekly">Mingguan</option><option value="monthly">Bulanan</option></select>}
            <select aria-label="Metrik grafik" value={metric.id} onChange={e => setMetricId(e.target.value)}>{config.metrics.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          </div></div>
          <div className={styles.chart}><ResponsiveContainer width="100%" height={280}><LineChart data={chartData}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fill: 'var(--dim)', fontSize: 11 }} /><YAxis tick={{ fill: 'var(--dim)', fontSize: 11 }} /><Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--text)' }} formatter={(value: number) => [format(value / (metric.format === 'percent' ? 100 : 1), metric.format, data.currency), metric.label]} /><Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false} connectNulls={false} /></LineChart></ResponsiveContainer></div>
          <div className={styles.tableWrap}><table><thead><tr><th>Periode mulai</th>{config.metrics.map(m => <th key={m.id}>{m.label} / Δ</th>)}</tr></thead><tbody>{history.map((p, i) => <tr key={p.date}><td>{p.date}{p.partial && <small>Periode parsial</small>}{!p.complete && <small>Data belum lengkap</small>}</td>{config.metrics.map(m => <td key={m.id}>{format(p.metrics[m.id], m.format, data.currency)}<small><Change value={relativeChange(p.metrics[m.id], 'previousMetrics' in p ? (p.previousMetrics as Record<string, number | null>)[m.id] : history[i - 1]?.metrics[m.id] ?? null)} direction={m.direction} neutral={!m.monitor} /></small></td>)}</tr>)}</tbody></table></div>
          <p className={styles.muted}>{tab === 'daily' ? 'Δ dibanding hari sebelumnya, termasuk baseline sebelum awal rentang.' : 'Minggu dimulai Senin. Bulan/minggu pertama dan terakhir dapat mencakup sebagian periode dalam histori 90 hari. Δ periode parsial perlu dibaca dengan hati-hati.'} {(!data.trendCoverageComplete && tab === 'trends') && 'Histori belum lengkap; titik tanpa data bukan bukti performa nol.'} Tanggal mengikuti timezone ad account.</p>
        </>}
        {!!data.jobs.length && <details className={styles.card}><summary>Status sync histori</summary>{data.jobs.map(j => <p key={j.id}>{j.payload.date_start} – {j.payload.date_end}: <b>{j.status}</b>{j.error_message && ` · ${j.error_message}`}</p>)}</details>}
      </>}
    </>}
  </div>;
}

function GroupDetails({ group: g, currency }: { group: Data['groups'][number]; currency: string }) {
  return <details><summary>Detail volume & creative</summary><p className={styles.muted}>Impressions {format(g.current.impressions, 'number', currency)} · Outbound clicks {format(g.current.outbound_clicks, 'number', currency)} · ATC {format(g.current.atc, 'number', currency)} · IC {format(g.current.checkout, 'number', currency)} · Purchase {format(g.current.purchases, 'number', currency)}</p>
    {g.landing_page_urls.map(url => <p key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></p>)}
    {g.verified_ad_ids.length > 0 && <><p className={styles.muted}>{g.verified_ad_ids.length} ad menggunakan URL terverifikasi dari Ads Manager sebagai fallback.</p>
      {g.verified_ad_ids.map(id => <p key={id}>{g.creatives.find(c => c.ad_id === id)?.name || `Ad ${id}`}<small className={styles.muted}> · Ad {id}</small></p>)}
    </>}
    <details><summary>{g.ad_names.length} nama ad & creative</summary>
      {g.ad_names.map(name => <p className={styles.muted} key={name}>{name}</p>)}
      {g.creatives.map(c => <MetaAdCreative key={`${c.account_id}:${c.ad_id}`} creative={c} />)}
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
