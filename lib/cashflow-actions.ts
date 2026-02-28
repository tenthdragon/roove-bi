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
  const [y, m] = periodStart.split('-').map(Number);

  const { data, error } = await svc.rpc('get_live_cashflow', {
    p_month: m,
    p_year: y,
  });

  if (error) {
    console.error('get_live_cashflow RPC error:', error.message);
    return {
      cashReceived: 0, cashReceivedOrders: 0,
      spillOver: 0, spillOverOrders: 0,
      cashInProgress: 0, cashInProgressOrders: 0,
    };
  }

  const result: CashFlowLive = {
    cashReceived: 0, cashReceivedOrders: 0,
    spillOver: 0, spillOverOrders: 0,
    cashInProgress: 0, cashInProgressOrders: 0,
  };

  for (const row of (data || [])) {
    if (row.category === 'cash_received') {
      result.cashReceived = Number(row.total);
      result.cashReceivedOrders = Number(row.order_count);
    } else if (row.category === 'spill_over') {
      result.spillOver = Number(row.total);
      result.spillOverOrders = Number(row.order_count);
    } else if (row.category === 'in_progress') {
      result.cashInProgress = Number(row.total);
      result.cashInProgressOrders = Number(row.order_count);
    }
  }

  return result;
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
