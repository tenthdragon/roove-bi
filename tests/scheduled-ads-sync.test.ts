import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueScheduledAdsSync } from '../lib/scheduled-ads-sync';
import { readFileSync } from 'node:fs';

test('Meta schedule queues the entire incremental bundle per active workspace, not Sheets', async () => {
  const calls: string[] = [];
  const result = await enqueueScheduledAdsSync(null, 'request', {
    resolveScheduledWorkspaceIds: async (_, source) => { assert.equal(source, 'meta'); return ['roove', 'apurva']; },
    enqueueSyncJob: async () => { throw new Error('Must not queue Sheets'); },
    enqueueMetaSync: async (id, request) => { assert.equal(request, 'request'); calls.push(id); return [`${id}-spend`, `${id}-ad`, `${id}-mapping`]; },
  });
  assert.deepEqual(calls, ['roove', 'apurva']); assert.equal(result.job_ids.length, 6);
});
test('separate Sheets ticks still support Sheets-only workspaces and deduplicate active jobs', async () => {
  const active = new Map<string, any>();
  const deps = {
    resolveScheduledWorkspaceIds: async (_: unknown, source: string) => { assert.equal(source, 'daily_ads'); return ['shared', 'sheets-only']; },
    enqueueMetaSync: async () => { throw new Error('Must not queue Meta on ten-minute Sheets tick'); },
    enqueueSyncJob: async (input: any) => {
      assert.equal(input.jobName, 'daily_ads_sync'); assert.deepEqual(input.payload, {});
      const key = `${input.workspaceId}:${input.dedupeKey}`; const existing = active.get(key);
      const job = existing || { id: String(active.size), ...input }; active.set(key, job);
      return { job, isDuplicate: Boolean(existing) };
    },
  };
  const first = await enqueueScheduledAdsSync(null, 'test', deps, 'daily_ads');
  const second = await enqueueScheduledAdsSync(null, 'test', deps, 'daily_ads');
  assert.equal(active.size, 2); assert.deepEqual(first.job_ids, second.job_ids);
});
test('one workspace failure does not prevent other Meta bundles being attempted', async () => {
  const queued: string[] = [];
  await assert.rejects(enqueueScheduledAdsSync(null, 'test', {
    resolveScheduledWorkspaceIds: async () => ['failed', 'healthy'],
    enqueueSyncJob: async () => { throw new Error('Unexpected Sheets'); },
    enqueueMetaSync: async id => { queued.push(id); if (id === 'failed') throw new Error('enqueue failed'); return ['job']; },
  }), /enqueue failed/);
  assert.deepEqual(queued, ['failed', 'healthy']);
});
test('both hosting schedules run Meta at 17:00 WIB; Sheets keeps ten-minute cadence', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.equal(config.crons.find((c: any) => c.path === '/api/meta-sync').schedule, '0 10 * * *');
  assert.equal(config.crons.find((c: any) => c.path === '/api/meta-sync?source=daily_ads').schedule, '*/10 * * * *');
  assert.match(readFileSync('deploy/digitalocean/roove-bi-cron-meta-sync.timer', 'utf8'), /OnCalendar=\*-\*-\* 17:00:00 Asia\/Jakarta/);
});
