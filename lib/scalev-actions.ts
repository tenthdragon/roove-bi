// lib/scalev-actions.ts
'use server';

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase-server';

// ── Get Scalev integration status ──
export async function getScalevStatus() {
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

    const PRE_TERMINAL = ['pending', 'confirmed', 'processing', 'ready'];
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
  const svc = createServiceSupabase();
  const PRE_TERMINAL = ['pending', 'confirmed', 'processing', 'ready'];

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

  // Batch check which orders have lines (1 query, not N)
  const orderIds = orders.map(o => o.id);
  const { data: withLines } = await svc
    .from('scalev_order_lines')
    .select('scalev_order_id')
    .in('scalev_order_id', orderIds);

  const idsWithLines = new Set((withLines || []).map(r => r.scalev_order_id));

  return orders.map(o => ({
    ...o,
    has_lines: idsWithLines.has(o.id),
  }));
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
  const svc = createServiceSupabase();

  const { data: dailyData } = await svc
    .from('v_daily_customer_type')
    .select('*')
    .gte('date', from)
    .lte('date', to);

  if (!dailyData || dailyData.length === 0) {
    return {
      totalCustomers: 0,
      newCustomers: 0,
      repeatCustomers: 0,
      repeatRate: 0,
      newRevenue: 0,
      repeatRevenue: 0,
      avgOrderValue: 0,
      newOrders: 0,
      repeatOrders: 0,
    };
  }

  let newCustomers = 0, repeatCustomers = 0;
  let newRevenue = 0, repeatRevenue = 0;
  let newOrders = 0, repeatOrders = 0;

  for (const row of dailyData) {
    if (row.customer_type === 'new') {
      newCustomers += row.customer_count || 0;
      newRevenue += Number(row.revenue) || 0;
      newOrders += row.order_count || 0;
    } else {
      repeatCustomers += row.customer_count || 0;
      repeatRevenue += Number(row.revenue) || 0;
      repeatOrders += row.order_count || 0;
    }
  }

  const totalCustomers = newCustomers + repeatCustomers;
  const totalOrders = newOrders + repeatOrders;
  const totalRevenue = newRevenue + repeatRevenue;

  return {
    totalCustomers,
    newCustomers,
    repeatCustomers,
    repeatRate: totalCustomers > 0 ? (repeatCustomers / totalCustomers) * 100 : 0,
    newRevenue,
    repeatRevenue,
    avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    newOrders,
    repeatOrders,
  };
}

// ── Get monthly cohort data ──
export async function fetchMonthlyCohort() {
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
export async function fetchChannelLtv90d() {
  const svc = createServiceSupabase();
  const { data, error } = await svc.rpc('get_channel_ltv_90d');
  if (error) throw error;
  return data || [];
}

// ── Get conservative CAC per channel ──
export async function fetchChannelCac() {
  const svc = createServiceSupabase();
  const { data, error } = await svc.rpc('get_channel_cac');
  if (error) throw error;
  return data || [];
}

// ── Get LTV 90d trend per cohort month per channel ──
export async function fetchLtvTrend() {
  const svc = createServiceSupabase();
  const { data, error } = await svc.rpc('get_ltv_trend_by_cohort');
  if (error) throw error;
  return data || [];
}

// ── Get RTS and Canceled order stats with platform breakdown ──
export async function fetchRtsCancelStats(from?: string, to?: string) {
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
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('mv_customer_brand_map')
    .select('brand, customer_identifier, order_count, total_revenue');
  if (error) throw error;
  return data || [];
}

// ── Last refresh time ──
export async function fetchBrandAnalysisRefreshTime() {
  const svc = createServiceSupabase();
  const { data } = await svc
    .from('mv_refresh_log')
    .select('refreshed_at, triggered_by')
    .eq('view_name', 'brand_analysis')
    .order('refreshed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

// ── Trigger refresh ──
export async function refreshBrandAnalysis() {
  const svc = createServiceSupabase();
  const { error } = await svc.rpc('refresh_brand_analysis');
  if (error) throw error;
  
  await svc.from('mv_refresh_log').insert({
    view_name: 'brand_analysis',
    triggered_by: 'manual',
  });
  
  return { success: true };
}
