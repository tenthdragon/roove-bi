import { configuredOrderRoute } from './project';
import type { ParserConfig } from './types';
import type { RepairRequest, RepairResult } from './diagnosis-types';
import type { DiagnosisPermit } from './diagnosis-token';
import type { ParserScalevClient } from './scalev-client';

export type CatalogConnection = { id: number; code: string; client: Pick<ParserScalevClient,'identity' | 'bundle' | 'partners' | 'share'> };
export type DiagnosisStore = { id: number; name: string };
export const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Pemeriksaan Scalev belum berhasil. Coba lagi.';
export function resolveDiagnosisRoute(config: ParserConfig, account: string, skus: string[], stores: DiagnosisStore[]) {
  const route = configuredOrderRoute(skus,account,config);
  const selected = stores.filter(s => route.targetIds.includes(s.id));
  const issues = [...route.errors];
  if (route.targetIds.length === 1 && selected.length !== 1) issues.push('Store tujuan tidak aktif atau di luar lingkup akun. Perbaiki mapping Produk.');
  return { issues,stores: selected,suggestedStoreId: !issues.length && selected.length === 1 ? selected[0].id : null };
}

export async function shareBundles(input: {
  permit: DiagnosisPermit; request: RepairRequest; target: CatalogConnection; connections: CatalogConnection[];
  ensureCurrent: () => Promise<void>;
  audit: (stage: string, details: Record<string, unknown>) => Promise<void>;
  assertUnique: (sku: string,id: number) => Promise<void>;
}): Promise<RepairResult['items']> {
  const { permit,request,target,connections,ensureCurrent,audit } = input;
  if (!permit.targetUid || target.id !== permit.targetBusinessId) throw new Error('Business di luar diagnosis yang disetujui.');
  if (request.mode !== 'share' || !request.items.length || request.items.length > 50 || new Set(request.items.map(i => i.sku)).size !== request.items.length) throw new Error('Pilihan bundle tidak valid.');
  for (const item of request.items) {
    const approved = permit.bundles.find(b => b.sku === item.sku && b.id === item.bundleId);
    if (!approved?.canShare || !approved.ownerUid || approved.sourceBusinessId === target.id) throw new Error('Sharing tidak sesuai diagnosis. Periksa kembali.');
  }
  const verifyTarget = async () => {
    await ensureCurrent();
    if ((await target.client.identity()).unique_id !== permit.targetUid) throw new Error('Business Scalev berubah. Periksa masalah kembali.');
  };
  await verifyTarget();
  const output: RepairResult['items'] = [];
  for (const item of request.items) {
    let stage: RepairResult['items'][number]['stage'] = 'failed';
    try {
      const approved = permit.bundles.find(b => b.sku === item.sku && b.id === item.bundleId)!;
      const owner = connections.find(c => c.id === approved.sourceBusinessId);
      if (!owner) throw new Error('Koneksi Business pemilik tidak aktif.');
      await verifyTarget();
      const detail = await owner.client.bundle(item.bundleId);
      if (!detail || detail.custom_id !== item.sku || detail.business?.unique_id !== approved.ownerUid || (await owner.client.identity()).unique_id !== approved.ownerUid) throw new Error('Kode atau pemilik bundle berubah. Periksa masalah kembali.');
      await input.assertUnique(item.sku,item.bundleId);
      let visible = await target.client.bundle(item.bundleId);
      if (visible && visible.custom_id !== item.sku) throw new Error('Identifier code berubah. Sinkronkan katalog dan periksa lagi.');
      if (!visible) {
        const partners = await owner.client.partners(item.bundleId);
        if (!partners.some(row => row.partner?.unique_id === permit.targetUid)) {
          await verifyTarget();
          await audit('share_requested',{ bundleId: item.bundleId,sku: item.sku,owner: approved.ownerUid,recipient: permit.targetUid });
          await owner.client.share(item.bundleId,permit.targetUid);
        }
        stage = 'shared';
        await audit('shared',{ bundleId: item.bundleId,sku: item.sku });
        visible = await target.client.bundle(item.bundleId);
        if (!visible || visible.custom_id !== item.sku) throw new Error('Sharing diproses, tetapi ketersediaan di Business belum terkonfirmasi. Muat ulang setelah sinkronisasi.');
      }
      output.push({ sku: item.sku,stage: 'ready',message: 'Bundle tersedia di Business tujuan.' });
    } catch (error) {
      output.push({ sku: item.sku,stage,message: messageOf(error) });
      try { await audit('repair_incomplete',{ sku: item.sku,stage,message: messageOf(error) }); }
      catch { output[output.length - 1].message += ' Pencatatan hasil belum berhasil; periksa log permintaan.'; }
    }
  }
  return output;
}
