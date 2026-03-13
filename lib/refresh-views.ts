// lib/refresh-views.ts
// Shared helper to trigger materialized view refresh after data changes.
// Fire-and-forget: callers don't need to wait for completion.

import { createClient } from '@supabase/supabase-js';

const MV_LIST = [
  'mv_daily_order_channel',
  'mv_daily_ads_by_brand',
  'mv_daily_channel_complete',
  'mv_daily_product_complete',
  'mv_daily_customer_type',
  'mv_customer_cohort',
  'mv_monthly_cohort',
];

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Trigger a concurrent refresh of all order materialized views.
 * Refreshes one MV at a time to avoid PostgREST statement timeout.
 * Runs in the background — does not throw on failure, only logs.
 */
export function triggerViewRefresh(): void {
  const svc = getServiceSupabase();

  (async () => {
    for (const mv of MV_LIST) {
      const { error } = await svc.rpc('refresh_single_mv', { mv_name: mv });
      if (error) {
        console.warn(`[refresh-views] ${mv} failed:`, error.message);
      } else {
        console.log(`[refresh-views] ${mv} refreshed`);
      }
    }
    console.log('[refresh-views] Background refresh completed');
  })().catch((err) => {
    console.warn('[refresh-views] Background refresh error:', err.message);
  });
}
