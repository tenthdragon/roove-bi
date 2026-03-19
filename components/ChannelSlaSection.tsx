// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import { fetchChannelSla, type SlaRow } from '@/lib/sla-actions';

function displayName(ch: string) {
  return ch;
}

function slaColor(days: number): string {
  if (days <= 5) return 'var(--green)';
  if (days <= 10) return 'var(--yellow)';
  if (days <= 15) return '#f97316';
  return 'var(--red)';
}

function slaBg(days: number): string {
  if (days <= 5) return 'var(--badge-green-bg)';
  if (days <= 10) return 'var(--badge-yellow-bg)';
  if (days <= 15) return '#7c2d12';
  return 'var(--badge-red-bg)';
}

const PAYMENT_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  cod:           { bg: '#7c2d12', color: '#fb923c', label: 'COD' },
  marketplace:   { bg: '#1e3a5f', color: '#60a5fa', label: 'Marketplace' },
  bank_transfer: { bg: '#064e3b', color: '#34d399', label: 'Bank Transfer' },
  no_payment:    { bg: 'var(--bg-deep)', color: 'var(--text-secondary)', label: 'No Payment' },
  unknown:       { bg: 'var(--bg-deep)', color: 'var(--dim)', label: 'Unknown' },
};

function paymentStyle(method: string) {
  return PAYMENT_STYLE[method] || { bg: 'var(--bg-deep)', color: 'var(--text-secondary)', label: method };
}

interface Props {
  from: string;
  to: string;
}

export default function ChannelSlaSection({ from, to }: Props) {
  const [data, setData] = useState<SlaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    if (!from || !to) return;
    setLoading(true);
    fetchChannelSla(from, to)
      .then(setData)
      .catch(err => console.error('SLA fetch error:', err))
      .finally(() => setLoading(false));
  }, [from, to]);

  // Group by channel, build rows: channel total + sub-rows per payment type
  const tableRows = useMemo(() => {
    const byChannel: Record<string, SlaRow[]> = {};
    data.forEach(row => {
      if (!byChannel[row.sales_channel]) byChannel[row.sales_channel] = [];
      byChannel[row.sales_channel].push(row);
    });

    // Sort channels by total orders desc
    const sorted = Object.entries(byChannel)
      .map(([ch, rows]) => ({
        channel: ch,
        rows: rows.sort((a, b) => b.orders - a.orders),
        totalOrders: rows.reduce((s, r) => s + r.orders, 0),
      }))
      .sort((a, b) => b.totalOrders - a.totalOrders);

    // Build flat list with channel summary + payment sub-rows
    const result: Array<{
      type: 'channel' | 'payment';
      channel: string;
      paymentType?: string;
      orders: number;
      median: number;
      avg: number;
      p90: number;
      min: number;
      max: number;
      hasMultiple: boolean;
    }> = [];

    for (const { channel, rows, totalOrders } of sorted) {
      const hasMultiple = rows.length > 1;

      if (hasMultiple) {
        // Channel summary row (weighted)
        const wMedian = rows.reduce((s, r) => s + r.median_days * r.orders, 0) / totalOrders;
        const wAvg = rows.reduce((s, r) => s + r.avg_days * r.orders, 0) / totalOrders;
        const wP90 = rows.reduce((s, r) => s + r.p90_days * r.orders, 0) / totalOrders;
        const minAll = Math.min(...rows.map(r => r.min_days));
        const maxAll = Math.max(...rows.map(r => r.max_days));

        result.push({
          type: 'channel', channel, orders: totalOrders,
          median: Math.round(wMedian * 10) / 10,
          avg: Math.round(wAvg * 10) / 10,
          p90: Math.round(wP90 * 10) / 10,
          min: minAll, max: maxAll, hasMultiple,
        });

        // Sub-rows per payment type
        for (const r of rows) {
          result.push({
            type: 'payment', channel, paymentType: r.payment_type,
            orders: r.orders, median: r.median_days, avg: r.avg_days,
            p90: r.p90_days, min: r.min_days, max: r.max_days, hasMultiple,
          });
        }
      } else {
        // Single payment type — show as channel row directly with payment badge
        const r = rows[0];
        result.push({
          type: 'channel', channel, paymentType: r.payment_type,
          orders: r.orders, median: r.median_days, avg: r.avg_days,
          p90: r.p90_days, min: r.min_days, max: r.max_days, hasMultiple,
        });
      }
    }

    return result;
  }, [data]);

  // Summary per payment method (for cards)
  const paymentSummary = useMemo(() => {
    const byPay: Record<string, { orders: number; totalDays: number }> = {};
    data.forEach(row => {
      const key = row.payment_type || 'unknown';
      if (!byPay[key]) byPay[key] = { orders: 0, totalDays: 0 };
      byPay[key].orders += row.orders;
      byPay[key].totalDays += row.avg_days * row.orders; // weighted
    });
    return Object.entries(byPay)
      .map(([method, v]) => ({
        method,
        orders: v.orders,
        avgDays: Math.round((v.totalDays / v.orders) * 10) / 10,
      }))
      .sort((a, b) => b.orders - a.orders);
  }, [data]);

  const totalOrders = paymentSummary.reduce((s, p) => s + p.orders, 0);
  const overallAvg = totalOrders > 0
    ? Math.round(paymentSummary.reduce((s, p) => s + p.avgDays * p.orders, 0) / totalOrders * 10) / 10
    : 0;

  if (loading) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Order SLA · Shipped → Completed</div>
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--dim)', fontSize: 12 }}>Memuat data SLA...</div>
      </div>
    );
  }

  if (tableRows.length === 0) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Order SLA · Shipped → Completed</div>
        <div style={{ textAlign: 'center', padding: 20, color: 'var(--dim)', fontSize: 12 }}>Tidak ada data SLA untuk periode ini.</div>
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, overflowX: 'auto' }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Order SLA · Shipped → Completed</div>
        <div style={{ fontSize: 11, color: 'var(--dim)' }}>
          Waktu dari pengiriman hingga selesai per store · Anomali data dikeluarkan
        </div>
      </div>

      {/* Payment Method Summary Cards */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {/* Overall card */}
        <div style={{
          background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '10px 14px', flex: '1 1 120px', minWidth: 110, position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'var(--dim)' }} />
          <div style={{ fontSize: 9, color: 'var(--dim)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 4 }}>Semua</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: slaColor(overallAvg) }}>
            {overallAvg}d
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{totalOrders.toLocaleString('id-ID')} orders</div>
        </div>
        {paymentSummary.filter(p => p.method !== 'unknown' && p.method !== 'no_payment').map(p => {
          const ps = paymentStyle(p.method);
          return (
            <div key={p.method} style={{
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '10px 14px', flex: '1 1 120px', minWidth: 110, position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: ps.color }} />
              <div style={{ fontSize: 9, color: ps.color, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 4 }}>
                {ps.label}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: slaColor(p.avgDays) }}>
                {p.avgDays}d
              </div>
              <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{p.orders.toLocaleString('id-ID')} orders</div>
            </div>
          );
        })}
      </div>

      {/* Collapsible Store Breakdown */}
      <button
        onClick={() => setShowTable(!showTable)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--dim)', fontSize: 11, fontWeight: 600, marginBottom: showTable ? 10 : 0,
        }}
      >
        <span style={{
          display: 'inline-block', transition: 'transform 0.2s',
          transform: showTable ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>▶</span>
        Breakdown per Store
        <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)' }}>
          ({tableRows.filter(r => r.type === 'channel').length} stores)
        </span>
      </button>

      {showTable && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                {['Store', 'Payment', 'Orders', 'Median', 'Avg', 'P90', 'Min', 'Max'].map(h => (
                  <th key={h} style={{
                    padding: '8px 10px',
                    textAlign: h === 'Store' || h === 'Payment' ? 'left' : 'right',
                    color: 'var(--dim)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, i) => {
                const isChannel = row.type === 'channel';
                const isSubRow = row.type === 'payment';

                return (
                  <tr
                    key={`${row.channel}-${row.paymentType || 'all'}`}
                    style={{
                      borderBottom: '1px solid var(--bg-deep)',
                      background: isChannel && row.hasMultiple ? 'var(--bg-deep)' : 'transparent',
                    }}
                  >
                    {/* Store */}
                    <td style={{ padding: '8px 10px', fontWeight: isChannel ? 600 : 400 }}>
                      {isChannel ? displayName(row.channel) : (
                        <span style={{ paddingLeft: 16, color: 'var(--dim)' }}>└</span>
                      )}
                    </td>

                    {/* Payment Type */}
                    <td style={{ padding: '8px 10px' }}>
                      {(isChannel && !row.hasMultiple && row.paymentType) || isSubRow ? (() => {
                        const ps = paymentStyle(row.paymentType);
                        return (
                          <span style={{
                            padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            background: ps.bg, color: ps.color,
                          }}>
                            {ps.label}
                          </span>
                        );
                      })() : isChannel && row.hasMultiple ? (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>All</span>
                      ) : null}
                    </td>

                    {/* Orders */}
                    <td style={{
                      padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace',
                      fontWeight: isChannel ? 600 : 400, color: isSubRow ? 'var(--text-secondary)' : 'var(--text)',
                    }}>
                      {row.orders.toLocaleString('id-ID')}
                    </td>

                    {/* Median */}
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 11,
                        fontWeight: isChannel ? 700 : 600, fontFamily: 'monospace',
                        background: slaBg(row.median), color: slaColor(row.median),
                      }}>
                        {row.median}d
                      </span>
                    </td>

                    {/* Avg */}
                    <td style={{
                      padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace',
                      color: isSubRow ? 'var(--dim)' : 'var(--text-secondary)',
                    }}>
                      {row.avg}d
                    </td>

                    {/* P90 */}
                    <td style={{
                      padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace',
                      color: isSubRow ? 'var(--text-muted)' : 'var(--dim)',
                    }}>
                      {row.p90}d
                    </td>

                    {/* Min */}
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {row.min}d
                    </td>

                    {/* Max */}
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {row.max}d
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 10, color: 'var(--text-muted)' }}>
            <span><span style={{ color: 'var(--green)' }}>●</span> ≤5 hari</span>
            <span><span style={{ color: 'var(--yellow)' }}>●</span> 6–10 hari</span>
            <span><span style={{ color: '#f97316' }}>●</span> 11–15 hari</span>
            <span><span style={{ color: 'var(--red)' }}>●</span> &gt;15 hari</span>
            <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>P90 = 90% orders selesai dalam X hari</span>
          </div>
        </>
      )}
    </div>
  );
}
