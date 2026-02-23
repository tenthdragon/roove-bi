// lib/scalev-actions.ts
'use server';

import { createServerSupabase, createServiceSupabase } from '@/lib/supabase-server';

// ── Get Scalev integration status ──
export async function getScalevStatus() {
  try {
    const svc = createServiceSupabase();

    const { data: config } = await svc
      .from('scalev_config')
      .select('id, base_url, is_active, last_sync_id, updated_at')
      .eq('is_active', true)
      .single();

    const { count: totalOrders } = await svc
      .from('scalev_orders')
      .select('*', { count: 'exact', head: true });

    const { count: shippedOrders } = await svc
      .from('scalev_orders')
      .select('*', { count: 'exact', head: true })
      .not('shipped_time', 'is', null);

    const { data: lastSync } = await svc
      .from('scalev_sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    const { data: recentSyncs } = await svc
      .from('scalev_sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(5);

    return {
      configured: !!config,
      configId: config?.id || null,
      lastSyncId: config?.last_sync_id || 0,
      totalOrders: totalOrders || 0,
      shippedOrders: shippedOrders || 0,
      lastSync: lastSync || null,
      recentSyncs: recentSyncs || [],
    };
  } catch (err: any) {
    console.error('getScalevStatus error:', err.message);
    return {
      configured: false,
      configId: null,
      lastSyncId: 0,
      totalOrders: 0,
      shippedOrders: 0,
      lastSync: null,
      recentSyncs: [],
    };
  }
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

// ── Trigger manual sync (owner only) ──
export async function triggerScalevSync(mode: 'incremental' | 'full' = 'incremental') {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const res = await fetch(`${baseUrl}/api/scalev-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify({ mode }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sync failed: ${text}`);
  }

  return await res.json();
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

// ── Get customer cohort summary (top repeat customers, etc) ──
export async function fetchCustomerCohort(limit: number = 100) {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('v_customer_cohort')
    .select('*')
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
