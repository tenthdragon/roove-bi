import { createServiceSupabase } from '../service-supabase';
import { recordWarehouseActivityLog } from '../warehouse-activity-log-actions';
import { extractVisibleCatalogMetadata } from '../scalev-visible-entity-helpers';
import { ParserScalevClient } from './scalev-client';
import { cachedBundleMetadata } from './catalog-metadata';
import { scalevFetch, scalevRetryDelay, ScalevThrottleError } from '../scalev-request-budget';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve,ms));
export async function readScalevPages(apiKey: string, path: string, fetcher?: typeof fetch): Promise<any[]> {
  if (!/^stores(?:\/\d+\/bundles)?$/.test(path)) throw new Error('Endpoint katalog tidak valid.');
  const output: any[] = [], seen = new Set<number>(); let lastId = 0;
  for (let page = 0; page < 1000; page++) {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const url = `https://api.scalev.id/v2/${path}?page_size=25${lastId ? `&last_id=${lastId}` : ''}`;
      const init: RequestInit = { headers: { Authorization: `Bearer ${apiKey}` },redirect: 'error',cache: 'no-store' };
      response = fetcher ? await fetcher(url,{ ...init,signal: AbortSignal.timeout(30000) }) : await scalevFetch(apiKey,url,{ ...init,timeoutMs: 30000 });
      if (response.ok) break;
      if (attempt === 4 || (response.status !== 429 && response.status < 500)) throw new Error(`Scalev belum dapat dibaca (HTTP ${response.status}). Coba sinkronkan lagi.`);
      const delay = scalevRetryDelay(response,attempt);
      await response.text();
      if (delay > 20000) throw new ScalevThrottleError(Date.now() + delay);
      await wait(delay);
    }
    const json = await response!.json();
    if (json.code !== 200 || !Array.isArray(json.data?.results) || typeof json.data?.has_next !== 'boolean') throw new Error('Respons katalog Scalev tidak lengkap. Data lama tidak diganti.');
    for (const row of json.data.results) {
      if (!Number.isSafeInteger(row.id) || row.id <= 0 || seen.has(row.id)) throw new Error('Halaman katalog Scalev berulang atau memiliki ID tidak valid.');
      seen.add(row.id); output.push(row);
    }
    if (!json.data.has_next) return output;
    const next = Number(json.data.last_id);
    if (!next || !json.data.results.length || (lastId && next >= lastId)) throw new Error('Pagination Scalev tidak bergerak. Sinkronisasi dihentikan.');
    lastId = next; await wait(400);
  }
  throw new Error('Katalog melewati batas sinkronisasi. Hubungi pengelola integrasi.');
}
export async function claimParserStore(workspaceId: string, storeId: number) {
  const db = createServiceSupabase();
  const inserted = await db.from('marketplace_parser_store_syncs').upsert({ workspace_id: workspaceId,store_id: storeId,status: 'failed' },{ onConflict: 'workspace_id,store_id',ignoreDuplicates: true });
  if (inserted.error) throw new Error('Status sinkronisasi belum tersedia. Terapkan migration parser terbaru.');
  const started = new Date().toISOString();
  const claimed = await db.from('marketplace_parser_store_syncs').update({ status: 'syncing',updated_at: started }).eq('workspace_id',workspaceId).eq('store_id',storeId).or(`status.neq.syncing,updated_at.lt.${new Date(Date.now() - 30 * 60000).toISOString()}`).select('store_id').maybeSingle();
  if (claimed.error || !claimed.data) throw new Error('Store ini sedang diproses. Tunggu proses selesai lalu periksa lagi.');
  return started;
}
export async function assertParserStoreClaim(workspaceId: string, storeId: number, started: string) {
  const result = await createServiceSupabase().from('marketplace_parser_store_syncs').select('store_id').eq('workspace_id',workspaceId).eq('store_id',storeId).eq('status','syncing').eq('updated_at',started).maybeSingle();
  if (result.error || !result.data || Date.now() - Date.parse(started) > 25 * 60000) throw new Error('Proses Store kedaluwarsa atau telah diganti. Periksa ulang sebelum melanjutkan.');
}
export async function failParserStoreClaim(workspaceId: string, storeId: number, started: string) {
  const result = await createServiceSupabase().from('marketplace_parser_store_syncs').update({ status: 'failed',updated_at: new Date().toISOString() }).eq('workspace_id',workspaceId).eq('store_id',storeId).eq('status','syncing').eq('updated_at',started);
  if (result.error) throw new Error('Status katalog belum berhasil diperbarui. Sinkronkan ulang sebelum download.');
}
export async function syncParserStore(workspaceId: string, storeId: number, lease?: { started: string; scalevStoreId: number }) {
  const db = createServiceSupabase();
  const store = await db.from('scalev_store_channels').select('id,business_id,store_name').eq('workspace_id',workspaceId).eq('id',storeId).eq('is_active',true).single();
  if (store.error) throw new Error('Store tidak aktif atau tidak tersedia dalam workspace ini.');
  const business = await db.from('scalev_webhook_businesses').select('id,business_code,api_key').eq('workspace_id',workspaceId).eq('id',store.data.business_id).eq('is_active',true).single();
  if (business.error || !business.data.api_key) throw new Error('Koneksi Scalev untuk Business ini belum tersedia.');
  const started = lease?.started || await claimParserStore(workspaceId,storeId);
  try {
    await assertParserStoreClaim(workspaceId,storeId,started);
    const liveStores = await readScalevPages(business.data.api_key,'stores');
    const matching = liveStores.filter(row => row.name === store.data.store_name);
    if (matching.length !== 1) throw new Error('Nama Store di aplikasi tidak cocok dengan satu Store Scalev. Perbarui master Store terlebih dahulu.');
    const liveStore = matching[0];
    if (lease && liveStore.id !== lease.scalevStoreId) throw new Error('Identitas Store berubah setelah perbaikan. Perbarui master Store lalu sinkronkan kembali.');
    const client = new ParserScalevClient(business.data.api_key);
    const identity = await client.identity();
    const savedIdentity = await db.from('scalev_webhook_businesses').update({ scalev_business_uid: identity.unique_id }).eq('workspace_id',workspaceId).eq('id',business.data.id);
    if (savedIdentity.error) throw new Error('Identitas Business belum berhasil disimpan.');
    const bundles = await client.catalogBundles(liveStore.id);
    const at = new Date().toISOString();
    await assertParserStoreClaim(workspaceId,storeId,started);
    for (let offset = 0; offset < bundles.length; offset += 200) {
      await assertParserStoreClaim(workspaceId,storeId,started);
      const batch = bundles.slice(offset,offset + 200);
      const old = await db.from('scalev_catalog_bundles').select('scalev_bundle_id,visibility_kind,owner_business_id,owner_business_code,processor_business_id,processor_business_code').eq('workspace_id',workspaceId).eq('business_id',business.data.id).in('scalev_bundle_id',batch.map(row => row.id));
      if (old.error) throw new Error('Metadata bundle lama belum dapat dibaca.');
      const payload = batch.map(bundle => {
        const previous = old.data?.find(row => row.scalev_bundle_id === bundle.id);
        const metadata = previous || extractVisibleCatalogMetadata({ viewerBusinessId: business.data.id,viewerBusinessCode: business.data.business_code,source: {} });
        return { workspace_id: workspaceId,business_id: business.data.id,business_code: business.data.business_code,scalev_bundle_id: bundle.id,name: String(bundle.name || bundle.public_name || bundle.display || bundle.id),public_name: bundle.public_name || null,display: bundle.display || null,weight_bump: bundle.weight_bump ?? null,is_bundle_sharing: Boolean(bundle.is_bundle_sharing),custom_id: bundle.custom_id?.trim() || null,price_options_count: bundle.bundle_price_options?.length || 0,...cachedBundleMetadata(bundle,bundle.bundle_price_options || null),last_synced_at: at,visibility_kind: metadata.visibility_kind,owner_business_id: metadata.owner_business_id,owner_business_code: metadata.owner_business_code,processor_business_id: metadata.processor_business_id,processor_business_code: metadata.processor_business_code };
      });
      const saved = await db.from('scalev_catalog_bundles').upsert(payload,{ onConflict: 'business_id,scalev_bundle_id' });
      if (saved.error) throw new Error('Bundle belum berhasil disimpan. Sinkronkan ulang sebelum download.');
      const links = await db.from('scalev_catalog_bundle_store_links').upsert(batch.map(bundle => ({ workspace_id: workspaceId,business_id: business.data.id,business_code: business.data.business_code,scalev_bundle_id: bundle.id,scalev_store_id: liveStore.id,store_unique_id: liveStore.unique_id || null,store_name: store.data.store_name,is_available: true,availability_source: 'scalev.store_bundle_list',last_checked_at: at })),{ onConflict: 'workspace_id,business_id,scalev_bundle_id,store_name' });
      if (links.error) throw new Error('Relasi bundle–Store belum berhasil disimpan. Sinkronkan ulang sebelum download.');
    }
    await assertParserStoreClaim(workspaceId,storeId,started);
    const stale = await db.from('scalev_catalog_bundle_store_links').update({ is_available: false,last_checked_at: at,availability_source: 'scalev.store_bundle_list' }).eq('workspace_id',workspaceId).eq('business_id',business.data.id).eq('store_name',store.data.store_name).neq('last_checked_at',at);
    if (stale.error) throw new Error('Relasi bundle lama belum berhasil diperbarui.');
    const complete = await db.from('marketplace_parser_store_syncs').update({ status: 'ready',synced_at: at,bundle_count: bundles.length,updated_at: at }).eq('workspace_id',workspaceId).eq('store_id',storeId).eq('status','syncing').eq('updated_at',started).select('store_id').maybeSingle();
    if (complete.error || !complete.data) throw new Error('Status akhir sinkronisasi belum berhasil disimpan.');
    await recordWarehouseActivityLog({ workspaceId,scope: 'scalev_catalog_sync',action: 'parser_store_sync',screen: 'marketplace-data-parser',summary: `Sinkronisasi ${bundles.length} bundle untuk ${store.data.store_name}`,businessCode: business.data.business_code,targetType: 'store',targetId: storeId,afterState: { bundles: bundles.length,syncedAt: at } });
    return { storeId,bundleCount: bundles.length,syncedAt: at };
  } catch (error) {
    await db.from('marketplace_parser_store_syncs').update({ status: 'failed',updated_at: new Date().toISOString() }).eq('workspace_id',workspaceId).eq('store_id',storeId).eq('updated_at',started);
    throw new Error(error instanceof Error ? error.message : 'Sinkronisasi belum berhasil. Coba lagi.');
  }
}
