import { createServiceSupabase } from '../service-supabase';
import { allPages } from './catalog';
import { allowedRepairStores, type DiagnosisStore } from './diagnosis';
import type { ParserConfig } from './types';
import type { BundleFinding, BundleOption, ParserDiagnosis, SkuDiagnosis } from './diagnosis-types';
import type { DiagnosisPermit } from './diagnosis-token';
import { cachedBundleMetadata } from './catalog-metadata';

type BundleRow = {
  id: number; business_id: number; scalev_bundle_id: number; custom_id: string; name: string;
  scalev_owner_uid: string | null; scalev_owner_name: string | null;
  price_options: BundleOption[] | null; last_synced_at: string;
};
export async function readCachedDiagnosis(input: {
  workspaceId: string; actorId: string; revision: number; account: string; skus: string[];
  config: ParserConfig; stores: DiagnosisStore[];
}, db = createServiceSupabase()): Promise<{ diagnosis: Omit<ParserDiagnosis,'token'>; permit: DiagnosisPermit }> {
  const { workspaceId,skus } = input;
  const businesses = await allPages<{ id: number; business_code: string; scalev_business_uid: string | null }>((from,to) => db.from('scalev_webhook_businesses').select('id,business_code,scalev_business_uid').eq('workspace_id',workspaceId).eq('is_active',true).order('id').range(from,to));
  const account = input.config.accounts.find(a => a.id === input.account);
  const target = businesses.find(b => b.business_code === account?.business);
  if (!account || !target) throw new Error('Business akun asal belum terhubung atau tidak aktif. Perbaiki aturan akun.');
  const routing = allowedRepairStores(input.config,input.account,skus,input.stores);
  const businessIds = businesses.map(b => b.id);
  const states = await allPages<{ business_id: number; sync_status: string; last_synced_at: string | null; updated_at: string }>((from,to) => db.from('scalev_catalog_sync_state').select('business_id,sync_status,last_synced_at,updated_at').eq('workspace_id',workspaceId).in('business_id',businessIds).order('business_id').range(from,to));
  const readStoreSyncs = () => routing.stores.length ? allPages<{ store_id: number; status: string; synced_at: string | null; updated_at: string }>((from,to) => db.from('marketplace_parser_store_syncs').select('store_id,status,synced_at,updated_at').eq('workspace_id',workspaceId).in('store_id',routing.stores.map(s => s.id)).order('store_id').range(from,to)) : Promise.resolve([]);
  const syncs = await readStoreSyncs();
  // Exact indexed identifiers only: never load a Business's whole bundle catalog.
  const rows = await allPages<BundleRow>((from,to) => db.from('scalev_catalog_bundles').select('id,business_id,scalev_bundle_id,custom_id,name,scalev_owner_uid,scalev_owner_name,price_options,last_synced_at').eq('workspace_id',workspaceId).in('business_id',businessIds).in('custom_id',skus).order('id').range(from,to));
  const links = routing.stores.length ? await allPages<{ id: number; scalev_bundle_id: number; scalev_store_id: number | null; store_name: string; is_available: boolean; last_checked_at: string }>((from,to) => db.from('scalev_catalog_bundle_store_links').select('id,scalev_bundle_id,scalev_store_id,store_name,is_available,last_checked_at').eq('workspace_id',workspaceId).eq('business_id',target.id).in('store_name',routing.stores.map(s => s.name)).order('id').range(from,to)) : [];
  const after = await allPages<{ business_id: number; sync_status: string; last_synced_at: string | null; updated_at: string }>((from,to) => db.from('scalev_catalog_sync_state').select('business_id,sync_status,last_synced_at,updated_at').eq('workspace_id',workspaceId).in('business_id',businessIds).order('business_id').range(from,to));
  if (JSON.stringify(states) !== JSON.stringify(after) || JSON.stringify(syncs) !== JSON.stringify(await readStoreSyncs())) throw new Error('Katalog sedang berubah. Muat ulang data aplikasi setelah sinkronisasi selesai.');
  const incomplete = new Set(states.filter(s => ['running','failed'].includes(s.sync_status)).map(s => s.business_id));
  const issues = [...routing.issues];
  if (incomplete.size) issues.push(`Sinkronisasi katalog belum selesai: ${businesses.filter(b => incomplete.has(b.id)).map(b => b.business_code).join(', ')}. Data Business tersebut belum dapat dipakai untuk memastikan bundle.`);
  const storePermits = routing.stores.map(store => {
    const ids = [...new Set(links.filter(l => l.store_name === store.name && l.is_available && l.scalev_store_id).map(l => l.scalev_store_id!))];
    if (ids.length > 1 || (store.scalevId && ids.length && ids[0] !== store.scalevId)) {
      issues.push(`Identitas ${store.name} tidak konsisten. Perbarui master Store dan sinkronkan kembali.`);
      return null;
    }
    return { id: store.id,name: store.name,scalevId: store.scalevId || ids[0] || null };
  }).filter(s => s !== null);
  const uncertainStores = new Set(syncs.filter(s => s.status !== 'ready').map(s => s.store_id));
  if (uncertainStores.size) issues.push('Sebagian Store belum selesai disinkronkan. Sinkronkan Store sebelum mengandalkan status pemasangannya.');
  const permits: DiagnosisPermit['bundles'] = [];
  const items = skus.map((sku): SkuDiagnosis => {
    if (incomplete.has(target.id)) return { sku,status: 'unavailable',bundles: [],message: 'Sinkronisasi Business tujuan belum selesai. Selesaikan sinkronisasi katalog terlebih dahulu.' };
    const matches = rows.filter(r => r.custom_id === sku && !incomplete.has(r.business_id));
    const local = matches.filter(r => r.business_id === target.id);
    if (!local.length && incomplete.size) return { sku,status: 'unavailable',bundles: [],message: 'Pencarian lintas Business belum lengkap. Selesaikan sinkronisasi sebelum memastikan pemilik dan keunikan identifier code.' };
    const ids = [...new Set((local.length ? local : matches).map(r => r.scalev_bundle_id))];
    if (!ids.length) return { sku,status: 'missing',bundles: [],message: 'Identifier code belum tercatat di katalog aplikasi. Sinkronkan katalog Business bila bundle baru dibuat atau diubah di Scalev.' };
    const findings = ids.map((id): BundleFinding => {
      const copies = matches.filter(r => r.scalev_bundle_id === id).sort((a,b) => b.last_synced_at.localeCompare(a.last_synced_at));
      const row = local.find(r => r.scalev_bundle_id === id) || copies[0];
      // Legacy owner_business_code was sometimes inferred from the recipient.
      // Only verified upstream UIDs may identify the owner or authorize sharing.
      const ownerUid = copies.find(r => r.scalev_owner_uid)?.scalev_owner_uid || null;
      const owner = ownerUid ? businesses.find(b => b.scalev_business_uid === ownerUid) : null;
      const source = local.length ? target : owner || businesses.find(b => b.id === row.business_id);
      const options = cachedBundleMetadata({},Array.isArray(row.price_options) ? row.price_options : null).price_options || [];
      const canShare = !local.length && !!owner && owner.id !== target.id;
      if (ids.length === 1 && source) permits.push({ sku,id,sourceBusinessId: source.id,ownerUid,optionIds: options.map(o => o.id),canShare });
      return { id,name: row.name,sku,owner: owner?.business_code || copies.find(r => r.scalev_owner_name)?.scalev_owner_name || 'Belum tersinkron',ownerBusinessId: owner?.id || null,availableInBusiness: local.length > 0,installedStoreIds: storePermits.filter(s => local.length > 0 && !uncertainStores.has(s.id) && links.some(l => l.store_name === s.name && l.scalev_bundle_id === id && l.is_available)).map(s => s.id),options,optionsSynced: Array.isArray(row.price_options),canShare };
    });
    return { sku,status: ids.length > 1 ? 'ambiguous' : 'found',bundles: findings,message: ids.length > 1 ? 'Identifier code cocok ke beberapa bundle di data aplikasi. Benahi kode dan sinkronkan; pemasangan diblokir.' : local.length ? 'Bundle tercatat untuk Business tujuan di data aplikasi.' : 'Bundle tercatat di Business lain. Periksa pemilik dan lakukan sharing sebelum pemasangan.' };
  });
  const common = storePermits.filter(s => items.every(i => i.status === 'found' && i.bundles[0]?.installedStoreIds.includes(s.id)));
  const timestamps = [...rows.map(r => r.last_synced_at),...syncs.map(s => s.synced_at)].filter((t): t is string => !!t).sort();
  return {
    diagnosis: { checkedAt: new Date().toISOString(),catalogSyncedAt: timestamps[0] || null,account: account.label,business: target.business_code,stores: storePermits.map(s => ({ id: s.id,name: s.name })),suggestedStoreId: (storePermits.some(s => s.id === routing.suggestedStoreId) ? routing.suggestedStoreId : null) || (common.length === 1 ? common[0].id : storePermits.length === 1 ? storePermits[0].id : null),items,issues },
    permit: { workspaceId,actorId: input.actorId,revision: input.revision,account: input.account,expiresAt: Date.now()+10*60000,targetBusinessId: target.id,targetUid: target.scalev_business_uid,skus,stores: storePermits,bundles: permits },
  };
}
