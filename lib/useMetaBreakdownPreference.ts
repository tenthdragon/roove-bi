'use client';
import { useEffect, useState } from 'react';
export type MetaBreakdown = 'format' | 'optimization';
export function useMetaBreakdownPreference(workspaceId: string, userId: string) {
  const key = workspaceId && userId ? `roove:meta-breakdown:${workspaceId}:${userId}` : '';
  const [state, setState] = useState<{ key: string; value: MetaBreakdown; error: string } | null>(null);
  useEffect(() => {
    if (!key) return;
    try { setState({ key, value: window.localStorage.getItem(key) === 'optimization' ? 'optimization' : 'format', error: '' }); }
    catch { setState({ key, value: 'format', error: '' }); }
  }, [key]);
  function select(value: MetaBreakdown) {
    if (!key || state?.key !== key || !['format', 'optimization'].includes(value)) return;
    let error = '';
    try { window.localStorage.setItem(key, value); }
    catch { error = 'Pilihan rincian tidak bisa disimpan di browser ini.'; }
    setState({ key, value, error });
  }
  return { value: state?.key === key ? state.value : 'format' as MetaBreakdown, ready: !!key && state?.key === key,
    error: state?.key === key ? state.error : '', select };
}
