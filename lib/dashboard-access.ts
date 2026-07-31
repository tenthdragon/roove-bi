import { createServerSupabase } from './supabase-server';
import { getWorkspaceBootstrapForVerifiedProfile } from './workspace-access';
import {
  isWorkspaceModuleEnabled,
  type AccessibleWorkspace,
} from './workspaces';

type DashboardProfile = {
  id: string;
  role: string;
  active_workspace_id?: string | null;
};

type AccessContext = {
  profile: DashboardProfile;
  workspaceId: string;
  membershipRole: string;
  isPlatformOwner: boolean;
  workspace: AccessibleWorkspace;
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
    .select('id, role, active_workspace_id')
    .eq('id', user.id)
    .single();

  let profile = directProfile.data;
  if (!profile) {
    const rpcProfile = await supabase
      .rpc('get_my_dashboard_profile')
      .select('id, role, active_workspace_id')
      .maybeSingle();
    profile = rpcProfile.data;
  }

  if (!profile || profile.role === 'pending') {
    throw new Error('Akses dashboard belum aktif untuk akun ini.');
  }

  const workspaceBootstrap = await getWorkspaceBootstrapForVerifiedProfile({
    userId: user.id,
    profile,
  });
  const activeWorkspace = workspaceBootstrap.activeWorkspace;
  const hasFullWorkspaceAccess =
    workspaceBootstrap.isPlatformOwner ||
    activeWorkspace.membershipRole === 'workspace_owner';
  const effectiveRole = hasFullWorkspaceAccess
    ? 'owner'
    : activeWorkspace.membershipRole;

  return {
    profile: {
      id: profile.id,
      role: effectiveRole,
    },
    workspaceId: activeWorkspace.id,
    membershipRole: activeWorkspace.membershipRole,
    isPlatformOwner: workspaceBootstrap.isPlatformOwner,
    workspace: activeWorkspace,
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
  if (!isWorkspaceModuleEnabled(ctx.workspace, tabId)) {
    throw new Error(`${label || tabId} tidak diaktifkan untuk workspace ini.`);
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
  const allowedTabIds = tabIds.filter((tabId) =>
    isWorkspaceModuleEnabled(ctx.workspace, tabId),
  );
  if (allowedTabIds.length === 0) {
    throw new Error(`${label} tidak diaktifkan untuk workspace ini.`);
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
  if (roles.includes(ctx.profile.role)) return ctx;
  throw new Error(denyMessage);
}
