import { createServerSupabase } from './supabase-server';
import { requireWorkspaceAccess } from './workspace-access';
import { ROOVE_WORKSPACE_ID } from './workspaces';

type DashboardProfile = {
  id: string;
  role: string;
};

type AccessContext = {
  profile: DashboardProfile;
  workspaceId: string;
  membershipRole: string;
  isPlatformOwner: boolean;
};

async function getAuthenticatedDashboardProfile(): Promise<AccessContext> {
  const supabase = createServerSupabase();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');
  }

  const directProfile = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  let profile = directProfile.data;
  if (!profile) {
    const rpcProfile = await supabase
      .rpc('get_my_dashboard_profile')
      .select('id, role')
      .maybeSingle();
    profile = rpcProfile.data;
  }

  if (!profile || profile.role === 'pending') {
    throw new Error('Akses dashboard belum aktif untuk akun ini.');
  }

  const workspaceAccess = await requireWorkspaceAccess();
  const effectiveRole = workspaceAccess.hasFullWorkspaceAccess
    ? 'owner'
    : workspaceAccess.membershipRole;

  return {
    profile: {
      id: profile.id,
      role: effectiveRole,
    },
    workspaceId: workspaceAccess.workspaceId,
    membershipRole: workspaceAccess.membershipRole,
    isPlatformOwner: workspaceAccess.isPlatformOwner,
  };
}

async function verifyPermissionKeys(
  workspaceId: string,
  role: string,
  permissionKeys: string[],
  verifyErrorMessage: string,
  denyMessage: string
) {
  const supabase = createServerSupabase();
  const { data: permissions, error } = await supabase
    .from('workspace_role_permissions')
    .select('permission_key')
    .eq('workspace_id', workspaceId)
    .eq('role', role)
    .in('permission_key', permissionKeys)
    .limit(1);

  if (error) throw new Error(verifyErrorMessage);
  if (!permissions || permissions.length === 0) throw new Error(denyMessage);
}

export async function requireDashboardTabAccess(tabId: string, label?: string): Promise<AccessContext> {
  const ctx = await getAuthenticatedDashboardProfile();
  if (
    ctx.workspaceId !== ROOVE_WORKSPACE_ID
    && ['ppic', 'warehouse-settings', 'marketplace-intake', 'customers', 'brand-analysis', 'sales-channel-analysis'].includes(tabId)
  ) {
    throw new Error(`${label || tabId} masih dalam rollout workspace dan belum diaktifkan.`);
  }
  if (ctx.profile.role === 'owner') return ctx;

  const tabLabel = label || tabId;
  await verifyPermissionKeys(
    ctx.workspaceId,
    ctx.profile.role,
    [`tab:${tabId}`],
    `Gagal memverifikasi akses ${tabLabel}.`,
    `Akun ini tidak memiliki akses ke ${tabLabel}.`
  );

  return ctx;
}

export async function requireAnyDashboardTabAccess(tabIds: string[], label: string): Promise<AccessContext> {
  const ctx = await getAuthenticatedDashboardProfile();
  const allowedTabIds = ctx.workspaceId === ROOVE_WORKSPACE_ID
    ? tabIds
    : tabIds.filter((tabId) => !['ppic', 'warehouse-settings', 'marketplace-intake', 'customers', 'brand-analysis', 'sales-channel-analysis'].includes(tabId));
  if (allowedTabIds.length === 0) {
    throw new Error(`${label} masih dalam rollout workspace dan belum diaktifkan.`);
  }
  if (ctx.profile.role === 'owner') return ctx;

  await verifyPermissionKeys(
    ctx.workspaceId,
    ctx.profile.role,
    allowedTabIds.map((tabId) => `tab:${tabId}`),
    `Gagal memverifikasi akses ${label}.`,
    `Akun ini tidak memiliki akses ke ${label}.`
  );

  return ctx;
}

export async function requireDashboardPermissionAccess(permissionKey: string, label?: string): Promise<AccessContext> {
  const ctx = await getAuthenticatedDashboardProfile();
  if (ctx.profile.role === 'owner') return ctx;

  const permissionLabel = label || permissionKey;
  await verifyPermissionKeys(
    ctx.workspaceId,
    ctx.profile.role,
    [permissionKey],
    `Gagal memverifikasi izin ${permissionLabel}.`,
    `Akun ini tidak memiliki izin ${permissionLabel}.`
  );

  return ctx;
}

export async function requireAnyDashboardPermissionAccess(permissionKeys: string[], label: string): Promise<AccessContext> {
  const ctx = await getAuthenticatedDashboardProfile();
  if (ctx.profile.role === 'owner') return ctx;

  await verifyPermissionKeys(
    ctx.workspaceId,
    ctx.profile.role,
    permissionKeys,
    `Gagal memverifikasi izin ${label}.`,
    `Akun ini tidak memiliki izin ${label}.`
  );

  return ctx;
}

export async function requireDashboardRoles(roles: string[], denyMessage: string): Promise<AccessContext> {
  const ctx = await getAuthenticatedDashboardProfile();
  if (ctx.workspaceId !== ROOVE_WORKSPACE_ID && /marketplace/i.test(denyMessage)) {
    throw new Error('Marketplace Intake masih dalam rollout workspace dan belum diaktifkan.');
  }
  if (roles.includes(ctx.profile.role)) return ctx;
  throw new Error(denyMessage);
}

export async function requireRooveOnlyFeature(label: string): Promise<AccessContext> {
  const ctx = await getAuthenticatedDashboardProfile();
  if (ctx.workspaceId !== ROOVE_WORKSPACE_ID) {
    throw new Error(`${label} masih dalam rollout workspace dan belum diaktifkan.`);
  }
  return ctx;
}
