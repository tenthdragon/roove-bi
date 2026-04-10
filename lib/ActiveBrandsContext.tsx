// @ts-nocheck
'use client';

import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { useSupabase } from '@/lib/supabase-browser';

interface ActiveBrandsContextType {
  activeBrands: string[];      // list of active brand names
  loading: boolean;
  error: string | null;
  isActiveBrand: (name: string) => boolean;  // quick check
}

const ActiveBrandsContext = createContext<ActiveBrandsContextType>({
  activeBrands: [],
  loading: true,
  error: null,
  isActiveBrand: () => true,
});

export function ActiveBrandsProvider({ children }: { children: React.ReactNode }) {
  const supabase = useSupabase();
  const [activeBrands, setActiveBrands] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    supabase
      .from('brands')
      .select('name')
      .eq('is_active', true)
      .order('name')
      .then(({ data, error }) => {
        if (cancelled) return;

        if (error) {
          console.error('[ActiveBrandsContext] Failed to load active brands:', error);
          setError(error.message);
          setLoading(false);
          return;
        }

        setActiveBrands((data || []).map(b => b.name));
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[ActiveBrandsContext] Failed to load active brands:', err);
        setError(err?.message || 'Failed to load active brands');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const activeSet = useMemo(() => new Set(activeBrands.map(b => b.toLowerCase())), [activeBrands]);

  const isActiveBrand = useCallback((name: string) => {
    if (loading) return true;
    if (error) return false;
    if (activeSet.size === 0) return false;
    return activeSet.has((name || '').toLowerCase());
  }, [activeSet, error, loading]);

  return (
    <ActiveBrandsContext.Provider value={{ activeBrands, loading, error, isActiveBrand }}>
      {children}
    </ActiveBrandsContext.Provider>
  );
}

export function useActiveBrands() {
  return useContext(ActiveBrandsContext);
}
