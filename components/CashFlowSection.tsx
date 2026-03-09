// @ts-nocheck
// components/CashFlowSection.tsx
'use client';

import { useState, useEffect } from 'react';
import { fetchLiveCashFlow } from '@/lib/cashflow-actions';
import { fmtCompact } from '@/lib/utils';

/* ── Channel display config ── */

const CHANNEL_ORDER = [
  'TikTok Shop',
  'Shopee',
  'MP Lainnya',
  'Scalev Ads (COD)',
  'Scalev Ads (Transfer)',
  'CS Manual (COD)',
  'CS Manual (Transfer)',
];

const CH_COLORS: Record<string, string> = {
  'TikTok Shop': '#00f2ea',
  'Shopee': '#ee4d2d',
  'MP Lainnya': '#6366f1',
  'Scalev Ads (COD)': '#1877f2',
  'Scalev Ads (Transfer)': '#60a5fa',
  'CS Manual (COD)': '#10b981',
  'CS Manual (Transfer)': '#34d399',
};

const CATEGORY_KEYS = ['cash_received', 'spill_over', 'in_progress', 'overdue'] as const;
const CAT_LABELS: Record<string, string> = {
  cash_received: 'Received',
  spill_over: 'Spill Over',
  in_progress: 'In Progress',
  overdue: 'Overdue',
};
const CAT_COLORS: Record<string, string> = {
  cash_received: '#10b981',
  spill_over: '#8b5cf6',
  in_progress: '#f59e0b',
  overdue: '#ef4444',
};

/* ── Main Component ── */

interface Props {
  netSales: number;
  periodStart: string;
}

export default function CashFlowSection({ netSales, periodStart }: Props) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!periodStart) return;
    loadCashFlow();
  }, [periodStart]);

  function loadCashFlow() {
    setLoading(true);
    setError(null);
    fetchLiveCashFlow(periodStart)
      .then(d => {
        setData(d);
        setError(null);
      })
      .catch(err => {
        console.error('CashFlow error:', err);
        setError(err?.message || String(err) || 'Gagal memuat data cash flow');
      })
      .finally(() => setLoading(false));
  }

  // Period label
  const [y, m] = (periodStart || '2026-01').split('-').map(Number);
  const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const periodLabel = `${monthNames[m]} ${y}`;

  if (loading) {
    return (
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Cash Flow Status</div>
        <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 12 }}>Memuat data cash flow...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Cash Flow Status</div>
        <div style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>
            {error || 'Data tidak tersedia'}
          </div>
          <button
            onClick={loadCashFlow}
            style={{
              background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
              color: '#94a3b8', padding: '6px 16px', fontSize: 12, cursor: 'pointer',
            }}
          >
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  const totalCashIn = data.cashReceived + data.spillOver;
  const pct = (v) => netSales > 0 ? (v / netSales * 100) : 0;

  // Determine which channels have data
  const byChannel = data.byChannel || {};
  const activeChannels = CHANNEL_ORDER.filter(ch =>
    CATEGORY_KEYS.some(cat => byChannel[cat]?.[ch]?.total > 0 || byChannel[cat]?.[ch]?.orders > 0)
  );

  return (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, marginBottom: 20 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Cash Flow Status</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            {periodLabel} · Sumber data: Scalev Orders
          </div>
        </div>
      </div>

      {/* ── Row 1: Cash Masuk ── */}
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
        Cash Masuk
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <MiniCard
          label="Received (bulan ini)"
          value={data.cashReceived}
          orders={data.cashReceivedOrders}
          pctValue={pct(data.cashReceived)}
          color="#10b981"
          bgAccent="#064e3b"
          sub="Completed shipment + Bank Transfer shipped bulan ini"
        />
        <MiniCard
          label="Spill Over (bulan lalu)"
          value={data.spillOver}
          orders={data.spillOverOrders}
          pctValue={pct(data.spillOver)}
          color="#8b5cf6"
          bgAccent="#2e1065"
          sub="COD & MP shipped bulan lalu, completed bulan ini"
        />
        {/* Total Cash In — highlighted */}
        <div style={{
          flex: '1 1 180px', background: '#0f2318', borderRadius: 10,
          padding: '14px 16px', border: '2px solid #10b981',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#10b981' }} />
          <div style={{ fontSize: 10, color: '#10b981', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 6 }}>
            Total Cash Masuk
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', color: '#10b981', lineHeight: 1.1 }}>
            Rp {fmtCompact(totalCashIn)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
            <span style={{ color: '#64748b' }}>{(data.cashReceivedOrders + data.spillOverOrders).toLocaleString('id-ID')} orders</span>
            <span style={{
              padding: '2px 8px', borderRadius: 4, fontWeight: 800, fontSize: 11,
              background: '#064e3b', color: '#10b981', fontFamily: 'monospace',
            }}>
              {pct(totalCashIn).toFixed(1)}%
            </span>
          </div>
          <div style={{ fontSize: 10, color: '#4ade80', marginTop: 4, opacity: 0.7 }}>
            of Net Sales
          </div>
        </div>
      </div>

      {/* ── Row 2: Cash Belum Masuk ── */}
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
        Cash Belum Masuk
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <MiniCard
          label="In Progress (bulan ini)"
          value={data.cashInProgress}
          orders={data.cashInProgressOrders}
          pctValue={pct(data.cashInProgress)}
          color="#f59e0b"
          bgAccent="#78350f"
          sub="COD & MP shipped bulan ini, menunggu completed"
        />
        <MiniCard
          label="Overdue (bulan lalu)"
          value={data.overdue}
          orders={data.overdueOrders}
          pctValue={pct(data.overdue)}
          color={data.overdueOrders > 0 ? '#ef4444' : '#64748b'}
          bgAccent={data.overdueOrders > 0 ? '#7f1d1d' : '#1e293b'}
          sub="COD & MP shipped bulan lalu, bulan ini masih belum completed"
          warn={data.overdueOrders > 100}
        />
      </div>

      {/* ── Progress Bar ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: '#1e293b',
        }}>
          {pct(data.cashReceived) > 0 && (
            <div style={{ width: `${pct(data.cashReceived)}%`, background: '#10b981', transition: 'width 0.5s' }} />
          )}
          {pct(data.spillOver) > 0 && (
            <div style={{ width: `${pct(data.spillOver)}%`, background: '#8b5cf6', transition: 'width 0.5s' }} />
          )}
          {pct(data.cashInProgress) > 0 && (
            <div style={{ width: `${Math.min(pct(data.cashInProgress), 100 - pct(data.cashReceived) - pct(data.spillOver))}%`, background: '#f59e0b', opacity: 0.6, transition: 'width 0.5s' }} />
          )}
          {pct(data.overdue) > 0 && (
            <div style={{ width: `${Math.min(pct(data.overdue), 5)}%`, background: '#ef4444', opacity: 0.8, transition: 'width 0.5s' }} />
          )}
        </div>
      </div>

      {/* ── Channel Breakdown Table ── */}
      {activeChannels.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
            Breakdown per Channel
          </div>
          <div style={{ overflowX: 'auto', margin: '0 -4px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'auto' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left', minWidth: 110 }}>Channel</th>
                  {CATEGORY_KEYS.map(cat => (
                    <th key={cat} style={{ ...thStyle, textAlign: 'right' }}>
                      <span style={{ color: CAT_COLORS[cat] }}>{CAT_LABELS[cat]}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeChannels.map(ch => {
                  const chColor = CH_COLORS[ch] || '#94a3b8';
                  return (
                    <tr key={ch} style={{ borderBottom: '1px solid #1a2744' }}>
                      <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                          background: chColor, marginRight: 6, verticalAlign: 'middle',
                        }} />
                        <span style={{ color: chColor, fontWeight: 600 }}>{ch}</span>
                      </td>
                      {CATEGORY_KEYS.map(cat => {
                        const cell = byChannel[cat]?.[ch];
                        const val = cell?.total || 0;
                        const ord = cell?.orders || 0;
                        return (
                          <td key={cat} style={{ padding: '7px 6px', textAlign: 'right', fontFamily: 'monospace' }}>
                            {val > 0 ? (
                              <div>
                                <div style={{ color: '#e2e8f0' }}>{fmtCompact(val)}</div>
                                <div style={{ color: '#475569', fontSize: 9 }}>
                                  {ord.toLocaleString('id-ID')} ord
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: '#334155' }}>-</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
                {/* ── Totals row ── */}
                <tr style={{ borderTop: '2px solid #1a2744' }}>
                  <td style={{ padding: '8px 6px', fontWeight: 700, color: '#94a3b8' }}>Total</td>
                  {CATEGORY_KEYS.map(cat => {
                    const catTotal = activeChannels.reduce((s, ch) => s + (byChannel[cat]?.[ch]?.total || 0), 0);
                    const catOrders = activeChannels.reduce((s, ch) => s + (byChannel[cat]?.[ch]?.orders || 0), 0);
                    return (
                      <td key={cat} style={{ padding: '7px 6px', textAlign: 'right', fontFamily: 'monospace' }}>
                        <div style={{ color: CAT_COLORS[cat], fontWeight: 700 }}>{fmtCompact(catTotal)}</div>
                        <div style={{ color: '#64748b', fontSize: 9 }}>
                          {catOrders.toLocaleString('id-ID')} ord
                        </div>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Shared table header style ── */
const thStyle: React.CSSProperties = {
  padding: '6px 6px 8px',
  borderBottom: '2px solid #1a2744',
  fontWeight: 600,
  color: '#64748b',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

/* ── Mini Card sub-component ── */
function MiniCard({ label, value, orders, pctValue, color, bgAccent, sub, warn = false }) {
  return (
    <div style={{
      flex: '1 1 180px', background: '#0c1524', borderRadius: 10,
      padding: '14px 16px', border: '1px solid #1a2744',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color, lineHeight: 1.1 }}>
        Rp {fmtCompact(value)}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11 }}>
        <span style={{ color: '#64748b' }}>{orders.toLocaleString('id-ID')} orders</span>
        <span style={{
          padding: '1px 6px', borderRadius: 4, fontWeight: 700, fontSize: 10,
          background: bgAccent, color, fontFamily: 'monospace',
        }}>
          {pctValue.toFixed(1)}%
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#475569', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
        {warn && <span style={{ color: '#ef4444' }}>!</span>}
        {sub}
      </div>
    </div>
  );
}
