export const SHOPEE_REVIEWER_ROLE = 'shopee_reviewer';
export const LEGACY_MARKETING_API_REVIEWER_ROLE = 'marketing_api_reviewer';

export const SHOPEE_REVIEWER_PERMISSION_KEYS = [
  'tab:shopee-details',
  'admin:shopee',
] as const;

const ASSIGNABLE_WORKSPACE_ROLE_SET = new Set<string>([
  'workspace_owner',
  'admin',
  SHOPEE_REVIEWER_ROLE,
  'direktur_ops',
  'staf_ops',
  'direktur_finance',
  'staf_finance',
  'brand_manager',
  'sales_manager',
  'warehouse_manager',
  'ppic_manager',
]);

const PROFILE_ENUM_ROLE_SET = new Set<string>([
  'owner',
  'manager',
  'brand_manager',
  'sales_manager',
  'pending',
  'admin',
  'direktur_operasional',
  'warehouse_manager',
  'ppic',
  'direktur_ops',
  'staf_ops',
  'direktur_finance',
  'staf_finance',
  'ppic_manager',
  LEGACY_MARKETING_API_REVIEWER_ROLE,
  SHOPEE_REVIEWER_ROLE,
]);

const WORKSPACE_ROLE_LABELS: Record<string, string> = {
  workspace_owner: 'Owner Workspace',
  admin: 'Admin',
  shopee_reviewer: 'Shopee Reviewer',
  direktur_ops: 'Direktur Ops',
  staf_ops: 'Staf Ops',
  direktur_finance: 'Direktur Finance',
  staf_finance: 'Staf Finance',
  brand_manager: 'Brand Manager',
  sales_manager: 'Sales Manager',
  warehouse_manager: 'WH Manager',
  ppic_manager: 'PPIC Manager',
  finance: 'Finance',
  staff: 'Staff',
  pending: 'Menunggu Approval',
};

const SHOPEE_REVIEWER_PERMISSION_SET = new Set<string>(
  SHOPEE_REVIEWER_PERMISSION_KEYS,
);

/**
 * Reviewer roles are deliberately capped in code as well as in the database
 * permission matrix. This prevents an accidental extra matrix row from
 * expanding the Shopee review account into another dashboard area.
 */
export function isPermissionAllowedForRole(role: string | null | undefined, permissionKey: string) {
  if (role === LEGACY_MARKETING_API_REVIEWER_ROLE) return false;
  if (role !== SHOPEE_REVIEWER_ROLE) return true;
  return SHOPEE_REVIEWER_PERMISSION_SET.has(permissionKey);
}

export function canRoleAccessPermission(
  role: string | null | undefined,
  permissions: ReadonlySet<string>,
  permissionKey: string,
) {
  if (role === 'owner') return true;
  return isPermissionAllowedForRole(role, permissionKey)
    && permissions.has(permissionKey);
}

export function fixedPermissionsForRole(role: string) {
  return role === SHOPEE_REVIEWER_ROLE
    ? [...SHOPEE_REVIEWER_PERMISSION_KEYS]
    : null;
}

export function normalizeAssignableWorkspaceRole(role: unknown) {
  const normalized = String(role || '').trim().toLowerCase();
  const membershipRole = normalized === 'owner' ? 'workspace_owner' : normalized;
  return ASSIGNABLE_WORKSPACE_ROLE_SET.has(membershipRole)
    ? membershipRole
    : null;
}

/**
 * profiles.role is a legacy compatibility enum and intentionally has fewer
 * values than workspace_memberships.role. Authorization must always use the
 * membership role; unsupported compatibility values fall back to manager.
 */
export function profileCompatibilityRoleForWorkspaceRole(role: string) {
  const candidate = role === 'workspace_owner' ? 'admin' : role;
  return PROFILE_ENUM_ROLE_SET.has(candidate) ? candidate : 'manager';
}

export function workspaceRoleLabel(role: string) {
  return WORKSPACE_ROLE_LABELS[role] || role;
}
