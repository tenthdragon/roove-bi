import type { SupabaseClient } from '@supabase/supabase-js';
import { shiftDay } from './meta-funnel-domain';
import { getTodayWIB } from './sync-schedule';

// Re-read the boundary day: the last snapshot may have been partial or Meta
// may have updated attribution. Failed requests never advance persisted state.
export function incrementalMetaRange(lastDate: string | null, end: string, fallback = end) {
  return { from: lastDate && lastDate < fallback ? lastDate : fallback, to: end };
}
export async function metaSpendRange(svc: SupabaseClient, workspaceId: string, today = getTodayWIB()) {
  const { data, error } = await svc.from('meta_sync_log').select('date_range_end')
    .eq('workspace_id', workspaceId).eq('status', 'success')
    .order('date_range_end', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  // Spend includes today's partial data; always finalize yesterday as well.
  return incrementalMetaRange(data?.date_range_end || null, today, shiftDay(today, -1));
}
export async function metaAdAccountRange(svc: SupabaseClient, workspaceId: string, accountId: string, today = getTodayWIB()) {
  const end = shiftDay(today, -1);
  const { data, error } = await svc.from('meta_ad_sync_coverage').select('metric_date')
    .eq('workspace_id', workspaceId).eq('account_id', accountId)
    .lte('metric_date', end).order('metric_date', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return incrementalMetaRange(data?.metric_date || null, end);
}
