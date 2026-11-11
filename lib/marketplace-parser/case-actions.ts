'use server';

import { requireDashboardPermissionAccess, requireDashboardTabAccess } from '../dashboard-access';
import { createServiceSupabase } from '../service-supabase';
import { isWorkspaceModuleEnabled } from '../workspaces';
import { syncScalevCatalogBusiness } from '../scalev-catalog-actions';
import { getParserContext } from './actions';
import { readParserCatalog } from './catalog';
import { messageOf, shareBundles, type CatalogConnection } from './diagnosis';
import { readCachedDiagnosis } from './cached-diagnosis';
import { signDiagnosis, verifyDiagnosis } from './diagnosis-token';
import { ParserScalevClient } from './scalev-client';
import { claimCatalogBusiness, assertCatalogBusinessClaim, failCatalogBusinessClaim } from '../scalev-catalog-lease';
import type { DiagnosisRequest, RepairRequest, RepairResult } from './diagnosis-types';

async function access(workspaceId: string, manage = false) {
  const ctx = await requireDashboardTabAccess('marketplace-data-parser','Marketplace Data Parser');
  if (ctx.workspaceId !== workspaceId) throw new Error('Workspace berubah. Muat ulang halaman.');
  if (!isWorkspaceModuleEnabled(ctx.workspace,'channels')) throw new Error('Sales Channel tidak aktif untuk workspace ini.');
  if (manage) {
    if (process.env.ROOVE_LOCAL_DEV === '1') throw new Error('Perubahan langsung Scalev tidak aktif di lingkungan lokal.');
    await requireDashboardTabAccess('warehouse-settings','Katalog Scalev');
    const manager = await requireDashboardPermissionAccess('whs:mapping','Pengelolaan katalog Scalev');
    if (manager.workspaceId !== workspaceId || manager.profile.id !== ctx.profile.id) throw new Error('Sesi atau workspace berubah.');
  }
  return ctx;
}
export async function diagnoseParserCase(workspaceId: string, input: DiagnosisRequest) {
  const ctx = await access(workspaceId);
  if (!input || typeof input.account !== 'string' || !Number.isSafeInteger(input.revision) || !Array.isArray(input.skus) || !input.skus.length || input.skus.length > 50 || input.skus.some(s => typeof s !== 'string' || !s.trim() || s.length > 500)) throw new Error('Periksa maksimal 50 SKU berbeda yang memiliki identifier code.');
  const context = await getParserContext(workspaceId,false);
  if (!context.revision || context.revision !== input.revision || context.migrationNotes.length) throw new Error('Aturan berubah atau belum tersimpan. Muat ulang dan simpan aturan tim sebelum memeriksa.');
  const account = context.config.accounts.find(a => a.id === input.account);
  const target = context.catalog.businesses.find(c => c.code === account?.business);
  if (!account || !target) throw new Error('Business akun asal belum terhubung atau tidak aktif. Perbaiki aturan akun.');
  const scoped = context.catalog.stores.filter(s => s.business === target.code && context.config.stores.some(scope => scope.storeId === s.id));
  const skus = [...new Set(input.skus.map(s => s.trim()))];
  try {
    const result = await readCachedDiagnosis({ workspaceId,actorId: ctx.profile.id,revision: context.revision,account: account.id,skus,config: context.config,stores: scoped });
    return { ...result.diagnosis,token: signDiagnosis(result.permit) };
  } catch {
    const message = 'Data katalog aplikasi belum dapat diperiksa. Pastikan sinkronisasi Business selesai, lalu muat ulang data aplikasi.';
    return { checkedAt: new Date().toISOString(),business: target.code,account: account.label,stores: [],suggestedStoreId: null,items: skus.map(sku => ({ sku,status: 'unavailable' as const,bundles: [],message })),issues: [message],token: '' };
  }
}

export async function repairParserCase(workspaceId: string, input: RepairRequest) {
  const ctx = await access(workspaceId,true);
  if (!input || !['refresh','share'].includes(input.mode) || !Array.isArray(input.items) || input.items.length > 50 || JSON.stringify(input).length > 210000 || Object.keys(input).some(k => !['token','mode','items'].includes(k))) throw new Error('Permintaan perbaikan tidak valid. Muat ulang halaman untuk menggunakan aturan terbaru.');
  if (input.mode === 'refresh' && input.items.length) throw new Error('Pembaruan katalog tidak menerima perubahan bundle.');
  const permit = verifyDiagnosis(input.token,workspaceId,ctx.profile.id);
  const context = await getParserContext(workspaceId,false);
  if (context.revision !== permit.revision || context.migrationNotes.length) throw new Error('Aturan berubah. Periksa masalah kembali menggunakan aturan terbaru.');
  const account = context.config.accounts.find(a => a.id === permit.account);
  const targetBusiness = context.catalog.businesses.find(b => b.id === permit.targetBusinessId && b.code === account?.business);
  if (!targetBusiness) throw new Error('Business akun asal berubah atau tidak aktif.');
  if (input.mode === 'share' && (!input.items.length || new Set(input.items.map(i => i?.sku)).size !== input.items.length || input.items.some(i => !i || typeof i.sku !== 'string' || !Number.isSafeInteger(i.bundleId) || Object.keys(i).some(k => !['sku','bundleId'].includes(k)) || !permit.bundles.some(b => b.sku === i.sku && b.id === i.bundleId && b.canShare)))) throw new Error('Pilihan bundle tidak sesuai diagnosis. Periksa masalah kembali.');
  const db = createServiceSupabase();
  const ids = [targetBusiness.id,...permit.bundles.filter(b => input.items.some(i => i.bundleId === b.id && i.sku === b.sku)).map(b => b.sourceBusinessId)];
  const connections = await db.from('scalev_webhook_businesses').select('id,business_code,api_key').eq('workspace_id',workspaceId).eq('is_active',true).in('id',[...new Set(ids)]);
  if (connections.error || !connections.data || ids.some(id => !connections.data.some(b => b.id === id))) throw new Error('Koneksi Business berubah. Periksa kembali.');
  const all: CatalogConnection[] = connections.data.map(b => ({ id: b.id,code: b.business_code,client: new ParserScalevClient(b.api_key || '') }));
  const target = all.find(b => b.id === targetBusiness.id)!;
  const started = await claimCatalogBusiness(workspaceId,target.id,target.code);
  const ensureCurrent = async () => {
    const current = await access(workspaceId,true);
    if (current.profile.id !== ctx.profile.id) throw new Error('Sesi pengguna berubah.');
    const latest = await db.from('marketplace_parser_configs').select('revision').eq('workspace_id',workspaceId).single();
    if (latest.error || latest.data.revision !== permit.revision) throw new Error('Aturan tim berubah saat perbaikan. Muat ulang aturan.');
    const active = await db.from('scalev_webhook_businesses').select('id').eq('workspace_id',workspaceId).eq('is_active',true).in('id',[...new Set(ids)]);
    if (active.error || ids.some(id => !active.data?.some(b => b.id === id))) throw new Error('Koneksi Business berubah saat perbaikan.');
    await assertCatalogBusinessClaim(workspaceId,target.id,started);
  };
  const audit = async (stage: string,details: Record<string,unknown>) => {
    const saved = await db.from('warehouse_activity_log').insert({ workspace_id: workspaceId,scope: 'scalev_catalog_sync',action: `parser_bundle_${stage}`,screen: 'marketplace-data-parser',summary: `${stage}: ${target.code}`,target_type: 'business',target_id: String(target.id),target_label: target.code,business_code: target.code,acted_by: ctx.profile.id,acted_by_name: 'Pengguna parser',before_state: {},after_state: details,context: { account: permit.account,revision: permit.revision },changed_fields: ['bundle_business_availability'] });
    if (saved.error) throw new Error('Audit aksi belum dapat disimpan.');
  };
  const result: RepairResult = { items: [],synced: false,message: '' };
  try {
    await ensureCurrent();
    const identity = await target.client.identity();
    if (permit.targetUid && identity.unique_id !== permit.targetUid) throw new Error('Business Scalev berubah. Periksa kembali.');
    permit.targetUid = identity.unique_id;
    const assertUnique = async (sku: string,id: number) => {
      const rows = await db.from('scalev_catalog_bundles').select('scalev_bundle_id').eq('workspace_id',workspaceId).eq('business_id',target.id).eq('custom_id',sku).limit(2);
      if (rows.error || rows.data?.some(row => row.scalev_bundle_id !== id)) throw new Error('Identifier code berubah atau ambigu. Muat ulang data aplikasi.');
    };
    if (input.mode === 'share') result.items = await shareBundles({ permit,request: input,target,connections: all,ensureCurrent,audit,assertUnique });
    await ensureCurrent();
    // Reuse the full Business sync so shared bundles and duplicate identifiers
    // are reconciled before revalidating every order. No Store/BPO writes occur.
    // Release into a non-ready state; the ordinary sync acquires a new claim.
    await failCatalogBusinessClaim(workspaceId,target.id,started);
    const sync = await syncScalevCatalogBusiness(target.id);
    if (!sync.success) throw new Error('Sinkronisasi Business belum selesai.');
    result.synced = true;
    result.message = result.items.some(i => i.stage !== 'ready') ? 'Sebagian sharing belum selesai. Katalog Business dimuat ulang; periksa hasil setiap SKU.' : 'Katalog Business diperbarui. Seluruh batch divalidasi ulang.';
    await audit('completed',{ synced: true,items: result.items });
  } catch (error) {
    result.message = `${messageOf(error)} ${result.synced ? 'Periksa hasil terbaru.' : 'Sinkronkan Business sebelum download.'}`;
  } finally {
    if (!result.synced) await failCatalogBusinessClaim(workspaceId,target.id,started);
  }
  return { result,catalog: await readParserCatalog(workspaceId,context.config.stores.map(s => s.storeId).filter(id => context.catalog.stores.some(s => s.id === id)),db,[...new Set(context.config.accounts.map(a => a.business))].filter(code => context.catalog.businesses.some(b => b.code === code))) };
}
