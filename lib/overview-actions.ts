'use server';

import { unstable_cache } from 'next/cache';
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

interface OverviewCm3HistoryParams {
  to: string;
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

async function fetchAllDateRangeRows(
  svc: ReturnType<typeof createServiceSupabase>,
  table: string,
  columns: string,
  workspaceId: string,
  from: string,
  to: string,
) {
  const pageSize = 1000;
  const rows: any[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const result = await svc.from(table)
      .select(columns)
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to)
      .order('date')
      .range(offset, offset + pageSize - 1);

    if (result.error) throw new Error(result.error.message);
    const page = result.data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
}

async function loadOverviewCm3Month(workspaceId: string, from: string, to: string) {
  const svc = createServiceSupabase();
  const [daily, ads, channel, shipping, overhead] = await Promise.all([
    fetchAllDateRangeRows(svc, 'daily_product_summary', 'date, product, net_sales, gross_profit', workspaceId, from, to)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: `Histori CM3: ${error.message}` })),
    fetchAllDateRangeRows(svc, 'daily_ads_spend', 'date, spent', workspaceId, from, to)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: `Histori marketing fee CM3: ${error.message}` })),
    fetchAllDateRangeRows(svc, 'daily_channel_data', 'date, product, mp_admin_cost', workspaceId, from, to)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: `Histori MP fee CM3: ${error.message}` })),
    getShippingFeeRange(workspaceId, from, to)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: `Histori shipping fee CM3: ${error.message}` })),
    svc.rpc('get_workspace_monthly_overhead', {
      p_workspace_id: workspaceId,
      p_date_from: from,
      p_date_to: to,
    })
      .then(({ data, error }) => error
        ? { data: [], error: `Histori overhead: ${error.message}` }
        : { data: data || [], error: null }),
  ]);

  return {
    daily: daily.data,
    ads: ads.data,
    channel: channel.data,
    shipping: shipping.data,
    overhead: overhead.data,
    errors: [daily.error, ads.error, channel.error, shipping.error, overhead.error].filter(Boolean),
  };
}

const getCompletedOverviewCm3Month = unstable_cache(
  loadOverviewCm3Month,
  ['overview-cm3-month-completed-v3'],
  { revalidate: 86400, tags: ['overview-cm3-history'] },
);

const getActiveOverviewCm3Month = unstable_cache(
  loadOverviewCm3Month,
  ['overview-cm3-month-active-v2'],
  { revalidate: 300, tags: ['overview-cm3-history-active'] },
);

export async function getOverviewCm3HistoryData({
  to,
  accessScope = 'overview',
}: OverviewCm3HistoryParams) {
  const { workspaceId } = await requireDashboardTabAccess(
    accessScope,
    accessScope === 'channels' ? 'Sales Channel' : 'Overview',
  );
  const historyEnd = new Date(`${to}T00:00:00Z`);
  const historyStartDate = new Date(Date.UTC(
    historyEnd.getUTCFullYear(),
    historyEnd.getUTCMonth() - 11,
    1,
  ));
  const historyFrom = historyStartDate.toISOString().slice(0, 10);
  const historyMonths: Array<{ from: string; to: string; active: boolean }> = [];
  const historyCursor = new Date(historyStartDate);
  const historyEndMonth = to.slice(0, 7);

  while (historyCursor.toISOString().slice(0, 7) <= historyEndMonth) {
    const year = historyCursor.getUTCFullYear();
    const monthIndex = historyCursor.getUTCMonth();
    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    const monthFrom = `${monthKey}-01`;
    const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 0))
      .toISOString()
      .slice(0, 10);
    historyMonths.push({
      from: monthFrom,
      to: monthKey === historyEndMonth ? to : monthEnd,
      active: monthKey === historyEndMonth,
    });
    historyCursor.setUTCMonth(historyCursor.getUTCMonth() + 1);
  }

  const historyMonthResults = await Promise.all(historyMonths.map((range) =>
    range.active
      ? getActiveOverviewCm3Month(workspaceId, range.from, range.to)
      : getCompletedOverviewCm3Month(workspaceId, range.from, range.to)
  ));

  return {
    from: historyFrom,
    to,
    daily: historyMonthResults.flatMap((month) => month.daily),
    ads: historyMonthResults.flatMap((month) => month.ads),
    channel: historyMonthResults.flatMap((month) => month.channel),
    shipping: historyMonthResults.flatMap((month) => month.shipping),
    overhead: historyMonthResults.flatMap((month) => month.overhead),
    error: historyMonthResults
      .flatMap((month) => month.errors)
      .join(' | ') || null,
  };
}

export async function getOverviewCoreData({
  from,
  to,
  prevFrom,
  prevTo,
}: OverviewFeeDataParams) {
  const { workspaceId } = await requireDashboardTabAccess('overview', 'Overview');

  const svc = createServiceSupabase();
  const [dailyRes, shipmentRes, overheadRes, prevDailyRes, prevOverheadRes] = await Promise.all([
    svc.from('daily_product_summary')
      .select('*')
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to)
      .order('date'),
    svc.rpc('get_workspace_daily_shipment_counts', {
      p_workspace_id: workspaceId,
      p_from: from,
      p_to: to,
    }),
    svc.rpc('get_workspace_monthly_overhead', {
      p_workspace_id: workspaceId,
      p_date_from: from,
      p_date_to: to,
    }),
    svc.from('daily_product_summary')
      .select('*')
      .eq('workspace_id', workspaceId)
      .gte('date', prevFrom)
      .lte('date', prevTo)
      .order('date'),
    svc.rpc('get_workspace_monthly_overhead', {
      p_workspace_id: workspaceId,
      p_date_from: prevFrom,
      p_date_to: prevTo,
    }),
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
  const { workspaceId } = await requireDashboardTabAccess('overview', 'Overview');

  const svc = createServiceSupabase();

  const [adsRes, channelRes, shippingRes, prevAdsRes, prevChannelRes, prevShippingRes] = await Promise.all([
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to),
    svc.from('daily_channel_data')
      .select('date, channel, product, mp_admin_cost')
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to),
    getShippingFeeRange(workspaceId, from, to)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: { message: error.message } })),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .eq('workspace_id', workspaceId)
      .gte('date', prevFrom)
      .lte('date', prevTo),
    svc.from('daily_channel_data')
      .select('date, channel, product, mp_admin_cost')
      .eq('workspace_id', workspaceId)
      .gte('date', prevFrom)
      .lte('date', prevTo),
    getShippingFeeRange(workspaceId, prevFrom, prevTo)
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
  const { workspaceId } = await requireDashboardTabAccess(
    accessScope,
    accessScope === 'channels' ? 'Sales Channel' : 'Overview',
  );

  const svc = createServiceSupabase();

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
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to)
      .order('date'),
    svc.rpc('get_workspace_daily_shipment_counts', {
      p_workspace_id: workspaceId,
      p_from: from,
      p_to: to,
    }),
    svc.rpc('get_workspace_monthly_overhead', {
      p_workspace_id: workspaceId,
      p_date_from: from,
      p_date_to: to,
    }),
    svc.from('daily_product_summary')
      .select(OVERVIEW_DAILY_SUMMARY_COLUMNS)
      .eq('workspace_id', workspaceId)
      .gte('date', prevFrom)
      .lte('date', prevTo)
      .order('date'),
    svc.rpc('get_workspace_monthly_overhead', {
      p_workspace_id: workspaceId,
      p_date_from: prevFrom,
      p_date_to: prevTo,
    }),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to),
    svc.from('daily_channel_data')
      .select('date, channel, product, mp_admin_cost')
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to),
    getShippingFeeRange(workspaceId, from, to)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: { message: error.message } })),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store')
      .eq('workspace_id', workspaceId)
      .gte('date', prevFrom)
      .lte('date', prevTo),
    svc.from('daily_channel_data')
      .select('date, channel, product, mp_admin_cost')
      .eq('workspace_id', workspaceId)
      .gte('date', prevFrom)
      .lte('date', prevTo),
    getShippingFeeRange(workspaceId, prevFrom, prevTo)
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
  const { workspaceId } = await requireDashboardTabAccess(
    'channels',
    'Sales Channel',
  );

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
      .eq('workspace_id', workspaceId)
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
  const { workspaceId } = await requireDashboardTabAccess(
    'channels',
    'Sales Channel',
  );
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
      .eq('workspace_id', workspaceId)
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
