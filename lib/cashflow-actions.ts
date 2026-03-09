// lib/cashflow-actions.ts
'use server';

import { createServiceSupabase } from '@/lib/supabase-server';

/* ── Types ── */

export interface CashFlowLive {
  cashReceived: number;
  cashReceivedOrders: number;
  spillOver: number;
  spillOverOrders: number;
  cashInProgress: number;
  cashInProgressOrders: number;
  overdue: number;
  overdueOrders: number;
  /** Per-channel breakdown keyed by category → channel → { total, orders } */
  byChannel?: ChannelMap;
}

/** category → channel → { total, orders } */
export type ChannelMap = Record<string, Record<string, { total: number; orders: number }>>;

/* ── Channel derivation (mirrors derive_cashflow_channel SQL) ── */

function isBankTransfer(pm: string | null): boolean {
  const v = (pm || '').toLowerCase();
  return v.includes('bank') && v.includes('transfer')
    || v.includes('manual')
    || v === 'transfer'
    || v === 'bank_transfer';
}

function deriveChannel(platform: string | null, isFb: boolean | null, payMethod: string | null): string {
  const p = (platform || '').toLowerCase();
  if (p === 'tiktokshop') return 'TikTok Shop';
  if (p === 'shopee') return 'Shopee';
  if (p === 'lazada' || p === 'blibli' || p === 'tokopedia') return 'MP Lainnya';
  if (isBankTransfer(payMethod) && isFb === true) return 'Scalev Ads (Transfer)';
  if (isBankTransfer(payMethod)) return 'CS Manual (Transfer)';
  if (isFb === true) return 'Scalev Ads (COD)';
  return 'CS Manual (COD)';
}

/* ── Fetch totals (existing) ── */

export async function fetchLiveCashFlow(periodStart: string): Promise<CashFlowLive> {
  const svc = createServiceSupabase();
  const [y, m] = periodStart.split('-').map(Number);

  // Fetch totals + channel breakdown in parallel
  const [totalsRes, channelRes] = await Promise.all([
    svc.rpc('get_live_cashflow', { p_month: m, p_year: y }),
    svc.rpc('get_live_cashflow_by_channel', { p_month: m, p_year: y }),
  ]);

  if (totalsRes.error) {
    console.error('get_live_cashflow RPC error:', totalsRes.error.message);
    throw new Error(totalsRes.error.message);
  }

  const result: CashFlowLive = {
    cashReceived: 0, cashReceivedOrders: 0,
    spillOver: 0, spillOverOrders: 0,
    cashInProgress: 0, cashInProgressOrders: 0,
    overdue: 0, overdueOrders: 0,
  };

  for (const row of (totalsRes.data || [])) {
    if (row.category === 'cash_received') {
      result.cashReceived = Number(row.total);
      result.cashReceivedOrders = Number(row.order_count);
    } else if (row.category === 'spill_over') {
      result.spillOver = Number(row.total);
      result.spillOverOrders = Number(row.order_count);
    } else if (row.category === 'in_progress') {
      result.cashInProgress = Number(row.total);
      result.cashInProgressOrders = Number(row.order_count);
    } else if (row.category === 'overdue') {
      result.overdue = Number(row.total);
      result.overdueOrders = Number(row.order_count);
    }
  }

  // Build channel breakdown (derive channel in JS from raw columns)
  if (!channelRes.error && channelRes.data) {
    const byChannel: ChannelMap = {};
    for (const row of channelRes.data) {
      const cat = row.category as string;
      const ch = deriveChannel(row.platform, row.is_fb, row.pay_method);
      const total = Number(row.total) || 0;
      const orders = Number(row.order_count) || 0;

      if (!byChannel[cat]) byChannel[cat] = {};
      if (!byChannel[cat][ch]) byChannel[cat][ch] = { total: 0, orders: 0 };
      byChannel[cat][ch].total += total;
      byChannel[cat][ch].orders += orders;
    }
    result.byChannel = byChannel;
  } else if (channelRes.error) {
    console.error('get_live_cashflow_by_channel RPC error:', channelRes.error.message);
    // Non-fatal: totals still work, just no channel breakdown
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
