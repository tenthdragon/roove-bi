import test from 'node:test';
import assert from 'node:assert/strict';
import { runMetaAdSync } from '../lib/meta-ad-sync-runner';

function harness(fetchError = false, creativeError = false, accountMissing = false, cachedUrls: string[] = []) {
  const snapshots: any[] = []; const filters: any[] = []; const creatives: any[] = [];
  const svc = {
    from(table: string) {
      const q: any = { select: () => q, limit: () => q, in: () => q, eq: (key: string, value: unknown) => { filters.push({ table, key, value }); return q; },
        upsert: (data: unknown) => { creatives.push(data); return Promise.resolve({ error: null }); },
        then: (resolve: any) => resolve({ error: null, data: table === 'meta_ad_accounts' ? accountMissing ? [] : [{ account_id: 'act_1', account_name: 'Test' }] : table === 'meta_ad_creatives' && cachedUrls.length ? [{ ad_id: '1', creative_id: '2', landing_page_urls: cachedUrls }] : table === 'meta_ad_metadata_sync_state' && cachedUrls.length ? [{ ad_id: '1', creative_id: '2', adset_id: '3' }] : [] }) };
      return q;
    },
    async rpc(name: string, args: unknown) { snapshots.push({ name, args }); return { error: null }; },
  };
  const deps: any = { createServiceSupabase: () => svc, resolveWorkspaceCredential: async () => 'secret',
    metaGraph: async () => ({ currency: 'IDR', timezone_name: 'Asia/Jakarta' }),
    fetchAdInsights: async () => { if (fetchError) throw new Error('Second page failed'); return [{ ad_id: '1', ad_name: 'A', date_start: '2026-10-01', spend: '100' }]; },
    fetchCreativeBatch: async () => { if (creativeError) throw new Error('Metadata unavailable'); return [{ ad_id: '1', creative_id: '2', name: 'A', thumbnail_url: null, video_id: null, body: null }]; },
    evaluateWorkspaceAlerts: async () => 0 };
  return { snapshots, filters, creatives, deps };
}
const options = { workspaceId: '00000000-0000-4000-8000-000000000001', accountId: 'act_1', dateStart: '2026-10-01', dateEnd: '2026-10-02' };
test('ad sync never replaces stored facts when the API report fails', async () => {
  const h = harness(true); const result = await runMetaAdSync(options, h.deps);
  assert.equal(result.status, 'failed'); assert.equal(h.snapshots.length, 0);
  assert.match(result.errors.join(' '), /Second page failed/);
});
test('new ads preserve successful performance snapshots while metadata is populated separately', async () => {
  const h = harness(false, true); const result = await runMetaAdSync(options, h.deps);
  assert.equal(result.status, 'success'); assert.equal(h.snapshots.length, 2); assert.equal(h.creatives.length, 0);
  assert.equal(h.snapshots[0].args.p_workspace_id, options.workspaceId);
  assert.equal(h.snapshots[0].args.p_account_id, 'act_1'); assert.equal(result.warnings?.length, 0);
  assert.ok(h.filters.some(f => f.table === 'meta_ad_accounts' && f.key === 'workspace_id' && f.value === options.workspaceId));
  assert.ok(h.filters.some(f => f.table === 'meta_ad_accounts' && f.key === 'account_id' && f.value === options.accountId));
});
test('an account outside the active workspace cannot run a sync', async () => {
  const h = harness(false, false, true);
  await assert.rejects(runMetaAdSync(options, h.deps), /workspace/); assert.equal(h.snapshots.length, 0);
});
test('a week with no ad rows still performs an empty replacement for coverage', async () => {
  const h = harness(); h.deps.fetchAdInsights = async () => [];
  const result = await runMetaAdSync(options, h.deps);
  assert.equal(result.status, 'success'); assert.deepEqual(h.snapshots[0].args.p_rows, []);
  assert.equal(result.accounts_synced, 1);
});
test('daily snapshots capture normalized creative URLs without copying a shared budget', async () => {
  const h = harness(false, false, false, ['https://roove.co.id/LP?utm_source=meta']); h.deps.fetchCreativeBatch = async () => { throw Error('Metrics must not refresh creative metadata'); };
  const result = await runMetaAdSync(options, h.deps);
  assert.equal(result.status, 'success'); assert.deepEqual(h.snapshots[0].args.p_rows[0].landing_page_urls, ['https://roove.co.id/LP']);
  assert.equal('budget' in h.snapshots[0].args.p_rows[0], false);
});
test('performance snapshots use certified workspace/account caches without rereading creative metadata', async () => {
  const h = harness(false, true, false, ['https://roove.co.id/LP?fbclid=test']);
  const result = await runMetaAdSync(options, h.deps);
  assert.equal(result.status, 'success'); assert.deepEqual(h.snapshots[0].args.p_rows[0].landing_page_urls, ['https://roove.co.id/LP']);
  assert.equal(h.snapshots[0].args.p_rows[0].metrics.spend, 100);
  assert.ok(h.filters.some(f => f.table === 'meta_ad_creatives' && f.key === 'workspace_id' && f.value === options.workspaceId));
  assert.ok(h.filters.some(f => f.table === 'meta_ad_creatives' && f.key === 'account_id' && f.value === 'act_1'));
});

test('uncertified and mismatched adset caches are not frozen into metric snapshots', async () => {
  const h = harness(false, false, false, ['https://roove.co.id/old']);
  h.deps.fetchAdInsights = async () => [{ ad_id: '1', ad_name: 'A', adset_id: '4', date_start: '2026-10-01', spend: '100' }];
  h.deps.fetchCreativeBatch = async () => { throw Error('Must not read creative API'); };
  const result = await runMetaAdSync(options, h.deps);assert.equal(result.status, 'success');
  assert.equal(h.snapshots[0].args.p_rows[0].creative_id, null);assert.deepEqual(h.snapshots[0].args.p_rows[0].landing_page_urls, []);
  assert.equal(h.snapshots[0].args.p_rows[0].metrics.spend, 100);assert.equal(h.creatives.length, 0);
});


test('successful snapshots warm only their account and dates, after the facts commit', async () => {
  const h = harness();
  await runMetaAdSync(options, h.deps);
  assert.deepEqual(h.snapshots.map(r => r.name), ['replace_meta_ad_snapshot', 'ensure_meta_brand_report_days']);
  assert.deepEqual(h.snapshots[1].args, { p_workspace_id: options.workspaceId, p_from: options.dateStart, p_to: options.dateEnd, p_accounts: ['act_1'] });
});
test('projection warm-up failure never retries or marks a committed snapshot failed', async () => {
  const h = harness(); const svc = h.deps.createServiceSupabase(); const rpc = svc.rpc;
  svc.rpc = async (name: string, args: unknown) => name === 'ensure_meta_brand_report_days' ? { error: { message: 'timeout' } } : rpc(name, args);
  const result = await runMetaAdSync(options, h.deps);
  assert.equal(result.status, 'success'); assert.equal(result.accounts_synced, 1);
  assert.equal(h.snapshots.length, 1); assert.equal(result.errors.length, 0);
  assert.match(result.warnings.join(' '), /metrik tersimpan/);
});
