'use server';

import { createServerSupabase, createServiceSupabase } from './supabase-server';

interface OverviewFeeDataParams {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

async function requireOverviewAccess() {
  const supabase = createServerSupabase();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile || profile.role === 'pending') {
    throw new Error('Akses dashboard belum aktif untuk akun ini.');
  }

  if (profile.role === 'owner') return;

  const { data: permission, error: permissionError } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role', profile.role)
    .eq('permission_key', 'tab:overview')
    .maybeSingle();

  if (permissionError) throw new Error('Gagal memverifikasi akses Overview.');
  if (!permission) throw new Error('Akun ini tidak memiliki akses ke Overview.');
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return (result.data ?? ([] as unknown as T));
}

export async function getOverviewFeeData({
  from,
  to,
  prevFrom,
  prevTo,
}: OverviewFeeDataParams) {
  await requireOverviewAccess();

  const svc = createServiceSupabase();

  const [adsRes, channelRes, prevAdsRes, prevChannelRes] = await Promise.all([
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .gte('date', from)
      .lte('date', to),
    svc.from('daily_channel_data')
      .select('date, channel, product, mp_admin_cost')
      .gte('date', from)
      .lte('date', to),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .gte('date', prevFrom)
      .lte('date', prevTo),
    svc.from('daily_channel_data')
      .select('date, channel, product, mp_admin_cost')
      .gte('date', prevFrom)
      .lte('date', prevTo),
  ]);

  return {
    ads: unwrap(adsRes, 'Gagal memuat marketing fee Overview'),
    channel: unwrap(channelRes, 'Gagal memuat MP fee Overview'),
    prevAds: unwrap(prevAdsRes, 'Gagal memuat marketing fee bulan sebelumnya'),
    prevChannel: unwrap(prevChannelRes, 'Gagal memuat MP fee bulan sebelumnya'),
  };
}
