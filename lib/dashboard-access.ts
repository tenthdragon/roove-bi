import { createServerSupabase } from './supabase-server';

type DashboardProfile = {
  id: string;
  role: string;
};

type AccessContext = {
  profile: DashboardProfile;
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

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile || profile.role === 'pending') {
    throw new Error('Akses dashboard belum aktif untuk akun ini.');
  }

  return { profile };
}

async function verifyPermissionKeys(
  role: string,
  permissionKeys: string[],
  verifyErrorMessage: string,
  denyMessage: string
) {
  const supabase = createServerSupabase();
  const { data: permissions, error } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role', role)
    .in('permission_key', permissionKeys)
    .limit(1);

  if (error) throw new Error(verifyErrorMessage);
  if (!permissions || permissions.length === 0) throw new Error(denyMessage);
}

export async function requireDashboardTabAccess(tabId: string, label?: string): Promise<AccessContext> {
  const ctx = await getAuthenticatedDashboardProfile();
  if (ctx.profile.role === 'owner') return ctx;

  const tabLabel = label || tabId;
  await verifyPermissionKeys(
    ctx.profile.role,
    [`tab:${tabId}`],
    `Gagal memverifikasi akses ${tabLabel}.`,
    `Akun ini tidak memiliki akses ke ${tabLabel}.`
  );

  return ctx;
}

export async function requireAnyDashboardTabAccess(tabIds: string[], label: string): Promise<AccessContext> {
  const ctx = await getAuthenticatedDashboardProfile();
  if (ctx.profile.role === 'owner') return ctx;

  await verifyPermissionKeys(
    ctx.profile.role,
    tabIds.map((tabId) => `tab:${tabId}`),
    `Gagal memverifikasi akses ${label}.`,
    `Akun ini tidak memiliki akses ke ${label}.`
  );

  return ctx;
}

export async function requireDashboardRoles(roles: string[], denyMessage: string): Promise<AccessContext> {
  const ctx = await getAuthenticatedDashboardProfile();
  if (roles.includes(ctx.profile.role)) return ctx;
  throw new Error(denyMessage);
}
