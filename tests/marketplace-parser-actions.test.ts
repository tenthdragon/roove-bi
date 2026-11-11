import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { catalogFixture, configFixture, book, shopee } from './marketplace-parser-fixtures';
import { parseWorkbook } from '../lib/marketplace-parser/read';
import { exportBusinessCsv, projectMarketplace } from '../lib/marketplace-parser/project';

const require = createRequire(import.meta.url);
let settings: any, catalog = catalogFixture(), channels = true, forbidden = false, finalRevision: number | null = null;
let catalogReads: number[][] = [], writes = 0;
function from(table: string) {
  assert.equal(table, 'marketplace_parser_configs');
  const filters: Record<string, unknown> = {}; let operation = 'read', payload: any, single = false;
  const query: any = {
    select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
    insert(value: any) { operation = 'insert'; payload = value; return query; },
    update(value: any) { operation = 'update'; payload = value; return query; },
    maybeSingle() { return query; }, single() { single = true; return query; },
    then(resolve: (value: any) => void) {
      assert.equal(filters.workspace_id || payload?.workspace_id, 'workspace-a');
      if (operation === 'insert' && settings) return resolve({ data: null, error: { code: '23505' } });
      if (operation === 'update' && filters.revision !== settings?.revision) return resolve({ data: null, error: null });
      if (operation !== 'read') { settings = { ...settings, ...payload }; writes++; }
      resolve({ data: single && finalRevision !== null ? { revision: finalRevision } : structuredClone(settings), error: null });
    },
  };
  return query;
}
require.cache[require.resolve('../lib/dashboard-access')] = { exports: { requireDashboardTabAccess: async () => {
  if (forbidden) throw new Error('Forbidden');
  return { workspaceId: 'workspace-a', workspace: {}, profile: { id: 'user-a' } };
} } } as any;
require.cache[require.resolve('../lib/workspaces')] = { exports: { isWorkspaceModuleEnabled: () => channels } } as any;
require.cache[require.resolve('../lib/service-supabase')] = { exports: { createServiceSupabase: () => ({ from }) } } as any;
require.cache[require.resolve('../lib/marketplace-parser/catalog')] = { exports: { readParserCatalog: async (workspace: string, ids: number[]) => {
  assert.equal(workspace, 'workspace-a'); catalogReads.push(ids);
  return structuredClone(catalog);
} } } as any;
require.cache[require.resolve('../lib/scalev-catalog-actions')] = { exports: { syncScalevCatalogBusiness: async (workspace: string, storeId: number) => ({ workspace, storeId }) } } as any;
const actions = require('../lib/marketplace-parser/actions') as typeof import('../lib/marketplace-parser/actions');
const input = () => ({ revision: 3, catalogVersion: catalog.version, file: parseWorkbook(book({ Orders: [shopee()] }), 'test.xlsx'), account: 'roove', date: '2026-11-09', edits: { lines: {}, orders: {} } });
beforeEach(() => { settings = { revision: 3, config: configFixture() }; catalog = catalogFixture(); channels = true; forbidden = false; finalRevision = null; catalogReads = []; writes = 0; });

test('server regenerates CSV using the saved global configuration and selected Store catalog', async () => {
  const request = input();
  const result = await actions.prepareParserDownload('workspace-a', request);
  assert.equal(result.csv, exportBusinessCsv(projectMarketplace({ ...request, config: settings.config, catalog }), 'RTI'));
  assert.equal(result.business, 'RTI');
  assert.deepEqual(catalogReads, [[], [10, 11, 12, 20]]);
  assert.equal(writes, 0);
});
test('download rejects stale configuration/catalog, config changing during validation, and invalid bundles', async () => {
  await assert.rejects(actions.prepareParserDownload('workspace-a', { ...input(), revision: 2 }), /Konfigurasi berubah/);
  await assert.rejects(actions.prepareParserDownload('workspace-a', { ...input(), catalogVersion: 'old' }), /Katalog berubah/);
  finalRevision = 4;
  await assert.rejects(actions.prepareParserDownload('workspace-a', input()), /berubah saat validasi/);
  finalRevision = null; catalog.bundles = [];
  await assert.rejects(actions.prepareParserDownload('workspace-a', input()), /Selesaikan semua masalah/);
});
test('server disallows per-item routing/SKU overrides and rejects malformed batch envelopes', async () => {
  const request = input();
  (request.edits.lines as any)[request.file.orders[0].lines[0].key] = { sku: 'ANOTHER' };
  await assert.rejects(actions.prepareParserDownload('workspace-a', request), /tidak boleh dikoreksi/);
  await assert.rejects(actions.prepareParserDownload('workspace-a', { ...input(), file: {} } as any), /Batch tidak valid/);
});
test('all server operations check access and workspace before any catalog read or config write', async () => {
  const operations = (workspace: string) => [() => actions.getParserContext(workspace), () => actions.getParserCatalog(workspace, [10]), () => actions.syncParserCatalogBusiness(workspace, 'RTI'), () => actions.saveParserConfig(workspace, 3, configFixture()), () => actions.prepareParserDownload(workspace, input())];
  for (const run of operations('workspace-b')) await assert.rejects(run(), /Workspace berubah/);
  channels = false;
  for (const run of operations('workspace-a')) await assert.rejects(run(), /Sales Channel tidak aktif/);
  channels = true; forbidden = true;
  for (const run of operations('workspace-a')) await assert.rejects(run(), /Forbidden/);
  assert.deepEqual(catalogReads, []); assert.equal(writes, 0);
});
test('global save uses compare-and-swap and validates Store Business and Warehouse relations', async () => {
  assert.equal((await actions.saveParserConfig('workspace-a', 3, configFixture())).revision, 4);
  await assert.rejects(actions.saveParserConfig('workspace-a', 3, configFixture()), /diubah pengguna lain/);
  await assert.rejects(actions.saveParserConfig('workspace-a', 0, configFixture()), /diubah pengguna lain/);
  const invalid = configFixture(); invalid.routes[0].storeId = 20;
  await assert.rejects(actions.saveParserConfig('workspace-a', 4, invalid), /Business/);
  invalid.routes[0].storeId = 10; invalid.stores[0].warehouseId = 2;
  await assert.rejects(actions.saveParserConfig('workspace-a', 4, invalid), /Warehouse/);
  assert.equal(writes, 1);
});
test('context retains an inactive selected Store for correction but does not query its bundles', async () => {
  catalog.stores = catalog.stores.filter(store => store.id !== 10);
  const context = await actions.getParserContext('workspace-a');
  assert.ok(context.config.stores.some(scope => scope.storeId === 10));
  assert.deepEqual(catalogReads, [[], [11, 12, 20]]);
});
test('diagnosis context loads configuration and master metadata without loading the full selected bundle universe',async () => {
  const context = await actions.getParserContext('workspace-a',false);
  assert.equal(context.revision,3); assert.equal(context.config.accounts[0].id,settings.config.accounts[0].id);
  assert.deepEqual(catalogReads,[[]]);
});


test('local isolation disables external sync before any cache mutation', async () => {
  const previous = process.env.ROOVE_LOCAL_DEV;
  process.env.ROOVE_LOCAL_DEV = '1';
  try {
    assert.equal((await actions.getParserContext('workspace-a')).canSync, false);
    await assert.rejects(actions.syncParserCatalogBusiness('workspace-a', 'RTI'), /tidak aktif di lingkungan lokal/);
    assert.equal(writes, 0);
  } finally {
    if (previous === undefined) delete process.env.ROOVE_LOCAL_DEV;
    else process.env.ROOVE_LOCAL_DEV = previous;
  }
});
