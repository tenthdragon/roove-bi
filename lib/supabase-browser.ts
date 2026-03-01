import { createBrowserClient } from '@supabase/ssr';
import { useMemo } from 'react';

// Singleton: reuse the same Supabase client across all components
let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (browserClient) return browserClient;
  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return browserClient;
}

/**
 * React hook — returns a stable Supabase client reference.
 * Use this in components instead of calling createClient() directly.
 */
export function useSupabase() {
  return useMemo(() => createClient(), []);
}
