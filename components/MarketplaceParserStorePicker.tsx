'use client';
import { useState } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';
import type { Catalog, PreviewOrder } from '@/lib/marketplace-parser/types';
import styles from './MarketplaceParserTool.module.css';
export default function MarketplaceParserStorePicker({order,stores,history,busy,onSave}:{order:PreviewOrder;stores:Catalog['stores'];history:NonNullable<Catalog['decisions']>;busy:boolean;onSave:(storeId:number)=>Promise<void>}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[selected,setSelected]=useState<number|null>(null),[error,setError]=useState('');
 const routing=order.routing;
 const matching=stores.filter(s=>s.name.toLocaleLowerCase('id').includes(query.toLocaleLowerCase('id'))).sort((a,b)=>Number(routing?.suggestedIds.includes(b.id))-Number(routing?.suggestedIds.includes(a.id))||a.name.localeCompare(b.name));
 const options=matching.slice(0,6);
 const labels={saved:'Tersimpan',catalog:'Dari katalog Store',rule:'Aturan kombinasi',approval:'Perlu Store',invalid:'Perlu ditinjau',bundle:'Periksa bundle'};
 return <div className={styles.storePicker}>
  {order.store && <strong>{order.store}</strong>}
  {routing && <small>{labels[routing.status]}</small>}
  {!open ? <button className={order.store?styles.linkButton:styles.secondary} disabled={busy} onClick={()=>{setOpen(true);setSelected(null);setQuery('');setError('');}} aria-expanded={false}>{order.store?'Ubah':'Pilih Store'}<ChevronDown size={14}/></button> : <div role="group" aria-label={`Pilih Store untuk ${order.source.externalId}`}>
   <label><span><Search size={13}/> Cari Store {order.business}</span><input autoFocus type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Ketik nama Store…" disabled={busy}/></label>
   <div className={styles.storeResults}>{options.map(store=><button type="button" key={store.id} aria-pressed={selected===store.id} disabled={busy} onClick={()=>setSelected(store.id)}><span>{store.name}{routing?.suggestedIds.includes(store.id)&&<small>Saran</small>}</span>{selected===store.id&&<Check size={14}/>}</button>)}</div>
   {!options.length&&<p role="status">Store tidak ditemukan.</p>}{matching.length>6&&<small>Ketik lebih spesifik untuk melihat Store lainnya.</small>}
   <small>{routing?.items.length===1?'Disimpan untuk akun dan bundle ini.':'Disimpan untuk kombinasi dan jumlah item ini.'}</small>
   <div className={styles.actions}><button className={styles.primary} disabled={busy||!selected} onClick={async()=>{setError('');try{await onSave(selected!);setOpen(false);}catch(e){setError(e instanceof Error?e.message:'Keputusan belum tersimpan.');}}}>Gunakan & simpan</button><button className={styles.linkButton} disabled={busy} onClick={()=>setOpen(false)}>Batal</button></div>
   {error&&<p className={styles.warning} role="alert">{error}</p>}
  </div>}
  {!!history.length&&<details className={styles.audit}><summary>Riwayat keputusan</summary>{[...history].sort((a,b)=>b.revision-a.revision).map(d=><p key={d.id}>{stores.find(s=>s.id===d.storeId)?.name||`Store #${d.storeId}`}<br/>{d.actor} · {new Date(d.createdAt).toLocaleString('id-ID')}</p>)}</details>}
 </div>;
}
