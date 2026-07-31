'use server';

import { createServiceSupabase } from './supabase-server';
import { getShippingFeeRange } from './shipping-fee-data';
import { requireDashboardTabAccess } from './dashboard-access';

interface MarketingPageDataParams {
  from: string;
  to: string;
  prevRangeFrom: string;
  prevRangeTo: string;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return (result.data ?? ([] as unknown as T));
}

function unwrapOptional<T>(result: { data: T | null; error: { message: string } | null }, label: string) {
  if (result.error) {
    console.error(`[Marketing] optional load error: ${label}`, result.error.message);
    return {
      data: [] as unknown as T,
      error: `${label}: ${result.error.message}`,
    };
  }
  return {
    data: (result.data ?? ([] as unknown as T)),
    error: null as string | null,
  };
}

export async function getMarketingPageData({
  from,
  to,
  prevRangeFrom,
  prevRangeTo,
}: MarketingPageDataParams) {
  const { workspaceId } = await requireDashboardTabAccess(
    'marketing',
    'Marketing Channel',
  );

  const svc = createServiceSupabase();

  const [
    prodRes,
    adsRes,
    chRes,
    mappingRes,
    shippingRes,
    prevRangeProdRes,
    prevRangeAdsRes,
    prevRangeChRes,
    prevRangeShippingRes,
  ] = await Promise.all([
    svc.from('daily_product_summary')
      .select('date, product, net_sales, gross_profit, mkt_cost')
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to),
    svc.from('daily_channel_data')
      .select('date, channel, product, net_sales, gross_profit, mp_admin_cost')
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to),
    svc.from('ads_store_brand_mapping')
      .select('store_pattern, brand')
      .eq('workspace_id', workspaceId),
    getShippingFeeRange(workspaceId, from, to)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: { message: error.message } })),
    svc.from('daily_product_summary')
      .select('date, product, net_sales, gross_profit, mkt_cost')
      .eq('workspace_id', workspaceId)
      .gte('date', prevRangeFrom)
      .lte('date', prevRangeTo),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .eq('workspace_id', workspaceId)
      .gte('date', prevRangeFrom)
      .lte('date', prevRangeTo),
    svc.from('daily_channel_data')
      .select('date, channel, product, net_sales, gross_profit, mp_admin_cost')
      .eq('workspace_id', workspaceId)
      .gte('date', prevRangeFrom)
      .lte('date', prevRangeTo),
    getShippingFeeRange(workspaceId, prevRangeFrom, prevRangeTo)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: { message: error.message } })),
  ]);

  const shipping = unwrapOptional(shippingRes, 'Gagal memuat shipping fee Marketing');
  const prevShipping = unwrapOptional(prevRangeShippingRes, 'Gagal memuat shipping fee Marketing bulan sebelumnya');

  return {
    prod: unwrap(prodRes, 'Gagal memuat revenue marketing'),
    ads: unwrap(adsRes, 'Gagal memuat marketing fee'),
    channel: unwrap(chRes, 'Gagal memuat breakdown channel'),
    brandMapping: unwrap(mappingRes, 'Gagal memuat mapping brand iklan'),
    shipping: shipping.data,
    shippingError: shipping.error,
    prevRangeProd: unwrap(prevRangeProdRes, 'Gagal memuat gross profit bulan sebelumnya'),
    prevRangeAds: unwrap(prevRangeAdsRes, 'Gagal memuat perbandingan ad spend'),
    prevRangeChannel: unwrap(prevRangeChRes, 'Gagal memuat perbandingan channel'),
    prevRangeShipping: prevShipping.data,
    prevRangeShippingError: prevShipping.error,
  };
}
