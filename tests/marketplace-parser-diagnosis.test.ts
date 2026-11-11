import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDiagnosisRoute, shareBundles, type CatalogConnection } from '../lib/marketplace-parser/diagnosis';
import { ParserScalevClient, type ScalevBundle } from '../lib/marketplace-parser/scalev-client';
import { signDiagnosis, verifyDiagnosis } from '../lib/marketplace-parser/diagnosis-token';
import { readCachedDiagnosis } from '../lib/marketplace-parser/cached-diagnosis';
import { diagnosisDb } from './marketplace-parser-diagnosis-db-fixture';
import { configFixture } from './marketplace-parser-fixtures';

function fixture() {
  const targetIdentity = { id: 9,unique_id: 'RTI_UID' }, ownerIdentity = { id: 12,unique_id: 'RLB_UID' };
  const state = { visible: false,shared: false,unknownPost: false,delayed: false,duplicate: false,failOther: false,sku: 'ROV20-295',ownerUid: 'RLB_UID',writes: [] as string[],audits: [] as string[],checks: 0 };
  const detail = (): ScalevBundle => ({ id: 2,name: 'Roove',custom_id: state.sku,business: { ...ownerIdentity,unique_id: state.ownerUid } });
  const target: CatalogConnection = { id: 4,code: 'RTI',client: {
    identity: async () => targetIdentity,bundle: async () => state.visible ? detail() : null,
    partners: async () => [],share: async () => { throw new Error('Wrong credential'); },
  } };
  const owner: CatalogConnection = { id: 8,code: 'RLB',client: {
    identity: async () => ownerIdentity,bundle: async () => detail(),
    partners: async () => state.shared ? [{ id: 99,partner: targetIdentity }] : [],
    share: async (id,uid) => { assert.equal(id,2); assert.equal(uid,'RTI_UID'); state.writes.push('share'); state.shared = true; state.visible = !state.delayed; if (state.unknownPost) throw new Error('Hasil belum pasti'); },
  } };
  const input = { workspaceId: 'w',actorId: 'u',revision: 3,account: 'roove',skus: ['ROV20-295'],config: configFixture(),stores: [{ id: 10,name: 'Marketplace' }] };
  const diagnose = () => {
    const row = (businessId: number,id = 2) => ({ workspace_id: 'w',id: businessId*100+id,business_id: businessId,scalev_bundle_id: id,custom_id: state.sku,name: 'Roove',scalev_owner_uid: 'RLB_UID',scalev_owner_name: 'RLB',last_synced_at: '2026-11-10T00:00:00Z' });
    return readCachedDiagnosis(input,diagnosisDb({
      scalev_webhook_businesses: [target,owner].map(c => ({ workspace_id: 'w',id: c.id,business_code: c.code,scalev_business_uid: c.id === target.id ? targetIdentity.unique_id : ownerIdentity.unique_id,is_active: true })),
      scalev_catalog_bundles: [row(owner.id),...(state.visible ? [row(target.id),...(state.duplicate ? [row(target.id,3)] : [])] : [])],
      scalev_catalog_sync_state: [4,8].map(business_id => ({ workspace_id: 'w',business_id,sync_status: state.failOther && business_id === 8 ? 'failed' : 'success',last_synced_at: '2026-11-10',updated_at: '2026-11-10' })),
    }) as any);
  };
  const assertUnique = async () => { if (state.duplicate) throw new Error('Duplicate identifier'); };
  const request = { token: '',mode: 'share' as const,items: [{ sku: 'ROV20-295',bundleId: 2 }] };
  const repair = async (permit: Awaited<ReturnType<typeof diagnose>>['permit']) => shareBundles({ assertUnique,permit,request,target,connections: [target,owner],ensureCurrent: async () => { state.checks++; },audit: async stage => { state.audits.push(stage); } });
  return { state,input,target,owner,diagnose,repair,assertUnique,request };
}
test('owner and receiving Business are separate; permits contain only sharing candidates',async () => {
  const f = fixture(), { diagnosis,permit } = await f.diagnose();
  assert.equal(diagnosis.items[0].bundles[0].owner,'RLB'); assert.equal(diagnosis.suggestedStoreId,10);
  assert.equal(diagnosis.items[0].bundles[0].canShare,true); assert.equal(permit.bundles[0].sourceBusinessId,8);
  assert.ok(!('stores' in permit)); assert.ok(!('optionIds' in permit.bundles[0]));
  f.state.visible = true;
  const refreshed = await f.diagnose(); assert.equal(refreshed.diagnosis.items[0].bundles[0].availableInBusiness,true); assert.deepEqual(refreshed.permit.bundles,[]);
});
test('failed cross-Business syncs never infer absence or authorize sharing',async () => {
  const f = fixture(); f.state.failOther = true;
  const result = await f.diagnose(); assert.equal(result.diagnosis.items[0].status,'unavailable'); assert.deepEqual(result.permit.bundles,[]);
});
test('exact identifier matching never infers aliases, names, suffixes or case',async () => {
  const f = fixture(); f.input.skus = ['rov20-295','Roove','ROV20-999'];
  assert.ok((await f.diagnose()).diagnosis.items.every(i => i.status === 'missing'));
});
test('duplicate receiving codes block sharing authorization',async () => {
  const f = fixture(); f.state.visible = true; f.state.duplicate = true;
  const result = await f.diagnose(); assert.equal(result.diagnosis.items[0].status,'ambiguous'); assert.deepEqual(result.permit.bundles,[]);
});
test('configured routes are mandatory even with just one Store and partial Product recognition',() => {
  const f = fixture(); f.input.config.combinations = [];
  assert.equal(resolveDiagnosisRoute(f.input.config,'roove',['ROV20-295','UNKNOWN'],f.input.stores).suggestedStoreId,null);
  f.input.config.routes = [];
  assert.equal(resolveDiagnosisRoute(f.input.config,'roove',['ROV20-295'],f.input.stores).suggestedStoreId,null);
});
test('sharing uses owner credential and target UID with no Store or price calls, and repeat is idempotent',async () => {
  const f = fixture(), { permit } = await f.diagnose();
  assert.equal((await f.repair(permit))[0].stage,'ready'); assert.deepEqual(f.state.writes,['share']);
  assert.deepEqual(f.state.audits,['share_requested','shared']); assert.ok(f.state.checks >= 3);
  assert.equal((await f.repair(permit))[0].stage,'ready'); assert.deepEqual(f.state.writes,['share']);
});
test('delayed sharing visibility preserves partial success; retry never replays confirmed sharing',async () => {
  const f = fixture(), { permit } = await f.diagnose(); f.state.delayed = true;
  assert.equal((await f.repair(permit))[0].stage,'shared');
  f.state.visible = true; assert.equal((await f.repair(permit))[0].stage,'ready'); assert.deepEqual(f.state.writes,['share']);
});
test('unknown POST outcome is checked live before retry',async () => {
  const f = fixture(), { permit } = await f.diagnose(); f.state.unknownPost = true;
  assert.match((await f.repair(permit))[0].message,/Hasil belum pasti/);
  assert.equal((await f.repair(permit))[0].stage,'ready'); assert.deepEqual(f.state.writes,['share']);
});
test('changed code, owner or duplicate prevents writes; forged candidates are rejected',async () => {
  for (const situation of ['sku','owner','duplicate']) {
    const f = fixture(), { permit } = await f.diagnose();
    if (situation === 'sku') f.state.sku = 'CHANGED';
    if (situation === 'owner') f.state.ownerUid = 'CHANGED';
    if (situation === 'duplicate') f.state.duplicate = true;
    assert.notEqual((await f.repair(permit))[0].stage,'ready'); assert.deepEqual(f.state.writes,[]);
  }
  const f = fixture(), { permit } = await f.diagnose(); permit.bundles[0].canShare = false;
  await assert.rejects(f.repair(permit),/Sharing tidak sesuai/);
});
test('revision/lease or audit failures stop before a write',async () => {
  const f = fixture(), { permit } = await f.diagnose();
  const input = { assertUnique: f.assertUnique,permit,request: f.request,target: f.target,connections: [f.target,f.owner],ensureCurrent: async () => {},audit: async () => {} };
  await assert.rejects(shareBundles({ ...input,ensureCurrent: async () => { throw new Error('Revision changed'); } }),/Revision changed/);
  const result = await shareBundles({ ...input,audit: async () => { throw new Error('Audit unavailable'); } });
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
