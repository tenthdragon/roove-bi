import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createServiceSupabase } from './service-supabase';

export function createServerSupabase() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return (cookieStore as any).get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try { (cookieStore as any).set({ name, value, ...options }); } catch {}
        },
        remove(name: string, options: CookieOptions) {
          try { (cookieStore as any).set({ name, value: '', ...options }); } catch {}
        },
      },
    }
  );
}

export { createServiceSupabase };
