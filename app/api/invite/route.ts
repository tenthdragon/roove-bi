import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';
import { buildPublicSiteUrl } from '@/lib/site-config';
import { requireDashboardRoles } from '@/lib/dashboard-access';

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

    const allowedRoles = [
      'workspace_owner',
      'admin',
      'marketing_api_reviewer',
      'direktur_ops', 'staf_ops',
      'direktur_finance', 'staf_finance',
      'brand_manager', 'sales_manager',
      'warehouse_manager', 'ppic_manager',
      // legacy
      'finance', 'staff',
    ];
    if (!allowedRoles.includes(normalizedRole)) {
      return NextResponse.json({ error: 'Role tidak valid' }, { status: 400 });
    }

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

    const addMembership = async (userId: string, isDefault: boolean) => {
      const { error } = await svc.from('workspace_memberships').upsert(
        {
          workspace_id: targetWorkspaceId,
          user_id: userId,
          role: normalizedRole,
          status: 'active',
          is_default: isDefault,
        },
        { onConflict: 'workspace_id,user_id' },
      );
      if (error) throw error;
    };

    // An existing login can join another workspace without creating a second
    // authentication identity.
    const { data: existing } = await svc
      .from('profiles')
      .select('id, email')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (existing) {
      const { count } = await svc
        .from('workspace_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', existing.id)
        .eq('status', 'active');
      await addMembership(existing.id, (count || 0) === 0);
      return NextResponse.json({
        success: true,
        partial: false,
        message: `${normalizedEmail} berhasil ditambahkan ke ${targetWorkspace.name} sebagai ${normalizedRole}.`,
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

    // `profiles.role` stays as the legacy/global compatibility role. Workspace
    // ownership is held only by workspace_memberships, never promoted globally.
    const compatibilityRole =
      normalizedRole === 'workspace_owner' ? 'admin' : normalizedRole;

    // Update the compatibility profile role (trigger should have created it as
    // 'pending').
    // Poll for profile existence (trigger may take a moment)
    let profileReady = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const { data: check } = await svc.from('profiles').select('id').eq('id', newUser.user.id).maybeSingle();
      if (check) { profileReady = true; break; }
    }

    if (profileReady) {
      const { error: updateError } = await svc
        .from('profiles')
        .update({
          role: compatibilityRole,
          active_workspace_id: targetWorkspaceId,
        })
        .eq('id', newUser.user.id);
      if (updateError) {
        console.error('[Invite] Update role error:', updateError);
        warnings.push('Role user belum berhasil di-set otomatis. Cek profil user di admin.');
      }
    } else {
      // Trigger didn't fire — insert profile directly
      console.warn('[Invite] Profile trigger did not fire, inserting directly');
      const { error: insertError } = await svc
        .from('profiles')
        .upsert({
          id: newUser.user.id,
          email: normalizedEmail,
          role: compatibilityRole,
          active_workspace_id: targetWorkspaceId,
        });
      if (insertError) {
        console.error('[Invite] Insert profile error:', insertError);
        warnings.push('Profil user belum berhasil dibuat otomatis. Cek data user di Supabase.');
      }
    }

    try {
      await addMembership(newUser.user.id, true);
    } catch (membershipError: any) {
      console.error('[Invite] Membership error:', membershipError);
      warnings.push(
        'User berhasil dibuat, tetapi membership workspace belum tersimpan. Cek Admin Users.',
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
        : `User ${normalizedEmail} berhasil dibuat di ${targetWorkspace.name} sebagai ${normalizedRole}. Bagikan link set password ke user.`,
      userId: newUser.user.id,
      recoveryLink,
      warnings,
    });

  } catch (err: any) {
    console.error('[Invite] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
