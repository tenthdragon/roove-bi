import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Service role client — bypasses RLS
function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// GET — just open this URL in the browser to create the user
export async function GET() {
  const email = 'debby@roove.co.id';
  const password = 'RTIpuridagomas135';
  const role = 'sales_manager';

  try {
    const svc = getServiceSupabase();

    // Create user with confirmed email
    const { data: newUser, error: createError } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }

    if (!newUser?.user) {
      return NextResponse.json({ error: 'Gagal membuat user' }, { status: 500 });
    }

    // Wait for profile trigger, then set role
    let profileReady = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const { data: check } = await svc.from('profiles').select('id').eq('id', newUser.user.id).maybeSingle();
      if (check) { profileReady = true; break; }
    }

    if (profileReady) {
      await svc.from('profiles').update({ role }).eq('id', newUser.user.id);
    } else {
      await svc.from('profiles').upsert({ id: newUser.user.id, email, role });
    }

    return NextResponse.json({
      success: true,
      message: `User ${email} berhasil dibuat dengan role ${role}. Silakan login.`,
    });

  } catch (err: any) {
    console.error('[Admin Create User] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}
