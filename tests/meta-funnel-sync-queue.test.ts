import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueueScheduledMetaAdBatches } from '../lib/meta-funnel-sync-queue';
import { getTodayWIB } from '../lib/sync-schedule';
import { shiftDay } from '../lib/meta-funnel-domain';
import { loadMetaSyncJobs, metaSyncProgress, restoreMetaSyncRequest, validateMetaSyncJobIds, type MetaSyncJob } from '../lib/meta-funnel-sync-status';

function service(lastDates: Record<string, string | null>, error?: { message: string }) {
  const workspace = '00000000-0000-4000-8000-000000000001';
  const queries: string[] = [];
  const svc = { from(table: string) {
    queries.push(table); let account: string;
    const query: any = {
      select() { return query; },
      eq(key: string, value: string) {
        if (key === 'workspace_id') assert.equal(value, workspace);
        if (key === 'account_id') account = value;
        return query;
      },
      lte() { return query; }, order() { return query; }, limit() { return query; }, maybeSingle() { return query; },
      then(resolve: (result: unknown) => void) {
        resolve(table === 'meta_ad_accounts' ? { data: Object.keys(lastDates).map(account_id => ({ account_id })), error: null }
          : { data: lastDates[account] ? { metric_date: lastDates[account] } : null, error: error || null });
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { svc, workspace, queries };
}
test('all active accounts resume from their own coverage without saved funnels; first sync only yesterday', async () => {
  const yesterday = shiftDay(getTodayWIB(), -1), earlier = shiftDay(yesterday, -3);
  const { svc, workspace, queries } = service({ act_1: yesterday, act_2: earlier, act_3: null });
  const calls: any[] = [];
  const jobs = await enqueueScheduledMetaAdBatches(svc, workspace, async (id, accounts, from, to, user) => {
    calls.push({ id, accounts, from, to, user }); return [accounts[0]];
  }, 'user');
  assert.deepEqual(jobs, ['act_1', 'act_2', 'act_3']);
  assert.deepEqual(calls.map(c => c.from), [yesterday, earlier, yesterday]);
  assert.ok(calls.every(c => c.to === yesterday && c.id === workspace && c.user === 'user'));
  assert.ok(!queries.includes('meta_ad_funnels'));
});
test('coverage lookup errors do not silently restart at yesterday and skip missed days', async () => {
  const { svc, workspace } = service({ act_1: null }, { message: 'Database unavailable' });
  await assert.rejects(enqueueScheduledMetaAdBatches(svc, workspace, async () => { throw new Error('Must not enqueue'); }), /Database unavailable/);
});
test('no active accounts queues no ad batches', async () => {
  const { svc, workspace } = service({});
  assert.deepEqual(await enqueueScheduledMetaAdBatches(svc, workspace, async () => { throw new Error('Must not enqueue'); }), []);
});

const batchIds = Array.from({ length: 156 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
function batch(id: string, status: string): MetaSyncJob {
  return { id, status, error_message: null, payload: { date_start: '2026-10-07', date_end: '2026-10-13' },
    created_at: '2026-10-14T13:00:00Z', started_at: status === 'queued' ? null : '2026-10-14T13:01:00Z',
    completed_at: ['queued', 'running'].includes(status) ? null : '2026-10-14T13:02:00Z' };
}
test('sync progress distinguishes waiting, running, and all batches successfully finished', () => {
  const ids = batchIds.slice(0, 13);
  const queued = ids.map(id => batch(id, 'queued'));
  assert.equal(metaSyncProgress(ids, queued).state, 'queued');
  const running = queued.map((job, i) => ({ ...job, status: i < 5 ? 'success' : i === 5 ? 'running' : 'queued' }));
  assert.equal(metaSyncProgress(ids, running).state, 'running');
  assert.equal(metaSyncProgress(ids, running).completed, 5);
  const finished = metaSyncProgress(ids, ids.map(id => batch(id, 'success')));
  assert.equal(finished.state, 'complete'); assert.equal(finished.active, false);
  assert.equal(finished.completed, 13); assert.equal(finished.total, 13);
  assert.equal(finished.completedAt, '2026-10-14T13:02:00Z');
});
test('between worker ticks a partly processed request remains in progress', () => {
  const ids = batchIds.slice(0, 2), progress = metaSyncProgress(ids, [batch(ids[0], 'success'), batch(ids[1], 'queued')]);
  assert.equal(progress.state, 'running'); assert.equal(progress.active, true); assert.equal(progress.completed, 1);
});
test('failed, partial, and canceled batches finish with issues instead of reporting success', () => {
  const ids = batchIds.slice(0, 4), progress = metaSyncProgress(ids, ids.map((id, i) => batch(id, ['success', 'failed', 'partial', 'canceled'][i])));
  assert.equal(progress.state, 'issues'); assert.equal(progress.active, false); assert.equal(progress.completed, 4);
  assert.equal(progress.issues, 3); assert.equal(progress.success, 1);
});
test('progress tracks reused job IDs and excludes unrelated jobs, duplicates, and old failures', () => {
  const ids = batchIds.slice(0, 13), jobs = [...ids.map(id => batch(id, 'success')), batch(ids[0], 'success'), batch(batchIds[13], 'failed')];
  const progress = metaSyncProgress([...ids, ids[0]], jobs);
  assert.equal(progress.total, 13); assert.equal(progress.completed, 13); assert.equal(progress.failed, 0);
});
test('missing or unknown batches never produce a false success state', () => {
  const ids = batchIds.slice(0, 2);
  for (const jobs of [[batch(ids[0], 'success')], [batch(ids[0], 'success'), batch(ids[1], 'unknown')]]) {
    const progress = metaSyncProgress(ids, jobs);
    assert.equal(progress.state, 'unavailable'); assert.equal(progress.missing, 1); assert.equal(progress.completed, 1);
  }
});
test('stale-worker requeue goes back to waiting without completing that batch', () => {
  const ids = batchIds.slice(0, 1);
  assert.equal(metaSyncProgress(ids, [batch(ids[0], 'running')]).state, 'running');
  assert.equal(metaSyncProgress(ids, [batch(ids[0], 'queued')]).state, 'queued');
  assert.equal(metaSyncProgress(ids, [batch(ids[0], 'queued')]).completed, 0);
});
test('saved sync progress restores after reload and rejects malformed storage', () => {
  const saved = { jobIds: batchIds.slice(0, 13), startedAt: '2026-10-14T13:00:00Z' };
  assert.deepEqual(restoreMetaSyncRequest(JSON.stringify(saved)), saved);
  for (const value of [null, 'bad json', '{}', JSON.stringify({ ...saved, startedAt: 'invalid' }), JSON.stringify({ ...saved, jobIds: ['bad'] })]) {
    assert.equal(restoreMetaSyncRequest(value), null);
  }
  for (const input of [null, [], ['invalid'], Array(5001).fill(batchIds[0])]) assert.throws(() => validateMetaSyncJobIds(input));
  assert.deepEqual(validateMetaSyncJobIds([batchIds[0], batchIds[0]]), [batchIds[0]]);
});
test('status retrieval reads all 156 requested batches and always scopes workspace and Meta jobs, including spend and mapping', async () => {
  const workspace = '00000000-0000-4000-8000-000000001000', chunks: string[][] = [];
  const svc = { from(table: string) {
    assert.equal(table, 'sync_jobs');
    const filters: Record<string, unknown> = {};
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { filters[key] = value; return query; },
      contains(key: string, value: unknown) { filters[key] = value; return query; },
      in(key: string, ids: string[]) {
        assert.equal(key, 'id'); assert.equal(filters.workspace_id, workspace); assert.equal(filters.job_name, 'meta_sync');
        assert.ok(ids.length <= 100);
        chunks.push(ids);
        return Promise.resolve({ data: ids.map(id => batch(id, 'success')), error: null });
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  const jobs = await loadMetaSyncJobs(svc, workspace, batchIds);
  assert.deepEqual(chunks.map(chunk => chunk.length), [100, 56]);
  assert.equal(jobs.length, 156); assert.equal(metaSyncProgress(batchIds, jobs).state, 'complete');
});
