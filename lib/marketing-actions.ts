'use server';

import { createServerSupabase, createServiceSupabase } from './supabase-server';

interface MarketingPageDataParams {
  from: string;
  to: string;
  prevFullFrom: string;
  prevFullTo: string;
  prevRangeFrom: string;
  prevRangeTo: string;
}

async function requireAuthenticatedDashboardUser() {
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
    .eq('permission_key', 'tab:marketing')
    .maybeSingle();

  if (permissionError) throw new Error('Gagal memverifikasi akses Marketing Channel.');
  if (!permission) throw new Error('Akun ini tidak memiliki akses ke Marketing Channel.');
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return (result.data ?? ([] as unknown as T));
}

export async function getMarketingPageData({
  from,
  to,
  prevFullFrom,
  prevFullTo,
  prevRangeFrom,
  prevRangeTo,
}: MarketingPageDataParams) {
  await requireAuthenticatedDashboardUser();

  const svc = createServiceSupabase();

  const [
    prodRes,
    adsRes,
    chRes,
    prevAdsRes,
    prevChRes,
    prevRangeAdsRes,
  ] = await Promise.all([
    svc.from('daily_product_summary')
      .select('date, product, net_sales, mkt_cost')
      .gte('date', from)
      .lte('date', to),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .gte('date', from)
      .lte('date', to),
    svc.from('daily_channel_data')
      .select('date, channel, product, net_sales, mp_admin_cost')
      .gte('date', from)
      .lte('date', to),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .gte('date', prevFullFrom)
      .lte('date', prevFullTo),
    svc.from('daily_channel_data')
      .select('date, channel, product, net_sales, mp_admin_cost')
      .gte('date', prevFullFrom)
      .lte('date', prevFullTo),
    svc.from('daily_ads_spend')
      .select('date, source, spent')
      .gte('date', prevRangeFrom)
      .lte('date', prevRangeTo),
  ]);

  return {
    prod: unwrap(prodRes, 'Gagal memuat revenue marketing'),
    ads: unwrap(adsRes, 'Gagal memuat marketing fee'),
    channel: unwrap(chRes, 'Gagal memuat breakdown channel'),
    prevAds: unwrap(prevAdsRes, 'Gagal memuat ad spend bulan sebelumnya'),
    prevChannel: unwrap(prevChRes, 'Gagal memuat channel bulan sebelumnya'),
    prevRangeAds: unwrap(prevRangeAdsRes, 'Gagal memuat perbandingan ad spend'),
  };
}
