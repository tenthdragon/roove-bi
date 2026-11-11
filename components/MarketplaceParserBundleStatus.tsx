'use client';
import { useEffect, useState } from 'react';
import type { DiagnosisRequest, ParserDiagnosis, RepairRequest, RepairResult } from '@/lib/marketplace-parser/diagnosis-types';
import styles from './MarketplaceParserTool.module.css';
export default function MarketplaceParserBundleStatus({workspace,account,revision,sku,version,busy,canManage,diagnose,repair}:{workspace:string;account:string;revision:number;sku:string;version:string;busy:boolean;canManage:boolean;diagnose:(w:string,r:DiagnosisRequest)=>Promise<ParserDiagnosis>;repair:(r:RepairRequest)=>Promise<RepairResult>}){
 const [data,setData]=useState<ParserDiagnosis|null>(null),[error,setError]=useState(''),[checking,setChecking]=useState(true);
 useEffect(()=>{let active=true;setChecking(true);setData(null);setError('');diagnose(workspace,{account,revision,skus:[sku]}).then(d=>{if(active)setData(d);}).catch(()=>{if(active)setError('Katalog belum dapat diperiksa. Muat ulang katalog.');}).finally(()=>{if(active)setChecking(false);});return()=>{active=false;};},[workspace,account,revision,sku,version,diagnose]);
 const item=data?.items[0],bundle=item?.bundles[0];
 return <div className={styles.bundleStatus} aria-live="polite">
  {checking?<small>Memeriksa bundle…</small>:error?<small>{error}</small>:item?.status==='missing'?<small>Bundle tidak ditemukan. Buat terlebih dulu di <a href="https://app.scalev.com/" target="_blank" rel="noopener noreferrer">Scalev ↗</a>.</small>:item?.status==='ambiguous'?<small>Kode bundle ganda. <a href="https://app.scalev.com/" target="_blank" rel="noopener noreferrer">Perbaiki di Scalev ↗</a></small>:item?.status==='unavailable'?<small>{item.message}</small>:bundle&&!bundle.availableInBusiness?<><small>Bundle ada di {bundle.owner}; belum tersedia di {data?.business}.</small>{canManage&&bundle.canShare?<button className={styles.linkButton} disabled={busy} onClick={async()=>{setError('');try{const result=await repair({token:data!.token,mode:'share',items:[{sku,bundleId:bundle.id}]});if(!result.synced)setError(result.message);}catch(e){setError(e instanceof Error?e.message:'Sharing belum berhasil.');}}}>Bagikan ke {data?.business}</button>:<a href={`https://app.scalev.com/bundles/${bundle.id}`} target="_blank" rel="noopener noreferrer">Buka di Scalev ↗</a>}</>:<small>Bundle tersedia. Muat ulang katalog.</small>}
 </div>;
}
