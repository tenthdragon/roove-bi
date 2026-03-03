// lib/sla-actions.ts
'use server';

import { createServiceSupabase } from '@/lib/supabase-server';

export interface SlaRow {
  sales_channel: string;
  payment_type: string;
  orders: number;
  avg_days: number;
  median_days: number;
  p90_days: number;
  min_days: number;
  max_days: number;
}

export async function fetchChannelSla(from: string, to: string): Promise<SlaRow[]> {
  const svc = createServiceSupabase();

  const { data, error } = await svc.rpc('get_channel_sla', {
    p_from: from,
    p_to: to,
  });

  if (error) {
    console.error('[sla-actions] RPC error:', error.message);
    return [];
  }

  return (data || []) as SlaRow[];
}
