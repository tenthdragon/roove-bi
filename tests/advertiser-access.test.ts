import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transpileModule, ModuleKind } from 'typescript';
import { ALL_TABS, canAccessTab, MATRIX_ROLES, PERMISSION_GROUPS } from '../lib/utils';
import { buildVisibleTabs, getCurrentTab, getOrderedAccessibleTabIds, getTabPath } from '../lib/dashboard-navigation';
import { isWorkspaceModuleEnabled } from '../lib/workspaces';
import { dashboardTabPermissionKeys } from '../lib/dashboard-permissions';

const advertiserPermissions = new Set(['tab:meta-funnels']);

test('advertiser can land directly on Meta Ads and sees only its sidebar group', () => {
  const accessible = getOrderedAccessibleTabIds('advertiser', advertiserPermissions);
  assert.deepEqual(accessible, ['meta-funnels']);
  assert.equal(getTabPath(accessible[0]), '/dashboard/meta-funnels');
  const visible = buildVisibleTabs('advertiser', advertiserPermissions);
  assert.deepEqual(visible.map(tab => tab?.id), ['marketing']);
  assert.deepEqual(visible[0]?.children?.map(tab => tab.id), ['meta-funnels']);
  for (const path of ['/dashboard/meta-funnels', '/dashboard/meta-funnels/brand/1', '/dashboard/meta-funnels/templates', '/dashboard/meta-funnels/mapping', '/dashboard/meta-funnels/categories', '/dashboard/meta-funnels/notifications']) {
    assert.ok(accessible.includes(getCurrentTab(path)), path);
  }
  for (const path of ['/dashboard', '/dashboard/marketing', '/dashboard/admin', '/dashboard/financial-report', '/dashboard/warehouse']) {
    assert.ok(!accessible.includes(getCurrentTab(path)), path);
  }
});

test('parent Marketing Channel grants retain Meta Ads access without granting it in reverse', () => {
  assert.equal(canAccessTab('brand_manager', 'meta-funnels', new Set(['tab:marketing'])), true);
  assert.equal(canAccessTab('advertiser', 'marketing', advertiserPermissions), false);
  assert.deepEqual(getOrderedAccessibleTabIds('marketing_api_reviewer', new Set(['admin:meta'])), ['admin']);
  assert.deepEqual(getOrderedAccessibleTabIds('pending', advertiserPermissions), []);
  for (const tab of ALL_TABS) assert.equal(canAccessTab('owner', tab.id, new Set()), true);
});

test('advertiser and its separate page permission are available to admin role controls', () => {
  assert.ok(MATRIX_ROLES.some(role => role.id === 'advertiser'));
  assert.ok(PERMISSION_GROUPS.some(group => group.keys.some(permission => permission.key === 'tab:meta-funnels')));
});

// Execute the actual server guards with session/database boundaries stubbed.
// This catches accidental changes that would grant the parent or admin actions.
function loadServerModule(file: string, imports: Record<string, unknown>): any {
  const source = readFileSync(new URL(`../lib/${file}.ts`, import.meta.url), 'utf8');
  const { outputText } = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } });
  const exports = {};
  new Function('require', 'exports', outputText)((name: string) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  }, exports);
  return exports;
}

function serverAccess(role = 'advertiser', keys = advertiserPermissions, disabled_modules: string[] = []) {
  const workspace = { id: 'workspace-a', membershipRole: role, settings: { disabled_modules } };
  const checkedScopes: Record<string, unknown>[] = [];
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-a' } } }) },
    from(table: string) {
      const scope: Record<string, unknown> = {};
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { scope[key] = value; return query; },
        in(key: string, value: string[]) { scope[key] = value; return query; },
        async single() { assert.equal(table, 'profiles'); return { data: { id: 'user-a', role, active_workspace_id: workspace.id } }; },
        async limit() {
          assert.equal(table, 'workspace_role_permissions');
          checkedScopes.push(scope);
          const requested = scope.permission_key as string[];
          return { data: scope.workspace_id === workspace.id && scope.role === role
            ? requested.filter(key => keys.has(key)).map(permission_key => ({ permission_key })) : [] };
        },
      };
      return query;
    },
  };
  const guards = loadServerModule('dashboard-access', {
    './supabase-server': { createServerSupabase: () => supabase },
    './dashboard-permissions': { dashboardTabPermissionKeys },
    './workspace-access': { getWorkspaceBootstrapForVerifiedProfile: async () => ({ activeWorkspace: workspace, isPlatformOwner: false }) },
    './workspaces': { isWorkspaceModuleEnabled },
  });
  return { guards, checkedScopes };
}

test('server permits Meta Ads reads but rejects direct parent, finance, admin and management access', async () => {
  const { guards, checkedScopes } = serverAccess();
  assert.equal((await guards.requireDashboardTabAccess('meta-funnels')).workspaceId, 'workspace-a');
  assert.equal((await guards.requireAnyDashboardTabAccess(['meta-funnels'], 'Meta Ads')).workspaceId, 'workspace-a');
  for (const tab of ['marketing', 'overview', 'financial-report', 'warehouse', 'admin']) {
    await assert.rejects(guards.requireDashboardTabAccess(tab), /tidak memiliki akses/);
  }
  await assert.rejects(guards.requireDashboardPermissionAccess('admin:meta'), /tidak memiliki izin/);
  await assert.rejects(guards.requireDashboardRoles(['owner'], 'Owner only'), /Owner only/);
  assert.ok(checkedScopes.every(scope => scope.workspace_id === 'workspace-a' && scope.role === 'advertiser'));
});

test('Meta Ads server entry point respects disabled modules and retains legacy marketing access', async () => {
  for (const disabled of [[], ['marketing'], ['meta-funnels']]) {
    const { guards } = serverAccess('advertiser', advertiserPermissions, disabled);
    const report = loadServerModule('meta-report-context', {
      './dashboard-access': guards,
      './workspaces': { isWorkspaceModuleEnabled },
      './meta-template-scope': {},
      './meta-brand-access': { loadMetaBrandScope: async () => ({ brandIds: [1], accountIds: ['act_1'], accessKey: '1' }) },
      ...Object.fromEntries(['./service-supabase', './meta-funnel-domain', './meta-funnel-store', './sync-schedule', './meta-ad-channels', './meta-ad-dimensions', './meta-ad-brands', './meta-report-status', './meta-funnel-sync-status'].map(name => [name, {}])),
    });
    if (disabled.length) {
      await assert.rejects(report.reportingAccess(), /tidak diaktifkan/);
    } else {
      assert.equal((await report.reportingAccess()).profile.role, 'advertiser');
      await assert.rejects(report.manageAccess(), /pengelola workspace/);
    }
  }
  const { guards } = serverAccess('brand_manager', new Set(['tab:marketing']));
  assert.equal((await guards.requireDashboardTabAccess('meta-funnels')).profile.role, 'brand_manager');
  const revoked = serverAccess('advertiser', new Set()).guards;
  await assert.rejects(revoked.requireDashboardTabAccess('meta-funnels'), /tidak memiliki akses/);
});
