import assert from 'node:assert/strict';
import test from 'node:test';
import { createMetaReportRequests, metaReportResponse, MetaReportUnavailableError } from '../lib/meta-report-requests';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('eight overview reports and a detail request share a two-query budget', async () => {
  const requests = createMetaReportRequests();
  const gates = Array.from({ length: 9 }, deferred);
  let active = 0, peak = 0;
  const started: number[] = [];
  const results = gates.map((gate, i) => requests.run('scope-' + i, async () => {
    started.push(i); peak = Math.max(peak, ++active);
    await gate.promise; active--; return i;
  }));
  await tick(); assert.deepEqual(started, [0, 1]);
  for (let i = 0; i < gates.length; i++) { gates[i].resolve(); await tick(); }
  assert.deepEqual(await Promise.all(results), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(peak, 2);
});

test('identical misses share work while workspace/revision/query scopes stay separate', async () => {
  const requests = createMetaReportRequests(), gate = deferred();
  const key = (workspace: string, revision: string, from: string) => JSON.stringify([workspace, revision, { from }]);
  let reads = 0;
  const load = async () => { reads++; await gate.promise; return reads; };
  const first = requests.run(key('a', '1', '2026-10-01'), load);
  assert.equal(requests.run(key('a', '1', '2026-10-01'), load), first);
  const other = [requests.run(key('b', '1', '2026-10-01'), load), requests.run(key('a', '2', '2026-10-01'), load), requests.run(key('a', '1', '2026-10-11'), load)];
  gate.resolve(); await Promise.all([first, ...other]); assert.equal(reads, 4);
  await requests.run(key('a', '1', '2026-10-01'), load); assert.equal(reads, 5, 'Settled results are not retained by the coordinator');
});

test('a failed report releases its slot, rejects duplicate callers and can be retried', async () => {
  const requests = createMetaReportRequests(1), gate = deferred();
  const first = requests.run('failed', async () => { await gate.promise; throw new Error('timeout'); });
  const duplicate = requests.run('failed', async () => 99);
  const next = requests.run('next', async () => 42);
  const failed = assert.rejects(first, /timeout/), same = assert.rejects(duplicate, /timeout/);
  gate.resolve(); await Promise.all([failed, same]); assert.equal(await next, 42);
  assert.equal(await requests.run('failed', async () => 7), 7);
});

test('only expected report failures become safe retry data; auth and other errors still reject', async () => {
  const result = await metaReportResponse(async () => { throw new MetaReportUnavailableError(true); });
  assert.deepEqual(result, { reportError: 'Laporan Meta sedang sibuk. Silakan klik Muat ulang beberapa saat lagi.' });
  assert.deepEqual(await metaReportResponse(async () => ({ schemaReady: true })), { schemaReady: true });
  await assert.rejects(metaReportResponse(async () => { throw new Error('Forbidden'); }), /Forbidden/);
});
