'use server';

import { requireDashboardTabAccess, requireDashboardPermissionAccess } from '../dashboard-access';
import { createServiceSupabase } from '../service-supabase';
import { isWorkspaceModuleEnabled } from '../workspaces';
import { migrateParserConfig, validateCatalogConfig, validateParserConfig } from './config';
import { readParserCatalog } from './catalog';
import { syncParserStore } from './sync';
import { exportBusinessCsv, projectMarketplace } from './project';
import type { Edits, ParsedFile, ParserConfig, ParserContext } from './types';

async function access(expectedWorkspace: string) {
  const ctx = await requireDashboardTabAccess('marketplace-data-parser','Marketplace Data Parser');
  if (ctx.workspaceId !== expectedWorkspace) throw new Error('Workspace berubah. Muat ulang halaman sebelum melanjutkan.');
  if (!isWorkspaceModuleEnabled(ctx.workspace,'channels')) throw new Error('Sales Channel tidak aktif untuk workspace ini.');
  return ctx;
}
export async function getParserContext(expectedWorkspace: string): Promise<ParserContext> {
  const ctx = await access(expectedWorkspace), db = createServiceSupabase();
  const settings = await db.from('marketplace_parser_configs').select('revision,config').eq('workspace_id',ctx.workspaceId).maybeSingle();
  const missingSchema = settings.error && ['42P01','PGRST205'].includes(settings.error.code);
  if (settings.error && !missingSchema) throw new Error('Konfigurasi belum dapat dimuat. Coba muat ulang.');
  const metadata = await readParserCatalog(ctx.workspaceId,[],db);
  const migrated = migrateParserConfig(settings.data?.config,metadata);
  const catalog = migrated.config.stores.length ? await readParserCatalog(ctx.workspaceId,migrated.config.stores.map(s => s.storeId).filter(id => metadata.stores.some(s => s.id === id)),db) : metadata;
  let canManageCatalog = false;
  try { const manager = await requireDashboardPermissionAccess('whs:mapping','Pengelolaan katalog Scalev'); canManageCatalog = manager.workspaceId === ctx.workspaceId && manager.profile.id === ctx.profile.id; } catch { /* Diagnosis remains available to parser readers. */ }
  return { workspaceId: ctx.workspaceId,config: migrated.config,revision: settings.data?.revision || 0,catalog,canSave: !missingSchema,canSync: process.env.ROOVE_LOCAL_DEV !== '1',canManageCatalog,migrationNotes: migrated.notes };
}
export async function getParserCatalog(expectedWorkspace: string, storeIds: number[]) {
  const ctx = await access(expectedWorkspace);
  return readParserCatalog(ctx.workspaceId,storeIds);
}
export async function syncParserCatalogStore(expectedWorkspace: string, storeId: number) {
  const ctx = await access(expectedWorkspace);
  if (process.env.ROOVE_LOCAL_DEV === '1') throw new Error('Sinkronisasi langsung Scalev tidak aktif di lingkungan lokal. Gunakan snapshot katalog lokal yang telah disiapkan.');
  if (!Number.isSafeInteger(storeId) || storeId <= 0) throw new Error('Store tidak valid.');
  return syncParserStore(ctx.workspaceId,storeId);
}
export async function saveParserConfig(expectedWorkspace: string, expectedRevision: number, config: ParserConfig) {
  const ctx = await access(expectedWorkspace); validateParserConfig(config);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Versi konfigurasi tidak valid.');
  if (JSON.stringify(config).length > 1024 * 1024) throw new Error('Konfigurasi terlalu besar.');
  const db = createServiceSupabase(), catalog = await readParserCatalog(ctx.workspaceId,[],db);
  validateCatalogConfig(config,catalog);
  const payload = { config,revision: expectedRevision + 1,updated_by: ctx.profile.id,updated_at: new Date().toISOString() };
  const result = expectedRevision === 0
    ? await db.from('marketplace_parser_configs').insert({ workspace_id: ctx.workspaceId,...payload }).select('revision').single()
    : await db.from('marketplace_parser_configs').update(payload).eq('workspace_id',ctx.workspaceId).eq('revision',expectedRevision).select('revision').maybeSingle();
  if (result.error?.code === '23505' || (!result.error && !result.data)) throw new Error('Konfigurasi telah diubah pengguna lain. Muat ulang sebelum menyimpan.');
  if (result.error) throw new Error('Konfigurasi belum dapat disimpan. Pastikan migration parser terbaru sudah diterapkan.');
  return { workspaceId: ctx.workspaceId,revision: result.data!.revision };
}
export async function prepareParserDownload(expectedWorkspace: string, input: { revision: number; catalogVersion: string; file: ParsedFile; account: string; date: string; edits: Edits }) {
  await access(expectedWorkspace);
  if (!input || JSON.stringify(input).length > 16 * 1024 * 1024 || !Array.isArray(input.file?.orders) || input.file.orders.length > 20000 || input.file.orders.reduce((n,o) => n + (Array.isArray(o.lines) ? o.lines.length : 20001),0) > 20000) throw new Error('Batch tidak valid atau terlalu besar.');
  const ctx = await getParserContext(expectedWorkspace);
  if (!ctx.revision || ctx.migrationNotes.length || ctx.revision !== input.revision) throw new Error('Konfigurasi berubah atau belum disimpan. Muat ulang aturan dan validasi batch sebelum download.');
  if (ctx.catalog.version !== input.catalogVersion) throw new Error('Katalog berubah. Muat ulang katalog dan periksa preview terbaru sebelum download.');
  const projection = projectMarketplace({ ...input,config: ctx.config,catalog: ctx.catalog });
  const business = ctx.config.accounts.find(a => a.id === input.account)?.business || '';
  const csv = exportBusinessCsv(projection,business);
  const latest = await createServiceSupabase().from('marketplace_parser_configs').select('revision').eq('workspace_id',ctx.workspaceId).single();
  if (latest.error || latest.data.revision !== ctx.revision) throw new Error('Konfigurasi berubah saat validasi. Muat ulang aturan sebelum download.');
  return { business,csv,revision: ctx.revision,catalogVersion: ctx.catalog.version };
}
