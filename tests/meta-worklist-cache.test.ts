import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaWorklistCache } from '../lib/meta-worklist-cache';
test('filter/page changes share inventory; date changes refresh activity only; revisions and workspaces isolate both', async () => {
  const cache = createMetaWorklistCache<{ ready: boolean; ads: number }, { ready: boolean; spend: number }>();
  let inventories = 0, activities = 0;
  const inventory = async () => ({ ready: true, ads: ++inventories });
  const activity = async () => ({ ready: true, spend: ++activities });
  const input = () => cache.inventory('w1', '1', inventory);
  const [first, duplicate] = await Promise.all([input(), input()]);
  assert.equal(first, duplicate); assert.equal(inventories, 1);
  await cache.activity('w1', '1', '2026-10-01', '2026-10-18', activity);
  await input(); await cache.activity('w1', '1', '2026-10-01', '2026-10-18', activity);
  assert.equal(inventories, 1); assert.equal(activities, 1);
  await input(); await cache.activity('w1', '1', '2026-10-02', '2026-10-18', activity);
  assert.equal(inventories, 1); assert.equal(activities, 2);
  await cache.inventory('w1', '2', inventory); await cache.inventory('w2', '1', inventory);
  assert.equal(inventories, 3);
});
test('failed or missing-schema loads remain retryable and are never retained as ready inventory', async () => {
  const cache = createMetaWorklistCache<{ ready: boolean }, { ready: boolean }>();
  await assert.rejects(cache.inventory('w', '1', async () => { throw new Error('Offline'); }), /Offline/);
  assert.deepEqual(await cache.inventory('w', '1', async () => ({ ready: false })), { ready: false });
  assert.deepEqual(await cache.inventory('w', '1', async () => ({ ready: true })), { ready: true });
});
