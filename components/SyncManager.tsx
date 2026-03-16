// components/SyncManager.tsx
'use client';

import { useState, useEffect } from 'react';
import { getScalevStatus } from '@/lib/scalev-actions';

type SyncMode = 'date' | 'order_id' | 'full';
type StatusFilter = 'pending' | 'shipped' | 'all';

const MODES: { id: SyncMode; label: string }[] = [
  { id: 'date', label: 'Tanggal' },
  { id: 'order_id', label: 'Order ID' },
  { id: 'full', label: 'Full Sync' },
];

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'all', label: 'Semua' },
];

export default function SyncManager() {
  const [mode, setMode] = useState<SyncMode>('date');
  const [syncDate, setSyncDate] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [orderIdsInput, setOrderIdsInput] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [configured, setConfigured] = useState(false);
  const [bizCount, setBizCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    getScalevStatus().then(s => {
      setConfigured(s.configured);
      setBizCount(s.businessesWithApiKeys);
      setPendingCount(s.pendingOrders);
    });
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    setMessage(null);
    try {
      const body: any = {};

      if (mode === 'date') {
        if (!syncDate) { setMessage({ type: 'error', text: 'Pilih tanggal terlebih dahulu' }); setSyncing(false); return; }
        body.mode = 'date';
        body.date = syncDate;
        body.status_filter = statusFilter;
      } else if (mode === 'order_id') {
        const ids = orderIdsInput.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
        if (ids.length === 0) { setMessage({ type: 'error', text: 'Masukkan minimal 1 Order ID' }); setSyncing(false); return; }
        body.mode = 'order_id';
        body.order_ids = ids;
      } else {
        body.mode = 'full';
      }

      const res = await fetch('/api/scalev-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync gagal');
      setSyncResult(data);
      const label = mode === 'date' ? syncDate : mode === 'order_id' ? `${body.order_ids.length} order` : 'full';
      setMessage({ type: 'success', text: `Sync ${label} selesai: ${data.orders_updated} diperbarui` });
      // Refresh status
      getScalevStatus().then(s => { setPendingCount(s.pendingOrders); });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSyncing(false);
    }
  }

  const pill = (active: boolean) => ({
    padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
    background: active ? '#1e40af' : '#1a2744',
    color: active ? '#93c5fd' : '#64748b',
    fontSize: 12, fontWeight: 600 as const,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Status bar */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
            background: configured ? '#064e3b' : '#78350f',
            color: configured ? '#10b981' : '#f59e0b',
          }}>
            {configured ? `${bizCount} business terhubung` : 'Belum ada API key'}
          </span>
          {pendingCount > 0 && (
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{pendingCount} order pending</span>
          )}
        </div>
        <span style={{ fontSize: 10, color: '#475569' }}>Cron: 02:00 WIB (full sync)</span>
      </div>

      {/* Message */}
      {message && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, fontSize: 13,
          background: message.type === 'success' ? '#064e3b' : '#7f1d1d',
          color: message.type === 'success' ? '#10b981' : '#fca5a5',
        }}>
          {message.text}
        </div>
      )}

      {/* Mode + Controls */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        {/* Mode selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {MODES.map(m => (
            <button key={m.id} onClick={() => { setMode(m.id); setSyncResult(null); setMessage(null); }} style={pill(mode === m.id)}>
              {m.label}
            </button>
          ))}
        </div>

        {/* Date mode */}
        {mode === 'date' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4, display: 'block' }}>Tanggal</label>
              <input
                type="date"
                value={syncDate}
                onChange={e => setSyncDate(e.target.value)}
                style={{
                  padding: '8px 12px', borderRadius: 6, border: '1px solid #1a2744',
                  background: '#0b1121', color: '#e2e8f0', fontSize: 13, width: 200,
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4, display: 'block' }}>Filter Status</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {STATUS_FILTERS.map(sf => (
                  <button key={sf.id} onClick={() => setStatusFilter(sf.id)} style={pill(statusFilter === sf.id)}>
                    {sf.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Order ID mode */}
        {mode === 'order_id' && (
          <div>
            <label style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4, display: 'block' }}>
              Order ID (pisahkan dengan koma atau enter)
            </label>
            <textarea
              value={orderIdsInput}
              onChange={e => setOrderIdsInput(e.target.value)}
              placeholder="260314JZEUWAI, 260314XJDVZVV"
              rows={3}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 6,
                border: '1px solid #1a2744', background: '#0b1121', color: '#e2e8f0',
                fontSize: 13, fontFamily: 'monospace', resize: 'vertical',
              }}
            />
          </div>
        )}

        {/* Full mode warning */}
        {mode === 'full' && (
          <div style={{
            padding: '12px 16px', borderRadius: 8,
            background: '#78350f33', border: '1px solid #78350f',
            color: '#fbbf24', fontSize: 13,
          }}>
            Full sync akan memeriksa <b>semua</b> order non-terminal ({pendingCount}+ order).
            Proses bisa memakan waktu lama dan mungkin timeout di server (maks 120 detik).
          </div>
        )}

        {/* Sync button */}
        <button
          onClick={handleSync}
          disabled={syncing || !configured}
          style={{
            marginTop: 16, padding: '10px 24px', borderRadius: 8, border: 'none',
            cursor: syncing || !configured ? 'not-allowed' : 'pointer',
            background: syncing ? '#1e3a5f' : '#1e40af',
            color: '#93c5fd', fontSize: 14, fontWeight: 600,
            opacity: syncing || !configured ? 0.5 : 1,
          }}
        >
          {syncing ? 'Menyinkronkan...' : 'Mulai Sinkronisasi'}
        </button>
      </div>

      {/* Results */}
      {syncResult && (
        <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 14, color: '#e2e8f0', marginBottom: 12 }}>
            Sync selesai ({(syncResult.duration_ms / 1000).toFixed(1)}s)
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#94a3b8', marginBottom: 16 }}>
            <span>Dicek: <b style={{ color: '#e2e8f0' }}>{syncResult.pending_checked}</b></span>
            <span>Diperbarui: <b style={{ color: '#10b981' }}>{syncResult.orders_updated}</b></span>
            {syncResult.orders_repaired > 0 && (
              <span>Diperbaiki: <b style={{ color: '#60a5fa' }}>{syncResult.orders_repaired}</b></span>
            )}
            <span>Pending: <b style={{ color: '#f59e0b' }}>{syncResult.orders_still_pending}</b></span>
            <span>Error: <b style={{ color: syncResult.orders_errored > 0 ? '#ef4444' : '#e2e8f0' }}>{syncResult.orders_errored}</b></span>
          </div>

          {/* Detail rows */}
          {syncResult.details?.length > 0 && (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: '#64748b', textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #1a2744' }}>Order ID</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #1a2744' }}>Business</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #1a2744' }}>Status</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid #1a2744' }}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {syncResult.details.map((d: any, i: number) => (
                    <tr key={i} style={{ color: d.error ? '#fca5a5' : '#94a3b8' }}>
                      <td style={{ padding: '5px 8px', borderBottom: '1px solid #0d1117', fontFamily: 'monospace' }}>{d.order_id}</td>
                      <td style={{ padding: '5px 8px', borderBottom: '1px solid #0d1117' }}>{d.business_code || '-'}</td>
                      <td style={{ padding: '5px 8px', borderBottom: '1px solid #0d1117' }}>
                        {d.error ? (
                          <span style={{ color: '#ef4444' }}>Error</span>
                        ) : d.action ? (
                          <span style={{ color: '#60a5fa' }}>{d.action}</span>
                        ) : (
                          <span>{d.old_status} → <b style={{ color: '#10b981' }}>{d.new_status}</b></span>
                        )}
                      </td>
                      <td style={{ padding: '5px 8px', borderBottom: '1px solid #0d1117', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.error || d.store_name || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
