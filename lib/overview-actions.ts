'use server';

import { createServiceSupabase } from './supabase-server';
import { requireDashboardTabAccess } from './dashboard-access';
import { getShippingFeeRange } from './shipping-fee-data';

interface OverviewFeeDataParams {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

const OVERVIEW_DAILY_SUMMARY_COLUMNS = [
  'date',
  'product',
  'net_sales',
  'gross_profit',
  'net_after_mkt',
  'mp_admin_cost',
  'mkt_cost',
].join(', ');

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return (result.data ?? ([] as unknown as T));
}

function unwrapOptional<T>(result: { data: T | null; error: { message: string } | null }, label: string) {
  if (result.error) {
    console.error(`[Overview] optional load error: ${label}`, result.error.message);
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

  const [adsRes, channelRes, shippingRes, prevAdsRes, prevChannelRes, prevShippingRes] = await Promise.all([
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .gte('date', from)
      .lte('date', to),
    svc.from('daily_channel_data')
      .select('date, channel, product, mp_admin_cost')
      .gte('date', from)
      .lte('date', to),
    getShippingFeeRange(from, to)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: { message: error.message } })),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .gte('date', prevFrom)
      .lte('date', prevTo),
    svc.from('daily_channel_data')
      .select('date, channel, product, mp_admin_cost')
      .gte('date', prevFrom)
      .lte('date', prevTo),
    getShippingFeeRange(prevFrom, prevTo)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: { message: error.message } })),
  ]);

  const shipping = unwrapOptional(shippingRes, 'Gagal memuat shipping fee Overview');
  const prevShipping = unwrapOptional(prevShippingRes, 'Gagal memuat shipping fee bulan sebelumnya');

  return {
    ads: unwrap(adsRes, 'Gagal memuat marketing fee Overview'),
    channel: unwrap(channelRes, 'Gagal memuat MP fee Overview'),
    shipping: shipping.data,
    shippingError: shipping.error,
    prevAds: unwrap(prevAdsRes, 'Gagal memuat marketing fee bulan sebelumnya'),
    prevChannel: unwrap(prevChannelRes, 'Gagal memuat MP fee bulan sebelumnya'),
    prevShipping: prevShipping.data,
    prevShippingError: prevShipping.error,
  };
}

export async function getOverviewPageData({
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

  const [
    dailyRes,
    shipmentRes,
    overheadRes,
    prevDailyRes,
    prevOverheadRes,
    adsRes,
    channelRes,
    shippingRes,
    prevAdsRes,
    prevChannelRes,
    prevShippingRes,
  ] = await Promise.all([
    svc.from('daily_product_summary')
      .select(OVERVIEW_DAILY_SUMMARY_COLUMNS)
      .gte('date', from)
      .lte('date', to)
      .order('date'),
    svc.rpc('get_daily_shipment_counts', { p_from: from, p_to: to }),
    svc.from('monthly_overhead')
      .select('year_month, amount')
      .gte('year_month', fromYM)
      .lte('year_month', toYM),
    svc.from('daily_product_summary')
      .select(OVERVIEW_DAILY_SUMMARY_COLUMNS)
      .gte('date', prevFrom)
      .lte('date', prevTo)
      .order('date'),
    svc.from('monthly_overhead')
      .select('year_month, amount')
      .gte('year_month', prevFromYM)
      .lte('year_month', prevToYM),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .gte('date', from)
      .lte('date', to),
    svc.from('daily_channel_data')
      .select('date, channel, product, mp_admin_cost')
      .gte('date', from)
      .lte('date', to),
    getShippingFeeRange(from, to)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: { message: error.message } })),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .gte('date', prevFrom)
      .lte('date', prevTo),
    svc.from('daily_channel_data')
      .select('date, channel, product, mp_admin_cost')
      .gte('date', prevFrom)
      .lte('date', prevTo),
    getShippingFeeRange(prevFrom, prevTo)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: { message: error.message } })),
  ]);

  const ads = unwrapOptional(adsRes, 'Gagal memuat marketing fee Overview');
  const channel = unwrapOptional(channelRes, 'Gagal memuat MP fee Overview');
  const shipping = unwrapOptional(shippingRes, 'Gagal memuat shipping fee Overview');
  const prevAds = unwrapOptional(prevAdsRes, 'Gagal memuat marketing fee bulan sebelumnya');
  const prevChannel = unwrapOptional(prevChannelRes, 'Gagal memuat MP fee bulan sebelumnya');
  const prevShipping = unwrapOptional(prevShippingRes, 'Gagal memuat shipping fee bulan sebelumnya');

  return {
    daily: unwrap(dailyRes, 'Gagal memuat data Overview'),
    shipment: unwrap(shipmentRes, 'Gagal memuat shipment Overview'),
    overhead: unwrap(overheadRes, 'Gagal memuat overhead Overview'),
    prevDaily: unwrap(prevDailyRes, 'Gagal memuat data Overview bulan sebelumnya'),
    prevOverhead: unwrap(prevOverheadRes, 'Gagal memuat overhead Overview bulan sebelumnya'),
    ads: ads.data,
    channel: channel.data,
    shipping: shipping.data,
    prevAds: prevAds.data,
    prevChannel: prevChannel.data,
    prevShipping: prevShipping.data,
    feeError: [ads.error, channel.error].filter(Boolean).join(' | ') || null,
    prevFeeError: [prevAds.error, prevChannel.error].filter(Boolean).join(' | ') || null,
    shippingError: shipping.error,
    prevShippingError: prevShipping.error,
  };
}
