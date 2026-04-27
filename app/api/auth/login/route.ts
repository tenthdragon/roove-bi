import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import {
  limitByIp,
  limitByIpAndValue,
  rejectUntrustedOrigin,
} from '@/lib/request-hardening';

function getAuthClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function POST(req: NextRequest) {
  const originError = rejectUntrustedOrigin(req);
  if (originError) return originError;

  const ipLimit = limitByIp(
    req,
    'auth-login-ip',
    8,
    10 * 60 * 1000,
    'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.',
  );
  if (ipLimit) return ipLimit;

  try {
    const body = await req.json();
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');

    if (!email || !password) {
      return NextResponse.json({ error: 'Email dan password wajib diisi.' }, { status: 400 });
    }

    const emailLimit = limitByIpAndValue(
      req,
      'auth-login-email',
      email,
      5,
      10 * 60 * 1000,
      'Terlalu banyak percobaan login untuk akun ini. Coba lagi beberapa menit lagi.',
    );
    if (emailLimit) return emailLimit;

    const auth = getAuthClient();
    const { data, error } = await auth.auth.signInWithPassword({ email, password });

    if (error) {
      const status = error.status === 429 ? 429 : 400;
      const message = status === 429
        ? 'Terlalu banyak percobaan login. Coba lagi beberapa menit lagi.'
        : 'Email atau password salah.';
      return NextResponse.json({ error: message }, { status });
    }

    if (!data.session?.access_token || !data.session?.refresh_token) {
      return NextResponse.json({ error: 'Session login tidak tersedia.' }, { status: 500 });
    }

    return NextResponse.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Login gagal.' }, { status: 500 });
  }
}
