// @ts-nocheck
'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase-browser';

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
  const supabase = createClient();
  const [dateRange, setDateRangeState] = useState({ from: '', to: '' });
  const [dateExtent, setDateExtent] = useState({ earliest: '', latest: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      // Get data extent from all sources
      const { data: f1 } = await supabase
        .from('daily_product_summary')
        .select('date')
        .order('date', { ascending: true })
        .limit(1);
      const { data: l1 } = await supabase
        .from('daily_product_summary')
        .select('date')
        .order('date', { ascending: false })
        .limit(1);

      const earliest = f1?.[0]?.date || '';
      const latest = l1?.[0]?.date || '';

      setDateExtent({ earliest, latest });

      // Default to current month (1st of month -> today)
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      const monthStart = `${yyyy}-${mm}-01`;
      const todayStr = `${yyyy}-${mm}-${dd}`;

      // If current month has data, use it. Otherwise fall back to latest available month.
      if (latest && latest >= monthStart) {
        setDateRangeState({ from: monthStart, to: todayStr });
      } else if (latest) {
        // Fall back to the month of the latest data
        const latestDate = new Date(latest + 'T00:00:00');
        const lm = String(latestDate.getMonth() + 1).padStart(2, '0');
        const ly = latestDate.getFullYear();
        const lastDay = new Date(ly, latestDate.getMonth() + 1, 0).getDate();
        setDateRangeState({
          from: `${ly}-${lm}-01`,
          to: `${ly}-${lm}-${String(lastDay).padStart(2, '0')}`,
        });
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
