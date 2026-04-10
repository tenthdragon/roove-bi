// @ts-nocheck
'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { useSupabase } from '@/lib/supabase-browser';
import { getDatePartsInTimeZone } from '@/lib/utils';

interface DateRangeContextType {
  dateRange: { from: string; to: string };
  dateExtent: { earliest: string; latest: string };
  setDateRange: (from: string, to: string) => void;
  loading: boolean;
}

const DateRangeContext = createContext<DateRangeContextType>({
  dateRange: { from: '', to: '' },
  dateExtent: { earliest: '', latest: '' },
  setDateRange: () => {},
  loading: true,
});

export function useDateRange() {
  return useContext(DateRangeContext);
}

export function DateRangeProvider({ children }: { children: React.ReactNode }) {
  const supabase = useSupabase();
  const [dateRange, setDateRangeState] = useState({ from: '', to: '' });
  const [dateExtent, setDateExtent] = useState({ earliest: '', latest: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      const { year, month, iso: todayStr } = getDatePartsInTimeZone('Asia/Jakarta');
      const monthStart = `${year}-${month}-01`;

      // Get data extent from all sources
      const [
        { data: f1, error: earliestError },
        { data: l1, error: latestError },
      ] = await Promise.all([
        supabase
          .from('daily_product_summary')
          .select('date')
          .order('date', { ascending: true })
          .limit(1),
        supabase
          .from('daily_product_summary')
          .select('date')
          .order('date', { ascending: false })
          .limit(1),
      ]);

      if (earliestError || latestError) {
        console.error('[DateRangeContext] Failed to load date extent:', earliestError || latestError);
      }

      const earliest = f1?.[0]?.date || '';
      const latest = l1?.[0]?.date || '';

      setDateExtent({ earliest, latest });

      // Default to the actual latest available data window using WIB.
      if (latest && latest >= monthStart) {
        setDateRangeState({ from: monthStart, to: latest });
      } else if (latest) {
        setDateRangeState({
          from: latest.slice(0, 7) + '-01',
          to: latest,
        });
      } else {
        setDateRangeState({ from: monthStart, to: todayStr });
      }

      setLoading(false);
    }
    init();
  }, [supabase]);

  const setDateRange = (from: string, to: string) => {
    setDateRangeState({ from, to });
  };

  return (
    <DateRangeContext.Provider value={{ dateRange, dateExtent, setDateRange, loading }}>
      {children}
    </DateRangeContext.Provider>
  );
}
