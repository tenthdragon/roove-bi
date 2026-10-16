import test from 'node:test';
import assert from 'node:assert/strict';
import { incrementalMetaRange, metaSpendRange } from '../lib/meta-incremental-sync';

test('incremental range overlaps successful boundary, catches missed days, and bootstraps only latest day', () => {
  assert.deepEqual(incrementalMetaRange('2026-10-14', '2026-10-15'), { from: '2026-10-14', to: '2026-10-15' });
  assert.deepEqual(incrementalMetaRange(null, '2026-10-15'), { from: '2026-10-15', to: '2026-10-15' });
  assert.deepEqual(incrementalMetaRange('2026-10-15', '2026-10-15'), { from: '2026-10-15', to: '2026-10-15' });
  assert.deepEqual(incrementalMetaRange('2026-11-01', '2026-10-15'), { from: '2026-10-15', to: '2026-10-15' });
  assert.deepEqual(incrementalMetaRange('2026-10-01', '2026-10-15'), { from: '2026-10-01', to: '2026-10-15' });
});
test('spend resumes only successful workspace log and finalizes yesterday after intraday refresh', async () => {
  for (const last of ['2026-10-16', '2026-10-13', null]) {
    const filters: Record<string, unknown> = {};
    const q: any = { select: () => q, eq: (k: string, v: unknown) => { filters[k] = v; return q; }, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: last ? { date_range_end: last } : null, error: null }) };
    const svc = { from: (table: string) => { assert.equal(table, 'meta_sync_log'); return q; } } as any;
    const range = await metaSpendRange(svc, 'roove', '2026-10-16');
    assert.deepEqual(filters, { workspace_id: 'roove', status: 'success' });
    assert.deepEqual(range, { from: last === '2026-10-13' ? last : '2026-10-15', to: '2026-10-16' });
  }
});

import { enqueueIncrementalMetaSync } from '../lib/meta-sync-queue';
test('manual sync tracks spend, ad, and mapping jobs; detail enqueue still runs if spend enqueue fails', async () => {
  for (const failSpend of [false, true]) {
    const calls: string[] = [];
    const deps: any = {
      enqueueSyncJob: async (input: any) => {
        calls.push('spend'); assert.equal(input.workspaceId, 'roove'); assert.equal(input.requestedBy, 'user');
        assert.equal(input.payload.incremental, true); assert.equal(input.payload.date_start, undefined);
        if (failSpend) throw new Error('Spend unavailable'); return { job: { id: 'spend' } };
      },
      enqueueScheduledMetaAdBatches: async (_: unknown, workspace: string, __: unknown, user: string) => {
        calls.push('ads'); assert.equal(workspace, 'roove'); assert.equal(user, 'user'); return ['ad1', 'ad2'];
      },
      enqueueScheduledMetaAdMapping: async () => { calls.push('mapping'); return ['map']; },
    };
    const result = enqueueIncrementalMetaSync({} as any, 'roove', 'user', undefined, deps);
    if (failSpend) await assert.rejects(result, /Spend unavailable/);
    else assert.deepEqual(await result, ['spend', 'ad1', 'ad2', 'map']);
    assert.deepEqual(calls, ['spend', 'ads', 'mapping']);
  }
});
