'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Download, FileSpreadsheet, RefreshCw, Settings2, Upload } from 'lucide-react';
import { projectMarketplace, exportBusinessCsv, orderReady } from '@/lib/marketplace-parser/project';
import { COURIER_SERVICE_OPTIONS, validateCatalogConfig } from '@/lib/marketplace-parser/config';
import { centsText } from '@/lib/marketplace-parser/money';
import { CSV_HEADERS, type Catalog, type Edits, type ParsedFile, type ParserConfig, type ParserContext, type PreviewOrder } from '@/lib/marketplace-parser/types';
import MarketplaceParserConfig from './MarketplaceParserConfig';
import MarketplaceParserDiagnosis from './MarketplaceParserDiagnosis';
import type { DiagnosisRequest, ParserDiagnosis, RepairRequest, RepairResult } from '@/lib/marketplace-parser/diagnosis-types';
import styles from './MarketplaceParserTool.module.css';

type Props = {
  context: ParserContext;
  diagnoseCase?: (workspace: string,input: DiagnosisRequest) => Promise<ParserDiagnosis>;
  repairCase?: (workspace: string,input: RepairRequest) => Promise<{ result: RepairResult; catalog: Catalog }>;
  saveConfig: (workspace: string,revision: number,config: ParserConfig) => Promise<{ workspaceId: string; revision: number }>;
  loadCatalog: (workspace: string,storeIds: number[]) => Promise<Catalog>;
  syncStore: (workspace: string,storeId: number) => Promise<{ storeId: number; bundleCount: number }>;
  reloadContext: (workspace: string) => Promise<ParserContext>;
  prepareDownload: (workspace: string,input: { revision: number; catalogVersion: string; file: ParsedFile; account: string; date: string; edits: Edits }) => Promise<{ business: string; csv: string }>;
};
const money = (cents: number) => new Intl.NumberFormat('id-ID',{ style: 'currency',currency: 'IDR',maximumFractionDigits: 2 }).format(cents / 100);
const emptyEdits = (): Edits => ({ lines: {}, orders: {} });
function saveText(text: string,name: string,type: string) {
  const url = URL.createObjectURL(new Blob([text],{ type })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
}
export default function MarketplaceParserTool({ context,saveConfig,loadCatalog,syncStore,reloadContext,prepareDownload,diagnoseCase,repairCase }: Props) {
  const [config,setConfig] = useState(context.config), [draft,setDraft] = useState(context.config), [revision,setRevision] = useState(context.revision);
  const [catalog,setCatalog] = useState(context.catalog), [migrationNotes,setMigrationNotes] = useState(context.migrationNotes);
  const [configOpen,setConfigOpen] = useState(!context.config.accounts.length || !!context.migrationNotes.length);
  const [account,setAccount] = useState(context.config.accounts[0]?.id || '');
  const [date,setDate] = useState(() => new Intl.DateTimeFormat('en-CA',{ timeZone: 'Asia/Jakarta',year: 'numeric',month: '2-digit',day: '2-digit' }).format(new Date()));
  const [file,setFile] = useState<ParsedFile | null>(null), [fileHash,setFileHash] = useState(''), [edits,setEdits] = useState<Edits>(emptyEdits);
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
  const loadedKey = [...catalog.loadedStoreIds].sort((a,b) => a - b).join(',');
  const busy = reading || saving || loadingCatalog || syncing || downloading || repairing;
  function changed() { setReviewed(false); setDownloaded(false); setNotice(''); }
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
    if (storeKey === loadedKey) return;
    const pending = catalogRequest, token = ++pending.current; setLoadingCatalog(true); setCatalogError(false); setReviewed(false);
    loadCatalog(context.workspaceId,storeKey ? storeKey.split(',').map(Number) : []).then(result => {
      if (mounted.current && token === catalogRequest.current) setCatalog(result);
    }).catch(e => { if (mounted.current && token === catalogRequest.current) { setCatalogError(true); setError(e instanceof Error ? e.message : 'Katalog belum dapat dimuat.'); } }).finally(() => { if (mounted.current && token === catalogRequest.current) setLoadingCatalog(false); });
    return () => { pending.current++; };
    // Loading is driven by selected Store IDs, not by keystrokes in other rules.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[storeKey,loadCatalog,context.workspaceId]);
  const result = useMemo(() => {
    if (!file) return { projection: null,error: '' };
    try { return { projection: projectMarketplace({ file,account,date,config,revision,catalog,edits }),error: '' }; }
    catch (e) { return { projection: null,error: e instanceof Error ? e.message : 'Parsing gagal.' }; }
  },[file,account,date,config,revision,catalog,edits]);
  useEffect(() => {
    if (!error && !result.error) return;
    errorSummary.current?.focus({ preventScroll: true });
    errorSummary.current?.scrollIntoView({ block: 'center',behavior: 'auto' });
  },[error,result.error]);
  const projection = result.projection, orders = projection?.orders || [], ready = orders.filter(orderReady), blocked = orders.length - ready.length;
  const selectedAccount = config.accounts.find(a => a.id === account);
  const configurationReady = revision > 0 && !migrationNotes.length;
  const canReview = !!orders.length && !blocked && !busy && !dirty && !catalogError && configurationReady;
  const visible = orders.filter(o => (status !== 'blocked' || !orderReady(o)) && (status !== 'ready' || orderReady(o)) && `${o.source.externalId} ${o.store} ${o.business} ${o.lines.map(l => `${l.sku} ${l.source.name} ${l.bundleName}`).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  const currentPage = Math.min(page,Math.max(0,Math.ceil(visible.length / 25) - 1)), shown = visible.slice(currentPage * 25,currentPage * 25 + 25);
  function changeDraft(next: ParserConfig) { setDraft(next); changed(); }
  async function refreshCatalog() {
    const token = ++catalogRequest.current; setLoadingCatalog(true); setError(''); changed();
    try { const next = await loadCatalog(context.workspaceId,draft.stores.map(s => s.storeId)); if (mounted.current && token === catalogRequest.current) { setCatalog(next); setCatalogError(false); setNotice('Katalog dimuat ulang. Periksa preview terbaru sebelum download.'); } }
    catch (e) { if (mounted.current && token === catalogRequest.current) { setCatalogError(true); setError(e instanceof Error ? e.message : 'Katalog belum dapat dimuat.'); } }
    finally { if (mounted.current && token === catalogRequest.current) setLoadingCatalog(false); }
  }
  async function synchronize() {
    setSyncing(true); setError(''); changed();
    try {
      for (const [index,scope] of draft.stores.entries()) { if (!mounted.current) return; setNotice(`Menyinkronkan Store ${index + 1} dari ${draft.stores.length}…`); await syncStore(context.workspaceId,scope.storeId); }
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
      const buffer = await fileInput.arrayBuffer(), { readMarketplaceFile } = await import('@/lib/marketplace-parser/read');
      const parsed = readMarketplaceFile(buffer,fileInput.name), digest = await crypto.subtle.digest('SHA-256',buffer);
      if (!mounted.current || token !== request.current) return;
      setFile(parsed); setFileHash(Array.from(new Uint8Array(digest)).map(n => n.toString(16).padStart(2,'0')).join('')); setEdits(emptyEdits()); setExpanded(null); setPage(0);
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
      const next = await loadCatalog(context.workspaceId,draft.stores.map(s => s.storeId));
      if (!mounted.current) return;
      setCatalog(next); setCatalogError(false); setNotice('Konfigurasi tim tersimpan. Tujuan dan validasi batch diperbarui otomatis.'); setConfigOpen(false);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Konfigurasi belum dapat disimpan.'); }
    finally { if (mounted.current) setSaving(false); }
  }
  async function download() {
    if (!projection || !file || !reviewed || !canReview || !selectedAccount) return;
    setDownloading(true); setError('');
    try {
      const prepared = await prepareDownload(context.workspaceId,{ revision,catalogVersion: catalog.version,file,account,date,edits });
      if (!mounted.current) return;
      if (prepared.business !== selectedAccount.business || prepared.csv !== exportBusinessCsv(projection,selectedAccount.business)) throw new Error('Hasil validasi berubah dari preview. Muat ulang katalog dan periksa kembali.');
      saveText(prepared.csv,`scalev-${selectedAccount.label.replace(/[^a-z0-9_-]/gi,'_')}-${prepared.business}-${date}.csv`,'text/csv;charset=utf-8');
      setDownloaded(true); setNotice(`CSV ${prepared.business} diunduh setelah validasi ulang. Upload ke Business ${prepared.business} di Scalev.`);
    } catch (e) { if (mounted.current) { setReviewed(false); setError(e instanceof Error ? e.message : 'Download belum dapat diproses.'); } }
    finally { if (mounted.current) setDownloading(false); }
  }
  function lineEdit(key: string,field: 'quantity' | 'price' | 'reason',value: string) { setEdits(old => ({ ...old,lines: { ...old.lines,[key]: { ...old.lines[key],[field]: value } } })); changed(); }
  function orderEdit(key: string,field: 'courier' | 'service' | 'username' | 'reason',value: string) { setEdits(old => ({ ...old,orders: { ...old.orders,[key]: { ...old.orders[key],[field]: value } } })); changed(); }
  return <div className={styles.page}>
    <header className={styles.header}><div><h1>Marketplace Data Parser</h1><p>Cocokkan SKU dengan bundle Scalev. Business dan Store terisi otomatis dari akun asal dan aturan parsing.</p></div><button className={styles.secondary} disabled={busy} onClick={() => setConfigOpen(v => !v)} aria-expanded={configOpen}><Settings2 size={16}/>Aturan parsing</button></header>
    <ol className={styles.steps} aria-label="Alur parsing"><li aria-current={!file ? 'step' : undefined}>Upload XLSX</li><li aria-current={file && !reviewed ? 'step' : undefined}>Validasi hasil</li><li aria-current={reviewed ? 'step' : undefined}>Download CSV Scalev</li></ol>
    {(error || result.error) && <div ref={errorSummary} tabIndex={-1} className={styles.error} role="alert"><AlertCircle size={18}/><span>{error || result.error}</span></div>}
    {notice && <div className={styles.notice} role="status">{notice}</div>}
    {!!migrationNotes.length && <div className={styles.hint}><AlertCircle size={18}/><div>{migrationNotes.map(note => <p key={note}>{note}</p>)}</div></div>}
    {dirty && <div className={styles.hint} role="status">Ada perubahan aturan yang belum disimpan. Simpan untuk tim sebelum melanjutkan download.</div>}
    {configOpen && <section ref={settingsSection} tabIndex={-1} className={styles.section} aria-label="Konfigurasi parser"><div className={styles.sectionHeading}><div><h2>Aturan parsing</h2><p>Berlaku bersama untuk tim · versi {revision || 'belum disimpan'}. Perubahan akan memvalidasi ulang batch yang sedang dibuka.</p></div><button className={styles.secondary} disabled={busy || dirty} onClick={reloadSettings}><RefreshCw size={15}/>Muat ulang aturan</button></div>
      <fieldset className={styles.configFieldset} disabled={busy}><MarketplaceParserConfig config={draft} setConfig={changeDraft} catalog={catalog} busy={busy} canSync={context.canSync} refresh={refreshCatalog} sync={synchronize}/></fieldset>
      {loadingCatalog && <p className={styles.loading} role="status">Memuat bundle dari Store terpilih…</p>}
      <div className={styles.actions}>{!context.canSave && <p role="status">Penyimpanan aturan belum tersedia. Hubungi pengelola aplikasi.</p>}<button className={styles.secondary} disabled={busy || !dirty} onClick={() => { setDraft(structuredClone(config)); changed(); }}>Batalkan perubahan</button><button className={styles.primary} disabled={busy || !context.canSave} onClick={applyConfig}>{saving ? 'Menyimpan…' : 'Simpan konfigurasi tim'}</button></div>
    </section>}
    <section className={styles.section} aria-label="Upload marketplace"><div className={styles.upload}>
      <label>Akun marketplace asal<select value={account} disabled={busy} onChange={e => { setAccount(e.target.value); changed(); }}><option value="">Pilih akun asal</option>{config.accounts.map(a => <option key={a.id} value={a.id}>{a.label} · {a.business || 'Business belum ditetapkan'}</option>)}</select></label>
      <label>Tanggal batch<input type="date" value={date} disabled={busy} onChange={e => { setDate(e.target.value); changed(); }}/></label>
      <label className={styles.fileLabel}><span><Upload size={16}/>{reading ? 'Membaca file…' : 'Pilih file marketplace'}</span><input type="file" accept=".xlsx" disabled={busy || !account} onChange={e => { void read(e.target.files?.[0]); e.target.value = ''; }}/><small>XLSX · maksimal 10 MB</small></label>
    </div>{selectedAccount && <p className={styles.accountContext}>Business tujuan: <strong>{selectedAccount.business || 'belum ditetapkan'}</strong> · Store ditentukan otomatis dari relasi bundle dan aturan akun.</p>}
      {file ? <div className={styles.fileInfo}><FileSpreadsheet size={17}/><strong>{file.filename}</strong><span>{file.orders.length} order · {file.orders.reduce((n,o) => n + o.lines.length,0)} item</span><small>Sheet: {file.sheets.join(', ')}</small>{!!file.ignoredSheets.length && <details><summary>Sheet tidak diproses ({file.ignoredSheets.length})</summary><span>{file.ignoredSheets.join(', ')}</span></details>}</div> : <div className={styles.empty}><FileSpreadsheet size={28}/><h2>{config.accounts.length ? 'Mulai dari file asli marketplace' : 'Atur akun dan Store terlebih dahulu'}</h2><p>{config.accounts.length ? 'Pilih akun asal lalu upload export marketplace. Setiap SKU harus cocok dengan bundle yang tersedia di Store tujuan.' : 'Tambahkan akun, tetapkan Business, lalu pilih Store yang digunakan pada aturan parsing.'}</p></div>}
    </section>
    {projection && <>
      <section className={styles.section} aria-label="Preview CSV Scalev"><div className={styles.sectionHeading}><div><h2>Hasil parsing</h2><p>Konfigurasi versi {revision || 'belum disimpan'} · SKU dan tujuan tidak diisi manual per order.</p></div><div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={refreshCatalog}><RefreshCw size={15}/>Muat ulang katalog</button><button className={styles.secondary} onClick={() => setShowCsv(v => !v)} aria-pressed={showCsv}>{showCsv ? 'Tampilan order' : 'Lihat kolom CSV'}</button></div></div>
        <div className={styles.summary}><span><strong>{ready.length}</strong> order valid</span><span className={blocked ? styles.warning : ''}><strong>{blocked}</strong> perlu diselesaikan</span><span><strong>{money(orders.reduce((n,o) => n + o.totalCents,0))}</strong> total terhitung{blocked ? ' (belum final)' : ''}</span></div>
        <div className={styles.toolbar}><label className={styles.search}>Cari order, SKU, bundle, atau Store<input type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Cari hasil parsing…"/></label><label>Status<select value={status} onChange={e => { setStatus(e.target.value); setPage(0); }}><option value="all">Semua order</option><option value="blocked">Perlu diselesaikan</option><option value="ready">Valid</option></select></label></div>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Tabel hasil parsing, geser untuk melihat kolom"><table><caption className={styles.srOnly}>Hasil parsing CSV Scalev, {visible.length} order sesuai filter.</caption>
          {showCsv ? <><thead><tr>{CSV_HEADERS.map(h => <th key={h}>{h}</th>)}</tr></thead>{shown.map(o => <tbody key={o.source.key}>{o.rows.map((row,i) => <tr key={i}>{CSV_HEADERS.map(h => <td key={h}>{row[h] || '—'}</td>)}</tr>)}</tbody>)}</> : <><thead><tr><th>Order marketplace</th><th>SKU / bundle Scalev</th><th className={styles.number}>Qty</th><th className={styles.number}>Harga satuan</th><th className={styles.number}>Total</th><th>Tujuan otomatis</th><th>Validasi</th></tr></thead>{shown.map(order => <tbody key={order.source.key}>{order.lines.map((line,index) => <tr key={line.source.key}>
            {index === 0 && <td rowSpan={order.lines.length}><strong className={styles.identifier}>{order.source.externalId}</strong><small>{order.source.platform}</small><small>Resi {order.source.tracking || 'belum tersedia'}</small><button className={styles.linkButton} aria-expanded={expanded === order.source.key} onClick={() => setExpanded(expanded === order.source.key ? null : order.source.key)}><ChevronDown size={14}/>{orderReady(order) ? 'Detail order' : 'Periksa masalah'}</button></td>}
            <td className={styles.product}><strong>{line.sku || 'Nomor Referensi SKU kosong'}</strong>{line.bundleName || line.source.name}<small>{line.bundleId ? `Bundle #${line.bundleId}` : 'Bundle belum cocok'}</small>{line.productIds.length > 0 && <small>{line.productIds.map(id => config.groups.find(g => g.id === id)?.name).join(' + ')}</small>}</td>
            <td className={styles.number}>{line.quantity ?? '—'}</td><td className={styles.number}>{line.unitCents === null ? '—' : money(line.unitCents)}</td><td className={styles.number}>{line.totalCents === null ? '—' : money(line.totalCents)}</td>
            {index === 0 && <><td rowSpan={order.lines.length}><strong>{order.business || 'Business akun belum ditetapkan'}</strong><small>{order.store || 'Store belum dapat ditentukan'}</small><small>{order.warehouse || 'Warehouse belum dipilih'}</small><small>{order.courier} {order.service}</small></td><td rowSpan={order.lines.length}><span className={orderReady(order) ? styles.good : styles.bad}>{orderReady(order) ? <CheckCircle2 size={14}/> : <AlertCircle size={14}/ >}{orderReady(order) ? 'Valid' : 'Download diblokir'}</span><small>{order.errors[0] || line.errors[0] || (order.warnings.length ? `${order.warnings.length} catatan sumber` : '')}</small></td></>}
          </tr>)}{expanded === order.source.key && <tr><td colSpan={7} className={styles.detailCell}><OrderDetails order={order} edits={edits} busy={busy} lineEdit={lineEdit} orderEdit={orderEdit} openSettings={openSettings} reset={() => { setEdits(old => { const next = structuredClone(old); delete next.orders[order.source.key]; order.lines.forEach(l => delete next.lines[l.source.key]); return next; }); changed(); }} diagnosis={diagnoseCase && repairCase ? <MarketplaceParserDiagnosis key={`${account}:${revision}:${order.source.key}`} workspace={context.workspaceId} account={account} revision={revision} skus={order.lines.map(l => l.sku)} enabled={context.canSync} canManage={!!context.canManageCatalog} busy={busy} dirty={dirty} diagnose={diagnoseCase} repair={repairOrder} openSettings={openSettings}/> : null}/></td></tr>}</tbody>)}</>}
        </table>{!shown.length && <p className={styles.noResults}>Tidak ada order yang sesuai filter.</p>}</div>
        <div className={styles.pagination}><span>{visible.length ? currentPage * 25 + 1 : 0}–{Math.min((currentPage + 1) * 25,visible.length)} dari {visible.length} order</span><button className={styles.secondary} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Sebelumnya</button><button className={styles.secondary} disabled={(currentPage + 1) * 25 >= visible.length} onClick={() => setPage(currentPage + 1)}>Berikutnya</button></div>
      </section>
      <section className={styles.export}><div><h2>Download untuk Scalev</h2><p>{blocked ? `${blocked} order belum valid. Seluruh file diblokir sampai semua bundle, kode, dan tujuan terselesaikan.` : `${orders.length} order valid. Business tujuan: ${selectedAccount?.business || 'belum ditetapkan'}.`}</p>{!configurationReady && <p>Simpan konfigurasi tim terlebih dahulu.</p>}</div>
        <label className={styles.check}><input aria-label="Konfirmasi hasil parsing" type="checkbox" checked={reviewed} disabled={!canReview} onChange={e => setReviewed(e.target.checked)}/>Saya sudah memeriksa bundle, quantity, harga, dan tujuan order.</label>
        <div className={styles.actions}><button className={styles.primary} disabled={!reviewed || !canReview} onClick={download}><Download size={16}/>{downloading ? 'Memvalidasi ulang…' : downloaded ? 'Download ulang CSV' : 'Download CSV'} {selectedAccount?.business}</button><button className={styles.secondary} disabled={busy} onClick={() => setConfigOpen(true)}>Perbaiki aturan parsing</button><button className={styles.secondary} disabled={busy || dirty} onClick={reloadSettings}>Muat ulang aturan tim</button></div>
        <details className={styles.audit}><summary>Jejak parsing dan catatan perhitungan</summary><p>Harga Shopee mengikuti Harga Setelah Diskon. Harga TikTok adalah subtotal sebelum diskon dikurangi diskon seller, dibagi quantity. Voucher order, ongkir pembeli, dan fee tetap terpisah dari nominal barang CSV.</p><p>Koreksi quantity atau nominal membutuhkan alasan. SKU dan tujuan hanya berubah melalui perbaikan sumber atau konfigurasi bersama.</p><button className={styles.secondary} disabled={!downloaded || !canReview} onClick={() => saveText(JSON.stringify({ parserVersion: 3,sourceFile: file?.filename,sourceSha256: fileHash,catalogVersion: catalog.version,createdAt: new Date().toISOString(),...projection },null,2),`catatan-parsing-${date}.json`,'application/json')}>Download catatan parsing</button></details>
      </section>
    </>}
  </div>;
}
function OrderDetails({ order,edits,busy,lineEdit,orderEdit,reset,openSettings,diagnosis }: { order: PreviewOrder; edits: Edits; busy: boolean; lineEdit: (key: string,field: 'quantity' | 'price' | 'reason',value: string) => void; orderEdit: (key: string,field: 'courier' | 'service' | 'username' | 'reason',value: string) => void; reset: () => void; openSettings: () => void; diagnosis?: ReactNode }) {
  const edit = edits.orders[order.source.key];
  return <div className={styles.details}><div className={styles.sectionHeading}><h3>Order {order.source.externalId}</h3><button className={styles.secondary} disabled={busy} onClick={openSettings}>Buka aturan parsing</button></div>
    <p className={styles.routeSummary}><strong>{order.business || 'Business belum ditetapkan'}</strong> → {order.store || 'Store belum ditentukan'} · {order.warehouse || 'Warehouse belum dipilih'}</p>
    {diagnosis}
    {!!order.errors.length && <ul className={styles.issues}>{order.errors.map(e => <li key={e}>{e}</li>)}</ul>}{!!order.warnings.length && <ul className={styles.notes}>{order.warnings.map(e => <li key={e}>{e}</li>)}</ul>}
    {order.lines.map(line => <section className={styles.lineEditor} key={line.source.key}><h4>{line.sku || 'SKU kosong'} · {line.bundleName || line.source.name}</h4><small>{line.source.sheet}, baris {line.source.row}{line.bundleId ? ` · Bundle #${line.bundleId}` : ''}</small>{!!line.errors.length && <ul className={styles.issues}>{line.errors.map((e,i) => <li key={i}>{e}</li>)}</ul>}
      <details><summary>Data mentah dan koreksi nominal</summary><fieldset className={styles.configFieldset} disabled={busy}><div className={styles.fields}><label>Quantity<input inputMode="numeric" value={edits.lines[line.source.key]?.quantity ?? (line.quantity === null ? '' : String(line.quantity))} onChange={e => lineEdit(line.source.key,'quantity',e.target.value)}/></label><label>Harga satuan (Rp)<input inputMode="decimal" value={edits.lines[line.source.key]?.price ?? (line.unitCents === null ? '' : centsText(line.unitCents))} onChange={e => lineEdit(line.source.key,'price',e.target.value)}/></label><label>Alasan / bukti koreksi item<input value={edits.lines[line.source.key]?.reason || ''} onChange={e => lineEdit(line.source.key,'reason',e.target.value)}/></label></div></fieldset><dl className={styles.raw}>{Object.entries(line.source.raw).filter(([,value]) => value).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></details>
    </section>)}
    <details className={styles.audit}><summary>Koreksi kurir atau nama pembeli</summary><fieldset className={styles.configFieldset} disabled={busy}><div className={styles.fields}><label>Kurir dan layanan<select value={`${order.courier}|${order.service}`} onChange={e => { const [courier,service] = e.target.value.split('|'); orderEdit(order.source.key,'courier',courier); orderEdit(order.source.key,'service',service); }}><option value="|">Pilih kurir / layanan</option>{COURIER_SERVICE_OPTIONS.map(o => <option key={`${o.courier}|${o.service}`} value={`${o.courier}|${o.service}`}>{o.courier} · {o.service}</option>)}</select></label><label>Nama / username pembeli<input value={edit?.username ?? order.source.username} onChange={e => orderEdit(order.source.key,'username',e.target.value)}/></label><label>Alasan koreksi order<input value={edit?.reason || ''} onChange={e => orderEdit(order.source.key,'reason',e.target.value)}/></label></div><button className={styles.secondary} onClick={reset}>Kembalikan data sumber</button></fieldset></details>
  </div>;
}
