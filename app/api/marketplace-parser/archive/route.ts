import { NextRequest, NextResponse } from 'next/server';
import { parserAccess, parserActorName } from '@/lib/marketplace-parser/access';
import { getParserContext } from '@/lib/marketplace-parser/actions';
import { ARCHIVE_BUCKET, archiveSource, digest, readBatch } from '@/lib/marketplace-parser/archive';
import { createServiceSupabase } from '@/lib/service-supabase';
import { rejectUntrustedOrigin } from '@/lib/request-hardening';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){
  try {
    // Cookie-based uploads must originate from this application.
    const originError=rejectUntrustedOrigin(request);
    if(originError) return originError;
    const workspace=request.nextUrl.searchParams.get('workspace')||'';
    const actor=await parserAccess(workspace);
    const limit=11*1024*1024;
    if(Number(request.headers.get('content-length'))>limit)throw new Error('File terlalu besar. Maksimal 10 MB.');
    const reader=request.body?.getReader();if(!reader)throw new Error('File belum dipilih.');
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error('File terlalu besar. Maksimal 10 MB.');}chunks.push(value);}
    const body=Buffer.concat(chunks);
    const form=await new Request(request.url,{method:'POST',headers:{'content-type':request.headers.get('content-type')||''},body}).formData();
    const file=form.get('file');if(!file || typeof file==='string')throw new Error('Pilih file XLSX.');
    const ctx=await getParserContext(workspace,false);
    if(!ctx.revision || ctx.migrationNotes.length)throw new Error('Simpan aturan tim sebelum upload.');
    const batch=await archiveSource({workspace,actorId:actor.profile.id,actorName:await parserActorName(actor.profile.id),account:String(form.get('account')||''),date:String(form.get('date')||''),filename:file.name,bytes:new Uint8Array(await file.arrayBuffer()),config:ctx.config});
    return NextResponse.json(batch,{headers:{'Cache-Control':'no-store'}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Upload belum berhasil.'},{status:400});}
}
export async function GET(request:NextRequest){
  try{
    const workspace=request.nextUrl.searchParams.get('workspace')||'';
    await parserAccess(workspace);
    const db=createServiceSupabase(),batch=await readBatch(db,workspace,request.nextUrl.searchParams.get('batch')||'');
    const kind=request.nextUrl.searchParams.get('kind')||'source';
    let path=batch.source_path,hash=batch.source_sha256,name=batch.filename,type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if(kind!=='source'){
      if(!['csv','snapshot'].includes(kind))throw new Error('Jenis arsip tidak valid.');
      const exported=await db.from('marketplace_parser_exports').select('id,csv_path,snapshot_path,csv_sha256,snapshot_sha256').eq('workspace_id',workspace).eq('batch_id',batch.id).eq('id',request.nextUrl.searchParams.get('export')||'').single();
      if(exported.error||!exported.data)throw new Error('Arsip ekspor tidak ditemukan.');
      path=kind==='csv'?exported.data.csv_path:exported.data.snapshot_path;
      hash=kind==='csv'?exported.data.csv_sha256:exported.data.snapshot_sha256;
      name=`parser-${exported.data.id}.${kind==='csv'?'csv':'json'}`;type=kind==='csv'?'text/csv':'application/json';
    }
    if(!path.startsWith(`${workspace}/${batch.id}/`))throw new Error('Lokasi arsip tidak valid.');
    const stored=await db.storage.from(ARCHIVE_BUCKET).download(path);
    if(stored.error||!stored.data)throw new Error('File arsip belum dapat diambil.');
    const bytes=new Uint8Array(await stored.data.arrayBuffer());
    if(digest(bytes)!==hash)throw new Error('Integritas arsip tidak sesuai. Hubungi pengelola aplikasi.');
    return new NextResponse(bytes,{headers:{'Content-Type':type,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Arsip tidak dapat dibuka.'},{status:400,headers:{'Cache-Control':'no-store'}});}
}
