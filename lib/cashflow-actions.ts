// lib/cashflow-actions.ts
'use server';

import { createServiceSupabase } from '@/lib/supabase-server';

export interface CashFlowLive {
  cashReceived: number;
  cashReceivedOrders: number;
  spillOver: number;
  spillOverOrders: number;
  cashInProgress: number;
  cashInProgressOrders: number;
}

export async function fetchLiveCashFlow(periodStart: string): Promise<CashFlowLive> {
  const svc = createServiceSupabase();

  // Calculate period boundaries
  const [y, m] = periodStart.split('-').map(Number);
  const periodStartDate = new Date(Date.UTC(y, m - 1, 1));
  const periodEndDate = new Date(Date.UTC(y, m, 1)); // first day of next month
  const bufferStart = new Date(Date.UTC(y, m - 2, 1)); // 1 month buffer for spill over

  // 1. Completed orders — need completed_time from raw_data
  //    Fetch completed orders where shipped_time is within buffer range
  const { data: completedOrders } = await svc
    .from('scalev_orders')
    .select('net_revenue, shipped_time, confirmed_time, raw_data')
    .eq('status', 'completed')
    .gte('synced_at', bufferStart.toISOString());

  // 2. In-progress orders — shipped this month, not yet completed
  const { data: inProgressOrders } = await svc
    .from('scalev_orders')
    .select('net_revenue, shipped_time, confirmed_time')
    .in('status', ['shipped', 'shipped_rts']);

  let cashReceived = 0, cashReceivedOrders = 0;
  let spillOver = 0, spillOverOrders = 0;

  for (const o of (completedOrders || [])) {
    const ctRaw = o.raw_data?.completed_time;
    if (!ctRaw || ctRaw === '') continue;

    const completedAt = new Date(ctRaw);
    // Must be completed within the period
    if (completedAt < periodStartDate || completedAt >= periodEndDate) continue;

    const shippedAt = o.shipped_time
      ? new Date(o.shipped_time)
      : (o.confirmed_time ? new Date(o.confirmed_time) : null);

    const rev = Number(o.net_revenue) || 0;

    if (shippedAt && shippedAt >= periodStartDate) {
      // Shipped AND completed this month
      cashReceived += rev;
      cashReceivedOrders++;
    } else {
      // Shipped before this month, completed this month = spill over
      spillOver += rev;
      spillOverOrders++;
    }
  }

  let cashInProgress = 0, cashInProgressOrders = 0;
  for (const o of (inProgressOrders || [])) {
    const shippedAt = o.shipped_time
      ? new Date(o.shipped_time)
      : (o.confirmed_time ? new Date(o.confirmed_time) : null);

    if (!shippedAt) continue;
    if (shippedAt < periodStartDate || shippedAt >= periodEndDate) continue;

    cashInProgress += Number(o.net_revenue) || 0;
    cashInProgressOrders++;
  }

  return {
    cashReceived, cashReceivedOrders,
    spillOver, spillOverOrders,
    cashInProgress, cashInProgressOrders,
  };
}

// Fetch historical snapshots
export async function fetchCashFlowSnapshots(limit: number = 6) {
  const svc = createServiceSupabase();

  const { data, error } = await svc
    .from('monthly_cashflow_snapshot')
    .select('*')
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false })
    .limit(limit);

  if (error) return [];
  return data || [];
}
