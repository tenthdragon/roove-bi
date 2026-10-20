'use client';

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { useSupabase } from './supabase-browser';
import { useWorkspace } from './WorkspaceContext';
import { usePermissions } from './PermissionsContext';
import { createMetaOverviewCache } from './meta-overview-cache';
import { getMetaViewerScope } from './meta-funnel-actions';

export function useMetaReportSession() {
  const supabase = useSupabase();
  const { activeWorkspace, switching } = useWorkspace();
  const { role, permissions } = usePermissions();
  const [userId, setUserId] = useState('');
  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data: { session } }) => { if (alive) setUserId(session?.user.id || ''); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { if (alive) setUserId(session?.user.id || ''); });
    return () => { alive = false; subscription.unsubscribe(); };
  }, [supabase]);
  const identity = userId && !switching ? JSON.stringify([userId, activeWorkspace.id, role, [...permissions].sort()]) : null;
  const [scope, setScope] = useState<{ identity: string; key: string; empty: boolean } | null>(null);
  const [scopeError, setScopeError] = useState('');
  useEffect(() => {
    if (role !== 'advertiser' || !identity) return;
    let alive = true; let sequence = 0;
    const check = async (hide = false) => {
      const current = ++sequence;
      if (hide) setScope(null);
      try {
        const value = await getMetaViewerScope();
        if (!alive || current !== sequence) return;
        if ('error' in value || value.workspaceId !== activeWorkspace.id) throw new Error('Akses brand belum dapat diverifikasi. Muat ulang atau hubungi owner workspace.');
        setScope({ identity, key: value.accessKey, empty: value.brandIds?.length === 0 }); setScopeError('');
      } catch (e) { if (alive && current === sequence) { setScope(null); setScopeError(e instanceof Error ? e.message : 'Gagal memverifikasi akses brand.'); } }
    };
    void check(true);
    const focus = () => void check(true);
    window.addEventListener('focus', focus);
    const timer = window.setInterval(() => void check(), 30000);
    return () => { alive = false; window.removeEventListener('focus', focus); window.clearInterval(timer); };
  }, [identity, role, activeWorkspace.id]);
  const checked = scope?.identity === identity ? scope : null;
  return { userId, workspaceId: activeWorkspace.id,
    key: role === 'advertiser' ? identity && checked && !checked.empty ? JSON.stringify([identity, checked.key]) : null : identity,
    error: role === 'advertiser' ? checked?.empty ? 'Belum ada brand yang ditugaskan. Hubungi owner workspace untuk mendapatkan alokasi brand.' : scopeError : '' };
}

/** Shared navigation/pending cache; stale scope results never replace the UI. */
export function useMetaCachedLoad<T>(key: string | null, cache: ReturnType<typeof createMetaOverviewCache<T>>, fetchData: () => Promise<T | null>) {
  const [result, setResult] = useState<{ key: string; data: T } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  const scope = useRef(key);
  const pending = useRef<{ key: string; promise: Promise<T | null> } | null>(null);
  const load = useCallback(function load(force = false): Promise<T | null> {
    if (!key || scope.current !== key) return Promise.resolve(null);
    if (pending.current?.key === key) return force ? pending.current.promise.then(() => load(true)) : pending.current.promise;
    if (force) cache.delete(key);
    const cached = force ? undefined : cache.get(key);
    if (cached) { setResult({ key, data: cached }); setLoading(false); setError(''); return Promise.resolve(cached); }
    const current = ++request.current;
    setLoading(true); setError('');
    const promise = (async () => {
      try {
        const data = await cache.request(key, fetchData);
        if (current !== request.current || scope.current !== key) return null;
        if (data) { cache.set(key, data); setResult({ key, data }); }
        return data;
      } catch (e) {
        if (current === request.current) setError(e instanceof Error ? e.message : 'Permintaan gagal.');
        return null;
      } finally { if (current === request.current) { setLoading(false); pending.current = null; } }
    })();
    pending.current = { key, promise }; return promise;
  }, [key, cache, fetchData]);
  useEffect(() => {
    const guard = request; scope.current = key;
    void load();
    return () => { guard.current++; pending.current = null; scope.current = null; };
  }, [key, load]);
  const data = result?.key === key ? result.data : key ? cache.get(key) || null : null;
  const setData = useCallback((update: SetStateAction<T | null>) => {
    if (!key) return;
    setResult(current => {
      const data = current?.key === key ? current.data : cache.get(key) || null;
      const next = typeof update === 'function' ? (update as (value: T | null) => T | null)(data) : update;
      if (next) cache.set(key, next); else cache.delete(key);
      return next ? { key, data: next } : null;
    });
  }, [key, cache]);
  return { data, setData, loading, error, setError, load };
}
