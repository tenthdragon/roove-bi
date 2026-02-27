// @ts-nocheck
// app/dashboard/customers/page.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { fmtCompact, fmtRupiah, fmtPct, shortDate } from '@/lib/utils';
import {
  fetchCustomerTypeDaily,
  fetchCustomerKPIs,
  fetchCustomerCohort,
  fetchMonthlyCohort,
  fetchRtsCancelStats,
} from '@/lib/scalev-actions';

// ── Channel grouping ──
const CHANNEL_GROUP_MAP = {
  'Facebook Ads': 'Scalev',
  'Organik': 'Scalev',
  'Google Ads': 'Scalev',
  'TikTok Ads': 'TikTok Shop',
  'TikTok Shop': 'TikTok Shop',
  'Reseller': 'Reseller',
  'Shopee': 'Shopee',
  'Tokopedia': 'Other Marketplaces',
  'BliBli': 'Other Marketplaces',
  'Lazada': 'Other Marketplaces',
  'SnackVideo Ads': 'Other Marketplaces',
};

function getChannelGroup(salesChannel) {
  return CHANNEL_GROUP_MAP[salesChannel] || 'Other Marketplaces';
}

const CHANNEL_ORDER = ['Global', 'Scalev', 'Reseller', 'TikTok Shop', 'Shopee', 'Other Marketplaces'];
const CHANNEL_TAB_COLORS = {
  'Global': '#3b82f6',
  'Scalev': '#8b5cf6',
  'Reseller': '#f59e0b',
  'TikTok Shop': '#00f2ea',
  'Shopee': '#ee4d2d',
  'Other Marketplaces': '#64748b',
};

// ── Period presets ──
function getPeriodPresets() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const monthStart = (year, month) => new Date(year, month, 1);
  const monthEnd = (year, month) => new Date(year, month + 1, 0);

  return [
    { id: 'this-month', label: 'Bulan Ini', from: fmt(monthStart(y, m)), to: fmt(now) },
    { id: 'last-month', label: 'Bulan Lalu', from: fmt(monthStart(y, m - 1)), to: fmt(monthEnd(y, m - 1)) },
    { id: 'all', label: 'Semua Data', from: '2020-01-01', to: fmt(now) },
  ];
}

// ── Sub-tabs ──
const SUB_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'cohort', label: 'Cohort' },
];

export default function CustomersPage() {
  const [subTab, setSubTab] = useState('overview');
  const [periodId, setPeriodId] = useState('this-month');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [kpis, setKpis] = useState(null);
  const [dailyData, setDailyData] = useState([]);
  const [cohortData, setCohortData] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [rtsCancel, setRtsCancel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState('Global');

  const presets = useMemo(() => getPeriodPresets(), []);

  // Set initial period
  useEffect(() => {
    const preset = presets.find(p => p.id === 'this-month');
    if (preset) setDateRange({ from: preset.from, to: preset.to });
  }, [presets]);

  function handlePeriodChange(id) {
    setPeriodId(id);
    const preset = presets.find(p => p.id === id);
    if (preset) setDateRange({ from: preset.from, to: preset.to });
  }

  useEffect(() => {
    if (!dateRange.from) return;
    loadData();
  }, [dateRange]);

  async function loadData() {
    setLoading(true);
    try {
      const isAll = periodId === 'all';
      const [kpiData, daily, cohort, customers, rts] = await Promise.all([
        fetchCustomerKPIs(dateRange.from, dateRange.to),
        fetchCustomerTypeDaily(dateRange.from, dateRange.to),
        fetchMonthlyCohort(),
        fetchCustomerCohort(50, isAll ? undefined : dateRange.from, isAll ? undefined : dateRange.to),
        fetchRtsCancelStats(isAll ? undefined : dateRange.from, isAll ? undefined : dateRange.to),
      ]);
      setKpis(kpiData);
      setDailyData(daily);
      setCohortData(cohort);
      setTopCustomers(customers);
      setRtsCancel(rts);
    } catch (err) {
      console.error('Failed to load customer data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Group daily data by channel group
  const groupedDaily = useMemo(() => {
    return dailyData.map(d => ({ ...d, channel_group: getChannelGroup(d.sales_channel) }));
  }, [dailyData]);

  // Filter by selected channel
  const filteredDaily = useMemo(() => {
    if (channelFilter === 'Global') return groupedDaily;
    return groupedDaily.filter(d => d.channel_group === channelFilter);
  }, [groupedDaily, channelFilter]);

  // Available channel tabs
  const availableChannels = useMemo(() => {
    const groups = new Set(groupedDaily.map(d => d.channel_group));
    return CHANNEL_ORDER.filter(ch => ch === 'Global' || groups.has(ch));
  }, [groupedDaily]);

  // Chart data
  const chartData = useMemo(() => {
    const byDate = {};
    for (const row of filteredDaily) {
      if (!byDate[row.date]) byDate[row.date] = { date: row.date, new: 0, repeat: 0 };
      if (row.customer_type === 'new') {
        byDate[row.date].new += row.order_count || 0;
      } else {
        byDate[row.date].repeat += row.order_count || 0;
      }
    }
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredDaily]);

  // KPIs for current filter
  const filteredKpis = useMemo(() => {
    if (!kpis) return null;
    let newC = 0, repC = 0, newR = 0, repR = 0, newO = 0, repO = 0;
    for (const row of filteredDaily) {
      if (row.customer_type === 'new') {
        newC += row.customer_count || 0;
        newR += Number(row.revenue) || 0;
        newO += row.order_count || 0;
      } else {
        repC += row.customer_count || 0;
        repR += Number(row.revenue) || 0;
        repO += row.order_count || 0;
      }
    }
    const tot = newC + repC;
    return {
      totalCustomers: tot, newCustomers: newC, repeatCustomers: repC,
      repeatRate: tot > 0 ? (repC / tot) * 100 : 0,
      newRevenue: newR, repeatRevenue: repR,
      avgOrderValue: (newO + repO) > 0 ? (newR + repR) / (newO + repO) : 0,
      newOrders: newO, repeatOrders: repO,
    };
  }, [kpis, filteredDaily]);

  // Channel performance table
  const channelPerformance = useMemo(() => {
    const byGroup = {};
    for (const row of groupedDaily) {
      const g = row.channel_group;
      if (!byGroup[g]) byGroup[g] = { newOrders: 0, repeatOrders: 0, newCustomers: 0, repeatCustomers: 0, newRevenue: 0, repeatRevenue: 0 };
      if (row.customer_type === 'new') {
        byGroup[g].newOrders += row.order_count || 0;
        byGroup[g].newCustomers += row.customer_count || 0;
        byGroup[g].newRevenue += Number(row.revenue) || 0;
      } else {
        byGroup[g].repeatOrders += row.order_count || 0;
        byGroup[g].repeatCustomers += row.customer_count || 0;
        byGroup[g].repeatRevenue += Number(row.revenue) || 0;
      }
    }
    const rows = CHANNEL_ORDER.filter(ch => ch !== 'Global' && byGroup[ch]).map(ch => {
      const d = byGroup[ch];
      const totalOrders = d.newOrders + d.repeatOrders;
      const totalCustomers = d.newCustomers + d.repeatCustomers;
      const totalRevenue = d.newRevenue + d.repeatRevenue;
      return {
        channel: ch, totalOrders, totalCustomers,
        newCustomers: d.newCustomers, repeatCustomers: d.repeatCustomers,
        repeatRate: totalCustomers > 0 ? (d.repeatCustomers / totalCustomers) * 100 : 0,
        totalRevenue, repeatRevenue: d.repeatRevenue,
        repeatRevShare: totalRevenue > 0 ? (d.repeatRevenue / totalRevenue) * 100 : 0,
        color: CHANNEL_TAB_COLORS[ch] || '#64748b',
      };
    });
    const gNew = rows.reduce((s, r) => s + r.newCustomers, 0);
    const gRep = rows.reduce((s, r) => s + r.repeatCustomers, 0);
    const gTot = gNew + gRep;
    const gRev = rows.reduce((s, r) => s + r.totalRevenue, 0);
    const gRepRev = rows.reduce((s, r) => s + r.repeatRevenue, 0);
    return {
      rows,
      globalRow: {
        channel: 'Global', totalOrders: rows.reduce((s, r) => s + r.totalOrders, 0),
        totalCustomers: gTot, newCustomers: gNew, repeatCustomers: gRep,
        repeatRate: gTot > 0 ? (gRep / gTot) * 100 : 0,
        totalRevenue: gRev, repeatRevenue: gRepRev,
        repeatRevShare: gRev > 0 ? (gRepRev / gRev) * 100 : 0,
        color: '#3b82f6',
      },
    };
  }, [groupedDaily]);

  // Filter top customers by channel
  const filteredTopCustomers = useMemo(() => {
    if (channelFilter === 'Global') return topCustomers;
    return topCustomers.filter(c => {
      const group = CHANNEL_GROUP_MAP[c.first_channel] || 'Other Marketplaces';
      return group === channelFilter;
    });
  }, [topCustomers, channelFilter]);

  const k = filteredKpis;

  return (
    <div className="fade-in">
      {/* ═══ HEADER + PERIOD SELECTOR ═══ */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700 }}>Customer Analytics</h2>
          <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>New vs Repeat — excluding unidentified (FBS)</p>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {presets.map(p => (
            <button key={p.id} onClick={() => handlePeriodChange(p.id)} style={{
              padding: '5px 12px', borderRadius: 6, border: '1px solid',
              borderColor: periodId === p.id ? '#3b82f6' : '#1a2744',
              background: periodId === p.id ? 'rgba(59,130,246,0.15)' : 'transparent',
              color: periodId === p.id ? '#60a5fa' : '#64748b',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ SUB TABS ═══ */}
      <div style={{ display: 'flex', gap: 2, background: '#0f172a', borderRadius: 10, padding: 3, border: '1px solid #1a2744', marginBottom: 20, width: 'fit-content' }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={{
            padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600,
            background: subTab === t.id ? '#3b82f6' : 'transparent',
            color: subTab === t.id ? '#fff' : '#64748b',
          }}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="spinner" style={{ width: 32, height: 32, border: '3px solid #1a2744', borderTop: '3px solid #3b82f6', borderRadius: '50%' }} />
        </div>
      ) : (
        <>
          {subTab === 'overview' && (
            <OverviewTab
              kpis={k} chartData={chartData}
              channelPerformance={channelPerformance}
              channelFilter={channelFilter} setChannelFilter={setChannelFilter}
              availableChannels={availableChannels}
              topCustomers={filteredTopCustomers}
              rtsCancel={rtsCancel}
            />
          )}
          {subTab === 'cohort' && <CohortTab data={cohortData} />}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════
function OverviewTab({ kpis: k, chartData, channelPerformance, channelFilter, setChannelFilter, availableChannels, topCustomers, rtsCancel }) {
  if (!k) return <div style={{ color: '#64748b', padding: 40, textAlign: 'center' }}>Belum ada data customer untuk periode ini.</div>;
  const maxOrders = Math.max(...chartData.map(d => d.new + d.repeat), 1);

  return (
    <>
      {/* ═══ 1. CHANNEL PERFORMANCE TABLE (always global) ═══ */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20, marginBottom: 20, overflowX: 'auto' }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>Repeat Rate per Channel</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #1a2744' }}>
              {['Channel', 'Orders', 'New', 'Repeat', 'Repeat Rate', 'Revenue', 'Repeat Rev %'].map(h => (
                <th key={h} style={{
                  padding: '8px 10px', textAlign: h === 'Channel' ? 'left' : 'right',
                  color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channelPerformance.rows.map(row => <ChannelRow key={row.channel} row={row} />)}
            <tr style={{ borderTop: '2px solid #1a2744', background: 'rgba(59,130,246,0.06)' }}>
              <td style={{ padding: '10px', fontWeight: 700, color: '#e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: '#3b82f6' }} />Global
                </div>
              </td>
              <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#e2e8f0' }}>{channelPerformance.globalRow.totalOrders}</td>
              <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace', color: '#10b981', fontWeight: 600 }}>{channelPerformance.globalRow.newCustomers}</td>
              <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace', color: '#f59e0b', fontWeight: 600 }}>{channelPerformance.globalRow.repeatCustomers}</td>
              <td style={{ padding: '10px', textAlign: 'right' }}><RepeatRateBadge value={channelPerformance.globalRow.repeatRate} bold /></td>
              <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#e2e8f0' }}>{fmtCompact(channelPerformance.globalRow.totalRevenue)}</td>
              <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#e2e8f0' }}>{fmtPct(channelPerformance.globalRow.repeatRevShare)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ═══ 2. CHANNEL FILTER TABS ═══ */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {availableChannels.map(ch => (
          <button key={ch} onClick={() => setChannelFilter(ch)} style={{
            padding: '5px 14px', borderRadius: 20, border: '1px solid',
            borderColor: channelFilter === ch ? (CHANNEL_TAB_COLORS[ch] || '#3b82f6') : '#1a2744',
            background: channelFilter === ch ? `${CHANNEL_TAB_COLORS[ch] || '#3b82f6'}18` : 'transparent',
            color: channelFilter === ch ? (CHANNEL_TAB_COLORS[ch] || '#3b82f6') : '#94a3b8',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>{ch}</button>
        ))}
      </div>

      {/* ═══ 3. KPI CARDS (filtered by channel) ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        {[
          { label: 'Total Customer', value: k.totalCustomers?.toLocaleString('id-ID'), color: '#3b82f6', sub: `${k.newOrders + k.repeatOrders} orders` },
          { label: 'New Customer', value: k.newCustomers?.toLocaleString('id-ID'), color: '#10b981', sub: fmtCompact(k.newRevenue) },
          { label: 'Repeat Customer', value: k.repeatCustomers?.toLocaleString('id-ID'), color: '#f59e0b', sub: fmtCompact(k.repeatRevenue) },
          { label: 'Repeat Rate', value: fmtPct(k.repeatRate), color: k.repeatRate > 20 ? '#10b981' : '#ef4444', sub: 'target > 20%' },
          { label: 'AOV', value: fmtCompact(k.avgOrderValue), color: '#8b5cf6', sub: 'per order' },
          { label: 'Repeat Rev %', value: fmtPct(k.newRevenue + k.repeatRevenue > 0 ? (k.repeatRevenue / (k.newRevenue + k.repeatRevenue)) * 100 : 0), color: '#06b6d4', sub: fmtCompact(k.repeatRevenue) },
        ].map((card, i) => (
          <div key={i} style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{card.label}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: card.color, fontFamily: "'JetBrains Mono', monospace" }}>{card.value}</div>
            <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* ═══ 4. RTS & CANCELED CARDS ═══ */}
      {rtsCancel && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          <RtsCancelCard label="RTS (Return to Sender)" data={rtsCancel.rts} color="#f97316" icon="↩" />
          <RtsCancelCard label="Canceled" data={rtsCancel.canceled} color="#ef4444" icon="✕" />
        </div>
      )}

      {/* ═══ 5. DAILY CHART (filtered by channel) ═══ */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Daily New vs Repeat Orders</h3>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: '#64748b' }}>
          {channelFilter === 'Global' ? 'Semua channel' : channelFilter}
        </p>
        {chartData.length === 0 ? (
          <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Tidak ada data untuk periode ini</div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 180 }}>
              {chartData.map((d, i) => {
                const newH = (d.new / maxOrders) * 160;
                const repH = (d.repeat / maxOrders) * 160;
                return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 160, width: '100%', alignItems: 'center' }}>
                      <div style={{ width: '70%', maxWidth: 20, height: repH, background: '#f59e0b', borderRadius: '3px 3px 0 0', minHeight: d.repeat > 0 ? 2 : 0 }} title={`Repeat: ${d.repeat}`} />
                      <div style={{ width: '70%', maxWidth: 20, height: newH, background: '#10b981', borderRadius: d.repeat > 0 ? '0' : '3px 3px 0 0', minHeight: d.new > 0 ? 2 : 0 }} title={`New: ${d.new}`} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', height: 24, marginTop: 4 }}>
              {chartData.map((d, i) => {
                const step = Math.max(1, Math.ceil(chartData.length / 12));
                return (
                  <div key={i} style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                    {i % step === 0 && (
                      <div style={{ fontSize: 9, color: '#475569', whiteSpace: 'nowrap' }}>
                        {new Date(d.date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: '#10b981' }} />
            <span style={{ fontSize: 10, color: '#94a3b8' }}>New</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: '#f59e0b' }} />
            <span style={{ fontSize: 10, color: '#94a3b8' }}>Repeat</span>
          </div>
        </div>
      </div>

      {/* ═══ 6. TOP 50 CUSTOMERS (filtered by channel + period) ═══ */}
      <TopCustomersSection customers={topCustomers} channelFilter={channelFilter} />
    </>
  );
}

// ═══════════════════════════════════════════════════
// RTS / CANCEL CARD
// ═══════════════════════════════════════════════════
function RtsCancelCard({ label, data, color, icon }) {
  if (!data || data.total === 0) {
    return (
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#1a2744', fontFamily: "'JetBrains Mono', monospace" }}>0</div>
      </div>
    );
  }

  // Sort platforms by count desc
  const platforms = Object.entries(data.byPlatform)
    .sort(([, a], [, b]) => b - a);

  const platformColors = {
    'Scalev': '#8b5cf6',
    'TikTok Shop': '#00f2ea',
    'Shopee': '#ee4d2d',
    'Other': '#64748b',
  };

  return (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 20, fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>
          {data.total.toLocaleString('id-ID')}
        </span>
        <span style={{ fontSize: 11, color: '#475569' }}>orders</span>
      </div>
      {/* Platform breakdown */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {platforms.map(([platform, count]) => (
          <span key={platform} style={{
            padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 600,
            background: `${platformColors[platform] || '#64748b'}20`,
            color: platformColors[platform] || '#94a3b8',
            fontFamily: 'monospace',
          }}>
            {platform}: {count}
          </span>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// TOP CUSTOMERS SECTION (inline)
// ═══════════════════════════════════════════════════
function TopCustomersSection({ customers, channelFilter }) {
  if (!customers || customers.length === 0) {
    return (
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Top Customers by Revenue</h3>
        <p style={{ margin: 0, fontSize: 12, color: '#64748b' }}>Tidak ada data customer untuk periode dan channel ini.</p>
      </div>
    );
  }

  return (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20, overflowX: 'auto' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>
        Top {Math.min(customers.length, 50)} Customers by Revenue
      </h3>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: '#64748b' }}>
        {channelFilter === 'Global' ? 'Semua channel' : channelFilter} — dalam periode yang dipilih
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
        <thead>
          <tr>
            {['#', 'Customer', 'Channel', 'Orders', 'Revenue', 'AOV', 'First', 'Last', 'Type'].map(h => (
              <th key={h} style={{
                padding: '8px 10px',
                textAlign: ['#', 'Customer', 'Channel', 'Type'].includes(h) ? 'left' : 'right',
                color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {customers.slice(0, 50).map((c, i) => {
            const phone = c.customer_phone || '';
            const maskedPhone = phone.length > 7 ? phone.slice(0, 4) + '****' + phone.slice(-3) : phone;
            const channelGroup = CHANNEL_GROUP_MAP[c.first_channel] || c.first_channel || 'Unknown';
            return (
              <tr key={i} style={{ borderBottom: '1px solid #0f172a' }}>
                <td style={{ padding: '7px 10px', color: '#475569', fontSize: 11 }}>{i + 1}</td>
                <td style={{ padding: '7px 10px' }}>
                  <div style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 12 }}>{c.first_name || 'N/A'}</div>
                  {maskedPhone && <div style={{ fontSize: 9, color: '#475569', fontFamily: 'monospace' }}>{maskedPhone}</div>}
                </td>
                <td style={{ padding: '7px 10px' }}>
                  <span style={{
                    padding: '2px 7px', borderRadius: 10, fontSize: 9, fontWeight: 600,
                    background: `${CHANNEL_TAB_COLORS[channelGroup] || '#64748b'}20`,
                    color: CHANNEL_TAB_COLORS[channelGroup] || '#94a3b8',
                  }}>{channelGroup}</span>
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{c.total_orders}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#10b981' }}>{fmtRupiah(c.total_revenue)}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#94a3b8', fontSize: 11 }}>{fmtRupiah(c.avg_order_value)}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 10, color: '#94a3b8' }}>{c.first_order_date}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 10, color: '#94a3b8' }}>{c.last_order_date}</td>
                <td style={{ padding: '7px 10px' }}>
                  <span style={{
                    padding: '2px 7px', borderRadius: 10, fontSize: 9, fontWeight: 700,
                    background: c.is_repeat ? '#78350f' : '#064e3b',
                    color: c.is_repeat ? '#f59e0b' : '#10b981',
                  }}>{c.is_repeat ? 'Repeat' : 'New'}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// HELPER COMPONENTS
// ═══════════════════════════════════════════════════
function ChannelRow({ row }) {
  return (
    <tr style={{ borderBottom: '1px solid #0f172a' }}>
      <td style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, background: row.color, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{row.channel}</span>
        </div>
      </td>
      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#94a3b8' }}>{row.totalOrders}</td>
      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#10b981' }}>{row.newCustomers}</td>
      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#f59e0b' }}>{row.repeatCustomers}</td>
      <td style={{ padding: '8px 10px', textAlign: 'right' }}><RepeatRateBadge value={row.repeatRate} /></td>
      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#e2e8f0' }}>{fmtCompact(row.totalRevenue)}</td>
      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#94a3b8' }}>{fmtPct(row.repeatRevShare)}</td>
    </tr>
  );
}

function RepeatRateBadge({ value, bold = false }) {
  const color = value >= 50 ? '#10b981' : value >= 30 ? '#f59e0b' : '#ef4444';
  const bg = value >= 50 ? '#064e3b' : value >= 30 ? '#78350f' : '#7f1d1d';
  return (
    <span style={{
      padding: '3px 8px', borderRadius: 10, fontSize: 10, fontWeight: bold ? 800 : 700,
      fontFamily: 'monospace', background: bg, color,
    }}>{fmtPct(value, 1)}</span>
  );
}

// ═══════════════════════════════════════════════════
// COHORT TAB
// ═══════════════════════════════════════════════════
function CohortTab({ data }) {
  if (!data || data.length === 0) {
    return <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Belum ada data cohort. Minimal perlu data 2+ bulan.</div>;
  }
  const cohorts = {};
  for (const row of data) {
    if (!cohorts[row.cohort_month]) cohorts[row.cohort_month] = {};
    cohorts[row.cohort_month][row.months_since_first] = {
      customers: row.active_customers, orders: row.orders, revenue: Number(row.revenue),
    };
  }
  const cohortMonths = Object.keys(cohorts).sort();
  const maxMonthsSince = Math.max(...data.map(d => d.months_since_first), 0);

  return (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20, overflowX: 'auto' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Cohort Retention</h3>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: '#64748b' }}>Customer dari cohort bulan X yang masih order di bulan-bulan berikutnya</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>Cohort</th>
            <th style={{ padding: '8px 10px', textAlign: 'center', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>Size</th>
            {Array.from({ length: Math.min(maxMonthsSince + 1, 7) }, (_, i) => (
              <th key={i} style={{ padding: '8px 10px', textAlign: 'center', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>
                {i === 0 ? 'M0' : `M+${i}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohortMonths.map(month => {
            const base = cohorts[month][0]?.customers || 0;
            return (
              <tr key={month}>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #0f172a', fontWeight: 600, color: '#e2e8f0' }}>{month}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #0f172a', textAlign: 'center', fontFamily: 'monospace', color: '#94a3b8' }}>{base}</td>
                {Array.from({ length: Math.min(maxMonthsSince + 1, 7) }, (_, i) => {
                  const cell = cohorts[month][i];
                  if (!cell) return <td key={i} style={{ padding: '8px 10px', borderBottom: '1px solid #0f172a', textAlign: 'center', color: '#1a2744' }}>—</td>;
                  const retPct = base > 0 ? (cell.customers / base) * 100 : 0;
                  const intensity = Math.min(retPct / 100, 1);
                  return (
                    <td key={i} style={{
                      padding: '8px 10px', borderBottom: '1px solid #0f172a', textAlign: 'center',
                      background: i === 0 ? 'rgba(59,130,246,0.15)' : `rgba(16,185,129,${intensity * 0.3})`,
                      color: i === 0 ? '#60a5fa' : retPct > 10 ? '#10b981' : '#475569',
                      fontWeight: retPct > 20 ? 700 : 400, fontFamily: 'monospace', fontSize: 11,
                    }}>{fmtPct(retPct, 0)}</td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
