import test from 'node:test';
import assert from 'node:assert/strict';
import { readCachedDiagnosis } from '../lib/marketplace-parser/cached-diagnosis';
import { cachedBundleMetadata } from '../lib/marketplace-parser/catalog-metadata';
import { ParserScalevClient } from '../lib/marketplace-parser/scalev-client';
import { configFixture } from './marketplace-parser-fixtures';
import { diagnosisDb } from './marketplace-parser-diagnosis-db-fixture';

function fixture() {
  const row = (value: any) => ({ workspace_id: 'w',...value });
  const bundle = row({ id: 1,business_id: 4,scalev_bundle_id: 2,custom_id: 'ROV20-295',name: 'Roove 20',scalev_owner_uid: 'OWNER_UID',scalev_owner_name: 'Owner',price_options: [{ id: 4050,name: '295',price: '295000' }],last_synced_at: '2020-01-01T00:00:00Z' });
  const tables = {
    scalev_webhook_businesses: [row({ id: 4,business_code: 'RTI',is_active: true,scalev_business_uid: 'TARGET_UID' }),row({ id: 8,business_code: 'RLB',is_active: true,scalev_business_uid: 'OWNER_UID' })],
    scalev_catalog_bundles: [bundle],
    scalev_catalog_bundle_store_links: [row({ id: 1,business_id: 4,scalev_bundle_id: 2,scalev_store_id: 15443,store_name: 'Marketplace',is_available: true,last_checked_at: '2020-01-01T00:00:00Z' })],
    scalev_catalog_sync_state: [4,8].map(business_id => row({ business_id,sync_status: 'success',last_synced_at: '2020-01-01T00:00:00Z',updated_at: '2020-01-01T00:00:00Z' })),
    marketplace_parser_store_syncs: [row({ store_id: 10,status: 'ready',synced_at: '2020-01-01T00:00:00Z',updated_at: '2020-01-01T00:00:00Z' })],
  };
  const input = { workspaceId: 'w',actorId: 'u',revision: 3,account: 'roove',skus: ['ROV20-295'],config: configFixture(),stores: [{ id: 10,name: 'Marketplace',scalevId: null,uniqueId: null }] };
  const db = diagnosisDb(tables);
  const diagnose = () => readCachedDiagnosis(input,db as any);
  return { row,bundle,tables,input,db,diagnose };
}

test('old but completed snapshots are reused indefinitely, with exact scoped queries and no credentials or API access',async () => {
  const f = fixture();
  f.tables.scalev_catalog_bundles.push({ ...f.bundle,id: 9,workspace_id: 'foreign',scalev_bundle_id: 99 });
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Diagnosis must never access a network'); };
  try {
    for (let n = 0; n < 2; n++) {
      const result = await f.diagnose();
      assert.equal(result.diagnosis.items[0].status,'found');
      assert.equal(result.diagnosis.items[0].bundles[0].owner,'RLB');
      assert.equal(result.diagnosis.items[0].bundles[0].availableInBusiness,true);
      assert.equal(result.diagnosis.suggestedStoreId,10);
      assert.deepEqual(result.permit.bundles,[]);
    }
  } finally { globalThis.fetch = original; }
  for (const query of f.db.queries) {
    assert.ok(query.filters.some(([op,key,value]) => op === 'eq' && key === 'workspace_id' && value === 'w'));
    assert.doesNotMatch(query.columns,/api_key|price_options|\*/);
    assert.doesNotMatch(query.table,/store_links|store_syncs/);
    if (query.table === 'scalev_catalog_bundles') assert.ok(query.filters.some(([op,key,value]) => op === 'in' && key === 'custom_id' && JSON.stringify(value) === '["ROV20-295"]'));
  }
});

test('legacy inferred owner and missing options remain unknown, never authorize sharing or invent prices',async () => {
  const f = fixture(); Object.assign(f.bundle,{ business_id: 8,owner_business_code: 'RLB',owner_business_id: 8,scalev_owner_uid: null,scalev_owner_name: null,price_options: null });
  const { diagnosis,permit } = await f.diagnose();
  const bundle = diagnosis.items[0].bundles[0];
  assert.equal(bundle.owner,'Belum tersinkron'); assert.equal(bundle.canShare,false);
  assert.deepEqual(permit.bundles,[]);
});

test('only receiving Business sync governs availability; unrelated or Store sync failure is irrelevant',async () => {
  for (const status of ['running','failed']) {
    const f = fixture(); f.tables.scalev_catalog_sync_state[0].sync_status = status;
    const result = await f.diagnose();
    assert.equal(result.diagnosis.items[0].status,'unavailable'); assert.deepEqual(result.permit.bundles,[]);
  }
  const f = fixture(); f.tables.marketplace_parser_store_syncs[0].status = 'syncing'; f.tables.scalev_catalog_sync_state[1].sync_status = 'failed';
  assert.equal((await f.diagnose()).diagnosis.items[0].bundles[0].availableInBusiness,true);
});
test('a Business generation change invalidates the snapshot',async () => {
  const f = fixture(); const db = diagnosisDb(f.tables,(name,count) => {
    if (name === 'scalev_catalog_sync_state' && count === 2) f.tables.scalev_catalog_sync_state[0].updated_at = '2026-11-10T00:00:00Z';
  });
  assert.equal((await readCachedDiagnosis(f.input,db as any)).diagnosis.items[0].status,'unavailable');
});

test('absence in cached data asks for catalog sync and never claims live Scalev absence',async () => {
  const f = fixture(); f.tables.scalev_catalog_bundles = [];
  const result = await f.diagnose();
  assert.equal(result.diagnosis.items[0].status,'missing');
  assert.match(result.diagnosis.items[0].message,/belum tercatat di katalog aplikasi/);
  assert.deepEqual(result.permit.bundles,[]);
});

test('Store destination follows mapping only and price metadata never gates Business availability',async () => {
  const f = fixture(); f.tables.scalev_catalog_bundle_store_links = [];
  Object.assign(f.bundle.price_options[0],{ price: null });
  const mapped = await f.diagnose();
  assert.equal(mapped.diagnosis.suggestedStoreId,10);
  assert.equal(mapped.diagnosis.items[0].bundles[0].availableInBusiness,true);
  f.input.config.routes = []; f.input.config.combinations = [];
  assert.equal((await f.diagnose()).diagnosis.suggestedStoreId,null);
});
test('catalog metadata still preserves hidden options and excludes inactive options for other catalog consumers',() => {
  const result = cachedBundleMetadata({ business: { id: 3,unique_id: 'UID',account_holder: 'Owner' } },[
    { id: 1,name: 'Hidden',price: '0',is_visible: false },{ id: 2,name: 'Inactive',price: '20',is_active: false },
  ]);
  assert.equal(result.scalev_owner_uid,'UID'); assert.deepEqual(result.price_options?.map(o => o.id),[1]);
});

test('Store catalog sync reads two scoped paginated lists, preserves full metadata and avoids per-bundle API calls',async () => {
  const urls: string[] = [];
  const client = new ParserScalevClient('synthetic',async url => {
    const value = new URL(String(url)); urls.push(String(url));
    assert.equal(value.searchParams.get('store_id'),'15443');
    const simplified = value.pathname.endsWith('/simplified');
    const page = value.searchParams.has('next_cursor') ? 2 : 1;
    return Response.json({ data: [{ id: page,name: `Bundle ${page}`,custom_id: `SKU-${page}`,...(simplified ? { bundle_price_options: [{ id: page*10,name: 'Option',price: '1' }] } : { public_name: 'Public',business: { id: 8,unique_id: 'OWNER' } }) }],has_next: page === 1,next_cursor: 'page2' });
  });
  const result = await client.catalogBundles(15443);
  assert.equal(urls.length,4); assert.equal(result.length,2);
  assert.equal((result[0] as any).public_name,'Public'); assert.equal(result[0].business?.unique_id,'OWNER'); assert.equal(result[0].bundle_price_options?.[0].id,10);
});

test('catalog changes between owner and BPO listings fail before replacing cached data',async () => {
  const client = new ParserScalevClient('synthetic',async url => Response.json({ data: [{ id: 2,name: 'Bundle',custom_id: String(url).includes('simplified') ? 'NEW' : 'OLD',business: { unique_id: 'OWNER' },bundle_price_options: [] }],has_next: false }));
  await assert.rejects(client.catalogBundles(),/berubah saat sinkronisasi/);
});
