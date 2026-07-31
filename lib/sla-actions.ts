// lib/sla-actions.ts
'use server';

import { requireDashboardTabAccess } from '@/lib/dashboard-access';
import { createServiceSupabase } from '@/lib/supabase-server';
import { ROOVE_WORKSPACE_ID } from '@/lib/workspaces';

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
  const { workspaceId } = await requireDashboardTabAccess('channels', 'Sales Channel');

  const svc = createServiceSupabase();

  // Keep Roove's established RPC behavior unchanged. New workspaces use the
  // tenant-aware equivalent so a service-role query can never aggregate
  // another workspace's orders.
  const { data, error } = workspaceId === ROOVE_WORKSPACE_ID
    ? await svc.rpc('get_channel_sla', {
        p_from: from,
        p_to: to,
      })
    : await svc.rpc('get_workspace_channel_sla', {
        p_workspace_id: workspaceId,
        p_from: from,
        p_to: to,
      });

  if (error) {
    console.error('[sla-actions] RPC error:', error.message);
    return [];
  }

  return (data || []) as SlaRow[];
}
