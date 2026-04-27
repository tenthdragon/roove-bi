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
    'auth-forgot-ip',
    5,
    30 * 60 * 1000,
    'Terlalu banyak permintaan reset password. Coba lagi nanti.',
  );
  if (ipLimit) return ipLimit;

  try {
    const body = await req.json();
    const email = String(body?.email || '').trim().toLowerCase();
    const redirectTo = String(body?.redirectTo || '').trim();

    if (!email || !redirectTo) {
      return NextResponse.json({ error: 'Email dan redirectTo wajib diisi.' }, { status: 400 });
    }

    const emailLimit = limitByIpAndValue(
      req,
      'auth-forgot-email',
      email,
      3,
      60 * 60 * 1000,
      'Terlalu banyak permintaan reset password untuk email ini. Coba lagi nanti.',
    );
    if (emailLimit) return emailLimit;

    const auth = getAuthClient();
    const { error } = await auth.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      const status = error.status === 429 ? 429 : 400;
      return NextResponse.json({
        error: status === 429
          ? 'Terlalu banyak permintaan reset password. Coba lagi nanti.'
          : 'Gagal mengirim email reset password.',
      }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Reset password gagal.' }, { status: 500 });
  }
}
