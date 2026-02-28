// @ts-nocheck
// components/SyncOrdersWidget.tsx
'use client';

import { useState, useEffect } from 'react';
import { fmtCompact } from '@/lib/utils';

export default function SyncOrdersWidget() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadStatus(); }, []);

  async function loadStatus() {
    try {
      setLoading(true);
      const res = await fetch('/api/scalev-sync');
      if (res.ok) setSyncStatus(await res.json());
    } catch (err) {
      console.warn('Could not load sync status:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSync(mode = 'status') {
    setSyncing(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/scalev-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Sync failed');
      else { setResult(data); await loadStatus(); }
    } catch (err) {
      setError(err.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const timeAgo = (dateStr) => {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'baru saja';
    if (mins < 60) return `${mins}m lalu`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}j lalu`;
    return `${Math.floor(hrs / 24)}h lalu`;
  };

  const lastSync = syncStatus?.recentSyncs?.[0];

  return (
    <div style={{
      background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12,
      padding: 16, marginBottom: 20,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 12,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            Scalev Order Sync
            {syncStatus?.configured === false && (
              <span style={{ fontSize: 10, background: '#7f1d1d', color: '#ef4444', padding: '2px 6px', borderRadius: 4 }}>
                Not Configured
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            {lastSync
              ? `Last: ${timeAgo(lastSync.completed_at || lastSync.started_at)} · ${lastSync.orders_fetched || 0} orders · ${lastSync.status}`
              : loading ? 'Loading...' : 'Belum pernah sync'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => handleSync('status')}
            disabled={syncing}
            title="Quick sync — only updates in-flight orders (confirmed → shipped)"
            style={{
              background: syncing ? '#1e293b' : '#3b82f6', color: '#fff',
              border: 'none', borderRadius: 8, padding: '8px 14px',
              fontSize: 12, fontWeight: 600,
              cursor: syncing ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: syncing ? 0.7 : 1, transition: 'all 0.2s',
            }}
          >
            {syncing ? (
              <>
                <span className="spinner" style={{
                  width: 12, height: 12,
                  border: '2px solid #ffffff44', borderTop: '2px solid #fff',
                  borderRadius: '50%', display: 'inline-block',
                }} />
                Syncing...
              </>
            ) : '🔄 Sync'}
          </button>
          <button
            onClick={() => handleSync('incremental')}
            disabled={syncing}
            title="Full incremental — fetches all new orders from last position"
            style={{
              background: '#1e293b', color: '#94a3b8',
              border: '1px solid #334155', borderRadius: 8,
              padding: '8px 10px', fontSize: 11,
              cursor: syncing ? 'not-allowed' : 'pointer',
              opacity: syncing ? 0.5 : 1,
            }}
          >
            Full
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {syncStatus && !loading && (
        <div style={{ display: 'flex', gap: 10, marginBottom: result || error ? 12 : 0, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 100px', background: '#0c1524', borderRadius: 8, padding: '10px 12px', border: '1px solid #1a2744' }}>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Total Orders</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace' }}>{(syncStatus.totalOrders || 0).toLocaleString()}</div>
          </div>
          <div style={{ flex: '1 1 100px', background: '#0c1524', borderRadius: 8, padding: '10px 12px', border: '1px solid #1a2744' }}>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Shipped</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: '#06b6d4' }}>{(syncStatus.shippedOrders || 0).toLocaleString()}</div>
          </div>
          <div style={{ flex: '1 1 100px', background: '#0c1524', borderRadius: 8, padding: '10px 12px', border: '1px solid #1a2744' }}>
            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>Last Sync ID</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color: '#f59e0b' }}>{(syncStatus.lastSyncId || 0).toLocaleString()}</div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>Cursor position</div>
          </div>
        </div>
      )}

      {/* Sync Result */}
      {result && (
        <div style={{
          background: result.timed_out ? '#1e1b0a' : '#0a1e1b',
          border: `1px solid ${result.timed_out ? '#78350f' : '#064e3b'}`,
          borderRadius: 8, padding: '10px 14px', fontSize: 12,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 6, color: result.timed_out ? '#f59e0b' : '#10b981' }}>
            {result.timed_out ? '⏱️' : '✅'} {result.message}
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: '#94a3b8' }}>
            <span>Fetched: <strong style={{ color: '#e2e8f0' }}>{result.orders_fetched}</strong></span>
            <span>Inserted: <strong style={{ color: '#e2e8f0' }}>{result.orders_inserted}</strong></span>
            <span>Duration: <strong style={{ color: '#e2e8f0' }}>{result.elapsed_seconds}s</strong></span>
            {result.sync_type && <span>Mode: <strong style={{ color: '#e2e8f0' }}>{result.sync_type}</strong></span>}
          </div>
          {result.timed_out && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#f59e0b' }}>
              💡 Klik Sync lagi untuk melanjutkan dari posisi terakhir
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: '#1e0a0a', border: '1px solid #7f1d1d',
          borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#ef4444',
        }}>
          ❌ {error}
        </div>
      )}
    </div>
  );
}
