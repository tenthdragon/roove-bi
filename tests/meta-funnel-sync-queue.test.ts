import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueueScheduledMetaAdBatches } from '../lib/meta-funnel-sync-queue';
import { getTodayWIB } from '../lib/sync-schedule';
import { shiftDay } from '../lib/meta-funnel-domain';

function service(configs: { account_ids: string[]; group_by?: string }[], covered: string[], error?: { code: string; message: string }) {
  const workspace = '00000000-0000-4000-8000-000000000001';
  const queries: string[] = [];
  const svc = { from(table: string) {
    queries.push(table);
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) {
        if (key === 'workspace_id') assert.equal(value, workspace);
        if (key === 'metric_date') assert.equal(value, shiftDay(getTodayWIB(), -1));
        return query;
      },
      gte(key: string, value: unknown) { assert.equal(key, 'synced_at'); assert.equal(value, `${getTodayWIB()}T00:00:00+07:00`); return query; },
      then(resolve: (result: unknown) => void) {
        resolve(table === 'meta_ad_funnels' ? { data: configs.map(config => ({ config: { group_by: 'landing_page', ...config } })), error }
          : { data: (table === 'meta_ad_accounts' ? ['act_1', 'act_2', 'act_3'] : covered).map(account_id => ({ account_id })), error: null });
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { svc, workspace, queries };
}
test('scheduled refresh queues only configured accounts not already refreshed today', async () => {
  const { svc, workspace } = service([{ account_ids: ['act_1', 'act_2'] }], ['act_1']);
  let calls = 0;
  const result = await enqueueScheduledMetaAdBatches(svc, workspace, async (id, accounts, from, to) => {
    calls++; assert.equal(id, workspace); assert.deepEqual(accounts, ['act_2']);
    assert.equal(to, shiftDay(getTodayWIB(), -1)); assert.equal(from, shiftDay(to, -6));
    return ['job-1'];
  });
  assert.equal(result, 1); assert.equal(calls, 1);
});
test('repeated scheduler ticks with complete daily coverage enqueue no further ad jobs', async () => {
  const { svc, workspace } = service([{ account_ids: [] }], ['act_1', 'act_2', 'act_3']);
  assert.equal(await enqueueScheduledMetaAdBatches(svc, workspace, async () => { throw new Error('Must not enqueue'); }), 0);
});
test('without saved funnels or before migration the scheduler leaves normal Meta sync intact', async () => {
  for (const error of [undefined, { code: 'PGRST205', message: 'Migration missing' }]) {
    const { svc, workspace, queries } = service([], [], error);
    assert.equal(await enqueueScheduledMetaAdBatches(svc, workspace, async () => { throw new Error('Must not enqueue'); }), 0);
    assert.deepEqual(queries, ['meta_ad_funnels']);
  }
});
test('legacy naming configurations do not enqueue landing-page monitoring jobs', async () => {
  const { svc, workspace } = service([{ account_ids: [], group_by: 'cep_funnel' }], []);
  assert.equal(await enqueueScheduledMetaAdBatches(svc, workspace, async () => { throw new Error('Must not enqueue legacy monitoring'); }), 0);
});
