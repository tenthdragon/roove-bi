import { configuredOrderRoute } from './project';
import type { ParserConfig } from './types';
import type { BundleFinding, ParserDiagnosis, RepairRequest, RepairResult, SkuDiagnosis } from './diagnosis-types';
import type { DiagnosisPermit } from './diagnosis-token';
import type { ParserScalevClient, ScalevBundle, ScalevOption } from './scalev-client';

export type CatalogConnection = { id: number; code: string; client: Pick<ParserScalevClient,'identity' | 'bundles' | 'stores' | 'store' | 'storeBundles' | 'bundle' | 'options' | 'partners' | 'share' | 'attach'> };
export type DiagnosisStore = { id: number; name: string; scalevId: number | null; uniqueId: string | null };
export const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Pemeriksaan Scalev belum berhasil. Coba lagi.';
// Storefront visibility is not catalog availability: a hidden BPO can still be
// used for marketplace orders. Never treat is_visible=false as deletion.
const activeOptions = (options: ScalevOption[]) => options.filter(o => o.is_active !== false);
async function mapLimited<T,R>(rows: T[], run: (row: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(rows.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(3,rows.length) },async () => {
    for (;;) { const index = next++; if (index >= rows.length) return; output[index] = await run(rows[index]); }
  }));
  return output;
}
export function allowedRepairStores(config: ParserConfig, account: string, skus: string[], stores: DiagnosisStore[]) {
  const route = configuredOrderRoute(skus,account,config);
  return { issues: route.errors,stores: route.errors.length ? [] : stores.filter(s => !route.hasRules || route.targetIds.includes(s.id)),suggestedStoreId: !route.errors.length && route.targetIds.length === 1 ? route.targetIds[0] : null };
}

export async function diagnoseBundles(input: {
  workspaceId: string; actorId: string; revision: number; account: string; skus: string[]; config: ParserConfig;
  target: CatalogConnection; connections: CatalogConnection[]; stores: DiagnosisStore[];
}): Promise<{ diagnosis: Omit<ParserDiagnosis,'token'>; permit: DiagnosisPermit }> {
  const { target,connections,skus } = input;
  const routing = allowedRepairStores(input.config,input.account,skus,input.stores);
  const identities = await mapLimited(connections,async connection => {
    try { return { connection,identity: await connection.client.identity(),error: '' }; }
    catch (error) { return { connection,identity: null,error: messageOf(error) }; }
  });
  const identity = identities.find(row => row.connection.id === target.id)?.identity;
  if (!identity) throw new Error('Identitas Business tujuan belum dapat dibaca. Periksa koneksi Scalev dan coba lagi.');
  const visible = await target.client.bundles();
  const needsSearch = skus.some(sku => !visible.some(b => b.custom_id === sku));
  const others = needsSearch ? await mapLimited(identities.filter(row => row.connection.id !== target.id),async row => {
    try {
      if (!row.identity) throw new Error(row.error);
      return { connection: row.connection,bundles: await row.connection.client.bundles(),complete: true };
    } catch { return { connection: row.connection,bundles: [] as ScalevBundle[],complete: false }; }
  }) : [];
  const incomplete = others.filter(row => !row.complete).map(row => row.connection.code);
  const issues = [...routing.issues];
  if (incomplete.length) issues.push(`Pencarian lintas Business belum lengkap: ${incomplete.join(', ')}. Kode yang tidak ada di Business tujuan belum dapat dipastikan; coba periksa lagi.`);
  const liveStores = await target.client.stores();
  const verified = await mapLimited(routing.stores,async store => {
    try {
      const matches = liveStores.filter(s => store.scalevId ? s.id === store.scalevId : store.uniqueId ? s.unique_id === store.uniqueId : s.name === store.name);
      if (matches.length !== 1) throw new Error('identitas Store tidak cocok dengan satu Store Scalev');
      const live = await target.client.store(matches[0].id);
      if (live.business?.unique_id !== identity.unique_id || live.name !== store.name || (store.uniqueId && live.unique_id !== store.uniqueId)) throw new Error('Business atau nama Store berubah; perbarui master Store');
      return { id: store.id,scalevId: live.id,name: live.name,bundles: await target.client.storeBundles(live.id) };
    } catch (error) { issues.push(`${store.name}: ${messageOf(error)}`); return null; }
  });
  const stores = verified.filter(row => row !== null);
  const permits: DiagnosisPermit['bundles'] = [];
  const items = await mapLimited(skus,async (sku): Promise<SkuDiagnosis> => {
    const local = visible.filter(b => b.custom_id === sku);
    const candidates = new Map<number,{ bundle: ScalevBundle; source: CatalogConnection }>();
    for (const bundle of local) candidates.set(bundle.id,{ bundle,source: target });
    if (!local.length) for (const row of others) for (const bundle of row.bundles.filter(b => b.custom_id === sku)) if (!candidates.has(bundle.id)) candidates.set(bundle.id,{ bundle,source: row.connection });
    if (!local.length && incomplete.length) return { sku,status: 'unavailable',bundles: [],message: 'Pencarian belum lengkap. Coba lagi setelah koneksi Business pulih.' };
    if (!candidates.size) return { sku,status: 'missing',bundles: [],message: 'Identifier code tidak ditemukan pada Business yang terhubung. Perbaiki atau buat bundle di Scalev, lalu periksa lagi.' };
    try {
      const bundles: BundleFinding[] = [];
      for (const candidate of candidates.values()) {
        const detail = await candidate.source.client.bundle(candidate.bundle.id);
        if (!detail || detail.custom_id !== sku || !detail.business?.unique_id) throw new Error('Data bundle berubah atau pemiliknya belum terverifikasi. Periksa lagi.');
        const owner = identities.find(row => row.identity?.unique_id === detail.business!.unique_id);
        // Sharing is allowed only with a verified owner connection, never a reseller's credential.
        const source = !local.length && owner ? owner.connection : candidate.source;
        const options = activeOptions(await source.client.options(detail.id)).map(o => ({ id: o.id,name: o.name,price: String(o.price) }));
        const canShare = !local.length && !!owner;
        bundles.push({ id: detail.id,name: detail.name,sku,owner: owner?.connection.code || detail.business.account_holder || detail.business.username || detail.business.unique_id,ownerBusinessId: owner?.connection.id || null,availableInBusiness: !!local.length,installedStoreIds: stores.filter(s => s.bundles.some(b => b.id === detail.id && b.custom_id === sku)).map(s => s.id),options,canShare });
        if (candidates.size === 1) permits.push({ sku,id: detail.id,sourceBusinessId: source.id,ownerUid: detail.business.unique_id,optionIds: options.map(o => o.id),canShare });
      }
      return { sku,status: bundles.length === 1 ? 'found' : 'ambiguous',bundles,message: bundles.length > 1 ? 'Identifier code cocok ke beberapa bundle. Benahi kode di Scalev; pemasangan otomatis diblokir.' : local.length ? 'Bundle tersedia untuk Business tujuan.' : 'Bundle ditemukan di Business lain; sharing diperlukan sebelum pemasangan.' };
    } catch (error) { return { sku,status: 'unavailable',bundles: [],message: messageOf(error) }; }
  });
  const account = input.config.accounts.find(a => a.id === input.account)!;
  const commonStores = stores.filter(store => items.every(item => item.status === 'found' && item.bundles.length === 1 && item.bundles[0].installedStoreIds.includes(store.id)));
  return {
    diagnosis: { checkedAt: new Date().toISOString(),account: account.label,business: target.code,stores: stores.map(s => ({ id: s.id,name: s.name })),suggestedStoreId: routing.suggestedStoreId || (commonStores.length === 1 ? commonStores[0].id : stores.length === 1 ? stores[0].id : null),items,issues },
    permit: { workspaceId: input.workspaceId,actorId: input.actorId,revision: input.revision,account: input.account,skus,expiresAt: Date.now() + 10 * 60000,targetBusinessId: target.id,targetUid: identity.unique_id,stores: stores.map(s => ({ id: s.id,scalevId: s.scalevId,name: s.name })),bundles: permits },
  };
}

export async function repairBundles(input: {
  permit: DiagnosisPermit; request: RepairRequest; target: CatalogConnection; connections: CatalogConnection[];
  ensureCurrent: () => Promise<void>;
  audit: (stage: string, details: Record<string, unknown>) => Promise<void>;
}): Promise<RepairResult['items']> {
  const { permit,request,target,connections,ensureCurrent,audit } = input;
  const store = permit.stores.find(s => s.id === request.storeId);
  if (!store || target.id !== permit.targetBusinessId) throw new Error('Store di luar diagnosis yang disetujui. Periksa masalah kembali.');
  if (request.mode !== 'attach' || !request.items.length || request.items.length > 50 || new Set(request.items.map(i => i.sku)).size !== request.items.length) throw new Error('Pilihan bundle tidak valid.');
  // Validate the whole envelope before the first write, including explicit consent to sharing.
  for (const item of request.items) {
    const approved = permit.bundles.find(b => b.sku === item.sku && b.id === item.bundleId);
    if (!approved || !approved.optionIds.includes(item.optionId) || typeof item.share !== 'boolean' || (item.share && !approved.canShare)) throw new Error('Bundle, pilihan harga, atau sharing tidak sesuai diagnosis. Periksa kembali.');
  }
  const verifyTarget = async () => {
    await ensureCurrent();
    const identity = await target.client.identity(), live = await target.client.store(store.scalevId);
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
      if (!detail || detail.custom_id !== item.sku || detail.business?.unique_id !== approved.ownerUid) throw new Error('Kode atau pemilik bundle berubah. Periksa masalah kembali.');
      const options = activeOptions(await source.client.options(item.bundleId));
      if (!options.some(o => o.id === item.optionId)) throw new Error('Pilihan harga bundle tidak aktif atau sudah berubah. Periksa lagi.');
      let visible = await target.client.bundles();
      const assertUnique = (rows: ScalevBundle[]) => { if (rows.some(b => b.custom_id === item.sku && b.id !== item.bundleId)) throw new Error('Identifier code sekarang cocok ke bundle lain. Benahi kode di Scalev.'); };
      assertUnique(visible);
      let installed = await target.client.storeBundles(store.scalevId); assertUnique(installed);
      if (installed.some(b => b.id === item.bundleId && b.custom_id === item.sku)) {
        output.push({ sku: item.sku,stage: 'ready',message: 'Bundle sudah terpasang. Tidak dipasang ulang.' }); continue;
      }
      if (!visible.some(b => b.id === item.bundleId && b.custom_id === item.sku)) {
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
        visible = await target.client.bundles(); assertUnique(visible);
        if (!visible.some(b => b.id === item.bundleId && b.custom_id === item.sku)) throw new Error('Sharing sudah diproses, tetapi visibilitas belum terkonfirmasi. Periksa lagi untuk melanjutkan pemasangan.');
      }
      await verifyTarget();
      installed = await target.client.storeBundles(store.scalevId); assertUnique(installed);
      if (!installed.some(b => b.id === item.bundleId && b.custom_id === item.sku)) {
        await audit('attach_requested',{ bundleId: item.bundleId,sku: item.sku,optionId: item.optionId });
        await target.client.attach(store.scalevId,item.optionId);
      }
      stage = 'attached';
      await audit('attached',{ bundleId: item.bundleId,sku: item.sku,optionId: item.optionId });
      installed = await target.client.storeBundles(store.scalevId); assertUnique(installed);
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
