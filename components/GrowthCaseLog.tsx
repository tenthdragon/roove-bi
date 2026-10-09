'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyDocument, documentText, type GrowthCase, type CaseAttempt } from '@/lib/growth-case-domain';
import GrowthCaseEditor from './GrowthCaseEditor';
import styles from './GrowthCaseLog.module.css';

type Summary=Pick<GrowthCase,'id'|'title'|'status'|'problem'|'updated_at'|'version'>;
async function request(path:string,options?:RequestInit){const response=await fetch(`/api/growth-cases${path}`,options);const data=await response.json();if(!response.ok)throw new Error(data.error || 'Permintaan gagal.');return data;}
const date=(value:string)=>new Date(value).toLocaleString('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'medium',timeStyle:'short'})+' WIB';
export default function GrowthCaseLog({initialId}:{initialId?:string}) {
  const [cases,setCases]=useState<Summary[]>([]);
  const [selected,setSelected]=useState<GrowthCase|null>(null);
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [uploads,setUploads]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [search,setSearch]=useState('');
  const [filter,setFilter]=useState('all');
  const [page,setPage]=useState(0);
  const [total,setTotal]=useState(0);
  const [expanded,setExpanded]=useState<string[]>([]);
  const listRequest=useRef(0);
  const list=useCallback(async(pageNumber=0)=>{const sequence=++listRequest.current;const data=await request(`?page=${pageNumber}&status=${filter}&search=${encodeURIComponent(search)}`);if(sequence!==listRequest.current)return;setCases(previous=>pageNumber ? [...previous,...data.cases] : data.cases);setTotal(data.total);setPage(pageNumber);},[filter,search]);
  useEffect(()=>{let cancelled=false;const timer=setTimeout(()=>{setLoading(true);list().catch(err=>{if(!cancelled)setError(err.message);}).finally(()=>{if(!cancelled)setLoading(false);});},200);return()=>{cancelled=true;clearTimeout(timer);};},[list]);
  useEffect(()=>{if(initialId){setBusy(true);request(`/${initialId}`).then(data=>{setSelected(data.case);setExpanded([data.case.attempts.at(-1).id]);}).catch(err=>setError(err.message)).finally(()=>setBusy(false));}},[initialId]);
  useEffect(()=>{
    const warn=(event:BeforeUnloadEvent)=>{if(dirty || uploads){event.preventDefault();event.returnValue='';}};
    const navigate=(event:MouseEvent)=>{
      const link=(event.target as Element)?.closest?.('a[href]');
      if(!link || (!dirty && !uploads) || link.getAttribute('href')?.startsWith('#'))return;
      if(uploads || !window.confirm('Perubahan belum disimpan. Tinggalkan log kasus?')){event.preventDefault();event.stopPropagation();}
    };
    window.addEventListener('beforeunload',warn);document.addEventListener('click',navigate,true);
    return()=>{window.removeEventListener('beforeunload',warn);document.removeEventListener('click',navigate,true);};
  },[dirty,uploads]);
  function show(record:GrowthCase){setSelected(record);setDirty(false);setExpanded([record.attempts.at(-1)!.id]);window.history.replaceState(null,'',`?case=${record.id}`);}
  async function open(id:string){setError('');setNotice('');setBusy(true);try{show((await request(`/${id}`)).case);}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
  async function create(){setError('');setNotice('');setBusy(true);try{show((await request('',{method:'POST'})).case);setNotice('Kasus baru sudah dibuat. Isi log di bawah, lalu pilih Simpan log.');}catch(err){setError((err as Error).message);}finally{setBusy(false);}}
  function update(patch:Partial<GrowthCase>){setSelected(previous=>previous ? {...previous,...patch} : previous);setDirty(true);setNotice('');}
  function attemptChange(id:string,field:'hypothesis'|'action'|'result',value:CaseAttempt[typeof field]){setSelected(previous=>previous ? {...previous,attempts:previous.attempts.map(a=>a.id===id ? {...a,[field]:value} : a)} : previous);setDirty(true);setNotice('');}
  async function save(status?:'open'|'solved'){
    if(!selected)return;setBusy(true);setError('');setNotice('');
    try{const data=await request(`/${selected.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...selected,status:status || selected.status})});setSelected(data.case);setDirty(false);setNotice(status==='solved' ? 'Kasus ditandai Solved. Semua percobaan tersimpan.' : status==='open' ? 'Kasus dibuka kembali.' : 'Log berhasil disimpan.');}
    catch(err){setError((err as Error).message);}finally{setBusy(false);}
  }
  function back(){if(uploads || (dirty && !window.confirm('Perubahan belum disimpan. Kembali dan buang perubahan?')))return;setSelected(null);setDirty(false);setError('');setNotice('');window.history.replaceState(null,'',window.location.pathname);setLoading(true);list().catch(err=>setError(err.message)).finally(()=>setLoading(false));}
  function addAttempt(){if(!selected)return;const id=crypto.randomUUID();update({attempts:[...selected.attempts,{id,hypothesis:emptyDocument(),action:emptyDocument(),result:emptyDocument()}]});setExpanded([id]);}
  const onUploading=useCallback((uploading:boolean)=>setUploads(n=>Math.max(0,n+(uploading ? 1 : -1))),[]);
  return <main className={styles.root}>
    <div className={styles.header}><div><h1>Growth Execution · P0.1</h1><p className={styles.muted}>Catat masalah, uji tindakan, dan simpan hasil sampai kasus terpecahkan.</p></div>{!selected && <button className={styles.primary} disabled={busy} onClick={create}>+ Kasus baru</button>}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status" className={styles.notice}>{notice}</p>}
    {!selected ? <>
      <h2 style={{fontSize:18,fontWeight:600,marginBottom:14}}>Kasus saya</h2>
      <div className={styles.filters}><input aria-label="Cari judul kasus" placeholder="Cari judul kasus…" value={search} onChange={event=>setSearch(event.target.value)}/><select aria-label="Filter status" value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">Semua status</option><option value="open">Terbuka</option><option value="solved">Solved</option></select></div>
      {loading ? <p className={styles.muted} role="status">Memuat kasus…</p> : cases.length ? <div className={styles.list}>{cases.map(record=><button className={styles.caseCard} key={record.id} disabled={busy} onClick={()=>open(record.id)}><div><h2>{record.title}</h2><p className={styles.summary}>{documentText(record.problem).trim().slice(0,220) || 'Deskripsi masalah belum diisi.'}</p><span className={styles.date}>Diperbarui {date(record.updated_at)}</span></div><span className={`${styles.badge} ${record.status==='solved' ? styles.solved : ''}`}>{record.status==='solved' ? 'Solved' : 'Terbuka'}</span></button>)}</div> : <div className={styles.empty}><h2>{search || filter!=='all' ? 'Tidak ada kasus yang cocok' : 'Belum ada kasus'}</h2><p>{search || filter!=='all' ? 'Ubah pencarian atau filter status.' : 'Mulai dari satu masalah yang ingin Anda pecahkan.'}</p></div>}
      {!loading && cases.length<total && <button className={styles.loadMore} disabled={busy} onClick={async()=>{setBusy(true);try{await list(page+1);}catch(err){setError((err as Error).message);}finally{setBusy(false);}}}>Muat kasus berikutnya</button>}
    </> : <>
      <div className={styles.detail}>
        <div className={styles.detailTop}><button disabled={busy || uploads>0} onClick={back}>← Kasus saya</button><span className={`${styles.badge} ${selected.status==='solved' ? styles.solved : ''}`}>{selected.status==='solved' ? 'Solved' : 'Terbuka'}</span></div>
        <label className={styles.titleField}>Judul kasus<input value={selected.title} maxLength={160} disabled={busy} onChange={event=>update({title:event.target.value})}/></label>
        <GrowthCaseEditor key={`${selected.id}-problem`} label="Deskripsi masalah" value={selected.problem} caseId={selected.id} disabled={busy} onChange={value=>update({problem:value})} onUploading={onUploading}/>
        {selected.attempts.map((attempt,index)=><section key={attempt.id} className={styles.attempt}>
          <button className={styles.attemptToggle} disabled={busy || uploads>0} onClick={()=>setExpanded(ids=>ids.includes(attempt.id) ? ids.filter(id=>id!==attempt.id) : [...ids,attempt.id])} aria-expanded={expanded.includes(attempt.id)}><span>Percobaan {index+1} {expanded.includes(attempt.id) ? '▾' : '▸'}</span><span className={styles.attemptLabel}>{index===0 ? 'Langkah pertama' : 'Langkah lanjutan'}</span></button>
          {expanded.includes(attempt.id) && <>
            <GrowthCaseEditor label="Hipotesis" value={attempt.hypothesis} caseId={selected.id} disabled={busy} onChange={value=>attemptChange(attempt.id,'hypothesis',value)} onUploading={onUploading}/>
            <GrowthCaseEditor label="Aksi yang akan diambil" value={attempt.action} caseId={selected.id} disabled={busy} onChange={value=>attemptChange(attempt.id,'action',value)} onUploading={onUploading}/>
            <GrowthCaseEditor label="Hasilnya" value={attempt.result} caseId={selected.id} disabled={busy} onChange={value=>attemptChange(attempt.id,'result',value)} onUploading={onUploading}/>
            <p className={styles.muted} style={{fontSize:12,marginTop:8}}>Hasil bisa diisi setelah aksi dijalankan. Gambar dan tabel tersedia di setiap editor.</p>
          </>}
        </section>)}
        <div style={{marginTop:22}}><button disabled={busy || uploads>0 || selected.status==='solved' || selected.attempts.length>=50} onClick={addAttempt}>+ Percobaan berikutnya</button></div>
      </div>
      <div className={styles.actions}>
        <button className={styles.primary} disabled={busy || uploads>0 || !dirty} onClick={()=>save()}>{busy ? 'Menyimpan…' : 'Simpan log'}</button>
        <button className={selected.status==='open' ? styles.success : ''} disabled={busy || uploads>0} onClick={()=>save(selected.status==='open' ? 'solved' : 'open')}>{selected.status==='open' ? 'Tandai Solved' : 'Buka kembali'}</button>
        <span className={styles.muted} style={{fontSize:12}} role="status">{uploads ? 'Menunggu unggahan gambar…' : dirty ? 'Ada perubahan belum disimpan' : `Tersimpan · ${date(selected.updated_at)}`}</span>
      </div>
    </>}
  </main>;
}
