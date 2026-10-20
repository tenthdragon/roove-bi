import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import * as scopes from '../lib/meta-brand-access';
import { defaultFunnel } from '../lib/meta-funnel-domain';
import { parseAdMapping } from '../lib/meta-ad-mapping';
import React from 'react';

function module(file: string, stubs: Record<string, unknown>): any {
  const url = new URL(`../lib/${file}.ts`, import.meta.url), require = createRequire(url);
  const output = transpileModule(readFileSync(url, 'utf8'), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', output)((name: string) => Object.hasOwn(stubs, name) ? stubs[name] : require(name), exports);
  return exports;
}
const scope = { brandIds: [1, 2], accountIds: ['act_1', 'act_2'], accessKey: '1,2' };
const accounts = [1, 2, 3].map(id => ({ account_id: `act_${id}`, account_name: `Account ${id}`, default_brand_id: id, is_active: true, workspace_id: 'w' }));
const brands = [1, 2, 3].map(id => ({ id, name: `Brand ${id}`, workspace_id: 'w' }));
const ctx = { ...scope, workspaceId: 'w', profile: { id: 'viewer', role: 'advertiser' }, workspace: { settings: {} } };
function database(tables: Record<string, any[]>) {
  return { from(table: string) {
    assert.ok(table in tables, `Unexpected table ${table}`);
    let rows = tables[table];
    const q: any = {
      select: () => q, order: () => q, contains: () => q,
      eq: (key: string, value: unknown) => { rows = rows.filter(r => r[key] === value); return q; },
      neq: (key: string, value: unknown) => { rows = rows.filter(r => r[key] !== value); return q; },
      in: (key: string, values: unknown[]) => { rows = rows.filter(r => values.includes(r[key])); return q; },
      limit: (n: number) => { rows = rows.slice(0, n); return q; },
      maybeSingle: async () => ({ data: rows[0] || null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
    }; return q;
  } };
}
test('scope lookup pins user/workspace, supports multiple brands and fails closed on schema errors', async () => {
  const svc = database({ workspace_advertiser_brands: [
    { workspace_id: 'w', user_id: 'viewer', brand_id: 2 }, { workspace_id: 'w', user_id: 'viewer', brand_id: 1 },
    { workspace_id: 'w', user_id: 'other', brand_id: 3 }, { workspace_id: 'foreign', user_id: 'viewer', brand_id: 3 },
  ], meta_ad_accounts: accounts });
  const api = module('meta-brand-access', { './service-supabase': { createServiceSupabase: () => svc } });
  assert.deepEqual(await api.loadMetaBrandScope('w', 'viewer', 'advertiser'), { ...scope, accessKey: JSON.stringify([[1, 2], ['act_1', 'act_2']]) });
  assert.deepEqual((await api.loadMetaBrandScope('w', 'unassigned', 'advertiser')).accountIds, []);
  assert.equal((await api.loadMetaBrandScope('w', 'viewer', 'owner')).brandIds, null);
  const failure = module('meta-brand-access', { './service-supabase': { createServiceSupabase: () => ({ from: () => { throw new Error('Unavailable'); } }) } });
  await assert.rejects(failure.loadMetaBrandScope('w', 'viewer', 'advertiser'));
});
test('empty scope never becomes the SQL all-accounts wildcard and forged brand IDs are denied', () => {
  assert.deepEqual(scopes.scopeMetaAccountIds([], scope), ['act_1', 'act_2']);
  assert.deepEqual(scopes.scopeMetaAccountIds(['act_3'], scope), [scopes.NO_META_ACCOUNT]);
  assert.deepEqual(scopes.scopeMetaAccountIds([], { ...scope, accountIds: [], brandIds: [] }), [scopes.NO_META_ACCOUNT]);
  assert.throws(() => scopes.assertMetaBrand(scope, '3'), /tidak memiliki akses/);
  assert.throws(() => scopes.assertMetaBrand(scope, '__unmapped__'), /tidak memiliki akses/);
  scopes.assertMetaBrand(scope, '1'); scopes.assertMetaBrand(scope, '2');
});
test('actual report context restricts history/creative config, accounts, brands, templates and jobs before reads', async () => {
  let currentScope = scope;
  const svc = database({ meta_ad_accounts: accounts, brands, meta_ad_report_versions: [{ workspace_id: 'w', revision: 7 }], meta_ad_classifications: [{ workspace_id: 'w', ad_channel: 'non_cpas' }] });
  const api = module('meta-report-context', {
    './dashboard-access': { requireDashboardTabAccess: async () => ctx },
    './meta-brand-access': { ...scopes, loadMetaBrandScope: async () => currentScope },
    './service-supabase': { createServiceSupabase: () => svc },
    './meta-funnel-store': { loadFunnels: async () => [
      { ...defaultFunnel(), id: '11111111-1111-4111-8111-111111111111', account_ids: ['act_3'], group_by: 'landing_page' },
      { ...defaultFunnel(), id: '22222222-2222-4222-8222-222222222222', account_ids: [], group_by: 'landing_page' },
    ] },
  });
  const input = { from: '2026-10-01', to: '2026-10-10' };
  const r = await api.reportContext(input, true);
  assert.deepEqual(r.accounts.map((a: any) => a.account_id), ['act_1', 'act_2']);
  assert.deepEqual(r.brands.map((b: any) => b.id), [1, 2]);
  assert.deepEqual(r.config.account_ids, ['act_1', 'act_2']); assert.deepEqual(r.jobs, []);
  assert.equal(r.funnels.length, 1); assert.deepEqual(r.funnels[0].account_ids, ['act_1', 'act_2']);
  await assert.rejects(api.reportContext({ ...input, brandId: '3' }), /tidak memiliki akses/);
  await assert.rejects(api.reportContext({ ...input, funnelId: '11111111-1111-4111-8111-111111111111' }), /Template tidak tersedia/);
  currentScope = { brandIds: [], accountIds: [], accessKey: 'empty' };
  const empty = await api.reportContext(input);
  assert.deepEqual(empty.funnels, [], 'Unassigned users must not receive shared template metadata');
  assert.deepEqual(empty.config.account_ids, [scopes.NO_META_ACCOUNT]);
});
test('warm shared inventory is scoped before worklist rows, totals, facets, catalogs and sync state escape', async () => {
  const mappings = accounts.map((a, i) => ({ ...a, ad_id: String(i + 1), ad_name: `Ad brand ${i + 1}`, brand_id: i + 1,
    auto_mapping: parseAdMapping('[skin][disc]'), overrides: {}, creative_id: null, landing_page_urls: [], source: 'inventory', first_seen_at: '', last_seen_at: '', revision: 1, cep_keys: [], intention_key: 'disc' }));
  const inventory = { ready: true, mappings, accounts, taxonomy: { brands, catalog: brands.map(b => ({ brand_id: b.id, key: `b${b.id}.secret`, label: b.name })), rules: [] }, verified: [], destinations: [] };
  let viewerScope = ctx;
  const svc = database({ meta_ad_report_versions: [{ workspace_id: 'w', revision: 1 }], meta_ad_mapping_sync_state: accounts.map(a => ({ ...a, ads_count: 9 })), meta_ad_mapping_units: [] });
  const api = module('meta-ad-mapping-actions', {
    './meta-report-context': { reportingAccess: async () => viewerScope },
    './service-supabase': { createServiceSupabase: () => svc },
    './meta-worklist-data': { getMetaWorklistInventory: async () => inventory, getMetaWorklistActivity: async () => ({ ready: true, rows: accounts.map((a, i) => ({ ...a, ad_id: String(i + 1), spend: 100, impressions: 5, last_active: null })) }) },
  });
  const status = await api.getMetaAdMappingStatus(['00000000-0000-4000-8000-000000000001']);
  assert.equal(status.trackedJobs, null, 'Advertisers must not read global sync trees even with a supplied job ID');
  assert.deepEqual(status.jobs, []); assert.equal(status.pendingJobs, 0);
  assert.deepEqual(status.state.map((r: any) => r.account_id), ['act_1', 'act_2']);
  const input = { from: '2026-10-01', to: '2026-10-10' };
  const r = await api.getMetaAdWorklist(input);
  assert.equal(r.totalAds, 2); assert.equal(r.scopeSpend, 200); assert.equal(r.activeAds, 2);
  assert.deepEqual(r.brands.map((b: any) => b.id), [1, 2]); assert.equal(r.state.length, 2);
  assert.ok(!JSON.stringify(r).includes('Brand 3')); assert.ok(!JSON.stringify(r).includes('act_3'));
  await assert.rejects(api.getMetaAdWorklist({ ...input, accountId: 'act_3' }), /Akun tidak tersedia/);
  viewerScope = { ...ctx, brandIds: [], accountIds: [], accessKey: 'empty' };
  const empty = await api.getMetaAdWorklist(input);
  assert.equal(empty.totalAds, 0); assert.equal(empty.activeSpend, 0); assert.deepEqual(empty.accounts, []);
  assert.equal(inventory.mappings.length, 3, 'Filtering must not mutate the shared cache');
});
test('advertiser cannot read global precomputed alerts or mutate global configuration', async () => {
  const api = module('meta-funnel-actions', { './meta-report-context': { reportingAccess: async () => ctx } });
  assert.deepEqual(await api.getMetaFunnelNotifications(), { schemaReady: true, alerts: [] });
  assert.equal(await api.getMetaFunnelNotificationCount(), 0);
  await assert.rejects(api.markMetaFunnelAlertRead('anything'), /tidak tersedia/);
});

test('owner action uses authenticated RPC, rejects workspace switches and validates assignments', async () => {
  const calls: unknown[] = [];
  const api = module('advertiser-brand-actions', {
    './dashboard-access': { requireDashboardRoles: async (roles: string[]) => { assert.deepEqual(roles, ['owner']); return { workspaceId: 'w' }; } },
    './supabase-server': { createServerSupabase: () => ({ rpc: async (...args: unknown[]) => { calls.push(args); return { error: null }; } }) },
  });
  await api.saveAdvertiserBrandAssignments('viewer', [2, 1, 2], 'w');
  assert.deepEqual(calls, [['set_workspace_advertiser_brands', { p_workspace_id: 'w', p_user_id: 'viewer', p_brand_ids: [1, 2] }]]);
  await assert.rejects(api.saveAdvertiserBrandAssignments('viewer', [1], 'foreign'), /Workspace berubah/);
  await assert.rejects(api.saveAdvertiserBrandAssignments('viewer', [NaN], 'w'), /tidak valid/);
  assert.equal(calls.length, 1);
});

test('overview RPC and pending cache keys include exact authorized brands, including empty access', async () => {
  const keys: string[] = [], calls: any[] = [];
  const processState = globalThis as typeof globalThis & { metaReportRequests?: unknown };
  const previousRequests = processState.metaReportRequests;
  processState.metaReportRequests = { run: async (key: string, fn: () => unknown) => { keys.push(key); return fn(); } };
  const api = module('meta-ad-report-data', {
    'next/cache': { unstable_cache: (fn: unknown) => fn },
    './meta-report-requests': { createMetaReportRequests: () => ({ run: async (key: string, fn: () => unknown) => { keys.push(key); return fn(); } }) },
    './service-supabase': { createServiceSupabase: () => ({ ...database({ meta_ad_intention_catalog: [] }), rpc: async (...args: any[]) => { calls.push(args); return { data: {}, error: null }; } }) },
  });
  try {
    for (const ids of [null, [1], [2], []]) await api.getCachedMetaBrandOverviewReport('w', '1', '2026-01-01', '2026-01-02', {}, ids);
  } finally { processState.metaReportRequests = previousRequests; }
  assert.equal(new Set(keys).size, 4);
  assert.equal(calls[0][0], 'get_meta_brand_overview_report');
  assert.deepEqual(calls.slice(1).map(c => c[1].p_brand_ids), [[1], [2], []]);
});

test('client session revalidates assignments on focus, revocation and workspace switch before showing cache', async () => {
  const { create, act } = createRequire(import.meta.url)('react-test-renderer');
  const tick = () => new Promise<void>(r => setImmediate(r));
  let workspace = 'w'; let resolve!: (v: any) => void;
  let focus!: () => void; let poll!: () => void; let state: any;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: (_: string, fn: () => void) => { focus = fn; }, removeEventListener: () => {},
    setInterval: (fn: () => void) => { poll = fn; return 1; }, clearInterval: () => {},
  } });
  const supabase = { auth: { getSession: async () => ({ data: { session: { user: { id: 'viewer' } } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
  const api = module('useMetaCachedLoad', {
    './supabase-browser': { useSupabase: () => supabase },
    './WorkspaceContext': { useWorkspace: () => ({ activeWorkspace: { id: workspace }, switching: false }) },
    './PermissionsContext': { usePermissions: () => ({ role: 'advertiser', permissions: ['tab:meta-funnels'] }) },
    './meta-funnel-actions': { getMetaViewerScope: () => new Promise(r => { resolve = r; }) },
  });
  function Probe() { state = api.useMetaReportSession(); return null; }
  let root: any;
  try {
    await act(async () => { root = create(React.createElement(Probe)); await tick(); });
    assert.equal(state.key, null);
    await act(async () => { resolve({ workspaceId: 'w', accessKey: 'brand1', brandIds: [1] }); await tick(); });
    const firstKey = state.key; assert.ok(firstKey.includes('brand1'));
    await act(async () => { focus(); await tick(); });
    assert.equal(state.key, null, 'Focus must hide cached data until authorized');
    await act(async () => { resolve({ workspaceId: 'w', accessKey: 'brand2', brandIds: [2] }); await tick(); });
    assert.notEqual(state.key, firstKey);
    await act(async () => { poll(); resolve({ workspaceId: 'w', accessKey: 'empty', brandIds: [] }); await tick(); });
    assert.equal(state.key, null); assert.match(state.error, /Belum ada brand/);
    await act(async () => { workspace = 'foreign'; root.update(React.createElement(Probe)); await tick(); });
    assert.equal(state.key, null);
    await act(async () => { resolve({ workspaceId: 'w', accessKey: 'brand1', brandIds: [1] }); await tick(); });
    assert.equal(state.key, null); assert.match(state.error, /belum dapat diverifikasi/);
  } finally {
    if (root) await act(async () => root.unmount());
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
