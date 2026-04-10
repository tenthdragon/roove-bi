'use server';

import { requireDashboardTabAccess } from './dashboard-access';
import { createServiceSupabase } from './supabase-server';

interface ChannelsPageDataParams {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return (result.data ?? ([] as unknown as T));
}

export async function getChannelsPageData({
  from,
  to,
  prevFrom,
  prevTo,
}: ChannelsPageDataParams) {
  await requireDashboardTabAccess('channels', 'Sales Channel');

  const svc = createServiceSupabase();

  const [
    channelRes,
    adsRes,
    mappingRes,
    shipmentRes,
    prevChannelRes,
    prevAdsRes,
  ] = await Promise.all([
    svc.from('daily_channel_data')
      .select('date, product, channel, net_sales, gross_profit, mp_admin_cost')
      .gte('date', from)
      .lte('date', to),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store, data_source, impressions, cpm')
      .gte('date', from)
      .lte('date', to),
    svc.from('ads_store_brand_mapping')
      .select('store_pattern, brand'),
    svc.rpc('get_daily_shipment_counts', { p_from: from, p_to: to }),
    svc.from('daily_channel_data')
      .select('date, product, channel, net_sales, gross_profit, mp_admin_cost')
      .gte('date', prevFrom)
      .lte('date', prevTo),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .gte('date', prevFrom)
      .lte('date', prevTo),
  ]);

  return {
    channel: unwrap(channelRes, 'Gagal memuat data Sales Channel'),
    ads: unwrap(adsRes, 'Gagal memuat biaya iklan Sales Channel'),
    brandMapping: unwrap(mappingRes, 'Gagal memuat mapping brand iklan'),
    shipmentCounts: unwrap(shipmentRes, 'Gagal memuat data shipment Sales Channel'),
    prevChannel: unwrap(prevChannelRes, 'Gagal memuat channel bulan sebelumnya'),
    prevAds: unwrap(prevAdsRes, 'Gagal memuat ads bulan sebelumnya'),
  };
}
