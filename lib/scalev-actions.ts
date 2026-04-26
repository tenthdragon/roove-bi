// lib/scalev-actions.ts
'use server';

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase-server';
import {
  requireAnyDashboardTabAccess,
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from '@/lib/dashboard-access';

async function requireCustomerAnalyticsAccess(label: string) {
  await requireAnyDashboardTabAccess(['pulse', 'customers'], label);
}

async function requireBrandAnalysisAccess(label: string) {
  await requireDashboardTabAccess('brand-analysis', label);
}

async function requireAdminSyncAccess(label: string) {
  await requireDashboardPermissionAccess('admin:sync', label);
}

// ── Get Scalev integration status ──
export async function getScalevStatus() {
  await requireAdminSyncAccess('Admin Sync');

  try {
    const svc = createServiceSupabase();

    // Check if any businesses have API keys configured
    const { count: bizWithApiKeys } = await svc
      .from('scalev_webhook_businesses')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
      .not('api_key', 'is', null);

    const { count: totalOrders } = await svc
      .from('scalev_orders')
      .select('*', { count: 'exact', head: true });

    const { count: shippedOrders } = await svc
      .from('scalev_orders')
      .select('*', { count: 'exact', head: true })
      .not('shipped_time', 'is', null);

    const PRE_TERMINAL = ['pending', 'confirmed', 'processing', 'ready', 'in_process'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();

    const { count: pendingOrders } = await svc
      .from('scalev_orders')
      .select('*', { count: 'exact', head: true })
      .in('status', PRE_TERMINAL)
      .lt('pending_time', todayISO);

    const { data: lastSync } = await svc
      .from('scalev_sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: recentSyncs } = await svc
      .from('scalev_sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(5);

    return {
      configured: (bizWithApiKeys || 0) > 0,
      businessesWithApiKeys: bizWithApiKeys || 0,
      totalOrders: totalOrders || 0,
      shippedOrders: shippedOrders || 0,
      pendingOrders: pendingOrders || 0,
      lastSync: lastSync || null,
      recentSyncs: recentSyncs || [],
    };
  } catch (err: any) {
    console.error('getScalevStatus error:', err.message);
    return {
      configured: false,
      businessesWithApiKeys: 0,
      totalOrders: 0,
      shippedOrders: 0,
      pendingOrders: 0,
      lastSync: null,
      recentSyncs: [],
    };
  }
}

// ── List all pre-terminal orders with line-existence flag ──
export type PendingOrder = {
  id: number;
  order_id: string;
  scalev_id: number | null;
  status: string;
  store_name: string | null;
  business_code: string | null;
  pending_time: string | null;
  synced_at: string | null;
  has_lines: boolean;
};

export async function getPendingOrders(): Promise<PendingOrder[]> {
  await requireAdminSyncAccess('Admin Sync');

  const svc = createServiceSupabase();
  const PRE_TERMINAL = ['pending', 'confirmed', 'processing', 'ready', 'in_process'];

  // Only show orders from before today (today's orders may still be processing normally)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const { data: orders, error } = await svc
    .from('scalev_orders')
    .select('id, order_id, scalev_id, status, store_name, business_code, pending_time, synced_at')
    .in('status', PRE_TERMINAL)
    .lt('pending_time', todayISO)
    .order('pending_time', { ascending: false });

  if (error) throw error;
  if (!orders || orders.length === 0) return [];

  // Batch check which orders have lines
  // Use chunked queries to avoid PostgREST default 1000-row limit
  const orderIds = orders.map(o => o.id);
  const idsWithLines = new Set<number>();
  const chunkSize = 200;
  for (let i = 0; i < orderIds.length; i += chunkSize) {
    const chunk = orderIds.slice(i, i + chunkSize);
    const { data: withLines } = await svc
      .from('scalev_order_lines')
      .select('scalev_order_id')
      .in('scalev_order_id', chunk)
      .limit(10000);
    (withLines || []).forEach(r => idsWithLines.add(r.scalev_order_id));
  }

  return orders.map(o => ({
    ...o,
    has_lines: idsWithLines.has(o.id),
  }));
}

export type ScalevFinancialsV2ReconciliationSummary = {
  total_orders: number;
  shipping_discount_unknown_orders: number;
  discount_code_discount_unknown_orders: number;
  header_net_matches_line_product_net_orders: number;
  header_net_differs_from_line_product_net_orders: number;
  shipping_discount_missing_with_shipping_orders: number;
};

export type ScalevFinancialsV2GapBucket = {
  gap_amount: number | null;
  order_count: number;
};

export type ScalevFinancialsV2SampleOrder = {
  scalev_order_id: number;
  order_id: string;
  business_code: string | null;
  source: string | null;
  status: string | null;
  scalev_final_net_revenue: number | null;
  line_product_net_amount: number | null;
  shipping_gross_amount: number | null;
  shipping_discount_amount: number | null;
  audit_header_minus_line_product_net: number | null;
};

function normalizeScalevFinancialsV2SampleOrders(rows: any[] | null | undefined): ScalevFinancialsV2SampleOrder[] {
  return (rows || []).map((row: any) => ({
    scalev_order_id: Number(row.scalev_order_id),
    order_id: row.order_id,
    business_code: row.business_code ?? null,
    source: row.source ?? null,
    status: row.status ?? null,
    scalev_final_net_revenue: row.scalev_final_net_revenue == null ? null : Number(row.scalev_final_net_revenue),
    line_product_net_amount: row.line_product_net_amount == null ? null : Number(row.line_product_net_amount),
    shipping_gross_amount: row.shipping_gross_amount == null ? null : Number(row.shipping_gross_amount),
    shipping_discount_amount: row.shipping_discount_amount == null ? null : Number(row.shipping_discount_amount),
    audit_header_minus_line_product_net: row.audit_header_minus_line_product_net == null ? null : Number(row.audit_header_minus_line_product_net),
  }));
}

export async function getScalevOrderFinancialsV2Reconciliation(sampleLimit = 20): Promise<{
  summary: ScalevFinancialsV2ReconciliationSummary;
  gapDistribution: ScalevFinancialsV2GapBucket[];
  samples: {
    headerMatchesLineProductNet: ScalevFinancialsV2SampleOrder[];
    headerDiffersFromLineProductNet: ScalevFinancialsV2SampleOrder[];
    shippingDiscountUnknownWithShipping: ScalevFinancialsV2SampleOrder[];
  };
}> {
  await requireAdminSyncAccess('Admin Sync');

  const svc = createServiceSupabase();
  const safeLimit = Math.min(Math.max(Math.trunc(sampleLimit) || 20, 1), 100);
  const sampleColumns = [
    'scalev_order_id',
    'order_id',
    'business_code',
    'source',
    'status',
    'scalev_final_net_revenue',
    'line_product_net_amount',
    'shipping_gross_amount',
    'shipping_discount_amount',
    'audit_header_minus_line_product_net',
  ].join(', ');

  const [
    { data: summary, error: summaryError },
    { data: gapDistribution, error: gapDistributionError },
    { data: headerMatchesLineProductNet, error: headerMatchesError },
    { data: headerDiffersFromLineProductNet, error: headerDiffersError },
    { data: shippingDiscountUnknownWithShipping, error: shippingUnknownError },
  ] = await Promise.all([
    svc
      .from('v_scalev_order_financials_v2_reconciliation')
      .select('*')
      .maybeSingle(),
    svc
      .from('v_scalev_order_financials_v2_gap_distribution')
      .select('*')
      .order('gap_amount', { ascending: true }),
    svc
      .from('v_scalev_order_financials_v2')
      .select(sampleColumns)
      .eq('audit_header_minus_line_product_net', 0)
      .order('scalev_order_id', { ascending: false })
      .limit(safeLimit),
    svc
      .from('v_scalev_order_financials_v2')
      .select(sampleColumns)
      .not('audit_header_minus_line_product_net', 'is', null)
      .neq('audit_header_minus_line_product_net', 0)
      .order('scalev_order_id', { ascending: false })
      .limit(safeLimit),
    svc
      .from('v_scalev_order_financials_v2')
      .select(sampleColumns)
      .gt('shipping_gross_amount', 0)
      .is('shipping_discount_amount', null)
      .order('scalev_order_id', { ascending: false })
      .limit(safeLimit),
  ]);

  if (summaryError) throw summaryError;
  if (gapDistributionError) throw gapDistributionError;
  if (headerMatchesError) throw headerMatchesError;
  if (headerDiffersError) throw headerDiffersError;
  if (shippingUnknownError) throw shippingUnknownError;

  return {
    summary: {
      total_orders: Number(summary?.total_orders || 0),
      shipping_discount_unknown_orders: Number(summary?.shipping_discount_unknown_orders || 0),
      discount_code_discount_unknown_orders: Number(summary?.discount_code_discount_unknown_orders || 0),
      header_net_matches_line_product_net_orders: Number(summary?.header_net_matches_line_product_net_orders || 0),
      header_net_differs_from_line_product_net_orders: Number(summary?.header_net_differs_from_line_product_net_orders || 0),
      shipping_discount_missing_with_shipping_orders: Number(summary?.shipping_discount_missing_with_shipping_orders || 0),
    },
    gapDistribution: (gapDistribution || []).map((row: any) => ({
      gap_amount: row.gap_amount == null ? null : Number(row.gap_amount),
      order_count: Number(row.order_count || 0),
    })),
    samples: {
      headerMatchesLineProductNet: normalizeScalevFinancialsV2SampleOrders(headerMatchesLineProductNet),
      headerDiffersFromLineProductNet: normalizeScalevFinancialsV2SampleOrders(headerDiffersFromLineProductNet),
      shippingDiscountUnknownWithShipping: normalizeScalevFinancialsV2SampleOrders(shippingDiscountUnknownWithShipping),
    },
  };
}

// ── Save Scalev API key (owner only) ──
export async function saveScalevApiKey(apiKey: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'owner') throw new Error('Only owners can configure Scalev');

  const svc = createServiceSupabase();

  await svc.from('scalev_config').update({ is_active: false }).eq('is_active', true);

  const { error } = await svc.from('scalev_config').insert({
    api_key: apiKey,
    base_url: 'https://api.scalev.id/v2',
    is_active: true,
    last_sync_id: 0,
  });

  if (error) throw error;
  return { success: true };
}


// ── Get daily order summary (for dashboard) ──
export async function fetchScalevDailySummary(from: string, to: string) {
  const svc = createServiceSupabase();

  const { data, error } = await svc
    .from('v_daily_order_summary')
    .select('*')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });

  if (error) throw error;
  return data;
}

// ── Get daily channel summary (for dashboard) ──
export async function fetchScalevChannelSummary(from: string, to: string) {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('v_daily_channel_summary')
    .select('*')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });
  if (error) throw error;
  return data;
}

// ── Get daily new vs repeat customer data ──
export async function fetchCustomerTypeDaily(from: string, to: string) {
  await requireCustomerAnalyticsAccess('Analytics Pelanggan');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('v_daily_customer_type')
    .select('*')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function fetchCustomerCohort(limit: number = 100, from?: string, to?: string) {
  await requireCustomerAnalyticsAccess('Analytics Pelanggan');
  const svc = createServiceSupabase();
  let query = svc
    .from('v_customer_cohort')
    .select('*');

  if (from) query = query.gte('last_order_date', from);
  if (to) query = query.lte('last_order_date', to);

  const { data, error } = await query
    .order('total_revenue', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// ── Get overall customer KPIs ──
export async function fetchCustomerKPIs(from: string, to: string) {
  await requireCustomerAnalyticsAccess('Analytics Pelanggan');
  const svc = createServiceSupabase();

  const { data: dailyData, error } = await svc
    .from('v_daily_customer_type')
    .select('*')
    .gte('date', from)
    .lte('date', to);

  if (error) throw error;

  if (!dailyData || dailyData.length === 0) {
    return {
      totalCustomers: 0,
      newCustomers: 0,
      repeatCustomers: 0,
      unidentifiedCustomers: 0,
      repeatRate: 0,
      newRevenue: 0,
      repeatRevenue: 0,
      unidentifiedRevenue: 0,
      avgOrderValue: 0,
      newOrders: 0,
      repeatOrders: 0,
      unidentifiedOrders: 0,
      totalRevenue: 0,
      totalOrders: 0,
    };
  }

  let newCustomers = 0, repeatCustomers = 0, unidentifiedCustomers = 0;
  let newRevenue = 0, repeatRevenue = 0, unidentifiedRevenue = 0;
  let newOrders = 0, repeatOrders = 0, unidentifiedOrders = 0;

  for (const row of dailyData) {
    if (row.customer_type === 'new') {
      newCustomers += row.customer_count || 0;
      newRevenue += Number(row.revenue) || 0;
      newOrders += row.order_count || 0;
    } else if (row.customer_type === 'ro' || row.customer_type === 'repeat') {
      repeatCustomers += row.customer_count || 0;
      repeatRevenue += Number(row.revenue) || 0;
      repeatOrders += row.order_count || 0;
    } else if (row.customer_type === 'unidentified') {
      unidentifiedCustomers += row.customer_count || 0;
      unidentifiedRevenue += Number(row.revenue) || 0;
      unidentifiedOrders += row.order_count || 0;
    }
  }

  const totalCustomers = newCustomers + repeatCustomers;
  const totalOrders = newOrders + repeatOrders + unidentifiedOrders;
  const totalRevenue = newRevenue + repeatRevenue + unidentifiedRevenue;

  return {
    totalCustomers,
    newCustomers,
    repeatCustomers,
    unidentifiedCustomers,
    repeatRate: totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0,
    newRevenue,
    repeatRevenue,
    unidentifiedRevenue,
    avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    newOrders,
    repeatOrders,
    unidentifiedOrders,
    totalRevenue,
    totalOrders,
  };
}

// ── Get monthly cohort data ──
export async function fetchMonthlyCohort() {
  await requireCustomerAnalyticsAccess('Analytics Pelanggan');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('v_monthly_cohort')
    .select('*')
    .order('cohort_month', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── Get monthly cohort data per channel group ──
export async function fetchMonthlyCohortByChannel() {
  await requireCustomerAnalyticsAccess('Analytics Pelanggan');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('v_monthly_cohort_channel')
    .select('*')
    .order('channel_group', { ascending: true })
    .order('cohort_month', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── Get per-channel LTV 90-day for Roove brand ──
export async function fetchChannelLtv90d(brand?: string | null) {
  await requireCustomerAnalyticsAccess('LTV Customer Analytics');
  const svc = createServiceSupabase();
  const { data, error } = await svc.rpc('get_channel_ltv_90d', {
    brand_filter: brand || null,
  });
  if (error) throw error;
  return data || [];
}

// ── Get conservative CAC per channel ──
export async function fetchChannelCac() {
  await requireCustomerAnalyticsAccess('CAC Customer Analytics');
  const svc = createServiceSupabase();
  const { data, error } = await svc.rpc('get_channel_cac');
  if (error) throw error;
  return data || [];
}

// ── Get LTV 90d trend per cohort month per channel ──
export async function fetchLtvTrend(brand?: string | null) {
  await requireCustomerAnalyticsAccess('LTV Customer Analytics');
  const svc = createServiceSupabase();
  const { data, error } = await svc.rpc('get_ltv_trend_by_cohort', {
    brand_filter: brand || null,
  });
  if (error) throw error;
  return data || [];
}

// ── Get available brands for selector ──
export async function fetchAvailableBrands() {
  await requireCustomerAnalyticsAccess('Brand Customer Analytics');
  const svc = createServiceSupabase();
  const { data, error } = await svc.rpc('get_available_brands');
  if (error) throw error;
  return data || [];
}

// ── Get monthly CAC per channel ──
export async function fetchMonthlyCac(brand?: string | null) {
  await requireCustomerAnalyticsAccess('CAC Customer Analytics');
  const svc = createServiceSupabase();
  const { data, error } = await svc.rpc('get_monthly_cac', {
    brand_filter: brand || null,
  });
  if (error) throw error;
  return data || [];
}

// ── Get RTS and Canceled order stats with platform breakdown ──
export async function fetchRtsCancelStats(from?: string, to?: string) {
  await requireCustomerAnalyticsAccess('Analytics Pelanggan');
  const svc = createServiceSupabase();

  // Get total shipped+completed for percentage denominator
  let baseQuery = svc
    .from('scalev_orders')
    .select('*', { count: 'exact', head: true })
    .in('status', ['completed', 'shipped']);
  if (from) baseQuery = baseQuery.gte('shipped_time', from);
  if (to) baseQuery = baseQuery.lte('shipped_time', to + 'T23:59:59');
  const { count: totalShipped } = await baseQuery;

  // Get RTS + canceled orders
  let query = svc
    .from('scalev_orders')
    .select('status, platform')
    .in('status', ['rts', 'canceled']);
  if (from) query = query.gte('shipped_time', from);
  if (to) query = query.lte('shipped_time', to + 'T23:59:59');
  const { data, error } = await query;
  if (error) throw error;

  const result = {
    totalShipped: totalShipped || 0,
    rts: { total: 0, byPlatform: {} as Record<string, number> },
    canceled: { total: 0, byPlatform: {} as Record<string, number> },
  };

  for (const row of (data || [])) {
    const bucket = row.status === 'rts' ? result.rts : result.canceled;
    bucket.total++;
    const p = row.platform || 'unknown';
    const group = (p === 'scalev' || p === '') ? 'SCV'
      : (p === 'tiktokshop' || p === 'tiktok') ? 'TTS'
      : p === 'shopee' ? 'Shopee'
      : 'Other';
    bucket.byPlatform[group] = (bucket.byPlatform[group] || 0) + 1;
  }

  return result;
}

// ═══════════════════════════════════════════════════
// BRAND ANALYSIS
// ═══════════════════════════════════════════════════

// ── Cross-brand matrix ──
export async function fetchCrossBrandMatrix() {
  await requireBrandAnalysisAccess('Brand Analysis');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('mv_cross_brand_matrix')
    .select('*')
    .order('brand_from', { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── Multi-brand customer stats (pre-aggregated) ──
export async function fetchMultiBrandStats() {
  await requireBrandAnalysisAccess('Brand Analysis');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('v_brand_analysis_summary')
    .select('*');
  if (error) throw error;

  const segments: Record<string, any> = {};
  const distribution: Record<number, number> = {};
  const gateway: { brand: string; count: number }[] = [];
  const crossType: Record<string, number> = {};

  for (const row of (data || [])) {
    if (row.stat_type === 'segment') {
      segments[row.key] = {
        customerCount: parseInt(row.value1) || 0,
        totalOrders: parseInt(row.value2) || 0,
        totalRevenue: parseFloat(row.value3) || 0,
        avgOrderValue: parseFloat(row.value4) || 0,
      };
    } else if (row.stat_type === 'distribution') {
      distribution[parseInt(row.key)] = parseInt(row.value1) || 0;
    } else if (row.stat_type === 'gateway') {
      gateway.push({ brand: row.key, count: parseInt(row.value1) || 0 });
    } else if (row.stat_type === 'cross_type') {
      crossType[row.key] = parseInt(row.value1) || 0;
    }
  }

  return { segments, distribution, gateway, crossType };
}

// ── Brand journey transitions ──
export async function fetchBrandJourney() {
  await requireBrandAnalysisAccess('Brand Analysis');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('mv_brand_journey')
    .select('*')
    .order('customer_count', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── Customer-brand map (per brand summary) ──
export async function fetchBrandSummary() {
  await requireBrandAnalysisAccess('Brand Analysis');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('mv_customer_brand_map')
    .select('brand, customer_identifier, order_count, total_revenue');
  if (error) throw error;
  return data || [];
}

// ── Last refresh time ──
export async function fetchBrandAnalysisRefreshTime() {
  await requireBrandAnalysisAccess('Brand Analysis');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('mv_refresh_log')
    .select('refreshed_at, triggered_by')
    .eq('view_name', 'brand_analysis')
    .order('refreshed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── Trigger refresh ──
export async function refreshBrandAnalysis() {
  await requireBrandAnalysisAccess('Brand Analysis');
  const svc = createServiceSupabase();
  const { error } = await svc.rpc('refresh_brand_analysis');
  if (error) throw error;
  
  const { error: logError } = await svc.from('mv_refresh_log').insert({
    view_name: 'brand_analysis',
    triggered_by: 'manual',
  });
  if (logError) throw logError;
  
  return { success: true };
}
