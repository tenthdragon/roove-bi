import { configuredOrderRoute } from './project';
import type { ParserConfig } from './types';
import type { RepairRequest, RepairResult } from './diagnosis-types';
import type { DiagnosisPermit } from './diagnosis-token';
import type { ParserScalevClient, ScalevBundle, ScalevOption } from './scalev-client';

export type CatalogConnection = { id: number; code: string; client: Pick<ParserScalevClient,'identity' | 'bundles' | 'stores' | 'store' | 'storeBundles' | 'bundle' | 'options' | 'partners' | 'share' | 'attach'> };
export type DiagnosisStore = { id: number; name: string; scalevId: number | null; uniqueId: string | null };
export const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Pemeriksaan Scalev belum berhasil. Coba lagi.';
// Storefront visibility is not catalog availability: a hidden BPO can still be
// used for marketplace orders. Never treat is_visible=false as deletion.
const activeOptions = (options: ScalevOption[]) => options.filter(o => o.is_active !== false);
export function allowedRepairStores(config: ParserConfig, account: string, skus: string[], stores: DiagnosisStore[]) {
  const route = configuredOrderRoute(skus,account,config);
  return { issues: route.errors,stores: route.errors.length ? [] : stores.filter(s => !route.hasRules || route.targetIds.includes(s.id)),suggestedStoreId: !route.errors.length && route.targetIds.length === 1 ? route.targetIds[0] : null };
}

export async function repairBundles(input: {
  permit: DiagnosisPermit; request: RepairRequest; target: CatalogConnection; connections: CatalogConnection[];
  ensureCurrent: () => Promise<void>;
  audit: (stage: string, details: Record<string, unknown>) => Promise<void>;
  assertUnique: (sku: string,id: number) => Promise<void>;
}): Promise<RepairResult['items']> {
  const { permit,request,target,connections,ensureCurrent,audit } = input;
  const store = permit.stores.find(s => s.id === request.storeId);
  if (!store?.scalevId || !permit.targetUid || target.id !== permit.targetBusinessId) throw new Error('Store di luar diagnosis yang disetujui. Periksa masalah kembali.');
  const scalevStoreId = store.scalevId;
  if (request.mode !== 'attach' || !request.items.length || request.items.length > 50 || new Set(request.items.map(i => i.sku)).size !== request.items.length) throw new Error('Pilihan bundle tidak valid.');
  // Validate the whole envelope before the first write, including explicit consent to sharing.
  for (const item of request.items) {
    const approved = permit.bundles.find(b => b.sku === item.sku && b.id === item.bundleId);
    if (!approved || !approved.optionIds.includes(item.optionId) || typeof item.share !== 'boolean' || (item.share && !approved.canShare)) throw new Error('Bundle, pilihan harga, atau sharing tidak sesuai diagnosis. Periksa kembali.');
  }
  const verifyTarget = async () => {
    await ensureCurrent();
    const identity = await target.client.identity(), live = await target.client.store(scalevStoreId);
    if (identity.unique_id !== permit.targetUid || live.business?.unique_id !== permit.targetUid || live.name !== store.name) throw new Error('Business atau Store Scalev berubah. Periksa masalah kembali.');
  };
  await verifyTarget();
  const output: RepairResult['items'] = [];
  for (const item of request.items) {
    let stage: RepairResult['items'][number]['stage'] = 'failed';
    try {
      const approved = permit.bundles.find(b => b.sku === item.sku && b.id === item.bundleId)!;
      const source = connections.find(c => c.id === approved.sourceBusinessId);
      if (!source) throw new Error('Koneksi Business asal sudah tidak aktif.');
      await verifyTarget();
      const detail = await source.client.bundle(item.bundleId);
      if (!detail || detail.custom_id !== item.sku || !detail.business?.unique_id || (approved.ownerUid && detail.business.unique_id !== approved.ownerUid)) throw new Error('Kode atau pemilik bundle berubah. Periksa masalah kembali.');
      const options = activeOptions(await source.client.options(item.bundleId));
      if (!options.some(o => o.id === item.optionId)) throw new Error('Pilihan harga bundle tidak aktif atau sudah berubah. Periksa lagi.');
      await input.assertUnique(item.sku,item.bundleId);
      let visible = await target.client.bundle(item.bundleId);
      if (visible && visible.custom_id !== item.sku) throw new Error('Identifier code berubah. Sinkronkan katalog dan periksa lagi.');
      const assertUnique = (rows: ScalevBundle[]) => { if (rows.some(b => b.custom_id === item.sku && b.id !== item.bundleId)) throw new Error('Identifier code sekarang cocok ke bundle lain. Benahi kode di Scalev.'); };
      let installed = await target.client.storeBundles(scalevStoreId); assertUnique(installed);
      if (installed.some(b => b.id === item.bundleId && b.custom_id === item.sku)) {
        output.push({ sku: item.sku,stage: 'ready',message: 'Bundle sudah terpasang. Tidak dipasang ulang.' }); continue;
      }
      if (!visible) {
        if (!item.share || !approved.canShare) throw new Error('Bundle belum tersedia bagi Business tujuan. Periksa ulang untuk aksi Bagikan & tambahkan.');
        const owner = await source.client.identity();
        if (owner.unique_id !== approved.ownerUid || owner.unique_id === permit.targetUid) throw new Error('Koneksi Business pemilik belum cocok untuk sharing.');
        const partners = await source.client.partners(item.bundleId);
        if (!partners.some(row => row.partner?.unique_id === permit.targetUid)) {
          await verifyTarget();
          await audit('share_requested',{ bundleId: item.bundleId,sku: item.sku,owner: approved.ownerUid,recipient: permit.targetUid });
          await source.client.share(item.bundleId,permit.targetUid);
        }
        stage = 'shared';
        await audit('shared',{ bundleId: item.bundleId,sku: item.sku });
        visible = await target.client.bundle(item.bundleId);
        if (!visible || visible.custom_id !== item.sku) throw new Error('Sharing sudah diproses, tetapi visibilitas belum terkonfirmasi. Periksa lagi untuk melanjutkan pemasangan.');
      }
      await verifyTarget();
      installed = await target.client.storeBundles(scalevStoreId); assertUnique(installed);
      if (!installed.some(b => b.id === item.bundleId && b.custom_id === item.sku)) {
        await audit('attach_requested',{ bundleId: item.bundleId,sku: item.sku,optionId: item.optionId });
        await target.client.attach(scalevStoreId,item.optionId);
      }
      stage = 'attached';
      await audit('attached',{ bundleId: item.bundleId,sku: item.sku,optionId: item.optionId });
      installed = await target.client.storeBundles(scalevStoreId); assertUnique(installed);
      if (!installed.some(b => b.id === item.bundleId && b.custom_id === item.sku)) throw new Error('Pemasangan sudah diproses, tetapi belum terkonfirmasi. Periksa lagi sebelum mencoba ulang.');
      output.push({ sku: item.sku,stage: 'ready',message: 'Bundle terpasang di Store tujuan.' });
    } catch (error) {
      output.push({ sku: item.sku,stage,message: messageOf(error) });
      // A request audit exists before any write; failure to record its outcome is also surfaced.
      try { await audit('repair_incomplete',{ sku: item.sku,stage,message: messageOf(error) }); }
      catch { output[output.length - 1].message += ' Pencatatan hasil belum berhasil; periksa log permintaan.'; }
    }
  }
  return output;
}
