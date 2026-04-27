import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import {
  limitByIp,
  limitByIpAndValue,
  rejectUntrustedOrigin,
} from '@/lib/request-hardening';

const ALLOWED_DOMAINS = new Set(['roove.co.id']);

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
    'auth-register-ip',
    3,
    60 * 60 * 1000,
    'Terlalu banyak percobaan pendaftaran. Coba lagi nanti.',
  );
  if (ipLimit) return ipLimit;

  try {
    const body = await req.json();
    const email = String(body?.email || '').trim().toLowerCase();
    const password = String(body?.password || '');
    const fullName = String(body?.fullName || '').trim();

    const domain = email.split('@')[1]?.toLowerCase() || '';
    if (!email || !password || !ALLOWED_DOMAINS.has(domain)) {
      return NextResponse.json({ error: 'Hanya email @roove.co.id yang dapat mendaftar.' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password minimal 6 karakter.' }, { status: 400 });
    }

    const emailLimit = limitByIpAndValue(
      req,
      'auth-register-email',
      email,
      2,
      24 * 60 * 60 * 1000,
      'Terlalu banyak percobaan pendaftaran untuk email ini. Coba lagi besok.',
    );
    if (emailLimit) return emailLimit;

    const auth = getAuthClient();
    const { error } = await auth.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          email_verified: true,
        },
      },
    });

    if (error) {
      const status = error.status === 429 ? 429 : 400;
      return NextResponse.json({
        error: status === 429
          ? 'Terlalu banyak percobaan pendaftaran. Coba lagi nanti.'
          : error.message,
      }, { status });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Pendaftaran gagal.' }, { status: 500 });
  }
}
