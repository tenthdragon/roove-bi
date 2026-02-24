// @ts-nocheck
'use client';

import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase-browser';

interface ActiveBrandsContextType {
  activeBrands: string[];      // list of active brand names
  loading: boolean;
  isActiveBrand: (name: string) => boolean;  // quick check
}

const ActiveBrandsContext = createContext<ActiveBrandsContextType>({
  activeBrands: [],
  loading: true,
  isActiveBrand: () => true,
});

export function ActiveBrandsProvider({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [activeBrands, setActiveBrands] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('brands')
      .select('name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        setActiveBrands((data || []).map(b => b.name));
        setLoading(false);
      });
  }, [supabase]);

  const activeSet = useMemo(() => new Set(activeBrands.map(b => b.toLowerCase())), [activeBrands]);

  const isActiveBrand = (name: string) => {
    if (activeSet.size === 0) return true; // if no brands loaded yet, don't filter
    return activeSet.has((name || '').toLowerCase());
  };

  return (
    <ActiveBrandsContext.Provider value={{ activeBrands, loading, isActiveBrand }}>
      {children}
    </ActiveBrandsContext.Provider>
  );
}

export function useActiveBrands() {
  return useContext(ActiveBrandsContext);
}
