'use server';

import { createServiceSupabase } from './supabase-server';
import { requireDashboardTabAccess } from './dashboard-access';
import { getShippingFeeRange } from './shipping-fee-data';

interface OverviewFeeDataParams {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  accessScope?: 'overview' | 'channels';
}

interface RevenueHistoryParams {
  from: string;
  to: string;
}

interface CommercialMomentAttributionParams {
  year: number;
  month: number;
  eventType: 'twin' | 'payday';
  monthsBack?: number;
  asOf: string;
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
  accessScope = 'overview',
}: OverviewFeeDataParams) {
  await requireDashboardTabAccess(accessScope, accessScope === 'channels' ? 'Sales Channel' : 'Overview');

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

export async function getRevenueHistory({
  from,
  to,
}: RevenueHistoryParams) {
  await requireDashboardTabAccess('channels', 'Sales Channel');

  const svc = createServiceSupabase();
  const monthRanges: Array<{ from: string; to: string }> = [];
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const finalMonth = to.slice(0, 7);

  while (cursor.toISOString().slice(0, 7) <= finalMonth) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();
    const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const monthEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
    monthRanges.push({
      from: monthStart < from ? from : monthStart,
      to: monthEnd > to ? to : monthEnd,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const results = await Promise.all(monthRanges.map((range) =>
    svc.from('daily_product_summary')
      .select('date, product, net_sales')
      .gte('date', range.from)
      .lte('date', range.to)
      .order('date')
  ));

  return results.flatMap((result) => unwrap(result, 'Gagal memuat histori revenue event'));
}

function shiftCommercialMonth(year: number, month: number, delta: number) {
  const index = year * 12 + month - 1 + delta;
  return {
    year: Math.floor(index / 12),
    month: ((index % 12) + 12) % 12 + 1,
  };
}

function commercialPaydayStart(year: number, month: number) {
  const july2026 = 2026 * 12 + 6;
  const target = year * 12 + month - 1;
  return Math.abs(target - july2026) % 2 === 0 ? 24 : 25;
}

function normalizedCommercialDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    iso: date.toISOString().slice(0, 10),
  };
}

export async function getCommercialMomentAttribution({
  year,
  month,
  eventType,
  monthsBack = 6,
  asOf,
}: CommercialMomentAttributionParams) {
  await requireDashboardTabAccess('channels', 'Sales Channel');
  const svc = createServiceSupabase();
  const windows = Array.from({ length: monthsBack + 1 }, (_, index) => {
    const eventMonth = shiftCommercialMonth(year, month, -index);
    const rawDays = eventType === 'twin'
      ? [eventMonth.month - 1, eventMonth.month, eventMonth.month + 1]
      : (() => {
          const start = commercialPaydayStart(eventMonth.year, eventMonth.month);
          return [start, start + 1, start + 2, start + 3];
        })();
    const eventDates = rawDays.map((day) => normalizedCommercialDate(eventMonth.year, eventMonth.month, day));
    const lastEventDate = eventDates[eventDates.length - 1];
    const postEventDate = normalizedCommercialDate(lastEventDate.year, lastEventDate.month, lastEventDate.day + 1);
    const dates = [...eventDates, postEventDate];
    return { ...eventMonth, dates };
  });

  const assignmentsByDate = new Map<string, Array<{
    eventYear: number;
    eventMonth: number;
    eventPosition: number;
  }>>();

  windows.forEach((window) => {
    window.dates.forEach((date, position) => {
      if (date.iso > asOf) return;
      const assignments = assignmentsByDate.get(date.iso) || [];
      assignments.push({
        eventYear: window.year,
        eventMonth: window.month,
        eventPosition: position,
      });
      assignmentsByDate.set(date.iso, assignments);
    });
  });

  const eventDates = Array.from(assignmentsByDate.keys()).sort();
  if (eventDates.length === 0) return [];

  const summaryRows: any[] = [];
  for (let page = 0; ; page += 1) {
    const { data, error } = await svc
      .from('summary_commercial_order_entry_revenue')
      .select('order_date, product, total_net_sales, same_day_net_sales, carryover_net_sales, before_noon_net_sales')
      .in('order_date', eventDates)
      .order('order_date')
      .order('product')
      .range(page * 1000, page * 1000 + 999);

    if (error) throw new Error(`Gagal memuat summary revenue event: ${error.message}`);
    summaryRows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }

  return summaryRows.flatMap((row) =>
    (assignmentsByDate.get(row.order_date) || []).map((assignment) => ({
      event_year: assignment.eventYear,
      event_month: assignment.eventMonth,
      event_position: assignment.eventPosition,
      order_date: row.order_date,
      product: row.product,
      net_sales: Number(row.total_net_sales || 0),
      same_day_net_sales: Number(row.same_day_net_sales || 0),
      carryover_net_sales: Number(row.carryover_net_sales || 0),
      before_noon_net_sales: Number(row.before_noon_net_sales || 0),
    }))
  );
}
