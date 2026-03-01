// lib/refresh-views.ts
// Shared helper to trigger materialized view refresh after data changes.
// Fire-and-forget: callers don't need to wait for completion.

import { createClient } from '@supabase/supabase-js';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Trigger a concurrent refresh of all order materialized views.
 * Runs in the background — does not throw on failure, only logs.
 */
export function triggerViewRefresh(): void {
  const svc = getServiceSupabase();
  svc.rpc('refresh_order_views', { use_concurrent: true })
    .then(({ error }) => {
      if (error) {
        console.warn('[refresh-views] Background refresh failed:', error.message);
      } else {
        console.log('[refresh-views] Background refresh completed');
      }
    })
    .catch((err) => {
      console.warn('[refresh-views] Background refresh error:', err.message);
    });
}
