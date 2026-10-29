import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createMetaOverviewCache } from '../lib/meta-overview-cache';
import { useMetaCachedLoad } from '../lib/useMetaCachedLoad';
const { create, act } = createRequire(import.meta.url)('react-test-renderer');
type Data = { label: string; reportVersion: string };
const deferred = () => { let resolve!: (value: Data) => void; const promise = new Promise<Data>(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise<void>(r => setImmediate(r));

test('initial effect, polling callers and remounts share one request and retain validated navigation data', async () => {
  const cache = createMetaOverviewCache<Data>(), gate = deferred();
  let reads = 0, state!: ReturnType<typeof useMetaCachedLoad<Data>>;
  const fetch = () => { reads++; return gate.promise; };
  function Probe() { state = useMetaCachedLoad('user:workspace:brand:website', cache, fetch); return null; }
  let root: any;
  await act(async () => { root = create(<Probe />); await tick(); });
  let joined!: Promise<Data | null>;
  await act(async () => { joined = state.load(); gate.resolve({ label: 'Ready', reportVersion: '1' }); await joined; });
  assert.equal(reads, 1); assert.equal(state.data?.label, 'Ready'); assert.equal(state.loading, false);
  await act(async () => root.unmount());
  await act(async () => { root = create(<Probe />); await tick(); });
  assert.equal(reads, 1); assert.equal(state.data?.label, 'Ready');
  await act(async () => root.unmount());
});

test('a slow response from the previous brand/world/workspace cannot replace the current selection', async () => {
  const cache = createMetaOverviewCache<Data>(), old = deferred(), fresh = deferred();
  let state!: ReturnType<typeof useMetaCachedLoad<Data>>;
  const before = () => old.promise, after = () => fresh.promise;
  function Probe({ id, fetch }: { id: string; fetch: () => Promise<Data> }) { state = useMetaCachedLoad(id, cache, fetch); return null; }
  let root: any;
  await act(async () => { root = create(<Probe id="old:website" fetch={before} />); await tick(); });
  await act(async () => { root.update(<Probe id="new:cpas" fetch={after} />); await tick(); });
  await act(async () => { old.resolve({ label: 'Stale', reportVersion: '1' }); await tick(); });
  assert.equal(state.data, null);
  await act(async () => { fresh.resolve({ label: 'Current', reportVersion: '2' }); await tick(); });
  assert.equal(state.data?.label, 'Current'); assert.equal(cache.get('old:website'), undefined);
  await act(async () => root.unmount());
});

test('a mutation refresh waits for an older in-flight read then requests fresh data', async () => {
  const cache = createMetaOverviewCache<Data>(), old = deferred(), fresh = deferred();
  let reads = 0, state!: ReturnType<typeof useMetaCachedLoad<Data>>;
  const fetch = () => (++reads === 1 ? old.promise : fresh.promise);
  function Probe() { state = useMetaCachedLoad('scope', cache, fetch); return null; }
  let root: any, refresh!: Promise<Data | null>;
  await act(async () => { root = create(<Probe />); await tick(); });
  await act(async () => { refresh = state.load(true); old.resolve({ label: 'Before save', reportVersion: '1' }); await tick(); });
  assert.equal(reads, 2);
  await act(async () => { fresh.resolve({ label: 'After save', reportVersion: '2' }); await refresh; });
  assert.equal(state.data?.label, 'After save'); assert.equal(cache.get('scope')?.reportVersion, '2');
  await act(async () => root.unmount());
});

test('failed requests remain retryable and cannot populate the navigation cache', async () => {
  const cache = createMetaOverviewCache<Data>(); let reads = 0, state!: ReturnType<typeof useMetaCachedLoad<Data>>;
  const fetch = async () => { if (++reads === 1) throw new Error('Permission changed'); return { label: 'Retry', reportVersion: '2' }; };
  function Probe() { state = useMetaCachedLoad('scope', cache, fetch); return null; }
  let root: any;
  await act(async () => { root = create(<Probe />); await tick(); });
  assert.equal(state.error, 'Permission changed'); assert.equal(cache.get('scope'), undefined);
  await act(async () => { await state.load(true); });
  assert.equal(state.error, ''); assert.equal(state.data?.label, 'Retry');
  await act(async () => root.unmount());
});

test('simultaneous revision checks queue one refresh and share its result', async () => {
  const cache = createMetaOverviewCache<Data>(), old = deferred(), fresh = deferred();
  let reads = 0, state!: ReturnType<typeof useMetaCachedLoad<Data>>;
  const fetch = () => (++reads === 1 ? old.promise : fresh.promise);
  function Probe() { state = useMetaCachedLoad('scope', cache, fetch); return null; }
  let root: any, first!: Promise<Data | null>, second!: Promise<Data | null>;
  await act(async () => { root = create(<Probe />); await tick(); });
  await act(async () => {
    first = state.load(true); second = state.load(true);
    assert.equal(first, second);
    old.resolve({ label: 'Old', reportVersion: '1' }); await tick();
  });
  assert.equal(reads, 2);
  await act(async () => { fresh.resolve({ label: 'Current', reportVersion: '2' }); await Promise.all([first, second]); });
  assert.equal(reads, 2); assert.equal(state.data?.reportVersion, '2');
  await act(async () => root.unmount());
});
