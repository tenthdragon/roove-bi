// @ts-nocheck
// app/dashboard/customers/page.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { fmtCompact, fmtRupiah, fmtPct, shortDate } from '@/lib/utils';
import { fetchCustomerTypeDaily, fetchCustomerKPIs, fetchCustomerCohort, fetchMonthlyCohort } from '@/lib/scalev-actions';

// ── Channel grouping: raw sales_channel → display group ──
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

// Display order for channel tabs
const CHANNEL_ORDER = ['Global', 'Scalev', 'Reseller', 'TikTok Shop', 'Shopee', 'Other Marketplaces'];

const CHANNEL_TAB_COLORS = {
  'Global': '#3b82f6',
  'Scalev': '#8b5cf6',
  'Reseller': '#f59e0b',
  'TikTok Shop': '#00f2ea',
  'Shopee': '#ee4d2d',
  'Other Marketplaces': '#64748b',
};

// ── Sub-tab navigation ──
const SUB_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'cohort', label: 'Cohort' },
  { id: 'top-customers', label: 'Top Customers' },
];

export default function CustomersPage() {
  const [subTab, setSubTab] = useState('overview');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [kpis, setKpis] = useState(null);
  const [dailyData, setDailyData] = useState([]);
  const [cohortData, setCohortData] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState('Global');

  useEffect(() => {
    const today = new Date();
    const d30 = new Date(today);
    d30.setDate(d30.getDate() - 30);
    const fmt = (d) => d.toISOString().slice(0, 10);
    setDateRange({ from: fmt(d30), to: fmt(today) });
  }, []);

  useEffect(() => {
    if (!dateRange.from) return;
    loadData();
  }, [dateRange]);

  async function loadData() {
    setLoading(true);
    try {
      const [kpiData, daily, cohort, customers] = await Promise.all([
        fetchCustomerKPIs(dateRange.from, dateRange.to),
        fetchCustomerTypeDaily(dateRange.from, dateRange.to),
        fetchMonthlyCohort(),
        fetchCustomerCohort(50),
      ]);
      setKpis(kpiData);
      setDailyData(daily);
      setCohortData(cohort);
      setTopCustomers(customers);
    } catch (err) {
      console.error('Failed to load customer data:', err);
    } finally {
      setLoading(false);
    }
  }

  // Group daily data by channel group
  const groupedDaily = useMemo(() => {
    return dailyData.map(d => ({
      ...d,
      channel_group: getChannelGroup(d.sales_channel),
    }));
  }, [dailyData]);

  // Filter by selected channel
  const filteredDaily = useMemo(() => {
    if (channelFilter === 'Global') return groupedDaily;
    return groupedDaily.filter(d => d.channel_group === channelFilter);
  }, [groupedDaily, channelFilter]);

  // Available channel tabs (only show tabs that have data)
  const availableChannels = useMemo(() => {
    const groups = new Set(groupedDaily.map(d => d.channel_group));
    return CHANNEL_ORDER.filter(ch => ch === 'Global' || groups.has(ch));
  }, [groupedDaily]);

  // Aggregate daily data by date for chart
  const chartData = useMemo(() => {
    const byDate = {};
    for (const row of filteredDaily) {
      if (!byDate[row.date]) byDate[row.date] = { date: row.date, new: 0, repeat: 0, newRev: 0, repeatRev: 0 };
      if (row.customer_type === 'new') {
        byDate[row.date].new += row.order_count || 0;
        byDate[row.date].newRev += Number(row.revenue) || 0;
      } else {
        byDate[row.date].repeat += row.order_count || 0;
        byDate[row.date].repeatRev += Number(row.revenue) || 0;
      }
    }
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredDaily]);

  // Compute KPIs for current filter
  const filteredKpis = useMemo(() => {
    if (!kpis) return null;
    const data = filteredDaily;
    let newC = 0, repC = 0, newR = 0, repR = 0, newO = 0, repO = 0;
    for (const row of data) {
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
      totalCustomers: tot,
      newCustomers: newC,
      repeatCustomers: repC,
      repeatRate: tot > 0 ? (repC / tot) * 100 : 0,
      newRevenue: newR,
      repeatRevenue: repR,
      avgOrderValue: (newO + repO) > 0 ? (newR + repR) / (newO + repO) : 0,
      newOrders: newO,
      repeatOrders: repO,
    };
  }, [kpis, filteredDaily]);

  // Channel performance breakdown for table
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

    // Build rows in order
    const rows = CHANNEL_ORDER.filter(ch => ch !== 'Global' && byGroup[ch]).map(ch => {
      const d = byGroup[ch];
      const totalOrders = d.newOrders + d.repeatOrders;
      const totalCustomers = d.newCustomers + d.repeatCustomers;
      const totalRevenue = d.newRevenue + d.repeatRevenue;
      return {
        channel: ch,
        totalOrders,
        totalCustomers,
        newCustomers: d.newCustomers,
        repeatCustomers: d.repeatCustomers,
        repeatRate: totalCustomers > 0 ? (d.repeatCustomers / totalCustomers) * 100 : 0,
        totalRevenue,
        repeatRevenue: d.repeatRevenue,
        repeatRevShare: totalRevenue > 0 ? (d.repeatRevenue / totalRevenue) * 100 : 0,
        color: CHANNEL_TAB_COLORS[ch] || '#64748b',
      };
    });

    // Global totals
    const globalNew = rows.reduce((s, r) => s + r.newCustomers, 0);
    const globalRepeat = rows.reduce((s, r) => s + r.repeatCustomers, 0);
    const globalTotal = globalNew + globalRepeat;
    const globalRevenue = rows.reduce((s, r) => s + r.totalRevenue, 0);
    const globalRepeatRev = rows.reduce((s, r) => s + r.repeatRevenue, 0);

    const globalRow = {
      channel: 'Global',
      totalOrders: rows.reduce((s, r) => s + r.totalOrders, 0),
      totalCustomers: globalTotal,
      newCustomers: globalNew,
      repeatCustomers: globalRepeat,
      repeatRate: globalTotal > 0 ? (globalRepeat / globalTotal) * 100 : 0,
      totalRevenue: globalRevenue,
      repeatRevenue: globalRepeatRev,
      repeatRevShare: globalRevenue > 0 ? (globalRepeatRev / globalRevenue) * 100 : 0,
      color: CHANNEL_TAB_COLORS['Global'],
    };

    return { rows, globalRow };
  }, [groupedDaily]);

  const k = filteredKpis;

  return (
    <div className="fade-in">
      {/* Page Header */}
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700 }}>Customer Analytics</h2>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
            New vs Repeat order — semua channel
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={dateRange.from} onChange={e => setDateRange(p => ({ ...p, from: e.target.value }))}
            style={{ padding: '6px 10px', background: '#111a2e', border: '1px solid #1a2744', borderRadius: 8, color: '#e2e8f0', fontSize: 12 }} />
          <span style={{ color: '#475569' }}>—</span>
          <input type="date" value={dateRange.to} onChange={e => setDateRange(p => ({ ...p, to: e.target.value }))}
            style={{ padding: '6px 10px', background: '#111a2e', border: '1px solid #1a2744', borderRadius: 8, color: '#e2e8f0', fontSize: 12 }} />
        </div>
      </div>

      {/* Channel Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {availableChannels.map(ch => (
          <button key={ch} onClick={() => setChannelFilter(ch)} style={{
            padding: '6px 14px', borderRadius: 20, border: '1px solid',
            borderColor: channelFilter === ch ? (CHANNEL_TAB_COLORS[ch] || '#3b82f6') : '#1a2744',
            background: channelFilter === ch ? `${CHANNEL_TAB_COLORS[ch] || '#3b82f6'}18` : 'transparent',
            color: channelFilter === ch ? (CHANNEL_TAB_COLORS[ch] || '#3b82f6') : '#94a3b8',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            {ch}
          </button>
        ))}
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 2, background: '#0f172a', borderRadius: 10, padding: 3, border: '1px solid #1a2744', marginBottom: 20, width: 'fit-content' }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={{
            padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
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
          {subTab === 'overview' && <OverviewTab kpis={k} chartData={chartData} channelPerformance={channelPerformance} channelFilter={channelFilter} />}
          {subTab === 'cohort' && <CohortTab data={cohortData} />}
          {subTab === 'top-customers' && <TopCustomersTab customers={topCustomers} />}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════
function OverviewTab({ kpis: k, chartData, channelPerformance, channelFilter }) {
  if (!k) return <div style={{ color: '#64748b', padding: 40, textAlign: 'center' }}>Belum ada data customer. Pastikan data sudah di-upload atau Scalev sync sudah berjalan.</div>;

  const maxOrders = Math.max(...chartData.map(d => d.new + d.repeat), 1);

  return (
    <>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Customer', value: k.totalCustomers?.toLocaleString('id-ID'), color: '#3b82f6', sub: `${k.newOrders + k.repeatOrders} orders` },
          { label: 'New Customer', value: k.newCustomers?.toLocaleString('id-ID'), color: '#10b981', sub: fmtCompact(k.newRevenue) },
          { label: 'Repeat Customer', value: k.repeatCustomers?.toLocaleString('id-ID'), color: '#f59e0b', sub: fmtCompact(k.repeatRevenue) },
          { label: 'Repeat Rate', value: fmtPct(k.repeatRate), color: k.repeatRate > 20 ? '#10b981' : '#ef4444', sub: 'target > 20%' },
          { label: 'Avg Order Value', value: fmtCompact(k.avgOrderValue), color: '#8b5cf6', sub: 'per order' },
          { label: 'Repeat Revenue Share', value: fmtPct(k.newRevenue + k.repeatRevenue > 0 ? (k.repeatRevenue / (k.newRevenue + k.repeatRevenue)) * 100 : 0), color: '#06b6d4', sub: fmtCompact(k.repeatRevenue) },
        ].map((card, i) => (
          <div key={i} style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{card.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: card.color, fontFamily: "'JetBrains Mono', monospace" }}>{card.value}</div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* Channel Performance Table                          */}
      {/* ═══════════════════════════════════════════════════ */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20, marginBottom: 20, overflowX: 'auto' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Repeat Rate per Channel</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b' }}>
          Perbandingan new vs repeat order di setiap channel
        </p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #1a2744' }}>
              {['Channel', 'Orders', 'New', 'Repeat', 'Repeat Rate', 'Revenue', 'Repeat Rev %'].map(h => (
                <th key={h} style={{
                  padding: '10px 12px',
                  textAlign: h === 'Channel' ? 'left' : 'right',
                  color: '#64748b', fontWeight: 600, fontSize: 10,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channelPerformance.rows.map((row) => (
              <ChannelRow key={row.channel} row={row} />
            ))}
            {/* Global Total Row */}
            <tr style={{ borderTop: '2px solid #1a2744', background: 'rgba(59,130,246,0.06)' }}>
              <td style={{ padding: '12px', fontWeight: 700, color: '#e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: '#3b82f6' }} />
                  Global
                </div>
              </td>
              <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#e2e8f0' }}>
                {channelPerformance.globalRow.totalOrders}
              </td>
              <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', color: '#10b981', fontWeight: 600 }}>
                {channelPerformance.globalRow.newCustomers}
              </td>
              <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', color: '#f59e0b', fontWeight: 600 }}>
                {channelPerformance.globalRow.repeatCustomers}
              </td>
              <td style={{ padding: '12px', textAlign: 'right' }}>
                <RepeatRateBadge value={channelPerformance.globalRow.repeatRate} bold />
              </td>
              <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#e2e8f0' }}>
                {fmtCompact(channelPerformance.globalRow.totalRevenue)}
              </td>
              <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#e2e8f0' }}>
                {fmtPct(channelPerformance.globalRow.repeatRevShare)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Daily Bar Chart */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Daily New vs Repeat Orders</h3>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b' }}>
          {channelFilter === 'Global' ? 'Semua channel' : channelFilter}
        </p>
        {chartData.length === 0 ? (
          <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Tidak ada data untuk periode ini</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 200, overflowX: 'auto' }}>
            {chartData.map((d, i) => {
              const total = d.new + d.repeat;
              const newH = total > 0 ? (d.new / maxOrders) * 180 : 0;
              const repH = total > 0 ? (d.repeat / maxOrders) * 180 : 0;
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1 0 24px', minWidth: 24 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 180 }}>
                    <div style={{ width: 16, height: repH, background: '#f59e0b', borderRadius: '3px 3px 0 0', minHeight: d.repeat > 0 ? 2 : 0 }} title={`Repeat: ${d.repeat}`} />
                    <div style={{ width: 16, height: newH, background: '#10b981', borderRadius: d.repeat > 0 ? '0' : '3px 3px 0 0', minHeight: d.new > 0 ? 2 : 0 }} title={`New: ${d.new}`} />
                  </div>
                  {i % Math.max(1, Math.floor(chartData.length / 10)) === 0 && (
                    <div style={{ fontSize: 9, color: '#475569', marginTop: 4, whiteSpace: 'nowrap', transform: 'rotate(-45deg)', transformOrigin: 'top left' }}>
                      {shortDate(d.date)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: '#10b981' }} />
            <span style={{ fontSize: 11, color: '#94a3b8' }}>New Customer</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: '#f59e0b' }} />
            <span style={{ fontSize: 11, color: '#94a3b8' }}>Repeat Customer</span>
          </div>
        </div>
      </div>

      {/* Revenue Breakdown */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 700 }}>Revenue Comparison: New vs Repeat</h3>
        {k && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <RevenueBar label="New" value={k.newRevenue} total={k.newRevenue + k.repeatRevenue} color="#10b981" orders={k.newOrders} />
            <RevenueBar label="Repeat" value={k.repeatRevenue} total={k.newRevenue + k.repeatRevenue} color="#f59e0b" orders={k.repeatOrders} />
          </div>
        )}
      </div>
    </>
  );
}

// ── Channel Row Component ──
function ChannelRow({ row }) {
  return (
    <tr style={{ borderBottom: '1px solid #0f172a' }}>
      <td style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: 3, background: row.color, flexShrink: 0 }} />
          <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{row.channel}</span>
        </div>
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#94a3b8' }}>
        {row.totalOrders}
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#10b981' }}>
        {row.newCustomers}
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#f59e0b' }}>
        {row.repeatCustomers}
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
        <RepeatRateBadge value={row.repeatRate} />
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#e2e8f0' }}>
        {fmtCompact(row.totalRevenue)}
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#94a3b8' }}>
        {fmtPct(row.repeatRevShare)}
      </td>
    </tr>
  );
}

// ── Repeat Rate Badge with color coding ──
function RepeatRateBadge({ value, bold = false }) {
  const color = value >= 50 ? '#10b981' : value >= 30 ? '#f59e0b' : '#ef4444';
  const bg = value >= 50 ? '#064e3b' : value >= 30 ? '#78350f' : '#7f1d1d';
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 12,
      fontSize: 11, fontWeight: bold ? 800 : 700,
      fontFamily: 'monospace',
      background: bg, color,
    }}>
      {fmtPct(value, 1)}
    </span>
  );
}

function RevenueBar({ label, value, total, color, orders }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ padding: 16, background: '#0b1121', border: '1px solid #1a2744', borderRadius: 8 }}>
      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>{fmtRupiah(value)}</div>
      <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{orders} orders · {fmtPct(pct)} share</div>
      <div style={{ marginTop: 8, height: 6, background: '#1a2744', borderRadius: 3 }}>
        <div style={{ height: '100%', background: color, borderRadius: 3, width: `${pct}%`, transition: 'width 0.5s' }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// COHORT TAB
// ═══════════════════════════════════════════════════
function CohortTab({ data }) {
  if (!data || data.length === 0) {
    return <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Belum ada data cohort. Minimal perlu data 2+ bulan untuk analisis cohort.</div>;
  }

  const cohorts = {};
  for (const row of data) {
    if (!cohorts[row.cohort_month]) cohorts[row.cohort_month] = {};
    cohorts[row.cohort_month][row.months_since_first] = {
      customers: row.active_customers,
      orders: row.orders,
      revenue: Number(row.revenue),
    };
  }

  const cohortMonths = Object.keys(cohorts).sort();
  const maxMonthsSince = Math.max(...data.map(d => d.months_since_first), 0);

  return (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20, overflowX: 'auto' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Cohort Retention</h3>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b' }}>
        Berapa customer dari cohort bulan X yang masih order di bulan-bulan berikutnya
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>Cohort</th>
            <th style={{ padding: '8px 12px', textAlign: 'center', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>Customers</th>
            {Array.from({ length: Math.min(maxMonthsSince + 1, 7) }, (_, i) => (
              <th key={i} style={{ padding: '8px 12px', textAlign: 'center', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>
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
                <td style={{ padding: '8px 12px', borderBottom: '1px solid #0f172a', fontWeight: 600, color: '#e2e8f0' }}>{month}</td>
                <td style={{ padding: '8px 12px', borderBottom: '1px solid #0f172a', textAlign: 'center', fontFamily: 'monospace', color: '#94a3b8' }}>{base}</td>
                {Array.from({ length: Math.min(maxMonthsSince + 1, 7) }, (_, i) => {
                  const cell = cohorts[month][i];
                  if (!cell) return <td key={i} style={{ padding: '8px 12px', borderBottom: '1px solid #0f172a', textAlign: 'center', color: '#1a2744' }}>—</td>;
                  const retPct = base > 0 ? (cell.customers / base) * 100 : 0;
                  const intensity = Math.min(retPct / 100, 1);
                  return (
                    <td key={i} style={{
                      padding: '8px 12px', borderBottom: '1px solid #0f172a', textAlign: 'center',
                      background: i === 0 ? 'rgba(59,130,246,0.15)' : `rgba(16,185,129,${intensity * 0.3})`,
                      color: i === 0 ? '#60a5fa' : retPct > 10 ? '#10b981' : '#475569',
                      fontWeight: retPct > 20 ? 700 : 400,
                      fontFamily: 'monospace', fontSize: 11,
                    }}>
                      {fmtPct(retPct, 0)}
                    </td>
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

// ═══════════════════════════════════════════════════
// TOP CUSTOMERS TAB
// ═══════════════════════════════════════════════════
function TopCustomersTab({ customers }) {
  if (!customers || customers.length === 0) {
    return <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Belum ada data customer.</div>;
  }

  return (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 20, overflowX: 'auto' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Top 50 Customers by Revenue</h3>
      <p style={{ margin: '0 0 16px', fontSize: 12, color: '#64748b' }}>
        Customer dengan revenue tertinggi (semua channel)
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>#</th>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>Customer</th>
            <th style={{ padding: '8px 12px', textAlign: 'left', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>Channel</th>
            <th style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>Orders</th>
            <th style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>Total Revenue</th>
            <th style={{ padding: '8px 12px', textAlign: 'right', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>AOV</th>
            <th style={{ padding: '8px 12px', textAlign: 'center', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>First Order</th>
            <th style={{ padding: '8px 12px', textAlign: 'center', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>Last Order</th>
            <th style={{ padding: '8px 12px', textAlign: 'center', color: '#64748b', borderBottom: '1px solid #1a2744', fontWeight: 600 }}>Type</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c, i) => {
            const phone = c.customer_phone || '';
            const maskedPhone = phone.length > 7
              ? phone.slice(0, 4) + '****' + phone.slice(-3)
              : phone;

            // Map first_channel to channel group
            const channelGroup = CHANNEL_GROUP_MAP[c.first_channel] || c.first_channel || 'Unknown';

            return (
              <tr key={i} style={{ borderBottom: '1px solid #0f172a' }}>
                <td style={{ padding: '8px 12px', color: '#475569' }}>{i + 1}</td>
                <td style={{ padding: '8px 12px' }}>
                  <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{c.first_name || 'N/A'}</div>
                  <div style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace' }}>{maskedPhone}</div>
                </td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600,
                    background: `${CHANNEL_TAB_COLORS[channelGroup] || '#64748b'}20`,
                    color: CHANNEL_TAB_COLORS[channelGroup] || '#94a3b8',
                  }}>{channelGroup}</span>
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{c.total_orders}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: '#10b981' }}>
                  {fmtRupiah(c.total_revenue)}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', color: '#94a3b8' }}>
                  {fmtRupiah(c.avg_order_value)}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, color: '#94a3b8' }}>{c.first_order_date}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, color: '#94a3b8' }}>{c.last_order_date}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                    background: c.is_repeat ? '#78350f' : '#064e3b',
                    color: c.is_repeat ? '#f59e0b' : '#10b981',
                  }}>
                    {c.is_repeat ? 'Repeat' : 'New'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
