import { NextResponse } from 'next/server';

import {
  createServerSupabase,
  createServiceSupabase,
} from '@/lib/supabase-server';

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

  return NextResponse.json(
    { profile },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
