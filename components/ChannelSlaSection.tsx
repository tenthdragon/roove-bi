// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import { fetchChannelSla, type SlaRow } from '@/lib/sla-actions';
import { CHANNEL_COLORS } from '@/lib/utils';

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

  // Group by channel, with sub-rows for payment type
  const channels = useMemo(() => {
    const map: Record<string, { total: SlaRow | null; cod: SlaRow | null; nonCod: SlaRow | null }> = {};

    data.forEach(row => {
      if (!map[row.sales_channel]) {
        map[row.sales_channel] = { total: null, cod: null, nonCod: null };
      }
      if (row.payment_type === 'COD') {
        map[row.sales_channel].cod = row;
      } else {
        map[row.sales_channel].nonCod = row;
      }
    });

    // Compute totals per channel
    return Object.entries(map)
      .map(([ch, { cod, nonCod }]) => {
        const totalOrders = (cod?.orders || 0) + (nonCod?.orders || 0);
        // Weighted average for median
        const codWeight = cod ? cod.orders / totalOrders : 0;
        const nonCodWeight = nonCod ? nonCod.orders / totalOrders : 0;
        const avgMedian = (cod?.median_days || 0) * codWeight + (nonCod?.median_days || 0) * nonCodWeight;
        const avgAvg = (cod?.avg_days || 0) * codWeight + (nonCod?.avg_days || 0) * nonCodWeight;

        return {
          channel: ch,
          totalOrders,
          avgDays: Math.round(avgAvg * 10) / 10,
          medianDays: Math.round(avgMedian * 10) / 10,
          cod,
          nonCod,
        };
      })
      .filter(c => c.totalOrders > 0)
      .sort((a, b) => b.totalOrders - a.totalOrders);
  }, [data]);

  if (loading) {
    return (
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Order SLA · Shipped → Completed</div>
        <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 12 }}>Memuat data SLA...</div>
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Order SLA · Shipped → Completed</div>
        <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 12 }}>Tidak ada data SLA untuk periode ini.</div>
      </div>
    );
  }

  return (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Order SLA · Shipped → Completed</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Waktu rata-rata dari pengiriman hingga selesai · Anomali data dikeluarkan
          </div>
        </div>
      </div>

      {/* SLA Cards */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {channels.map(c => (
          <div key={c.channel} style={{
            flex: '1 1 180px', minWidth: 170, background: '#0c1524', borderRadius: 10,
            padding: '14px 16px', border: '1px solid #1a2744', position: 'relative', overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 3,
              background: CHANNEL_COLORS[displayName(c.channel)] || '#3b82f6',
            }} />
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>
              {displayName(c.channel)}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
              <span style={{
                fontSize: 24, fontWeight: 800, fontFamily: 'monospace',
                color: slaColor(c.medianDays), lineHeight: 1,
              }}>
                {c.medianDays}
              </span>
              <span style={{ fontSize: 11, color: '#64748b' }}>hari (median)</span>
            </div>
            <div style={{ fontSize: 10, color: '#475569', marginBottom: 10 }}>
              avg {c.avgDays} hari · {c.totalOrders.toLocaleString('id-ID')} orders
            </div>

            {/* COD vs Non-COD breakdown */}
            <div style={{ display: 'flex', gap: 6 }}>
              {c.nonCod && (
                <div style={{
                  flex: 1, padding: '6px 8px', borderRadius: 6,
                  background: '#0b1121', border: '1px solid #1a2744',
                }}>
                  <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>
                    Non-COD
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: slaColor(c.nonCod.median_days) }}>
                    {c.nonCod.median_days}d
                  </div>
                  <div style={{ fontSize: 9, color: '#475569' }}>
                    {c.nonCod.orders.toLocaleString('id-ID')} ord
                  </div>
                </div>
              )}
              {c.cod && (
                <div style={{
                  flex: 1, padding: '6px 8px', borderRadius: 6,
                  background: '#0b1121', border: '1px solid #1a2744',
                }}>
                  <div style={{ fontSize: 9, color: '#64748b', textTransform: 'uppercase', fontWeight: 600, marginBottom: 3 }}>
                    COD
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: slaColor(c.cod.median_days) }}>
                    {c.cod.median_days}d
                  </div>
                  <div style={{ fontSize: 9, color: '#475569' }}>
                    {c.cod.orders.toLocaleString('id-ID')} ord
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Detail Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #1a2744' }}>
              {['Channel', 'Payment', 'Orders', 'Median', 'Avg', 'P90', 'Min', 'Max'].map(h => (
                <th key={h} style={{
                  padding: '8px 10px', textAlign: h === 'Channel' || h === 'Payment' ? 'left' : 'right',
                  color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data
              .sort((a, b) => b.orders - a.orders)
              .map((row, i) => (
              <tr key={`${row.sales_channel}-${row.payment_type}`} style={{ borderBottom: '1px solid #1a2744' }}>
                <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                  {displayName(row.sales_channel)}
                </td>
                <td style={{ padding: '8px 10px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                    background: row.payment_type === 'COD' ? '#7c2d12' : '#1e3a5f',
                    color: row.payment_type === 'COD' ? '#fb923c' : '#60a5fa',
                  }}>
                    {row.payment_type}
                  </span>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {row.orders.toLocaleString('id-ID')}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                    fontFamily: 'monospace', background: slaBg(row.median_days), color: slaColor(row.median_days),
                  }}>
                    {row.median_days}d
                  </span>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#94a3b8' }}>
                  {row.avg_days}d
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#64748b' }}>
                  {row.p90_days}d
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#475569' }}>
                  {row.min_days}d
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#475569' }}>
                  {row.max_days}d
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
