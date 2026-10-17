import test from 'node:test';
import assert from 'node:assert/strict';
import { drainSyncQueue, parseSyncWorkerArgs } from '../lib/sync-worker-loop';
test('worker drains more than five jobs without timed pauses or parallel provider requests', async () => {
  let processed = 0, active = 0, maximum = 0;
  const count = await drainSyncQueue(parseSyncWorkerArgs(['--max-jobs=100', '--max-runtime-seconds=240']), async () => {
    active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--; return ++processed <= 23;
  }, () => 0, async () => { throw Error('No sleeping while jobs remain'); });
  assert.equal(count, 23); assert.equal(maximum, 1);
});
test('worker time budget finishes the current job before stopping and max-jobs remains bounded', async () => {
  let clock = 0, calls = 0;
  const options = parseSyncWorkerArgs(['--max-jobs=100', '--max-runtime-seconds=2']);
  assert.equal(await drainSyncQueue(options, async () => { calls++; clock += 1500; return true; }, () => clock), 2);
  assert.equal(calls, 2); assert.equal(clock, 3000);
  assert.equal(await drainSyncQueue(parseSyncWorkerArgs(['--max-jobs=3']), async () => true), 3);
});
