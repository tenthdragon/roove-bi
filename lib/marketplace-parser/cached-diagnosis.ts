import { createServiceSupabase } from '../service-supabase';
import { allPages } from './catalog';
import { resolveDiagnosisRoute, type DiagnosisStore } from './diagnosis';
import type { ParserConfig } from './types';
import type { BundleFinding, ParserDiagnosis, SkuDiagnosis } from './diagnosis-types';
import type { DiagnosisPermit } from './diagnosis-token';

type BundleRow = {
  id: number; business_id: number; scalev_bundle_id: number; custom_id: string; name: string;
  scalev_owner_uid: string | null; scalev_owner_name: string | null; last_synced_at: string;
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
  const routing = resolveDiagnosisRoute(input.config,input.account,skus,input.stores);
  const businessIds = businesses.map(b => b.id);
  const readStates = () => allPages<{ business_id: number; sync_status: string; last_synced_at: string | null; updated_at: string }>((from,to) => db.from('scalev_catalog_sync_state').select('business_id,sync_status,last_synced_at,updated_at').eq('workspace_id',workspaceId).in('business_id',businessIds).order('business_id').range(from,to));
  const before = await readStates();
  // Indexed exact codes only. Neither Store membership nor price metadata affects availability.
  const rows = await allPages<BundleRow>((from,to) => db.from('scalev_catalog_bundles').select('id,business_id,scalev_bundle_id,custom_id,name,scalev_owner_uid,scalev_owner_name,last_synced_at').eq('workspace_id',workspaceId).in('business_id',businessIds).in('custom_id',skus).order('id').range(from,to));
  const after = await readStates();
  const ready = (id: number) => {
    const state = after.find(s => s.business_id === id);
    return state?.sync_status === 'success' && !!state.last_synced_at && JSON.stringify(state) === JSON.stringify(before.find(s => s.business_id === id));
  };
  const incomplete = businesses.filter(b => !ready(b.id));
  const issues = [...routing.issues];
  const permits: DiagnosisPermit['bundles'] = [];
  const items = skus.map((sku): SkuDiagnosis => {
    if (!ready(target.id)) return { sku,status: 'unavailable',bundles: [],message: 'Katalog Business tujuan belum siap. Selesaikan sinkronisasi Business lalu muat ulang.' };
    const matches = rows.filter(r => r.custom_id === sku && ready(r.business_id));
    const local = matches.filter(r => r.business_id === target.id);
    // An incomplete unrelated Business must not invalidate a confirmed target match.
    if (!local.length && incomplete.length) return { sku,status: 'unavailable',bundles: [],message: `Pencarian lintas Business belum lengkap: ${incomplete.map(b => b.business_code).join(', ')}. Selesaikan sinkronisasi sebelum memastikan pemilik.` };
    const ids = [...new Set((local.length ? local : matches).map(r => r.scalev_bundle_id))];
    if (!ids.length) return { sku,status: 'missing',bundles: [],message: 'Identifier code belum tercatat di katalog aplikasi. Sinkronkan katalog Business bila bundle baru dibuat atau diubah di Scalev.' };
    const findings = ids.map((id): BundleFinding => {
      const copies = matches.filter(r => r.scalev_bundle_id === id).sort((a,b) => b.last_synced_at.localeCompare(a.last_synced_at));
      const row = local.find(r => r.scalev_bundle_id === id) || copies[0];
      const ownerUids = [...new Set(copies.map(r => r.scalev_owner_uid).filter(Boolean))];
      const ownerUid = ownerUids.length === 1 ? ownerUids[0] : null;
      const owner = ownerUid ? businesses.find(b => b.scalev_business_uid === ownerUid && ready(b.id)) : null;
      const canShare = !local.length && !!owner && owner.id !== target.id;
      if (ids.length === 1 && canShare) permits.push({ sku,id,sourceBusinessId: owner!.id,ownerUid,canShare: true });
      return { id,name: row.name,sku,owner: owner?.business_code || copies.find(r => r.scalev_owner_name)?.scalev_owner_name || 'Belum tersinkron',ownerBusinessId: owner?.id || null,availableInBusiness: local.length > 0,canShare };
    });
    return { sku,status: ids.length > 1 ? 'ambiguous' : 'found',bundles: findings,message: ids.length > 1 ? 'Identifier code cocok ke beberapa bundle. Benahi kode sebelum download.' : local.length ? 'Bundle tersedia di Business tujuan.' : 'Bundle tersedia di Business lain. Bagikan ke Business tujuan.' };
  });
  const timestamps = rows.filter(r => r.business_id === target.id).map(r => r.last_synced_at).filter(Boolean).sort();
  return {
    diagnosis: { checkedAt: new Date().toISOString(),catalogSyncedAt: timestamps[0] || after.find(s => s.business_id === target.id)?.last_synced_at || null,account: account.label,business: target.business_code,stores: routing.stores,suggestedStoreId: routing.suggestedStoreId,items,issues },
    permit: { workspaceId,actorId: input.actorId,revision: input.revision,account: input.account,expiresAt: Date.now()+10*60000,targetBusinessId: target.id,targetUid: target.scalev_business_uid,skus,bundles: permits },
  };
}
