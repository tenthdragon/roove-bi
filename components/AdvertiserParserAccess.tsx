'use client';

import { useEffect, useRef, useState } from 'react';
import { getAdvertiserParserAccess, saveAdvertiserParserAccess } from '@/lib/advertiser-parser-access-actions';

export default function AdvertiserParserAccess({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestVersion = useRef(0);

  useEffect(() => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoaded(false);
    setSaving(false);
    setError('');
    setMessage('');
    void getAdvertiserParserAccess(userId, workspaceId).then(result => {
      if (version !== requestVersion.current) return;
      if (result.workspaceId !== workspaceId) throw new Error('Workspace berubah. Muat ulang akses.');
      setEnabled(result.enabled);
      setLoaded(true);
    }).catch(reason => {
      if (version === requestVersion.current) setError(reason instanceof Error ? reason.message : 'Gagal memuat akses parser.');
    }).finally(() => {
      if (version === requestVersion.current) setLoading(false);
    });
    return () => { requestVersion.current++; };
  }, [userId, workspaceId, attempt]);

  async function save() {
    const version = requestVersion.current;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await saveAdvertiserParserAccess(userId, enabled, workspaceId);
      if (version !== requestVersion.current) return;
      if (result.workspaceId !== workspaceId) throw new Error('Workspace berubah. Muat ulang akses.');
      setEnabled(result.enabled);
      setMessage('Akses tersimpan. Advertiser perlu memuat ulang dashboard untuk memperbarui menu.');
    } catch (reason) {
      if (version === requestVersion.current) setError(reason instanceof Error ? reason.message : 'Gagal menyimpan akses parser.');
    } finally {
      if (version === requestVersion.current) setSaving(false);
    }
  }

  return (
    <fieldset disabled={loading || saving} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
      <legend style={{ fontWeight: 600 }}>Hak akses MP Data Parser</legend>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px' }}>
        Izinkan advertiser ini memproses file marketplace, membuka arsip, dan mengelola aturan parsing bersama di workspace ini.
      </p>
      {loading ? <span role="status">Memuat akses…</span> : loaded && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked); setMessage(''); }} />
          Aktifkan MP Data Parser
        </label>
      )}
      {loaded && <button type="button" onClick={() => void save()} style={{ marginTop: 12, padding: '6px 12px' }}>
        {saving ? 'Menyimpan…' : 'Simpan akses parser'}
      </button>}
      {error && <p role="alert" style={{ fontSize: 12, marginBottom: 0 }}>{error}</p>}
      {!loading && !loaded && <button type="button" onClick={() => setAttempt(value => value + 1)} style={{ marginTop: 12, padding: '6px 12px' }}>Muat ulang akses</button>}
      {message && <p role="status" style={{ fontSize: 12, marginBottom: 0 }}>{message}</p>}
    </fieldset>
  );
}
