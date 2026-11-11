'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, ExternalLink, LockKeyhole, Share2, RefreshCw } from 'lucide-react';
import type { DiagnosisRequest, ParserDiagnosis, RepairRequest, RepairResult } from '@/lib/marketplace-parser/diagnosis-types';
import styles from './MarketplaceParserTool.module.css';

type Props = {
  workspace: string; account: string; revision: number; skus: string[];
  canSync: boolean; canManage: boolean; busy: boolean; dirty: boolean;
  orderTotalCents?: number | null;
  diagnose: (workspace: string,input: DiagnosisRequest) => Promise<ParserDiagnosis>;
  repair: (input: RepairRequest) => Promise<RepairResult>;
  openSettings: () => void;
};
const price = (cents: number) => new Intl.NumberFormat('id-ID',{ style: 'currency',currency: 'IDR',maximumFractionDigits: 2 }).format(cents / 100);
function StatusStep({ label,value,ready,note }: { label: string; value: string; ready: boolean; note?: string }) {
  return <div className={`${styles.diagnosisStep} ${ready ? styles.diagnosisReady : styles.diagnosisPending}`}>
    {ready ? <CheckCircle2 size={18} aria-hidden="true"/> : <AlertCircle size={18} aria-hidden="true"/>}
    <div><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>
  </div>;
}
export default function MarketplaceParserDiagnosis({ workspace,account,revision,skus,canSync,canManage,busy,dirty,orderTotalCents,diagnose,repair,openSettings }: Props) {
  const [data,setData] = useState<ParserDiagnosis | null>(null), [error,setError] = useState('');
  const [loading,setLoading] = useState(false), [working,setWorking] = useState(false), [outcome,setOutcome] = useState<RepairResult | null>(null);
  const [selected,setSelected] = useState<Record<string,boolean>>({});
  const pending = useRef(0), alive = useRef(true), resultRef = useRef<HTMLDivElement>(null), actionPending = useRef(false);
  const actionHintId = useId();
  const skuKey = JSON.stringify([...new Set(skus.map(s => s.trim()).filter(Boolean))]);
  const check = useCallback(async () => {
    if (dirty || !revision) return;
    if (skuKey === '[]') { setError('Nomor Referensi SKU kosong. Lengkapi file marketplace.'); return; }
    const token = ++pending.current; setLoading(true); setError(''); setData(null);
    try {
      const next = await diagnose(workspace,{ account,revision,skus: JSON.parse(skuKey) });
      if (!alive.current || token !== pending.current) return;
      setData(next); setSelected(old => Object.fromEntries(next.items.map(i => [i.sku,old[i.sku] ?? true])));
    } catch (e) { if (alive.current && token === pending.current) setError(e instanceof Error ? e.message : 'Data belum dapat diperiksa. Muat ulang data aplikasi.'); }
    finally { if (alive.current && token === pending.current) setLoading(false); }
  },[workspace,account,revision,skuKey,dirty,diagnose]);
  useEffect(() => { const requests = pending; alive.current = true; setData(null); setOutcome(null); setError(''); void check(); return () => { alive.current = false; requests.current++; }; },[check]);
  useEffect(() => { if (error || outcome) resultRef.current?.focus({ preventScroll: true }); },[error,outcome]);
  const locked = busy || working || loading || dirty;
  const canWrite = canSync && canManage;
  const items = data?.items || [];
  const candidates = items.filter(i => i.status === 'found' && i.bundles.length === 1 && !i.bundles[0].availableInBusiness && i.bundles[0].canShare);
  const chosen = candidates.filter(i => selected[i.sku] !== false);
  const allFound = items.length > 0 && items.every(i => i.status === 'found' && i.bundles.length === 1);
  const allAvailable = allFound && items.every(i => i.bundles[0].availableInBusiness);
  const uncertain = items.some(i => i.status === 'unavailable');
  const primarySync = !candidates.length && uncertain;
  const needsCatalog = !candidates.length && !primarySync && !allAvailable;
  const storeName = data?.stores.find(s => s.id === data.suggestedStoreId)?.name;
  const actionHint = !canSync ? 'Mode lokal · perubahan Scalev nonaktif'
    : !canManage ? 'Memerlukan izin pengelolaan katalog'
    : !chosen.length ? 'Pilih bundle untuk melanjutkan.'
    : `Sharing ke ${data?.business} berlaku global di Scalev.`;
  const bundleStatus = allFound ? items.length > 1 ? `${items.length} ditemukan` : 'Ditemukan'
    : uncertain ? 'Belum pasti'
    : items.some(i => i.status === 'ambiguous') ? 'Kode ganda'
    : items.every(i => i.status === 'missing') ? 'Belum tercatat'
    : `${items.filter(i => i.status === 'found').length}/${items.length} ditemukan`;
  async function run(mode: 'refresh' | 'share') {
    if (!canWrite || !data?.token || locked || actionPending.current || (mode === 'share' && !chosen.length)) return;
    const generation = pending.current;
    actionPending.current = true; setWorking(true); setError(''); setOutcome(null);
    try {
      const next = await repair({ token: data.token,mode,items: mode === 'share' ? chosen.map(i => ({ sku: i.sku,bundleId: i.bundles[0].id })) : [] });
      if (!alive.current || generation !== pending.current) return;
      setOutcome(next); await check();
    } catch (e) { if (alive.current && generation === pending.current) { setData(null); setError(e instanceof Error ? e.message : 'Hasil aksi belum pasti. Muat ulang data sebelum mencoba lagi.'); } }
    finally { actionPending.current = false; if (alive.current) setWorking(false); }
  }
  const reload = <button className={styles.secondary} disabled={locked || !revision || skuKey === '[]'} onClick={() => void check()}><RefreshCw size={14} aria-hidden="true"/>Muat ulang data aplikasi</button>;
  const sync = <button className={primarySync ? styles.primary : styles.secondary} disabled={!canWrite || locked || !data?.token} onClick={() => void run('refresh')}><RefreshCw size={14} aria-hidden="true"/>Sinkronkan Business dari Scalev</button>;
  const settings = <button className={!candidates.length && !primarySync && !needsCatalog && !storeName ? styles.primary : styles.secondary} disabled={locked} onClick={openSettings}>Atur mapping Produk / Store</button>;
  return <section className={styles.diagnosis} aria-label="Diagnosis bundle" aria-busy={loading || working}>
    <h3>Periksa masalah</h3>
    {dirty || !revision ? <p className={styles.warning}>Simpan atau batalkan perubahan aturan terlebih dahulu.</p> : null}
    {working ? <p role="status">Memproses bundle dan memvalidasi ulang batch…</p> : loading ? <div className={styles.diagnosisLoading} role="status">Memeriksa data aplikasi…<div aria-hidden="true"><span/><span/><span/></div></div> : null}
    {(error || outcome) && <div ref={resultRef} tabIndex={-1} role={error ? 'alert' : 'status'} className={error || !outcome?.synced || outcome.items.some(i => i.stage !== 'ready') ? styles.hint : styles.notice}>
      <div><p>{error || outcome?.message}</p>{outcome?.items.some(i => i.stage !== 'ready') ? <ul>{outcome.items.filter(i => i.stage !== 'ready').map(i => <li key={i.sku}><strong>{i.sku}</strong>: {i.message}</li>)}</ul> : null}</div></div>}
    {!data && !loading && reload}
    {data && <>
      {items.length === 1 && <p className={styles.diagnosisSku}>{items[0].sku}</p>}
      <div className={styles.diagnosisProgress} aria-label="Status Bundle, Business, dan Store" aria-live="polite">
        <StatusStep label="Bundle" value={bundleStatus} ready={allFound}/><ChevronRight className={styles.diagnosisArrow} size={16} aria-hidden="true"/>
        <StatusStep label="Business" value={data.business} ready={allAvailable} note={allAvailable ? 'Tersedia' : allFound ? 'Perlu sharing' : 'Belum pasti'}/><ChevronRight className={styles.diagnosisArrow} size={16} aria-hidden="true"/>
        <StatusStep label="Store" value={storeName || 'Perlu mapping'} ready={!!storeName} note={storeName ? 'Sesuai mapping Produk' : undefined}/>
      </div>
      {!!data.issues.length && <ul className={styles.issues}>{data.issues.map((issue,i) => <li key={i}>{issue}</li>)}</ul>}
      <div className={styles.diagnosisItems}>{items.map(item => {
        const bundle = item.bundles[0], candidate = candidates.some(i => i.sku === item.sku);
        if (items.length === 1 && item.status === 'found' && (bundle?.availableInBusiness || (candidate && selected[item.sku] !== false))) return null;
        return <section className={styles.diagnosisItem} key={item.sku} aria-label={`Diagnosis ${item.sku}`}>
          <div className={items.length === 1 && !candidate ? styles.srOnly : styles.diagnosisItemHeading}>
            {candidate && (items.length > 1 || selected[item.sku] === false) ? <label className={styles.check}><input type="checkbox" aria-label={`Pilih bundle ${item.sku}`} checked={selected[item.sku] ?? true} disabled={locked || !canWrite} onChange={e => setSelected(old => ({ ...old,[item.sku]: e.target.checked }))}/><span>{item.sku}</span></label> : items.length > 1 ? <h4>{item.sku}</h4> : null}
            {items.length > 1 && <span className={bundle?.availableInBusiness ? styles.diagnosisReady : styles.diagnosisPending}>{bundle?.availableInBusiness ? 'Tersedia di Business' : item.status === 'found' ? 'Perlu sharing' : item.status === 'missing' ? 'Belum tercatat' : item.status === 'ambiguous' ? 'Kode ganda' : 'Belum pasti'}</span>}
          </div>
          {item.status !== 'found' && <p className={styles.dim}>{item.message}</p>}
          {item.status === 'found' && bundle && !bundle.availableInBusiness && !bundle.canShare && <p className={styles.warning}>Pemilik belum terverifikasi. Sinkronkan katalog Business pemilik.</p>}
        </section>;
      })}</div>
      <div className={styles.diagnosisFooter}>
        <span className={styles.diagnosisPrice}><LockKeyhole size={14} aria-hidden="true"/>Harga marketplace {typeof orderTotalCents === 'number' && Number.isFinite(orderTotalCents) ? <strong>{price(orderTotalCents)}</strong> : null}</span>
        {!!candidates.length && <button className={styles.primary} aria-describedby={actionHintId} disabled={locked || !canWrite || !data.token || !chosen.length} onClick={() => void run('share')}><Share2 size={15} aria-hidden="true"/>{candidates.length === 1 ? `Bagikan ke Business ${data.business}` : `Bagikan ${chosen.length} bundle ke ${data.business}`}</button>}
        {primarySync && sync}
        {needsCatalog && <a className={styles.diagnosisCatalogLink} href="/dashboard/warehouse-settings?tab=catalog" target="_blank" rel="noopener noreferrer">Buka katalog Business <ExternalLink size={14} aria-hidden="true"/></a>}
        {!candidates.length && !primarySync && !needsCatalog && !storeName && settings}
      </div>
      {!!candidates.length && <p className={styles.diagnosisActionHint} id={actionHintId}>{actionHint}</p>}
      {!canSync && !candidates.length && <p className={styles.dim}>Mode lokal · perubahan Scalev nonaktif</p>}
      <details className={styles.diagnosisMore}>
        <summary>Detail &amp; aksi lain</summary>
        <dl className={styles.diagnosisMetadata}>
          <div><dt>Akun asal</dt><dd>{data.account}</dd></div>
          <div><dt>Data diperiksa</dt><dd>{new Date(data.checkedAt).toLocaleString('id-ID')}</dd></div>
          <div><dt>Sinkronisasi paling awal</dt><dd>{data.catalogSyncedAt ? new Date(data.catalogSyncedAt).toLocaleString('id-ID') : 'Belum tercatat'}</dd></div>
        </dl>
        {items.flatMap(item => item.bundles.map(b => <div key={`${item.sku}:${b.id}`} className={styles.bundleFinding}><span>{item.sku}</span><strong>{b.name}</strong><span>Pemilik: {b.owner} · Bundle #{b.id}</span><a href={`https://app.scalev.com/bundles/${b.id}`} target="_blank" rel="noopener noreferrer">Buka bundle di Scalev <ExternalLink size={12} aria-hidden="true"/></a></div>))}
        <div className={styles.actions}>{reload}{!primarySync && sync}{(candidates.length > 0 || primarySync || needsCatalog || storeName) && settings}</div>
      </details>
    </>}
  </section>;
}
