import { createHash, randomUUID } from 'node:crypto';
import { createServiceSupabase } from '../service-supabase';
import { readMarketplaceFile } from './read';
import type { ParserBatch, ParserBatchSummary, ParserConfig, Projection } from './types';
export const ARCHIVE_BUCKET='marketplace-parser-archive';
export const digest=(data: string | Uint8Array)=>createHash('sha256').update(data).digest('hex');
type Db=ReturnType<typeof createServiceSupabase>;
export type BatchRow={id:string;workspace_id:string;account_id:string;business_code:string;filename:string;source_path:string;source_sha256:string;byte_size:number;batch_date:string;parsed_file:ParserBatch['file'];created_at:string;actor_name:string;order_count:number};
export const batchView=(row:BatchRow):ParserBatch=>({id:row.id,filename:row.filename,sourceSha256:row.source_sha256,account:row.account_id,business:row.business_code,date:row.batch_date,createdAt:row.created_at,actor:row.actor_name,file:row.parsed_file});
export async function readBatch(db:Db,workspace:string,id:string):Promise<BatchRow>{
  if(!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Batch tidak valid.');
  const result=await db.from('marketplace_parser_batches').select('*').eq('workspace_id',workspace).eq('id',id).single();
  if(result.error || !result.data) throw new Error('Arsip batch tidak ditemukan dalam workspace ini.');
  return result.data;
}
export function assertBatchAccount(batch:BatchRow,config:ParserConfig){
  const account=config.accounts.find(a=>a.id===batch.account_id);
  if(!account || account.business!==batch.business_code || batch.parsed_file.orders.some(o=>o.platform!==account.marketplace)) throw new Error('Akun atau Business batch berubah. Upload ulang dengan akun yang benar; arsip lama tetap tersedia.');
}
export async function archiveSource(input:{workspace:string;actorId:string;actorName:string;account:string;date:string;filename:string;bytes:Uint8Array;config:ParserConfig},db=createServiceSupabase()):Promise<ParserBatch>{
  const account=input.config.accounts.find(a=>a.id===input.account);
  if(!account?.business) throw new Error('Pilih akun asal dengan Business yang valid.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0,10)!==input.date) throw new Error('Tanggal batch tidak valid.');
  const filename=input.filename.replace(/[\u0000-\u001f]/g,'').slice(0,250);
  const file=readMarketplaceFile(Uint8Array.from(input.bytes).buffer,filename);
  if(file.orders.some(o=>o.platform!==account.marketplace)) throw new Error('File tidak sesuai Marketplace akun asal.');
  if(Buffer.byteLength(JSON.stringify(file))>32*1024*1024) throw new Error('Isi batch terlalu besar. Pecah file sebelum upload.');
  const id=randomUUID(),path=`${input.workspace}/${id}/source.xlsx`;
  const upload=await db.storage.from(ARCHIVE_BUCKET).upload(path,input.bytes,{contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',upsert:false});
  if(upload.error) throw new Error('File asli belum berhasil diarsipkan. Coba upload kembali.');
  const row={id,workspace_id:input.workspace,account_id:account.id,business_code:account.business,account_snapshot:account,filename,source_path:path,source_sha256:digest(input.bytes),byte_size:input.bytes.byteLength,batch_date:input.date,parsed_file:file,order_count:file.orders.length,created_by:input.actorId,actor_name:input.actorName};
  const saved=await db.from('marketplace_parser_batches').insert(row).select('*').single();
  if(saved.error) { await db.storage.from(ARCHIVE_BUCKET).remove([path]); throw new Error('Arsip batch belum berhasil disimpan. Coba upload kembali.'); }
  return batchView(saved.data);
}
export async function archiveExport(input:{workspace:string;batch:BatchRow;actorId:string;actorName:string;csv:string;projection:Projection;catalogVersion:string;decisions:unknown},db=createServiceSupabase()){
  const id=randomUUID(),prefix=`${input.workspace}/${input.batch.id}/${id}`;
  const snapshot=JSON.stringify({parserVersion:4,batchId:input.batch.id,sourceSha256:input.batch.source_sha256,catalogVersion:input.catalogVersion,decisions:input.decisions,...input.projection});
  const objects=[{path:`${prefix}/output.csv`,body:input.csv,type:'text/csv'},{path:`${prefix}/snapshot.json`,body:snapshot,type:'application/json'}];
  const uploaded:string[]=[];
  try {
    for(const object of objects){const result=await db.storage.from(ARCHIVE_BUCKET).upload(object.path,object.body,{contentType:object.type,upsert:false});if(result.error)throw new Error('Arsip hasil parsing belum tersimpan. Coba lagi.');uploaded.push(object.path);}
    const row={id,workspace_id:input.workspace,batch_id:input.batch.id,business_code:input.batch.business_code,config_revision:input.projection.configRevision,catalog_version:input.catalogVersion,csv_path:objects[0].path,snapshot_path:objects[1].path,csv_sha256:digest(input.csv),snapshot_sha256:digest(snapshot),created_by:input.actorId,actor_name:input.actorName};
    const result=await db.from('marketplace_parser_exports').insert(row);
    if(result.error)throw new Error('Riwayat ekspor belum tersimpan. Coba lagi.');
    return id;
  } catch(error){if(uploaded.length)await db.storage.from(ARCHIVE_BUCKET).remove(uploaded);throw error;}
}
export async function listBatches(db:Db,workspace:string,offset:number):Promise<ParserBatchSummary[]>{
  const result=await db.from('marketplace_parser_batches').select('id,filename,source_sha256,account_id,business_code,batch_date,created_at,actor_name,order_count').eq('workspace_id',workspace).order('created_at',{ascending:false}).order('id').range(offset,offset+19);
  if(result.error)throw new Error('Riwayat batch belum dapat dimuat.');
  return (result.data||[]).map(row=>({id:row.id,filename:row.filename,sourceSha256:row.source_sha256,account:row.account_id,business:row.business_code,date:row.batch_date,createdAt:row.created_at,actor:row.actor_name,orderCount:row.order_count}));
}
