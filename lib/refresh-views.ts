// lib/refresh-views.ts
// Shared helper to trigger materialized view refresh after data changes.
// Fire-and-forget: callers don't need to wait for completion.

import { createClient } from '@supabase/supabase-js';

// MV3 and MV4 depend on MV1 (mv_daily_order_channel).
// If MV1 fails, skip MV3/MV4 to avoid stale data.
const MV_BASE = 'mv_daily_order_channel';
const MV_DEPENDS_ON_BASE = [
  'mv_daily_channel_complete',
  'mv_daily_product_complete',
];
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
 * Trigger a sequential refresh of all order materialized views.
 * If the base MV (mv_daily_order_channel) fails, dependent MVs
 * (mv_daily_channel_complete, mv_daily_product_complete) are skipped
 * to avoid refreshing them with stale data.
 * Runs in the background — does not throw on failure, only logs.
 */
export function triggerViewRefresh(): void {
  const svc = getServiceSupabase();

  (async () => {
    let baseFailed = false;

    for (const mv of MV_LIST) {
      // Skip dependent MVs if their base MV failed
      if (baseFailed && MV_DEPENDS_ON_BASE.includes(mv)) {
        console.warn(`[refresh-views] ${mv} skipped (${MV_BASE} failed)`);
        continue;
      }

      const { error } = await svc.rpc('refresh_single_mv', { mv_name: mv });
      if (error) {
        console.warn(`[refresh-views] ${mv} failed:`, error.message);
        if (mv === MV_BASE) baseFailed = true;
      } else {
        console.log(`[refresh-views] ${mv} refreshed`);
      }
    }
    console.log('[refresh-views] Background refresh completed');
  })().catch((err) => {
    console.warn('[refresh-views] Background refresh error:', err.message);
  });
}
