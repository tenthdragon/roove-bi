'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MarketplaceIntakeSourceConfig } from './marketplace-intake-sources';

export function useMarketplaceIntakeSources() {
  const [sources, setSources] = useState<MarketplaceIntakeSourceConfig[]>([]);
  const [businesses, setBusinesses] = useState<Array<{
    id: number;
    business_code: string;
    business_name: string | null;
    is_active: boolean;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/marketplace-intake/sources', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Gagal memuat source marketplace.');
      setSources(Array.isArray(payload?.sources) ? payload.sources : []);
      setBusinesses(Array.isArray(payload?.businesses) ? payload.businesses : []);
    } catch (nextError: any) {
      setSources([]);
      setBusinesses([]);
      setError(nextError?.message || 'Gagal memuat source marketplace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { sources, businesses, loading, error, refresh };
}
