// components/ScalevManager.tsx
'use client';

import { useState, useEffect } from 'react';
import { getScalevStatus, saveScalevApiKey } from '@/lib/scalev-actions';

export default function ScalevManager() {
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [showApiForm, setShowApiForm] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);

  useEffect(() => { loadStatus(); }, []);

  async function loadStatus() {
    try {
      const s = await getScalevStatus();
      setConfigured(s.configured);
      setShowApiForm(!s.configured);
      setPendingCount(s.pendingOrders);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    setMessage(null);
    try {
      const res = await fetch('/api/scalev-sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      setSyncResult(data);
      setMessage({ type: 'success', text: `Sync selesai: ${data.orders_updated} order diperbarui` });
      await loadStatus();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSyncing(false);
    }
  }

  async function handleSaveApiKey() {
    if (!apiKey.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      await saveScalevApiKey(apiKey.trim());
      setMessage({ type: 'success', text: 'API key berhasil disimpan!' });
      setShowApiForm(false);
      setApiKey('');
      await loadStatus();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  if (loading && !configured) {
    return (
      <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:20 }}>
        <div style={{ color:'#64748b', fontSize:13 }}>Memuat status Scalev...</div>
      </div>
    );
  }

  return (
    <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:20 }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
        <div style={{ fontSize:14, fontWeight:700 }}>Scalev Webhook</div>
        <span style={{
          padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600,
          background: configured ? '#064e3b' : '#78350f',
          color: configured ? '#10b981' : '#f59e0b',
        }}>
          {configured ? '● Terhubung' : '○ Belum dikonfigurasi'}
        </span>
      </div>
      <div style={{ fontSize:12, color:'#64748b', marginBottom:16 }}>
        API key untuk verifikasi webhook dari Scalev
      </div>

      {/* Messages */}
      {message && (
        <div style={{
          marginBottom:12, padding:12, borderRadius:8, fontSize:13,
          background: message.type === 'success' ? '#064e3b' : '#7f1d1d',
          color: message.type === 'success' ? '#10b981' : '#ef4444',
        }}>
          {message.text}
        </div>
      )}

      {/* API Key Form */}
      {showApiForm && (
        <div style={{ padding:14, background:'#0c1b3a', border:'1px solid #1e3a5f', borderRadius:8 }}>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:4 }}>Konfigurasi API Key</div>
          <div style={{ fontSize:11, color:'#64748b', marginBottom:10 }}>
            Ambil API key dari Scalev dashboard → Settings → API Keys
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk_xxxxxxxxxx..."
              style={{
                flex:1, padding:'8px 12px', background:'#0b1121', border:'1px solid #1a2744',
                borderRadius:8, color:'#e2e8f0', fontSize:13, outline:'none',
              }}
            />
            <button
              onClick={handleSaveApiKey}
              disabled={!apiKey.trim() || loading}
              style={{
                padding:'8px 16px', borderRadius:8, border:'none', cursor:'pointer',
                background:'#1e40af', color:'#93c5fd', fontSize:12, fontWeight:600,
                opacity: (!apiKey.trim() || loading) ? 0.5 : 1,
              }}
            >
              Simpan
            </button>
          </div>
        </div>
      )}

      {/* Ganti Key button */}
      {configured && !showApiForm && (
        <button
          onClick={() => setShowApiForm(true)}
          style={{
            padding:'7px 14px', borderRadius:8, border:'1px solid #1a2744', cursor:'pointer',
            background:'transparent', color:'#64748b', fontSize:12, fontWeight:600,
          }}
        >
          Ganti Key
        </button>
      )}

      {/* Sync Pending Orders */}
      {configured && (
        <div style={{ marginTop:16, padding:14, background:'#0c1b3a', border:'1px solid #1e3a5f', borderRadius:8 }}>
          <div style={{ fontWeight:600, fontSize:13, marginBottom:4 }}>Sinkronisasi Order Pending</div>
          <div style={{ fontSize:11, color:'#64748b', marginBottom:10 }}>
            {pendingCount > 0
              ? `${pendingCount} order masih pending di database. Cek status terbaru dari Scalev API.`
              : 'Tidak ada order pending.'}
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <button
              onClick={handleSync}
              disabled={syncing || pendingCount === 0}
              style={{
                padding:'7px 14px', borderRadius:8, border:'none', cursor:'pointer',
                background: syncing ? '#1e3a5f' : '#1e40af',
                color:'#93c5fd', fontSize:12, fontWeight:600,
                opacity: (syncing || pendingCount === 0) ? 0.5 : 1,
              }}
            >
              {syncing ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}
            </button>
            <span style={{ fontSize:11, color:'#475569' }}>Cron: setiap hari 02:00 WIB</span>
          </div>
          {syncResult && (
            <div style={{ marginTop:10, padding:10, background:'#0b1121', borderRadius:6, fontSize:12, color:'#94a3b8' }}>
              <div style={{ marginBottom:4, color:'#e2e8f0' }}>
                Sync selesai ({(syncResult.duration_ms / 1000).toFixed(1)}s)
              </div>
              <div>
                Dicek: {syncResult.pending_checked} | Diperbarui: {syncResult.orders_updated} | Masih pending: {syncResult.orders_still_pending} | Error: {syncResult.orders_errored}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
