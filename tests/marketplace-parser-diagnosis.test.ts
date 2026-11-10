import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedRepairStores, diagnoseBundles, repairBundles, type CatalogConnection } from '../lib/marketplace-parser/diagnosis';
import { ParserScalevClient, type ScalevBundle } from '../lib/marketplace-parser/scalev-client';
import { signDiagnosis, verifyDiagnosis } from '../lib/marketplace-parser/diagnosis-token';
import { configFixture } from './marketplace-parser-fixtures';

function fixture() {
  const targetIdentity = { id: 9,unique_id: 'RTI_UID',account_holder: 'RTI' }, ownerIdentity = { id: 12,unique_id: 'RLB_UID',account_holder: 'RLB' };
  const bundle: ScalevBundle = { id: 2,name: 'Roove 20',custom_id: 'ROV20-295',business: ownerIdentity };
  const state = { visible: false,installed: false,shared: false,failAttach: false,unknownAttach: false,duplicate: false,failOther: false,sku: 'ROV20-295',options: [{ id: 4050,name: '295',price: '295000.00',is_visible: true }],writes: [] as string[],audits: [] as string[],checks: 0 };
  const detail = () => ({ ...bundle,custom_id: state.sku });
  const target: CatalogConnection = { id: 4,code: 'RTI',client: {
    identity: async () => targetIdentity,
    stores: async () => [{ id: 15443,name: 'Marketplace' }],
    store: async id => ({ id,name: 'Marketplace',business: targetIdentity,is_active: true }),
    bundles: async () => state.visible ? [detail(),...(state.duplicate ? [{ ...detail(),id: 3 }] : [])] : [],
    storeBundles: async () => state.installed ? [detail()] : [],
    bundle: async () => state.visible ? detail() : null,
    options: async () => state.options,
    partners: async () => [], share: async () => { throw new Error('Wrong credential'); },
    attach: async (_store,id) => { assert.equal(id,4050); state.writes.push('attach'); if (state.failAttach) throw new Error('Attach rejected'); state.installed = true; if (state.unknownAttach) throw new Error('Hasil belum pasti'); },
  } };
  const owner: CatalogConnection = { id: 8,code: 'RLB',client: { ...target.client,
    identity: async () => ownerIdentity,
    bundles: async () => { if (state.failOther) throw new Error('API unavailable'); return [detail()]; },
    bundle: async () => detail(),
    partners: async () => state.shared ? [{ id: 99,partner: targetIdentity }] : [],
    share: async (id,uid) => { assert.equal(id,2); assert.equal(uid,'RTI_UID'); state.writes.push('share'); state.shared = true; state.visible = true; },
  } };
  const config = configFixture();
  const input = { workspaceId: 'w',actorId: 'u',revision: 3,account: 'roove',skus: ['ROV20-295'],config,target,connections: [target,owner],stores: [{ id: 10,name: 'Marketplace',scalevId: 15443,uniqueId: null }] };
  const diagnose = () => diagnoseBundles(input);
  const repair = async (permit: Awaited<ReturnType<typeof diagnose>>['permit'], changes: Record<string,unknown> = {}) => repairBundles({ permit,request: { token: '',storeId: 10,mode: 'attach',items: [{ sku: 'ROV20-295',bundleId: 2,optionId: 4050,share: true,...changes }] },target,connections: [target,owner],ensureCurrent: async () => { state.checks++; },audit: async stage => { state.audits.push(stage); } });
  return { state,input,target,owner,diagnose,repair };
}
test('diagnosis separates owner, receiving Business and Store and signs only exact, unique candidates',async () => {
  const f = fixture(), { diagnosis,permit } = await f.diagnose();
  assert.equal(diagnosis.business,'RTI'); assert.equal(diagnosis.items[0].bundles[0].owner,'RLB');
  assert.equal(diagnosis.items[0].bundles[0].availableInBusiness,false);
  assert.equal(diagnosis.items[0].bundles[0].canShare,true);
  assert.deepEqual(permit.stores,[{ id: 10,scalevId: 15443,name: 'Marketplace' }]);
  assert.equal(permit.bundles[0].sourceBusinessId,8);
  f.state.visible = true; f.state.installed = true;
  const refreshed = await f.diagnose();
  assert.deepEqual(refreshed.diagnosis.items[0].bundles[0].installedStoreIds,[10]);
  assert.equal(refreshed.diagnosis.items[0].bundles[0].canShare,false);
});
test('failed/partial cross-Business reads never report missing or enable writes',async () => {
  const f = fixture(); f.state.failOther = true;
  const result = await f.diagnose();
  assert.equal(result.diagnosis.items[0].status,'unavailable'); assert.equal(result.permit.bundles.length,0);
  assert.match(result.diagnosis.issues.join(' '),/RLB/);
});
test('exact identifier matching does not infer names, aliases, price suffixes or case',async () => {
  const f = fixture(); f.input.skus = ['rov20-295','Roove 20','ROV20-999'];
  const result = await f.diagnose(); assert.ok(result.diagnosis.items.every(i => i.status === 'missing')); assert.equal(result.permit.bundles.length,0);
});
test('duplicate codes disclose conflicts and receive no repair authorization',async () => {
  const f = fixture(); f.state.visible = true; f.state.duplicate = true;
  const result = await f.diagnose(); assert.equal(result.diagnosis.items[0].status,'ambiguous'); assert.equal(result.diagnosis.items[0].bundles.length,2); assert.equal(result.permit.bundles.length,0);
});
test('storefront-hidden BPOs remain valid catalog options',async () => {
  const f = fixture(); f.state.options[0].is_visible = false;
  const result = await f.diagnose(); assert.deepEqual(result.permit.bundles[0].optionIds,[4050]);
  assert.equal((await f.repair(result.permit))[0].stage,'ready');
});
test('routing and mixed-product combinations restrict the installation Store globally',() => {
  const f = fixture(); const stores = [10,11,12].map(id => ({ id,name: String(id),scalevId: id,uniqueId: null }));
  assert.deepEqual(allowedRepairStores(f.input.config,'roove',['ROV20-295'],stores).stores.map(s => s.id),[10]);
  const config = f.input.config; config.combinations = [];
  const result = allowedRepairStores(config,'roove',['ROV20-295','PLV10-100'],stores);
  // Unknown Product alongside a routed Product cannot be silently installed.
  assert.equal(result.stores.length,0); assert.ok(result.issues.length);
  config.products = []; config.routes = [];
  assert.equal(allowedRepairStores(config,'roove',['ANY'],stores).stores.length,3);
});
test('without explicit routing, a unique common live Store is suggested automatically',async () => {
  const f = fixture(); f.input.config.routes = []; f.input.config.combinations = []; f.state.visible = true; f.state.installed = true;
  f.input.stores.push({ id: 11,name: 'Other Store',scalevId: 15444,uniqueId: null });
  f.target.client.stores = async () => [{ id: 15443,name: 'Marketplace' },{ id: 15444,name: 'Other Store' }];
  const original = f.target.client.store;
  f.target.client.store = async id => ({ ...await original(id),name: id === 15443 ? 'Marketplace' : 'Other Store' });
  const originalBundles = f.target.client.storeBundles;
  f.target.client.storeBundles = async id => id === 15443 ? originalBundles(id) : [];
  const result = await f.diagnose(); assert.equal(result.diagnosis.suggestedStoreId,10); assert.equal(result.diagnosis.stores.length,2);
});
test('sharing uses owner credentials and target unique_id, then attaches chosen BPO; repeat is idempotent',async () => {
  const f = fixture(), { permit } = await f.diagnose();
  assert.equal((await f.repair(permit))[0].stage,'ready');
  assert.deepEqual(f.state.writes,['share','attach']);
  assert.deepEqual(f.state.audits,['share_requested','shared','attach_requested','attached']);
  assert.ok(f.state.checks >= 4);
  assert.equal((await f.repair(permit))[0].stage,'ready'); assert.deepEqual(f.state.writes,['share','attach']);
});
test('partial sharing success resumes attachment without sharing twice',async () => {
  const f = fixture(), { permit } = await f.diagnose(); f.state.failAttach = true;
  const first = await f.repair(permit); assert.equal(first[0].stage,'shared'); assert.match(first[0].message,/Attach rejected/);
  f.state.failAttach = false; assert.equal((await f.repair(permit))[0].stage,'ready');
  assert.deepEqual(f.state.writes,['share','attach','attach']);
});
test('unknown POST outcome is checked live on retry, without replaying a successful attachment',async () => {
  const f = fixture(), { permit } = await f.diagnose(); f.state.unknownAttach = true;
  assert.match((await f.repair(permit))[0].message,/Hasil belum pasti/);
  assert.equal((await f.repair(permit))[0].stage,'ready'); assert.deepEqual(f.state.writes,['share','attach']);
});
test('forged options, missing sharing consent, changed codes, revoked options and new duplicates block writes',async () => {
  for (const situation of ['option','consent','sku','revoked','duplicate'] as const) {
    const f = fixture(), { permit } = await f.diagnose();
    if (situation === 'option') await assert.rejects(f.repair(permit,{ optionId: 999 }),/pilihan harga/);
    else {
      if (situation === 'sku') f.state.sku = 'CHANGED';
      if (situation === 'revoked') f.state.options = [];
      if (situation === 'duplicate') { f.state.visible = true; f.state.duplicate = true; }
      assert.notEqual((await f.repair(permit,situation === 'consent' ? { share: false } : {}))[0].stage,'ready');
    }
    assert.deepEqual(f.state.writes,[],situation);
  }
});
test('revision/lease or audit failures stop before a write',async () => {
  const f = fixture(), { permit } = await f.diagnose();
  const request = { token: '',storeId: 10,mode: 'attach' as const,items: [{ sku: 'ROV20-295',bundleId: 2,optionId: 4050,share: true }] };
  await assert.rejects(repairBundles({ permit,request,target: f.target,connections: f.input.connections,ensureCurrent: async () => { throw new Error('Revision changed'); },audit: async () => {} }),/Revision changed/);
  const result = await repairBundles({ permit,request,target: f.target,connections: f.input.connections,ensureCurrent: async () => {},audit: async () => { throw new Error('Audit unavailable'); } });
  assert.match(result[0].message,/Audit unavailable/); assert.deepEqual(f.state.writes,[]);
});
test('diagnosis permit is bound to actor/workspace and rejects tampering and expiry',async () => {
  const old = process.env.SUPABASE_SERVICE_ROLE_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key';
  try {
    const { permit } = await fixture().diagnose(), token = signDiagnosis(permit);
    assert.deepEqual(verifyDiagnosis(token,'w','u'),permit);
    assert.throws(() => verifyDiagnosis(token,'other','u'),/sesi/);
    assert.throws(() => verifyDiagnosis(token,'w','other'),/sesi/);
    assert.throws(() => verifyDiagnosis(`${token.split('.')[0]}x.${token.split('.')[1]}`,'w','u'),/tidak valid/);
    assert.throws(() => verifyDiagnosis(signDiagnosis({ ...permit,expiresAt: 1 }),'w','u'),/kedaluwarsa/);
  } finally { if (old === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = old; }
});
test('v3 pagination consumes opaque cursors and fails closed on malformed/repeated pages',async () => {
  const urls: string[] = [];
  const client = new ParserScalevClient('synthetic',async (url,init) => { urls.push(String(url)); assert.equal(init?.redirect,'error'); return Response.json({ data: [{ id: urls.length }],has_next: urls.length === 1,next_cursor: 'a+/=' }); });
  assert.equal((await client.bundles()).length,2); assert.match(urls[1],/next_cursor=a%2B%2F%3D/);
  const repeated = new ParserScalevClient('synthetic',async () => Response.json({ data: [{ id: 1 }],has_next: true,next_cursor: 'same' }));
  await assert.rejects(repeated.bundles(),/berulang/);
  await assert.rejects(new ParserScalevClient('synthetic',async () => Response.json({ data: [] })).bundles(),/tidak lengkap/);
});
test('Scalev POST uses documented payloads, sanitizes errors and never automatically retries a write',async () => {
  const calls: { url: string; body: unknown }[] = [];
  const client = new ParserScalevClient('do-not-leak',async (url,init) => { calls.push({ url: String(url),body: JSON.parse(init?.body as string) }); return new Response('secret upstream body',{ status: 503 }); });
  await assert.rejects(client.share(2,'RTI_UID'),e => /503/.test(String(e)) && !/secret|do-not-leak/.test(String(e)));
  assert.deepEqual(calls,[{ url: 'https://api.scalev.id/v3/bundles/2/partners',body: { partner_unique_id: 'RTI_UID' } }]);
  const attach = new ParserScalevClient('synthetic',async (url,init) => { assert.equal(String(url),'https://api.scalev.id/v3/stores/15443/bundle-price-options'); assert.deepEqual(JSON.parse(init?.body as string),{ bpo_ids: [4050] }); return new Response(null,{ status: 204 }); });
  await attach.attach(15443,4050);
});
