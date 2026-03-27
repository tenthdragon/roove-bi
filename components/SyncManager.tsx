// components/SyncManager.tsx
'use client';

import { useState, useEffect, useRef } from 'react';
import { getScalevStatus, getPendingOrders, type PendingOrder } from '@/lib/scalev-actions';

type ViewMode = 'pending' | 'repair';

type RowState = {
  syncing: boolean;
  result: null | { success: boolean; newStatus?: string; error?: string; action?: string };
};

const PRE_TERMINAL = ['pending', 'confirmed', 'processing', 'ready', 'in_process'];

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  pending: { bg: 'var(--badge-yellow-bg)', color: '#fbbf24' },
  confirmed: { bg: 'var(--badge-green-bg)', color: 'var(--green)' },
  processing: { bg: 'var(--accent-subtle)', color: '#a78bfa' },
  ready: { bg: 'var(--accent-subtle)', color: '#60a5fa' },
  in_process: { bg: 'var(--accent-subtle)', color: '#f97316' },
};

function formatTime(ts: string | null) {
  if (!ts) return '-';
  const d = new Date(ts);
  const day = d.getDate();
  const mon = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][d.getMonth()];
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${mon} ${h}:${m}`;
}

export default function SyncManager() {
  const [viewMode, setViewMode] = useState<ViewMode>('pending');
  const [configured, setConfigured] = useState(false);
  const [bizCount, setBizCount] = useState(0);

  // Pending orders
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  // Sync all
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncAllProgress, setSyncAllProgress] = useState({ current: 0, total: 0 });
  const abortRef = useRef(false);

  // Repair mode
  const [repairDate, setRepairDate] = useState('');
  const [repairSyncing, setRepairSyncing] = useState(false);
  const [repairResult, setRepairResult] = useState<any>(null);


  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [status, pendingList] = await Promise.all([
        getScalevStatus(),
        getPendingOrders(),
      ]);
      setConfigured(status.configured);
      setBizCount(status.businessesWithApiKeys);
      setOrders(pendingList);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function syncOne(orderId: string) {
    setRowStates(prev => ({ ...prev, [orderId]: { syncing: true, result: null } }));
    try {
      const res = await fetch('/api/scalev-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'order_id', order_ids: [orderId] }),
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        throw new Error(res.status === 504 ? 'Timeout' : `Error ${res.status}`);
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync gagal');

      const detail = data.details?.[0];
      if (detail?.error) {
        setRowStates(prev => ({ ...prev, [orderId]: { syncing: false, result: { success: false, error: detail.error } } }));
      } else {
        const newStatus = detail?.new_status || '';
        const isTerminal = !PRE_TERMINAL.includes(newStatus) && newStatus !== '';
        setRowStates(prev => ({
          ...prev,
          [orderId]: {
            syncing: false,
            result: { success: true, newStatus, action: detail?.action || (isTerminal ? `→ ${newStatus}` : 'no_change') },
          },
        }));
        if (isTerminal) {
          setTimeout(() => setOrders(prev => prev.filter(o => o.order_id !== orderId)), 2000);
        }
      }
    } catch (err: any) {
      setRowStates(prev => ({ ...prev, [orderId]: { syncing: false, result: { success: false, error: err.message } } }));
    }
  }

  async function syncAll() {
    abortRef.current = false;
    setSyncingAll(true);
    const pending = orders.filter(o => {
      const rs = rowStates[o.order_id];
      if (rs?.result?.newStatus && !PRE_TERMINAL.includes(rs.result.newStatus)) return false;
      return true;
    });
    setSyncAllProgress({ current: 0, total: pending.length });

    for (let i = 0; i < pending.length; i++) {
      if (abortRef.current) break;
      setSyncAllProgress({ current: i + 1, total: pending.length });
      await syncOne(pending[i].order_id);
      if (i < pending.length - 1) await new Promise(r => setTimeout(r, 500));
    }

    setSyncingAll(false);
    // Refresh list
    const updated = await getPendingOrders();
    setOrders(updated);
    setRowStates({});
  }

  async function handleRepair() {
    if (!repairDate) { setMessage({ type: 'error', text: 'Pilih tanggal terlebih dahulu' }); return; }
    setRepairSyncing(true);
    setRepairResult(null);
    setMessage(null);
    try {
      const res = await fetch('/api/scalev-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'repair', date: repairDate }),
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        throw new Error(res.status === 504 ? 'Server timeout (504)' : `Server error ${res.status}`);
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync gagal');
      setRepairResult(data);
      setMessage({ type: 'success', text: `Perbaikan ${repairDate}: ${data.orders_updated} diperbarui` });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setRepairSyncing(false);
    }
  }

  const pill = (active: boolean) => ({
    padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
    background: active ? 'var(--accent)' : 'var(--border)',
    color: active ? '#fff' : 'var(--dim)',
    fontSize: 12, fontWeight: 600 as const,
  });

  const cellStyle = { padding: '6px 8px', borderBottom: '1px solid var(--border)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Status bar */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
            background: configured ? 'var(--badge-green-bg)' : 'var(--badge-yellow-bg)',
            color: configured ? 'var(--green)' : 'var(--yellow)',
          }}>
            {configured ? `${bizCount} business terhubung` : 'Belum ada API key'}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{orders.length} order pending</span>
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Cron: 02:00 WIB (status check)</span>
      </div>

      {/* Message */}
      {message && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, fontSize: 13,
          background: message.type === 'success' ? 'var(--badge-green-bg)' : 'var(--badge-red-bg)',
          color: message.type === 'success' ? 'var(--green)' : '#fca5a5',
        }}>
          {message.text}
        </div>
      )}

      {/* View mode tabs + Sync Semua */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
          <button onClick={() => { setViewMode('pending'); setMessage(null); }} style={pill(viewMode === 'pending')}>
            Order Pending
          </button>
          <button onClick={() => { setViewMode('repair'); setMessage(null); }} style={pill(viewMode === 'repair')}>
            Perbaikan
          </button>
          {viewMode === 'pending' && orders.length > 0 && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              {syncingAll && (
                <>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Sync {syncAllProgress.current}/{syncAllProgress.total}...
                  </span>
                  <button
                    onClick={() => { abortRef.current = true; }}
                    style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--badge-red-bg)', background: 'transparent', color: '#fca5a5', fontSize: 11, cursor: 'pointer' }}
                  >
                    Batal
                  </button>
                </>
              )}
              {!syncingAll && (
                <button
                  onClick={syncAll}
                  disabled={!configured}
                  style={{
                    padding: '6px 14px', borderRadius: 6, border: 'none', cursor: configured ? 'pointer' : 'not-allowed',
                    background: '#047857', color: '#fff', fontSize: 12, fontWeight: 600,
                    opacity: configured ? 1 : 0.5,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
                  Sync Semua
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Pending orders table ── */}
        {viewMode === 'pending' && (
          <>
            {loading ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
                Memuat daftar order...
              </div>
            ) : orders.length === 0 ? (
              <div style={{
                padding: '16px 20px', borderRadius: 8, background: 'var(--badge-green-bg)33', border: '1px solid var(--badge-green-bg)',
                color: 'var(--green)', fontSize: 13,
              }}>
                Semua order sudah ter-sync. Tidak ada order pending.
              </div>
            ) : (
              <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: 'var(--dim)', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Order ID</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Masuk</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Bisnis</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Status</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Tipe</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(o => {
                      const rs = rowStates[o.order_id];
                      const sc = STATUS_COLORS[o.status] || { bg: 'var(--border)', color: 'var(--text-secondary)' };
                      const isTerminal = rs?.result?.newStatus && !PRE_TERMINAL.includes(rs.result.newStatus);
                      return (
                        <tr key={o.order_id} style={{
                          color: 'var(--text-secondary)',
                          background: isTerminal ? 'var(--badge-green-bg)22' : undefined,
                          transition: 'background 0.3s',
                        }}>
                          <td style={{ ...cellStyle, fontFamily: 'monospace', color: 'var(--text)' }}>{o.order_id}</td>
                          <td style={cellStyle}>{formatTime(o.pending_time)}</td>
                          <td style={cellStyle}>
                            <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: 'var(--border)', color: 'var(--text-secondary)' }}>
                              {o.business_code || '-'}
                            </span>
                          </td>
                          <td style={cellStyle}>
                            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: sc.bg, color: sc.color }}>
                              {o.status}
                            </span>
                          </td>
                          <td style={cellStyle}>
                            {o.has_lines ? (
                              <span style={{ color: 'var(--dim)' }}>Update</span>
                            ) : (
                              <span style={{ color: '#60a5fa' }}>Enrichment</span>
                            )}
                          </td>
                          <td style={{ ...cellStyle, textAlign: 'right', minWidth: 120 }}>
                            {rs?.syncing ? (
                              <span style={{ color: 'var(--dim)', fontSize: 11 }}>Syncing...</span>
                            ) : rs?.result ? (
                              rs.result.success ? (
                                <span style={{ color: isTerminal ? 'var(--green)' : 'var(--yellow)', fontSize: 11 }}>
                                  {isTerminal ? `→ ${rs.result.newStatus}` : 'Masih pending'}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--red)', fontSize: 11 }} title={rs.result.error}>
                                  Error
                                </span>
                              )
                            ) : (
                              <button
                                onClick={() => syncOne(o.order_id)}
                                disabled={!configured || syncingAll}
                                style={{
                                  padding: '3px 10px', borderRadius: 4, border: 'none',
                                  background: 'var(--green)', color: '#fff', fontSize: 11, fontWeight: 600,
                                  cursor: configured && !syncingAll ? 'pointer' : 'not-allowed',
                                  opacity: configured && !syncingAll ? 1 : 0.5,
                                }}
                              >
                                Sync
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && orders.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                Sync per order memanggil Scalev API + update DB + enrichment lines.
              </div>
            )}
          </>
        )}

        {/* ── Repair mode ── */}
        {viewMode === 'repair' && (
          <>
            <p style={{ fontSize: 12, color: 'var(--dim)', margin: '0 0 12px' }}>
              Cari order shipped yang belum punya lines untuk tanggal tertentu, lalu perbaiki dari Scalev API.
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' }}>Tanggal</label>
                <input
                  type="date"
                  value={repairDate}
                  onChange={e => setRepairDate(e.target.value)}
                  style={{
                    padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)',
                    background: 'var(--bg)', color: 'var(--text)', fontSize: 13, width: 200,
                  }}
                />
              </div>
              <button
                onClick={handleRepair}
                disabled={repairSyncing || !configured}
                style={{
                  padding: '8px 20px', borderRadius: 6, border: 'none',
                  cursor: repairSyncing || !configured ? 'not-allowed' : 'pointer',
                  background: repairSyncing ? 'var(--bg-deep)' : 'var(--accent)',
                  color: '#fff', fontSize: 13, fontWeight: 600,
                  opacity: repairSyncing || !configured ? 0.5 : 1,
                }}
              >
                {repairSyncing ? 'Memperbaiki...' : 'Mulai Perbaikan'}
              </button>
            </div>

            {repairResult && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>
                  Selesai ({(repairResult.duration_ms / 1000).toFixed(1)}s) — {repairResult.orders_updated} diperbaiki
                </div>
                {repairResult.details?.length > 0 && (
                  <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: 'var(--dim)', textAlign: 'left' }}>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Order ID</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Business</th>
                          <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {repairResult.details.map((d: any, i: number) => (
                          <tr key={i} style={{ color: d.error ? '#fca5a5' : 'var(--text-secondary)' }}>
                            <td style={{ ...cellStyle, fontFamily: 'monospace' }}>{d.order_id}</td>
                            <td style={cellStyle}>{d.business_code || '-'}</td>
                            <td style={cellStyle}>{d.error || d.action || `${d.old_status} → ${d.new_status}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
