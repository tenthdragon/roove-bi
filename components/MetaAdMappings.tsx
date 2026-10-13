'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmMetaAdMappingUnit, getMetaAdMappingData, queueMetaAdMappingSync, saveMetaAdMappingOverrides } from '@/lib/meta-ad-mapping-actions';
import { effectiveMappingValue, mappingDimensionLabel, mappingUnit, type AdMapping } from '@/lib/meta-ad-mapping';
import styles from '@/app/dashboard/meta-funnels/page.module.css';
import MetaAdDimensionFilters from './MetaAdDimensionFilters';
import { objectiveLabel, type AdDimensionFilters } from '@/lib/meta-ad-dimensions';
type Data = Extract<Awaited<ReturnType<typeof getMetaAdMappingData>>, { ready: true }>;
const message = (e: unknown) => e instanceof Error ? e.message : 'Permintaan gagal.';
const date = (value: string) => new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

export default function MetaAdMappings({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [data, setData] = useState<Data | null>(null); const [ready, setReady] = useState(true);
  const [search, setSearch] = useState(''); const [query, setQuery] = useState(''); const [account, setAccount] = useState(''); const [page, setPage] = useState(1);
  const [filters,setFilters] = useState<AdDimensionFilters>({});
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<{ ad: AdMapping; cep: string; intention: string } | null>(null); const request = useRef(0);
  const load = useCallback(async () => {
    const current = ++request.current; setLoading(true); setError('');
    try { const result = await getMetaAdMappingData({ page, search: query, accountId: account || undefined,filters });
      if (current !== request.current) return; setReady(result.ready); if (result.ready) setData(result);
    } catch (e) { if (current === request.current) setError(message(e)); }
    finally { if (current === request.current) setLoading(false); }
  }, [page, query, account, workspaceId, filters.cep, filters.objective, filters.intention]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = setTimeout(() => { setQuery(search); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { const guard = request; void load(); return () => { guard.current++; }; }, [load]);
  const pending = (data?.pendingJobs || 0) > 0;
  useEffect(() => { if (!pending) return; const timer = setInterval(() => { void load(); }, 15000); return () => clearInterval(timer); }, [pending, load]);
  async function action(work: () => Promise<unknown>, noticeText?: string) {
    setBusy(true); setError(''); try { await work(); if (noticeText) setNotice(noticeText); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <section className={styles.mappingSection} aria-label="Pemetaan Ads">
    <div className={styles.sectionHeader}><div><h1>Pemetaan Ads</h1><p className={styles.muted}>Inventori per ad, termasuk ad tanpa spent. Pemetaan mencakup semua tanggal.</p></div><div className={styles.actions}>
      <button className={styles.button} disabled={loading} onClick={() => void load()}>Muat ulang pemetaan</button>{canManage && <button className={styles.primary} disabled={busy || !ready} onClick={() => void action(queueMetaAdMappingSync, 'Sync pemetaan masuk antrean. Worker akan membaca inventori semua akun aktif.')}>Sync pemetaan</button>}
    </div></div>
    {error && <div role="alert" className={styles.error}>{error}</div>}{notice && <div role="status" className={styles.info}>{notice}</div>}
    {!ready ? <div className={styles.card}>Pasang migration 201_meta_ad_mappings.sql untuk mengaktifkan pemetaan.</div> : <>
      <p>Ad ID menjadi identitas tetap. Setiap nilai bracket dan keyword baru otomatis tercatat sebagai unit baru. Bracket 1 mengikuti CEP pada panduan, bracket 2 intention; bracket berikutnya disimpan menurut posisi untuk penentuan arti berikutnya.</p>
      {data && <>
        <div className={styles.cards}><div className={styles.card}><span className={styles.muted}>Ad terpetakan</span><strong>{data.totalAds.toLocaleString('id-ID')}</strong></div><div className={styles.card}><span className={styles.muted}>Unit bracket baru</span><strong>{data.newUnitCount.toLocaleString('id-ID')}</strong><small className={styles.muted}>Sudah tercatat; bisa diperiksa terpisah.</small></div></div>
        {pending && <p role="status" className={styles.info}>{data.pendingJobs} batch dalam antrean atau sedang berjalan. Nama ad dipetakan terlebih dahulu; URL dan creative diperbarui dalam batch berikutnya.</p>}
        <details className={styles.card}><summary>Pembaruan otomatis & status sync</summary><p>Pemetaan diperbarui setiap hari melalui scheduler Meta dan worker. Gunakan Sync pemetaan untuk mengambil perubahan lebih cepat. Nama ad dipetakan terlebih dahulu, lalu URL dan creative diperbarui dalam batch kecil. Ad yang tidak muncul pada respons API tetap disimpan.</p>
          {data.state.map(s => <p key={s.account_id}>{data.accounts.find(a => a.account_id === s.account_id)?.account_name || s.account_id}: {s.ads_count} ad · {date(s.last_inventory_at)}</p>)}{!data.state.length && <p>Inventori langsung belum disinkronkan.</p>}
          {data.jobs.map(job => <p key={job.id}>{job.mode === 'ad_mapping_creatives' ? 'Creative / URL' : 'Inventori ad'} · {date(job.created_at)} · {job.status}{job.error_message && ` · ${job.error_message}`}</p>)}
        </details>
        {!!data.newUnitCount && <details className={styles.card}><summary>{data.newUnitCount} unit bracket baru untuk diperiksa</summary><p className={styles.muted}>Unit baru tetap disimpan. Konfirmasi menandai istilah yang sudah diperiksa, tanpa menggabungkannya. Menampilkan maksimal 200 unit.</p><div className={styles.mappingUnits}>
          {data.units.map(unit => <div className={styles.namingIssue} key={`${unit.dimension}:${unit.unit_key}`}><span>{mappingDimensionLabel(unit.dimension)} · <b>{unit.label}</b></span>{canManage && <button className={styles.button} disabled={busy} onClick={() => void action(() => confirmMetaAdMappingUnit({ dimension: unit.dimension, key: unit.unit_key }))}>Konfirmasi unit {unit.label}</button>}</div>)}
        </div></details>}
        <div className={styles.filters}><label>Cari nama ad<input aria-label="Cari nama ad pada pemetaan" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nama ad atau isi bracket…" /></label><label>Akun<select value={account} onChange={e => { setAccount(e.target.value); setPage(1); }}><option value="">Semua akun aktif</option>{data.accounts.map(a => <option key={a.account_id} value={a.account_id}>{a.account_name}</option>)}</select></label></div>
        <MetaAdDimensionFilters value={filters} options={data.dimensionOptions} ready={data.dimensionsReady} onChange={value=>{setFilters(value);setPage(1);}} />
        {editor && <form className={`${styles.card} ${styles.editor}`} onSubmit={e => { e.preventDefault(); void action(async () => { await saveMetaAdMappingOverrides({ accountId: editor.ad.account_id, adId: editor.ad.ad_id, revision: editor.ad.revision, cep: editor.cep, intention: editor.intention }); setEditor(null); }, 'Koreksi tersimpan dan dipertahankan saat sync.'); }}><h3>Koreksi pemetaan ad</h3><p>{editor.ad.ad_name}</p><p className={styles.muted}>Isi untuk menetapkan koreksi manual. Kosongkan untuk kembali ke nilai otomatis. Unsur nama asli tetap disimpan.</p>
          <div className={styles.formGrid}><label>CEP manual<input maxLength={500} value={editor.cep} onChange={e => setEditor({ ...editor, cep: e.target.value })} /></label><label>Intention manual<input maxLength={500} value={editor.intention} onChange={e => setEditor({ ...editor, intention: e.target.value })} /></label></div><div className={styles.actions}><button className={styles.primary} type="submit" disabled={busy}>Simpan pemetaan</button><button className={styles.button} type="button" disabled={busy} onClick={() => setEditor(null)}>Batal</button></div>
        </form>}
        {loading && <p role="status" className={styles.muted}>Memuat pemetaan…</p>}
        <div className={styles.tableWrap}><table className={styles.mappingTable}><thead><tr><th>Ad & akun</th><th>URL landing page</th><th>CEP</th><th>Intention</th><th>Seluruh unsur nama</th><th>Pemetaan</th></tr></thead><tbody>{data.rows.map(ad => {
          const verified = data.verified.find(v => v.account_id === ad.account_id && v.ad_id === ad.ad_id && v.creative_id === ad.creative_id);
          const urls = ad.landing_page_urls.length ? ad.landing_page_urls : verified ? [verified.landing_page_url] : [];
          const value = (dimension: 'cep' | 'intention') => { const key = effectiveMappingValue(ad, dimension); return key ? mappingUnit(dimension, key).label : 'Belum terpetakan'; };
          return <tr key={`${ad.account_id}:${ad.ad_id}`}><td data-label="Ad & akun"><b>{ad.ad_name || '(Tanpa nama)'}</b><small>{data.accounts.find(a => a.account_id === ad.account_id)?.account_name || ad.account_id} · Ad {ad.ad_id}</small><small>{ad.effective_status || 'Status belum terbaca'}</small><small>Objective Meta: {ad.campaign_objective ? objectiveLabel(ad.campaign_objective) : 'Belum terbaca'}</small>{ad.campaign_name && <small>Campaign: {ad.campaign_name}</small>}</td><td data-label="URL landing page">{urls.length ? urls.map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{url}</a>) : 'URL belum terbaca'}{!ad.landing_page_urls.length && verified && <small>URL terverifikasi</small>}</td>
            <td data-label="CEP">{value('cep')}{ad.overrides.cep && <small>Koreksi manual</small>}</td><td data-label="Intention">{value('intention')}{ad.overrides.intention && <small>Koreksi manual</small>}</td><td data-label="Seluruh unsur nama"><details><summary>{ad.auto_mapping.tags.length} bracket · {ad.auto_mapping.keywords.length} keyword</summary>{ad.auto_mapping.tags.map(t => <p key={t.position}>{mappingDimensionLabel(t.dimension)}: <b>[{t.raw}]</b></p>)}<p className={styles.muted}>Teks bebas: {ad.auto_mapping.free_text || '—'}</p><p className={styles.muted}>Keyword: {ad.auto_mapping.keywords.map(t => t.key).join(', ') || '—'}</p></details></td>
            <td data-label="Pemetaan"><small>{ad.source === 'inventory' ? 'Inventori Meta' : 'Cache awal'} · revisi {ad.revision}</small><small>{date(ad.last_seen_at)}</small>{ad.auto_mapping.issues.map(issue => <p className={styles.muted} key={issue}>{issue}</p>)}{canManage && <button className={styles.button} onClick={() => setEditor({ ad, cep: ad.overrides.cep || '', intention: ad.overrides.intention || '' })}>Koreksi ad {ad.ad_id}</button>}</td></tr>;
        })}</tbody></table>{!data.rows.length && <p className={styles.card}>Belum ada ad yang sesuai. Gunakan Sync pemetaan untuk membaca inventori akun.</p>}</div>
        <div className={styles.sectionHeader}><span className={styles.muted}>{data.count} ad · halaman {page} dari {Math.max(1, Math.ceil(data.count / data.pageSize))}</span><div className={styles.actions}><button className={styles.button} disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Sebelumnya</button><button className={styles.button} disabled={page * data.pageSize >= data.count || loading} onClick={() => setPage(page + 1)}>Berikutnya</button></div></div>
      </>}
    </>}
  </section>;
}
