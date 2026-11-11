import { createHash } from 'node:crypto';
import { createServiceSupabase } from '../service-supabase';
import { deriveWarehouseOriginBusinessNameFromOriginName, normalizeWarehouseDomainText } from '../warehouse-domain-helpers';
import type { Catalog } from './types';

type Db = ReturnType<typeof createServiceSupabase>;
export async function allPages<T>(fetchPage: (from: number,to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < 100000; from += 1000) {
    const result = await fetchPage(from,from + 999);
    if (result.error) throw new Error('Data katalog belum dapat dimuat. Coba lagi setelah sinkronisasi.');
    rows.push(...(result.data || []));
    if ((result.data || []).length < 1000) return rows;
  }
  throw new Error('Katalog terlalu besar. Batasi Business yang digunakan.');
}
export async function readParserCatalog(workspaceId: string, selectedStoreIds: number[], db: Db = createServiceSupabase(), selectedBusinessCodes?: string[]): Promise<Catalog> {
  if (!Array.isArray(selectedStoreIds) || selectedStoreIds.length > 100 || selectedStoreIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Pilihan Store tidak valid (maksimal 100 Store).');
  const businesses = await db.from('scalev_webhook_businesses').select('id,business_code,business_name').eq('workspace_id',workspaceId).eq('is_active',true).order('id');
  if (businesses.error) throw new Error('Katalog Business belum dapat dimuat.');
  const businessRows = businesses.data || [];
  const codes = new Map(businessRows.map(b => [Number(b.id),String(b.business_code)]));
  const catalog: Catalog = { version: '', businesses: businessRows.map(b => ({ id: Number(b.id),code: b.business_code,name: b.business_name })), stores: [], bundles: [], warehouses: [], loadedStoreIds: [], loadedBusinessCodes: [], businessSyncs: [] };
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
  const requested = selectedBusinessCodes === undefined ? chosen.map(s => s.business) : selectedBusinessCodes;
  if (!Array.isArray(requested) || requested.length > 100 || requested.some(code => typeof code !== 'string' || !code || code.length > 100)) throw new Error('Pilihan Business tidak valid.');
  const selected = catalog.businesses.filter(b => requested.includes(b.code));
  if (selected.length !== new Set(requested).size) throw new Error('Business tidak aktif atau bukan milik workspace ini.');
  // A bundle belongs to the receiving Business even when it has no Store link.
  // Observe the Business generation on both sides to reject partial snapshots.
  const readSyncs = () => selected.length ? allPages<{ business_id: number; sync_status: string; last_synced_at: string | null; updated_at: string }>((from,to) => db.from('scalev_catalog_sync_state').select('business_id,sync_status,last_synced_at,updated_at').eq('workspace_id',workspaceId).in('business_id',selected.map(b => b.id)).order('business_id').range(from,to)) : Promise.resolve([]);
  const before = await readSyncs();
  for (const business of selected) {
    const rows = await allPages<any>((from,to) => db.from('scalev_catalog_bundles').select('id,scalev_bundle_id,custom_id,name,last_synced_at').eq('workspace_id',workspaceId).eq('business_id',business.id).order('id').range(from,to));
    catalog.bundles.push(...rows.map(row => ({ id: Number(row.scalev_bundle_id),business: business.code,sku: String(row.custom_id || '').trim(),name: String(row.name),syncedAt: row.last_synced_at })));
  }
  const after = await readSyncs();
  catalog.businessSyncs = selected.map(business => {
    const state = after.find(s => s.business_id === business.id);
    const changed = JSON.stringify(before.find(s => s.business_id === business.id)) !== JSON.stringify(state);
    return { business: business.code,checkedAt: state?.last_synced_at || null,bundleCount: catalog.bundles.filter(b => b.business === business.code).length,status: changed || (state && ['running','failed'].includes(state.sync_status)) ? 'failed' : state?.sync_status === 'success' && state.last_synced_at ? 'ready' : 'unknown' };
  });
  catalog.bundles.sort((a,b) => a.business.localeCompare(b.business) || a.id - b.id);
  catalog.loadedStoreIds = chosen.map(store => store.id).sort((a,b) => a - b);
  catalog.loadedBusinessCodes = selected.map(b => b.code).sort();
  catalog.version = createHash('sha256').update(JSON.stringify({ ...catalog,version: '' })).digest('hex');
  return catalog;
}
