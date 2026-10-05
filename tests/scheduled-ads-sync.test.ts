import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueScheduledAdsSync } from '../lib/scheduled-ads-sync';

test('schedules Sheets-only workspaces and deduplicates repeated active jobs', async () => {
  const calls: any[] = [];
  const active = new Map<string, any>();
  const dependencies = {
    resolveScheduledWorkspaceIds: async (_: string | null | undefined, source: string) =>
      source === 'meta' ? ['shared'] : ['shared', 'sheets-only'],
    enqueueSyncJob: async (input: any) => {
      calls.push(input);
      const key = `${input.workspaceId}:${input.dedupeKey}`;
      const existing = active.get(key);
      const job = existing || { id: String(active.size), ...input };
      active.set(key, job);
      return { job, isDuplicate: Boolean(existing) };
    },
  };
  const first = await enqueueScheduledAdsSync(null, 'test', dependencies);
  const second = await enqueueScheduledAdsSync(null, 'test', dependencies);
  assert.equal(active.size, 3);
  assert.deepEqual(first.job_ids, second.job_ids);
  assert.equal(calls.filter(call => call.jobName === 'daily_ads_sync').length, 4);
  assert.deepEqual(calls.find(call => call.jobName === 'daily_ads_sync').payload, {});
  const meta = calls.find(call => call.jobName === 'meta_sync');
  assert.equal(meta.payload.date_start, meta.payload.date_end);
  assert.ok(meta.priority < calls.find(call => call.jobName === 'daily_ads_sync').priority);
});

test('a failed Meta lookup does not prevent Sheets enqueue, but reports failure', async () => {
  const queued: string[] = [];
  await assert.rejects(enqueueScheduledAdsSync('workspace', 'test', {
    resolveScheduledWorkspaceIds: async (id, source) => {
      assert.equal(id, 'workspace');
      if (source === 'meta') throw new Error('Meta lookup failed');
      return ['workspace'];
    },
    enqueueSyncJob: async (input) => {
      queued.push(input.jobName);
      return { job: { id: 'sheets' } as any, isDuplicate: false };
    },
  }), /Meta lookup failed/);
  assert.deepEqual(queued, ['daily_ads_sync']);
});
