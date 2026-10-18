import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { matchesCronBearer } from '../lib/cron-auth';
import {
  canRoleAccessPermission,
  fixedPermissionsForRole,
  isPermissionAllowedForRole,
  LEGACY_MARKETING_API_REVIEWER_ROLE,
  normalizeAssignableWorkspaceRole,
  profileCompatibilityRoleForWorkspaceRole,
  SHOPEE_REVIEWER_PERMISSION_KEYS,
  SHOPEE_REVIEWER_ROLE,
  workspaceRoleLabel,
} from '../lib/role-access';
import { canAccessTab, PERMISSION_GROUPS } from '../lib/utils';

const reviewerPermissions = new Set<string>([
  ...SHOPEE_REVIEWER_PERMISSION_KEYS,
  // Simulate erroneous matrix rows. The hard cap must ignore them.
  'tab:marketing',
  'admin:meta',
  'tab:overview',
]);

test('Shopee reviewer contract contains only its page and admin panel', () => {
  assert.deepEqual(fixedPermissionsForRole(SHOPEE_REVIEWER_ROLE), [
    'tab:shopee-details',
    'admin:shopee',
  ]);
  assert.equal(fixedPermissionsForRole('admin'), null);
});

test('Shopee reviewer hard cap rejects unrelated matrix rows', () => {
  assert.equal(isPermissionAllowedForRole(SHOPEE_REVIEWER_ROLE, 'tab:shopee-details'), true);
  assert.equal(isPermissionAllowedForRole(SHOPEE_REVIEWER_ROLE, 'admin:shopee'), true);
  assert.equal(isPermissionAllowedForRole(SHOPEE_REVIEWER_ROLE, 'tab:marketing'), false);
  assert.equal(isPermissionAllowedForRole(SHOPEE_REVIEWER_ROLE, 'admin:meta'), false);
  assert.equal(canRoleAccessPermission(SHOPEE_REVIEWER_ROLE, reviewerPermissions, 'tab:overview'), false);
  assert.equal(canRoleAccessPermission(SHOPEE_REVIEWER_ROLE, reviewerPermissions, 'admin:meta'), false);
});

test('Shopee reviewer hard cap covers the complete permission catalog', () => {
  const allPermissionKeys = PERMISSION_GROUPS.flatMap((group) =>
    group.keys.map((permission) => permission.key),
  );
  const allPermissions = new Set(allPermissionKeys);

  for (const permissionKey of allPermissionKeys) {
    assert.equal(
      canRoleAccessPermission(SHOPEE_REVIEWER_ROLE, allPermissions, permissionKey),
      SHOPEE_REVIEWER_PERMISSION_KEYS.includes(permissionKey as any),
      permissionKey,
    );
  }
});

test('legacy Marketing API reviewer is denied even with stale matrix rows', () => {
  assert.equal(
    canRoleAccessPermission(
      LEGACY_MARKETING_API_REVIEWER_ROLE,
      new Set(['admin:meta', 'admin:shopee', 'tab:marketing', 'tab:shopee-details']),
      'admin:meta',
    ),
    false,
  );
  assert.equal(
    isPermissionAllowedForRole(LEGACY_MARKETING_API_REVIEWER_ROLE, 'tab:shopee-details'),
    false,
  );
});

test('Shopee reviewer can open Shopee Details but not its Marketing parent', () => {
  assert.equal(canAccessTab(SHOPEE_REVIEWER_ROLE, 'shopee-details', reviewerPermissions), true);
  assert.equal(canAccessTab(SHOPEE_REVIEWER_ROLE, 'marketing', reviewerPermissions), false);
  assert.equal(canRoleAccessPermission(SHOPEE_REVIEWER_ROLE, reviewerPermissions, 'admin:shopee'), true);
  assert.equal(canRoleAccessPermission('owner', new Set(), 'admin:meta'), true);
});

test('cron authentication never accepts Bearer undefined or an empty secret', () => {
  assert.equal(matchesCronBearer('Bearer undefined', undefined), false);
  assert.equal(matchesCronBearer('Bearer ', ''), false);
  assert.equal(matchesCronBearer('Bearer actual-secret', ' actual-secret '), true);
  assert.equal(matchesCronBearer('Bearer wrong-secret', 'actual-secret'), false);
});

test('workspace role assignments are normalized and legacy inputs are rejected', () => {
  assert.equal(normalizeAssignableWorkspaceRole('owner'), 'workspace_owner');
  assert.equal(normalizeAssignableWorkspaceRole(' Shopee_Reviewer '), 'shopee_reviewer');
  assert.equal(normalizeAssignableWorkspaceRole('sales_manager'), 'sales_manager');
  assert.equal(normalizeAssignableWorkspaceRole('pending'), null);
  assert.equal(normalizeAssignableWorkspaceRole('finance'), null);
  assert.equal(normalizeAssignableWorkspaceRole('staff'), null);
  assert.equal(normalizeAssignableWorkspaceRole('made_up_role'), null);
});

test('reviewer invite keeps password setup on the trusted request origin', () => {
  const inviteRoute = readFileSync(
    new URL('../app/api/invite/route.ts', import.meta.url),
    'utf8',
  );

  assert.match(inviteRoute, /req\.headers\.get\('origin'\)/);
  assert.match(inviteRoute, /req\.headers\.get\('referer'\)/);
  assert.match(inviteRoute, /new URL\('\/reset-password', requestSiteUrl\)/);
});

test('profile compatibility roles never write unsupported enum values', () => {
  assert.equal(profileCompatibilityRoleForWorkspaceRole('workspace_owner'), 'admin');
  assert.equal(profileCompatibilityRoleForWorkspaceRole('shopee_reviewer'), 'shopee_reviewer');
  assert.equal(profileCompatibilityRoleForWorkspaceRole('sales_manager'), 'sales_manager');
  assert.equal(profileCompatibilityRoleForWorkspaceRole('finance'), 'manager');
  assert.equal(profileCompatibilityRoleForWorkspaceRole('staff'), 'manager');
  assert.equal(workspaceRoleLabel('shopee_reviewer'), 'Shopee Reviewer');
});

test('background sync runners cannot bypass exported Server Action permissions', () => {
  const financialActions = readFileSync(new URL('../lib/financial-actions.ts', import.meta.url), 'utf8');
  const warehouseActions = readFileSync(new URL('../lib/warehouse-actions.ts', import.meta.url), 'utf8');
  const financialRunner = readFileSync(new URL('../lib/financial-sync-runner.ts', import.meta.url), 'utf8');
  const warehouseRunner = readFileSync(new URL('../lib/warehouse-sync-runner.ts', import.meta.url), 'utf8');
  const jobRunners = readFileSync(new URL('../lib/sync-job-runners.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(financialActions, /skipAuth/);
  assert.doesNotMatch(warehouseActions, /skipAuth/);
  assert.match(
    financialActions,
    /export async function triggerFinancialSync\(\)\s*{\s*const { workspaceId } = await requireFinancialAdminAccess/,
  );
  assert.match(
    warehouseActions,
    /export async function triggerWarehouseSync\(\)\s*{\s*const { workspaceId } = await requireWarehouseAdminAccess/,
  );

  assert.doesNotMatch(financialRunner, /['"]use server['"]/);
  assert.doesNotMatch(warehouseRunner, /['"]use server['"]/);
  assert.match(jobRunners, /from '\.\/financial-sync-runner'/);
  assert.match(jobRunners, /from '\.\/warehouse-sync-runner'/);
  assert.doesNotMatch(jobRunners, /from '\.\/(?:financial|warehouse)-actions'/);
});

test('warehouse activity logging is internal and only its gated reader is a Server Action', () => {
  const activityActions = readFileSync(
    new URL('../lib/warehouse-activity-log-actions.ts', import.meta.url),
    'utf8',
  );
  const activityRunner = readFileSync(
    new URL('../lib/warehouse-activity-log-runner.ts', import.meta.url),
    'utf8',
  );
  const callerSources = [
    '../lib/warehouse-ledger-actions.ts',
    '../lib/scalev-catalog-mapping-actions.ts',
    '../lib/scalev-catalog-bundle-actions.ts',
    '../lib/warehouse-domain-actions.ts',
    '../lib/scalev-catalog-actions.ts',
  ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));

  assert.doesNotMatch(activityActions, /recordWarehouseActivityLog/);
  assert.match(activityActions, /export async function getWarehouseActivityLogs/);
  assert.match(activityActions, /requireDashboardTabAccess\('warehouse-settings'/);
  assert.match(activityActions, /requireDashboardPermissionAccess\('whs:mapping'/);

  assert.doesNotMatch(activityRunner, /['"]use server['"]/);
  assert.match(activityRunner, /export async function recordWarehouseActivityLog/);
  for (const source of callerSources) {
    assert.match(source, /warehouse-activity-log-runner/);
    assert.doesNotMatch(source, /warehouse-activity-log-actions/);
  }
});
