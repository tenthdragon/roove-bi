'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { getMetaAdWorklist, getMetaAdMappingStatus, queueMetaAdMappingSync, saveMetaAdMappingOverrides, saveMetaAdMappingOverridesBulk } from '@/lib/meta-ad-mapping-actions';
import { verifyMetaAdDestination } from '@/lib/meta-funnel-actions';
import { mappingDimensionLabel } from '@/lib/meta-ad-mapping';
import { WORKLIST_ISSUE_LABELS, WORKLIST_ISSUES, type WorklistIssue, type WorklistRow } from '@/lib/meta-ad-worklist';
import { objectiveLabel, type AdDimensionFilters } from '@/lib/meta-ad-dimensions';
import { metaAdChannelLabel, META_AD_CHANNELS, type MetaAdChannel } from '@/lib/meta-ad-channels';
import { formatCompactMoney, formatDate } from '@/lib/meta-format';
import { useDateRange } from '@/lib/DateRangeContext';
import { useMetaCachedLoad, useMetaReportSession } from '@/lib/useMetaCachedLoad';
import { createMetaOverviewCache } from '@/lib/meta-overview-cache';
import { defaultMetaRange } from '@/lib/meta-report-status';
import { getTodayWIB } from '@/lib/sync-schedule';
import MetaCepPicker from './MetaCepPicker';
import MetaAdDimensionFilters from './MetaAdDimensionFilters';
import MetaAdsNav from './MetaAdsNav';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

type Data = Extract<Awaited<ReturnType<typeof getMetaAdWorklist>>, { ready: true }>;
const mappingCache = createMetaOverviewCache<Data>();
const message = (e: unknown) => e instanceof Error ? e.message : 'Permintaan gagal.';
const stamp = (value: string | null) => value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const rowKey = (row: Pick<WorklistRow, 'account_id' | 'ad_id'>) => `${row.account_id}:${row.ad_id}`;
const channelHint: Record<MetaAdChannel, string> = { non_cpas: 'Website', cpas: 'CPAS', unknown: 'Perlu verifikasi' };

function parseIssue(value: string | null): WorklistIssue | null { return value && (WORKLIST_ISSUES as readonly string[]).includes(value) ? value as WorklistIssue : null; }
function parseChannel(value: string | null): MetaAdChannel | null { return value && (META_AD_CHANNELS as readonly string[]).includes(value) ? value as MetaAdChannel : null; }

/** Pemetaan Ads as a worklist: what the brand report cannot read yet, ranked by spend in the selected range. */
export default function MetaAdMappings({ workspaceId, canManage, canSync = false }: { workspaceId: string; canManage: boolean; canSync?: boolean }) {
  const router = useRouter(); const pathname = usePathname(); const searchParams = useSearchParams();
  const { dateRange } = useDateRange();
  const session = useMetaReportSession();
  const reportRange = dateRange.from && dateRange.to ? dateRange : defaultMetaRange(getTodayWIB());
  const issue = parseIssue(searchParams.get('issue')); const channel = parseChannel(searchParams.get('channel'));
  const account = searchParams.get('account') || ''; const urlQuery = searchParams.get('q') || '';
  const [search, setSearch] = useState(urlQuery);
  const [pagination, setPagination] = useState({ scope: '', page: 1 });
  const [filters, setFilters] = useState<AdDimensionFilters>({}); const [includeInactive, setIncludeInactive] = useState(false);
  const [ready, setReady] = useState(true);
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const [pollRefresh, setPollRefresh] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [detail, setDetail] = useState<WorklistRow | null>(null);
  const [bulkCeps, setBulkCeps] = useState<string[] | null | undefined>(undefined);
  const [bulkIntention, setBulkIntention] = useState('');
  const filterKey = JSON.stringify([workspaceId, reportRange.from, reportRange.to, urlQuery, account, filters, channel, issue, includeInactive]);
  const page = pagination.scope === filterKey ? pagination.page : 1;
  const setPage = (page: number) => setPagination({ scope: filterKey, page });

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    setPage(1); setSelected(new Set());
  }
  useEffect(() => { const timer = setTimeout(() => { if (search !== urlQuery) setParam('q', search.trim() || null); }, 300); return () => clearTimeout(timer); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSearch(urlQuery); }, [urlQuery]);
  const input = useMemo(() => ({ from: reportRange.from, to: reportRange.to, workspaceId, page, search: urlQuery, accountId: account || undefined, filters, channel: channel || undefined, issue: issue || undefined, includeInactive }),
    [reportRange.from, reportRange.to, workspaceId, page, urlQuery, account, filters, channel, issue, includeInactive]);
  const cacheKey = session.key ? JSON.stringify([session.key, input]) : null;
  useEffect(() => { setDetail(null); setSelected(new Set()); }, [cacheKey]);
  const fetchWorklist = useCallback(async () => {
    const result = await getMetaAdWorklist(input);
    if ('reportError' in result) throw new Error(result.reportError);
    setReady(result.ready);
    return result.ready && result.workspaceId === workspaceId ? result : null;
  }, [input, workspaceId]);
  const { data, setData, loading, error, setError, load } = useMetaCachedLoad(cacheKey, mappingCache, fetchWorklist);
  const pending = (data?.pendingJobs || 0) > 0;
  useEffect(() => {
    if (!cacheKey) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let again = false;
      try {
        const report = await load();
        if (!alive || !report) return;
        const status = await getMetaAdMappingStatus();
        if (!alive || status.workspaceId !== workspaceId) return;
        setData(current => current ? { ...current, state: status.state, jobs: status.jobs, pendingJobs: status.pendingJobs } : current);
        again = status.pendingJobs > 0;
        if (status.reportVersion !== report.reportVersion) await load(true);
      } catch (e) { if (alive) { setError(message(e)); again = true; } }
      finally { if (alive && again) timer = setTimeout(() => void poll(), 15000); }
    }
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [cacheKey, load, setData, setError, workspaceId, pollRefresh]);

  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true); setError(''); setNotice('');
    let failure = '';
    try { await work(); if (done) setNotice(done); } catch (e) { failure = message(e); }
    finally { await load(true); setPollRefresh(v => v + 1); if (failure) setError(failure); setBusy(false); }
  }
  const intentionOptions = (brandId: number | null, retained?: string | null) => (data?.intentions || []).filter(c => c.brand_id === brandId && (c.is_active !== false || c.key === retained)).map(c => ({ value: c.key, label: c.label }));
  const picker = (row: WorklistRow, dimension: 'cep' | 'intention') => {
    const own = data?.catalog.filter(c => c.brand_id === row.brandId) || [];
    if (!canManage) return <span>{row[dimension].label}</span>;
    const save = (patch: { ceps?: string[] | null; intention?: string | null }) => void run(async () => { const r = await saveMetaAdMappingOverrides({ accountId: row.account_id, adId: row.ad_id, revision: row.revision, ...patch });if (r.error) throw new Error(r.error); }, 'Pemetaan ad disimpan.');
    if (dimension === 'cep') return <MetaCepPicker key={`${row.ad_id}:${row.revision}`} id={row.ad_id} values={row.ceps.map(c => c.key!)} manual={row.cep.manual} catalog={own} disabled={busy} onSave={ceps => save({ ceps })} />;
    return <><select aria-label={`Intention ad ${row.ad_id}`} disabled={busy} value={row.intention.manual ? row.intention.key || '' : ''} onChange={e => save({ intention: e.target.value || null })}>
      <option value="">Aturan · {row.intention.manual ? 'gunakan aturan' : row.intention.label}</option>
      {intentionOptions(row.brandId, row.intention.key).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>{row.intention.manual && <small className={styles.manualMark}>Koreksi manual</small>}</>;
  };
  const destination = (row: WorklistRow) => {
    if (row.urls.length) return <>{row.urls.slice(0, 2).map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{url}</a>)}{row.urls.length > 2 && <small className={styles.muted}>+{row.urls.length - 2} URL lain</small>}{row.urlSource === 'verified' && <small className={styles.muted}>URL ditetapkan manual</small>}</>;
    if (row.urlSource === 'whatsapp') return <span>Klik ke WhatsApp</span>;
    if (row.urlSource === 'shopee') return <span>Shopee (CPAS)</span>;
    return <small className={styles.cellHint}>Belum terbaca dari Meta</small>;
  };
  const allSelected = !!data?.rows.length && data.rows.every(r => selected.has(rowKey(r)));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(data!.rows.map(rowKey)));
  const selectedRows = data ? data.rows.filter(r => selected.has(rowKey(r))) : [];
  const selectedBrand = selectedRows.length && selectedRows.every(r => r.brandId === selectedRows[0].brandId) ? selectedRows[0].brandId : null;
  useEffect(() => { setBulkCeps(undefined); setBulkIntention(''); }, [selectedBrand]);
  const bulkOptions = data?.catalog.filter(c => c.brand_id === selectedBrand && c.is_active !== false) || [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const sub = data ? `${data.scopeAds.toLocaleString('id-ID')} ad tayang · spend ${formatCompactMoney(data.scopeSpend, 'IDR')} · ${formatDate(data.range.from)} – ${formatDate(data.range.to)}${data.inactiveAds ? ` · ${data.inactiveAds.toLocaleString('id-ID')} ad tanpa impresi disembunyikan` : ''}` : undefined;
  const lastSync = data?.state.length ? data.state.map(s => s.last_inventory_at).sort().at(-1) || null : null;

  return <>
    <MetaAdsNav title="Pemetaan Ads" subtitle={data ? `${sub} · inventori ${lastSync ? stamp(lastSync) : 'belum disinkronkan'}` : 'Ad yang tayang pada periode terpilih, diurutkan dari spend terbesar.'}
      actions={<><Link className={styles.button} href="/dashboard/meta-funnels/categories">Kategori & aturan</Link>
        <button className={styles.button} disabled={loading} onClick={() => void load(true)}>Muat ulang</button>
        {canSync && <button className={styles.primary} disabled={busy || !ready} onClick={() => void run(queueMetaAdMappingSync, 'Sync pemetaan masuk antrean. Nama ad dibaca lebih dulu; URL dan creative menyusul dalam batch kecil.')}>Sync pemetaan</button>}
      </>} />
    {(session.error || error) && <div role="alert" className={styles.error}>{session.error || error}</div>}{notice && <div role="status" className={styles.info}>{notice}</div>}
    {!ready ? <div className={styles.card}>Pemetaan ad belum tersedia di workspace ini. Hubungi admin untuk mengaktifkannya.</div> : <>
      {data && !data.activityReady && <div className={styles.info}>Spend per ad dan cakupan ad tayang belum tersedia: pasang migration 217 agar daftar ini hanya memuat ad dengan impresi pada periode terpilih. Sementara itu seluruh inventori ditampilkan.</div>}
      {pending && <p role="status" className={styles.info}>{data?.pendingJobs} batch sync pemetaan dalam antrean atau sedang berjalan. Daftar diperbarui otomatis.</p>}
      {data && <div className={styles.tiles}>
        {data.tiles.map(tile => <button key={tile.issue} type="button" className={`${styles.tile} ${issue === tile.issue ? styles.tileActive : ''}`} aria-pressed={issue === tile.issue} onClick={() => setParam('issue', issue === tile.issue ? null : tile.issue)}>
          <span className={styles.muted}>{tile.label}</span>
          <span className={`${styles.tileValue} ${tile.ads ? styles.tileWarn : styles.tileClean}`}>{tile.ads.toLocaleString('id-ID')} ad</span>
          <span className={styles.muted}>{tile.ads ? `spend ${formatCompactMoney(tile.spend, 'IDR')}` : 'Semua terbaca'}</span>
        </button>)}
      </div>}
      {data?.clean && !issue && <div className={`${styles.card} ${styles.good}`}>Semua ad yang tayang pada periode ini sudah terbaca lengkap oleh laporan brand.</div>}
      {data && <>
        {loading && <p role="status" className={styles.muted}>Memperbarui daftar…</p>}
        <div className={styles.tableWrap}><table className={`${styles.mappingTable} ${styles.worklistTable}`}><thead><tr>
          <th className={styles.checkCell}>{canManage && <input type="checkbox" aria-label="Pilih semua ad di halaman ini" checked={allSelected} onChange={toggleAll} />}</th>
          <th>Ad & akun</th><th>Spend</th><th>CEP</th><th>Intention</th><th>Tujuan</th><th>Status</th>
        </tr></thead><tbody>{data.rows.map(row => {
          const key = rowKey(row);
          return <tr key={key}>
            <td className={styles.checkCell}>{canManage && <input type="checkbox" aria-label={`Pilih ad ${row.ad_id}`} checked={selected.has(key)} onChange={e => { const next = new Set(selected); if (e.target.checked) next.add(key); else next.delete(key); setSelected(next); }} />}</td>
            <td data-label="Ad & akun" className={styles.adCell}>
              <button type="button" className={styles.nameButton} onClick={() => setDetail(row)}><b>{row.ad_name}</b></button>
              <small>{row.account_name} · Ad {row.ad_id}{row.effective_status ? ` · ${row.effective_status}` : ''}{!row.active && ' · tanpa impresi'}</small>
              {row.campaign_name && <small>Campaign: {row.campaign_name}</small>}
            </td>
            <td data-label="Spend">{row.active ? <><b>{formatCompactMoney(row.spend, 'IDR')}</b><small>{row.impressions.toLocaleString('id-ID')} impresi{row.lastActive ? ` · terakhir ${formatDate(row.lastActive)}` : ''}</small></> : <span className={styles.muted}>—</span>}</td>
            <td data-label="CEP">{picker(row, 'cep')}</td>
            <td data-label="Intention">{picker(row, 'intention')}</td>
            <td data-label="Tujuan">{destination(row)}<small>{channelHint[row.ad_channel]}{row.ad_channel === 'unknown' && row.ad_channel_reason ? ` · ${row.ad_channel_reason}` : ''}</small></td>
            <td data-label="Status">{row.issues.length ? row.issues.map(i => <span key={i} className={styles.issueChip}>{WORKLIST_ISSUE_LABELS[i]}</span>) : <span className={`${styles.issueChip} ${styles.okChip}`}>Terbaca lengkap</span>}</td>
          </tr>;
        })}</tbody></table>
          {!data.rows.length && <p className={styles.card}>{issue ? 'Tidak ada ad dengan masalah ini pada filter yang dipilih.' : includeInactive ? 'Belum ada ad yang sesuai dengan filter ini.' : 'Tidak ada ad dengan impresi pada periode ini untuk filter yang dipilih. Ubah periode di pemilih tanggal, atau tampilkan ad tanpa impresi.'}</p>}
        </div>
        <div className={styles.toolbar}><span className={styles.muted}>{data.total.toLocaleString('id-ID')} ad · halaman {data.page} dari {pages}</span><div className={styles.actions}>
          <button className={styles.button} disabled={data.page <= 1 || loading} onClick={() => { setPage(data.page - 1); setSelected(new Set()); }}>Sebelumnya</button>
          <button className={styles.button} disabled={data.page >= pages || loading} onClick={() => { setPage(data.page + 1); setSelected(new Set()); }}>Berikutnya</button>
        </div></div>
        {canManage && selectedRows.length > 0 && <div className={styles.bulkBar} role="region" aria-label="Aksi massal">
          <b>{selectedRows.length} ad dipilih</b>
          <label><input type="checkbox" checked={bulkCeps !== undefined} onChange={e => setBulkCeps(e.target.checked ? [] : undefined)} />Ubah CEP</label>
          {bulkCeps !== undefined && <><select multiple aria-label="CEP untuk ad terpilih" disabled={!selectedBrand || busy || bulkCeps === null} value={bulkCeps || []} onChange={e => setBulkCeps(Array.from(e.target.selectedOptions, o => o.value))}>{bulkOptions.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
            {!selectedBrand && <small>Pilih ad dari satu brand untuk mengubah CEP.</small>}<label><input type="checkbox" checked={bulkCeps === null} onChange={e => setBulkCeps(e.target.checked ? null : [])} />Gunakan aturan CEP</label></>}
          <select aria-label="Intention untuk ad terpilih" value={bulkIntention} onChange={e => setBulkIntention(e.target.value)}><option value="">Intention: biarkan</option><option value="__auto__">Intention: gunakan aturan</option>{intentionOptions(selectedRows.length && selectedRows.every(r => r.brandId === selectedRows[0].brandId) ? selectedRows[0].brandId : null).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
          <button className={styles.primary} disabled={busy || (bulkCeps === undefined && !bulkIntention) || (bulkCeps !== undefined && !selectedBrand)} onClick={() => void run(async () => {
            const result = await saveMetaAdMappingOverridesBulk({ ads: selectedRows.map(r => ({ accountId: r.account_id, adId: r.ad_id })), ceps: bulkCeps, intention: bulkIntention ? (bulkIntention === '__auto__' ? null : bulkIntention) : undefined });
            setSelected(new Set());setBulkCeps(undefined);setBulkIntention('');
            if (result.failed.length) throw new Error(`${result.saved} ad tersimpan, ${result.failed.length} gagal: ${result.failed.slice(0, 3).map(f => `${f.adId} (${f.error})`).join('; ')}`);
          }, `${selectedRows.length} ad diperbarui.`)}>Terapkan</button>
          <button className={styles.button} disabled={busy} onClick={() => setSelected(new Set())}>Batal pilih</button>
        </div>}
      </>}
    </>}
    {detail && <DetailDrawer row={detail} canManage={canManage} busy={busy} onClose={() => setDetail(null)}
      onVerify={url => void run(async () => { await verifyMetaAdDestination({ accountId: detail.account_id, adId: detail.ad_id, url }); setDetail(null); }, `URL ad ${detail.ad_id} ditetapkan manual.`)} />}
  </>;
}

function DetailDrawer({ row, canManage, busy, onClose, onVerify }: { row: WorklistRow; canManage: boolean; busy: boolean; onClose: () => void; onVerify: (url: string) => void }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  return <>
    <div className={styles.drawerBackdrop} onClick={onClose} aria-hidden="true" />
    <aside className={styles.drawer} role="dialog" aria-label={`Detail ad ${row.ad_id}`}>
      <div className={styles.drawerHead}><div><h2>{row.ad_name}</h2><p className={styles.muted}>{row.account_name} · Ad {row.ad_id} · {row.effective_status || 'status belum terbaca'}</p></div><button type="button" className={styles.drawerClose} aria-label="Tutup" onClick={onClose}><X size={16} /></button></div>
      {row.issues.length ? <div>{row.issues.map(i => <span key={i} className={styles.issueChip}>{WORKLIST_ISSUE_LABELS[i]}</span>)}</div> : <span className={`${styles.issueChip} ${styles.okChip}`}>Terbaca lengkap</span>}
      <div className={styles.cards}>
        <div className={styles.card}><span className={styles.muted}>Spend periode</span><strong>{row.active ? formatCompactMoney(row.spend, 'IDR') : '—'}</strong></div>
        <div className={styles.card}><span className={styles.muted}>Impresi</span><strong>{row.active ? row.impressions.toLocaleString('id-ID') : '—'}</strong></div>
        <div className={styles.card}><span className={styles.muted}>Terakhir tayang</span><strong>{row.lastActive ? formatDate(row.lastActive) : '—'}</strong></div>
      </div>
      <div>
        <b>Pembacaan nama ad</b>
        {row.auto_mapping.tags.map(t => <p key={t.position}>{mappingDimensionLabel(t.dimension)}: <b>[{t.raw}]</b></p>)}
        {!row.auto_mapping.tags.length && <p className={styles.muted}>Nama ad tidak memakai bracket.</p>}
        <p className={styles.muted}>Teks bebas: {row.auto_mapping.free_text || '—'}</p>
        <p className={styles.muted}>Keyword: {row.auto_mapping.keywords.map(t => t.key).join(', ') || '—'}</p>
        {row.auto_mapping.issues.map(i => <p key={i} className={styles.warn}>{i}</p>)}
        <p className={styles.muted}>CEP: {row.cep.label}{row.cep.manual ? ' (koreksi manual)' : ''} · Intention: {row.intention.label}{row.intention.manual ? ' (koreksi manual)' : ''}</p>
      </div>
      <div>
        <b>Tujuan & jenis iklan</b>
        <p>{channelHint[row.ad_channel]} · {metaAdChannelLabel(row.ad_channel)}{row.ad_channel_reason ? ` · ${row.ad_channel_reason}` : ''}</p>
        {row.urls.length ? row.urls.map(u => <p key={u}><a href={u} target="_blank" rel="noopener noreferrer">{u}</a></p>) : <p className={styles.muted}>{row.urlSource === 'whatsapp' ? 'Klik ke WhatsApp.' : row.urlSource === 'shopee' ? 'Tujuan Shopee (CPAS).' : 'URL belum terbaca dari Meta.'}</p>}
        {canManage && !row.urls.length && row.ad_channel !== 'cpas' && <form className={styles.inlineForm} onSubmit={e => { e.preventDefault(); if (url.trim()) onVerify(url.trim()); }}>
          <label>Tetapkan URL landing page<input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></label>
          <button type="submit" className={styles.primary} disabled={busy || !url.trim() || !row.creative_id}>Simpan URL</button>
          {!row.creative_id && <small className={styles.muted}>Creative belum terbaca; jalankan Sync pemetaan dulu.</small>}
        </form>}
        {row.campaign_name && <p className={styles.muted}>Campaign: {row.campaign_name}</p>}
        <p className={styles.muted}>Objective Meta: {row.campaign_objective ? objectiveLabel(row.campaign_objective) : 'Belum terbaca'}</p>
      </div>
      <div>
        <b>Riwayat pemetaan</b>
        <p className={styles.muted}>{row.source === 'inventory' ? 'Inventori Meta' : 'Cache awal'} · revisi {row.revision}</p>
        <p className={styles.muted}>Pertama terlihat {stamp(row.first_seen_at)} · terakhir {stamp(row.last_seen_at)}</p>
        <p className={styles.muted}><Link href="/dashboard/meta-funnels">Lihat Ringkasan brand</Link></p>
      </div>
    </aside>
  </>;
}
