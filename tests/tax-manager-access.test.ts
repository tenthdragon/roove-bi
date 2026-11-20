import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ModuleKind, transpileModule } from 'typescript';
import { MATRIX_ROLES, canAccessTab } from '../lib/utils';
import { buildVisibleTabs, getOrderedAccessibleTabIds, getTabPath } from '../lib/dashboard-navigation';
import { dashboardTabPermissionKeys } from '../lib/dashboard-permissions';
import { isWorkspaceModuleEnabled } from '../lib/workspaces';

const taxPermissions = new Set(['tab:tax-withholding']);
function loadModule(path: string, imports: Record<string, unknown>): any {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } });
  const exports = {};
  new Function('require', 'exports', outputText)((name: string) => {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return imports[name];
  }, exports);
  return exports;
}

test('Tax Manager is assignable and lands on Bukti Potong without other finance or admin pages', () => {
  assert.ok(MATRIX_ROLES.some(role => role.id === 'tax_manager' && role.label === 'Tax Manager'));
  assert.deepEqual(getOrderedAccessibleTabIds('tax_manager', taxPermissions), ['tax-withholding']);
  assert.equal(getTabPath('tax-withholding'), '/dashboard/tax-withholding');
  const visible = buildVisibleTabs('tax_manager', taxPermissions);
  assert.deepEqual(visible.flatMap(tab => tab.children?.map(child => child.id) ?? []), ['tax-withholding']);
  for (const tab of ['overview', 'finance', 'financial-report', 'financial-settings', 'cashflow', 'admin', 'warehouse', 'marketing']) {
    assert.equal(canAccessTab('tax_manager', tab, taxPermissions), false, tab);
  }
  assert.deepEqual(getOrderedAccessibleTabIds('tax_manager', new Set()), []);
});

test('server uses the active workspace Tax Manager role and requires its current page permission', async () => {
  const keys = new Set(taxPermissions);
  const workspace = { id: 'alpha', membershipRole: 'tax_manager', settings: { disabled_modules: [] as string[] } };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: 'member' } } }) },
    from(table: string) {
      const filters: Record<string, any> = {};
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        in(key: string, value: unknown) { filters[key] = value; return query; },
        async single() { assert.equal(table, 'profiles'); return { data: { id: 'member', role: 'staf_finance' } }; },
        async limit() {
          assert.equal(table, 'workspace_role_permissions');
          assert.equal(filters.workspace_id, 'alpha');
          assert.equal(filters.role, 'tax_manager');
          return { data: filters.permission_key.filter((key: string) => keys.has(key)).map((permission_key: string) => ({ permission_key })) };
        },
      };
      return query;
    },
  };
  const guards = loadModule('../lib/dashboard-access.ts', {
    './supabase-server': { createServerSupabase: () => supabase },
    './dashboard-permissions': { dashboardTabPermissionKeys },
    './advertiser-parser-access': {},
    './workspace-access': { getWorkspaceBootstrapForVerifiedProfile: async () => ({ activeWorkspace: workspace, isPlatformOwner: false }) },
    './workspaces': { isWorkspaceModuleEnabled },
  });
  const context = await guards.requireDashboardTabAccess('tax-withholding');
  assert.equal(context.profile.role, 'tax_manager');
  assert.equal(context.workspaceId, 'alpha');
  for (const tab of ['overview', 'financial-report', 'financial-settings', 'admin', 'warehouse']) {
    await assert.rejects(guards.requireDashboardTabAccess(tab), /tidak memiliki akses/);
  }
  await assert.rejects(guards.requireDashboardRoles(['owner'], 'Owner only'), /Owner only/);
  keys.clear();
  await assert.rejects(guards.requireDashboardTabAccess('tax-withholding'), /tidak memiliki akses/);
  keys.add('tab:tax-withholding');
  workspace.settings.disabled_modules = ['tax-withholding'];
  await assert.rejects(guards.requireDashboardTabAccess('tax-withholding'), /tidak diaktifkan/);
});

test('invite API accepts Tax Manager while retaining owner authorization and workspace scoping', async () => {
  let allowed = true;
  const calls: unknown[] = [];
  const svc = { from(table: string) {
    const query = {
      select() { return query; }, eq() { return query; },
      async maybeSingle() { return { data: table === 'workspaces' ? { id: 'alpha', name: 'Alpha' } : { id: 'pending-member' } }; },
    };
    return query;
  } };
  const route = loadModule('../app/api/invite/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown, options?: { status: number }) => ({ body, status: options?.status ?? 200 }) } },
    '@supabase/supabase-js': { createClient: () => svc },
    '@/lib/request-hardening': { limitByIp: () => null, rejectMissingDashboardSession: () => null, rejectUntrustedOrigin: () => null },
    '@/lib/site-config': { buildPublicSiteUrl: () => 'https://example.test/reset-password' },
    '@/lib/dashboard-access': { requireDashboardRoles: async (roles: string[]) => {
      assert.deepEqual(roles, ['owner']);
      if (!allowed) throw new Error('Owner only');
      return { workspaceId: 'alpha', isPlatformOwner: false };
    } },
    '@/lib/supabase-server': { createServerSupabase: () => ({ rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { error: null }; } }) },
  });
  const request = (role = 'tax_manager', workspaceId = 'alpha') => ({ json: async () => ({ email: 'tax@example.test', role, workspaceId }) });
  assert.equal((await route.POST(request())).status, 200);
  assert.deepEqual(calls, [{ name: 'manage_workspace_user_access', args: { p_workspace_id: 'alpha', p_user_id: 'pending-member', p_action: 'invite', p_role: 'tax_manager' } }]);
  assert.equal((await route.POST(request('made_up_role'))).status, 400);
  assert.equal((await route.POST(request('tax_manager', 'beta'))).status, 403);
  allowed = false;
  assert.notEqual((await route.POST(request())).status, 200);
  assert.equal(calls.length, 1);
});
