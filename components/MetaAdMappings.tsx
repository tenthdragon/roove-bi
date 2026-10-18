'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { applyMetaAdMappingUnit, confirmMetaAdMappingUnit, getMetaAdWorklist, queueMetaAdMappingSync, saveMetaAdMappingOverrides, saveMetaAdMappingOverridesBulk } from '@/lib/meta-ad-mapping-actions';
import { verifyMetaAdDestination } from '@/lib/meta-funnel-actions';
import { mappingDimensionLabel } from '@/lib/meta-ad-mapping';
import { labelOptions, WORKLIST_ISSUE_LABELS, WORKLIST_ISSUES, type WorklistIssue, type WorklistRow } from '@/lib/meta-ad-worklist';
import { objectiveLabel, type AdDimensionFilters } from '@/lib/meta-ad-dimensions';
import { metaAdChannelLabel, META_AD_CHANNELS, type MetaAdChannel } from '@/lib/meta-ad-channels';
import { formatCompactMoney, formatDate } from '@/lib/meta-format';
import { useDateRange } from '@/lib/DateRangeContext';
import MetaAdDimensionFilters from './MetaAdDimensionFilters';
import MetaAdsNav from './MetaAdsNav';
import styles from '@/app/dashboard/meta-funnels/page.module.css';

type Data = Extract<Awaited<ReturnType<typeof getMetaAdWorklist>>, { ready: true }>;
const message = (e: unknown) => e instanceof Error ? e.message : 'Permintaan gagal.';
const stamp = (value: string | null) => value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const OTHER = '__other__';
const rowKey = (row: Pick<WorklistRow, 'account_id' | 'ad_id'>) => `${row.account_id}:${row.ad_id}`;
const channelHint: Record<MetaAdChannel, string> = { non_cpas: 'Website', cpas: 'CPAS', unknown: 'Perlu verifikasi' };

function parseIssue(value: string | null): WorklistIssue | null { return value && (WORKLIST_ISSUES as readonly string[]).includes(value) ? value as WorklistIssue : null; }
function parseChannel(value: string | null): MetaAdChannel | null { return value && (META_AD_CHANNELS as readonly string[]).includes(value) ? value as MetaAdChannel : null; }

/** Pemetaan Ads as a worklist: what the brand report cannot read yet, ranked by spend in the selected range. */
export default function MetaAdMappings({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const router = useRouter(); const pathname = usePathname(); const searchParams = useSearchParams();
  const { dateRange, loading: rangeLoading } = useDateRange();
  const issue = parseIssue(searchParams.get('issue')); const channel = parseChannel(searchParams.get('channel'));
  const account = searchParams.get('account') || ''; const urlQuery = searchParams.get('q') || '';
  const [search, setSearch] = useState(urlQuery); const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<AdDimensionFilters>({}); const [includeInactive, setIncludeInactive] = useState(false);
  const [data, setData] = useState<Data | null>(null); const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [detail, setDetail] = useState<WorklistRow | null>(null);
  const [custom, setCustom] = useState<{ key: string; dimension: 'cep' | 'intention'; value: string } | null>(null);
  const [bulk, setBulk] = useState<{ cep: string; intention: string }>({ cep: '', intention: '' });
  const request = useRef(0);

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    setPage(1); setSelected(new Set());
  }
  useEffect(() => { const timer = setTimeout(() => { if (search !== urlQuery) setParam('q', search.trim() || null); }, 300); return () => clearTimeout(timer); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async (quiet = false) => {
    if (rangeLoading || !dateRange.from) return;
    const current = ++request.current; if (!quiet) setLoading(true); setError('');
    try {
      const result = await getMetaAdWorklist({ from: dateRange.from, to: dateRange.to, page, search: urlQuery, accountId: account || undefined, filters, channel: channel || undefined, issue: issue || undefined, includeInactive });
      if (current !== request.current) return;
      setReady(result.ready); if (result.ready) setData(result);
    } catch (e) { if (current === request.current) setError(message(e)); }
    finally { if (current === request.current) setLoading(false); }
  }, [rangeLoading, dateRange.from, dateRange.to, page, urlQuery, account, filters, channel, issue, includeInactive]);
  useEffect(() => { const guard = request; void load(); return () => { guard.current++; }; }, [load]);
  const pending = (data?.pendingJobs || 0) > 0;
  useEffect(() => { if (!pending) return; const timer = setInterval(() => { void load(true); }, 15000); return () => clearInterval(timer); }, [pending, load]);

  async function run(work: () => Promise<unknown>, done?: string) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); if (done) setNotice(done); await load(true); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const cepOptions = useMemo(() => data ? labelOptions('cep', data.rows, data.newUnits) : [], [data]);
  const intentionOptions = useMemo(() => data ? labelOptions('intention', data.rows, data.newUnits) : [], [data]);
  const options = { cep: cepOptions, intention: intentionOptions };

  function changeLabel(row: WorklistRow, dimension: 'cep' | 'intention', value: string) {
    if (value === OTHER) { setCustom({ key: rowKey(row), dimension, value: '' }); return; }
    setCustom(null);
    const next = { cep: row.overrides.cep || '', intention: row.overrides.intention || '', [dimension]: value };
    void run(() => saveMetaAdMappingOverrides({ accountId: row.account_id, adId: row.ad_id, revision: row.revision, cep: next.cep, intention: next.intention }),
      value ? `${dimension === 'cep' ? 'CEP' : 'Intention'} ad ${row.ad_id} disimpan sebagai koreksi manual.` : `Ad ${row.ad_id} kembali ke nilai otomatis dari nama ad.`);
  }
  function pickerValue(row: WorklistRow, dimension: 'cep' | 'intention') {
    if (custom?.key === rowKey(row) && custom.dimension === dimension) return OTHER;
    return row[dimension].manual ? row[dimension].key || '' : '';
  }
  const picker = (row: WorklistRow, dimension: 'cep' | 'intention') => {
    const label = row[dimension]; const list = options[dimension];
    if (!canManage) return <>{label.key ? label.label : <small className={styles.cellHint}>Belum terpetakan</small>}{label.manual && <small className={styles.manualMark}>Koreksi manual</small>}</>;
    const editing = custom?.key === rowKey(row) && custom.dimension === dimension;
    return <>
      <select aria-label={`${dimension === 'cep' ? 'CEP' : 'Intention'} ad ${row.ad_id}`} disabled={busy} value={pickerValue(row, dimension)} onChange={e => changeLabel(row, dimension, e.target.value)}>
        <option value="">{label.key && !label.manual ? `Otomatis · ${label.label}` : 'Otomatis · belum ada'}</option>
        {list.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        {label.manual && label.key && !list.some(o => o.value === label.key) && <option value={label.key}>{label.label}</option>}
        <option value={OTHER}>Lainnya…</option>
      </select>
      {editing && <form className={styles.inlineForm} onSubmit={e => { e.preventDefault(); if (custom.value.trim()) changeLabel(row, dimension, custom.value); }}>
        <input aria-label="Nilai lain" autoFocus maxLength={500} value={custom.value} onChange={e => setCustom({ ...custom, value: e.target.value })} placeholder="Tulis istilah…" />
        <button type="submit" className={styles.primary} disabled={busy || !custom.value.trim()}>Simpan</button><button type="button" className={styles.button} onClick={() => setCustom(null)}>Batal</button>
      </form>}
      {label.manual && !editing && <small className={styles.manualMark}>Koreksi manual</small>}
      {!label.key && !editing && <small className={styles.cellHint}>Belum terpetakan</small>}
      {label.key && !label.recognized && !editing && <small className={styles.muted}>Istilah di luar panduan</small>}
    </>;
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
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const sub = data ? `${data.scopeAds.toLocaleString('id-ID')} ad tayang · spend ${formatCompactMoney(data.scopeSpend, 'IDR')} · ${formatDate(data.range.from)} – ${formatDate(data.range.to)}${data.inactiveAds ? ` · ${data.inactiveAds.toLocaleString('id-ID')} ad tanpa impresi disembunyikan` : ''}` : undefined;
  const lastSync = data?.state.length ? data.state.map(s => s.last_inventory_at).sort().at(-1) || null : null;

  return <>
    <MetaAdsNav title="Pemetaan Ads" subtitle={data ? `${sub} · inventori ${lastSync ? stamp(lastSync) : 'belum disinkronkan'}` : 'Ad yang tayang pada periode terpilih, diurutkan dari spend terbesar.'}
      actions={<>
        <button className={styles.button} disabled={loading} onClick={() => void load()}>Muat ulang</button>
        {canManage && <button className={styles.primary} disabled={busy || !ready} onClick={() => void run(queueMetaAdMappingSync, 'Sync pemetaan masuk antrean. Nama ad dibaca lebih dulu; URL dan creative menyusul dalam batch kecil.')}>Sync pemetaan</button>}
      </>} />
    {error && <div role="alert" className={styles.error}>{error}</div>}{notice && <div role="status" className={styles.info}>{notice}</div>}
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
      {data && data.units.length > 0 && <div className={styles.card}>
        <b>{data.units.length} istilah baru pada nama ad</b>
        <p className={styles.muted}>Istilah di luar panduan penamaan. Petakan ke CEP atau intention yang dikenal agar laporan membacanya, atau abaikan jika istilah itu memang disengaja.</p>
        {data.units.map(unit => <UnitRow key={`${unit.dimension}:${unit.unit_key}`} unit={unit} options={options[unit.dimension as 'cep' | 'intention']} busy={busy} canManage={canManage}
          onApply={target => void run(() => applyMetaAdMappingUnit({ dimension: unit.dimension, unitKey: unit.unit_key, targetKey: target }), `Istilah "${unit.label}" dipetakan ke ${target}.`)}
          onIgnore={() => void run(() => confirmMetaAdMappingUnit({ dimension: unit.dimension, key: unit.unit_key }), `Istilah "${unit.label}" ditandai sudah diperiksa.`)} />)}
      </div>}
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          <label>Cari<input aria-label="Cari ad" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nama ad, ID, campaign, atau URL…" /></label>
          <label>Akun<select value={account} onChange={e => setParam('account', e.target.value || null)}><option value="">Semua akun aktif</option>{(data?.accounts || []).map(a => <option key={a.account_id} value={a.account_id}>{a.account_name}</option>)}</select></label>
          <label>Jenis iklan<select value={channel || ''} onChange={e => setParam('channel', e.target.value || null)}><option value="">Semua jenis</option>{META_AD_CHANNELS.map(c => <option key={c} value={c}>{channelHint[c]} · {metaAdChannelLabel(c)}</option>)}</select></label>
        </div>
        <label style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={includeInactive} disabled={!!data && !data.activityReady} onChange={e => { setIncludeInactive(e.target.checked); setPage(1); setSelected(new Set()); }} />Tampilkan juga ad tanpa impresi</label>
      </div>
      {data && <MetaAdDimensionFilters value={filters} options={data.dimensionOptions} ready={data.dimensionsReady} hasOtherFilters={!!(issue || channel || account || urlQuery)} onChange={value => { setFilters(value); setPage(1); setSelected(new Set()); }}
        onReset={() => { setFilters({}); setSearch(''); router.replace(pathname, { scroll: false }); setPage(1); setSelected(new Set()); }} />}
      {issue && <p className={styles.muted}>Menampilkan ad dengan masalah <b>{WORKLIST_ISSUE_LABELS[issue]}</b>. <button type="button" className={styles.button} onClick={() => setParam('issue', null)}>Tampilkan semua</button></p>}
      {!data && loading && <p role="status" className={styles.muted}>Memuat daftar ad…</p>}
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
          <select aria-label="CEP untuk ad terpilih" value={bulk.cep} onChange={e => setBulk({ ...bulk, cep: e.target.value })}><option value="">CEP: biarkan</option><option value="__auto__">CEP: kembali otomatis</option>{cepOptions.map(o => <option key={o.value} value={o.value}>CEP: {o.label}</option>)}</select>
          <select aria-label="Intention untuk ad terpilih" value={bulk.intention} onChange={e => setBulk({ ...bulk, intention: e.target.value })}><option value="">Intention: biarkan</option><option value="__auto__">Intention: kembali otomatis</option>{intentionOptions.map(o => <option key={o.value} value={o.value}>Intention: {o.label}</option>)}</select>
          <button className={styles.primary} disabled={busy || (!bulk.cep && !bulk.intention)} onClick={() => void run(async () => {
            const result = await saveMetaAdMappingOverridesBulk({ ads: selectedRows.map(r => ({ accountId: r.account_id, adId: r.ad_id })), cep: bulk.cep ? (bulk.cep === '__auto__' ? '' : bulk.cep) : undefined, intention: bulk.intention ? (bulk.intention === '__auto__' ? '' : bulk.intention) : undefined });
            setSelected(new Set()); setBulk({ cep: '', intention: '' });
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

function UnitRow({ unit, options, busy, canManage, onApply, onIgnore }: { unit: Data['units'][number]; options: { value: string; label: string }[]; busy: boolean; canManage: boolean; onApply: (target: string) => void; onIgnore: () => void }) {
  const [target, setTarget] = useState('');
  const choices = options.filter(o => o.value !== unit.unit_key);
  return <div className={styles.unitRow}>
    <span>{mappingDimensionLabel(unit.dimension)} · <b>{unit.label}</b><br /><small className={styles.muted}>{unit.ads.toLocaleString('id-ID')} ad masih bergantung · spend {formatCompactMoney(unit.spend, 'IDR')}</small></span>
    {canManage && <span className={styles.actions}>
      <select aria-label={`Petakan ${unit.label} ke`} value={target} onChange={e => setTarget(e.target.value)}><option value="">Petakan ke…</option>{choices.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      <button className={styles.primary} disabled={busy || !target} onClick={() => onApply(target)}>Petakan</button>
      <button className={styles.button} disabled={busy} onClick={onIgnore}>Abaikan</button>
    </span>}
  </div>;
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
