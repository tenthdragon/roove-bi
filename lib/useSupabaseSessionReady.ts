'use client';

import { useEffect, useState } from 'react';
import { useSupabase } from '@/lib/supabase-browser';

const AUTH_READY_EVENTS = new Set([
  'INITIAL_SESSION',
  'SIGNED_IN',
  'SIGNED_OUT',
  'TOKEN_REFRESHED',
  'USER_UPDATED',
  'PASSWORD_RECOVERY',
]);

export function useSupabaseSessionReady() {
  const supabase = useSupabase();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let settled = false;

    const settle = (nextHasSession: boolean) => {
      if (cancelled || settled) return;
      settled = true;
      setHasSession(nextHasSession);
      setReady(true);
    };

    const fallbackTimer = window.setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        settle(Boolean(session));
      } catch {
        settle(false);
      }
    }, 1000);

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!session) {
          window.clearTimeout(fallbackTimer);
          settle(false);
        }
      })
      .catch(() => {
        window.clearTimeout(fallbackTimer);
        settle(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!AUTH_READY_EVENTS.has(event)) return;
      window.clearTimeout(fallbackTimer);
      settle(Boolean(session));
    });

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
      subscription.unsubscribe();
    };
  }, [supabase]);

  return { ready, hasSession };
}
