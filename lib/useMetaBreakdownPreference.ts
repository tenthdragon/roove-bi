'use client';
import { useEffect, useState } from 'react';
export type MetaBreakdown = 'none' | 'format' | 'optimization' | 'partnership';
export function useMetaBreakdownPreference(workspaceId: string, userId: string) {
  const key = workspaceId && userId ? `roove:meta-breakdown:${workspaceId}:${userId}` : '';
  const [state, setState] = useState<{ key: string; value: MetaBreakdown; error: string } | null>(null);
  useEffect(() => {
    if (!key) return;
    try { const saved = window.localStorage.getItem(key); setState({ key, value: saved === 'none' || saved === 'optimization' || saved === 'partnership' ? saved : 'format', error: '' }); }
    catch { setState({ key, value: 'format', error: '' }); }
  }, [key]);
  function select(value: MetaBreakdown) {
    if (!key || state?.key !== key || !['none', 'format', 'optimization', 'partnership'].includes(value)) return;
    let error = '';
    try { window.localStorage.setItem(key, value); }
    catch { error = 'Pilihan rincian tidak bisa disimpan di browser ini.'; }
    setState({ key, value, error });
  }
  return { value: state?.key === key ? state.value : 'format' as MetaBreakdown, ready: !!key && state?.key === key,
    error: state?.key === key ? state.error : '', select };
}
