import { createServiceSupabase } from './service-supabase';

// Serialize full Business syncs and parser sharing through one generation.
// The database trigger supplies the exact timestamp used for compare-and-swap.
export async function claimCatalogBusiness(workspaceId: string,businessId: number,businessCode: string) {
  const db = createServiceSupabase();
  const inserted = await db.from('scalev_catalog_sync_state').upsert({ workspace_id: workspaceId,business_id: businessId,business_code: businessCode,sync_status: 'idle' },{ onConflict: 'business_id',ignoreDuplicates: true });
  if (inserted.error) throw new Error('Status katalog Business belum tersedia.');
  const claimed = await db.from('scalev_catalog_sync_state').update({ sync_status: 'running',last_error: null }).eq('workspace_id',workspaceId).eq('business_id',businessId).or(`sync_status.neq.running,updated_at.lt.${new Date(Date.now() - 30*60000).toISOString()}`).select('updated_at').maybeSingle();
  if (claimed.error || !claimed.data) throw new Error('Business sedang disinkronkan atau diproses. Tunggu hingga selesai.');
  return claimed.data.updated_at as string;
}
export async function assertCatalogBusinessClaim(workspaceId: string,businessId: number,started: string) {
  const result = await createServiceSupabase().from('scalev_catalog_sync_state').select('business_id').eq('workspace_id',workspaceId).eq('business_id',businessId).eq('sync_status','running').eq('updated_at',started).maybeSingle();
  if (result.error || !result.data || !Number.isFinite(Date.parse(started)) || Date.now() - Date.parse(started) > 25*60000) throw new Error('Proses Business berubah atau kedaluwarsa. Periksa kembali.');
}
export async function failCatalogBusinessClaim(workspaceId: string,businessId: number,started: string,message = 'Perbaikan parser belum selesai. Sinkronkan katalog Business.') {
  const result = await createServiceSupabase().from('scalev_catalog_sync_state').update({ sync_status: 'failed',last_error: message }).eq('workspace_id',workspaceId).eq('business_id',businessId).eq('sync_status','running').eq('updated_at',started);
  if (result.error) throw new Error('Status katalog Business belum berhasil diperbarui.');
}

export async function completeCatalogBusinessClaim(workspaceId: string,businessId: number,started: string,counts: {
  last_synced_at: string; last_error: null; products_count: number; variants_count: number; bundles_count: number; identifiers_count: number;
}) {
  await assertCatalogBusinessClaim(workspaceId,businessId,started);
  const result = await createServiceSupabase().from('scalev_catalog_sync_state').update({ ...counts,sync_status: 'success' }).eq('workspace_id',workspaceId).eq('business_id',businessId).eq('sync_status','running').eq('updated_at',started).select('business_id').maybeSingle();
  if (result.error || !result.data) throw new Error('Proses Business berubah sebelum sinkronisasi selesai. Periksa kembali.');
}
