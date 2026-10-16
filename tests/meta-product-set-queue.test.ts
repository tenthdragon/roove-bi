import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueNewMetaProductSets } from '../lib/meta-product-set-queue';
import { createSyncJobDedupeKey } from '../lib/sync-jobs';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const accountId = 'act_123';

function fakeDb(options: { verified?: string[]; attempts?: Array<{ product_set_id: string; retry_after: string }>; error?: Error } = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const svc: any = { from(table: string) {
    const query: any = {};
    for (const method of ['select', 'eq', 'in']) query[method] = (...args: unknown[]) => {
      calls.push({ table, method, args }); return query;
    };
    query.then = (resolve: (value: any) => unknown, reject: (error: unknown) => unknown) => {
      if (options.error) return Promise.reject(options.error).then(resolve, reject);
      const data = table === 'meta_shopee_product_sets'
        ? (options.verified || []).map(product_set_id => ({ product_set_id }))
        : (options.attempts || []);
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return query;
  } };
  return { svc, calls };
}

function makeEnqueuer() {
  const inputs: any[] = [];
  const enqueue = async (input: any) => { inputs.push(input); return { job: { id: `job-${inputs.length}` }, isDuplicate: false }; };
  return { enqueue, inputs };
}

test('queries verified sets and cooldown attempts in exact workspace/account/ID scope', async () => {
  const db = fakeDb({ verified: ['200'], attempts: [{ product_set_id: '300', retry_after: '2026-10-20T00:00:00.000Z' }] });
  const queue = makeEnqueuer();
  await enqueueNewMetaProductSets(db.svc, workspaceId, accountId, ['100', '200', '300'], queue.enqueue, new Date('2026-10-17T00:00:00Z'));
  for (const table of ['meta_shopee_product_sets', 'meta_product_set_verification_attempts']) {
    assert.ok(db.calls.some(c => c.table === table && c.method === 'eq' && c.args[0] === 'workspace_id' && c.args[1] === workspaceId));
    assert.ok(db.calls.some(c => c.table === table && c.method === 'eq' && c.args[0] === 'account_id' && c.args[1] === accountId));
    const idFilter = db.calls.find(c => c.table === table && c.method === 'in' && c.args[0] === 'product_set_id');
    assert.ok(idFilter);
    assert.deepEqual(idFilter!.args[1], ['100', '200', '300']);
  }
});

test('deduplicates input and skips verified or still-cooled-down product sets', async () => {
  const db = fakeDb({ verified: ['200'], attempts: [{ product_set_id: '300', retry_after: '2026-10-18T00:00:00.000Z' }] });
  const queue = makeEnqueuer();
  const ids = await enqueueNewMetaProductSets(db.svc, workspaceId, accountId, ['100', '100', '200', '300'], queue.enqueue, new Date('2026-10-17T00:00:00Z'));
  assert.deepEqual(ids, ['job-1']);
  assert.equal(queue.inputs.length, 1);
  assert.deepEqual(queue.inputs[0].payload, {
    ad_mapping_only: true, verify_shopee_product_set: true, account_id: accountId, product_set_id: '100',
  });
  assert.equal(queue.inputs[0].mode, 'meta_product_set_verify');
  assert.equal(queue.inputs[0].maxAttempts, 2);
  assert.equal(queue.inputs[0].priority, 19);
});

test('expired cooldowns are eligible for one-set jobs', async () => {
  const db = fakeDb({ attempts: [{ product_set_id: '300', retry_after: '2026-10-16T23:59:59.000Z' }] });
  const queue = makeEnqueuer();
  await enqueueNewMetaProductSets(db.svc, workspaceId, accountId, ['300'], queue.enqueue, new Date('2026-10-17T00:00:00Z'));
  assert.equal(queue.inputs.length, 1);
  assert.equal(queue.inputs[0].payload.product_set_id, '300');
});

test('dedupe key stays stable across days and omits a requested-day component', async () => {
  const run = async (now: Date) => {
    const queue = makeEnqueuer();
    await enqueueNewMetaProductSets(fakeDb().svc, workspaceId, accountId, ['400'], queue.enqueue, now);
    return queue.inputs[0];
  };
  const first = await run(new Date('2026-10-17T00:00:00Z'));
  const later = await run(new Date('2026-10-18T00:00:00Z'));
  const expected = createSyncJobDedupeKey('meta_sync', 'meta_product_set_verify', {
    ad_mapping_only: true, verify_shopee_product_set: true, account_id: accountId, product_set_id: '400',
  });
  assert.equal(first.dedupeKey, expected);
  assert.equal(later.dedupeKey, expected);
  assert.equal('requested_day' in first.payload, false);
});

test('malformed scope and IDs fail before database queries or writes', async () => {
  const db = fakeDb(); const queue = makeEnqueuer();
  await assert.rejects(enqueueNewMetaProductSets(db.svc, '', accountId, ['100'], queue.enqueue), /scope|workspace/i);
  await assert.rejects(enqueueNewMetaProductSets(db.svc, workspaceId, 'act_bad', ['100'], queue.enqueue), /scope|account/i);
  await assert.rejects(enqueueNewMetaProductSets(db.svc, workspaceId, accountId, ['not-numeric'], queue.enqueue), /product|ID/i);
  assert.equal(db.calls.length, 0); assert.equal(queue.inputs.length, 0);
});

test('database lookup and enqueue errors propagate', async () => {
  const dbFailure = new Error('registry unavailable'); const failedDb = fakeDb({ error: dbFailure });
  await assert.rejects(enqueueNewMetaProductSets(failedDb.svc, workspaceId, accountId, ['100'], makeEnqueuer().enqueue), /registry unavailable/);

  const queue = makeEnqueuer();
  const failedEnqueue = async () => { throw new Error('queue unavailable'); };
  await assert.rejects(enqueueNewMetaProductSets(fakeDb().svc, workspaceId, accountId, ['100'], failedEnqueue), /queue unavailable/);
  assert.equal(queue.inputs.length, 0);
});
