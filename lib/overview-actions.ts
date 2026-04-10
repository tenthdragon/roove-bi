'use server';

import { createServiceSupabase } from './supabase-server';
import { requireDashboardTabAccess } from './dashboard-access';

interface OverviewFeeDataParams {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return (result.data ?? ([] as unknown as T));
}

export async function getOverviewCoreData({
  from,
  to,
  prevFrom,
  prevTo,
}: OverviewFeeDataParams) {
  await requireDashboardTabAccess('overview', 'Overview');

  const svc = createServiceSupabase();
  const fromYM = from.slice(0, 7);
  const toYM = to.slice(0, 7);
  const prevFromYM = prevFrom.slice(0, 7);
  const prevToYM = prevTo.slice(0, 7);

  const [dailyRes, shipmentRes, overheadRes, prevDailyRes, prevOverheadRes] = await Promise.all([
    svc.from('daily_product_summary')
      .select('*')
      .gte('date', from)
      .lte('date', to)
      .order('date'),
    svc.rpc('get_daily_shipment_counts', { p_from: from, p_to: to }),
    svc.from('monthly_overhead')
      .select('year_month, amount')
      .gte('year_month', fromYM)
      .lte('year_month', toYM),
    svc.from('daily_product_summary')
      .select('*')
      .gte('date', prevFrom)
      .lte('date', prevTo)
      .order('date'),
    svc.from('monthly_overhead')
      .select('year_month, amount')
      .gte('year_month', prevFromYM)
      .lte('year_month', prevToYM),
  ]);

  return {
    daily: unwrap(dailyRes, 'Gagal memuat data Overview'),
    shipment: unwrap(shipmentRes, 'Gagal memuat shipment Overview'),
    overhead: unwrap(overheadRes, 'Gagal memuat overhead Overview'),
    prevDaily: unwrap(prevDailyRes, 'Gagal memuat data Overview bulan sebelumnya'),
    prevOverhead: unwrap(prevOverheadRes, 'Gagal memuat overhead Overview bulan sebelumnya'),
  };
}

export async function getOverviewFeeData({
  from,
  to,
  prevFrom,
  prevTo,
}: OverviewFeeDataParams) {
  await requireDashboardTabAccess('overview', 'Overview');

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
