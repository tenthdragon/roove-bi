import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require.cache[require.resolve('../lib/service-supabase')] = { exports: { createServiceSupabase: () => ({ from }) } } as any;
require.cache[require.resolve('../lib/warehouse-activity-log-actions')] = { exports: { recordWarehouseActivityLog: async () => {} } } as any;
const { allPages, readParserCatalog } = require('../lib/marketplace-parser/catalog') as typeof import('../lib/marketplace-parser/catalog');
const { readScalevPages } = require('../lib/marketplace-parser/sync') as typeof import('../lib/marketplace-parser/sync');
let rows: Record<string, any[]> = {}, queries: { table: string; filters: [string,string,unknown][]; columns: string }[] = [];
let onRead: ((table: string) => void) | undefined;
function from(table: string) {
  const filters: [string,string,unknown][] = []; let columns = '', start = 0, end = Infinity;
  const q: any = {
    select(value: string) { columns = value; return q; }, eq(key: string, value: unknown) { filters.push(['eq', key, value]); return q; },
    in(key: string, value: unknown[]) { filters.push(['in', key, value]); return q; }, not(key: string, op: string, value: unknown) { assert.equal(op, 'is'); filters.push(['not', key, value]); return q; },
    order() { return q; }, range(a: number, b: number) { start = a; end = b; return q; },
    then(resolve: (value: any) => void) {
      onRead?.(table);
      queries.push({ table, filters, columns });
      assert.ok(filters.some(([op,key,value]) => op === 'eq' && key === 'workspace_id' && value === 'workspace-a'), `${table} must be workspace scoped`);
      assert.ok(!/api_key|\*/.test(columns), 'The browser catalog never contains credentials');
      resolve({ data: structuredClone((rows[table] || []).filter(row => filters.every(([op,key,value]) => op === 'eq' ? row[key] === value : op === 'in' ? (value as any[]).includes(row[key]) : row[key] !== value)).slice(start, end + 1)), error: null });
    },
  }; return q;
}
beforeEach(() => {
  queries = [];
  onRead = undefined;
  const row = (data: any) => ({ workspace_id: 'workspace-a', is_active: true, ...data });
  rows = {
    scalev_webhook_businesses: [row({ id: 4,business_code: 'RTI',business_name: 'Business RTI' }),row({ id: 2,business_code: 'JHN',business_name: 'Business JHN' })],
    scalev_store_channels: [row({ id: 10,business_id: 4,store_name: 'Selected Store' }),row({ id: 11,business_id: 4,store_name: 'Unused Store' }),row({ id: 20,business_id: 2,store_name: 'JHN Store' }),row({ id: 99,business_id: 4,store_name: 'Foreign',workspace_id: 'workspace-b' })],
    warehouse_business_mapping: [row({ id: 1,business_code: 'RTI',deduct_entity: 'OPS',deduct_warehouse: 'WH' })],
    warehouse_origin_registry: [row({ id: 1,external_origin_name: 'Operations',operator_business_code: 'OPS',internal_warehouse_code: 'WH' }),row({ id: 2,external_origin_name: 'Unknown',operator_business_code: 'OPS',internal_warehouse_code: 'WH' })],
    marketplace_intake_source_store_scopes: [row({ id: 1,is_enabled: true,scalev_warehouse_name: "Operations's Warehouse" })],
    scalev_catalog_bundle_store_links: [row({ id: 1,business_id: 4,scalev_bundle_id: 101,store_name: 'Selected Store',is_available: true,last_checked_at: '2026-11-09' }),row({ id: 2,business_id: 4,scalev_bundle_id: 102,store_name: 'Unused Store',is_available: true,last_checked_at: '2026-11-09' }),row({ id: 3,business_id: 4,scalev_bundle_id: 103,store_name: 'Selected Store',is_available: false,last_checked_at: '2026-11-09' })],
    scalev_catalog_bundles: [row({ id: 1,business_id: 4,scalev_bundle_id: 101,custom_id: 'SKU-A',name: 'Bundle A',last_synced_at: '2026-11-09' }),row({ id: 2,business_id: 4,scalev_bundle_id: 102,custom_id: 'SKU-B',name: 'Bundle B',last_synced_at: '2026-11-09' })],
    marketplace_parser_store_syncs: [],
  };
});
test('metadata load avoids every bundle query; selected Stores narrow both links and bundle IDs', async () => {
  await readParserCatalog('workspace-a', []);
  assert.ok(!queries.some(q => q.table.includes('catalog_bundle')));
  queries = [];
  const catalog = await readParserCatalog('workspace-a', [10]);
  assert.deepEqual(catalog.loadedStoreIds, [10]);
  assert.deepEqual(catalog.bundles.map(b => [b.id,b.sku,b.storeIds]), [[101,'SKU-A',[10]]]);
  assert.deepEqual(queries.find(q => q.table === 'scalev_catalog_bundles')?.filters.find(f => f[1] === 'scalev_bundle_id'), ['in','scalev_bundle_id',[101]]);
  await assert.rejects(readParserCatalog('workspace-a', [99]), /bukan milik workspace/);
});
test('Warehouse export names come from configured integration data; missing/ambiguous labels stay unresolved', async () => {
  let catalog = await readParserCatalog('workspace-a', []);
  assert.equal(catalog.warehouses[0].exportName, "Operations's Warehouse");
  assert.equal(catalog.warehouses[1].exportName, null);
  rows.marketplace_intake_source_store_scopes.push({ workspace_id: 'workspace-a',id: 2,is_enabled: true,scalev_warehouse_name: 'Operations Warehouse' });
  catalog = await readParserCatalog('workspace-a', []);
  assert.equal(catalog.warehouses[0].exportName, null, 'Conflicting configured labels must not be guessed');
});
test('empty completed catalog is distinct from unknown; a failed/in-progress sync blocks even with old links', async () => {
  let catalog = await readParserCatalog('workspace-a', [10,20]);
  assert.deepEqual(catalog.storeSyncs.map(s => s.status), ['ready','unknown']);
  const before = catalog.version;
  rows.marketplace_parser_store_syncs = [{ workspace_id: 'workspace-a',store_id: 10,status: 'syncing',synced_at: null,bundle_count: 1 },{ workspace_id: 'workspace-a',store_id: 20,status: 'ready',synced_at: '2026-11-09',bundle_count: 0 }];
  catalog = await readParserCatalog('workspace-a', [10,20]);
  assert.deepEqual(catalog.storeSyncs.map(s => s.status), ['failed','ready']);
  assert.notEqual(catalog.version, before);
  assert.equal(catalog.version, (await readParserCatalog('workspace-a', [10,20])).version);
});
test('catalog pagination reads past the database page limit and propagates incomplete reads', async () => {
  const data = Array.from({ length: 1001 }, (_,id) => ({ id }));
  assert.equal((await allPages(async (from,to) => ({ data: data.slice(from,to + 1),error: null }))).length, 1001);
  await assert.rejects(allPages(async () => ({ data: null,error: { message: 'failed' } })), /belum dapat dimuat/);
});
test('Business sync failure and an intervening Store sync cannot unlock a partially updated catalog',async () => {
  rows.scalev_catalog_sync_state = [{ workspace_id: 'workspace-a',business_id: 4,sync_status: 'failed',updated_at: 'before' }];
  assert.equal((await readParserCatalog('workspace-a',[10])).storeSyncs[0].status,'failed');
  rows.scalev_catalog_sync_state[0].sync_status = 'success';
  rows.marketplace_parser_store_syncs = [{ workspace_id: 'workspace-a',store_id: 10,status: 'ready',synced_at: '2026-11-09',updated_at: 'before' }];
  onRead = table => { if (table === 'scalev_catalog_bundles') rows.marketplace_parser_store_syncs[0].updated_at = 'after'; };
  assert.equal((await readParserCatalog('workspace-a',[10])).storeSyncs[0].status,'failed');
  onRead = undefined;
  assert.equal((await readParserCatalog('workspace-a',[10])).storeSyncs[0].status,'ready');
});
const page = (ids: number[], hasNext: boolean, lastId?: number) => new Response(JSON.stringify({ code: 200,data: { results: ids.map(id => ({ id })),has_next: hasNext,last_id: lastId } }));
test('Scalev pagination uses the cursor, rejects repeats/incomplete responses, and restricts endpoints', async () => {
  const urls: string[] = [];
  const result = await readScalevPages('test-secret', 'stores/10/bundles', (async (url: string) => { urls.push(url); return urls.length === 1 ? page([10,9],true,9) : page([8],false); }) as typeof fetch);
  assert.deepEqual(result.map(row => row.id), [10,9,8]);
  assert.match(urls[1], /last_id=9$/); assert.ok(urls.every(url => !url.includes('test-secret')));
  let count = 0;
  await assert.rejects(readScalevPages('test', 'stores', (async () => ++count === 1 ? page([10],true,10) : page([10],false)) as typeof fetch), /berulang/);
  await assert.rejects(readScalevPages('test', 'stores', (async () => new Response(JSON.stringify({ code: 200,data: {} }))) as typeof fetch), /tidak lengkap/);
  await assert.rejects(readScalevPages('test', 'orders', (async () => { throw new Error('must not fetch'); }) as typeof fetch), /Endpoint/);
});
