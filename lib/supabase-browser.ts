import { createBrowserClient } from '@supabase/ssr';
import { useMemo } from 'react';

// Singleton instance for non-hook contexts
let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (browserClient) return browserClient;
  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return browserClient;
}

// React hook version — stable reference across re-renders
export function useSupabase() {
  return useMemo(() => createClient(), []);
}
