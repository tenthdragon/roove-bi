import { cookies } from 'next/headers';
import {
  createServerSupabase,
  createServiceSupabase,
} from './supabase-server';
import {
  ACTIVE_WORKSPACE_COOKIE,
  type AccessibleWorkspace,
  type WorkspaceBootstrap,
} from './workspaces';

export type WorkspaceProfile = {
  id: string;
  role: string;
  active_workspace_id?: string | null;
};

type WorkspaceDataClient = ReturnType<typeof createServerSupabase>;

function normalizeWorkspaceRow(
  workspace: any,
  membershipRole: string,
  isDefault: boolean,
): AccessibleWorkspace | null {
  if (!workspace?.id || !workspace?.slug || !workspace?.name) return null;
  return {
    id: String(workspace.id),
    slug: String(workspace.slug),
    name: String(workspace.name),
    status: workspace.status,
    membershipRole,
    isDefault,
  };
}

async function getAuthenticatedWorkspaceProfile() {
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

  if (!profile) {
    throw new Error('Profil dashboard tidak ditemukan.');
  }

  return {
    supabase,
    user,
    profile: profile as WorkspaceProfile,
    isPlatformOwner: profile.role === 'owner',
  };
}

export async function getWorkspaceBootstrap(): Promise<WorkspaceBootstrap> {
  const { supabase, user, profile, isPlatformOwner } =
    await getAuthenticatedWorkspaceProfile();

  return getWorkspaceBootstrapForProfile({
    supabase,
    userId: user.id,
    profile,
    isPlatformOwner,
  });
}

export async function getWorkspaceBootstrapForVerifiedProfile({
  userId,
  profile,
}: {
  userId: string;
  profile: WorkspaceProfile;
}): Promise<WorkspaceBootstrap> {
  // This helper may only be called after the caller has verified the session
  // and pinned the profile lookup to that session's user id.
  return getWorkspaceBootstrapForProfile({
    supabase: createServiceSupabase() as WorkspaceDataClient,
    userId,
    profile,
    isPlatformOwner: profile.role === 'owner',
  });
}

async function getWorkspaceBootstrapForProfile({
  supabase,
  userId,
  profile,
  isPlatformOwner,
}: {
  supabase: WorkspaceDataClient;
  userId: string;
  profile: WorkspaceProfile;
  isPlatformOwner: boolean;
}): Promise<WorkspaceBootstrap> {

  let workspaces: AccessibleWorkspace[] = [];

  if (isPlatformOwner) {
    const { data, error } = await supabase
      .from('workspaces')
      .select('id, slug, name, status')
      .in('status', ['active', 'provisioning'])
      .order('created_at');

    if (error) throw new Error(`Gagal memuat workspace: ${error.message}`);
    workspaces = (data || [])
      .map((workspace) =>
        normalizeWorkspaceRow(workspace, 'workspace_owner', false),
      )
      .filter(Boolean) as AccessibleWorkspace[];
  } else {
    const { data, error } = await supabase
      .from('workspace_memberships')
      .select(
        'role, is_default, workspaces!inner(id, slug, name, status)',
      )
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) throw new Error(`Gagal memuat membership workspace: ${error.message}`);
    workspaces = (data || [])
      .map((membership: any) =>
        normalizeWorkspaceRow(
          membership.workspaces,
          membership.role,
          Boolean(membership.is_default),
        ),
      )
      .filter(
        (workspace): workspace is AccessibleWorkspace =>
          workspace !== null && workspace.status === 'active',
      );
  }

  if (workspaces.length === 0) {
    throw new Error('Akun ini belum memiliki workspace aktif.');
  }

  const activeWorkspaces = workspaces.filter(
    (workspace) => workspace.status === 'active',
  );
  if (activeWorkspaces.length === 0) {
    throw new Error('Akun ini belum memiliki workspace yang siap digunakan.');
  }

  const cookieWorkspaceId = cookies().get(ACTIVE_WORKSPACE_COOKIE)?.value;
  const preferredWorkspaceId =
    cookieWorkspaceId || profile.active_workspace_id || null;
  const activeWorkspace =
    activeWorkspaces.find((workspace) => workspace.id === preferredWorkspaceId) ||
    activeWorkspaces.find((workspace) => workspace.isDefault) ||
    activeWorkspaces[0];

  return {
    activeWorkspace,
    workspaces,
    isPlatformOwner,
  };
}

export async function requireWorkspaceAccess() {
  const bootstrap = await getWorkspaceBootstrap();
  return {
    workspaceId: bootstrap.activeWorkspace.id,
    workspace: bootstrap.activeWorkspace,
    membershipRole: bootstrap.activeWorkspace.membershipRole,
    isPlatformOwner: bootstrap.isPlatformOwner,
    hasFullWorkspaceAccess:
      bootstrap.isPlatformOwner ||
      bootstrap.activeWorkspace.membershipRole === 'workspace_owner',
  };
}

export async function setActiveWorkspace(workspaceId: string) {
  const bootstrap = await getWorkspaceBootstrap();
  const workspace = bootstrap.workspaces.find((item) => item.id === workspaceId);

  if (!workspace) {
    throw new Error('Akun ini tidak memiliki akses ke workspace tersebut.');
  }
  if (workspace.status !== 'active') {
    throw new Error(`${workspace.name} masih dalam proses provisioning.`);
  }

  cookies().set(ACTIVE_WORKSPACE_COOKIE, workspace.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from('profiles')
      .update({ active_workspace_id: workspace.id })
      .eq('id', user.id);
  }

  return {
    activeWorkspace: workspace,
  };
}
