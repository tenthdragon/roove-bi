// @ts-nocheck
// components/CashFlowSection.tsx
'use client';

import { useState, useEffect } from 'react';
import { fetchLiveCashFlow, fetchCashFlowSnapshots } from '@/lib/cashflow-actions';
import { fmtCompact, fmtRupiah } from '@/lib/utils';

interface Props {
  netSales: number;         // from overview KPI
  periodStart: string;      // YYYY-MM-DD first day of month
}

export default function CashFlowSection({ netSales, periodStart }: Props) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [snapshotting, setSnapshotting] = useState(false);
  const [snapshotResult, setSnapshotResult] = useState(null);

  useEffect(() => {
    if (!periodStart) return;
    setLoading(true);
    fetchLiveCashFlow(periodStart)
      .then(setData)
      .catch(err => console.error('CashFlow error:', err))
      .finally(() => setLoading(false));
  }, [periodStart]);

  async function handleSnapshot() {
    setSnapshotting(true);
    setSnapshotResult(null);
    try {
      const [y, m] = periodStart.split('-').map(Number);
      const res = await fetch('/api/cashflow-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: m, year: y }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setSnapshotResult({ success: true, period: json.period });
    } catch (err) {
      setSnapshotResult({ success: false, error: err.message });
    } finally {
      setSnapshotting(false);
    }
  }

  if (loading) {
    return (
      <div style={{
        background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12,
        padding: 20, marginBottom: 20,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Cash Flow Status</div>
        <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 12 }}>
          Memuat data cash flow...
        </div>
      </div>
    );
  }

  if (!data) return null;

  const totalCashIn = data.cashReceived + data.spillOver;
  const totalCashInPct = netSales > 0 ? (totalCashIn / netSales * 100) : 0;
  const receivedPct = netSales > 0 ? (data.cashReceived / netSales * 100) : 0;
  const spillPct = netSales > 0 ? (data.spillOver / netSales * 100) : 0;
  const progressPct = netSales > 0 ? (data.cashInProgress / netSales * 100) : 0;

  // Period label
  const [y, m] = periodStart.split('-').map(Number);
  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const periodLabel = `${monthNames[m]} ${y}`;

  return (
    <div style={{
      background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12,
      padding: 16, marginBottom: 20,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 14,
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Cash Flow Status</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            {periodLabel} · Total cash masuk: Rp {fmtCompact(totalCashIn)} ({totalCashInPct.toFixed(1)}% of Net Sales)
          </div>
        </div>
        <button
          onClick={handleSnapshot}
          disabled={snapshotting}
          title="Simpan snapshot cash flow bulan ini"
          style={{
            background: '#1e293b', color: '#94a3b8', border: '1px solid #334155',
            borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 600,
            cursor: snapshotting ? 'not-allowed' : 'pointer',
            opacity: snapshotting ? 0.6 : 1,
            display: 'flex', alignItems: 'center', gap: 4,
          }}
        >
          {snapshotting ? '⏳ Saving...' : '📸 Capture Snapshot'}
        </button>
      </div>

      {/* Snapshot result toast */}
      {snapshotResult && (
        <div style={{
          background: snapshotResult.success ? '#0a1e1b' : '#1e0a0a',
          border: `1px solid ${snapshotResult.success ? '#064e3b' : '#7f1d1d'}`,
          borderRadius: 6, padding: '6px 12px', marginBottom: 12, fontSize: 11,
          color: snapshotResult.success ? '#10b981' : '#ef4444',
        }}>
          {snapshotResult.success
            ? `✅ Snapshot ${snapshotResult.period} tersimpan`
            : `❌ ${snapshotResult.error}`}
        </div>
      )}

      {/* 3 Cards */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {/* Cash Received */}
        <div style={{
          flex: '1 1 180px', background: '#0c1524', borderRadius: 10,
          padding: '14px 16px', border: '1px solid #1a2744',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#10b981' }} />
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 6 }}>
            💰 Cash Received
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: '#10b981', lineHeight: 1.1 }}>
            Rp {fmtCompact(data.cashReceived)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
            <span style={{ color: '#64748b' }}>{data.cashReceivedOrders.toLocaleString('id-ID')} orders</span>
            <span style={{
              padding: '1px 6px', borderRadius: 4, fontWeight: 700, fontSize: 10,
              background: '#064e3b', color: '#10b981', fontFamily: 'monospace',
            }}>
              {receivedPct.toFixed(1)}%
            </span>
          </div>
          <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>
            Shipped & completed bulan ini
          </div>
        </div>

        {/* Spill Over */}
        <div style={{
          flex: '1 1 180px', background: '#0c1524', borderRadius: 10,
          padding: '14px 16px', border: '1px solid #1a2744',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#8b5cf6' }} />
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 6 }}>
            🔄 Spill Over Revenue
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: '#8b5cf6', lineHeight: 1.1 }}>
            Rp {fmtCompact(data.spillOver)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
            <span style={{ color: '#64748b' }}>{data.spillOverOrders.toLocaleString('id-ID')} orders</span>
            <span style={{
              padding: '1px 6px', borderRadius: 4, fontWeight: 700, fontSize: 10,
              background: '#2e1065', color: '#8b5cf6', fontFamily: 'monospace',
            }}>
              {spillPct.toFixed(1)}%
            </span>
          </div>
          <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>
            Shipped bulan lalu, completed bulan ini
          </div>
        </div>

        {/* Cash in Progress */}
        <div style={{
          flex: '1 1 180px', background: '#0c1524', borderRadius: 10,
          padding: '14px 16px', border: '1px solid #1a2744',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#f59e0b' }} />
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 6 }}>
            💸 Cash in Progress
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace', color: '#f59e0b', lineHeight: 1.1 }}>
            Rp {fmtCompact(data.cashInProgress)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
            <span style={{ color: '#64748b' }}>{data.cashInProgressOrders.toLocaleString('id-ID')} orders</span>
            <span style={{
              padding: '1px 6px', borderRadius: 4, fontWeight: 700, fontSize: 10,
              background: '#78350f', color: '#f59e0b', fontFamily: 'monospace',
            }}>
              {progressPct.toFixed(1)}%
            </span>
          </div>
          <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>
            Shipped bulan ini, menunggu completed
          </div>
        </div>
      </div>

      {/* Progress bar visual */}
      <div style={{ marginTop: 12 }}>
        <div style={{
          display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden',
          background: '#1e293b',
        }}>
          {receivedPct > 0 && (
            <div style={{ width: `${receivedPct}%`, background: '#10b981', transition: 'width 0.5s' }}
              title={`Cash Received: ${receivedPct.toFixed(1)}%`} />
          )}
          {spillPct > 0 && (
            <div style={{ width: `${spillPct}%`, background: '#8b5cf6', transition: 'width 0.5s' }}
              title={`Spill Over: ${spillPct.toFixed(1)}%`} />
          )}
          {progressPct > 0 && (
            <div style={{ width: `${Math.min(progressPct, 100 - receivedPct - spillPct)}%`, background: '#f59e0b', opacity: 0.6, transition: 'width 0.5s' }}
              title={`In Progress: ${progressPct.toFixed(1)}%`} />
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10, color: '#64748b' }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#10b981', marginRight: 4, verticalAlign: 'middle' }} />Received</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#8b5cf6', marginRight: 4, verticalAlign: 'middle' }} />Spill Over</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#f59e0b', marginRight: 4, verticalAlign: 'middle' }} />In Progress</span>
        </div>
      </div>
    </div>
  );
}
