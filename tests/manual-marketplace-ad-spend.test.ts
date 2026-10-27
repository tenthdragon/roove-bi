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

test('input menu appears only with the individual grant', () => {
  const base = new Set(['tab:meta-funnels']);
  assert.deepEqual(buildVisibleTabs('advertiser', base)[0]?.children?.map((tab) => tab.id), ['meta-funnels']);
  const granted = new Set([...base, 'tab:manual-ad-spend']);
  assert.deepEqual(buildVisibleTabs('advertiser', granted)[0]?.children?.map((tab) => tab.id), ['meta-funnels', 'manual-ad-spend']);
  assert.deepEqual(getOrderedAccessibleTabIds('advertiser', granted), ['meta-funnels', 'manual-ad-spend']);
  assert.deepEqual(buildVisibleTabs('advertiser', new Set(['tab:manual-ad-spend']))[0]?.children?.map((tab) => tab.id), ['manual-ad-spend']);
  assert.deepEqual(buildVisibleTabs('admin', new Set(['tab:manual-ad-spend'])), []);
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

function loadActions(stubs: Record<string, unknown>) {
  const source = readFileSync(new URL('../lib/manual-marketplace-ad-spend-actions.ts', import.meta.url), 'utf8');
  const output = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('require', 'exports', output)((name: string) => {
    assert.ok(name in stubs, `Unexpected dependency: ${name}`);
    return stubs[name];
  }, exports);
  return exports as Record<string, (...args: any[]) => Promise<any>>;
}

test('only an advertiser can write and the server pins the active workspace', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  let role = 'advertiser';
  const actions = loadActions({
    './dashboard-access': {
      requireDashboardRoles: async (roles: string[]) => {
        if (!roles.includes(role)) throw new Error('Hanya advertiser');
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
  role = 'owner';
  await assert.rejects(actions.saveManualMarketplaceSpend(entry), /Hanya advertiser/);
  assert.equal(calls.length, 1);
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
