import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { buildPublicSiteUrl } from '@/lib/site-config';
import { requireDashboardRoles } from '@/lib/dashboard-access';
import {
  normalizeAssignableWorkspaceRole,
  workspaceRoleLabel,
} from '@/lib/role-access';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Service role client — bypasses RLS
function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(req: NextRequest) {
  try {
    const originError = rejectUntrustedOrigin(req);
    if (originError) return originError;

    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'invite-user',
      5,
      10 * 60 * 1000,
      'Terlalu banyak permintaan invite user. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const access = await requireDashboardRoles(
      ['owner'],
      'Hanya Owner Workspace yang bisa invite user.',
    );

    const { email, role, workspaceId: requestedWorkspaceId } = await req.json();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedRole = String(role || '').trim().toLowerCase();
    const targetWorkspaceId = requestedWorkspaceId
      ? String(requestedWorkspaceId)
      : access.workspaceId;

    // Validate input
    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Email tidak valid' }, { status: 400 });
    }

    const membershipRole = normalizeAssignableWorkspaceRole(normalizedRole);
    if (!membershipRole) {
      return NextResponse.json({ error: 'Role tidak valid' }, { status: 400 });
    }
    const roleLabel = workspaceRoleLabel(membershipRole);

    const svc = getServiceSupabase();
    const warnings: string[] = [];
    const resetRedirectTo = buildPublicSiteUrl('/reset-password');

    if (targetWorkspaceId !== access.workspaceId && !access.isPlatformOwner) {
      return NextResponse.json(
        { error: 'Anda tidak memiliki akses untuk invite ke workspace tersebut.' },
        { status: 403 },
      );
    }

    const { data: targetWorkspace, error: workspaceError } = await svc
      .from('workspaces')
      .select('id, name, status')
      .eq('id', targetWorkspaceId)
      .maybeSingle();
    if (workspaceError || !targetWorkspace) {
      return NextResponse.json({ error: 'Workspace tujuan tidak ditemukan.' }, { status: 404 });
    }
    if (targetWorkspace.status !== 'active') {
      return NextResponse.json(
        { error: 'Workspace tujuan belum aktif.' },
        { status: 409 },
      );
    }

    const activateMembership = async (userId: string) => {
      const { error } = await svc.rpc('set_workspace_member_role', {
        p_workspace_id: targetWorkspaceId,
        p_user_id: userId,
        p_role: membershipRole,
        p_actor_user_id: access.profile.id,
      });
      if (error) throw error;
    };

    // An existing login can join another workspace without creating a second
    // authentication identity.
    const { data: existing, error: existingError } = await svc
      .from('profiles')
      .select('id, email, role, active_workspace_id')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (existingError) {
      console.error('[Invite] Existing profile lookup error:', existingError);
      return NextResponse.json(
        { error: 'Gagal memeriksa user yang sudah ada. Silakan coba lagi.' },
        { status: 500 },
      );
    }
    if (existing) {
      await activateMembership(existing.id);

      return NextResponse.json({
        success: true,
        partial: false,
        message: `${normalizedEmail} berhasil ditambahkan ke ${targetWorkspace.name} sebagai ${roleLabel}.`,
        userId: existing.id,
        recoveryLink: null,
        warnings: [],
      });
    }

    // Create user via Supabase Admin API
    // This generates a temporary password — user will reset via email
    const tempPassword = crypto.randomUUID() + '!Aa1'; // meets password requirements
    
    const { data: newUser, error: createError } = await svc.auth.admin.createUser({
      email: normalizedEmail,
      password: tempPassword,
      email_confirm: true, // auto-confirm since we're inviting
      user_metadata: {
        full_name: '',
        email: normalizedEmail,
        email_verified: true,
        phone_verified: false,
      },
    });

    if (createError) {
      console.error('[Invite] Create user error:', createError);
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }

    if (!newUser?.user) {
      return NextResponse.json({ error: 'Gagal membuat user' }, { status: 500 });
    }

    const rollbackNewUser = async () => {
      const { error: rollbackError } = await svc.auth.admin.deleteUser(newUser.user.id);
      if (rollbackError) {
        console.error('[Invite] New user rollback error:', rollbackError);
      }
    };

    // Poll for profile existence (trigger may take a moment)
    let profileReady = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const { data: check } = await svc.from('profiles').select('id').eq('id', newUser.user.id).maybeSingle();
      if (check) { profileReady = true; break; }
    }

    if (!profileReady) {
      // Trigger didn't fire — insert profile directly
      console.warn('[Invite] Profile trigger did not fire, inserting directly');
      const { error: insertError } = await svc
        .from('profiles')
        .upsert({
          id: newUser.user.id,
          email: normalizedEmail,
          role: 'pending',
          active_workspace_id: null,
        });
      if (insertError) {
        console.error('[Invite] Insert profile error:', insertError);
        await rollbackNewUser();
        return NextResponse.json(
          { error: 'Profil user gagal dibuat. Silakan coba invite kembali.' },
          { status: 500 },
        );
      }
    }

    try {
      await activateMembership(newUser.user.id);
    } catch (membershipError: any) {
      console.error('[Invite] Membership activation error:', membershipError);
      await rollbackNewUser();
      return NextResponse.json(
        { error: 'Akses workspace gagal dibuat. Silakan coba invite kembali.' },
        { status: 500 },
      );
    }

    // Generate a set-password link that the owner can share manually.
    const { data: resetLinkData, error: resetError } = await svc.auth.admin.generateLink({
      type: 'recovery',
      email: normalizedEmail,
      options: {
        redirectTo: resetRedirectTo,
      },
    });

    const recoveryLink = resetLinkData?.properties?.action_link || null;

    if (resetError) {
      console.error('[Invite] Reset link error:', resetError);
      warnings.push('Link set password belum berhasil dibuat. User perlu dibuatkan link baru nanti.');
    } else if (!recoveryLink) {
      warnings.push('Link set password tidak tersedia untuk dibagikan.');
    }

    const partial = warnings.length > 0;

    return NextResponse.json({
      success: true,
      partial,
      message: partial
        ? `User ${normalizedEmail} berhasil dibuat di ${targetWorkspace.name}, tetapi masih ada langkah manual yang perlu dicek.`
        : `User ${normalizedEmail} berhasil dibuat di ${targetWorkspace.name} sebagai ${roleLabel}. Bagikan link set password ke user.`,
      userId: newUser.user.id,
      recoveryLink,
      warnings,
    });

  } catch (err: any) {
    console.error('[Invite] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
