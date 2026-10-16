import test from 'node:test';
import assert from 'node:assert/strict';
import { nextProductSetRetryAt, runMetaProductSetVerification } from '../lib/meta-product-set-sync';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const otherWorkspaceId = '00000000-0000-4000-8000-000000000002';
const accountId = 'act_123';
const productSetId = '456';
const now = new Date('2026-10-17T05:00:00.000Z');

type DestinationRow = { ad_id: string; metadata: any; classification: 'cpas' | 'unknown'; evidence: any[] };
function makeSvc(opts: {
  accountActive?: boolean; destinations?: DestinationRow[]; registry?: any[]; attempt?: any;
  failRegistrySave?: boolean;
} = {}) {
  const state = {
    destinations: [...(opts.destinations || [])], registry: [...(opts.registry || [])],
    attempt: opts.attempt || null, queries: [] as any[], writes: [] as any[], rpcs: [] as any[],
  };
  const svc: any = {
    from(table: string) {
      const q: any = { table, method: 'select', filters: [], data: null };
      const record = (method: string, args: unknown[]) => { state.queries.push({ table, method, args }); return q; };
      q.select = (...args: unknown[]) => record('select', args);
      q.eq = (...args: unknown[]) => { q.filters.push({ method: 'eq', args }); return record('eq', args); };
      q.contains = (...args: unknown[]) => { q.filters.push({ method: 'contains', args }); return record('contains', args); };
      q.limit = (...args: unknown[]) => record('limit', args);
      q.order = (...args: unknown[]) => record('order', args);
      q.range = (...args: unknown[]) => { q.rangeArgs = args; return record('range', args); };
      q.maybeSingle = () => { q.single = true; return q; };
      q.upsert = async (data: any, options?: any) => {
        state.writes.push({ table, method: 'upsert', data, options });
        if (table === 'meta_shopee_product_sets' && opts.failRegistrySave) return { error: { message: 'registry save failed' } };
        if (table === 'meta_shopee_product_sets') {
          state.registry = [...state.registry.filter(r => !(r.workspace_id === data.workspace_id && r.account_id === data.account_id && r.product_set_id === data.product_set_id)), data];
        }
        if (table === 'meta_product_set_verification_attempts') state.attempt = data;
        return { error: null };
      };
      q.delete = () => { q.method = 'delete'; return q; };
      q.then = (resolve: any, reject: any) => {
        if (q.method === 'delete') {
          state.writes.push({ table, method: 'delete', filters: q.filters });
          state.attempt = null;
          return Promise.resolve({ error: null }).then(resolve, reject);
        }
        let data: any[] = [];
        if (table === 'meta_ad_accounts') {
          const ws = q.filters.find((f: any) => f.method === 'eq' && f.args[0] === 'workspace_id')?.args[1];
          const account = q.filters.find((f: any) => f.method === 'eq' && f.args[0] === 'account_id')?.args[1];
          const active = q.filters.find((f: any) => f.method === 'eq' && f.args[0] === 'is_active')?.args[1];
          if (opts.accountActive !== false && ws === workspaceId && account === accountId && active === true) data = [{ account_id: accountId }];
        } else if (table === 'meta_ad_destination_metadata') {
          const contains = q.filters.find((f: any) => f.method === 'contains')?.args[1];
          data = state.destinations.filter(row => !contains || row.metadata.product_set_ids?.includes(contains.product_set_ids?.[0]));
          if (q.rangeArgs) data = data.slice(q.rangeArgs[0], q.rangeArgs[1] + 1);
        } else if (table === 'meta_shopee_product_sets') {
          data = state.registry.filter(row => q.filters.every((f: any) => f.method !== 'eq' || row[f.args[0]] === f.args[1]));
        } else if (table === 'meta_product_set_verification_attempts') {
          data = state.attempt ? [state.attempt].filter(row => q.filters.every((f: any) => f.method !== 'eq' || row[f.args[0]] === f.args[1])) : [];
        }
        return Promise.resolve({ data: q.single ? data[0] || null : data, error: null }).then(resolve, reject);
      };
      return q;
    },
    rpc: async (name: string, args: any) => {
      state.rpcs.push({ name, args });
      if (name === 'apply_meta_product_set_classifications') for (const row of args.p_rows) {
        const destination = state.destinations.find(d => d.ad_id === row.ad_id);
        if (destination) { destination.classification = row.classification; destination.evidence = row.evidence; }
      }
      return { data: args.p_rows.length, error: null };
    },
  };
  return { svc, state };
}

function deps(svc: any, patch: Record<string, any> = {}) {
  const calls = { credentials: 0, verifications: [] as any[] };
  return {
    calls,
    dependencies: {
      createServiceSupabase: () => svc,
      resolveWorkspaceCredential: async () => { calls.credentials++; return 'token-secret'; },
      verifyShopeeProductSet: async (...args: any[]) => { calls.verifications.push(args); return { method: 'meta_product_set_products', complete: true, product_count: 1, samples: [] }; },
      now: () => new Date(now),
      ...patch,
    } as any,
  };
}

const ownDestination = (adId: string, patch: Partial<DestinationRow> = {}): DestinationRow => ({
  ad_id: adId, metadata: { version: 1, urls: [], application_ids: [], android_packages: [], ios_app_ids: [], product_set_ids: [productSetId], destination_type: 'CANVAS' },
  classification: 'unknown', evidence: [], ...patch,
});

test('successful verification registers proof and reclassifies ads without overwriting metadata observations', async () => {
  const { svc, state } = makeSvc({ destinations: [ownDestination('10'), ownDestination('11', {
    metadata: { ...ownDestination('11').metadata, urls: ['https://roove.co.id/product'] },
    evidence: [{ type: 'verified_product_set_id', value: productSetId }],
  })] });
  const d = deps(svc);
  const result = await runMetaProductSetVerification({ workspaceId, accountId, productSetId }, d.dependencies);
  assert.equal(result.status, 'success'); assert.equal(result.rows_inserted, 2);
  assert.equal(state.registry.length, 1);
  assert.deepEqual([state.registry[0].workspace_id, state.registry[0].account_id, state.registry[0].product_set_id], [workspaceId, accountId, productSetId]);
  assert.deepEqual(state.registry[0].verification, { method: 'meta_product_set_products', complete: true, product_count: 1, samples: [] });
  assert.equal(state.attempt, null);
  const rpc = state.rpcs.find(x => x.name === 'apply_meta_product_set_classifications')!;
  assert.equal(rpc.args.p_workspace_id, workspaceId); assert.equal(rpc.args.p_account_id, accountId);
  assert.deepEqual(rpc.args.p_rows.map((r: any) => [r.ad_id, r.classification]), [['10', 'cpas'], ['11', 'unknown']]);
  assert.equal(rpc.args.p_rows[0].metadata, state.destinations[0].metadata);
  assert.equal('workspace_id' in rpc.args.p_rows[0], false); assert.equal('observed_at' in rpc.args.p_rows[0], false);
  assert.deepEqual(state.writes.find(w => w.method === 'delete')?.filters.map((f: any) => f.args), [
    ['workspace_id', workspaceId], ['account_id', accountId], ['product_set_id', productSetId],
  ]);
  for (const table of ['meta_shopee_product_sets', 'meta_product_set_verification_attempts']) {
    assert.ok(state.queries.some(q => q.table === table && q.method === 'eq' && q.args[0] === 'workspace_id' && q.args[1] === workspaceId));
    assert.ok(state.queries.some(q => q.table === table && q.method === 'eq' && q.args[0] === 'account_id' && q.args[1] === accountId));
    assert.ok(state.queries.some(q => q.table === table && q.method === 'eq' && q.args[0] === 'product_set_id' && q.args[1] === productSetId));
  }
  assert.equal(d.calls.verifications.length, 1);
});

test('registered sets skip repeated product API reads and still classify newly observed ads', async () => {
  const { svc, state } = makeSvc({ destinations: [ownDestination('10') ] });
  const first = deps(svc);
  await runMetaProductSetVerification({ workspaceId, accountId, productSetId }, first.dependencies);
  state.destinations.push(ownDestination('12'));
  const second = deps(svc);
  const result = await runMetaProductSetVerification({ workspaceId, accountId, productSetId }, second.dependencies);
  assert.equal(result.already_verified, true); assert.equal(second.calls.credentials, 0); assert.equal(second.calls.verifications.length, 0);
  assert.deepEqual(state.rpcs.at(-1).args.p_rows.map((r: any) => r.ad_id), ['12']);
});

test('empty, non-Shopee, and permission failures cache a sanitized cooldown without registry or classification writes', async t => {
  for (const error of [new Error('Empty product set'), new Error('Product set contains a non-Shopee URL'), new Error('permission denied token-secret')]) {
    await t.test(error.message, async () => {
      const { svc, state } = makeSvc({ destinations: [ownDestination('10')] });
      const d = deps(svc, { verifyShopeeProductSet: async () => { throw error; } });
      const result = await runMetaProductSetVerification({ workspaceId, accountId, productSetId }, d.dependencies);
      assert.equal(result.status, 'partial');
      assert.equal(state.registry.length, 0); assert.equal(state.rpcs.length, 0);
      assert.equal(state.writes.some(w => w.table === 'meta_shopee_product_sets'), false);
      assert.equal(state.attempt.workspace_id, workspaceId); assert.equal(state.attempt.account_id, accountId);
      assert.equal(state.attempt.retry_after, '2026-10-17T17:00:00.000Z');
      assert.equal(state.attempt.error_message.includes('token-secret'), false);
      assert.deepEqual(result.warnings, [state.attempt.error_message]);
    });
  }
});

test('active cooldown returns its warning without credentials or another provider call', async () => {
  const { svc, state } = makeSvc({ destinations: [ownDestination('10')], attempt: {
    workspace_id: workspaceId, account_id: accountId, product_set_id: productSetId,
    retry_after: '2026-10-18T00:00:00.000Z', error_message: 'Empty set',
  } });
  const d = deps(svc);
  const result = await runMetaProductSetVerification({ workspaceId, accountId, productSetId }, d.dependencies);
  assert.equal(result.status, 'partial'); assert.equal(result.retry_after, state.attempt.retry_after);
  assert.equal(d.calls.credentials, 0); assert.equal(d.calls.verifications.length, 0);
  assert.equal(state.writes.length, 0); assert.equal(state.rpcs.length, 0);
});

test('workspace/account ownership and observed-set checks fail before credential resolution', async t => {
  const cases = [
    { name: 'inactive or foreign account', opts: { accountActive: false }, destinations: [ownDestination('10')], message: /workspace/i },
    { name: 'no owned ad has the set', opts: {}, destinations: [], message: /diamati/i },
  ];
  for (const scenario of cases) await t.test(scenario.name, async () => {
    const { svc, state } = makeSvc({ ...scenario.opts, destinations: scenario.destinations });
    const d = deps(svc);
    await assert.rejects(runMetaProductSetVerification({ workspaceId, accountId, productSetId }, d.dependencies), scenario.message);
    assert.equal(d.calls.credentials, 0); assert.equal(d.calls.verifications.length, 0);
    assert.equal(state.writes.length, 0); assert.equal(state.rpcs.length, 0);
  });
  const { svc, state } = makeSvc({ destinations: [ownDestination('10')] }); const d = deps(svc);
  await assert.rejects(runMetaProductSetVerification({ workspaceId: otherWorkspaceId, accountId, productSetId }, d.dependencies), /workspace/i);
  assert.equal(d.calls.credentials, 0); assert.equal(d.calls.verifications.length, 0);
  assert.equal(state.writes.length, 0); assert.equal(state.rpcs.length, 0);
});

test('registry save failure propagates without classification or negative cooldown writes', async () => {
  const { svc, state } = makeSvc({ destinations: [ownDestination('10')], failRegistrySave: true });
  const d = deps(svc);
  await assert.rejects(runMetaProductSetVerification({ workspaceId, accountId, productSetId }, d.dependencies), /registry save failed/);
  assert.equal(state.rpcs.length, 0);
  assert.equal(state.writes.some(w => w.table === 'meta_product_set_verification_attempts'), false);
});

test('retry deadline is the next midnight in WIB, including exact-midnight boundary', () => {
  assert.equal(nextProductSetRetryAt(new Date('2026-10-17T16:59:59.000Z')), '2026-10-17T17:00:00.000Z');
  assert.equal(nextProductSetRetryAt(new Date('2026-10-17T17:00:00.000Z')), '2026-10-18T17:00:00.000Z');
});
