'use client';

import { useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { COURIER_SERVICE_OPTIONS, MARKETPLACE_LABELS } from '@/lib/marketplace-parser/config';
import type { Catalog, ParserConfig, Platform } from '@/lib/marketplace-parser/types';
import styles from './MarketplaceParserTool.module.css';

type Props = { config: ParserConfig; setConfig: (config: ParserConfig) => void; catalog: Catalog; busy: boolean; canSync: boolean; refresh: () => void; sync: () => void };
export default function MarketplaceParserConfig({ config,setConfig,catalog,busy,canSync,refresh,sync }: Props) {
  const [addingAccount,setAddingAccount] = useState(false);
  const [newAccount,setNewAccount] = useState({ label: '',marketplace: 'shopee' as Platform,business: '' });
  const [accountError,setAccountError] = useState('');
  const [catalogQuery,setCatalogQuery] = useState('');
  const selected = new Set(config.stores.map(s => s.storeId));
  const usedBusinesses = new Set(config.accounts.map(a => a.business));
  const storeOptions = (accountId: string) => catalog.stores.filter(s => selected.has(s.id) && s.business === config.accounts.find(a => a.id === accountId)?.business);
  const uid = () => crypto.randomUUID();
  function patch<K extends 'accounts' | 'groups' | 'products' | 'routes' | 'combinations' | 'couriers'>(kind: K,index: number,values: Partial<ParserConfig[K][number]>) {
    setConfig({ ...config,[kind]: config[kind].map((row,i) => i === index ? { ...row,...values } : row) });
  }
  function remove<K extends 'products' | 'routes' | 'combinations' | 'couriers'>(kind: K,index: number) { setConfig({ ...config,[kind]: config[kind].filter((_,i) => i !== index) }); }
  const accountOptions = config.accounts.map(a => <option key={a.id} value={a.id}>{a.label} · {a.business || 'Business belum dipilih'}</option>);
  function productPicker(value: string[],onChange: (ids: string[]) => void,label: string) {
    return <fieldset className={styles.productChoices}><legend>{label}</legend>{config.groups.length ? config.groups.map(g => <label key={g.id} className={styles.check}><input type="checkbox" checked={value.includes(g.id)} onChange={e => onChange(e.target.checked ? [...value,g.id] : value.filter(id => id !== g.id))}/>{g.name}</label>) : <p>Tambahkan Produk terlebih dahulu.</p>}</fieldset>;
  }
  function targetSelect(account: string,value: number,onChange: (id: number) => void,label: string) {
    const options = storeOptions(account);
    return <select aria-label={label} value={value || ''} onChange={e => onChange(Number(e.target.value))}><option value="">Pilih Store tujuan</option>{value && !options.some(s => s.id === value) ? <option value={value}>Store perlu dipilih ulang</option> : null}{options.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>;
  }
  return <div className={styles.config}>
    <p>Akun asal menentukan Business. Aturan Produk menentukan Store dalam Business tersebut. Kode SKU marketplace harus sama dengan identifier code bundle Scalev.</p>
    <details open><summary>Akun marketplace asal <span>{config.accounts.length} akun</span></summary>
      <p>Tetapkan satu Business per akun. Business hasil parsing mengikuti pengaturan ini secara otomatis.</p>
      {config.accounts.length > 0 && <div className={styles.tableWrap}><table><thead><tr><th>Marketplace</th><th>Nama akun</th><th>Business</th><th>Aksi</th></tr></thead><tbody>{config.accounts.map((a,i) => <tr key={a.id}>
        <td><select aria-label={`Marketplace akun ${i + 1}`} value={a.marketplace} onChange={e => patch('accounts',i,{ marketplace: e.target.value as Platform })}>{Object.entries(MARKETPLACE_LABELS).map(([value,name]) => <option key={value} value={value}>{name}</option>)}</select></td>
        <td><input aria-label={`Nama akun ${i + 1}`} value={a.label} onChange={e => patch('accounts',i,{ label: e.target.value })}/></td>
        <td><select aria-label={`Business akun ${i + 1}`} value={a.business} onChange={e => patch('accounts',i,{ business: e.target.value })}><option value="">Pilih Business</option>{a.business && !catalog.businesses.some(b => b.code === a.business) && <option value={a.business}>{a.business} (tidak tersedia)</option>}{catalog.businesses.map(b => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}</select></td>
        <td><button className={styles.linkButton} aria-label={`Hapus akun ${a.label}`} disabled={config.routes.some(r => r.account === a.id) || config.combinations.some(r => r.account === a.id) || config.products.some(r => r.account === a.id)} title="Hapus aturan yang memakai akun ini terlebih dahulu" onClick={() => setConfig({ ...config,accounts: config.accounts.filter(row => row.id !== a.id) })}><Trash2 size={16}/></button></td>
      </tr>)}</tbody></table></div>}
      {!config.accounts.length && <p>Belum ada akun. Tambahkan akun marketplace pertama dan pilih Business-nya.</p>}
      {addingAccount ? <div className={styles.inlineForm}>
        <div className={styles.fields}><label>Marketplace<select value={newAccount.marketplace} onChange={e => setNewAccount({ ...newAccount,marketplace: e.target.value as Platform })}>{Object.entries(MARKETPLACE_LABELS).map(([value,name]) => <option key={value} value={value}>{name}</option>)}</select></label>
          <label>Nama akun<input autoFocus value={newAccount.label} onChange={e => setNewAccount({ ...newAccount,label: e.target.value })} placeholder="Nama akun marketplace"/></label>
          <label>Business akun<select value={newAccount.business} onChange={e => setNewAccount({ ...newAccount,business: e.target.value })}><option value="">Pilih Business</option>{catalog.businesses.map(b => <option key={b.code} value={b.code}>{b.code} · {b.name}</option>)}</select></label></div>
        {accountError && <p role="alert" className={styles.warning}>{accountError}</p>}
        <div className={styles.actions}><button className={styles.primary} onClick={() => { if (!newAccount.label.trim() || !newAccount.business) { setAccountError('Isi nama akun dan pilih Business.'); return; } if (config.accounts.some(a => a.marketplace === newAccount.marketplace && a.label.trim().toLowerCase() === newAccount.label.trim().toLowerCase())) { setAccountError('Akun dengan nama dan Marketplace ini sudah ada.'); return; } setConfig({ ...config,accounts: [...config.accounts,{ id: uid(),...newAccount,label: newAccount.label.trim() }] }); setAddingAccount(false); setAccountError(''); setNewAccount({ label: '',marketplace: 'shopee',business: '' }); }}>Tambahkan akun</button><button className={styles.secondary} onClick={() => setAddingAccount(false)}>Batal</button></div>
      </div> : <button className={styles.linkButton} onClick={() => setAddingAccount(true)}><Plus size={15}/>Tambah akun</button>}
    </details>
    <details open><summary>Store dan Warehouse yang digunakan <span>{config.stores.length} Store</span></summary>
      <p>Pilih Store tujuan dan Warehouse yang melayaninya.</p>
      {!usedBusinesses.size && <p>Tambahkan akun dengan Business terlebih dahulu.</p>}
      {catalog.businesses.filter(b => usedBusinesses.has(b.code)).map(b => <div key={b.code} className={styles.storeGroup}><h3>{b.code} · {b.name}</h3><div className={styles.storeChoices}>{catalog.stores.filter(s => s.business === b.code).map(store => <label className={styles.check} key={store.id}><input type="checkbox" checked={selected.has(store.id)} onChange={e => { const available = catalog.warehouses.filter(w => w.businesses.includes(store.business)); setConfig({ ...config,stores: e.target.checked ? [...config.stores,{ storeId: store.id,warehouseId: available.length === 1 ? available[0].id : null }] : config.stores.filter(s => s.storeId !== store.id) }); }}/>{store.name}</label>)}</div></div>)}
      {!!config.stores.length && <div className={styles.tableWrap}><table><thead><tr><th>Store terpilih</th><th>Business</th><th>Warehouse</th><th>Aksi</th></tr></thead><tbody>{config.stores.map(scope => {
        const store = catalog.stores.find(s => s.id === scope.storeId);
        return <tr key={scope.storeId}><td>{store?.name || 'Store tidak tersedia'}</td><td>{store?.business || '—'}</td><td><select aria-label={`Warehouse ${store?.name || scope.storeId}`} value={scope.warehouseId || ''} onChange={e => setConfig({ ...config,stores: config.stores.map(s => s.storeId === scope.storeId ? { ...s,warehouseId: Number(e.target.value) || null } : s) })}><option value="">Pilih Warehouse</option>{catalog.warehouses.filter(w => w.businesses.includes(store?.business || '')).map(w => <option key={w.id} value={w.id}>{w.name}{!w.exportName ? " · nama ekspor belum tersedia" : ""}</option>)}</select></td><td><button className={styles.linkButton} aria-label={`Hapus Store ${store?.name}`} onClick={() => setConfig({ ...config,stores: config.stores.filter(s => s.storeId !== scope.storeId) })}><Trash2 size={16}/></button></td></tr>;
      })}</tbody></table></div>}
    </details>
    <details><summary>Produk dan pengenalan SKU <span>{config.groups.length} Produk · {config.products.length} aturan</span></summary>
      <p>Produk digunakan untuk routing dan kombinasi order. Aturan ini hanya mengelompokkan kode; kode SKU tidak diubah dan nama item tidak dipakai sebagai pengganti kode.</p>
      <div className={styles.productNames}>{config.groups.map((g,i) => <div key={g.id}><label>Nama Produk {i + 1}<input value={g.name} onChange={e => patch('groups',i,{ name: e.target.value })}/></label><button className={styles.linkButton} aria-label={`Hapus Produk ${g.name}`} disabled={config.products.some(r => r.productIds.includes(g.id)) || config.routes.some(r => r.productId === g.id) || config.combinations.some(r => r.productIds.includes(g.id))} onClick={() => setConfig({ ...config,groups: config.groups.filter(row => row.id !== g.id) })}><Trash2 size={16}/></button></div>)}</div>
      <button className={styles.linkButton} onClick={() => setConfig({ ...config,groups: [...config.groups,{ id: uid(),name: '' }] })}><Plus size={15}/>Tambah Produk</button>
      <div className={styles.ruleList}>{config.products.map((rule,i) => <div className={styles.rule} key={rule.id}><div className={styles.fields}>
        <label>Akun pengenalan {i + 1}<select value={rule.account} onChange={e => patch('products',i,{ account: e.target.value })}><option value="*">Semua akun</option>{accountOptions}</select></label>
        <label>Pencocokan {i + 1}<select value={rule.match} onChange={e => patch('products',i,{ match: e.target.value as 'sku' | 'prefix' })}><option value="sku">Kode SKU persis</option><option value="prefix">Awalan kode SKU</option></select></label>
        <label>Kode pengenalan {i + 1}<input list="parser-known-codes" value={rule.value} onChange={e => patch('products',i,{ value: e.target.value })}/></label>
      </div>{productPicker(rule.productIds,ids => patch('products',i,{ productIds: ids }),`Produk untuk aturan ${i + 1}`)}<button className={styles.linkButton} onClick={() => remove('products',i)}><Trash2 size={15}/>Hapus pengenalan {i + 1}</button></div>)}</div>
      <datalist id="parser-known-codes">{[...new Set(catalog.bundles.map(b => b.sku).filter(Boolean))].map(sku => <option key={sku} value={sku}/>)}</datalist>
      <button className={styles.linkButton} disabled={!config.groups.length} onClick={() => setConfig({ ...config,products: [...config.products,{ id: uid(),account: '*',match: 'sku',value: '',productIds: [] }] })}><Plus size={15}/>Tambah pengenalan SKU</button>
    </details>
    <details open><summary>Routing Produk ke Store <span>{config.routes.length} aturan</span></summary>
      <p>Setiap Produk harus memiliki Store tujuan dalam Business akun asal.</p>
      <div className={styles.tableWrap}><table><thead><tr><th>Akun asal / Business</th><th>Produk</th><th>Store tujuan</th><th>Aksi</th></tr></thead><tbody>{config.routes.map((r,i) => <tr key={r.id}><td><select aria-label={`Akun routing ${i + 1}`} value={r.account} onChange={e => patch('routes',i,{ account: e.target.value,storeId: 0 })}><option value="">Pilih akun</option>{accountOptions}</select></td><td><select aria-label={`Produk routing ${i + 1}`} value={r.productId} onChange={e => patch('routes',i,{ productId: e.target.value })}><option value="">Pilih Produk</option>{config.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></td><td>{targetSelect(r.account,r.storeId,id => patch('routes',i,{ storeId: id }),`Store routing ${i + 1}`)}</td><td><button className={styles.linkButton} aria-label={`Hapus routing ${i + 1}`} onClick={() => remove('routes',i)}><Trash2 size={16}/></button></td></tr>)}</tbody></table></div>
      <button className={styles.linkButton} disabled={!config.accounts.length || !config.groups.length || !config.stores.length} onClick={() => setConfig({ ...config,routes: [...config.routes,{ id: uid(),account: config.accounts[0].id,productId: '',storeId: 0 }] })}><Plus size={15}/>Tambah routing</button>
    </details>
    <details open><summary>Routing kombinasi Produk <span>{config.combinations.length} aturan</span></summary>
      <p>Aturan kombinasi diperiksa lebih dahulu. Prioritas yang lebih besar didahulukan. Aturan setara yang memilih Store berbeda memblokir download.</p>
      {!config.combinations.length && <p>Belum ada aturan kombinasi. Tambahkan kondisi untuk order dengan beberapa Produk atau aturan “mengandung” Produk tertentu.</p>}
      <div className={styles.ruleList}>{config.combinations.map((r,i) => <div className={styles.rule} key={r.id}><div className={styles.fields}>
        <label>Akun kombinasi {i + 1}<select value={r.account} onChange={e => patch('combinations',i,{ account: e.target.value,storeId: 0 })}>{accountOptions}</select></label>
        <label>Kondisi kombinasi {i + 1}<select value={r.match} onChange={e => patch('combinations',i,{ match: e.target.value as 'contains' | 'exact' })}><option value="contains">Mengandung semua Produk ini</option><option value="exact">Hanya kombinasi Produk ini</option></select></label>
        <label>Prioritas kombinasi {i + 1}<input type="number" min="0" max="9999" value={r.priority} onChange={e => patch('combinations',i,{ priority: Number(e.target.value) })}/></label>
      </div>{productPicker(r.productIds,ids => patch('combinations',i,{ productIds: ids }),`Produk kombinasi ${i + 1}`)}<label>Store tujuan kombinasi {i + 1}{targetSelect(r.account,r.storeId,id => patch('combinations',i,{ storeId: id }),`Store kombinasi ${i + 1}`)}</label><button className={styles.linkButton} onClick={() => remove('combinations',i)}><Trash2 size={15}/>Hapus kombinasi {i + 1}</button></div>)}</div>
      <button className={styles.linkButton} disabled={!config.accounts.length || !config.groups.length || !config.stores.length} onClick={() => setConfig({ ...config,combinations: [...config.combinations,{ id: uid(),account: config.accounts[0].id,productIds: [],match: 'contains',priority: 100,storeId: 0 }] })}><Plus size={15}/>Tambah aturan kombinasi</button>
    </details>
    <details><summary>Katalog bundle Business <span>{catalog.bundles.length} bundle</span></summary>
      <p>SKU dicocokkan persis dengan identifier code di Business tujuan. Harga mengikuti file marketplace.</p>
      <div className={styles.tableWrap}><table><thead><tr><th>Business</th><th>Status katalog</th><th>Sinkronisasi terakhir</th></tr></thead><tbody>{catalog.businessSyncs.map(state => <tr key={state.business}><td>{state.business}</td><td>{state.status === 'ready' ? `${state.bundleCount} bundle` : state.status === 'failed' ? 'Perlu sinkronisasi ulang' : 'Belum tersinkron'}</td><td>{state.checkedAt ? new Date(state.checkedAt).toLocaleString('id-ID') : '—'}</td></tr>)}</tbody></table></div>
      <div className={styles.actions}><button className={styles.secondary} disabled={busy || !usedBusinesses.size} onClick={refresh}><RefreshCw size={15}/>Muat ulang katalog</button><button className={styles.secondary} disabled={busy || !canSync || !usedBusinesses.size} onClick={sync}><RefreshCw size={15}/>Sinkronkan Business dari Scalev</button></div>
      <label className={styles.search}>Cari kode atau nama bundle<input type="search" value={catalogQuery} onChange={e => setCatalogQuery(e.target.value)} placeholder="Cari pada katalog Business"/></label>
      <div className={styles.tableWrap}><table><thead><tr><th>Identifier code</th><th>Bundle</th><th>Business</th></tr></thead><tbody>{catalog.bundles.filter(b => `${b.sku} ${b.name}`.toLowerCase().includes(catalogQuery.toLowerCase())).slice(0,100).map(b => <tr key={`${b.business}:${b.id}`}><td>{b.sku || <span className={styles.warning}>Kode belum diisi</span>}</td><td>{b.name}<small>ID {b.id}</small></td><td>{b.business}</td></tr>)}</tbody></table></div><p>Maksimal 100 hasil ditampilkan. Gunakan pencarian untuk mempersempit daftar.</p>
    </details>
    <details><summary>Mapping kurir dan layanan <span>{config.couriers.length} aturan</span></summary><div className={styles.tableWrap}><table><thead><tr><th>Marketplace</th><th>Provider sumber persis</th><th>Kurir dan layanan Scalev</th><th>Aksi</th></tr></thead><tbody>{config.couriers.map((r,i) => <tr key={i}><td><select aria-label={`Marketplace kurir ${i + 1}`} value={r.platform} onChange={e => patch('couriers',i,{ platform: e.target.value as Platform })}>{Object.entries(MARKETPLACE_LABELS).map(([value,name]) => <option key={value} value={value}>{name}</option>)}</select></td><td><input aria-label={`Provider kurir ${i + 1}`} value={r.source} onChange={e => patch('couriers',i,{ source: e.target.value })}/></td><td><select aria-label={`Layanan kurir ${i + 1}`} value={`${r.courier}|${r.service}`} onChange={e => { const [courier,service] = e.target.value.split('|'); patch('couriers',i,{ courier,service }); }}><option value="|">Pilih kurir / layanan</option>{COURIER_SERVICE_OPTIONS.map(o => <option key={`${o.courier}|${o.service}`} value={`${o.courier}|${o.service}`}>{o.courier} · {o.service}</option>)}</select></td><td><button className={styles.linkButton} aria-label={`Hapus kurir ${i + 1}`} onClick={() => remove('couriers',i)}><Trash2 size={16}/></button></td></tr>)}</tbody></table></div><button className={styles.linkButton} onClick={() => setConfig({ ...config,couriers: [...config.couriers,{ platform: 'shopee',source: '',courier: '',service: '' }] })}><Plus size={15}/>Tambah kurir</button></details>
  </div>;
}
