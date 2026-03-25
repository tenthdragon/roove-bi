// @ts-nocheck
// app/dashboard/customers/page.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { fmtCompact, fmtRupiah, fmtPct } from '@/lib/utils';
import DateRangePicker from '@/components/DateRangePicker';
import {
  fetchCustomerTypeDaily,
  fetchCustomerKPIs,
  fetchCustomerCohort,
  fetchMonthlyCohort,
  fetchMonthlyCohortByChannel,
  fetchRtsCancelStats,
} from '@/lib/scalev-actions';

// ── Channel grouping ──
const CHANNEL_GROUP_MAP = {
  'Scalev Ads': 'Scalev Ads',
  'CS Manual': 'CS Manual',
  'Google Ads': 'Scalev Ads',
  'TikTok Shop': 'TikTok Shop',
  'Reseller': 'Reseller',
  'Shopee': 'Shopee',
  'Tokopedia': 'Other Marketplaces',
  'BliBli': 'Other Marketplaces',
  'Lazada': 'Other Marketplaces',
  'SnackVideo Ads': 'Other Marketplaces',
  'Marketplace': 'Other Marketplaces',
};

function getChannelGroup(sc) {
  return CHANNEL_GROUP_MAP[sc] || 'Other Marketplaces';
}

const CHANNEL_ORDER = ['Global', 'Scalev Ads', 'CS Manual', 'Reseller', 'TikTok Shop', 'Shopee', 'Other Marketplaces'];

const CHANNEL_TAB_COLORS = {
  'Global': '#3b82f6',
  'Scalev Ads': '#1877f2',
  'CS Manual': 'var(--green)',
  'Reseller': 'var(--yellow)',
  'TikTok Shop': '#00f2ea',
  'Shopee': '#ee4d2d',
  'Other Marketplaces': 'var(--dim)',
};

const SUB_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'cohort', label: 'Cohort' },
];

export default function CustomersPage() {
  const [subTab, setSubTab] = useState('overview');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [kpis, setKpis] = useState(null);
  const [dailyData, setDailyData] = useState([]);
  const [cohortData, setCohortData] = useState([]);
  const [cohortChannelData, setCohortChannelData] = useState([]);
  const [topCustomers, setTopCustomers] = useState([]);
  const [rtsCancel, setRtsCancel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState('Global');

  // Default: bulan ini
  useEffect(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    setDateRange({ from: `${y}-${m}-01`, to: now.toISOString().slice(0, 10) });
  }, []);

  useEffect(() => {
    if (!dateRange.from) return;
    loadData();
  }, [dateRange]);

  async function loadData() {
    setLoading(true);
    try {
      const [kpiData, daily, cohort, cohortCh, customers, rts] = await Promise.all([
        fetchCustomerKPIs(dateRange.from, dateRange.to),
        fetchCustomerTypeDaily(dateRange.from, dateRange.to),
        fetchMonthlyCohort(),
        fetchMonthlyCohortByChannel(),
        fetchCustomerCohort(50, dateRange.from, dateRange.to),
        fetchRtsCancelStats(dateRange.from, dateRange.to),
      ]);
      setKpis(kpiData);
      setDailyData(daily);
      setCohortData(cohort);
      setCohortChannelData(cohortCh);
      setTopCustomers(customers);
      setRtsCancel(rts);
    } catch (err) {
      console.error('Failed to load customer data:', err);
    } finally {
      setLoading(false);
    }
  }

  const groupedDaily = useMemo(() =>
    dailyData.map(d => ({ ...d, channel_group: getChannelGroup(d.sales_channel) })),
    [dailyData]
  );

  const filteredDaily = useMemo(() =>
    channelFilter === 'Global' ? groupedDaily : groupedDaily.filter(d => d.channel_group === channelFilter),
    [groupedDaily, channelFilter]
  );

  const availableChannels = useMemo(() => {
    const groups = new Set(groupedDaily.map(d => d.channel_group));
    return CHANNEL_ORDER.filter(ch => ch === 'Global' || groups.has(ch));
  }, [groupedDaily]);

  // ── Chart data: now with 3 categories ──
  const chartData = useMemo(() => {
    const byDate = {};
    for (const row of filteredDaily) {
      if (!byDate[row.date]) byDate[row.date] = { date: row.date, new: 0, repeat: 0, unidentified: 0 };
      if (row.customer_type === 'new') byDate[row.date].new += row.order_count || 0;
      else if (row.customer_type === 'ro') byDate[row.date].repeat += row.order_count || 0;
      else if (row.customer_type === 'unidentified') byDate[row.date].unidentified += row.order_count || 0;
    }
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredDaily]);

  // ── KPIs: now with unidentified ──
  const filteredKpis = useMemo(() => {
    if (!kpis) return null;
    let newC = 0, repC = 0, unidC = 0;
    let newR = 0, repR = 0, unidR = 0;
    let newO = 0, repO = 0, unidO = 0;
    for (const row of filteredDaily) {
      if (row.customer_type === 'new') {
        newC += row.customer_count || 0;
        newR += Number(row.revenue) || 0;
        newO += row.order_count || 0;
      } else if (row.customer_type === 'ro') {
        repC += row.customer_count || 0;
        repR += Number(row.revenue) || 0;
        repO += row.order_count || 0;
      } else if (row.customer_type === 'unidentified') {
        unidC += row.customer_count || 0;
        unidR += Number(row.revenue) || 0;
        unidO += row.order_count || 0;
      }
    }
    // Repeat rate based on identified customers only
    const identifiedTotal = newC + repC;
    return {
      totalCustomers: identifiedTotal,
      newCustomers: newC, repeatCustomers: repC,
      repeatRate: identifiedTotal > 0 ? (repC / identifiedTotal) * 100 : 0,
      newRevenue: newR, repeatRevenue: repR,
      unidentifiedRevenue: unidR, unidentifiedOrders: unidO, unidentifiedCustomers: unidC,
      avgOrderValue: (newO + repO) > 0 ? (newR + repR) / (newO + repO) : 0,
      newOrders: newO, repeatOrders: repO,
      totalRevenue: newR + repR + unidR,
      totalOrders: newO + repO + unidO,
    };
  }, [kpis, filteredDaily]);

  // ── Channel performance: include unidentified ──
  const channelPerformance = useMemo(() => {
    const byGroup = {};
    for (const row of groupedDaily) {
      const g = row.channel_group;
      if (!byGroup[g]) byGroup[g] = { newOrders: 0, repeatOrders: 0, unidOrders: 0, newCustomers: 0, repeatCustomers: 0, unidCustomers: 0, newRevenue: 0, repeatRevenue: 0, unidRevenue: 0 };
      if (row.customer_type === 'new') {
        byGroup[g].newOrders += row.order_count || 0;
        byGroup[g].newCustomers += row.customer_count || 0;
        byGroup[g].newRevenue += Number(row.revenue) || 0;
      } else if (row.customer_type === 'ro') {
        byGroup[g].repeatOrders += row.order_count || 0;
        byGroup[g].repeatCustomers += row.customer_count || 0;
        byGroup[g].repeatRevenue += Number(row.revenue) || 0;
      } else if (row.customer_type === 'unidentified') {
        byGroup[g].unidOrders += row.order_count || 0;
        byGroup[g].unidCustomers += row.customer_count || 0;
        byGroup[g].unidRevenue += Number(row.revenue) || 0;
      }
    }
    const rows = CHANNEL_ORDER.filter(ch => ch !== 'Global' && byGroup[ch]).map(ch => {
      const d = byGroup[ch];
      const tO = d.newOrders + d.repeatOrders + d.unidOrders;
      const tC = d.newCustomers + d.repeatCustomers;
      const tR = d.newRevenue + d.repeatRevenue + d.unidRevenue;
      return {
        channel: ch, totalOrders: tO, totalCustomers: tC,
        newCustomers: d.newCustomers, repeatCustomers: d.repeatCustomers,
        repeatRate: tC > 0 ? (d.repeatCustomers / tC) * 100 : 0,
        totalRevenue: tR, repeatRevenue: d.repeatRevenue,
        repeatRevShare: tR > 0 ? (d.repeatRevenue / tR) * 100 : 0,
        unidOrders: d.unidOrders, unidRevenue: d.unidRevenue,
        color: CHANNEL_TAB_COLORS[ch] || 'var(--dim)'
      };
    });
    const gN = rows.reduce((s, r) => s + r.newCustomers, 0);
    const gR = rows.reduce((s, r) => s + r.repeatCustomers, 0);
    const gT = gN + gR;
    const gRev = rows.reduce((s, r) => s + r.totalRevenue, 0);
    const gRR = rows.reduce((s, r) => s + r.repeatRevenue, 0);
    return {
      rows,
      globalRow: {
        channel: 'Global', totalOrders: rows.reduce((s, r) => s + r.totalOrders, 0),
        totalCustomers: gT, newCustomers: gN, repeatCustomers: gR,
        repeatRate: gT > 0 ? (gR / gT) * 100 : 0,
        totalRevenue: gRev, repeatRevenue: gRR,
        repeatRevShare: gRev > 0 ? (gRR / gRev) * 100 : 0, color: '#3b82f6'
      }
    };
  }, [groupedDaily]);

  const filteredTopCustomers = useMemo(() => {
    if (channelFilter === 'Global') return topCustomers;
    return topCustomers.filter(c => (CHANNEL_GROUP_MAP[c.first_channel] || 'Other Marketplaces') === channelFilter);
  }, [topCustomers, channelFilter]);

  return (
    <div className="fade-in">
      {/* ═══ HEADER + DATE PICKER ═══ */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 700 }}>Customer Analytics</h2>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)' }}>New vs Repeat vs Unidentified</p>
        </div>
        <DateRangePicker
          from={dateRange.from} to={dateRange.to}
          onChange={(f, t) => setDateRange({ from: f, to: t })}
          earliest="2025-12-01" latest={new Date().toISOString().slice(0, 10)}
        />
      </div>

      {/* ═══ SUB TABS ═══ */}
      <div style={{ display: 'flex', gap: 2, background: 'var(--bg-deep)', borderRadius: 10, padding: 3, border: '1px solid var(--border)', marginBottom: 20, width: 'fit-content' }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={{
            padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            background: subTab === t.id ? 'var(--accent)' : 'transparent',
            color: subTab === t.id ? '#fff' : 'var(--dim)',
          }}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%' }} />
        </div>
      ) : (
        <>
          {subTab === 'overview' && <OverviewTab kpis={filteredKpis} chartData={chartData} channelPerformance={channelPerformance} channelFilter={channelFilter} setChannelFilter={setChannelFilter} availableChannels={availableChannels} topCustomers={filteredTopCustomers} rtsCancel={rtsCancel} />}
          {subTab === 'cohort' && <CohortTab data={cohortData} channelData={cohortChannelData} />}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
// OVERVIEW TAB
// ═══════════════════════════════════════════════════
function OverviewTab({ kpis: k, chartData, channelPerformance, channelFilter, setChannelFilter, availableChannels, topCustomers, rtsCancel }) {
  if (!k) return <div style={{ color: 'var(--dim)', padding: 40, textAlign: 'center' }}>Belum ada data customer untuk periode ini.</div>;

  const maxOrders = Math.max(...chartData.map(d => d.new + d.repeat + d.unidentified), 1);
  const totalRevAll = k.totalRevenue;
  const newRevPct = totalRevAll > 0 ? (k.newRevenue / totalRevAll) * 100 : 0;
  const repRevPct = totalRevAll > 0 ? (k.repeatRevenue / totalRevAll) * 100 : 0;
  const unidRevPct = totalRevAll > 0 ? (k.unidentifiedRevenue / totalRevAll) * 100 : 0;

  return (
    <>
      {/* ═══ 1. CHANNEL PERFORMANCE TABLE ═══ */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20, overflowX: 'auto' }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>Repeat Rate per Channel</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              {['Channel', 'Orders', 'New', 'Repeat', 'Repeat Rate', 'Revenue', 'Repeat Rev %'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Channel' ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channelPerformance.rows.map(row => <ChannelRow key={row.channel} row={row} />)}
            <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--accent-subtle)' }}>
              <td style={{ padding: '10px', fontWeight: 700, color: 'var(--text)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 10, height: 10, borderRadius: 3, background: '#3b82f6' }} />Global</div></td>
              <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{channelPerformance.globalRow.totalOrders}</td>
              <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--green)', fontWeight: 600 }}>{channelPerformance.globalRow.newCustomers}</td>
              <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--yellow)', fontWeight: 600 }}>{channelPerformance.globalRow.repeatCustomers}</td>
              <td style={{ padding: '10px', textAlign: 'right' }}><RepeatRateBadge value={channelPerformance.globalRow.repeatRate} bold /></td>
              <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{fmtCompact(channelPerformance.globalRow.totalRevenue)}</td>
              <td style={{ padding: '10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>{fmtPct(channelPerformance.globalRow.repeatRevShare)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ═══ 2. CHANNEL FILTER TABS ═══ */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {availableChannels.map(ch => (
          <button key={ch} onClick={() => setChannelFilter(ch)} style={{
            padding: '5px 14px', borderRadius: 20, border: '1px solid',
            borderColor: channelFilter === ch ? (CHANNEL_TAB_COLORS[ch] || '#3b82f6') : 'var(--border)',
            background: channelFilter === ch ? `${CHANNEL_TAB_COLORS[ch] || '#3b82f6'}18` : 'transparent',
            color: channelFilter === ch ? (CHANNEL_TAB_COLORS[ch] || '#3b82f6') : 'var(--text-secondary)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
          }}>{ch}</button>
        ))}
      </div>

      {/* ═══ 3. KPI CARDS ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Total Customer', value: k.totalCustomers?.toLocaleString('id-ID'), color: 'var(--accent)', sub: `${k.newOrders + k.repeatOrders} orders` },
          { label: 'New Customer', value: k.newCustomers?.toLocaleString('id-ID'), color: 'var(--green)', sub: fmtCompact(k.newRevenue) },
          { label: 'Repeat Customer', value: k.repeatCustomers?.toLocaleString('id-ID'), color: 'var(--yellow)', sub: fmtCompact(k.repeatRevenue) },
          { label: 'Repeat Rate', value: fmtPct(k.repeatRate), color: k.repeatRate > 20 ? 'var(--green)' : 'var(--red)', sub: 'identified only' },
          { label: 'AOV', value: fmtCompact(k.avgOrderValue), color: '#8b5cf6', sub: 'per order' },
        ].map((card, i) => (
          <KpiCard key={i} {...card} />
        ))}
      </div>

      {/* ═══ 3b. REVENUE COMPARISON: New vs Repeat vs Unidentified ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
        {/* New Customer Revenue */}
        <RevenueCard
          label="New Customer Revenue"
          value={k.newRevenue}
          pct={newRevPct}
          color="var(--green)"
          bgColor="var(--badge-green-bg)"
          orders={k.newOrders}
        />
        {/* Repeat Customer Revenue */}
        <RevenueCard
          label="Repeat Order Revenue"
          value={k.repeatRevenue}
          pct={repRevPct}
          color="var(--yellow)"
          bgColor="var(--badge-yellow-bg)"
          orders={k.repeatOrders}
        />
        {/* Unidentified Revenue */}
        <RevenueCard
          label="Unidentified Revenue"
          value={k.unidentifiedRevenue}
          pct={unidRevPct}
          color="var(--dim)"
          bgColor="var(--bg-deep)"
          orders={k.unidentifiedOrders}
          tooltip="FBS & orders tanpa nama customer"
        />
      </div>

      {/* ═══ 4. DAILY CHART ═══ */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Daily Orders by Customer Type</h3>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--dim)' }}>{channelFilter === 'Global' ? 'Semua channel' : channelFilter}</p>
        {chartData.length === 0 ? (
          <div style={{ color: 'var(--dim)', textAlign: 'center', padding: 40 }}>Tidak ada data untuk periode ini</div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 180 }}>
              {chartData.map((d, i) => {
                const total = d.new + d.repeat + d.unidentified;
                const newH = (d.new / maxOrders) * 160;
                const repH = (d.repeat / maxOrders) * 160;
                const unidH = (d.unidentified / maxOrders) * 160;
                return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 160, width: '100%', alignItems: 'center' }}>
                      {/* Top: Unidentified (gray) */}
                      <div style={{ width: '70%', maxWidth: 20, height: unidH, background: 'var(--text-muted)', borderRadius: (d.repeat > 0 || d.new > 0) ? '3px 3px 0 0' : '3px 3px 0 0', minHeight: d.unidentified > 0 ? 2 : 0 }} title={`Unidentified: ${d.unidentified}`} />
                      {/* Middle: Repeat (amber) */}
                      <div style={{ width: '70%', maxWidth: 20, height: repH, background: 'var(--yellow)', borderRadius: d.unidentified > 0 ? '0' : '3px 3px 0 0', minHeight: d.repeat > 0 ? 2 : 0 }} title={`Repeat: ${d.repeat}`} />
                      {/* Bottom: New (green) */}
                      <div style={{ width: '70%', maxWidth: 20, height: newH, background: 'var(--green)', borderRadius: (d.repeat > 0 || d.unidentified > 0) ? '0' : '3px 3px 0 0', minHeight: d.new > 0 ? 2 : 0 }} title={`New: ${d.new}`} />
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
                    {i % step === 0 && <div style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(d.date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--green)' }} /><span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>New</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--yellow)' }} /><span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Repeat</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--text-muted)' }} /><span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Unidentified</span></div>
        </div>
      </div>

      {/* ═══ 5. TOP 50 CUSTOMERS ═══ */}
      <TopCustomersSection customers={topCustomers} channelFilter={channelFilter} />
    </>
  );
}

// ═══════════════════════════════════════════════════
// SMALL COMPONENTS
// ═══════════════════════════════════════════════════

function RevenueCard({ label, value, pct, color, bgColor, orders, tooltip }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>{fmtCompact(value)}</div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace", background: bgColor, padding: '3px 10px', borderRadius: 8 }}>
          {fmtPct(pct, 1)}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 6, background: 'var(--bg-deep)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.5s ease' }} />
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
        {orders.toLocaleString('id-ID')} orders
        {orders > 0 && ` · AOV ${fmtCompact(value / orders)}`}
        {tooltip && <span style={{ marginLeft: 4, color: 'var(--text-muted)' }} title={tooltip}>ⓘ</span>}
      </div>
    </div>
  );
}

function KpiCard({ label, value, color, sub }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 10, color: 'var(--dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function TopCustomersSection({ customers, channelFilter }) {
  if (!customers || customers.length === 0) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Top Customers by Revenue</h3>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)' }}>Tidak ada data customer untuk periode dan channel ini.</p>
      </div>
    );
  }
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, overflowX: 'auto' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>Top {Math.min(customers.length, 50)} Customers by Revenue</h3>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--dim)' }}>{channelFilter === 'Global' ? 'Semua channel' : channelFilter} — dalam periode yang dipilih</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
        <thead>
          <tr>
            {['#', 'Customer', 'Channel', 'Orders', 'Revenue', 'AOV', 'First', 'Last', 'Type'].map(h => (
              <th key={h} style={{ padding: '8px 10px', textAlign: ['#', 'Customer', 'Channel', 'Type'].includes(h) ? 'left' : 'right', color: 'var(--dim)', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {customers.slice(0, 50).map((c, i) => {
            const phone = c.customer_phone || '';
            const maskedPhone = phone.length > 7 ? phone.slice(0, 4) + '****' + phone.slice(-3) : phone;
            const cg = CHANNEL_GROUP_MAP[c.first_channel] || c.first_channel || 'Unknown';
            return (
              <tr key={i} style={{ borderBottom: '1px solid var(--bg-deep)' }}>
                <td style={{ padding: '7px 10px', color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}</td>
                <td style={{ padding: '7px 10px' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 12 }}>{c.first_name || 'N/A'}</div>
                  {maskedPhone && <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{maskedPhone}</div>}
                </td>
                <td style={{ padding: '7px 10px' }}>
                  <span style={{ padding: '2px 7px', borderRadius: 10, fontSize: 9, fontWeight: 600, background: `${CHANNEL_TAB_COLORS[cg] || 'var(--dim)'}20`, color: CHANNEL_TAB_COLORS[cg] || 'var(--text-secondary)' }}>{cg}</span>
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{c.total_orders}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: 'var(--green)' }}>{fmtRupiah(c.total_revenue)}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: 11 }}>{fmtRupiah(c.avg_order_value)}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 10, color: 'var(--text-secondary)' }}>{c.first_order_date}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontSize: 10, color: 'var(--text-secondary)' }}>{c.last_order_date}</td>
                <td style={{ padding: '7px 10px' }}>
                  <span style={{ padding: '2px 7px', borderRadius: 10, fontSize: 9, fontWeight: 700, background: c.is_repeat ? 'var(--badge-yellow-bg)' : 'var(--badge-green-bg)', color: c.is_repeat ? 'var(--yellow)' : 'var(--green)' }}>{c.is_repeat ? 'Repeat' : 'New'}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChannelRow({ row }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--bg-deep)' }}>
      <td style={{ padding: '8px 10px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 10, height: 10, borderRadius: 3, background: row.color, flexShrink: 0 }} /><span style={{ fontWeight: 600, color: 'var(--text)' }}>{row.channel}</span></div></td>
      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{row.totalOrders}</td>
      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--green)' }}>{row.newCustomers}</td>
      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--yellow)' }}>{row.repeatCustomers}</td>
      <td style={{ padding: '8px 10px', textAlign: 'right' }}><RepeatRateBadge value={row.repeatRate} /></td>
      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text)' }}>{fmtCompact(row.totalRevenue)}</td>
      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{fmtPct(row.repeatRevShare)}</td>
    </tr>
  );
}

function RepeatRateBadge({ value, bold = false }) {
  const color = value >= 50 ? 'var(--green)' : value >= 30 ? 'var(--yellow)' : 'var(--red)';
  const bg = value >= 50 ? 'var(--badge-green-bg)' : value >= 30 ? 'var(--badge-yellow-bg)' : 'var(--badge-red-bg)';
  return <span style={{ padding: '3px 8px', borderRadius: 10, fontSize: 10, fontWeight: bold ? 800 : 700, fontFamily: 'monospace', background: bg, color }}>{fmtPct(value, 1)}</span>;
}

// ═══════════════════════════════════════════════════
// COHORT TAB
// ═══════════════════════════════════════════════════

const COHORT_CHANNELS = [
  { key: 'Scalev', label: 'Scalev (CS Manual + Scalev Ads + WABA)' },
  { key: 'Shopee', label: 'Shopee' },
  { key: 'TikTok Shop', label: 'TikTok Shop' },
  { key: 'Reseller', label: 'Reseller' },
];

function CohortTable({ data, title, subtitle, csvFilename }) {
  if (!data || data.length === 0) return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)' }}>Belum ada data cohort.</p>
    </div>
  );

  const cohorts = {};
  for (const row of data) {
    if (!cohorts[row.cohort_month]) cohorts[row.cohort_month] = {};
    cohorts[row.cohort_month][row.months_since_first] = { customers: row.active_customers, orders: row.orders, revenue: Number(row.revenue) };
  }
  const cohortMonths = Object.keys(cohorts).sort();
  const maxM = Math.max(...data.map(d => d.months_since_first), 0);
  const displayM = Math.min(maxM, 11);

  const lastDataCol = {};
  for (const month of cohortMonths) {
    let last = 0;
    for (let i = 0; i <= displayM; i++) { if (cohorts[month][i]) last = i; }
    lastDataCol[month] = last;
  }

  const downloadFullCsv = () => {
    const headers = ['Cohort', 'Size', ...Array.from({ length: maxM + 1 }, (_, i) => i === 0 ? 'M0' : `M+${i}`)];
    const rows = cohortMonths.map(month => {
      const base = cohorts[month][0]?.customers || 0;
      return [month, base, ...Array.from({ length: maxM + 1 }, (_, i) => {
        const cell = cohorts[month][i];
        if (!cell) return '';
        return base > 0 ? `${((cell.customers / base) * 100).toFixed(1)}%` : '0%';
      })];
    });
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${csvFilename || 'cohort_retention'}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const stickyBase = { position: 'sticky' as const, zIndex: 2, background: 'var(--card)' };

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700 }}>{title}</h3>
          {subtitle && <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)' }}>{subtitle}</p>}
        </div>
        {maxM > displayM && (
          <button onClick={downloadFullCsv} style={{
            padding: '6px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6,
            border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text-secondary)',
            cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Full data (M+{maxM})
          </button>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr>
            <th style={{ ...stickyBase, left: 0, padding: '8px 10px', textAlign: 'left', color: 'var(--dim)', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>Cohort</th>
            <th style={{ ...stickyBase, left: 75, padding: '8px 10px', textAlign: 'center', color: 'var(--dim)', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>Size</th>
            {Array.from({ length: displayM + 1 }, (_, i) =>
              <th key={i} style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--dim)', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>{i === 0 ? 'M0' : `M+${i}`}</th>
            )}
          </tr></thead>
          <tbody>
            {cohortMonths.map(month => {
              const base = cohorts[month][0]?.customers || 0;
              return (
                <tr key={month}>
                  <td style={{ ...stickyBase, left: 0, padding: '8px 10px', borderBottom: '1px solid var(--bg-deep)', fontWeight: 600, color: 'var(--text)' }}>{month}</td>
                  <td style={{ ...stickyBase, left: 75, padding: '8px 10px', borderBottom: '1px solid var(--bg-deep)', textAlign: 'center', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{base}</td>
                  {Array.from({ length: displayM + 1 }, (_, i) => {
                    const cell = cohorts[month][i];
                    if (!cell) {
                      if (i > lastDataCol[month]) return <td key={i} style={{ padding: '8px 10px', borderBottom: '1px solid var(--bg-deep)' }} />;
                      return <td key={i} style={{ padding: '8px 10px', borderBottom: '1px solid var(--bg-deep)', textAlign: 'center', color: 'var(--border)' }}>—</td>;
                    }
                    const ret = base > 0 ? (cell.customers / base) * 100 : 0;
                    return <td key={i} style={{
                      padding: '8px 10px', borderBottom: '1px solid var(--bg-deep)', textAlign: 'center',
                      background: i === 0 ? 'var(--accent-subtle)' : `rgba(16,185,129,${Math.min(ret / 100, 1) * 0.3})`,
                      color: i === 0 ? '#60a5fa' : ret > 10 ? 'var(--green)' : 'var(--text-muted)',
                      fontWeight: ret > 20 ? 700 : 400, fontFamily: 'monospace', fontSize: 11
                    }}>{fmtPct(ret, 0)}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CohortTab({ data, channelData }) {
  const grouped = {};
  for (const row of (channelData || [])) {
    if (!grouped[row.channel_group]) grouped[row.channel_group] = [];
    grouped[row.channel_group].push(row);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <CohortTable
        data={data}
        title="Cohort Retention — All Channels"
        subtitle="Customer dari cohort bulan X yang masih order di bulan-bulan berikutnya"
        csvFilename="cohort_retention_all"
      />
      {COHORT_CHANNELS.map(({ key, label }) => (
        <CohortTable
          key={key}
          data={grouped[key] || []}
          title={`Cohort Retention — ${label}`}
          subtitle="Berdasarkan acquisition channel pertama customer"
          csvFilename={`cohort_retention_${key.toLowerCase().replace(/\s+/g, '_')}`}
        />
      ))}
    </div>
  );
}
