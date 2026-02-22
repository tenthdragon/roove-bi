// components/ScalevManager.tsx
'use client';

import { useState, useEffect } from 'react';
import { getScalevStatus, saveScalevApiKey, triggerScalevSync } from '@/lib/scalev-actions';

interface SyncLog {
  id: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  orders_fetched: number;
  orders_inserted: number;
  orders_updated: number;
  error_message: string | null;
  sync_type: string;
}

interface ScalevStatus {
  configured: boolean;
  configId: number | null;
  lastSyncId: number;
  totalOrders: number;
  shippedOrders: number;
  lastSync: SyncLog | null;
  recentSyncs: SyncLog[];
}

export default function ScalevManager() {
  const [status, setStatus] = useState<ScalevStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showApiForm, setShowApiForm] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { loadStatus(); }, []);

  async function loadStatus() {
    try {
      const s = await getScalevStatus();
      setStatus(s);
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

  async function handleSync(mode: 'incremental' | 'full') {
    setSyncing(true);
    setMessage(null);
    try {
      const result = await triggerScalevSync(mode);
      setMessage({ type: 'success', text: `Sync selesai! ${result.orders_fetched} orders di-fetch, ${result.orders_inserted} di-insert.` });
      await loadStatus();
    } catch (err: any) {
      setMessage({ type: 'error', text: `Sync gagal: ${err.message}` });
    } finally {
      setSyncing(false);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  if (loading && !status) {
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
        <div style={{ fontSize:14, fontWeight:700 }}>Scalev API Integration</div>
        <span style={{
          padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600,
          background: status?.configured ? '#064e3b' : '#78350f',
          color: status?.configured ? '#10b981' : '#f59e0b',
        }}>
          {status?.configured ? '● Terhubung' : '○ Belum dikonfigurasi'}
        </span>
      </div>
      <div style={{ fontSize:12, color:'#64748b', marginBottom:16 }}>
        Otomatis tarik data order dari Scalev — tidak perlu upload Excel manual
      </div>

      {/* Messages */}
      {message && (
        <div style={{
          marginBottom:12, padding:12, borderRadius:8, fontSize:13,
          background: message.type === 'success' ? '#064e3b' : '#7f1d1d',
          color: message.type === 'success' ? '#10b981' : '#ef4444',
        }}>
          {message.type === 'success' ? '✅' : '❌'} {message.text}
        </div>
      )}

      {/* API Key Configuration */}
      {showApiForm && (
        <div style={{ padding:14, background:'#0c1b3a', border:'1px solid #1e3a5f', borderRadius:8, marginBottom:16 }}>
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

      {/* Stats & Controls */}
      {status?.configured && (
        <>
          {/* Stats Cards */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))', gap:8, marginBottom:14 }}>
            {[
              { label: 'Total Orders', value: (status.totalOrders || 0).toLocaleString('id-ID'), color: '#3b82f6', bg: '#0c1b3a' },
              { label: 'Shipped', value: (status.shippedOrders || 0).toLocaleString('id-ID'), color: '#10b981', bg: '#0a1f1a' },
              { label: 'Last Sync ID', value: (status.lastSyncId || 0).toLocaleString('id-ID'), color: '#8b5cf6', bg: '#1a0f30' },
              { label: 'Last Sync', value: status.lastSync ? formatDate(status.lastSync.started_at) : 'Belum', color: '#f59e0b', bg: '#1a1500' },
            ].map((stat, i) => (
              <div key={i} style={{ padding:10, background:stat.bg, border:'1px solid #1a2744', borderRadius:8 }}>
                <div style={{ fontSize:10, color: stat.color, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:4 }}>{stat.label}</div>
                <div style={{ fontSize: stat.label === 'Last Sync' ? 11 : 16, fontWeight:700, fontFamily:'monospace', color:'#e2e8f0' }}>{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Sync Controls */}
          <div style={{ display:'flex', gap:8, marginBottom:14 }}>
            <button
              onClick={() => handleSync('incremental')}
              disabled={syncing}
              style={{
                flex:1, padding:'9px 16px', borderRadius:8, border:'none', cursor: syncing ? 'not-allowed' : 'pointer',
                background: syncing ? '#1a2744' : '#1e40af', color: syncing ? '#64748b' : '#93c5fd',
                fontSize:12, fontWeight:600,
              }}
            >
              {syncing ? '⟳ Syncing...' : '⟳ Sync Incremental'}
            </button>
            <button
              onClick={() => handleSync('full')}
              disabled={syncing}
              style={{
                padding:'9px 16px', borderRadius:8, border:'1px solid #1a2744', cursor: syncing ? 'not-allowed' : 'pointer',
                background:'transparent', color:'#94a3b8', fontSize:12, fontWeight:600,
              }}
            >
              Full Sync
            </button>
            <button
              onClick={() => setShowApiForm(true)}
              style={{
                padding:'9px 16px', borderRadius:8, border:'1px solid #1a2744', cursor:'pointer',
                background:'transparent', color:'#64748b', fontSize:12, fontWeight:600,
              }}
            >
              Ganti Key
            </button>
          </div>

          {/* Sync History */}
          {status.recentSyncs.length > 0 && (
            <div>
              <div style={{ fontSize:12, fontWeight:600, color:'#64748b', marginBottom:8, textTransform:'uppercase', letterSpacing:'0.04em' }}>Riwayat Sync</div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {status.recentSyncs.map((sync) => (
                  <div key={sync.id} style={{
                    display:'flex', justifyContent:'space-between', alignItems:'center',
                    padding:'10px 12px', background:'#0b1121', border:'1px solid #1a2744', borderRadius:8, fontSize:12,
                  }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{
                        width:8, height:8, borderRadius:'50%', display:'inline-block',
                        background: sync.status === 'success' ? '#10b981' : sync.status === 'error' ? '#ef4444' : '#f59e0b',
                      }} />
                      <span style={{ color:'#94a3b8' }}>{formatDate(sync.started_at)}</span>
                      <span style={{
                        padding:'1px 6px', borderRadius:4, fontSize:9, fontWeight:600, textTransform:'uppercase',
                        background:'#1a2744', color:'#64748b',
                      }}>{sync.sync_type}</span>
                    </div>
                    <div style={{ color:'#64748b', fontSize:11 }}>
                      {sync.status === 'success' && (
                        <span style={{ color:'#10b981' }}>{sync.orders_fetched} fetched, {sync.orders_inserted} inserted</span>
                      )}
                      {sync.status === 'error' && (
                        <span style={{ color:'#ef4444' }}>{sync.error_message?.slice(0, 50)}</span>
                      )}
                      {sync.status === 'running' && (
                        <span style={{ color:'#f59e0b' }}>Berjalan...</span>
                      )}
                      {sync.status === 'partial' && (
                        <span style={{ color:'#f59e0b' }}>{sync.orders_fetched} fetched (partial)</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
