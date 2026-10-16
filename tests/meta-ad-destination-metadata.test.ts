import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAdDestinationBatch, META_DESTINATION_FIELDS, normalizeMetaDestination, refreshMetaAdDestinations, verifyShopeeProductSet } from '../lib/meta-ad-destination-metadata';

const raw = (patch: Record<string, any> = {}) => ({
  id: '10', account_id: '1', adset: { id: '30', destination_type: 'WEBSITE', promoted_object: {} },
  creative: { id: '20' }, ...patch,
});

test('normalizer extracts omnichannel app and promoted-object Shopee identities without web URLs', () => {
  const metadata = normalizeMetaDestination(raw({
    adset: { id: '30', destination_type: 'APP', promoted_object: { omnichannel_object: { application_id: '957549474255294', package_name: 'com.shopee.id', app_store_id: '959841443' } } },
    creative: { id: '20', omnichannel_link_spec: { application: '957549474255294', package_name: 'com.shopee.id', app_store_id: '959841443' } },
  }));
  assert.deepEqual(metadata, {
    version: 1, urls: [], application_ids: ['957549474255294'], android_packages: ['com.shopee.id'],
    ios_app_ids: ['959841443'], product_set_ids: [], destination_type: 'APP',
  });
});

test('normalizer extracts product sets and app IDs from app-store URLs and store URL fields', () => {
  const metadata = normalizeMetaDestination(raw({ creative: {
    id: '20', product_set_id: '12345', object_store_url: 'https://apps.apple.com/id/app/shopee/id959841443',
    link_deep_link_url: 'https://play.google.com/store/apps/details?id=com.shopee.id',
  } }));
  assert.deepEqual(metadata.product_set_ids, ['12345']);
  assert.deepEqual(metadata.ios_app_ids, ['959841443']);
  assert.deepEqual(metadata.android_packages, ['com.shopee.id']);
  assert.deepEqual(metadata.urls, [
    'https://apps.apple.com/id/app/shopee/id959841443',
    'https://play.google.com/store/apps/details?id=com.shopee.id',
  ]);
});

test('creative copy and image URLs do not become destination evidence', () => {
  const metadata = normalizeMetaDestination(raw({ creative: {
    id: '20', body: 'https://shopee.co.id/mentioned-in-copy', message: 'https://shopee.co.id/message',
    title: 'https://shopee.co.id/title', name: 'https://shopee.co.id/name',
    image_url: 'https://shopee.co.id/image.jpg', thumbnail_url: 'https://shopee.co.id/thumb.jpg',
  } }));
  assert.deepEqual(metadata.urls, []);
  assert.deepEqual(metadata.application_ids, []);
});

function batchResponse(ids: string[], rows: any[] = []) {
  const result = ids.map((id, index) => ({ code: 200, body: JSON.stringify(rows[index] ?? raw({ id })) }));
  return new Response(JSON.stringify(result));
}

test('batch fetch validates returned ad and numeric account identity and redacts tokens from errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => batchResponse(['10', '11', '12', '13'], [
    raw({ id: '10', account_id: '1' }),
    raw({ id: '999', account_id: '1' }),
    { ...raw({ id: '12', account_id: '1' }), error: { code: 190, message: 'bad secret-token token=secret-token' } },
    raw({ id: '13', account_id: 'act_1' }),
  ]);
  try {
    const result = await fetchAdDestinationBatch(['10', '11', '12', '13'], 'secret-token');
    assert.deepEqual(result.rows.map(row => row.ad_id), ['10']);
    assert.deepEqual(result.failures.map(failure => failure.ad_id), ['11', '12', '13']);
    assert.match(result.failures[0].error, /identity/);
    assert.equal(result.failures[1].error.includes('secret-token'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('opaque creative failures are reported without creating rows', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => batchResponse(['10'], [raw({ creative: {} })]);
  try {
    const result = await fetchAdDestinationBatch(['10'], 'token');
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.failures, [{ ad_id: '10', error: 'Creative identity unavailable' }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('missing ad set metadata cannot replace existing destination evidence', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => batchResponse(['10'], [raw({ adset: undefined })]);
  try {
    const result = await fetchAdDestinationBatch(['10'], 'token');
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.failures, [{ ad_id: '10', error: 'Ad set identity unavailable' }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('batch fetch uses only bounded Graph batch GET requests', async () => {
  const originalFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), 'https://graph.facebook.com/v21.0');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer token');
    const body = new URLSearchParams(String(init?.body));
    const batch = JSON.parse(body.get('batch')!);
    assert.ok(batch.length <= 50);
    assert.ok(batch.every((item: any) => item.method === 'GET' && item.relative_url.includes(`fields=${META_DESTINATION_FIELDS}`)));
    return batchResponse(batch.map((item: any) => item.relative_url.match(/^(\d+)/)[1]));
  };
  try {
    const result = await fetchAdDestinationBatch(Array.from({ length: 50 }, (_, i) => String(i + 1)), 'token');
    assert.equal(calls, 1); assert.equal(result.rows.length, 50);
    await assert.rejects(fetchAdDestinationBatch(Array.from({ length: 51 }, (_, i) => String(i + 1)), 'token'), /1–50/);
    await assert.rejects(fetchAdDestinationBatch(['not-numeric'], 'token'), /numeric/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});

async function withProductPages(pages: any[], run: (urls: URL[]) => Promise<void>) {
  const originalFetch = globalThis.fetch; const urls: URL[] = []; let index = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); urls.push(url);
    assert.equal(init?.method, undefined);
    assert.equal(url.searchParams.has('access_token'), false);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-secret');
    const page = pages[index++];
    if (page instanceof Error) throw page;
    return new Response(JSON.stringify(page));
  };
  try { await run(urls); }
  finally { globalThis.fetch = originalFetch; }
}

test('product-set verifier traverses every page when a next link exists', async () => {
  await withProductPages([
    { data: [{ id: '1', url: 'https://shopee.co.id/a' }], paging: { next: 'opaque', cursors: { after: 'cursor-1' } } },
    { data: [{ id: '2', url: 'https://s.shopee.co.id/b' }] },
  ], async urls => {
    const result = await verifyShopeeProductSet('12345', 'test-secret');
    assert.deepEqual(result, { method: 'meta_product_set_products', complete: true, product_count: 2, samples: [
      { product_id: '1', url: 'https://shopee.co.id/a' }, { product_id: '2', url: 'https://s.shopee.co.id/b' },
    ] });
    assert.equal(urls.length, 2);
    assert.equal(urls[0].pathname, '/v21.0/12345/products');
    assert.equal(urls[0].searchParams.has('after'), false);
    assert.equal(urls[1].searchParams.get('after'), 'cursor-1');
    assert.ok(urls.every(url => !url.toString().includes('test-secret')));
  });
});

test('product-set verifier rejects non-Shopee products on later pages', async () => {
  await withProductPages([
    { data: [{ id: '1', url: 'https://shopee.co.id/a' }], paging: { next: 'opaque', cursors: { after: 'cursor-1' } } },
    { data: [{ id: '2', url: 'https://example.test/b' }] },
  ], async () => assert.rejects(verifyShopeeProductSet('12345', 'test-secret'), /non-Shopee/));
});

test('product-set verifier rejects empty sets and products without URLs', async () => {
  await withProductPages([{ data: [] }], async () => assert.rejects(verifyShopeeProductSet('12345', 'test-secret'), /Empty product set/));
  await withProductPages([{ data: [{ id: '1' }] }], async () => assert.rejects(verifyShopeeProductSet('12345', 'test-secret'), /URL unavailable/));
});

test('product-set verifier rejects repeated and incomplete pagination cursors', async () => {
  await withProductPages([
    { data: [{ id: '1', url: 'https://shopee.co.id/a' }], paging: { next: 'opaque-1', cursors: { after: 'same' } } },
    { data: [{ id: '2', url: 'https://shopee.co.id/b' }], paging: { next: 'opaque-2', cursors: { after: 'same' } } },
  ], async () => assert.rejects(verifyShopeeProductSet('12345', 'test-secret'), /pagination incomplete/));
  await withProductPages([
    { data: [{ id: '1', url: 'https://shopee.co.id/a' }], paging: { next: 'opaque' } },
  ], async () => assert.rejects(verifyShopeeProductSet('12345', 'test-secret'), /pagination incomplete/));
});

test('product-set verifier accepts all-Shopee products and returns complete count with bounded samples', async () => {
  const products = Array.from({ length: 25 }, (_, i) => ({ id: String(i + 1), url: `https://shp.ee/${i + 1}` }));
  await withProductPages([{ data: products }], async () => {
    const result = await verifyShopeeProductSet('12345', 'test-secret');
    assert.equal(result.complete, true); assert.equal(result.product_count, 25); assert.equal(result.samples.length, 20);
    assert.deepEqual(result.samples[0], { product_id: '1', url: 'https://shp.ee/1' });
  });
});

test('destination sync persists new catalog observations then queues a unique unseen product set', async () => {
  const originalFetch = globalThis.fetch; const writes: any[] = [], queued: any[] = []; let requests = 0;
  const svc: any = { from(table: string) {
    const q: any = { select: () => q, eq: () => q, in: () => q, limit: () => q,
      upsert: async (rows: any[]) => { writes.push(...rows); return { error: null }; },
      then: (resolve: any) => resolve({ error: null, data: table === 'meta_ad_mappings'
        ? [{ ad_id: '10' }, { ad_id: '11' }, { ad_id: '12' }]
        : table === 'meta_shopee_product_sets' ? [{ product_set_id: '789' }] : [] }) };
    return q;
  } };
  globalThis.fetch = async () => {
    requests++;
    return batchResponse(['10', '11', '12'], [
      raw({ id: '10', creative: { id: '20', product_set_id: '456' } }),
      raw({ id: '11', creative: { id: '21', product_set_id: '456' } }),
      raw({ id: '12', creative: { id: '22', product_set_id: '789' } }),
    ]);
  };
  try {
    const result = await refreshMetaAdDestinations(svc, '00000000-0000-4000-8000-000000000001', 'act_1', ['10', '11', '12'], 'token',
      async (_svc, workspace, account, ids) => {
        assert.equal(writes.length, 3); queued.push({ workspace, account, ids }); return ['verify-job'];
      });
    assert.equal(requests, 1); assert.equal(result.product_set_jobs_queued, 1);
    assert.deepEqual(queued[0].ids, ['456']);
    assert.deepEqual(writes.map(r => [r.ad_id, r.classification]), [['10', 'unknown'], ['11', 'unknown'], ['12', 'cpas']]);
    assert.ok(writes.every(r => r.workspace_id === queued[0].workspace && r.account_id === queued[0].account));
  } finally { globalThis.fetch = originalFetch; }
});

test('verification cancellation cannot register partially read catalog evidence', async () => {
  const originalFetch = globalThis.fetch; const controller = new AbortController(); let requests = 0;
  globalThis.fetch = async () => {
    requests++; controller.abort();
    return new Response(JSON.stringify({ data: [{ id: '1', url: 'https://shopee.co.id/a' }],
      paging: { next: 'next', cursors: { after: 'cursor' } } }));
  };
  try {
    await assert.rejects(verifyShopeeProductSet('456', 'token', { signal: controller.signal }), /abort/i);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});
