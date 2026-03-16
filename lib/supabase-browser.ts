import { createBrowserClient } from '@supabase/ssr';
import { useMemo } from 'react';

// Singleton: reuse the same Supabase client across all components
let browserClient: ReturnType<typeof createBrowserClient> | null = null;
let hasWarnedMissingEnv = false;

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && anonKey) {
    return { url, anonKey };
  }

  if (!hasWarnedMissingEnv) {
    hasWarnedMissingEnv = true;
    console.warn(
      '[supabase-browser] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. Using a placeholder client so build/prerender does not crash.'
    );
  }

  return {
    // Keep app build-safe in environments that do not inject public env vars (e.g. CI static analysis).
    // Real deployments should still provide correct NEXT_PUBLIC_* values.
    url: 'http://127.0.0.1:54321',
    anonKey: 'placeholder-anon-key',
  };
}

export function createClient() {
  if (browserClient) return browserClient;

  const { url, anonKey } = getSupabaseConfig();
  browserClient = createBrowserClient(url, anonKey);

  return browserClient;
}

/**
 * React hook — returns a stable Supabase client reference.
 * Use this in components instead of calling createClient() directly.
 */
export function useSupabase() {
  return useMemo(() => createClient(), []);
}
