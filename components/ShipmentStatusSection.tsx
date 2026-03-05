// @ts-nocheck
// components/ShipmentStatusSection.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { fetchShipmentStatus, type ShipmentChannelRow } from '@/lib/shipment-actions';
import { fmtCompact, fmtRupiah, CHANNEL_COLORS } from '@/lib/utils';

// ── Sales channel display names (same as channels page) ──
const CHANNEL_DISPLAY_NAME: Record<string, string> = {
  'Facebook Ads': 'Scalev',
};

function displayName(ch: string) {
  return CHANNEL_DISPLAY_NAME[ch] || ch;
}

interface Props {
  from: string;
  to: string;
}

export default function ShipmentStatusSection({ from, to }: Props) {
  const [data, setData] = useState<ShipmentChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    if (!from || !to) return;
    setLoading(true);
    fetchShipmentStatus(from, to)
      .then(setData)
      .catch(err => console.error('Shipment status error:', err))
      .finally(() => setLoading(false));
  }, [from, to]);

  // Aggregate totals
  const totals = useMemo(() => {
    const t = {
      completed: 0, completedRev: 0,
      inTransit: 0, inTransitRev: 0,
      returned: 0, returnedRev: 0,
      overdue: 0, overdueRev: 0,
    };
    data.forEach(row => {
      t.completed += row.completed_orders;
      t.completedRev += row.completed_revenue;
      t.inTransit += row.in_transit_orders;
      t.inTransitRev += row.in_transit_revenue;
      t.returned += row.returned_orders;
      t.returnedRev += row.returned_revenue;
      t.overdue += row.overdue_orders;
      t.overdueRev += row.overdue_revenue;
    });
    return t;
  }, [data]);

  const totalOrders = totals.completed + totals.inTransit + totals.returned;
  const totalRev = totals.completedRev + totals.inTransitRev + totals.returnedRev;
  const pct = (v: number) => totalOrders > 0 ? (v / totalOrders * 100) : 0;

  // Channel rows sorted by total orders desc, with display names applied
  const channelRows = useMemo(() => {
    return data
      .map(row => {
        const total = row.completed_orders + row.in_transit_orders + row.returned_orders + row.overdue_orders;
        return { ...row, displayName: displayName(row.sales_channel), total };
      })
      .filter(r => r.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [data]);

  if (loading) {
    return (
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Shipment Status</div>
        <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 12 }}>Memuat data shipment...</div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Shipment Status</div>
        <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 12 }}>Tidak ada data shipment untuk periode ini.</div>
      </div>
    );
  }

  return (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, overflowX: 'auto' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Shipment Status</div>
        <div style={{ fontSize: 11, color: '#64748b' }}>
          Status pengiriman order yang di-ship periode ini
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatusCard
          label="Completed"
          orders={totals.completed}
          revenue={totals.completedRev}
          pctValue={pct(totals.completed)}
          color="#10b981"
          bgAccent="#064e3b"
        />
        <StatusCard
          label="In Transit"
          orders={totals.inTransit}
          revenue={totals.inTransitRev}
          pctValue={pct(totals.inTransit)}
          color="#f59e0b"
          bgAccent="#78350f"
        />
        <StatusCard
          label="RTS / Cancel"
          orders={totals.returned}
          revenue={totals.returnedRev}
          pctValue={pct(totals.returned)}
          color={totals.returned > 0 ? '#ef4444' : '#64748b'}
          bgAccent={totals.returned > 0 ? '#7f1d1d' : '#1e293b'}
        />
        <StatusCard
          label="Overdue"
          subtitle="Ship bulan lalu"
          orders={totals.overdue}
          revenue={totals.overdueRev}
          pctValue={0}
          color={totals.overdue > 0 ? '#a855f7' : '#64748b'}
          bgAccent={totals.overdue > 0 ? '#581c87' : '#1e293b'}
          hidePct
        />
        {/* Total — highlighted */}
        <div style={{
          flex: '1 1 160px', background: '#0c1524', borderRadius: 10,
          padding: '12px 14px', border: '2px solid #3b82f6',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: '#3b82f6' }} />
          <div style={{ fontSize: 10, color: '#3b82f6', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 4 }}>
            Total Shipped
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: '#e2e8f0', lineHeight: 1.1 }}>
            {totalOrders.toLocaleString('id-ID')}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, fontFamily: 'monospace' }}>
            Rp {fmtCompact(totalRev)}
          </div>
        </div>
      </div>

      {/* ── Progress Bar (current period) ── */}
      <div style={{ marginBottom: totals.overdue > 0 ? 6 : 14 }}>
        <div style={{ fontSize: 9, color: '#475569', marginBottom: 3, fontWeight: 600 }}>Periode ini</div>
        <div style={{
          display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: '#1e293b',
        }}>
          {pct(totals.completed) > 0 && (
            <div style={{ width: `${pct(totals.completed)}%`, background: '#10b981', transition: 'width 0.5s' }} />
          )}
          {pct(totals.inTransit) > 0 && (
            <div style={{ width: `${pct(totals.inTransit)}%`, background: '#f59e0b', transition: 'width 0.5s' }} />
          )}
          {pct(totals.returned) > 0 && (
            <div style={{ width: `${pct(totals.returned)}%`, background: '#ef4444', transition: 'width 0.5s' }} />
          )}
        </div>
      </div>

      {/* ── Overdue Bar (previous period, still pending) ── */}
      {totals.overdue > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 9, color: '#475569', marginBottom: 3, fontWeight: 600 }}>
            Overdue (ship sebelumnya, belum completed)
          </div>
          <div style={{
            display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: '#1e293b',
          }}>
            <div style={{ width: '100%', background: '#a855f7', transition: 'width 0.5s' }} />
          </div>
          <div style={{ fontSize: 9, color: '#a855f7', marginTop: 2, fontFamily: 'monospace' }}>
            {totals.overdue.toLocaleString('id-ID')} orders · Rp {fmtCompact(totals.overdueRev)}
          </div>
        </div>
      )}

      {/* ── Collapsible Channel Breakdown ── */}
      <button
        onClick={() => setShowTable(!showTable)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '8px 0', background: 'none', border: 'none', cursor: 'pointer',
          color: '#64748b', fontSize: 11, fontWeight: 600, marginBottom: showTable ? 10 : 0,
        }}
      >
        <span style={{
          display: 'inline-block', transition: 'transform 0.2s',
          transform: showTable ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>▶</span>
        Breakdown per Channel
        <span style={{ fontSize: 10, fontWeight: 400, color: '#475569' }}>
          ({channelRows.length} channels)
        </span>
      </button>

      {showTable && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #1a2744' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Channel</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Orders</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: '#10b981', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Completed</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: '#f59e0b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>In Transit</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: '#ef4444', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Returned</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: '#a855f7', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Overdue</th>
              </tr>
            </thead>
            <tbody>
              {channelRows.map(row => {
                const chColor = CHANNEL_COLORS[row.displayName] || '#64748b';
                const compPct = row.total > 0 ? (row.completed_orders / row.total * 100) : 0;
                const transPct = row.total > 0 ? (row.in_transit_orders / row.total * 100) : 0;
                const retPct = row.total > 0 ? (row.returned_orders / row.total * 100) : 0;
                const wordsOverduePct = row.total > 0 ? (row.overdue_orders / row.total * 100) : 0;

                return (
                  <tr key={row.sales_channel} style={{ borderBottom: '1px solid #1a2744' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: chColor, marginRight: 8, verticalAlign: 'middle' }} />
                      {row.displayName}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                      {row.total.toLocaleString('id-ID')}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.completed_orders.toLocaleString('id-ID')}</span>
                      <span style={{
                        marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                        background: '#064e3b', color: '#10b981', fontFamily: 'monospace',
                      }}>{compPct.toFixed(0)}%</span>
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      {row.in_transit_orders > 0 ? (
                        <>
                          <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.in_transit_orders.toLocaleString('id-ID')}</span>
                          <span style={{
                            marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            background: '#78350f', color: '#f59e0b', fontFamily: 'monospace',
                          }}>{transPct.toFixed(0)}%</span>
                        </>
                      ) : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      {row.returned_orders > 0 ? (
                        <>
                          <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.returned_orders.toLocaleString('id-ID')}</span>
                          <span style={{
                            marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            background: '#7f1d1d', color: '#ef4444', fontFamily: 'monospace',
                          }}>{retPct.toFixed(0)}%</span>
                        </>
                      ) : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      {row.overdue_orders > 0 ? (
                        <>
                          <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.overdue_orders.toLocaleString('id-ID')}</span>
                          <span style={{
                            marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            background: '#581c87', color: '#a855f7', fontFamily: 'monospace',
                          }}>{wordsOverduePct.toFixed(0)}%</span>
                        </>
                      ) : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                  </tr>
                );
              })}
              {/* Total row */}
              <tr style={{ borderTop: '2px solid #1a2744', background: '#0b1121' }}>
                <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11 }}>TOTAL</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                  {totalOrders.toLocaleString('id-ID')}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{totals.completed.toLocaleString('id-ID')}</span>
                  <span style={{
                    marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                    background: '#064e3b', color: '#10b981', fontFamily: 'monospace',
                  }}>{pct(totals.completed).toFixed(0)}%</span>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{totals.inTransit.toLocaleString('id-ID')}</span>
                  <span style={{
                    marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                    background: '#78350f', color: '#f59e0b', fontFamily: 'monospace',
                  }}>{pct(totals.inTransit).toFixed(0)}%</span>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  {totals.returned > 0 ? (
                    <>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{totals.returned.toLocaleString('id-ID')}</span>
                      <span style={{
                        marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                        background: '#7f1d1d', color: '#ef4444', fontFamily: 'monospace',
                      }}>{pct(totals.returned).toFixed(0)}%</span>
                    </>
                  ) : <span style={{ color: '#334155' }}>—</span>}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  {totals.overdue > 0 ? (
                    <>
                      <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{totals.overdue.toLocaleString('id-ID')}</span>
                    </>
                  ) : <span style={{ color: '#334155' }}>—</span>}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 10, color: '#475569', flexWrap: 'wrap' }}>
            <span><span style={{ color: '#10b981' }}>●</span> Completed — sudah sampai & selesai</span>
            <span><span style={{ color: '#f59e0b' }}>●</span> In Transit — sudah dikirim, belum completed</span>
            <span><span style={{ color: '#ef4444' }}>●</span> RTS / Cancel — dikembalikan / dibatalkan</span>
            <span><span style={{ color: '#a855f7' }}>●</span> Overdue — ship bulan lalu, belum completed</span>
          </div>
        </>
      )}
    </div>
  );
}

function StatusCard({ label, subtitle, orders, revenue, pctValue, color, bgAccent, hidePct }: any) {
  return (
    <div style={{
      flex: '1 1 160px', background: '#0c1524', borderRadius: 10,
      padding: '12px 14px', border: '1px solid #1a2744',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em', marginBottom: subtitle ? 0 : 4 }}>
        {label}
      </div>
      {subtitle && (
        <div style={{ fontSize: 9, color: '#475569', marginBottom: 4, fontStyle: 'italic' }}>{subtitle}</div>
      )}
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', color, lineHeight: 1.1 }}>
        {orders.toLocaleString('id-ID')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, alignItems: 'center' }}>
        <span style={{ color: '#64748b', fontFamily: 'monospace', fontSize: 10 }}>Rp {fmtCompact(revenue)}</span>
        {!hidePct && (
          <span style={{
            padding: '1px 6px', borderRadius: 4, fontWeight: 700, fontSize: 10,
            background: bgAccent, color, fontFamily: 'monospace',
          }}>
            {pctValue.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}
