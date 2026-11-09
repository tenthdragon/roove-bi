import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';

function moduleWithMocks(path: string, mocks: Record<string, unknown>) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const output = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const exports: any = {};
  new Function('require', 'exports', output)((id: string) => {
    assert.ok(id in mocks, `Unexpected dependency ${id}`); return mocks[id];
  }, exports);
  return exports;
}

test('saving uses authenticated RPC identity, guards workspace and invalidates financial caches only on success', async () => {
  const calls: any[] = [];
  const tags: string[] = [];
  const paths: string[] = [];
  let failure = false;
  const api = moduleWithMocks('../lib/scalev-financial-correction-actions.ts', {
    'next/cache': { revalidateTag: (tag: string) => tags.push(tag), revalidatePath: (path: string) => paths.push(path) },
    './dashboard-access': { requireDashboardRoles: async () => ({ workspaceId: 'workspace-a' }) },
    './service-supabase': {},
    './supabase-server': { createServerSupabase: () => ({ rpc: async (...args: any[]) => {
      calls.push(args); return failure ? { error: { message: 'Version changed' } } : { data: 2 };
    } }) },
    './scalev-line-persistence': { withScalevLineRetry: (fn: () => unknown) => fn() },
  });
  const input = { workspaceId: 'workspace-a', orderId: 1, expectedVersion: 1,
    changes: [{ entity: 'order', field: 'net_revenue', amount: 525000 }], reason: ' Reconciled ' };
  await assert.rejects(api.saveScalevFinancialCorrections({ ...input, workspaceId: 'other' }), /Workspace berubah/);
  assert.equal(calls.length, 0);
  assert.deepEqual(await api.saveScalevFinancialCorrections(input), { version: 2 });
  assert.equal(calls[0][0], 'set_scalev_financial_corrections');
  assert.equal(calls[0][1].p_reason, 'Reconciled');
  assert.equal('p_actor_id' in calls[0][1], false, 'actor must come from session');
  assert.deepEqual(tags, ['overview-cm3-history', 'overview-cm3-history-active', 'shipping-fee-range']);
  assert.deepEqual(paths, ['/dashboard']);
  failure = true;
  await assert.rejects(api.saveScalevFinancialCorrections(input));
  assert.equal(tags.length, 3);
});

test('database revision refreshes historical CM3 and nested shipping caches without Next revalidateTag', async () => {
  let revision = 0;
  let spend = 525000;
  let workspace = 'workspace-a';
  const shippingRevisions: number[] = [];
  const api = moduleWithMocks('../lib/overview-actions.ts', {
    'next/cache': { unstable_cache: (fn: (...args: any[]) => unknown) => {
      const values = new Map<string, unknown>();
      return (...args: any[]) => {
        const key = JSON.stringify(args);
        if (!values.has(key)) values.set(key, fn(...args));
        return values.get(key);
      };
    } },
    './supabase-server': { createServiceSupabase: () => ({
      from: (table: string) => {
        const q: any = {};
        for (const name of ['select', 'eq', 'gte', 'lte', 'order']) q[name] = () => q;
        q.maybeSingle = async () => ({ data: { revision } });
        q.range = async () => ({ data: table === 'daily_ads_spend' ? [{ date: '2026-09-07', spent: spend }] : [] });
        return q;
      },
      rpc: async () => ({ data: [] }),
    }) },
    './dashboard-access': { requireDashboardTabAccess: async () => ({ workspaceId: workspace }) },
    './shipment-count-data': {},
    './shipping-fee-data': { getShippingFeeRange: async (_w: string, _from: string, _to: string, rev: number) => {
      shippingRevisions.push(rev); return [];
    } },
  });
  const first = await api.getOverviewCm3HistoryData({ to: '2026-11-09' });
  assert.equal(first.ads[0].spent, 525000);
  spend = 525;
  const cached = await api.getOverviewCm3HistoryData({ to: '2026-11-09' });
  assert.equal(cached.ads[0].spent, 525000);
  revision = 1;
  const refreshed = await api.getOverviewCm3HistoryData({ to: '2026-11-09' });
  assert.equal(refreshed.ads[0].spent, 525);
  assert.ok(shippingRevisions.includes(1));
  workspace = 'workspace-b'; spend = 100;
  const otherWorkspace = await api.getOverviewCm3HistoryData({ to: '2026-11-09' });
  assert.equal(otherWorkspace.ads[0].spent, 100);
});
