import { createHash } from 'node:crypto';
import { createServiceSupabase } from '../service-supabase';
import { deriveWarehouseOriginBusinessNameFromOriginName, normalizeWarehouseDomainText } from '../warehouse-domain-helpers';
import type { Catalog, CatalogBundle } from './types';

type Db = ReturnType<typeof createServiceSupabase>;
export async function allPages<T>(fetchPage: (from: number,to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    const result = await fetchPage(from,from + 999);
    if (result.error) throw new Error('Data katalog belum dapat dimuat. Coba lagi setelah sinkronisasi.');
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
  throw new Error('Katalog terlalu besar. Kurangi Store yang digunakan.');
}
export async function readParserCatalog(workspaceId: string, selectedStoreIds: number[], db: Db = createServiceSupabase()): Promise<Catalog> {
  if (!Array.isArray(selectedStoreIds) || selectedStoreIds.length > 100 || selectedStoreIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Pilihan Store tidak valid (maksimal 100 Store).');
  const businesses = await db.from('scalev_webhook_businesses').select('id,business_code,business_name').eq('workspace_id',workspaceId).eq('is_active',true).order('id');
  if (businesses.error) throw new Error('Katalog Business belum dapat dimuat.');
  const businessRows = businesses.data || [];
  const codes = new Map(businessRows.map(b => [Number(b.id),String(b.business_code)]));
  const catalog: Catalog = { version: '', businesses: businessRows.map(b => ({ id: Number(b.id),code: b.business_code,name: b.business_name })), stores: [], bundles: [], warehouses: [], loadedStoreIds: [], storeSyncs: [] };
  if (!codes.size) return catalog;
  const stores = await allPages<any>((from,to) => db.from('scalev_store_channels').select('id,business_id,store_name').eq('workspace_id',workspaceId).in('business_id',[...codes.keys()]).eq('is_active',true).order('id').range(from,to));
  catalog.stores = stores.map(s => ({ id: Number(s.id),business: codes.get(Number(s.business_id))!,name: String(s.store_name) }));
  const [targets,origins,warehouseExports] = await Promise.all([
    allPages<any>((from,to) => db.from('warehouse_business_mapping').select('id,business_code,deduct_entity,deduct_warehouse').eq('workspace_id',workspaceId).eq('is_active',true).order('id').range(from,to)),
    allPages<any>((from,to) => db.from('warehouse_origin_registry').select('id,external_origin_name,operator_business_code,internal_warehouse_code').eq('workspace_id',workspaceId).eq('is_active',true).order('id').range(from,to)),
    allPages<any>((from,to) => db.from('marketplace_intake_source_store_scopes').select('id,scalev_warehouse_name').eq('workspace_id',workspaceId).eq('is_enabled',true).not('scalev_warehouse_name','is',null).order('id').range(from,to)),
  ]);
  const code = (value: unknown) => String(value || '').trim().toUpperCase();
  catalog.warehouses = origins.map(origin => {
    // Reuse the app's warehouse identity normalization, but emit only a literal
    // CSV label already configured in this workspace. Never manufacture a suffix.
    const labels = [...new Set<string>(warehouseExports.map(row => String(row.scalev_warehouse_name || '').trim()).filter(label => label && (
      normalizeWarehouseDomainText(label) === normalizeWarehouseDomainText(origin.external_origin_name)
      || normalizeWarehouseDomainText(deriveWarehouseOriginBusinessNameFromOriginName(label)) === normalizeWarehouseDomainText(origin.external_origin_name)
    )))];
    return { id: Number(origin.id),name: labels.length === 1 ? labels[0] : String(origin.external_origin_name),exportName: labels.length === 1 ? labels[0] : null,businesses: [...new Set<string>(targets.filter(target => code(target.deduct_entity) === code(origin.operator_business_code) && (!target.deduct_warehouse || code(target.deduct_warehouse) === code(origin.internal_warehouse_code))).map(target => target.business_code))] };
  }).filter(w => w.businesses.length > 0);
  const chosen = catalog.stores.filter(s => selectedStoreIds.includes(s.id));
  if (chosen.length !== new Set(selectedStoreIds).size) throw new Error('Salah satu Store tidak aktif atau bukan milik workspace ini. Perbarui pengaturan Store.');
  const bundles = new Map<string,CatalogBundle>();
  for (const business of catalog.businesses) {
    const selected = chosen.filter(s => s.business === business.code);
    if (!selected.length) continue;
    const links = await allPages<any>((from,to) => db.from('scalev_catalog_bundle_store_links').select('id,scalev_bundle_id,store_name,last_checked_at').eq('workspace_id',workspaceId).eq('business_id',business.id).in('store_name',selected.map(s => s.name)).eq('is_available',true).order('id').range(from,to));
    const ids = [...new Set<number>(links.map(link => Number(link.scalev_bundle_id)))];
    for (let offset = 0; offset < ids.length; offset += 200) {
      const rows = await allPages<any>((from,to) => db.from('scalev_catalog_bundles').select('id,scalev_bundle_id,custom_id,name,last_synced_at').eq('workspace_id',workspaceId).eq('business_id',business.id).in('scalev_bundle_id',ids.slice(offset,offset + 200)).order('id').range(from,to));
      for (const row of rows) {
        const storeIds = selected.filter(store => links.some(link => Number(link.scalev_bundle_id) === Number(row.scalev_bundle_id) && link.store_name === store.name)).map(store => store.id);
        bundles.set(`${business.id}:${row.scalev_bundle_id}`,{ id: Number(row.scalev_bundle_id),business: business.code,sku: String(row.custom_id || '').trim(),name: String(row.name),storeIds,syncedAt: row.last_synced_at });
      }
    }
    const states = await db.from('marketplace_parser_store_syncs').select('store_id,synced_at,status,bundle_count').eq('workspace_id',workspaceId).in('store_id',selected.map(store => store.id));
    if (states.error && !['42P01','PGRST205'].includes(states.error.code)) throw new Error('Status sinkronisasi Store belum dapat dimuat.');
    for (const store of selected) {
      const state = states.data?.find(row => row.store_id === store.id);
      const storeLinks = links.filter(link => link.store_name === store.name);
      const timestamps = storeLinks.map(link => String(link.last_checked_at)).sort();
      catalog.storeSyncs.push({ storeId: store.id,checkedAt: state?.synced_at || timestamps[0] || null,bundleCount: new Set(storeLinks.map(link => link.scalev_bundle_id)).size,status: state ? (state.status === 'ready' ? 'ready' : 'failed') : storeLinks.length ? 'ready' : 'unknown' });
    }
  }
  catalog.bundles = [...bundles.values()].sort((a,b) => a.business.localeCompare(b.business) || a.id - b.id);
  catalog.loadedStoreIds = chosen.map(store => store.id).sort((a,b) => a - b);
  catalog.version = createHash('sha256').update(JSON.stringify({ ...catalog,version: '' })).digest('hex');
  return catalog;
}
