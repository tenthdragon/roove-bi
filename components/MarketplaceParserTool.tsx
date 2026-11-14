'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Download, FileSpreadsheet, RefreshCw, Settings2, Upload } from 'lucide-react';
import { projectMarketplace, exportBusinessCsv, orderReady } from '@/lib/marketplace-parser/project';
import { validateCatalogConfig } from '@/lib/marketplace-parser/config';
import { CSV_HEADERS, type Catalog, type ParsedFile, type ParserBatch, type ParserBatchSummary, type ParserExport, type ParserConfig, type ParserContext, type PreviewOrder } from '@/lib/marketplace-parser/types';
import MarketplaceParserConfig from './MarketplaceParserConfig';
import MarketplaceParserStorePicker from './MarketplaceParserStorePicker';
import MarketplaceParserBundleStatus from './MarketplaceParserBundleStatus';
import MarketplaceParserArchive, { archiveUrl } from './MarketplaceParserArchive';
import type { DiagnosisRequest, ParserDiagnosis, RepairRequest, RepairResult } from '@/lib/marketplace-parser/diagnosis-types';
import styles from './MarketplaceParserTool.module.css';

type Props = {
  context: ParserContext;
  diagnoseCase?: (workspace: string,input: DiagnosisRequest) => Promise<ParserDiagnosis>;
  repairCase?: (workspace: string,input: RepairRequest) => Promise<{ result: RepairResult; catalog: Catalog }>;
  saveConfig: (workspace: string,revision: number,config: ParserConfig) => Promise<{ workspaceId: string; revision: number }>;
  loadCatalog: (workspace: string,storeIds: number[],businessCodes?: string[]) => Promise<Catalog>;
  syncBusiness: (workspace: string,businessCode: string) => Promise<unknown>;
  reloadContext: (workspace: string) => Promise<ParserContext>;
  prepareDownload: (workspace: string,input: { batchId: string; revision: number; catalogVersion: string }) => Promise<{ business: string; csv: string; exportId?: string }>;
  uploadSource: (workspace:string,file:File,account:string,date:string)=>Promise<ParserBatch>;
  listBatches: (workspace:string,offset:number)=>Promise<ParserBatchSummary[]>;
  listExports: (workspace:string,batchId:string)=>Promise<ParserExport[]>;
  openBatch: (workspace:string,id:string)=>Promise<ParserBatch>;
  approveStore: (workspace:string,input:{batchId:string;orderKey:string;storeId:number;revision:number;catalogVersion:string;previousDecisionId:string|null})=>Promise<ParserContext>;
};
const money = (cents: number) => new Intl.NumberFormat('id-ID',{ style: 'currency',currency: 'IDR',maximumFractionDigits: 2 }).format(cents / 100);
const emptyEdits = () => ({ lines: {}, orders: {} });
function saveText(text: string,name: string,type: string) {
  const url = URL.createObjectURL(new Blob([text],{ type })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
export default function MarketplaceParserTool({ context,saveConfig,loadCatalog,syncBusiness,reloadContext,prepareDownload,diagnoseCase,repairCase,uploadSource,listBatches,listExports,openBatch,approveStore }: Props) {
  const [config,setConfig] = useState(context.config), [draft,setDraft] = useState(context.config), [revision,setRevision] = useState(context.revision);
  const [catalog,setCatalog] = useState(context.catalog), [migrationNotes,setMigrationNotes] = useState(context.migrationNotes);
  const [configOpen,setConfigOpen] = useState(!context.config.accounts.length || !!context.migrationNotes.length);
  const [account,setAccount] = useState(context.config.accounts[0]?.id || '');
  const [date,setDate] = useState(() => new Intl.DateTimeFormat('en-CA',{ timeZone: 'Asia/Jakarta',year: 'numeric',month: '2-digit',day: '2-digit' }).format(new Date()));
  const [file,setFile] = useState<ParsedFile | null>(null), [batch,setBatch] = useState<ParserBatch|null>(null);
  const [archiveOpen,setArchiveOpen]=useState(false),[lastExport,setLastExport]=useState('');
  const edits=useMemo(emptyEdits,[]);
  const [reading,setReading] = useState(false), [saving,setSaving] = useState(false), [loadingCatalog,setLoadingCatalog] = useState(false), [syncing,setSyncing] = useState(false), [downloading,setDownloading] = useState(false);
  const [error,setError] = useState(''), [notice,setNotice] = useState(''), [catalogError,setCatalogError] = useState(false);
  const [search,setSearch] = useState(''), [status,setStatus] = useState('all'), [page,setPage] = useState(0), [expanded,setExpanded] = useState<string | null>(null);
  const [showCsv,setShowCsv] = useState(false), [reviewed,setReviewed] = useState(false), [downloaded,setDownloaded] = useState(false);
  const [repairing,setRepairing] = useState(false);
  const request = useRef(0), catalogRequest = useRef(0), mounted = useRef(true);
  const errorSummary = useRef<HTMLDivElement>(null);
  const settingsSection = useRef<HTMLElement>(null);
  const dirty = JSON.stringify(config) !== JSON.stringify(draft);
  const storeKey = [...draft.stores.map(s => s.storeId)].sort((a,b) => a - b).join(',');
  const businessKey = JSON.stringify([...new Set(draft.accounts.map(a => a.business).filter(Boolean))].sort());
  const loadedBusinessKey = JSON.stringify([...catalog.loadedBusinessCodes].sort());
  const loadedKey = [...catalog.loadedStoreIds].sort((a,b) => a - b).join(',');
  const busy = reading || saving || loadingCatalog || syncing || downloading || repairing;
  function changed() { setReviewed(false); setDownloaded(false); setLastExport(''); setNotice(''); }
  function openSettings() { setConfigOpen(true); requestAnimationFrame(() => { settingsSection.current?.focus({ preventScroll: true }); settingsSection.current?.scrollIntoView({ block: 'start',behavior: 'auto' }); }); }
  async function repairOrder(input: RepairRequest) {
    if (!repairCase) throw new Error('Perbaikan katalog belum tersedia.');
    setRepairing(true); setError(''); changed();
    try {
      const next = await repairCase(context.workspaceId,input);
      if (mounted.current) {
        setCatalog(next.catalog); setCatalogError(!next.result.synced);
        if (next.result.synced && next.result.items.every(i => i.stage === 'ready')) setNotice(next.result.message);
        else setError(next.result.message);
      }
      return next.result;
    } catch (e) { if (mounted.current) setCatalogError(true); throw e; }
    finally { if (mounted.current) setRepairing(false); }
  }
  useEffect(() => {
    const fileRequests = request, catalogRequests = catalogRequest;
    mounted.current = true;
    return () => { mounted.current = false; fileRequests.current++; catalogRequests.current++; };
  },[]);
  useEffect(() => {
    if (storeKey === loadedKey && businessKey === loadedBusinessKey) return;
    const pending = catalogRequest, token = ++pending.current; setLoadingCatalog(true); setCatalogError(false); setReviewed(false);
    loadCatalog(context.workspaceId,storeKey ? storeKey.split(',').map(Number) : [],JSON.parse(businessKey)).then(result => {
      if (mounted.current && token === catalogRequest.current) setCatalog(result);
    }).catch(e => { if (mounted.current && token === catalogRequest.current) { setCatalogError(true); setError(e instanceof Error ? e.message : 'Katalog belum dapat dimuat.'); } }).finally(() => { if (mounted.current && token === catalogRequest.current) setLoadingCatalog(false); });
    return () => { pending.current++; };
    // Reload when destination scope or receiving Businesses change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[storeKey,businessKey,loadCatalog,context.workspaceId]);
  const result = useMemo(() => {
    if (!file) return { projection: null,error: '' };
    try { if(batch && (batch.business!==config.accounts.find(a=>a.id===batch.account)?.business || batch.account!==account)) throw new Error('Akun atau Business batch berubah. Upload ulang dengan akun yang benar.'); return { projection: projectMarketplace({ file,account,date,config,revision,catalog,edits }),error: '' }; }
    catch (e) { return { projection: null,error: e instanceof Error ? e.message : 'Parsing gagal.' }; }
  },[file,account,date,config,revision,catalog,edits,batch]);
  useEffect(() => {
    if (!error && !result.error) return;
    errorSummary.current?.focus({ preventScroll: true });
    errorSummary.current?.scrollIntoView({ block: 'center',behavior: 'auto' });
  },[error,result.error]);
  const projection = result.projection, orders = projection?.orders || [], ready = orders.filter(orderReady), blocked = orders.length - ready.length;
  const selectedAccount = config.accounts.find(a => a.id === account);
  const configurationReady = revision > 0 && !migrationNotes.length;
  const canReview = !!orders.length && !blocked && !busy && !dirty && !catalogError && configurationReady;
  const visible = orders.filter(o => (status !== 'blocked' || !orderReady(o)) && (status !== 'ready' || orderReady(o)) && `${o.source.externalId} ${o.source.username} ${o.source.tracking} ${o.courier} ${o.store} ${o.business} ${o.lines.map(l => `${l.sku} ${l.source.name} ${l.bundleName}`).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const currentPage = Math.min(page,Math.max(0,Math.ceil(visible.length / 25) - 1)), shown = visible.slice(currentPage * 25,currentPage * 25 + 25);
  function changeDraft(next: ParserConfig) { setDraft(next); changed(); }
  async function refreshCatalog() {
    const token = ++catalogRequest.current; setLoadingCatalog(true); setError(''); changed();
    try { const next = await loadCatalog(context.workspaceId,draft.stores.map(s => s.storeId),JSON.parse(businessKey)); if (mounted.current && token === catalogRequest.current) { setCatalog(next); setCatalogError(false); setNotice('Katalog dimuat ulang. Periksa preview terbaru sebelum download.'); } }
    catch (e) { if (mounted.current && token === catalogRequest.current) { setCatalogError(true); setError(e instanceof Error ? e.message : 'Katalog belum dapat dimuat.'); } }
    finally { if (mounted.current && token === catalogRequest.current) setLoadingCatalog(false); }
  }
  async function synchronize() {
    if (!context.canSync || !context.canManageCatalog) return;
    setSyncing(true); setError(''); changed();
    try {
      const businesses: string[] = JSON.parse(businessKey);
      for (const [index,business] of businesses.entries()) { if (!mounted.current) return; setNotice(`Menyinkronkan Business ${business} (${index + 1}/${businesses.length})…`); await syncBusiness(context.workspaceId,business); }
      if (mounted.current) await refreshCatalog();
    } catch (e) {
      if (mounted.current) { setCatalogError(true); setError(e instanceof Error ? e.message : 'Sinkronisasi belum berhasil.'); setNotice(''); }
    } finally { if (mounted.current) setSyncing(false); }
  }
  async function reloadSettings() {
    setSaving(true); changed(); setError('');
    try { const next = await reloadContext(context.workspaceId); if (!mounted.current) return; setConfig(next.config); setDraft(next.config); setRevision(next.revision); setCatalog(next.catalog); setMigrationNotes(next.migrationNotes); setCatalogError(false); if (!next.config.accounts.some(a => a.id === account)) setAccount(next.config.accounts[0]?.id || ''); setNotice('Aturan tim dimuat ulang. Preview perlu diperiksa kembali.'); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Aturan belum dapat dimuat.'); }
    finally { if (mounted.current) setSaving(false); }
  }
  async function read(fileInput: File | undefined) {
    if (!fileInput) return; const token = ++request.current; setReading(true); setError(''); changed();
    try {
      if (!/\.xlsx$/i.test(fileInput.name) || fileInput.size > 10 * 1024 * 1024) throw new Error('Pilih file .xlsx marketplace, maksimal 10 MB.');
      const archived=await uploadSource(context.workspaceId,fileInput,account,date);
      if (!mounted.current || token !== request.current) return;
      setBatch(archived);setFile(archived.file);setAccount(archived.account);setDate(archived.date);setExpanded(null);setPage(0);setNotice('File asli berhasil diarsipkan.');
    } catch (e) { if (mounted.current && token === request.current) setError(`${e instanceof Error ? e.message : 'File tidak dapat dibaca.'}${file ? ' Preview sebelumnya tetap ditampilkan; periksa nama file sebelum melanjutkan.' : ''}`); }
    finally { if (mounted.current && token === request.current) setReading(false); }
  }
  async function applyConfig() {
    setError(''); setSaving(true); changed();
    try {
      validateCatalogConfig(draft,catalog);
      const saved = await saveConfig(context.workspaceId,revision,draft);
      if (!mounted.current) return;
      if (saved.workspaceId !== context.workspaceId) throw new Error('Workspace berubah. Muat ulang halaman.');
      setRevision(saved.revision); setConfig(structuredClone(draft)); setMigrationNotes([]);
      if (!draft.accounts.some(a => a.id === account)) setAccount(draft.accounts[0]?.id || '');
      const next = await loadCatalog(context.workspaceId,draft.stores.map(s => s.storeId),JSON.parse(businessKey));
      if (!mounted.current) return;
      setCatalog(next); setCatalogError(false); setNotice('Konfigurasi tim tersimpan. Tujuan dan validasi batch diperbarui otomatis.'); setConfigOpen(false);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Konfigurasi belum dapat disimpan.'); }
    finally { if (mounted.current) setSaving(false); }
  }
  async function download() {
    if (!projection || !file || !batch || !reviewed || !canReview || !selectedAccount) return;
    setDownloading(true); setError('');
    try {
      const prepared = await prepareDownload(context.workspaceId,{ batchId:batch.id,revision,catalogVersion: catalog.version });
      if (!mounted.current) return;
      if (prepared.business !== selectedAccount.business || prepared.csv !== exportBusinessCsv(projection,selectedAccount.business)) throw new Error('Hasil validasi berubah dari preview. Muat ulang katalog dan periksa kembali.');
      saveText(prepared.csv,`scalev-${selectedAccount.label.replace(/[^a-z0-9_-]/gi,'_')}-${prepared.business}-${date}.csv`,'text/csv;charset=utf-8');
      setDownloaded(true);setLastExport(prepared.exportId||''); setNotice(`CSV ${prepared.business} diunduh setelah validasi ulang. Upload ke Business ${prepared.business} di Scalev.`);
    } catch (e) { if (mounted.current) { setReviewed(false); setError(e instanceof Error ? e.message : 'Download belum dapat diproses.'); } }
    finally { if (mounted.current) setDownloading(false); }
  }
  async function loadBatch(id:string){
    setReading(true);changed();setError('');
    try{const archived=await openBatch(context.workspaceId,id);if(!mounted.current)return;setBatch(archived);setFile(archived.file);setAccount(archived.account);setDate(archived.date);setExpanded(null);setPage(0);setArchiveOpen(false);await refreshCatalog();}
    finally{if(mounted.current)setReading(false);}
  }
  async function saveStore(order:PreviewOrder,storeId:number){
    if(!batch)return;setSaving(true);changed();
    try{const next=await approveStore(context.workspaceId,{batchId:batch.id,orderKey:order.source.key,storeId,revision,catalogVersion:catalog.version,previousDecisionId:order.routing?.decisionId||null});if(!mounted.current)return;setCatalog(next.catalog);setNotice('Keputusan Store tersimpan. Seluruh batch divalidasi ulang.');}
    finally{if(mounted.current)setSaving(false);}
  }
  return <div className={styles.page}>
    <header className={styles.header}><div><h1>Marketplace Data Parser</h1><p>File marketplace tetap utuh. Cocokkan bundle, tetapkan Store, lalu download CSV Scalev.</p></div><button className={styles.secondary} disabled={busy} onClick={() => setConfigOpen(v => !v)} aria-expanded={configOpen}><Settings2 size={16}/>Aturan parsing</button><button className={styles.secondary} onClick={()=>setArchiveOpen(v=>!v)} aria-expanded={archiveOpen}>Riwayat batch</button></header>
    {archiveOpen&&<MarketplaceParserArchive key={batch?.id||'history'} workspace={context.workspaceId} busy={busy} list={listBatches} listExports={listExports} open={loadBatch}/>}
    <ol className={styles.steps} aria-label="Alur parsing"><li aria-current={!file ? 'step' : undefined}>Upload XLSX</li><li aria-current={file && !reviewed ? 'step' : undefined}>Validasi hasil</li><li aria-current={reviewed ? 'step' : undefined}>Download CSV Scalev</li></ol>
    {(error || result.error) && <div ref={errorSummary} tabIndex={-1} className={styles.error} role="alert"><AlertCircle size={18}/><span>{error || result.error}</span></div>}
    {notice && <div className={styles.notice} role="status">{notice}</div>}
    {!!migrationNotes.length && <div className={styles.hint}><AlertCircle size={18}/><div>{migrationNotes.map(note => <p key={note}>{note}</p>)}</div></div>}
    {dirty && <div className={styles.hint} role="status">Ada perubahan aturan yang belum disimpan. Simpan untuk tim sebelum melanjutkan download.</div>}
    {configOpen && <section ref={settingsSection} tabIndex={-1} className={styles.section} aria-label="Konfigurasi parser"><div className={styles.sectionHeading}><div><h2>Aturan parsing</h2><p>Berlaku bersama untuk tim · versi {revision || 'belum disimpan'}. Perubahan akan memvalidasi ulang batch yang sedang dibuka.</p></div><button className={styles.secondary} disabled={busy || dirty} onClick={reloadSettings}><RefreshCw size={15}/>Muat ulang aturan</button></div>
      <fieldset className={styles.configFieldset} disabled={busy}><MarketplaceParserConfig config={draft} setConfig={changeDraft} catalog={catalog} busy={busy} canSync={context.canSync && !!context.canManageCatalog} refresh={refreshCatalog} sync={synchronize}/></fieldset>
      {loadingCatalog && <p className={styles.loading} role="status">Memuat katalog Business…</p>}
      <div className={styles.actions}>{!context.canSave && <p role="status">Penyimpanan aturan belum tersedia. Hubungi pengelola aplikasi.</p>}<button className={styles.secondary} disabled={busy || !dirty} onClick={() => { setDraft(structuredClone(config)); changed(); }}>Batalkan perubahan</button><button className={styles.primary} disabled={busy || !context.canSave} onClick={applyConfig}>{saving ? 'Menyimpan…' : 'Simpan konfigurasi tim'}</button></div>
    </section>}
    <section className={styles.section} aria-label="Upload marketplace"><div className={styles.upload}>
      <label>Akun marketplace asal<select value={account} disabled={busy} onChange={e => { setAccount(e.target.value);setBatch(null);setFile(null); changed(); }}><option value="">Pilih akun asal</option>{config.accounts.map(a => <option key={a.id} value={a.id}>{a.label} · {a.business || 'Business belum ditetapkan'}</option>)}</select></label>
      <label>Tanggal batch<input type="date" value={date} disabled={busy||!!batch} onChange={e => { setDate(e.target.value); changed(); }}/></label>
      <label className={styles.fileLabel}><span><Upload size={16}/>{reading ? 'Mengarsipkan file…' : 'Pilih file marketplace'}</span><input type="file" accept=".xlsx" disabled={busy || !account} onChange={e => { void read(e.target.files?.[0]); e.target.value = ''; }}/><small>XLSX · maksimal 10 MB</small></label>
    </div>{selectedAccount && <p className={styles.accountContext}>Business tujuan: <strong>{selectedAccount.business || 'belum ditetapkan'}</strong> · Store mengikuti keputusan tersimpan dan katalog.</p>}
      {file ? <div className={styles.fileInfo}><FileSpreadsheet size={17}/><strong>{file.filename}</strong>{batch&&<><span className={styles.good}>Diarsipkan</span><a href={archiveUrl(context.workspaceId,batch.id)}>File asli</a><button className={styles.linkButton} disabled={busy} onClick={()=>{setBatch(null);setFile(null);changed();}}>Batch baru</button></>}<span>{file.orders.length} order · {file.orders.reduce((n,o) => n + o.lines.length,0)} item</span><small>Sheet: {file.sheets.join(', ')}</small>{!!file.ignoredSheets.length && <details><summary>Sheet tidak diproses ({file.ignoredSheets.length})</summary><span>{file.ignoredSheets.join(', ')}</span></details>}</div> : <div className={styles.empty}><FileSpreadsheet size={28}/><h2>{config.accounts.length ? 'Mulai dari file asli marketplace' : 'Atur akun dan Store terlebih dahulu'}</h2><p>{config.accounts.length ? 'Pilih akun asal lalu upload export marketplace. Setiap SKU harus cocok dengan bundle yang tersedia di Business tujuan.' : 'Tambahkan akun, tetapkan Business, lalu pilih Store yang digunakan pada aturan parsing.'}</p></div>}
    </section>
    {projection && <>
      <section className={styles.section} aria-label="Preview CSV Scalev"><div className={styles.sectionHeading}><div><h2>Hasil parsing</h2><p>Konfigurasi versi {revision || 'belum disimpan'} · Data sumber hanya-baca.</p></div><div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={refreshCatalog}><RefreshCw size={15}/>Muat ulang katalog</button><button className={styles.secondary} onClick={() => setShowCsv(v => !v)} aria-pressed={showCsv}>{showCsv ? 'Tampilan order' : 'Lihat kolom CSV'}</button></div></div>
        <div className={styles.summary}><span><strong>{ready.length}</strong> order valid</span><span className={blocked ? styles.warning : ''}><strong>{blocked}</strong> perlu diselesaikan</span><span><strong>{money(orders.reduce((n,o) => n + o.totalCents,0))}</strong> total terhitung{blocked ? ' (belum final)' : ''}</span></div>
        <div className={styles.toolbar}><label className={styles.search}>Cari order, SKU, bundle, atau Store<input type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Cari hasil parsing…"/></label><label>Status<select value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="all">Semua order</option><option value="blocked">Perlu diselesaikan</option><option value="ready">Valid</option></select></label></div>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Tabel hasil parsing, geser untuk melihat kolom"><table><caption className={styles.srOnly}>Hasil parsing CSV Scalev, {visible.length} order sesuai filter.</caption>
          {showCsv ? <><thead><tr>{CSV_HEADERS.map(h => <th key={h}>{h}</th>)}</tr></thead>{shown.map(o => <tbody key={o.source.key}>{o.rows.map((row,i) => <tr key={i}>{CSV_HEADERS.map(h => <td key={h}>{row[h] || '—'}</td>)}</tr>)}</tbody>)}</> : <><thead><tr><th>Order marketplace</th><th>SKU / bundle Scalev</th><th className={styles.number}>Qty</th><th className={styles.number}>Harga satuan</th><th className={styles.number}>Total</th><th>Store tujuan</th><th>Validasi</th></tr></thead>{shown.map(order => <tbody key={order.source.key}>{order.lines.map((line,index) => <tr key={line.source.key}>
            {index === 0 && <td rowSpan={order.lines.length}><strong className={styles.identifier}>{order.source.externalId}</strong><small>{order.source.platform} · {order.source.username || 'Username kosong'}</small><small>Resi {order.source.tracking || 'belum tersedia'}</small><small>{order.courier ? `${order.courier} · ${order.service}` : 'Kurir belum dipetakan'}</small><small title="Kurir asli dari file marketplace">Sumber: {order.source.provider}{order.source.platform === 'tiktokshop' && order.source.lines[0]?.raw['Delivery Option'] && ` · ${order.source.lines[0].raw['Delivery Option']}`}</small><button className={styles.linkButton} aria-expanded={expanded === order.source.key} onClick={() => setExpanded(expanded === order.source.key ? null : order.source.key)}><ChevronDown size={14}/>Detail</button></td>}
            <td className={styles.product}><strong>{line.sku || 'Nomor Referensi SKU kosong'}</strong>{line.bundleName || line.source.name}{line.bundleId ? <small>Bundle #{line.bundleId}</small> : line.sku&&diagnoseCase&&repairCase ? <MarketplaceParserBundleStatus workspace={context.workspaceId} account={account} revision={revision} sku={line.sku} version={catalog.version} busy={busy} canManage={!!context.canManageCatalog && context.canSync} diagnose={diagnoseCase} repair={repairOrder}/> : <small>Bundle belum cocok.</small>}{line.productIds.length > 0 && <small>{line.productIds.map(id => config.groups.find(g => g.id === id)?.name).join(' + ')}</small>}</td>
            <td className={styles.number}>{line.quantity ?? '—'}</td><td className={styles.number}>{line.unitCents === null ? '—' : money(line.unitCents)}</td><td className={styles.number}>{line.totalCents === null ? '—' : money(line.totalCents)}</td>
            {index === 0 && <><td rowSpan={order.lines.length}><strong>{order.business || 'Business akun belum ditetapkan'}</strong>{order.routing?.caseKey&&<MarketplaceParserStorePicker key={`${account}:${order.source.key}:${catalog.version}`} order={order} stores={catalog.stores.filter(s=>s.business===order.business&&config.stores.some(scope=>scope.storeId===s.id))} history={(catalog.decisions||[]).filter(d=>d.account===account&&d.business===order.business&&d.caseKey===order.routing?.caseKey)} busy={busy||dirty} onSave={storeId=>saveStore(order,storeId)}/>}<small>{order.store?order.warehouse||'Warehouse belum dipilih':''}</small></td><td rowSpan={order.lines.length}><span className={orderReady(order) ? styles.good : styles.bad}>{orderReady(order) ? <CheckCircle2 size={14}/> : <AlertCircle size={14}/ >}{orderReady(order) ? 'Valid' : 'Download diblokir'}</span><small>{order.errors[0] || line.errors[0] || (order.warnings.length ? `${order.warnings.length} catatan sumber` : '')}</small></td></>}
          </tr>)}{expanded === order.source.key && <tr><td colSpan={7} className={styles.detailCell}><OrderDetails order={order} openSettings={openSettings}/></td></tr>}</tbody>)}</>}
        </table>{!shown.length && <p className={styles.noResults}>Tidak ada order yang sesuai filter.</p>}</div>
        <div className={styles.pagination}><span>{visible.length ? currentPage * 25 + 1 : 0}–{Math.min((currentPage + 1) * 25,visible.length)} dari {visible.length} order</span><button className={styles.secondary} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Sebelumnya</button><button className={styles.secondary} disabled={(currentPage + 1) * 25 >= visible.length} onClick={() => setPage(currentPage + 1)}>Berikutnya</button></div>
      </section>
      <section className={styles.export}><div><h2>Download untuk Scalev</h2><p>{blocked ? `${blocked} order belum valid. Seluruh file diblokir sampai semua bundle, kode, dan tujuan terselesaikan.` : `${orders.length} order valid. Business tujuan: ${selectedAccount?.business || 'belum ditetapkan'}.`}</p>{!configurationReady && <p>Simpan konfigurasi tim terlebih dahulu.</p>}</div>
        <label className={styles.check}><input aria-label="Konfirmasi hasil parsing" type="checkbox" checked={reviewed} disabled={!canReview} onChange={e => setReviewed(e.target.checked)}/>Saya sudah memeriksa bundle, quantity, harga, dan tujuan order.</label>
        <div className={styles.actions}><button className={styles.primary} disabled={!reviewed || !canReview} onClick={download}><Download size={16}/>{downloading ? 'Memvalidasi ulang…' : downloaded ? 'Download ulang CSV' : 'Download CSV'} {selectedAccount?.business}</button><button className={styles.secondary} disabled={busy} onClick={() => setConfigOpen(true)}>Perbaiki aturan parsing</button><button className={styles.secondary} disabled={busy || dirty} onClick={reloadSettings}>Muat ulang aturan tim</button></div>
        <details className={styles.audit}><summary>Jejak parsing dan perhitungan</summary><p>Harga dan quantity berasal dari file marketplace. File asli tidak diubah; routing dan kurir Scalev mengikuti aturan tim.</p>{batch&&lastExport&&<a href={archiveUrl(context.workspaceId,batch.id,'snapshot',lastExport)}>Download catatan parsing</a>}</details>
      </section>
    </>}
  </div>;
}
function OrderDetails({order,openSettings}:{order:PreviewOrder;openSettings:()=>void}) {
 return <div className={styles.details}><div className={styles.sectionHeading}><h3>Order {order.source.externalId}</h3><button className={styles.secondary} onClick={openSettings}>Aturan & mapping kurir</button></div>
 {!!order.errors.length&&<ul className={styles.issues}>{order.errors.map(e=><li key={e}>{e}</li>)}</ul>}{!!order.warnings.length&&<ul className={styles.notes}>{order.warnings.map(e=><li key={e}>{e}</li>)}</ul>}
 {order.lines.map(line=><section className={styles.lineEditor} key={line.source.key}><h4>{line.sku} · {line.bundleName||line.source.name}</h4><small>{line.source.sheet}, baris {line.source.row}</small>{!!line.errors.length&&<ul className={styles.issues}>{line.errors.map((e,i)=><li key={i}>{e}</li>)}</ul>}<details><summary>Data asli marketplace</summary><dl className={styles.raw}>{Object.entries(line.source.raw).filter(([,v])=>v).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details></section>)}
 </div>;
}
