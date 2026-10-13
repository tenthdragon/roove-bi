import test from 'node:test';
import assert from 'node:assert/strict';
import { runMetaAdSync } from '../lib/meta-ad-sync-runner';

function harness(fetchError = false, creativeError = false, accountMissing = false, cachedUrls: string[] = []) {
  const snapshots: any[] = []; const filters: any[] = []; const creatives: any[] = [];
  const svc = {
    from(table: string) {
      const q: any = { select: () => q, limit: () => q, in: () => q, eq: (key: string, value: unknown) => { filters.push({ table, key, value }); return q; },
        upsert: (data: unknown) => { creatives.push(data); return Promise.resolve({ error: null }); },
        then: (resolve: any) => resolve({ error: null, data: table === 'meta_ad_accounts' ? accountMissing ? [] : [{ account_id: 'act_1', account_name: 'Test' }] : table === 'meta_ad_creatives' && cachedUrls.length ? [{ ad_id: '1', landing_page_urls: cachedUrls }] : [] }) };
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
test('metadata failure preserves successful performance snapshot and reports a warning', async () => {
  const h = harness(false, true); const result = await runMetaAdSync(options, h.deps);
  assert.equal(result.status, 'success'); assert.equal(h.snapshots.length, 1); assert.equal(h.creatives.length, 0);
  assert.equal(h.snapshots[0].args.p_workspace_id, options.workspaceId);
  assert.equal(h.snapshots[0].args.p_account_id, 'act_1'); assert.equal(result.warnings?.length, 1);
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
  const h = harness(); h.deps.fetchCreativeBatch = async () => [{ ad_id: '1', creative_id: '2', name: 'A', thumbnail_url: null, video_id: null, body: null, landing_page_urls: ['https://roove.co.id/LP?utm_source=meta'] }];
  const result = await runMetaAdSync(options, h.deps);
  assert.equal(result.status, 'success'); assert.deepEqual(h.snapshots[0].args.p_rows[0].landing_page_urls, ['https://roove.co.id/LP']);
  assert.equal('budget' in h.snapshots[0].args.p_rows[0], false);
});
test('a metadata outage falls back to the same workspace/account cache while preserving metrics', async () => {
  const h = harness(false, true, false, ['https://roove.co.id/LP?fbclid=test']);
  const result = await runMetaAdSync(options, h.deps);
  assert.equal(result.status, 'success'); assert.deepEqual(h.snapshots[0].args.p_rows[0].landing_page_urls, ['https://roove.co.id/LP']);
  assert.equal(h.snapshots[0].args.p_rows[0].metrics.spend, 100);
  assert.ok(h.filters.some(f => f.table === 'meta_ad_creatives' && f.key === 'workspace_id' && f.value === options.workspaceId));
  assert.ok(h.filters.some(f => f.table === 'meta_ad_creatives' && f.key === 'account_id' && f.value === 'act_1'));
});
