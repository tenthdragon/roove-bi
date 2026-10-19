import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetaOverviewCache } from '../lib/meta-overview-cache';

test('navigation cache expires, remains bounded and isolates user/workspace/filter keys', () => {
  const cache = createMetaOverviewCache<number>(300_000, 2);
  cache.set('user1:workspace1:joint', 10);
  assert.equal(cache.get('user2:workspace1:joint'), undefined);
  assert.equal(cache.get('user1:workspace2:joint'), undefined);
  assert.equal(cache.get('user1:workspace1:skin'), undefined);
  cache.set('user1:workspace1:skin', 20);
  cache.set('user1:workspace2:joint', 30);
  assert.equal(cache.get('user1:workspace1:joint'), undefined);
  cache.delete('user1:workspace1:skin');
  assert.equal(cache.get('user1:workspace1:skin'), undefined);
  const expired = createMetaOverviewCache<number>(-1);
  expired.set('old', 1);
  assert.equal(expired.get('old'), undefined);
});

test('initial load, polling and remount callers share pending work; failures can retry', async () => {
  const cache = createMetaOverviewCache<number>();
  let count = 0;
  let complete!: (value: number) => void;
  const first = cache.request('scope', () => { count++; return new Promise<number>(resolve => { complete = resolve; }); });
  assert.equal(cache.request('scope', async () => 99), first);
  await Promise.resolve();
  complete(42);
  assert.equal(await first, 42);
  assert.equal(count, 1);
  assert.equal(cache.get('scope'), undefined, 'Unvalidated responses must not be cached automatically');
  await assert.rejects(cache.request('scope', async () => { throw new Error('Forbidden'); }), /Forbidden/);
  assert.equal(await cache.request('scope', async () => 7), 7);
});
