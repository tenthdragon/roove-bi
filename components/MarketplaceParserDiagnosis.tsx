'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, ExternalLink, LockKeyhole, Plus, RefreshCw } from 'lucide-react';
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
const price = (value: string) => new Intl.NumberFormat('id-ID',{ style: 'currency',currency: 'IDR',maximumFractionDigits: 2 }).format(Number(value));
function StatusStep({ label,value,ready,note }: { label: string; value: string; ready: boolean; note?: string }) {
  return <div className={`${styles.diagnosisStep} ${ready ? styles.diagnosisReady : styles.diagnosisPending}`}>
    {ready ? <CheckCircle2 size={18} aria-hidden="true"/> : <AlertCircle size={18} aria-hidden="true"/>}
    <div><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>
  </div>;
}
export default function MarketplaceParserDiagnosis({ workspace,account,revision,skus,canSync,canManage,busy,dirty,orderTotalCents,diagnose,repair,openSettings }: Props) {
  const [data,setData] = useState<ParserDiagnosis | null>(null), [error,setError] = useState('');
  const [loading,setLoading] = useState(false), [working,setWorking] = useState(false), [outcome,setOutcome] = useState<RepairResult | null>(null);
  const [storeId,setStoreId] = useState(0), [options,setOptions] = useState<Record<string,number>>({}), [selected,setSelected] = useState<Record<string,boolean>>({});
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
      setData(next); setStoreId(old => next.stores.some(s => s.id === old) ? old : next.suggestedStoreId || (next.stores.length === 1 ? next.stores[0].id : 0));
      setOptions(old => Object.fromEntries(next.items.map(i => [i.sku,i.bundles[0]?.options.some(o => o.id === old[i.sku]) ? old[i.sku] : i.bundles[0]?.options.length === 1 ? i.bundles[0].options[0].id : 0])));
      setSelected(old => Object.fromEntries(next.items.map(i => [i.sku,old[i.sku] ?? true])));
    } catch (e) { if (alive.current && token === pending.current) setError(e instanceof Error ? e.message : 'Data belum dapat diperiksa. Muat ulang data aplikasi.'); }
    finally { if (alive.current && token === pending.current) setLoading(false); }
  },[workspace,account,revision,skuKey,dirty,diagnose]);
  useEffect(() => { const requests = pending; alive.current = true; void check(); return () => { alive.current = false; requests.current++; }; },[check]);
  useEffect(() => { if (error || outcome) resultRef.current?.focus({ preventScroll: true }); },[error,outcome]);
  const locked = busy || working || loading || dirty;
  const canWrite = canSync && canManage;
  const items = data?.items || [];
  const candidates = items.filter(i => i.status === 'found' && i.bundles.length === 1 && !i.bundles[0].installedStoreIds.includes(storeId) && (i.bundles[0].availableInBusiness || i.bundles[0].canShare) && i.bundles[0].options.length);
  const chosen = candidates.length === 1 ? candidates : candidates.filter(i => selected[i.sku]);
  const sharing = chosen.some(i => !i.bundles[0].availableInBusiness);
  const allFound = items.length > 0 && items.every(i => i.status === 'found' && i.bundles.length === 1);
  const allAvailable = allFound && items.every(i => i.bundles[0].availableInBusiness);
  const uncertain = items.some(i => i.status === 'unavailable') || !!data?.issues.length;
  const installedCount = items.filter(i => i.status === 'found' && i.bundles[0]?.installedStoreIds.includes(storeId)).length;
  const allInstalled = allAvailable && !!storeId && installedCount === items.length && !uncertain;
  const unknownOptions = items.some(i => i.status === 'found' && !i.bundles[0]?.installedStoreIds.includes(storeId) && i.bundles[0]?.optionsSynced === false);
  const primarySync = !candidates.length && unknownOptions && !uncertain;
  const missing = items.some(i => i.status === 'missing');
  const storeName = data?.stores.find(s => s.id === storeId)?.name;
  const actionHint = !canSync ? 'Mode lokal · perubahan Scalev nonaktif'
    : !canManage ? 'Memerlukan izin pengelolaan katalog'
    : !storeId ? 'Pilih Store untuk melanjutkan.'
    : !chosen.length ? 'Pilih bundle untuk melanjutkan.'
    : chosen.some(i => !options[i.sku]) ? 'Pilih opsi harga untuk melanjutkan.'
    : sharing ? `${[...new Set(chosen.filter(i => !i.bundles[0].availableInBusiness).map(i => i.bundles[0].owner))].join(', ')} → ${data?.business} · berlaku global di Scalev`
    : 'Ke Scalev · berlaku global';
  const bundleStatus = allFound ? items.length > 1 ? `${items.length} ditemukan` : 'Ditemukan'
    : items.some(i => i.status === 'unavailable') ? 'Belum pasti'
    : items.some(i => i.status === 'ambiguous') ? 'Kode ganda'
    : items.every(i => i.status === 'missing') ? 'Belum tercatat'
    : `${items.filter(i => i.status === 'found').length}/${items.length} ditemukan`;
  async function run(mode: 'refresh' | 'attach') {
    if (!canSync || !data?.token || !storeId || locked || actionPending.current || (mode === 'attach' && !canWrite)) return;
    const selectedItems = chosen.map(i => ({ sku: i.sku,bundleId: i.bundles[0].id,optionId: options[i.sku],share: !i.bundles[0].availableInBusiness }));
    if (mode === 'attach' && (!selectedItems.length || selectedItems.some(i => !i.optionId))) return;
    actionPending.current = true; setWorking(true); setError(''); setOutcome(null);
    try {
      const next = await repair({ token: data.token,storeId,mode,items: mode === 'attach' ? selectedItems : [] });
      if (!alive.current) return;
      setOutcome(next); await check();
    } catch (e) { if (alive.current) { setData(null); setError(e instanceof Error ? e.message : 'Hasil aksi belum pasti. Muat ulang data sebelum mencoba lagi.'); } }
    finally { actionPending.current = false; if (alive.current) setWorking(false); }
  }
  const reload = <button className={styles.secondary} disabled={locked || !revision || skuKey === '[]'} onClick={() => void check()}><RefreshCw size={14} aria-hidden="true"/>Muat ulang data aplikasi</button>;
  const sync = <button className={primarySync ? styles.primary : styles.secondary} disabled={!canSync || locked || !storeId || !data?.token} onClick={() => void run('refresh')}><RefreshCw size={14} aria-hidden="true"/>Sinkronkan Store dari Scalev</button>;
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
        <StatusStep label="Store" value={allInstalled ? 'Terpasang' : !storeId ? 'Belum dipilih' : uncertain || !allFound ? 'Belum pasti' : items.length > 1 ? `${installedCount}/${items.length} terpasang` : 'Belum terpasang'} ready={allInstalled}/>
      </div>
      {!!data.issues.length && <ul className={styles.issues}>{data.issues.map((issue,i) => <li key={i}>{issue}</li>)}</ul>}
      <div className={`${styles.diagnosisFields} ${items.length === 1 && storeId > 0 && candidates.length === 1 ? styles.diagnosisFieldsSplit : ''}`}>
      <div className={styles.diagnosisDestination}>
        {data.stores.length === 1 ? <div className={styles.diagnosisStore}><span>Store {data.business}</span><strong>{storeName || data.stores[0].name}</strong></div>
          : data.stores.length > 1 ? <label>Store {data.business}<select aria-label="Store untuk pemasangan bundle" value={storeId} disabled={locked} onChange={e => setStoreId(Number(e.target.value))}><option value={0}>Pilih Store…</option>{data.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          : <p className={styles.warning}>Store belum tersedia. Periksa aturan atau sinkronisasi.</p>}
      </div>
      {!(items.length === 1 && candidates.length === 1 && !storeId) && <div className={styles.diagnosisItems}>{items.map(item => {
        const bundle = item.bundles[0], installed = !!storeId && bundle?.installedStoreIds.includes(storeId) && !uncertain;
        const candidate = candidates.some(i => i.sku === item.sku);
        return <section className={styles.diagnosisItem} key={item.sku} aria-label={`Diagnosis ${item.sku}`}>
          <div className={items.length === 1 ? styles.srOnly : styles.diagnosisItemHeading}>
            {storeId > 0 && candidate && candidates.length > 1 ? <label className={styles.check}><input type="checkbox" aria-label={`Pilih bundle ${item.sku}`} checked={selected[item.sku] ?? true} disabled={locked || !canWrite} onChange={e => setSelected(old => ({ ...old,[item.sku]: e.target.checked }))}/><span>{item.sku}</span></label> : <h4>{item.sku}</h4>}
            {items.length > 1 && <span className={installed ? styles.diagnosisReady : styles.diagnosisPending}>{installed ? 'Terpasang' : item.status === 'missing' ? 'Belum tercatat' : item.status === 'ambiguous' ? 'Kode ganda' : item.status === 'unavailable' || uncertain ? 'Belum pasti' : 'Perlu dilengkapi'}</span>}
          </div>
          {item.status !== 'found' && <p className={styles.dim}>{item.message}</p>}
          {item.status === 'found' && bundle && !installed && <>
            {!bundle.availableInBusiness && !bundle.canShare && <p className={styles.warning}>Pemilik belum terverifikasi. Sinkronkan katalog Business pemilik.</p>}
            {!bundle.options.length && <p className={styles.warning}>{bundle.optionsSynced === false ? 'Pilihan harga belum tersinkron.' : 'Tidak ada opsi harga aktif. Lengkapi di Scalev.'}</p>}
            {storeId > 0 && candidate && (bundle.options.length === 1
              ? <div className={styles.diagnosisOption}><span>Opsi harga Scalev</span><strong>{bundle.options[0].name} · {price(bundle.options[0].price)}</strong></div>
              : <label className={styles.diagnosisOption}>Opsi harga Scalev<select aria-label={`Opsi harga Scalev · ${item.sku}`} value={options[item.sku] || 0} disabled={locked || !canWrite} onChange={e => setOptions(old => ({ ...old,[item.sku]: Number(e.target.value) }))}><option value={0}>Pilih opsi…</option>{bundle.options.map(o => <option key={o.id} value={o.id}>{o.name} · {price(o.price)} · #{o.id}</option>)}</select></label>)}
          </>}
        </section>;
      })}</div>}
      </div>
      <div className={styles.diagnosisFooter}>
        <span className={styles.diagnosisPrice}><LockKeyhole size={14} aria-hidden="true"/>Harga order {typeof orderTotalCents === 'number' && Number.isFinite(orderTotalCents) ? <strong>{price(String(orderTotalCents / 100))}</strong> : null}<span>tetap</span></span>
        {!!candidates.length && <button className={styles.primary} aria-describedby={actionHintId} disabled={locked || !canWrite || !storeId || !data.token || !chosen.length || chosen.some(i => !options[i.sku])} onClick={() => void run('attach')}><Plus size={15} aria-hidden="true"/>{candidates.length === 1 ? sharing ? 'Bagikan & tambahkan ke Store' : 'Tambahkan ke Store' : `${sharing ? 'Bagikan & tambahkan' : 'Tambahkan'} ${chosen.length} bundle ke Store`}</button>}
        {primarySync && sync}
        {!candidates.length && !primarySync && missing && <a className={styles.diagnosisCatalogLink} href="/dashboard/warehouse-settings?tab=catalog" target="_blank" rel="noopener noreferrer">Buka katalog Business <ExternalLink size={14} aria-hidden="true"/></a>}
        {!candidates.length && !primarySync && !missing && !data.stores.length && <button className={styles.secondary} disabled={locked} onClick={openSettings}>Atur routing / kombinasi / Warehouse</button>}
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
        <p className={styles.dim}>Pemasangan berlaku global di Scalev. Routing dan harga order tidak diubah.</p>
        <div className={styles.actions}>{reload}{!primarySync && sync}{(candidates.length > 0 || primarySync || missing || data.stores.length > 0) && <button className={styles.secondary} disabled={locked} onClick={openSettings}>Atur routing / kombinasi / Warehouse</button>}</div>
      </details>
    </>}
  </section>;
}
