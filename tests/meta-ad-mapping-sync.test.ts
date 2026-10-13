import test from 'node:test';
import assert from 'node:assert/strict';
import { runMetaAdMappingSync } from '../lib/meta-ad-mapping-sync';
import { fetchAdInventory } from '../lib/meta-ad-insights';
import { enqueueScheduledMetaAdMapping, enqueueMetaAdMappingCreatives } from '../lib/meta-ad-mapping-queue';

function harness(cachedCreative?: { ad_id: string; creative_id: string; landing_page_urls: string[] }) {
  const writes: { table: string; data: any }[] = []; const filters: any[] = []; const queued: string[][] = [];
  const svc: any = { from(table: string) {
    const q: any = { select: () => q, limit: () => q, in: () => q,
      eq: (key: string, value: unknown) => { filters.push({ table, key, value }); return q; },
      upsert: async (data: any) => { writes.push({ table, data }); return { error: null }; },
      then: (resolve: any) => resolve({ error: null, data: table === 'meta_ad_accounts' ? [{ account_id: 'act_1', account_name: 'Test' }] : table === 'meta_ad_mappings' ? [{ ad_id: '10', ad_name: '[new-cep][new-stage][video]', effective_status: 'PAUSED' }] : table === 'meta_ad_creatives' && cachedCreative ? [cachedCreative] : [] }) };
    return q;
  }, rpc: async (table: string, data: any) => { writes.push({ table, data }); return { error: null, data: data.p_rows.length }; } };
  const deps: any = { createServiceSupabase: () => svc, resolveWorkspaceCredential: async () => 'secret',
    fetchAdInventory: async () => [{ id: '10', name: '[new-cep][new-stage][video]', effective_status: 'PAUSED', creative: { id: '20' } }],
    fetchCreativeBatch: async () => [{ ad_id: '10', creative_id: '20', name: '[new-cep][new-stage][video]', thumbnail_url: null, video_id: null, body: null, landing_page_urls: ['https://roove.co.id/new?utm_source=meta'] }],
    enqueueMetaAdMappingCreatives: async (_workspace: string, _account: string, ids: string[]) => { queued.push(ids); return ids.length ? ['child-job'] : []; } };
  return { svc, deps, writes, filters, queued };
}
const options = { workspaceId: '00000000-0000-4000-8000-000000000001', accountId: 'act_1' };
test('inventory maps paused/no-spend ads and new units without requesting performance or writing budgets', async () => {
  const h = harness(); const result = await runMetaAdMappingSync(options, h.deps);
  assert.equal(result.status, 'success'); assert.equal(result.rows_inserted, 1);
  const write = h.writes.find(w => w.table === 'upsert_meta_ad_mappings')!;
  assert.equal(write.data.p_workspace_id, options.workspaceId); assert.equal(write.data.p_account_id, 'act_1');
  assert.equal(write.data.p_rows[0].effective_status, 'PAUSED'); assert.deepEqual(write.data.p_rows[0].landing_page_urls, []);
  assert.deepEqual(write.data.p_rows[0].auto_mapping.tags.map((t: any) => t.key), ['new-cep', 'new-stage', 'video']);
  assert.ok(h.writes.some(w => w.table === 'meta_ad_mapping_sync_state'));
  assert.deepEqual(h.queued, [['10']]); assert.equal(result.creative_jobs_queued, 1);
  assert.ok(h.filters.some(f => f.table === 'meta_ad_creatives' && f.key === 'workspace_id' && f.value === options.workspaceId));
});
test('inventory pagination failure does not write partial mappings or completion state', async () => {
  const h = harness(); h.deps.fetchAdInventory = async () => { throw new Error('Second page failed'); };
  const result = await runMetaAdMappingSync(options, h.deps); assert.equal(result.status, 'failed'); assert.equal(h.writes.length, 0);
});
test('omitted creative identity still maps names and records a warning', async () => {
  const h = harness(); h.deps.fetchAdInventory = async () => [{ id: '10', name: '[new-cep][new-stage][video]' }];
  const result = await runMetaAdMappingSync(options, h.deps); assert.equal(result.status, 'success'); assert.equal(result.warnings.length, 1);
  assert.equal(h.writes.find(w => w.table === 'upsert_meta_ad_mappings')!.data.p_rows[0].creative_id, null);
});
test('creative outage retains cached URLs only for the same creative version', async () => {
  for (const creativeId of ['20', 'old-version']) {
    const h = harness({ ad_id: '10', creative_id: creativeId, landing_page_urls: ['https://roove.co.id/cached'] });
    h.deps.fetchAdInventory = async () => [{ id: '10', name: '[new-cep][new-stage][video]', creative: { id: '20' } }];
    await runMetaAdMappingSync(options, h.deps);
    const row = h.writes.find(w => w.table === 'upsert_meta_ad_mappings')!.data.p_rows[0];
    assert.deepEqual(row.landing_page_urls, creativeId === '20' ? ['https://roove.co.id/cached'] : []);
  }
});
test('an empty inventory records successful coverage without deleting previously mapped ads', async () => {
  const h = harness(); h.deps.fetchAdInventory = async () => [];
  const result = await runMetaAdMappingSync(options, h.deps);
  assert.equal(result.status, 'success'); assert.equal(result.rows_inserted, 0);
  assert.deepEqual(h.writes.map(w => w.table), ['meta_ad_mapping_sync_state']);
  assert.equal(h.writes[0].data.ads_count, 0);
});
test('bounded follow-up refreshes destinations without re-reading inventory or marking inventory complete again', async () => {
  const h = harness(); h.deps.fetchAdInventory = async () => { throw new Error('Must not read inventory'); };
  const result = await runMetaAdMappingSync({ ...options, creativeAdIds: ['10'] }, h.deps);
  assert.equal(result.status, 'success'); assert.equal(result.rows_inserted, 1);
  assert.deepEqual(h.writes.find(w => w.table === 'upsert_meta_ad_mappings')!.data.p_rows[0].landing_page_urls, ['https://roove.co.id/new']);
  assert.equal(h.writes.some(w => w.table === 'meta_ad_mapping_sync_state'), false); assert.equal(h.queued.length, 0);
});
test('creative follow-up validates ad ownership and the 100-ad batch limit', async () => {
  const h = harness(); const result = await runMetaAdMappingSync({ ...options, creativeAdIds: ['999'] }, h.deps);
  assert.equal(result.status, 'failed'); assert.equal(h.writes.length, 0); assert.match(result.errors.join(), /workspace/);
  await assert.rejects(runMetaAdMappingSync({ ...options, creativeAdIds: Array(101).fill('10') }, h.deps), /100/);
});
test('an opaque creative response without its ID cannot erase an observed identity or verified-URL binding', async () => {
  const h = harness(); h.deps.fetchCreativeBatch = async () => [{ ad_id: '10', creative_id: null, name: 'A', landing_page_urls: [], thumbnail_url: null, video_id: null, body: null }];
  const result = await runMetaAdMappingSync({ ...options, creativeAdIds: ['10'] }, h.deps);
  assert.equal(result.status, 'success'); assert.equal(result.rows_inserted, 0); assert.equal(result.warnings.length, 1);
  assert.equal(h.writes.length, 0);
});
test('creative enrichment queues stable batches of at most 100 owned ad IDs', async () => {
  const calls: any[] = []; const ids = Array.from({ length: 251 }, (_, i) => String(1000 + i));
  await enqueueMetaAdMappingCreatives(options.workspaceId, options.accountId, [...ids].reverse(), async input => { calls.push(input); return { job: { id: 'job' } as any, isDuplicate: false }; });
  assert.deepEqual(calls.map(c => c.payload.creative_ad_ids.length), [100, 100, 51]);
  assert.deepEqual(calls.flatMap(c => c.payload.creative_ad_ids), ids);
  assert.ok(calls.every(c => c.workspaceId === options.workspaceId && c.payload.account_id === options.accountId));
});
test('Meta inventory follows all pages, includes ads without insights, and never forwards embedded credentials', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++; const parsed = new URL(String(url)); assert.equal(parsed.searchParams.has('access_token'), false); assert.equal((options?.headers as any).Authorization, 'Bearer test');
    if (calls === 1) { assert.match(parsed.pathname, /act_1\/ads$/); assert.equal(parsed.searchParams.has('time_range'), false); }
    return new Response(JSON.stringify(calls === 1 ? { data: [{ id: '1', name: 'A' }], paging: { next: 'https://graph.facebook.com/next?access_token=embedded' } } : { data: [{ id: '2', name: 'B', effective_status: 'PAUSED' }] }));
  };
  try { const ads = await fetchAdInventory('act_1', 'test'); assert.deepEqual(ads.map(a => a.id), ['1', '2']); }
  finally { globalThis.fetch = original; }
});
test('inventory failure on a later page rejects instead of returning partial ads', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? new Response(JSON.stringify({ data: [{ id: '1', name: 'A' }], paging: { next: 'https://graph.facebook.com/next' } })) : new Response('{}', { status: 429 });
  try { await assert.rejects(fetchAdInventory('act_1', 'test'), /Meta API/); }
  finally { globalThis.fetch = original; }
});
test('mapping scheduler does not need saved funnels and queues only active accounts not mapped today', async () => {
  const h = harness(); h.svc.from = (table: string) => {
    assert.notEqual(table, 'meta_ad_funnels');
    const q: any = { select: () => q, eq: () => q, gte: () => q, then: (resolve: any) => resolve({ error: null, data: [{ account_id: table === 'meta_ad_accounts' ? 'act_2' : 'act_1' }] }) }; return q;
  };
  const queued = await enqueueScheduledMetaAdMapping(h.svc, options.workspaceId, async (workspace, accounts) => { assert.equal(workspace, options.workspaceId); assert.deepEqual(accounts, ['act_2']); return ['job']; });
  assert.equal(queued, 1);
});
