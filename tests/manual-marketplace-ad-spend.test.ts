import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { buildVisibleTabs, getOrderedAccessibleTabIds } from '../lib/dashboard-navigation';
import { isLegacyMarketplaceSpendAfterCutover, selectActiveSheetFallbackRows } from '../lib/manual-marketplace-ad-spend';

test('manual zero suppresses only the matching sheet platform, brand, and date', () => {
  const sheet = [
    { platform: 'shopee_ads' as const, brand_id: 1, date: '2026-10-27', amount: 100 },
    { platform: 'tiktok_ads' as const, brand_id: 1, date: '2026-10-27', amount: 200 },
    { platform: 'shopee_ads' as const, brand_id: 3, date: '2026-10-27', amount: 300 },
    { platform: 'shopee_ads' as const, brand_id: 1, date: '2026-10-26', amount: 400 },
  ];
  const manual = [{ platform: 'shopee_ads' as const, brand_id: 1, spend_date: '2026-10-27', amount: 0 }];
  assert.deepEqual(selectActiveSheetFallbackRows(manual, sheet), sheet.slice(1));
  assert.deepEqual(selectActiveSheetFallbackRows([], sheet), sheet);
});

test('advertiser input menu requires its individual grant; owner/admin/Brand Manager can access it', () => {
  const base = new Set(['tab:meta-funnels']);
  assert.deepEqual(buildVisibleTabs('advertiser', base)[0]?.children?.map((tab) => tab.id), ['meta-funnels']);
  const granted = new Set([...base, 'tab:manual-ad-spend']);
  assert.deepEqual(buildVisibleTabs('advertiser', granted)[0]?.children?.map((tab) => tab.id), ['meta-funnels', 'manual-ad-spend']);
  assert.deepEqual(getOrderedAccessibleTabIds('advertiser', granted), ['meta-funnels', 'manual-ad-spend']);
  assert.deepEqual(buildVisibleTabs('advertiser', new Set(['tab:manual-ad-spend']))[0]?.children?.map((tab) => tab.id), ['manual-ad-spend']);
  assert.deepEqual(buildVisibleTabs('admin', new Set(['tab:manual-ad-spend']))[0]?.children?.map((tab) => tab.id), ['manual-ad-spend']);
  assert.ok(getOrderedAccessibleTabIds('owner', new Set()).includes('manual-ad-spend'));
  assert.deepEqual(buildVisibleTabs('brand_manager', new Set(['tab:manual-ad-spend']))[0]?.children?.map((tab) => tab.id), ['manual-ad-spend']);
  for (const role of ['staf_ops', 'pending', 'marketing_api_reviewer']) {
    assert.equal(getOrderedAccessibleTabIds(role, granted).includes('manual-ad-spend'), false);
  }
});

test('cutover excludes only the intended legacy Shopee and TikTok spend', () => {
  const cutover = '2026-10-01';
  const row = (source: string, date = cutover, data_source = 'google_sheets') => ({ source, date, data_source });
  for (const source of ['Shopee - Roove', 'Shopee Ads', 'TikTok Ads', 'TikTok Shop']) {
    assert.equal(isLegacyMarketplaceSpendAfterCutover(row(source), cutover), true, source);
  }
  assert.equal(isLegacyMarketplaceSpendAfterCutover(row('Shopee Ads', cutover, 'shopee_ads_api'), cutover), true);
  for (const source of ['Facebook CPAS', 'CPAS - Roove', 'Shopee - Roove - Live', 'Facebook Ads', 'Google Ads']) {
    assert.equal(isLegacyMarketplaceSpendAfterCutover(row(source), cutover), false, source);
  }
  assert.equal(isLegacyMarketplaceSpendAfterCutover(row('Shopee Ads', '2026-09-30'), cutover), false);
  assert.equal(isLegacyMarketplaceSpendAfterCutover(row('Shopee Ads', cutover, 'manual_marketplace'), cutover), false);
  assert.equal(isLegacyMarketplaceSpendAfterCutover({ ...row('Shopee Ads', cutover, ''), data_source: null, import_id: 12 }, cutover), true);
  assert.equal(isLegacyMarketplaceSpendAfterCutover({ ...row('Shopee Ads', cutover, ''), data_source: null, import_id: null }, cutover), false);
  assert.equal(isLegacyMarketplaceSpendAfterCutover(row('TikTok Ads'), null), false);
});

function loadActions(stubs: Record<string, unknown>, file = '../lib/manual-marketplace-ad-spend-actions.ts') {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const output = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', output)((name: string) => {
    assert.ok(name in stubs, `Unexpected dependency: ${name}`);
    return stubs[name];
  }, exports);
  return exports as Record<string, (...args: any[]) => Promise<any>>;
}

test('owner/admin/Brand Manager/advertiser can write and delete, with active-workspace and input checks', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  let role = 'advertiser';
  const actions = loadActions({
    './dashboard-access': {
      requireDashboardRoles: async (roles: string[], message: string) => {
        if (!roles.includes(role)) throw new Error(message);
        return { workspaceId: 'workspace-a', profile: { id: 'advertiser-a', role } };
      },
    },
    './service-supabase': { createServiceSupabase: () => { throw new Error('Unexpected service access'); } },
    './supabase-server': { createServerSupabase: () => ({ rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push([name, params]); return { data: 12, error: null };
    } }) },
    './workspaces': { isWorkspaceModuleEnabled: () => true },
    './manual-marketplace-ad-spend': {
      isManualMarketplacePlatform: (value: unknown) => value === 'shopee_ads' || value === 'tiktok_ads',
      MANUAL_MARKETPLACE_PLATFORMS: ['shopee_ads', 'tiktok_ads'],
    },
  });
  const entry = { workspaceId: 'workspace-a', id: null, platform: 'shopee_ads', brandId: 1,
    date: '2026-10-07', amount: 150000, note: '', version: null };
  await actions.saveManualMarketplaceSpend(entry);
  assert.deepEqual(calls, [['save_manual_marketplace_ad_spend', {
    p_workspace_id: 'workspace-a', p_entry_id: null, p_platform: 'shopee_ads', p_brand_id: 1,
    p_spend_date: '2026-10-07', p_amount: 150000, p_note: '', p_expected_version: null,
  }]]);
  await assert.rejects(actions.saveManualMarketplaceSpend({ ...entry, workspaceId: 'workspace-b' }), /Workspace berubah/);
  await assert.rejects(actions.saveManualMarketplaceSpend({ ...entry, platform: 'meta_ads' }), /tidak valid/);
  await assert.rejects(actions.saveManualMarketplaceSpend({ ...entry, amount: -1 }), /tidak valid/);
  for (const allowedRole of ['owner', 'admin', 'brand_manager', 'advertiser']) {
    role = allowedRole;
    await actions.saveManualMarketplaceSpend(entry);
    await actions.saveManualMarketplaceSpend({ ...entry, id: 12, version: 1, amount: 0 });
    await actions.deleteManualMarketplaceSpend({ workspaceId: 'workspace-a', id: 12, version: 2 });
    assert.deepEqual(calls.at(-1), ['delete_manual_marketplace_ad_spend', {
      p_workspace_id: 'workspace-a', p_entry_id: 12, p_expected_version: 2,
    }]);
    await assert.rejects(actions.deleteManualMarketplaceSpend({ workspaceId: 'workspace-b', id: 12, version: 2 }), /Workspace berubah/);
  }
  for (const deniedRole of ['staf_ops', 'pending', 'marketing_api_reviewer']) {
    role = deniedRole;
    await assert.rejects(actions.saveManualMarketplaceSpend(entry), /Hanya owner, admin, Brand Manager, dan advertiser/);
    await assert.rejects(actions.deleteManualMarketplaceSpend({ workspaceId: 'workspace-a', id: 12, version: 2 }), /Hanya owner, admin, Brand Manager, dan advertiser/);
  }
  assert.equal(calls.length, 13);
});

function serviceStub(data: Record<string, unknown>, queries: Array<{ table: string; filters: unknown[][] }>, filterRows = false, errorTables: string[] = []) {
  return { from(table: string) {
    assert.ok(table in data, `Unexpected table: ${table}`);
    const query = { table, filters: [] as unknown[][] };
    queries.push(query);
    const chain: any = {};
    for (const method of ['select', 'eq', 'in', 'gte', 'lte', 'order', 'range', 'limit', 'or']) {
      chain[method] = (...args: unknown[]) => { query.filters.push([method, ...args]); return chain; };
    }
    chain.maybeSingle = () => chain;
    chain.then = (resolve: (result: unknown) => unknown) => {
      let rows = data[table];
      if (filterRows && Array.isArray(rows)) {
        for (const [method, field, value] of query.filters as any[][]) {
          if (method === 'eq') rows = rows.filter(row => row[field] === value);
          if (method === 'in') rows = rows.filter(row => value.includes(row[field]));
          if (method === 'gte') rows = rows.filter(row => row[field] >= value);
          if (method === 'lte') rows = rows.filter(row => row[field] <= value);
          if (method === 'or') {
            const match = String(field).match(/^(before_value|after_value)\.is\.null,\1->>brand_id\.in\.\(([\d,]+)\)$/);
            assert.ok(match, `Unexpected JSON filter: ${field}`);
            const ids = match[2].split(',').map(Number);
            rows = rows.filter(row => row[match[1]] === null || ids.includes(row[match[1]]?.brand_id));
          }
        }
        // Apply the limit/range after all predicates, as the database does.
        for (const [method, from, to] of query.filters as any[][]) {
          if (method === 'limit') rows = rows.slice(0, from);
          if (method === 'range') rows = rows.slice(from, to + 1);
        }
      }
      return Promise.resolve(resolve({ data: rows, error: errorTables.includes(table) ? { message: 'Read failed' } : null }));
    };
    return chain;
  } };
}

test('page enables both platforms for owner/admin/Brand Manager, while advertiser grants and history stay scoped', async () => {
  let role = 'owner';
  let enabled = true;
  const queries: Array<{ table: string; filters: unknown[][] }> = [];
  const data = {
    manual_marketplace_ad_spend_cutovers: { starts_on: '2026-10-01' },
    workspace_advertiser_spend_access: [{ platform: 'shopee_ads' }],
    workspace_advertiser_brands: [{ brand_id: 1 }],
    brands: [{ id: 1, name: 'Brand', is_active: true }],
    manual_marketplace_ad_spend: [{ created_by: 'another-user' }],
    manual_marketplace_ad_spend_audit: [{ changed_by: 'another-user' }],
    manual_marketplace_sheet_fallback: [],
    profiles: [{ id: 'another-user', full_name: 'Creator', email: 'creator@example.test' }],
  };
  const actions = loadActions({
    './dashboard-access': { requireDashboardRoles: async (roles: string[], message: string) => {
      if (!roles.includes(role)) throw new Error(message);
      return { workspaceId: 'workspace-a', workspace: {}, profile: { id: 'viewer', role } };
    } },
    './service-supabase': { createServiceSupabase: () => serviceStub(data, queries) },
    './supabase-server': {},
    './workspaces': { isWorkspaceModuleEnabled: () => enabled },
    './manual-marketplace-ad-spend': {
      isManualMarketplacePlatform: (value: unknown) => value === 'shopee_ads' || value === 'tiktok_ads',
      MANUAL_MARKETPLACE_PLATFORMS: ['shopee_ads', 'tiktok_ads'],
    },
  });
  for (const privilegedRole of ['owner', 'admin', 'brand_manager']) {
    role = privilegedRole; queries.length = 0;
    const page = await actions.getManualMarketplaceSpendPage('2026-10');
    assert.equal(page.canInput, true);
    assert.deepEqual(page.platforms, ['shopee_ads', 'tiktok_ads']);
    assert.deepEqual(page.actorNames, { 'another-user': 'Creator' });
    assert.equal(queries.some(q => q.table === 'workspace_advertiser_spend_access'), false);
    assert.equal(queries.some(q => q.table === 'workspace_advertiser_brands'), false);
    assert.equal(queries.find(q => q.table === 'manual_marketplace_ad_spend_audit')?.filters.some(f => f[1] === 'changed_by'), false);
  }
  role = 'advertiser'; queries.length = 0;
  const page = await actions.getManualMarketplaceSpendPage('2026-10');
  assert.equal(page.canInput, true);
  assert.deepEqual(page.platforms, ['shopee_ads']);
  assert.deepEqual(page.actorNames, {});
  for (const query of queries) assert.ok(query.filters.some(f => f[0] === 'eq' && f[1] === 'workspace_id' && f[2] === 'workspace-a'));
  assert.ok(queries.find(q => q.table === 'manual_marketplace_ad_spend_audit')?.filters.some(f => f[1] === 'changed_by' && f[2] === 'viewer'));
  for (const [table, field] of [['brands', 'id'], ['manual_marketplace_ad_spend', 'brand_id'], ['manual_marketplace_sheet_fallback', 'brand_id']]) {
    assert.ok(queries.find(q => q.table === table)?.filters.some(f => f[0] === 'in' && f[1] === field && JSON.stringify(f[2]) === '[1]'));
  }
  data.workspace_advertiser_brands = [];
  await assert.rejects(actions.getManualMarketplaceSpendPage('2026-10'), /Belum ada brand yang ditugaskan/);
  data.workspace_advertiser_brands = [{ brand_id: 1 }];
  data.workspace_advertiser_spend_access = [];
  await assert.rejects(actions.getManualMarketplaceSpendPage('2026-10'), /belum diberi akses/);
  role = 'staf_ops';
  await assert.rejects(actions.getManualMarketplaceSpendPage('2026-10'), /hanya tersedia/);
  role = 'admin'; enabled = false;
  await assert.rejects(actions.getManualMarketplaceSpendPage('2026-10'), /tidak diaktifkan/);
});

test('assigned brands scope both platforms, sheet totals and both audit snapshots; revocation fails closed', async () => {
  let role = 'advertiser';
  const queries: Array<{ table: string; filters: unknown[][] }> = [];
  const errorTables: string[] = [];
  const row = (brand_id: number, platform = 'shopee_ads', workspace_id = 'workspace-a') => ({
    workspace_id, brand_id, platform, spend_date: '2026-10-07', date: '2026-10-07', spent: 100, amount: 200, created_by: 'viewer',
  });
  const audit = (id: number, before: number | null, after: number | null, changed_by = 'viewer', workspace_id = 'workspace-a') => ({
    id, workspace_id, changed_by, platform: 'shopee_ads',
    before_value: before === null ? null : { brand_id: before, amount: 100 },
    after_value: after === null ? null : { brand_id: after, amount: 200 },
  });
  const data: Record<string, any> = {
    manual_marketplace_ad_spend_cutovers: { starts_on: '2026-10-01' },
    workspace_advertiser_spend_access: [
      { workspace_id: 'workspace-a', user_id: 'viewer', platform: 'shopee_ads' },
      { workspace_id: 'workspace-a', user_id: 'viewer', platform: 'tiktok_ads' },
    ],
    workspace_advertiser_brands: [
      { workspace_id: 'workspace-a', user_id: 'viewer', brand_id: 1 },
      { workspace_id: 'workspace-a', user_id: 'viewer', brand_id: 3 },
      { workspace_id: 'workspace-a', user_id: 'someone-else', brand_id: 2 },
      { workspace_id: 'workspace-b', user_id: 'viewer', brand_id: 2 },
    ],
    brands: [
      { id: 1, name: 'Osgard', workspace_id: 'workspace-a', is_active: true },
      { id: 2, name: 'Other brand', workspace_id: 'workspace-a', is_active: true },
      { id: 3, name: 'Inactive assigned brand', workspace_id: 'workspace-a', is_active: false },
      { id: 4, name: 'Other workspace brand', workspace_id: 'workspace-b', is_active: true },
    ],
    manual_marketplace_ad_spend: [row(1), row(1, 'tiktok_ads'), row(2), row(2, 'tiktok_ads'), row(3), row(1, 'shopee_ads', 'workspace-b')],
    manual_marketplace_sheet_fallback: [row(1), row(1, 'tiktok_ads'), row(2), row(2, 'tiktok_ads'), row(3), row(1, 'shopee_ads', 'workspace-b')],
    manual_marketplace_ad_spend_audit: [
      ...Array.from({ length: 55 }, (_, index) => audit(100 + index, 2, 2)),
      audit(1, null, 1), audit(2, 1, 2), audit(3, 2, 1), audit(4, 2, null),
      audit(5, 1, null), audit(6, 1, 3), audit(7, 1, 1, 'someone-else'), audit(8, 1, 1, 'viewer', 'workspace-b'),
    ],
    profiles: [{ id: 'viewer', full_name: 'Viewer' }, { id: 'someone-else', full_name: 'Other user' }],
  };
  const actions = loadActions({
    './dashboard-access': { requireDashboardRoles: async () => ({ workspaceId: 'workspace-a', workspace: {}, profile: { id: 'viewer', role } }) },
    './service-supabase': { createServiceSupabase: () => serviceStub(data, queries, true, errorTables) },
    './supabase-server': {},
    './workspaces': { isWorkspaceModuleEnabled: () => true },
    './manual-marketplace-ad-spend': {
      isManualMarketplacePlatform: (value: unknown) => value === 'shopee_ads' || value === 'tiktok_ads',
      MANUAL_MARKETPLACE_PLATFORMS: ['shopee_ads', 'tiktok_ads'],
    },
  });
  const page = await actions.getManualMarketplaceSpendPage('2026-10');
  assert.deepEqual(page.brands.map((b: any) => b.id), [1, 3]);
  assert.deepEqual(page.entries.map((e: any) => [e.platform, e.brand_id]), [['shopee_ads', 1], ['tiktok_ads', 1], ['shopee_ads', 3]]);
  assert.deepEqual(page.fallbackRows.map((e: any) => [e.platform, e.brand_id]), [['shopee_ads', 1], ['tiktok_ads', 1], ['shopee_ads', 3]]);
  assert.deepEqual(page.history.map((h: any) => h.id), [1, 5, 6]);
  assert.deepEqual(page.actorNames, {});
  const historyFilters = queries.find(q => q.table === 'manual_marketplace_ad_spend_audit')!.filters;
  assert.deepEqual(historyFilters.filter(f => f[0] === 'or').map(f => f[1]), [
    'before_value.is.null,before_value->>brand_id.in.(1,3)',
    'after_value.is.null,after_value->>brand_id.in.(1,3)',
  ]);

  // The next request must immediately respect revoked brand 3 and hide the
  // history that moved between brand 1 and that now-inaccessible brand.
  data.workspace_advertiser_brands = data.workspace_advertiser_brands.filter((g: any) => g.brand_id !== 3);
  const revoked = await actions.getManualMarketplaceSpendPage('2026-10');
  assert.deepEqual(revoked.brands.map((b: any) => b.id), [1]);
  assert.ok(revoked.entries.every((e: any) => e.brand_id === 1));
  assert.ok(revoked.fallbackRows.every((e: any) => e.brand_id === 1));
  assert.deepEqual(revoked.history.map((h: any) => h.id), [1, 5]);

  errorTables.push('workspace_advertiser_brands'); queries.length = 0;
  await assert.rejects(actions.getManualMarketplaceSpendPage('2026-10'), /Gagal memverifikasi/);
  assert.equal(queries.some(q => ['brands', 'manual_marketplace_ad_spend', 'manual_marketplace_sheet_fallback', 'manual_marketplace_ad_spend_audit'].includes(q.table)), false);
  errorTables.length = 0; data.workspace_advertiser_brands = []; queries.length = 0;
  await assert.rejects(actions.getManualMarketplaceSpendPage('2026-10'), /Belum ada brand/);
  assert.equal(queries.some(q => q.table === 'manual_marketplace_ad_spend'), false);

  for (role of ['owner', 'admin', 'brand_manager']) {
    const privileged = await actions.getManualMarketplaceSpendPage('2026-10');
    assert.deepEqual(privileged.brands.map((b: any) => b.id), [1, 2, 3]);
    assert.equal(privileged.entries.length, 5);
    assert.equal(privileged.fallbackRows.length, 5);
    assert.equal(privileged.history.length, 50);
  }
});

test('profile grants admin/Brand Manager navigation only in enabled workspaces and uses the active membership role', async () => {
  for (const [profileRole, membershipRole, enabled, granted, expected] of [
    ['admin', 'admin', true, false, true],
    ['brand_manager', 'brand_manager', true, false, true],
    ['brand_manager', 'brand_manager', false, false, false],
    ['advertiser', 'brand_manager', true, false, true],
    ['brand_manager', 'advertiser', true, false, false],
    ['brand_manager', 'staf_ops', true, true, false],
    ['admin', 'admin', false, false, false],
    ['advertiser', 'admin', true, false, true],
    ['admin', 'advertiser', true, false, false],
    ['advertiser', 'advertiser', true, true, true],
    ['advertiser', 'advertiser', false, true, false],
    ['staf_ops', 'staf_ops', true, true, false],
  ] as const) {
    const queries: Array<{ table: string; filters: unknown[][] }> = [];
    const service = serviceStub({
      profiles: { id: 'viewer', role: profileRole },
      manual_marketplace_ad_spend_cutovers: enabled ? { workspace_id: 'workspace-a' } : null,
      workspace_role_permissions: [],
      workspace_advertiser_spend_access: granted ? [{ platform: 'shopee_ads' }] : [],
    }, queries);
    const route = loadActions({
      'next/server': { NextResponse: { json: (body: unknown) => body } },
      '@/lib/supabase-server': {
        createServerSupabase: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'viewer' } } }) } }),
        createServiceSupabase: () => service,
      },
      '@/lib/theme-preference': {},
      '@/lib/manual-marketplace-cutover': { isMissingManualMarketplaceSchema: () => false },
      '@/lib/workspace-access': { getWorkspaceBootstrapForVerifiedProfile: async () => ({
        activeWorkspace: { id: 'workspace-a', membershipRole },
      }) },
    }, '../app/api/auth/profile/route.ts');
    const result = await route.GET();
    assert.equal(result.permissions.includes('tab:manual-ad-spend'), expected, `${profileRole}/${membershipRole}/${enabled}/${granted}`);
    if (['admin', 'brand_manager'].includes(membershipRole)) assert.equal(queries.some(q => q.table === 'workspace_advertiser_spend_access'), false);
  }
});

test('owner grant action accepts only the two platforms in the current workspace', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const actions = loadActions({
    './dashboard-access': { requireDashboardRoles: async (roles: string[]) => {
      assert.deepEqual(roles, ['owner']); return { workspaceId: 'workspace-a', profile: { role: 'owner' } };
    } },
    './service-supabase': { createServiceSupabase: () => { throw new Error('Unexpected service access'); } },
    './supabase-server': { createServerSupabase: () => ({ rpc: async (name: string, params: Record<string, unknown>) => {
      calls.push([name, params]); return { data: ['shopee_ads', 'tiktok_ads'], error: null };
    } }) },
    './workspaces': { isWorkspaceModuleEnabled: () => true },
    './manual-marketplace-ad-spend': {
      isManualMarketplacePlatform: (value: unknown) => value === 'shopee_ads' || value === 'tiktok_ads',
      MANUAL_MARKETPLACE_PLATFORMS: ['shopee_ads', 'tiktok_ads'],
    },
  });
  await actions.saveAdvertiserSpendAccess('advertiser-a', ['tiktok_ads', 'shopee_ads'], 'workspace-a');
  assert.deepEqual(calls, [['set_workspace_advertiser_spend_access', {
    p_workspace_id: 'workspace-a', p_user_id: 'advertiser-a', p_platforms: ['shopee_ads', 'tiktok_ads'],
  }]]);
  await assert.rejects(actions.saveAdvertiserSpendAccess('advertiser-a', ['shopee_ads'], 'workspace-b'), /Workspace berubah/);
  await assert.rejects(actions.saveAdvertiserSpendAccess('advertiser-a', ['meta_ads'], 'workspace-a'), /tidak valid/);
  assert.equal(calls.length, 1);
});
