import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { contextFixture } from './marketplace-parser-fixtures';
import { signDiagnosis, type DiagnosisPermit } from '../lib/marketplace-parser/diagnosis-token';
import { ScalevReadError } from '../lib/marketplace-parser/scalev-client';
const require = createRequire(import.meta.url);
let context = contextFixture(), forbidden = false, manager = true, channels = true, revision = 3, reads = 0, writes = 0, claims = 0, released = 0, syncs = 0, syncFail = false, installed = false;
let audits: string[] = [];
let legacyStoreColumns = false;
let catalogError: Error | null = null;
const identity = { id: 9,unique_id: 'RTI_UID' }, storeName = 'Roove Main Store - Marketplace';
const bundle = { id: 2,name: 'Roove',custom_id: 'ROV20-295',business: identity };
const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY, oldLocal = process.env.ROOVE_LOCAL_DEV;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-key'; delete process.env.ROOVE_LOCAL_DEV;
after(() => { if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey; if (oldLocal === undefined) delete process.env.ROOVE_LOCAL_DEV; else process.env.ROOVE_LOCAL_DEV = oldLocal; });
const auth = async () => { if (forbidden) throw new Error('Forbidden'); return { workspaceId: 'synthetic-test',profile: { id: 'u' },workspace: {} }; };
require.cache[require.resolve('../lib/dashboard-access')] = { exports: { requireDashboardTabAccess: auth,requireDashboardPermissionAccess: async () => { if (!manager) throw new Error('Manage permission denied'); return auth(); } } } as any;
require.cache[require.resolve('../lib/workspaces')] = { exports: { isWorkspaceModuleEnabled: () => channels } } as any;
require.cache[require.resolve('../lib/marketplace-parser/actions')] = { exports: { getParserContext: async () => structuredClone(context) } } as any;
require.cache[require.resolve('../lib/marketplace-parser/catalog')] = { exports: { ...require('../lib/marketplace-parser/catalog'),readParserCatalog: async () => structuredClone(context.catalog) } } as any;
require.cache[require.resolve('../lib/marketplace-parser/sync')] = { exports: {
  claimParserStore: async () => { claims++; return 'lease'; },assertParserStoreClaim: async () => {},
  failParserStoreClaim: async () => { released++; context.catalog.storeSyncs.forEach(s => { s.status = 'failed'; }); },
  syncParserStore: async (_w: string,_s: number,lease: unknown) => { assert.ok(lease); syncs++; if (syncFail) throw new Error('Sync failed'); },
} } as any;
require.cache[require.resolve('../lib/marketplace-parser/scalev-client')] = { exports: { ScalevReadError,ParserScalevClient: class {
  async identity() { reads++; return identity; }
  async stores() { reads++; return [{ id: 15443,name: storeName }]; }
  async store() { reads++; return { id: 15443,name: storeName,business: identity }; }
  async bundles() { reads++; if (catalogError) throw catalogError; return [bundle]; }
  async bundle() { reads++; return bundle; }
  async options() { reads++; return [{ id: 4050,name: '295',price: '295000' }]; }
  async storeBundles() { reads++; return installed ? [bundle] : []; }
  async attach() { writes++; installed = true; }
} } } as any;
function from(table: string) {
  const filters: Record<string,unknown> = {}; let payload: any,columns = '';
  const q: any = { select(value: string) { columns = value; return q; },eq(k: string,v: unknown) { filters[k] = v; return q; },in(k: string,v: unknown) { filters[k] = v; return q; },order() { return q; },range() { return q; },update(p: any) { payload = p; return q; },limit() { return q; },single() { return q; },insert(p: any) { payload = p; return q; },
    then(resolve: (v: unknown) => void) {
      assert.equal(payload?.workspace_id || filters.workspace_id,'synthetic-test');
      if (table === 'marketplace_parser_configs') return resolve({ data: { revision },error: null });
      if (table === 'scalev_webhook_businesses') { if (payload) return resolve({ error: null }); assert.equal(filters.is_active,true); return resolve({ data: [{ id: 4,business_code: 'RTI',scalev_business_uid: 'RTI_UID',api_key: 'synthetic' }],error: null }); }
      if (table === 'scalev_store_channels') {
        assert.equal(filters.business_id,4); assert.equal(filters.is_active,true);
        if (legacyStoreColumns && columns.includes('scalev_store_id')) return resolve({ data: null,error: { code: '42703',message: 'column scalev_store_channels.scalev_store_id does not exist' } });
        return resolve({ data: [{ id: 10,store_name: storeName,...(legacyStoreColumns ? {} : { scalev_store_id: 15443,store_unique_id: null }) }],error: null });
      }
      if (table === 'scalev_catalog_bundles') return resolve({ data: [{ id: 1,business_id: 4,scalev_bundle_id: 2,custom_id: 'ROV20-295',name: 'Roove',scalev_owner_uid: 'RTI_UID',scalev_owner_name: 'RTI',price_options: [{ id: 4050,name: '295',price: '295000' }],last_synced_at: '2026-11-10T00:00:00Z' }],error: catalogError });
      if (table === 'scalev_catalog_sync_state' || table === 'marketplace_parser_store_syncs') return resolve({ data: [],error: null });
      if (table === 'scalev_catalog_bundle_store_links') return resolve({ data: [{ id: 1,scalev_bundle_id: 2,scalev_store_id: 15443,store_name: storeName,is_available: installed }],error: null });
      assert.equal(table,'warehouse_activity_log'); assert.equal(payload.acted_by,'u'); audits.push(payload.action); return resolve({ error: null });
    } };
  return q;
}
require.cache[require.resolve('../lib/service-supabase')] = { exports: { createServiceSupabase: () => ({ from }) } } as any;
const actions = require('../lib/marketplace-parser/case-actions') as typeof import('../lib/marketplace-parser/case-actions');
const permit = (): DiagnosisPermit => ({ workspaceId: 'synthetic-test',actorId: 'u',revision: 3,account: 'roove',expiresAt: Date.now() + 60000,targetBusinessId: 4,targetUid: 'RTI_UID',skus: ['ROV20-295'],stores: [{ id: 10,name: storeName,scalevId: 15443 }],bundles: [{ sku: 'ROV20-295',id: 2,sourceBusinessId: 4,ownerUid: 'RTI_UID',optionIds: [4050],canShare: false }] });
const request = () => ({ token: signDiagnosis(permit()),storeId: 10,mode: 'attach' as const,items: [{ sku: 'ROV20-295',bundleId: 2,optionId: 4050,share: false }] });
beforeEach(() => { context = contextFixture(); forbidden = false; manager = true; channels = true; revision = 3; reads = writes = claims = released = syncs = 0; syncFail = installed = legacyStoreColumns = false; audits = []; catalogError = null; });
test('diagnosis uses the application database without any Scalev requests or syncs',async () => {
  const diagnosis = JSON.parse(JSON.stringify(await actions.diagnoseParserCase('synthetic-test',{ account: 'roove',revision: 3,skus: ['ROV20-295'] })));
  assert.equal(diagnosis.items[0].status,'found'); assert.ok(diagnosis.token);
  assert.equal(reads + writes + claims + syncs,0);
});
test('unexpected diagnosis errors do not expose internal details in returned data',async () => {
  catalogError = new Error('private upstream response or credential');
  const diagnosis = await actions.diagnoseParserCase('synthetic-test',{ account: 'roove',revision: 3,skus: ['ROV20-295'] });
  assert.match(diagnosis.issues[0],/muat ulang data aplikasi/);
  assert.doesNotMatch(JSON.stringify(diagnosis),/private upstream/);
  assert.equal(diagnosis.token,''); assert.equal(writes + claims + syncs,0);
});
test('diagnosis is readable without mutation permission; repair enforces permission before any external access',async () => {
  manager = false;
  const diagnosis = await actions.diagnoseParserCase('synthetic-test',{ account: 'roove',revision: 3,skus: ['ROV20-295'] });
  assert.equal(diagnosis.items[0].status,'found'); reads = 0;
  await assert.rejects(actions.repairParserCase('synthetic-test',request()),/permission denied/);
  assert.equal(reads + writes + claims,0);
});
test('workspace, module, auth, and local isolation are checked before Scalev access or cache writes',async () => {
  const diagnose = (w = 'synthetic-test') => actions.diagnoseParserCase(w,{ account: 'roove',revision: 3,skus: ['ROV20-295'] });
  await assert.rejects(diagnose('other'),/Workspace berubah/);
  await assert.rejects(actions.repairParserCase('other',request()),/Workspace berubah/);
  channels = false; await assert.rejects(diagnose(),/Sales Channel/); channels = true;
  forbidden = true; await assert.rejects(diagnose(),/Forbidden/); forbidden = false;
  process.env.ROOVE_LOCAL_DEV = '1';
  try { assert.equal((await diagnose()).items[0].status,'found'); await assert.rejects(actions.repairParserCase('synthetic-test',request()),/lingkungan lokal/); }
  finally { delete process.env.ROOVE_LOCAL_DEV; }
  assert.equal(reads + writes + claims,0);
});
test('forged Store, option, actor and stale config are rejected before claiming a Store',async () => {
  await assert.rejects(actions.repairParserCase('synthetic-test',{ ...request(),storeId: 20 }),/Store tidak sesuai/);
  await assert.rejects(actions.repairParserCase('synthetic-test',{ ...request(),items: [{ ...request().items[0],optionId: 999 }] }),/Pilihan bundle/);
  await assert.rejects(actions.repairParserCase('synthetic-test',{ ...request(),token: signDiagnosis({ ...permit(),actorId: 'other' }) }),/sesi/);
  context.revision = 4;
  await assert.rejects(actions.repairParserCase('synthetic-test',request()),/Aturan berubah/);
  assert.equal(reads + writes + claims,0);
});
test('repair records request/outcome, synchronizes the same claimed Store and returns a fresh catalog',async () => {
  const result = await actions.repairParserCase('synthetic-test',request());
  assert.equal(result.result.synced,true); assert.equal(result.result.items[0].stage,'ready'); assert.equal(claims,1); assert.equal(syncs,1); assert.equal(writes,1); assert.equal(released,0);
  assert.deepEqual(audits,['parser_bundle_attach_requested','parser_bundle_attached','parser_bundle_completed']);
  assert.equal(result.catalog.version,context.catalog.version);
});
test('sync failure marks the catalog unready, preserves completed external steps, and refresh can recover without management permission',async () => {
  syncFail = true; const first = await actions.repairParserCase('synthetic-test',request());
  assert.equal(first.result.synced,false); assert.equal(first.result.items[0].stage,'ready'); assert.equal(released,1); assert.ok(first.catalog.storeSyncs.every(s => s.status === 'failed'));
  syncFail = false; manager = false;
  const second = await actions.repairParserCase('synthetic-test',{ ...request(),mode: 'refresh',items: [] });
  assert.equal(second.result.synced,true); assert.equal(writes,1);
});
test('configuration changing after diagnosis stops before any external write and leaves download blocked',async () => {
  revision = 4;
  const result = await actions.repairParserCase('synthetic-test',request());
  assert.equal(writes,0); assert.equal(syncs,0); assert.equal(result.result.synced,false); assert.match(result.result.message,/Aturan tim berubah/); assert.equal(released,1);
});
test('legacy Store masters resolve cached identity for diagnosis and reverify it live before repair',async () => {
  legacyStoreColumns = true;
  const diagnosis = await actions.diagnoseParserCase('synthetic-test',{ account: 'roove',revision: 3,skus: ['ROV20-295'] });
  assert.deepEqual(diagnosis.stores,[{ id: 10,name: storeName }]);
  const result = await actions.repairParserCase('synthetic-test',{ ...request(),token: diagnosis.token });
  assert.equal(result.result.synced,true); assert.equal(writes,1);
});
