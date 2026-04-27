import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { limitByIp, rejectMissingDashboardSession, rejectUntrustedOrigin } from '@/lib/request-hardening';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Service role client — bypasses RLS
function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// Verify the caller is an owner
async function verifyOwner(): Promise<boolean> {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return (cookieStore as any).get(name)?.value; },
        set() {},
        remove() {},
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  
  const svc = getServiceSupabase();
  const { data: profile, error } = await svc.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (error || !profile) return false;
  return profile.role === 'owner';
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

    // Only owner can invite
    const isOwner = await verifyOwner();
    if (!isOwner) {
      return NextResponse.json({ error: 'Hanya Owner yang bisa invite user' }, { status: 403 });
    }

    const { email, role } = await req.json();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedRole = String(role || '').trim().toLowerCase();

    // Validate input
    if (!normalizedEmail || !EMAIL_REGEX.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Email tidak valid' }, { status: 400 });
    }

    const allowedRoles = [
      'admin',
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
    const resetRedirectTo = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://app.roove.info'}/reset-password`;

    // Check if user already exists in profiles
    const { data: existing } = await svc.from('profiles').select('email').eq('email', normalizedEmail).maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'User dengan email ini sudah terdaftar' }, { status: 409 });
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

    // Update the profile role (trigger should have created it as 'pending')
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
        .update({ role: normalizedRole })
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
        .upsert({ id: newUser.user.id, email: normalizedEmail, role: normalizedRole });
      if (insertError) {
        console.error('[Invite] Insert profile error:', insertError);
        warnings.push('Profil user belum berhasil dibuat otomatis. Cek data user di Supabase.');
      }
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
        ? `User ${normalizedEmail} berhasil dibuat sebagai ${normalizedRole}, tetapi masih ada langkah manual yang perlu dicek.`
        : `User ${normalizedEmail} berhasil dibuat sebagai ${normalizedRole}. Bagikan link set password ke user.`,
      userId: newUser.user.id,
      recoveryLink,
      warnings,
    });

  } catch (err: any) {
    console.error('[Invite] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
