'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { getParserContext, saveParserConfig, getParserCatalog, syncParserCatalogBusiness, prepareParserDownload } from '@/lib/marketplace-parser/actions';
import MarketplaceParserTool from '@/components/MarketplaceParserTool';
import { diagnoseParserCase, repairParserCase } from '@/lib/marketplace-parser/case-actions';

export default function MarketplaceDataParserPage() {
  const {activeWorkspace}=useWorkspace();
  return <ParserWorkspace key={activeWorkspace.id} workspaceId={activeWorkspace.id} />;
}
function ParserWorkspace({workspaceId}:{workspaceId:string}) {
  const [data,setData]=useState<Awaited<ReturnType<typeof getParserContext>>|null>(null);
  const [error,setError]=useState('');const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;setError('');
    getParserContext(workspaceId).then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Gagal memuat konfigurasi.');});
    return ()=>{active=false;};
  },[workspaceId,attempt]);
  if(error) return <section><h1 style={{fontSize:24,fontWeight:700}}>Marketplace Data Parser</h1><p role="alert" style={{color:'var(--red)',margin:'16px 0'}}>{error}</p><button className="btn btn-primary" onClick={()=>setAttempt(n=>n+1)}>Muat ulang konfigurasi</button></section>;
  if(!data) return <section aria-busy="true"><h1 style={{fontSize:24,fontWeight:700}}>Marketplace Data Parser</h1><p role="status" style={{marginTop:16,color:'var(--dim)'}}>Memuat konfigurasi dan katalog produk…</p></section>;
  return <MarketplaceParserTool context={data} saveConfig={saveParserConfig} loadCatalog={getParserCatalog} syncBusiness={syncParserCatalogBusiness} reloadContext={getParserContext} prepareDownload={prepareParserDownload} diagnoseCase={diagnoseParserCase} repairCase={repairParserCase} />;
}
