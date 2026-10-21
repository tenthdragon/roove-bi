import test from 'node:test';
import assert from 'node:assert/strict';
import { runMetaAdMappingSync } from '../lib/meta-ad-mapping-sync';
import { fetchAdInventory } from '../lib/meta-ad-insights';
import { enqueueScheduledMetaAdMapping, enqueueMetaAdMappingCreatives } from '../lib/meta-ad-mapping-queue';

function harness(cachedCreative?: { ad_id: string; creative_id: string; landing_page_urls: string[] }, activity: { ad_id: string }[] | { error: { code: string; message: string } } = [{ ad_id: '10' }]) {
  const writes: { table: string; data: any }[] = []; const filters: any[] = []; const queued: string[][] = [];
  const svc: any = { from(table: string) {
    const q: any = { select: () => q, limit: () => q, in: () => q, delete: () => q, lte: () => q,
      eq: (key: string, value: unknown) => { filters.push({ table, key, value }); return q; },
      upsert: async (data: any) => { writes.push({ table, data }); return { error: null }; },
      then: (resolve: any) => resolve({ error: null, data: table === 'meta_ad_accounts' ? [{ account_id: 'act_1', account_name: 'Test' }] : table === 'meta_ad_mappings' ? [{ ad_id: '10', ad_name: '[new-cep][new-stage][video]', effective_status: 'PAUSED' }] : table === 'meta_ad_creatives' && cachedCreative ? [cachedCreative] : [] }) };
    return q;
  }, rpc: async (table: string, data: any) => { if (table === 'get_meta_ad_activity') return Array.isArray(activity) ? { error: null, data: activity.map(a => ({ account_id: 'act_1', ...a })) } : { error: activity.error, data: null }; writes.push({ table, data }); return { error: null, data: data.p_rows.length }; } };
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
test('destination metadata refresh runs only for explicit creative follow-up batches', async () => {
  const h = harness(); const calls: any[] = [];
  h.deps.refreshMetaAdDestinations = async (...args: any[]) => { calls.push(args.slice(1)); return { saved: 1, failures: [] }; };
  const inventory = await runMetaAdMappingSync(options, h.deps);
  assert.equal(inventory.status, 'success'); assert.equal(calls.length, 0);
  const followup = await runMetaAdMappingSync({ ...options, creativeAdIds: ['10'] }, h.deps);
  assert.equal(followup.status, 'success'); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), [options.workspaceId, 'act_1', ['10']]);
});
test('destination metadata refresh failures warn without failing mapping follow-up', async () => {
  const h = harness();
  h.deps.refreshMetaAdDestinations = async () => { throw new Error('Destination metadata unavailable'); };
  const result = await runMetaAdMappingSync({ ...options, creativeAdIds: ['10'] }, h.deps);
  assert.equal(result.status, 'success'); assert.equal(result.rows_inserted, 1);
  assert.match(result.warnings.join(' '), /Destination metadata unavailable/);
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
test('creative and destination enrichment queues at most 50 owned ads per job', async () => {
  const calls: any[] = []; const ids = Array.from({ length: 251 }, (_, i) => String(1000 + i));
  await enqueueMetaAdMappingCreatives(options.workspaceId, options.accountId, [...ids].reverse(), async input => { calls.push(input); return { job: { id: 'job' } as any, isDuplicate: false }; });
  assert.deepEqual(calls.map(c => c.payload.creative_ad_ids.length), [50, 50, 50, 50, 50, 1]);
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
test('mapping scheduler refreshes active account inventory without saved funnels or daily-state gating', async () => {
  const h = harness(); h.svc.from = (table: string) => {
    assert.notEqual(table, 'meta_ad_funnels');
    const q: any = { select: () => q, eq: () => q, gte: () => q, then: (resolve: any) => resolve({ error: null, data: [{ account_id: table === 'meta_ad_accounts' ? 'act_2' : 'act_1' }] }) }; return q;
  };
  const queued = await enqueueScheduledMetaAdMapping(h.svc, options.workspaceId, async (workspace, accounts) => { assert.equal(workspace, options.workspaceId); assert.deepEqual(accounts, ['act_2']); return ['job']; });
  assert.deepEqual(queued, ['job']);
});

import { metaMetadataSource } from '../lib/meta-ad-metadata-state';
const versionedAd = { id: '10', name: 'A', creative: { id: '20' }, updated_time: '2026-10-15T00:00:00Z', adset_id: '30',
  adset: { id: '30', updated_time: '2026-10-15T00:00:00Z', destination_type: 'WHATSAPP', promoted_object: { page_id: '100' } } };
function versionedHarness(certified: boolean) {
  const h = harness({ ad_id: '10', creative_id: '20', landing_page_urls: ['https://roove.co.id/cached'] });
  const original = h.svc.from.bind(h.svc);
  h.svc.from = (table: string) => {
    const q = original(table);
    if (table === 'meta_ad_metadata_sync_state') q.then = (resolve: any) => resolve({ error: null, data: certified ? [{ ad_id: '10', ...metaMetadataSource(versionedAd), observed_at: '2026-10-16T00:00:00Z' }] : [] });
    if (table === 'meta_ad_destination_metadata') q.then = (resolve: any) => resolve({ error: null, data: [{ ad_id: '10', creative_id: '20', adset_id: '30', observed_at: '2026-10-16T00:00:00Z', metadata: { contact_identity_checked: true, product_set_ids: ['500'] } }] });
    if (table === 'meta_ad_creatives') q.then = (resolve: any) => resolve({ error: null, data: [{ ad_id: '10', creative_id: '20', creative_format: 'video', updated_at: '2026-10-16T00:00:00Z', landing_page_urls: ['https://roove.co.id/cached'] }] });
    return q;
  };
  h.deps.fetchAdInventory = async () => [versionedAd];
  h.deps.enqueueNewMetaProductSets = async () => [];
  return h;
}
test('unchanged inventory uses existing successful metadata and does not queue creative reads', async () => {
  for (const certified of [false, true]) {
    const h = versionedHarness(certified); h.deps.fetchCreativeBatch = async () => { throw Error('Unchanged metadata must not be fetched'); };
    const result = await runMetaAdMappingSync(options, h.deps);
    assert.equal(result.status, 'success'); assert.equal(result.metadata_ads_skipped, 1); assert.equal(result.creative_jobs_queued, 0); assert.deepEqual(h.queued, []);
    assert.equal(h.writes.filter(w => w.table === 'save_meta_ad_metadata_state').length, certified ? 0 : 1);
  }
});
test('ad-set changes refresh metadata even when the creative ID stays the same', async () => {
  const h = versionedHarness(true);
  h.deps.fetchAdInventory = async () => [{ ...versionedAd, adset: { ...versionedAd.adset, promoted_object: { page_id: '200' } } }];
  const result = await runMetaAdMappingSync(options, h.deps);
  assert.equal(result.status, 'success'); assert.equal(result.metadata_ads_skipped, 0); assert.deepEqual(h.queued, [['10']]);
});
test('an unchanged ad still schedules due verification for its previously unverified product set', async () => {
  const h = versionedHarness(true); const calls: any[] = [];
  h.deps.enqueueNewMetaProductSets = async (...args: any[]) => { calls.push(args); return ['catalog-job']; };
  const result = await runMetaAdMappingSync({ ...options, parentJobId: 'parent' }, h.deps);
  assert.equal(result.creative_jobs_queued, 0); assert.equal(result.product_set_jobs_queued, 1); assert.deepEqual(result.child_job_ids, ['catalog-job']);
  assert.deepEqual(calls[0].slice(1, 4), [options.workspaceId, options.accountId, ['500']]); assert.equal(calls[0][6], 'parent');
});
test('only complete matching creative and destination reads certify the next cache hit', async () => {
  for (const fail of [false, true]) {
    const h = harness(); h.deps.refreshMetaAdDestinations = async () => fail ? { saved: 0, failures: [{ ad_id: '10' }] }
      : { saved: 1, failures: [], refreshed_ads: [{ ad_id: '10', creative_id: '20', adset_id: '30', source: metaMetadataSource(versionedAd) }] };
    const result = await runMetaAdMappingSync({ ...options, creativeAdIds: ['10'] }, h.deps);
    assert.equal(result.status, 'success'); assert.equal(h.writes.filter(w => w.table === 'save_meta_ad_metadata_state').length, fail ? 0 : 1);
    if (fail) assert.ok(result.warnings.length>0);
  }
});
test('rich metadata refresh is limited to ads that delivered in the last 30 days or are still active', async () => {
  const paused = harness(undefined, []);
  const pausedResult = await runMetaAdMappingSync(options, paused.deps);
  assert.equal(pausedResult.status, 'success'); assert.equal(pausedResult.rows_inserted, 1, 'the name mapping is still saved');
  assert.deepEqual(paused.queued, [], 'no creative batch for a long-paused ad'); assert.equal(pausedResult.metadata_ads_deferred, 1);
  const active = harness(undefined, []);
  active.deps.fetchAdInventory = async () => [{ id: '10', name: '[new-cep][new-stage][video]', effective_status: 'ACTIVE', creative: { id: '20' } }];
  await runMetaAdMappingSync(options, active.deps);
  assert.deepEqual(active.queued, [['10']], 'an active ad without impressions yet is still enriched');
  const delivered = harness(undefined, [{ ad_id: '10' }]);
  await runMetaAdMappingSync(options, delivered.deps);
  assert.deepEqual(delivered.queued, [['10']], 'a paused ad that delivered recently is enriched');
  const legacy = harness(undefined, { error: { code: '42883', message: 'function get_meta_ad_activity does not exist' } });
  const legacyResult = await runMetaAdMappingSync(options, legacy.deps);
  assert.equal(legacyResult.status, 'success'); assert.deepEqual(legacy.queued, [['10']], 'without migration 217 every ad still counts as recent');
});

test('deferred ads preserve their certification and still enqueue cached product-set verification', async () => {
  const h = versionedHarness(true); const rpc = h.svc.rpc; const reads: any[] = []; const calls: any[] = []; let deleted = false;
  const from = h.svc.from; h.svc.from = (table: string) => { const q = from(table); if (table === 'meta_ad_metadata_sync_state') q.delete = () => { deleted = true; return q; }; return q; };
  h.svc.rpc = async (name: string, args: any) => {
    if (name === 'get_meta_ad_activity') { reads.push(args); return { data: [], error: null }; }
    return rpc(name, args);
  };
  h.deps.fetchAdInventory = async () => [{ ...versionedAd, effective_status: 'PAUSED', adset: { ...versionedAd.adset, promoted_object: { page_id: 'changed' } } }];
  h.deps.enqueueNewMetaProductSets = async (...args: any[]) => { calls.push(args); return ['catalog-job']; };
  const result = await runMetaAdMappingSync(options, h.deps);
  assert.equal(result.metadata_ads_deferred, 1); assert.deepEqual(h.queued, []);
  assert.equal(h.filters.some(f => f.table === 'meta_ad_metadata_sync_state'), true);
  assert.equal(h.writes.some(w => w.table === 'save_meta_ad_metadata_state'), false); assert.equal(deleted, false);
  assert.deepEqual(calls[0].slice(1, 4), [options.workspaceId, options.accountId, ['500']]);
  assert.equal((Date.parse(reads[0].p_to) - Date.parse(reads[0].p_from)) / 86400000, 29, 'the inclusive lookback is exactly 30 days');
});

test('inventory persists optimization for long-paused ads without queuing rich creative reads', async () => {
 const h = harness(undefined, []);
 h.deps.fetchAdInventory = async () => [{ id: '10', name: 'Purchase in name is not evidence', effective_status: 'PAUSED', creative: { id: '20' },
  campaign: { id: '40', objective: 'OUTCOME_SALES' }, adset: { id: '30', optimization_goal: 'OFFSITE_CONVERSIONS', promoted_object: { custom_event_type: 'INITIATED_CHECKOUT' } } }];
 const result = await runMetaAdMappingSync(options, h.deps);
 assert.equal(result.status, 'success');assert.deepEqual(h.queued, []);
 const write = h.writes.find(w => w.table === 'save_meta_adset_optimizations')!;
 assert.equal(write.data.p_workspace_id, options.workspaceId);assert.equal(write.data.p_account_id, 'act_1');
 assert.equal(write.data.p_rows[0].conversion_event, 'INITIATED_CHECKOUT');assert.equal(write.data.p_rows[0].adset_id, '30');
});
