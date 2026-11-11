'use server';

import { requireDashboardTabAccess, requireDashboardPermissionAccess } from '../dashboard-access';
import { createServiceSupabase } from '../service-supabase';
import { migrateParserConfig, validateCatalogConfig, validateParserConfig } from './config';
import { readParserCatalog } from './catalog';
import { syncScalevCatalogBusiness } from '../scalev-catalog-actions';
import { exportBusinessCsv, projectMarketplace } from './project';
import type { ParserConfig, ParserContext } from './types';

import { parserAccess as access, parserActorName } from './access';
import { archiveExport, assertBatchAccount, batchView, readBatch, listBatches, digest } from './archive';
import { latestDecision } from './routing';
import { randomUUID } from 'node:crypto';

export async function getParserContext(expectedWorkspace: string, includeBundles = true): Promise<ParserContext> {
  const ctx = await access(expectedWorkspace), db = createServiceSupabase();
  const settings = await db.from('marketplace_parser_configs').select('revision,config').eq('workspace_id',ctx.workspaceId).maybeSingle();
  const missingSchema = settings.error && ['42P01','PGRST205'].includes(settings.error.code);
  if (settings.error && !missingSchema) throw new Error('Konfigurasi belum dapat dimuat. Coba muat ulang.');
  const metadata = await readParserCatalog(ctx.workspaceId,[],db);
  const migrated = migrateParserConfig(settings.data?.config,metadata);
  const businessCodes = [...new Set(migrated.config.accounts.map(a => a.business))].filter(code => metadata.businesses.some(b => b.code === code));
  const catalog = includeBundles ? await readParserCatalog(ctx.workspaceId,migrated.config.stores.map(s => s.storeId).filter(id => metadata.stores.some(s => s.id === id)),db,businessCodes) : metadata;
  let canManageCatalog = false;
  try { await requireDashboardTabAccess('warehouse-settings','Katalog Scalev'); const manager = await requireDashboardPermissionAccess('whs:mapping','Pengelolaan katalog Scalev'); canManageCatalog = manager.workspaceId === ctx.workspaceId && manager.profile.id === ctx.profile.id; } catch { /* Diagnosis remains available to parser readers. */ }
  return { workspaceId: ctx.workspaceId,config: migrated.config,revision: settings.data?.revision || 0,catalog,canSave: !missingSchema,canSync: process.env.ROOVE_LOCAL_DEV !== '1',canManageCatalog,migrationNotes: migrated.notes };
}
export async function getParserCatalog(expectedWorkspace: string, storeIds: number[], businessCodes?: string[]) {
  const ctx = await access(expectedWorkspace);
  return readParserCatalog(ctx.workspaceId,storeIds,undefined,businessCodes);
}
export async function syncParserCatalogBusiness(expectedWorkspace: string, businessCode: string) {
  const ctx = await access(expectedWorkspace);
  if (process.env.ROOVE_LOCAL_DEV === '1') throw new Error('Sinkronisasi langsung Scalev tidak aktif di lingkungan lokal.');
  const manager = await requireDashboardPermissionAccess('whs:mapping','Pengelolaan katalog Scalev');
  if (manager.workspaceId !== ctx.workspaceId || manager.profile.id !== ctx.profile.id) throw new Error('Sesi atau workspace berubah.');
  const metadata = await readParserCatalog(ctx.workspaceId,[]);
  const business = metadata.businesses.find(b => b.code === businessCode);
  if (!business) throw new Error('Business tidak aktif atau bukan milik workspace ini.');
  return syncScalevCatalogBusiness(business.id);
}
export async function saveParserConfig(expectedWorkspace: string, expectedRevision: number, config: ParserConfig) {
  const ctx = await access(expectedWorkspace); validateParserConfig(config);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Versi konfigurasi tidak valid.');
  if (JSON.stringify(config).length > 1024 * 1024) throw new Error('Konfigurasi terlalu besar.');
  const db = createServiceSupabase(), catalog = await readParserCatalog(ctx.workspaceId,[],db);
  validateCatalogConfig(config,catalog);
  const payload = { config,revision: expectedRevision + 1,updated_by: ctx.profile.id,updated_at: new Date().toISOString() };
  const result = expectedRevision === 0
    ? await db.from('marketplace_parser_configs').insert({ workspace_id: ctx.workspaceId,...payload }).select('revision').single()
    : await db.from('marketplace_parser_configs').update(payload).eq('workspace_id',ctx.workspaceId).eq('revision',expectedRevision).select('revision').maybeSingle();
  if (result.error?.code === '23505' || (!result.error && !result.data)) throw new Error('Konfigurasi telah diubah pengguna lain. Muat ulang sebelum menyimpan.');
  if (result.error) throw new Error('Konfigurasi belum dapat disimpan. Pastikan migration parser terbaru sudah diterapkan.');
  return { workspaceId: ctx.workspaceId,revision: result.data!.revision };
}
export async function prepareParserDownload(expectedWorkspace: string, input: { batchId: string; revision: number; catalogVersion: string }) {
  const actor=await access(expectedWorkspace);
  if(!input || Object.keys(input).some(k=>!['batchId','revision','catalogVersion'].includes(k))) throw new Error('Data marketplace tidak boleh dikoreksi. Gunakan batch arsip.');
  const db=createServiceSupabase(), batch=await readBatch(db,expectedWorkspace,input.batchId);
  const ctx=await getParserContext(expectedWorkspace);
  assertBatchAccount(batch,ctx.config);
  if(!ctx.revision || ctx.migrationNotes.length || ctx.revision!==input.revision) throw new Error('Konfigurasi berubah atau belum disimpan. Muat ulang aturan dan validasi batch sebelum download.');
  if(ctx.catalog.version!==input.catalogVersion) throw new Error('Katalog berubah. Muat ulang katalog dan periksa preview terbaru sebelum download.');
  const projection=projectMarketplace({file:batch.parsed_file,account:batch.account_id,date:batch.batch_date,config:ctx.config,revision:ctx.revision,catalog:ctx.catalog});
  const csv=exportBusinessCsv(projection,batch.business_code);
  const latest=await getParserContext(expectedWorkspace);
  if(latest.revision!==ctx.revision || latest.catalog.version!==ctx.catalog.version) throw new Error('Aturan atau katalog berubah saat validasi. Muat ulang sebelum download.');
  const exportId=await archiveExport({workspace:expectedWorkspace,batch,actorId:actor.profile.id,actorName:await parserActorName(actor.profile.id),csv,projection,catalogVersion:ctx.catalog.version,decisions:ctx.catalog.decisions});
  return {business:batch.business_code,csv,revision:ctx.revision,catalogVersion:ctx.catalog.version,exportId};
}
export async function listParserBatches(workspace:string,offset=0){
  await access(workspace);
  if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw new Error('Halaman tidak valid.');
  return listBatches(createServiceSupabase(),workspace,offset);
}
export async function openParserBatch(workspace:string,id:string){
  await access(workspace);return batchView(await readBatch(createServiceSupabase(),workspace,id));
}
export async function listParserExports(workspace:string,batchId:string){
  await access(workspace);const db=createServiceSupabase();await readBatch(db,workspace,batchId);
  const result=await db.from('marketplace_parser_exports').select('id,created_at,actor_name,config_revision,business_code').eq('workspace_id',workspace).eq('batch_id',batchId).order('created_at',{ascending:false});
  if(result.error)throw new Error('Riwayat ekspor belum dapat dimuat.');
  return (result.data||[]).map(r=>({id:r.id,createdAt:r.created_at,actor:r.actor_name,configRevision:r.config_revision,business:r.business_code}));
}
export async function approveParserStore(workspace:string,input:{batchId:string;orderKey:string;storeId:number;revision:number;catalogVersion:string;previousDecisionId:string|null}){
  const actor=await access(workspace),db=createServiceSupabase();
  if(!input || typeof input.orderKey!=='string' || !Number.isSafeInteger(input.storeId))throw new Error('Keputusan Store tidak valid.');
  const batch=await readBatch(db,workspace,input.batchId),ctx=await getParserContext(workspace);
  assertBatchAccount(batch,ctx.config);
  if(!ctx.revision || ctx.migrationNotes.length || ctx.revision!==input.revision || ctx.catalog.version!==input.catalogVersion)throw new Error('Aturan atau katalog berubah. Muat ulang sebelum menetapkan Store.');
  const order=projectMarketplace({file:batch.parsed_file,account:batch.account_id,date:batch.batch_date,config:ctx.config,revision:ctx.revision,catalog:ctx.catalog}).orders.find(o=>o.source.key===input.orderKey);
  if(!order?.routing?.caseKey || order.lines.some(l=>l.bundleId===null) || order.routing.items.length>200 || ctx.catalog.businessSyncs.find(b=>b.business===batch.business_code)?.status!=='ready')throw new Error('Selesaikan kecocokan bundle di Business sebelum memilih Store.');
  const store=ctx.catalog.stores.find(s=>s.id===input.storeId && s.business===batch.business_code && ctx.config.stores.some(scope=>scope.storeId===s.id));
  if(!store)throw new Error('Store harus aktif, dipilih, dan berada di Business akun asal.');
  const previous=latestDecision(ctx.catalog.decisions||[],batch.account_id,batch.business_code,order.routing.caseKey);
  if((previous?.id||null)!==input.previousDecisionId)throw new Error('Keputusan sudah berubah. Muat ulang sebelum menyimpan.');
  const result=await db.from('marketplace_parser_route_decisions').insert({id:randomUUID(),workspace_id:workspace,account_id:batch.account_id,business_code:batch.business_code,case_key:order.routing.caseKey,case_hash:digest(order.routing.caseKey),items:order.routing.items,store_id:store.id,store_name:store.name,revision:(previous?.revision||0)+1,source_batch_id:batch.id,source_order_key:order.source.key,created_by:actor.profile.id,actor_name:await parserActorName(actor.profile.id)});
  if(result.error)throw new Error(result.error.code==='23505'?'Keputusan sudah disimpan pengguna lain. Muat ulang.':'Keputusan belum tersimpan. Coba lagi.');
  return getParserContext(workspace);
}
