'use server';

import { requireDashboardPermissionAccess, requireDashboardTabAccess } from '../dashboard-access';
import { createServiceSupabase } from '../service-supabase';
import { isWorkspaceModuleEnabled } from '../workspaces';
import { getParserContext } from './actions';
import { readParserCatalog } from './catalog';
import { allowedRepairStores, messageOf, repairBundles, type CatalogConnection, type DiagnosisStore } from './diagnosis';
import { readCachedDiagnosis } from './cached-diagnosis';
import { cachedBundleMetadata } from './catalog-metadata';
import { signDiagnosis, verifyDiagnosis } from './diagnosis-token';
import { ParserScalevClient } from './scalev-client';
import { assertParserStoreClaim, claimParserStore, failParserStoreClaim, syncParserStore } from './sync';
import type { DiagnosisRequest, RepairRequest, RepairResult } from './diagnosis-types';

async function access(workspaceId: string, manage = false, live = false) {
  const ctx = await requireDashboardTabAccess('marketplace-data-parser','Marketplace Data Parser');
  if (ctx.workspaceId !== workspaceId) throw new Error('Workspace berubah. Muat ulang halaman.');
  if (!isWorkspaceModuleEnabled(ctx.workspace,'channels')) throw new Error('Sales Channel tidak aktif untuk workspace ini.');
  if (live && process.env.ROOVE_LOCAL_DEV === '1') throw new Error('Perubahan langsung Scalev tidak aktif di lingkungan lokal.');
  if (manage) {
    const manager = await requireDashboardPermissionAccess('whs:mapping','Pengelolaan katalog Scalev');
    if (manager.workspaceId !== workspaceId || manager.profile.id !== ctx.profile.id) throw new Error('Sesi atau workspace berubah. Muat ulang halaman.');
  }
  return ctx;
}
async function connections(workspaceId: string): Promise<CatalogConnection[]> {
  const result = await createServiceSupabase().from('scalev_webhook_businesses').select('id,business_code,api_key').eq('workspace_id',workspaceId).eq('is_active',true).limit(101);
  if (result.error || !result.data || result.data.length > 100) throw new Error('Daftar koneksi Business belum dapat dimuat dengan lengkap.');
  // Credentials are loaded only for an explicitly requested live action.
  return result.data.map(row => ({ id: row.id,code: row.business_code,client: new ParserScalevClient(row.api_key || '') }));
}
async function stores(workspaceId: string, businessId: number, ids: number[]): Promise<DiagnosisStore[]> {
  if (!ids.length) return [];
  if (ids.length > 100) throw new Error('Batasi Store yang digunakan hingga 100 sebelum memeriksa masalah.');
  const db = createServiceSupabase();
  const query = (columns: string) => db.from('scalev_store_channels').select(columns).eq('workspace_id',workspaceId).eq('business_id',businessId).eq('is_active',true).in('id',ids);
  let result = await query('id,store_name,scalev_store_id,store_unique_id');
  // Older production Store masters predate optional Scalev identifier columns.
  // Diagnosis uses cached links; an explicit action verifies the live identity.
  if (result.error && ['42703','PGRST204'].includes(result.error.code) && /scalev_store_id|store_unique_id/.test(result.error.message)) result = await query('id,store_name');
  if (result.error || !result.data) throw new Error('Store Business tujuan belum dapat dimuat.');
  return (result.data as unknown as { id: number; store_name: string; scalev_store_id?: number; store_unique_id?: string }[]).map(s => ({ id: s.id,name: s.store_name,scalevId: s.scalev_store_id || null,uniqueId: s.store_unique_id || null }));
}
export async function diagnoseParserCase(workspaceId: string, input: DiagnosisRequest) {
  const ctx = await access(workspaceId);
  if (!input || typeof input.account !== 'string' || !Number.isSafeInteger(input.revision) || !Array.isArray(input.skus) || !input.skus.length || input.skus.length > 50 || input.skus.some(s => typeof s !== 'string' || !s.trim() || s.length > 500)) throw new Error('Periksa maksimal 50 SKU berbeda yang memiliki identifier code.');
  const context = await getParserContext(workspaceId,false);
  if (!context.revision || context.revision !== input.revision || context.migrationNotes.length) throw new Error('Aturan berubah atau belum tersimpan. Muat ulang dan simpan aturan tim sebelum memeriksa.');
  const account = context.config.accounts.find(a => a.id === input.account);
  const target = context.catalog.businesses.find(c => c.code === account?.business);
  if (!account || !target) throw new Error('Business akun asal belum terhubung atau tidak aktif. Perbaiki aturan akun.');
  const scoped = await stores(workspaceId,target.id,context.config.stores.map(s => s.storeId));
  const skus = [...new Set(input.skus.map(s => s.trim()))];
  let result: Awaited<ReturnType<typeof readCachedDiagnosis>>;
  try {
    result = await readCachedDiagnosis({ workspaceId,actorId: ctx.profile.id,revision: context.revision,account: account.id,skus,config: context.config,stores: scoped });
  } catch {
    // Next.js masks thrown Server Action errors in production. Return a safe,
    // incomplete diagnosis as data; never mint a repair permit after a failed read.
    const message = 'Data katalog aplikasi belum dapat diperiksa. Pastikan sinkronisasi selesai, lalu muat ulang data aplikasi.';
    return { checkedAt: new Date().toISOString(),business: target.code,account: account.label,stores: [],suggestedStoreId: null,items: skus.map(sku => ({ sku,status: 'unavailable' as const,bundles: [],message })),issues: [message],token: '' };
  }
  return { ...result.diagnosis,token: signDiagnosis(result.permit) };
}

export async function repairParserCase(workspaceId: string, input: RepairRequest) {
  const ctx = await access(workspaceId,input?.mode === 'attach',true);
  if (!input || !['refresh','attach'].includes(input.mode) || !Number.isSafeInteger(input.storeId) || !Array.isArray(input.items) || input.items.length > 50 || JSON.stringify(input).length > 210000) throw new Error('Permintaan perbaikan tidak valid.');
  if (input.mode === 'refresh' && input.items.length) throw new Error('Pembaruan katalog tidak menerima perubahan bundle.');
  const permit = verifyDiagnosis(input.token,workspaceId,ctx.profile.id);
  const context = await getParserContext(workspaceId,false);
  if (context.revision !== permit.revision || context.migrationNotes.length) throw new Error('Aturan berubah. Periksa masalah kembali menggunakan aturan terbaru.');
  const account = context.config.accounts.find(a => a.id === permit.account);
  const all = await connections(workspaceId), target = all.find(c => c.id === permit.targetBusinessId && c.code === account?.business);
  if (!target) throw new Error('Business akun asal berubah atau sudah tidak aktif.');
  const scoped = await stores(workspaceId,target.id,context.config.stores.map(s => s.storeId));
  const allowed = allowedRepairStores(context.config,permit.account,permit.skus,scoped);
  const store = permit.stores.find(s => s.id === input.storeId), savedStore = allowed.stores.find(s => s.id === input.storeId);
  if (!store || !savedStore || savedStore.name !== store.name || (savedStore.scalevId && savedStore.scalevId !== store.scalevId)) throw new Error('Store tidak sesuai lingkup Business atau routing yang tersimpan. Perbaiki aturan parsing.');
  if (input.mode === 'attach' && (!input.items.length || input.items.some(i => !i || typeof i.sku !== 'string' || !Number.isSafeInteger(i.bundleId) || !Number.isSafeInteger(i.optionId) || typeof i.share !== 'boolean' || !permit.bundles.some(b => b.sku === i.sku && b.id === i.bundleId && b.optionIds.includes(i.optionId) && (!i.share || b.canShare))))) throw new Error('Pilihan bundle tidak sesuai diagnosis. Periksa masalah kembali.');
  const db = createServiceSupabase();
  const started = await claimParserStore(workspaceId,store.id);
  const ensureCurrent = async () => {
    const current = await access(workspaceId,input.mode === 'attach',true);
    if (current.profile.id !== ctx.profile.id) throw new Error('Sesi pengguna berubah.');
    const latest = await db.from('marketplace_parser_configs').select('revision').eq('workspace_id',workspaceId).single();
    if (latest.error || latest.data.revision !== permit.revision) throw new Error('Aturan tim berubah saat perbaikan. Muat ulang aturan sebelum melanjutkan.');
    const currentStores = await stores(workspaceId,target.id,[store.id]);
    if (currentStores.length !== 1 || currentStores[0].name !== store.name || (currentStores[0].scalevId && currentStores[0].scalevId !== store.scalevId)) throw new Error('Master Store berubah saat perbaikan. Periksa lagi.');
    const active = await db.from('scalev_webhook_businesses').select('id').eq('workspace_id',workspaceId).eq('is_active',true).in('id',[target.id,...permit.bundles.filter(b => input.items.some(i => i.bundleId === b.id)).map(b => b.sourceBusinessId)]);
    if (active.error || !active.data?.some(b => b.id === target.id) || input.items.some(i => !active.data?.some(b => b.id === permit.bundles.find(p => p.id === i.bundleId)?.sourceBusinessId))) throw new Error('Koneksi Business berubah saat perbaikan.');
    await assertParserStoreClaim(workspaceId,store.id,started);
  };
  const audit = async (stage: string, details: Record<string,unknown>) => {
    const result = await db.from('warehouse_activity_log').insert({ workspace_id: workspaceId,scope: 'scalev_catalog_sync',action: `parser_bundle_${stage}`,screen: 'marketplace-data-parser',summary: `${stage}: ${target.code} → ${store.name}`,target_type: 'store',target_id: String(store.id),target_label: store.name,business_code: target.code,acted_by: ctx.profile.id,acted_by_name: 'Pengguna parser',before_state: {},after_state: details,context: { account: permit.account,revision: permit.revision,scalevStoreId: store.scalevId },changed_fields: ['bundle_store_membership'] });
    if (result.error) throw new Error('Audit aksi belum dapat disimpan. Periksa log dan coba kembali.');
  };
  const result: RepairResult = { items: [],synced: false,message: '' };
  try {
    await ensureCurrent();
    const identity = await target.client.identity();
    if (permit.targetUid && identity.unique_id !== permit.targetUid) throw new Error('Business Scalev berubah. Sinkronkan katalog dan periksa kembali.');
    permit.targetUid = identity.unique_id;
    if (!store.scalevId) {
      const matches = (await target.client.stores()).filter(s => s.name === store.name);
      if (matches.length !== 1) throw new Error('Store belum cocok dengan satu Store Scalev. Perbarui master Store.');
      store.scalevId = matches[0].id;
    }
    const liveStore = await target.client.store(store.scalevId);
    if (liveStore.business?.unique_id !== permit.targetUid || liveStore.name !== store.name || (savedStore.uniqueId && liveStore.unique_id !== savedStore.uniqueId)) throw new Error('Business atau Store Scalev berubah. Periksa masalah kembali.');
    const assertUnique = async (sku: string,id: number) => {
      const rows = await db.from('scalev_catalog_bundles').select('scalev_bundle_id').eq('workspace_id',workspaceId).eq('business_id',target.id).eq('custom_id',sku).limit(2);
      if (rows.error || rows.data?.some(row => row.scalev_bundle_id !== id)) throw new Error('Identifier code di katalog aplikasi berubah atau ambigu. Muat ulang data aplikasi.');
    };
    if (input.mode === 'attach') result.items = await repairBundles({ permit,request: input,target,connections: all,ensureCurrent,audit,assertUnique });
    if (input.mode === 'refresh') {
      // Refresh diagnosed IDs only, including known bundles not installed yet.
      for (const sourceId of [...new Set(permit.bundles.map(b => b.sourceBusinessId))]) {
        const source = all.find(c => c.id === sourceId);
        if (!source) throw new Error('Koneksi sumber bundle tidak aktif. Muat ulang data aplikasi.');
        const sourceIdentity = await source.client.identity();
        const savedIdentity = await db.from('scalev_webhook_businesses').update({ scalev_business_uid: sourceIdentity.unique_id }).eq('workspace_id',workspaceId).eq('id',sourceId);
        if (savedIdentity.error) throw new Error('Identitas Business belum berhasil disimpan.');
        for (const bundle of permit.bundles.filter(b => b.sourceBusinessId === sourceId)) {
          const detail = await source.client.bundle(bundle.id);
          if (!detail) throw new Error('Bundle tidak lagi tersedia. Sinkronkan katalog Business melalui Katalog & Master Data.');
          const options = await source.client.options(bundle.id);
          await ensureCurrent();
          const saved = await db.from('scalev_catalog_bundles').update({ ...cachedBundleMetadata(detail,options),name: detail.name,custom_id: detail.custom_id?.trim() || null,price_options_count: options.length,last_synced_at: new Date().toISOString() }).eq('workspace_id',workspaceId).eq('business_id',sourceId).eq('scalev_bundle_id',bundle.id);
          if (saved.error) throw new Error('Metadata bundle belum berhasil disimpan.');
        }
      }
    }
    await ensureCurrent();
    await syncParserStore(workspaceId,store.id,{ started,scalevStoreId: store.scalevId });
    result.synced = true;
    result.message = result.items.some(i => i.stage !== 'ready') ? 'Sebagian aksi belum selesai. Katalog terbaru dimuat; periksa hasil tiap SKU sebelum melanjutkan.' : 'Katalog Store diperbarui. Seluruh batch divalidasi ulang; periksa hasil sebelum download.';
    await audit('completed',{ synced: true,items: result.items });
  } catch (error) {
    result.message = `${messageOf(error)} ${result.synced ? 'Katalog sudah dimuat; periksa hasil.' : 'Sinkronisasi belum selesai. Download tetap diblokir sampai katalog diperbarui.'}`;
  } finally {
    if (!result.synced) await failParserStoreClaim(workspaceId,store.id,started);
  }
  // The caller replaces its catalog and reprojects every order, including those
  // outside the current filter/page. No per-order destination is ever changed.
  return { result,catalog: await readParserCatalog(workspaceId,context.config.stores.map(s => s.storeId)) };
}
