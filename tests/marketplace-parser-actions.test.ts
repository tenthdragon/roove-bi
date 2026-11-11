import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { catalogFixture, configFixture, book, shopee } from './marketplace-parser-fixtures';
import { parseWorkbook } from '../lib/marketplace-parser/read';
import { exportBusinessCsv, projectMarketplace } from '../lib/marketplace-parser/project';

const require = createRequire(import.meta.url);
let settings: any, catalog = catalogFixture(), channels = true, forbidden = false, finalRevision: number | null = null;
let catalogReads: number[][] = [], writes = 0, exportsSaved = 0;
let decisionsWritten: any[] = [], decisionConflict=false, changeDuringDownload=false;
function from(table: string) {
  if(table==='marketplace_parser_route_decisions')return {insert:async(payload:any)=>{if(decisionConflict)return {error:{code:'23505'}};decisionsWritten.push(payload);return {error:null};}};
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
}, requireDashboardPermissionAccess:async()=>{throw new Error('Not a catalog manager');} } } as any;
require.cache[require.resolve('../lib/workspaces')] = { exports: { isWorkspaceModuleEnabled: () => channels } } as any;
require.cache[require.resolve('../lib/service-supabase')] = { exports: { createServiceSupabase: () => ({ from }) } } as any;
require.cache[require.resolve('../lib/marketplace-parser/catalog')] = { exports: { readParserCatalog: async (workspace: string, ids: number[]) => {
  assert.equal(workspace, 'workspace-a'); catalogReads.push(ids);
  if(changeDuringDownload && catalogReads.length===2)settings.revision++;
  return structuredClone(catalog);
} } } as any;
require.cache[require.resolve('../lib/scalev-catalog-actions')] = { exports: { syncScalevCatalogBusiness: async (workspace: string, storeId: number) => ({ workspace, storeId }) } } as any;
require.cache[require.resolve('../lib/marketplace-parser/archive')] = { exports: {
 readBatch:async (_db:any,w:string,id:string)=>{if(id!=='batch-a')throw new Error('Batch tidak valid.');return {id,workspace_id:w,account_id:'roove',business_code:'RTI',batch_date:'2026-11-09',parsed_file:parseWorkbook(book({Orders:[shopee()]}))};},
 assertBatchAccount:()=>{},archiveExport:async()=>{exportsSaved++;return 'export-a';},digest:(text:string)=>createHash('sha256').update(text).digest('hex')
} } as any;
require.cache[require.resolve('../lib/marketplace-parser/access')] = { exports: {
 parserAccess:async(workspace:string)=>{if(forbidden)throw new Error('Forbidden');if(workspace!=='workspace-a')throw new Error('Workspace berubah');if(!channels)throw new Error('Sales Channel tidak aktif');return {profile:{id:'user-a'},workspaceId:workspace,workspace:{}};},parserActorName:async()=> 'Tester'
} } as any;
const actions = require('../lib/marketplace-parser/actions') as typeof import('../lib/marketplace-parser/actions');
const input = () => ({ revision:3,catalogVersion:catalog.version,batchId:'batch-a' });
beforeEach(() => { settings = { revision: 3, config: configFixture() }; catalog = catalogFixture(); channels = true; forbidden = false; finalRevision = null; catalogReads = []; writes = 0; exportsSaved=0;decisionsWritten=[];decisionConflict=false;changeDuringDownload=false; });

test('server regenerates CSV using the saved global configuration and selected Store catalog', async () => {
  const request = input();
  const result = await actions.prepareParserDownload('workspace-a', request);
  assert.equal(result.csv, exportBusinessCsv(projectMarketplace({ file:parseWorkbook(book({Orders:[shopee()]})),account:'roove',date:'2026-11-09',revision:3,config:settings.config,catalog }), 'RTI'));
  assert.equal(result.business, 'RTI');
  assert.deepEqual(catalogReads, [[], [10, 11, 12, 20],[], [10, 11, 12, 20]]);
  assert.equal(exportsSaved,1);
  assert.equal(writes, 0);
});
test('download rejects stale configuration/catalog, config changing during validation, and invalid bundles', async () => {
  await assert.rejects(actions.prepareParserDownload('workspace-a', { ...input(), revision: 2 }), /Konfigurasi berubah/);
  await assert.rejects(actions.prepareParserDownload('workspace-a', { ...input(), catalogVersion: 'old' }), /Katalog berubah/);
  settings.revision=4;
  await assert.rejects(actions.prepareParserDownload('workspace-a', input()), /Konfigurasi berubah/);
  settings.revision=3; catalog.bundles = [];
  await assert.rejects(actions.prepareParserDownload('workspace-a', input()), /Selesaikan semua masalah/);
});
test('server accepts only archived batch identity and rejects client source replacements',async()=>{
 await assert.rejects(actions.prepareParserDownload('workspace-a',{...input(),file:{},edits:{}} as any),/tidak boleh dikoreksi/);
 await assert.rejects(actions.prepareParserDownload('workspace-a',{...input(),batchId:'other-workspace-batch'}),/Batch tidak valid/);
 assert.equal(exportsSaved,0);
});
test('a configuration change during export prevents archiving the stale output',async()=>{changeDuringDownload=true;await assert.rejects(actions.prepareParserDownload('workspace-a',input()),/berubah saat validasi/);assert.equal(exportsSaved,0);});
const approval=()=>({...input(),orderKey:parseWorkbook(book({Orders:[shopee()]})).orders[0].key,storeId:11,previousDecisionId:null});
test('Store approval derives exact bundle identity from the archived source and records the actor',async()=>{
 await actions.approveParserStore('workspace-a',approval());
 assert.equal(decisionsWritten.length,1);const d=decisionsWritten[0];
 assert.deepEqual(d.items,[{bundleId:101,sku:'ROV20-295',quantity:1}]);
 assert.equal(d.account_id,'roove');assert.equal(d.business_code,'RTI');assert.equal(d.store_id,11);assert.equal(d.created_by,'user-a');assert.equal(d.revision,1);assert.equal(d.source_batch_id,'batch-a');
});
test('approval rejects stale context, cross-Business Stores, unknown orders and unresolved bundles',async()=>{
 await assert.rejects(actions.approveParserStore('workspace-b',approval()),/Workspace/);
 await assert.rejects(actions.approveParserStore('workspace-a',{...approval(),revision:2}),/berubah/);
 await assert.rejects(actions.approveParserStore('workspace-a',{...approval(),storeId:20}),/Business akun/);
 await assert.rejects(actions.approveParserStore('workspace-a',{...approval(),orderKey:'fabricated'}),/bundle/);
 catalog.bundles.push({...catalog.bundles[0],id:999});
 await assert.rejects(actions.approveParserStore('workspace-a',approval()),/bundle/);
 assert.equal(decisionsWritten.length,0);
});
test('approval compare-and-swap preserves earlier decisions and rejects simultaneous approvals',async()=>{
 const identity='[[101,"ROV20-295",1]]';catalog.decisions=[{id:'old',account:'roove',business:'RTI',caseKey:identity,items:[],storeId:10,revision:3,actor:'Other',createdAt:'2026-11-10'}];
 await assert.rejects(actions.approveParserStore('workspace-a',approval()),/Keputusan sudah berubah/);
 await actions.approveParserStore('workspace-a',{...approval(),previousDecisionId:'old'});
 assert.equal(decisionsWritten[0].revision,4);assert.equal(catalog.decisions[0].storeId,10);
 decisionConflict=true;
 await assert.rejects(actions.approveParserStore('workspace-a',{...approval(),previousDecisionId:'old'}),/pengguna lain/);
 assert.equal(decisionsWritten.length,1);
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
