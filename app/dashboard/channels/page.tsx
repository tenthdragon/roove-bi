// @ts-nocheck
'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { fmtCompact, fmtRupiah, CHANNEL_COLORS } from '@/lib/utils';
import { useDateRange } from '@/lib/DateRangeContext';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

export default function ChannelsPage() {
  const supabase = createClient();
  const { dateRange, loading: dateLoading } = useDateRange();
  const [channelData, setChannelData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState('all');

  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    setLoading(true);
    supabase.from('daily_channel_data')
      .select('product, channel, net_sales, gross_profit, mp_admin_cost, net_after_mkt')
      .gte('date', dateRange.from).lte('date', dateRange.to)
      .then(({ data }) => {
        setChannelData(data || []);
        setLoading(false);
      });
  }, [dateRange, supabase]);

  // Unique products for filter
  const products = useMemo(() => {
    const set = new Set();
    channelData.forEach(d => { if (d.product) set.add(d.product); });
    return Array.from(set).sort();
  }, [channelData]);

  // Aggregate channel data — all metrics from single source (daily_channel_data)
  const channels = useMemo(() => {
    const byC = {};
    channelData.forEach(d => {
      if (selectedProduct !== 'all' && d.product !== selectedProduct) return;
      if (!byC[d.channel]) byC[d.channel] = { revenue: 0, gp: 0, mpAdmin: 0, profitAfterMkt: 0 };
      byC[d.channel].revenue += Number(d.net_sales) || 0;
      byC[d.channel].gp += Number(d.gross_profit) || 0;
      byC[d.channel].mpAdmin += Math.abs(Number(d.mp_admin_cost) || 0);
      byC[d.channel].profitAfterMkt += Number(d.net_after_mkt) || 0;
    });

    const totalRevenue = Object.values(byC).reduce((a, v) => a + v.revenue, 0);

    return Object.entries(byC)
      .map(([ch, v]) => {
        // Mkt Cost = GP - Profit After Mkt (derived, guaranteed consistent)
        const mktCost = v.gp - v.profitAfterMkt;
        const mpAdminPct = mktCost > 0 ? (v.mpAdmin / mktCost) * 100 : 0;
        return {
          name: ch,
          revenue: v.revenue,
          gp: v.gp,
          mpAdmin: v.mpAdmin,
          profitAfterMkt: v.profitAfterMkt,
          mktCost,
          mpAdminPct,
          pct: totalRevenue > 0 ? (v.revenue / totalRevenue) * 100 : 0,
          gpMargin: v.revenue > 0 ? (v.gp / v.revenue) * 100 : 0,
          mktRatio: v.revenue > 0 ? (mktCost / v.revenue) * 100 : 0,
          marginAfterMkt: v.revenue > 0 ? (v.profitAfterMkt / v.revenue) * 100 : 0,
        };
      })
      .filter(c => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [channelData, selectedProduct]);

  const totalRevenue = channels.reduce((a, c) => a + c.revenue, 0);
  const totalGP = channels.reduce((a, c) => a + c.gp, 0);
  const totalMktCost = channels.reduce((a, c) => a + c.mktCost, 0);
  const totalMpAdmin = channels.reduce((a, c) => a + c.mpAdmin, 0);
  const totalProfitAfterMkt = channels.reduce((a, c) => a + c.profitAfterMkt, 0);

  const pieData = channels.filter(c => c.revenue > 0).map(c => ({ name: c.name, value: c.revenue }));

  const KPI = ({ label, val, sub, color = '#3b82f6' }) => (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: '16px 18px', flex: '1 1 160px', minWidth: 150, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1.1 }}>{val}</div>
      {sub && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{sub}</div>}
    </div>
  );

  if (dateLoading || (loading && channelData.length === 0)) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>
        <div className="spinner" style={{ width: 32, height: 32, border: '3px solid #1a2744', borderTop: '3px solid #3b82f6', borderRadius: '50%', margin: '0 auto 12px' }} />
        <div>Memuat data...</div>
      </div>
    );
  }

  if (channelData.length === 0 && !loading) {
    return (
      <div className="fade-in">
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Channel</h2>
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b', background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📡</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Belum Ada Data untuk Periode Ini</div>
          <div style={{ fontSize: 13 }}>Coba pilih rentang tanggal lain menggunakan filter di atas.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      {/* Header + Product Filter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Channel</h2>
        <select
          value={selectedProduct}
          onChange={e => setSelectedProduct(e.target.value)}
          style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #1a2744',
            background: '#111a2e', color: '#e2e8f0', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', outline: 'none',
          }}
        >
          <option value="all">Semua Produk</option>
          {products.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Pre-Feb disclaimer */}
      {dateRange.from < '2026-02-01' && (
        <div style={{ background: '#1e1b4b', border: '1px solid #3730a3', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 11, color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>ℹ️</span>
          <span>Data sebelum Feb 2026 tidak termasuk biaya admin marketplace (MP Fee).</span>
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <KPI label="Net Sales" val={`Rp ${fmtCompact(totalRevenue)}`} sub={`${channels.length} active channels`} color="#3b82f6" />
        <KPI label="Gross Profit" val={`Rp ${fmtCompact(totalGP)}`} sub={`GP Margin: ${totalRevenue > 0 ? (totalGP / totalRevenue * 100).toFixed(1) : 0}%`} color="#10b981" />
        <KPI
          label="Mkt Cost + MP Fee"
          val={`Rp ${fmtCompact(totalMktCost)}`}
          sub={totalMpAdmin > 0 ? `MP Fee: Rp ${fmtCompact(totalMpAdmin)} (${(totalMktCost > 0 ? totalMpAdmin / totalMktCost * 100 : 0).toFixed(1)}%)` : 'MP Fee: tidak tersedia'}
          color="#f59e0b"
        />
        <KPI
          label="Profit After Mkt"
          val={`Rp ${fmtCompact(totalProfitAfterMkt)}`}
          sub={`Margin After Mkt: ${totalRevenue > 0 ? (totalProfitAfterMkt / totalRevenue * 100).toFixed(1) : 0}%`}
          color={totalProfitAfterMkt >= 0 ? '#06b6d4' : '#ef4444'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 16, marginBottom: 20 }}>
        {/* Pie Chart */}
        <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Revenue Share</div>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={105} dataKey="value" nameKey="name" stroke="#0b1121" strokeWidth={3}>
                  {pieData.map((c, i) => <Cell key={i} fill={CHANNEL_COLORS[c.name] || `hsl(${i * 40},60%,50%)`} />)}
                </Pie>
                <Tooltip formatter={(v) => fmtRupiah(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>Tidak ada data revenue</div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, justifyContent: 'center' }}>
            {pieData.map((c, i) => (
              <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748b' }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: CHANNEL_COLORS[c.name] || `hsl(${i * 40},60%,50%)` }} />{c.name}
              </div>
            ))}
          </div>
        </div>

        {/* Channel Cards */}
        <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Revenue per Channel</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {channels.map((c, i) => (
              <div key={c.name} style={{ padding: 10, background: '#0b1121', borderRadius: 8, border: '1px solid #1a2744' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: CHANNEL_COLORS[c.name] || `hsl(${i * 40},60%,50%)` }} />
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</span>
                  </div>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>Rp {fmtCompact(c.revenue)}</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: '#1a2744', overflow: 'hidden', marginBottom: 3 }}>
                  <div style={{ width: `${c.pct}%`, height: '100%', borderRadius: 2, background: CHANNEL_COLORS[c.name] || `hsl(${i * 40},60%,50%)` }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b' }}>
                  <span>{c.pct.toFixed(1)}% revenue</span><span>GP Margin: {c.gpMargin.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Channel Breakdown Table */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, overflowX: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Channel Breakdown</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #1a2744' }}>
              {['Channel', 'Net Sales', '% Share', 'Gross Profit', 'Mkt Cost + MP Fee', 'Mkt Ratio', 'Profit After Mkt', 'Margin After Mkt'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Channel' ? 'left' : 'right', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map(c => (
              <tr key={c.name} style={{ borderBottom: '1px solid #1a2744' }}>
                <td style={{ padding: '8px 10px' }}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  {c.mpAdmin > 0 && (
                    <div style={{ fontSize: 10, color: '#8b5cf6', marginTop: 2 }}>
                      MP Fee: Rp {fmtCompact(c.mpAdmin)} ({c.mpAdminPct.toFixed(0)}%)
                    </div>
                  )}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{fmtRupiah(c.revenue)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#64748b' }}>{c.pct.toFixed(1)}%</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{fmtRupiah(c.gp)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>
                  {c.mktCost > 0 ? fmtRupiah(c.mktCost) : <span style={{ color: '#334155' }}>—</span>}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  {c.mktCost > 0 ? (
                    <span style={{
                      padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                      background: c.mktRatio > 40 ? '#7f1d1d' : c.mktRatio > 25 ? '#78350f' : '#064e3b',
                      color: c.mktRatio > 40 ? '#ef4444' : c.mktRatio > 25 ? '#f59e0b' : '#10b981',
                    }}>{c.mktRatio.toFixed(1)}%</span>
                  ) : <span style={{ color: '#334155' }}>—</span>}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: c.profitAfterMkt >= 0 ? '#10b981' : '#ef4444' }}>
                  {fmtRupiah(c.profitAfterMkt)}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  <span style={{
                    padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                    background: c.marginAfterMkt >= 30 ? '#064e3b' : c.marginAfterMkt >= 10 ? '#78350f' : '#7f1d1d',
                    color: c.marginAfterMkt >= 30 ? '#10b981' : c.marginAfterMkt >= 10 ? '#f59e0b' : '#ef4444',
                  }}>{c.marginAfterMkt.toFixed(1)}%</span>
                </td>
              </tr>
            ))}
            {/* Total row */}
            <tr style={{ borderTop: '2px solid #1a2744', background: '#0b1121' }}>
              <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11 }}>TOTAL</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{fmtRupiah(totalRevenue)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>100%</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{fmtRupiah(totalGP)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{fmtRupiah(totalMktCost)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: '#1a2744', color: '#e2e8f0' }}>
                  {totalRevenue > 0 ? (totalMktCost / totalRevenue * 100).toFixed(1) : 0}%
                </span>
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: totalProfitAfterMkt >= 0 ? '#10b981' : '#ef4444' }}>
                {fmtRupiah(totalProfitAfterMkt)}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: '#1a2744', color: '#e2e8f0' }}>
                  {totalRevenue > 0 ? (totalProfitAfterMkt / totalRevenue * 100).toFixed(1) : 0}%
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
