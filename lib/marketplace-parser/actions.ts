'use server';

import { requireDashboardTabAccess } from '../dashboard-access';
import { createServiceSupabase } from '../service-supabase';
import { isWorkspaceModuleEnabled } from '../workspaces';
import { defaultParserConfig, validateParserConfig } from './config';
import type { Catalog, ParserConfig } from './types';

async function access(expectedWorkspace: string) {
  const ctx=await requireDashboardTabAccess('marketplace-data-parser','Marketplace Data Parser');
  if (ctx.workspaceId!==expectedWorkspace) throw new Error('Workspace berubah. Muat ulang halaman sebelum melanjutkan.');
  if (!isWorkspaceModuleEnabled(ctx.workspace,'channels')) throw new Error('Sales Channel tidak aktif untuk workspace ini.');
  return ctx;
}
export async function getParserContext(expectedWorkspace: string): Promise<{workspaceId:string;config:ParserConfig;revision:number;catalog:Catalog;canSave:boolean}> {
  const ctx=await access(expectedWorkspace);const db=createServiceSupabase();
  const [businesses,settings]=await Promise.all([
    db.from('scalev_webhook_businesses').select('id,business_code,business_name').eq('workspace_id',ctx.workspaceId).eq('is_active',true).order('id'),
    db.from('marketplace_parser_configs').select('revision,config').eq('workspace_id',ctx.workspaceId).maybeSingle(),
  ]);
  if(businesses.error) throw new Error('Katalog business belum dapat dimuat. Coba muat ulang.');
  const missingSchema=settings.error && ['42P01','PGRST205'].includes(settings.error.code);
  if(settings.error && !missingSchema) throw new Error('Konfigurasi belum dapat dimuat. Coba muat ulang.');
  const codes=new Map((businesses.data||[]).map(b=>[Number(b.id),String(b.business_code)]));
  const catalog:Catalog={businesses:(businesses.data||[]).map(b=>({code:b.business_code,name:b.business_name})),stores:[],bundles:[],warehouses:[]};
  // Explicit columns only: never return business API keys/webhook secrets.
  for(let offset=0;codes.size;offset+=1000) {
    const page=await db.from('scalev_catalog_bundles').select('id,business_id,custom_id,name').eq('workspace_id',ctx.workspaceId).in('business_id',[...codes.keys()]).order('id').range(offset,offset+999);
    if(page.error) throw new Error('Katalog SKU belum tersedia. Sinkronkan Catalog & Master Data terlebih dahulu.');
    for(const b of page.data||[]) if(b.custom_id) catalog.bundles.push({business:codes.get(Number(b.business_id))!,sku:b.custom_id.trim(),name:b.name});
    if((page.data||[]).length<1000) break;
  }
  for(let offset=0;codes.size;offset+=1000) {
    const page=await db.from('scalev_store_channels').select('id,business_id,store_name').eq('workspace_id',ctx.workspaceId).in('business_id',[...codes.keys()]).eq('is_active',true).order('id').range(offset,offset+999);
    if(page.error) throw new Error('Katalog store belum dapat dimuat.');
    for(const s of page.data||[]) catalog.stores.push({business:codes.get(Number(s.business_id))!,name:s.store_name});
    if((page.data||[]).length<1000) break;
  }
  const scopes=await db.from('marketplace_intake_source_store_scopes').select('scalev_warehouse_name').eq('workspace_id',ctx.workspaceId).eq('is_enabled',true);
  // Names are suggestions from existing configuration, not a live warehouse catalog.
  if(!scopes.error) catalog.warehouses=[...new Set((scopes.data||[]).map(s=>String(s.scalev_warehouse_name||'').trim()).filter(Boolean))];
  const config=settings.data?.config || defaultParserConfig();validateParserConfig(config);
  return {workspaceId:ctx.workspaceId,config,revision:settings.data?.revision||0,catalog,canSave:!missingSchema};
}

export async function saveParserConfig(expectedWorkspace: string, expectedRevision: number, config: ParserConfig) {
  const ctx=await access(expectedWorkspace);validateParserConfig(config);
  if(!Number.isSafeInteger(expectedRevision) || expectedRevision<0) throw new Error('Versi konfigurasi tidak valid.');
  if(JSON.stringify(config).length>1024*1024) throw new Error('Konfigurasi terlalu besar.');
  const db=createServiceSupabase();
  const payload={config,revision:expectedRevision+1,updated_by:ctx.profile.id,updated_at:new Date().toISOString()};
  const result=expectedRevision===0
    ? await db.from('marketplace_parser_configs').insert({workspace_id:ctx.workspaceId,...payload}).select('revision').single()
    : await db.from('marketplace_parser_configs').update(payload).eq('workspace_id',ctx.workspaceId).eq('revision',expectedRevision).select('revision').maybeSingle();
  if(result.error?.code==='23505' || (!result.error && !result.data)) throw new Error('Konfigurasi telah diubah pengguna lain. Muat ulang sebelum menyimpan.');
  if(result.error) throw new Error('Konfigurasi belum dapat disimpan. Pastikan migration parser sudah diterapkan.');
  return {workspaceId:ctx.workspaceId,revision:result.data!.revision};
}
