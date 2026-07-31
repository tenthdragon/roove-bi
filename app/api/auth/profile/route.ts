import { NextResponse } from 'next/server';

import {
  createServerSupabase,
  createServiceSupabase,
} from '@/lib/supabase-server';
import { getWorkspaceBootstrapForVerifiedProfile } from '@/lib/workspace-access';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await auth.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      { error: 'Sesi login tidak ditemukan.' },
      { status: 401 },
    );
  }

  // The service client is used only after the JWT has been verified, and the
  // lookup is pinned to that JWT's user id. This avoids a profile-bootstrap
  // deadlock when profiles RLS itself is being used to establish workspace
  // context, without allowing callers to request another user's profile.
  const service = createServiceSupabase();
  const { data: profile, error: profileError } = await service
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json(
      { error: 'Profil dashboard gagal dimuat.' },
      { status: 500 },
    );
  }
  if (!profile) {
    return NextResponse.json(
      { error: 'Profil dashboard tidak ditemukan.' },
      { status: 404 },
    );
  }

  try {
    let workspaceBootstrap = null;
    let permissions: string[] = [];

    if (profile.role !== 'pending') {
      workspaceBootstrap = await getWorkspaceBootstrapForVerifiedProfile({
        userId: user.id,
        profile,
      });

      const membershipRole = workspaceBootstrap.activeWorkspace.membershipRole;
      const effectiveRole =
        profile.role === 'owner' || membershipRole === 'workspace_owner'
          ? 'owner'
          : membershipRole || profile.role;

      if (effectiveRole !== 'owner') {
        const { data: permissionRows, error: permissionError } = await service
          .from('workspace_role_permissions')
          .select('permission_key')
          .eq('workspace_id', workspaceBootstrap.activeWorkspace.id)
          .eq('role', effectiveRole);

        if (permissionError) {
          return NextResponse.json(
            { error: 'Permission dashboard gagal dimuat.' },
            { status: 500 },
          );
        }

        permissions = (permissionRows || []).map(
          (row) => row.permission_key,
        );
      }
    }

    return NextResponse.json(
      { profile, workspaceBootstrap, permissions },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Workspace dashboard gagal dimuat.' },
      { status: 403 },
    );
  }
}
