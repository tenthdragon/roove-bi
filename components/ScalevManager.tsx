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

  useEffect(() => { loadStatus(); }, []);

  async function loadStatus() {
    try {
      const s = await getScalevStatus();
      setConfigured(s.configured);
      setShowApiForm(!s.configured);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
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
    </div>
  );
}
