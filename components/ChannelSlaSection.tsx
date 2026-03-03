// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import { fetchChannelSla, type SlaRow } from '@/lib/sla-actions';

const CHANNEL_DISPLAY_NAME: Record<string, string> = {
  'Facebook Ads': 'Scalev',
};

function displayName(ch: string) {
  return CHANNEL_DISPLAY_NAME[ch] || ch;
}

function slaColor(days: number): string {
  if (days <= 5) return '#10b981';
  if (days <= 10) return '#f59e0b';
  if (days <= 15) return '#f97316';
  return '#ef4444';
}

function slaBg(days: number): string {
  if (days <= 5) return '#064e3b';
  if (days <= 10) return '#78350f';
  if (days <= 15) return '#7c2d12';
  return '#7f1d1d';
}

const PAYMENT_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  cod:           { bg: '#7c2d12', color: '#fb923c', label: 'COD' },
  marketplace:   { bg: '#1e3a5f', color: '#60a5fa', label: 'Marketplace' },
  bank_transfer: { bg: '#064e3b', color: '#34d399', label: 'Bank Transfer' },
  no_payment:    { bg: '#1e293b', color: '#94a3b8', label: 'No Payment' },
  unknown:       { bg: '#1e293b', color: '#64748b', label: 'Unknown' },
};

function paymentStyle(method: string) {
  return PAYMENT_STYLE[method] || { bg: '#1e293b', color: '#94a3b8', label: method };
}

interface Props {
  from: string;
  to: string;
}

export default function ChannelSlaSection({ from, to }: Props) {
  const [data, setData] = useState<SlaRow[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Order SLA · Shipped → Completed</div>
        <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 12 }}>Memuat data SLA...</div>
      </div>
    );
  }

  if (tableRows.length === 0) {
    return (
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Order SLA · Shipped → Completed</div>
        <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 12 }}>Tidak ada data SLA untuk periode ini.</div>
      </div>
    );
  }

  return (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, overflowX: 'auto' }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Order SLA · Shipped → Completed</div>
        <div style={{ fontSize: 11, color: '#64748b' }}>
          Waktu dari pengiriman hingga selesai per channel · Anomali data dikeluarkan
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #1a2744' }}>
            {['Channel', 'Payment', 'Orders', 'Median', 'Avg', 'P90', 'Min', 'Max'].map(h => (
              <th key={h} style={{
                padding: '8px 10px',
                textAlign: h === 'Channel' || h === 'Payment' ? 'left' : 'right',
                color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
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
                  borderBottom: `1px solid ${isChannel ? '#1e293b' : '#141d2e'}`,
                  background: isChannel && row.hasMultiple ? '#0c1524' : 'transparent',
                }}
              >
                {/* Channel */}
                <td style={{ padding: '8px 10px', fontWeight: isChannel ? 600 : 400 }}>
                  {isChannel ? displayName(row.channel) : (
                    <span style={{ paddingLeft: 16, color: '#64748b' }}>└</span>
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
                    <span style={{ fontSize: 10, color: '#475569' }}>All</span>
                  ) : null}
                </td>

                {/* Orders */}
                <td style={{
                  padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace',
                  fontWeight: isChannel ? 600 : 400, color: isSubRow ? '#94a3b8' : '#e2e8f0',
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
                  color: isSubRow ? '#64748b' : '#94a3b8',
                }}>
                  {row.avg}d
                </td>

                {/* P90 */}
                <td style={{
                  padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace',
                  color: isSubRow ? '#475569' : '#64748b',
                }}>
                  {row.p90}d
                </td>

                {/* Min */}
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#475569' }}>
                  {row.min}d
                </td>

                {/* Max */}
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#475569' }}>
                  {row.max}d
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 10, color: '#475569' }}>
        <span><span style={{ color: '#10b981' }}>●</span> ≤5 hari</span>
        <span><span style={{ color: '#f59e0b' }}>●</span> 6–10 hari</span>
        <span><span style={{ color: '#f97316' }}>●</span> 11–15 hari</span>
        <span><span style={{ color: '#ef4444' }}>●</span> &gt;15 hari</span>
        <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>P90 = 90% orders selesai dalam X hari</span>
      </div>
    </div>
  );
}
