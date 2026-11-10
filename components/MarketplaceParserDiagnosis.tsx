'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import type { DiagnosisRequest, ParserDiagnosis, RepairRequest, RepairResult } from '@/lib/marketplace-parser/diagnosis-types';
import styles from './MarketplaceParserTool.module.css';

type Props = {
  workspace: string; account: string; revision: number; skus: string[];
  canSync: boolean; canManage: boolean; busy: boolean; dirty: boolean;
  diagnose: (workspace: string,input: DiagnosisRequest) => Promise<ParserDiagnosis>;
  repair: (input: RepairRequest) => Promise<RepairResult>;
  openSettings: () => void;
};
const price = (value: string) => new Intl.NumberFormat('id-ID',{ style: 'currency',currency: 'IDR',maximumFractionDigits: 2 }).format(Number(value));
export default function MarketplaceParserDiagnosis({ workspace,account,revision,skus,canSync,canManage,busy,dirty,diagnose,repair,openSettings }: Props) {
  const [data,setData] = useState<ParserDiagnosis | null>(null), [error,setError] = useState('');
  const [loading,setLoading] = useState(false), [working,setWorking] = useState(false), [outcome,setOutcome] = useState<RepairResult | null>(null);
  const [storeId,setStoreId] = useState(0), [options,setOptions] = useState<Record<string,number>>({}), [selected,setSelected] = useState<Record<string,boolean>>({});
  const pending = useRef(0), alive = useRef(true), resultRef = useRef<HTMLDivElement>(null), actionPending = useRef(false);
  const skuKey = JSON.stringify([...new Set(skus.map(s => s.trim()).filter(Boolean))]);
  const check = useCallback(async () => {
    if (dirty || !revision) return;
    if (skuKey === '[]') { setError('Nomor Referensi SKU kosong. Lengkapi identifier code pada file marketplace terlebih dahulu.'); return; }
    const token = ++pending.current; setLoading(true); setError(''); setData(null);
    try {
      const next = await diagnose(workspace,{ account,revision,skus: JSON.parse(skuKey) });
      if (!alive.current || token !== pending.current) return;
      setData(next); setStoreId(old => next.stores.some(s => s.id === old) ? old : next.suggestedStoreId || 0);
      setOptions(old => Object.fromEntries(next.items.map(i => [i.sku,i.bundles[0]?.options.some(o => o.id === old[i.sku]) ? old[i.sku] : i.bundles[0]?.options.length === 1 ? i.bundles[0].options[0].id : 0])));
      setSelected(old => Object.fromEntries(next.items.map(i => [i.sku,old[i.sku] ?? true])));
    } catch (e) { if (alive.current && token === pending.current) setError(e instanceof Error ? e.message : 'Diagnosis belum tersedia. Coba periksa lagi.'); }
    finally { if (alive.current && token === pending.current) setLoading(false); }
  },[workspace,account,revision,skuKey,dirty,diagnose]);
  useEffect(() => { const requests = pending; alive.current = true; void check(); return () => { alive.current = false; requests.current++; }; },[check]);
  useEffect(() => { if (error || outcome) resultRef.current?.focus({ preventScroll: true }); },[error,outcome]);
  const locked = busy || working || loading || dirty;
  const canWrite = canSync && canManage;
  const candidates = (data?.items || []).filter(i => i.status === 'found' && i.bundles.length === 1 && !i.bundles[0].installedStoreIds.includes(storeId) && (i.bundles[0].availableInBusiness || i.bundles[0].canShare) && i.bundles[0].options.length);
  const chosen = candidates.filter(i => selected[i.sku]);
  const sharing = chosen.some(i => !i.bundles[0].availableInBusiness);
  async function run(mode: 'refresh' | 'attach', onlySku?: string) {
    if (!canSync || !data || !storeId || locked || actionPending.current || (mode === 'attach' && !canWrite)) return;
    const items = (onlySku ? candidates.filter(i => i.sku === onlySku) : chosen).map(i => ({ sku: i.sku,bundleId: i.bundles[0].id,optionId: options[i.sku],share: !i.bundles[0].availableInBusiness }));
    if (mode === 'attach' && (!items.length || items.some(i => !i.optionId))) return;
    actionPending.current = true; setWorking(true); setError(''); setOutcome(null);
    try {
      const next = await repair({ token: data.token,storeId,mode,items: mode === 'attach' ? items : [] });
      if (!alive.current) return;
      setOutcome(next); await check();
    } catch (e) { if (alive.current) { setData(null); setError(e instanceof Error ? e.message : 'Hasil aksi belum pasti. Periksa ulang sebelum mencoba lagi.'); } }
    finally { actionPending.current = false; if (alive.current) setWorking(false); }
  }
  return <section className={styles.diagnosis} aria-label="Diagnosis bundle" aria-busy={loading || working}>
    <div className={styles.sectionHeading}><div><h3>Lacak bundle di data aplikasi</h3><p>Cocokkan identifier code, pemilik bundle, dan Store dari hasil sinkronisasi tersimpan.</p></div>
      <button className={styles.secondary} disabled={locked || !revision || skuKey === '[]'} onClick={() => void check()}><RefreshCw size={14}/>{loading ? 'Memeriksa…' : 'Muat ulang data aplikasi'}</button></div>
    {!canSync ? <p className={styles.dim}>Data aplikasi tetap dapat diperiksa. Sinkronisasi dan perubahan Scalev tidak aktif di lingkungan lokal.</p> : null}
    {dirty || !revision ? <p className={styles.warning}>Simpan atau batalkan perubahan aturan sebelum diagnosis dan perbaikan.</p> : null}
    {loading && <p role="status">Membaca katalog dan relasi Store dari database aplikasi…</p>}
    {working && <p role="status">Memeriksa ulang, memproses bundle, lalu menyinkronkan Store. Tunggu hingga selesai.</p>}
    {(error || outcome) && <div ref={resultRef} tabIndex={-1} role={error ? 'alert' : 'status'} className={error || !outcome?.synced || outcome.items.some(i => i.stage !== 'ready') ? styles.hint : styles.notice}>
      <div><p>{error || outcome?.message}</p>{outcome?.items.length ? <ul>{outcome.items.map(i => <li key={i.sku}><strong>{i.sku}</strong>: {i.message}</li>)}</ul> : null}</div></div>}
    {data && <>
      <p className={styles.dim}>{data.account} → Business <strong>{data.business}</strong> · Data aplikasi diperiksa {new Date(data.checkedAt).toLocaleTimeString('id-ID')}</p>
      {data.catalogSyncedAt && <p className={styles.dim}>Waktu sinkronisasi paling awal pada hasil ini: {new Date(data.catalogSyncedAt).toLocaleString('id-ID')}. Sinkronkan bila ada perubahan di Scalev.</p>}
      {!!data.issues.length && <ul className={styles.issues}>{data.issues.map((issue,i) => <li key={i}>{issue}</li>)}</ul>}
      <div className={styles.diagnosisDestination}>
        <label>Store untuk pemasangan bundle<select value={storeId} disabled={locked || !data.stores.length} onChange={e => setStoreId(Number(e.target.value))}><option value={0}>Pilih Store yang digunakan</option>{data.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <button className={styles.secondary} disabled={!canSync || locked || !storeId || !data.token} onClick={() => void run('refresh')}><RefreshCw size={14}/>Sinkronkan Store dari Scalev</button>
      </div>
      <p className={styles.dim}>Pilihan Store mengikuti lingkup dan routing tersimpan. Pemasangan dan sharing berlaku global di Scalev; harga transaksi marketplace tetap digunakan.</p>
      {!data.stores.length && <p className={styles.warning}>Store yang dapat diperbaiki belum tersedia. Periksa aturan atau masalah koneksi di atas.</p>}
      {!canWrite && <p className={styles.dim}>Pemasangan dan sharing memerlukan izin pengelolaan katalog. Anda tetap dapat memeriksa data aplikasi.</p>}
      <div className={styles.diagnosisItems}>{data.items.map(item => {
        const bundle = item.bundles[0], installed = bundle?.installedStoreIds.includes(storeId), candidate = candidates.some(i => i.sku === item.sku);
        return <section className={styles.diagnosisItem} key={item.sku} aria-label={`Diagnosis ${item.sku}`}>
          <div><h4>{item.sku}</h4><p className={styles.dim}>{item.message}</p></div>
          {item.bundles.map(b => <div key={b.id} className={styles.bundleFinding}><strong>{b.name}</strong><span>Pemilik: {b.owner} · Bundle #{b.id}</span><a href={`https://app.scalev.com/bundles/${b.id}`} target="_blank" rel="noopener noreferrer">Buka bundle di Scalev <ExternalLink size={12}/></a></div>)}
          {item.status === 'found' && bundle && <>
            <p className={installed ? styles.good : styles.dim}>{installed ? 'Sudah terpasang di Store ini. Sinkronkan Store bila ada perubahan di Scalev.' : bundle.availableInBusiness ? storeId ? 'Tersedia bagi Business tujuan, belum terpasang di Store yang dipilih.' : 'Tersedia bagi Business tujuan. Pilih Store untuk melihat ketersediaannya.' : bundle.canShare ? `Perlu dibagikan dari ${bundle.owner} ke ${data.business}, lalu dipasang ke Store.` : 'Identitas atau koneksi Business pemilik belum terverifikasi. Sinkronkan katalog Business pemilik; jika belum terhubung, selesaikan sharing di Scalev.'}</p>
            {!installed && !bundle.options.length && <p className={styles.warning}>{bundle.optionsSynced === false ? 'Pilihan harga belum tersinkron. Pilih Sinkronkan Store dari Scalev untuk melengkapi data bundle ini.' : 'Tidak ada pilihan harga aktif pada hasil sinkronisasi. Lengkapi di Scalev, lalu sinkronkan kembali.'}</p>}
            {candidate && <div className={styles.diagnosisControls}>
              <label className={styles.check}><input type="checkbox" aria-label={`Pilih bundle ${item.sku}`} checked={selected[item.sku] ?? true} disabled={locked || !canWrite} onChange={e => setSelected(old => ({ ...old,[item.sku]: e.target.checked }))}/>Sertakan dalam aksi bersama</label>
              <label>Pilihan harga bundle · {item.sku}<select value={options[item.sku] || 0} disabled={locked || !canWrite} onChange={e => setOptions(old => ({ ...old,[item.sku]: Number(e.target.value) }))}><option value={0}>Pilih opsi bundle</option>{bundle.options.map(o => <option key={o.id} value={o.id}>{o.name} · {price(o.price)} · #{o.id}</option>)}</select></label>
              <button className={styles.secondary} disabled={locked || !canWrite || !storeId || !options[item.sku]} onClick={() => void run('attach',item.sku)}>{bundle.availableInBusiness ? 'Tambahkan ke Store' : 'Bagikan & tambahkan ke Store'}</button>
            </div>}
          </>}
          {item.status === 'missing' && <a href="/dashboard/warehouse-settings?tab=catalog" target="_blank" rel="noopener noreferrer">Sinkronkan katalog Business di Katalog &amp; Master Data <ExternalLink size={12}/></a>}
          {item.status === 'unavailable' && <p className={styles.warning}>Selesaikan sinkronisasi yang bermasalah, lalu muat ulang data aplikasi. Hasil ini belum menyatakan bundle tidak ada.</p>}
        </section>;
      })}</div>
      <div className={styles.actions}>
        {candidates.length > 1 && <button className={styles.primary} disabled={locked || !canWrite || !storeId || !chosen.length || chosen.some(i => !options[i.sku])} onClick={() => void run('attach')}>{sharing ? 'Bagikan & tambahkan' : 'Tambahkan'} {chosen.length} bundle ke Store</button>}
        <button className={styles.secondary} disabled={locked} onClick={openSettings}>Atur routing / kombinasi / Warehouse</button>
      </div>
    </>}
  </section>;
}
