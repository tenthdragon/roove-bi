// @ts-nocheck
// app/dashboard/customers/page.tsx
'use client';

import { useState, useEffect, useMemo } from 'react';
import { fmtCompact, fmtRupiah, fmtPct, shortDate, CHANNEL_COLORS } from '@/lib/utils';
import { fetchCustomerTypeDaily, fetchCustomerKPIs, fetchCustomerCohort, fetchMonthlyCohort } from '@/lib/scalev-actions';

// ── Sub-tab navigation (within Customers page) ──
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
  const [channelFilter, setChannelFilter] = useState('all');

  // Default to last 30 days
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

  // Filter daily data by channel
  const filteredDaily = useMemo(() => {
    if (channelFilter === 'all') return dailyData;
    return dailyData.filter(d => d.sales_channel === channelFilter);
  }, [dailyData, channelFilter]);

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

  // Unique channels for filter
  const availableChannels = useMemo(() => {
    const chs = new Set(dailyData.map(d => d.sales_channel));
    return ['all', ...Array.from(chs).sort()];
  }, [dailyData]);

  // Calculate filtered KPIs
  const filteredKpis = useMemo(() => {
    if (channelFilter === 'all') return kpis;
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
      ...kpis,
      newCustomers: newC,
      repeatCustomers: repC,
      totalCustomers: tot,
      repeatRate: tot > 0 ? (repC / tot) * 100 : 0,
      newRevenue: newR,
      repeatRevenue: repR,
      newOrders: newO,
      repeatOrders: repO,
      avgOrderValue: (newO + repO) > 0 ? (newR + repR) / (newO + repO) : 0,
    };
  }, [kpis, filteredDaily, channelFilter]);

  const k = filteredKpis;

  return (
    <div className="fade-in">
      {/* Page Header */}
      <div style={{ marginBottom:20, display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:'0 0 4px', fontSize:20, fontWeight:700 }}>Customer Analytics</h2>
          <p style={{ margin:0, fontSize:13, color:'#64748b' }}>
            New vs Repeat order — data dari Scalev API (channel: Facebook Ads, Organik, Reseller, Lazada)
          </p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          {/* Date Range */}
          <input type="date" value={dateRange.from} onChange={e => setDateRange(p => ({ ...p, from: e.target.value }))}
            style={{ padding:'6px 10px', background:'#111a2e', border:'1px solid #1a2744', borderRadius:8, color:'#e2e8f0', fontSize:12 }} />
          <span style={{ color:'#475569' }}>—</span>
          <input type="date" value={dateRange.to} onChange={e => setDateRange(p => ({ ...p, to: e.target.value }))}
            style={{ padding:'6px 10px', background:'#111a2e', border:'1px solid #1a2744', borderRadius:8, color:'#e2e8f0', fontSize:12 }} />
        </div>
      </div>

      {/* Channel Tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:16, flexWrap:'wrap' }}>
        <span style={{ fontSize:12, color:'#64748b', fontWeight:600, padding:'6px 8px', alignSelf:'center' }}>Channel:</span>
        {availableChannels.map(ch => (
          <button key={ch} onClick={() => setChannelFilter(ch)} style={{
            padding:'6px 14px', borderRadius:20, border:'1px solid',
            borderColor: channelFilter === ch ? '#3b82f6' : '#1a2744',
            background: channelFilter === ch ? 'rgba(59,130,246,0.12)' : 'transparent',
            color: channelFilter === ch ? '#60a5fa' : '#94a3b8',
            fontSize:12, fontWeight:600, cursor:'pointer',
          }}>
            {ch === 'all' ? 'Semua Scalev' : ch}
          </button>
        ))}
      </div>

      {/* Sub-tabs */}
      <div style={{ display:'flex', gap:2, background:'#0f172a', borderRadius:10, padding:3, border:'1px solid #1a2744', marginBottom:20, width:'fit-content' }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={{
            padding:'7px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13, fontWeight:600,
            background: subTab === t.id ? '#3b82f6' : 'transparent',
            color: subTab === t.id ? '#fff' : '#64748b',
          }}>{t.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:60 }}>
          <div className="spinner" style={{ width:32, height:32, border:'3px solid #1a2744', borderTop:'3px solid #3b82f6', borderRadius:'50%' }} />
        </div>
      ) : (
        <>
          {subTab === 'overview' && <OverviewTab kpis={k} chartData={chartData} />}
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
function OverviewTab({ kpis: k, chartData }) {
  if (!k) return <div style={{ color:'#64748b', padding:40, textAlign:'center' }}>Belum ada data customer. Pastikan Scalev sync sudah berjalan dan memiliki order shipped.</div>;

  const maxOrders = Math.max(...chartData.map(d => d.new + d.repeat), 1);

  return (
    <>
      {/* KPI Cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:12, marginBottom:24 }}>
        {[
          { label: 'Total Customer', value: k.totalCustomers?.toLocaleString('id-ID'), color: '#3b82f6', sub: `${k.newOrders + k.repeatOrders} orders` },
          { label: 'New Customer', value: k.newCustomers?.toLocaleString('id-ID'), color: '#10b981', sub: fmtCompact(k.newRevenue) },
          { label: 'Repeat Customer', value: k.repeatCustomers?.toLocaleString('id-ID'), color: '#f59e0b', sub: fmtCompact(k.repeatRevenue) },
          { label: 'Repeat Rate', value: fmtPct(k.repeatRate), color: k.repeatRate > 20 ? '#10b981' : '#ef4444', sub: 'target > 20%' },
          { label: 'Avg Order Value', value: fmtCompact(k.avgOrderValue), color: '#8b5cf6', sub: 'per order' },
          { label: 'Repeat Revenue Share', value: fmtPct(k.newRevenue + k.repeatRevenue > 0 ? (k.repeatRevenue / (k.newRevenue + k.repeatRevenue)) * 100 : 0), color: '#06b6d4', sub: fmtCompact(k.repeatRevenue) },
        ].map((card, i) => (
          <div key={i} style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:16 }}>
            <div style={{ fontSize:11, color:'#64748b', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:6 }}>{card.label}</div>
            <div style={{ fontSize:22, fontWeight:800, color: card.color, fontFamily:"'JetBrains Mono', monospace" }}>{card.value}</div>
            <div style={{ fontSize:11, color:'#475569', marginTop:4 }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Daily Bar Chart - New vs Repeat */}
      <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:20, marginBottom:20 }}>
        <h3 style={{ margin:'0 0 16px', fontSize:14, fontWeight:700 }}>Daily New vs Repeat Orders</h3>
        {chartData.length === 0 ? (
          <div style={{ color:'#64748b', textAlign:'center', padding:40 }}>Tidak ada data untuk periode ini</div>
        ) : (
          <div style={{ display:'flex', alignItems:'flex-end', gap:2, height:200, overflowX:'auto' }}>
            {chartData.map((d, i) => {
              const total = d.new + d.repeat;
              const newH = total > 0 ? (d.new / maxOrders) * 180 : 0;
              const repH = total > 0 ? (d.repeat / maxOrders) * 180 : 0;
              return (
                <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', flex:'1 0 24px', minWidth:24 }}>
                  <div style={{ display:'flex', flexDirection:'column', justifyContent:'flex-end', height:180 }}>
                    <div style={{ width:16, height:repH, background:'#f59e0b', borderRadius:'3px 3px 0 0', minHeight: d.repeat > 0 ? 2 : 0 }} title={`Repeat: ${d.repeat}`} />
                    <div style={{ width:16, height:newH, background:'#10b981', borderRadius: d.repeat > 0 ? '0' : '3px 3px 0 0', minHeight: d.new > 0 ? 2 : 0 }} title={`New: ${d.new}`} />
                  </div>
                  {i % Math.max(1, Math.floor(chartData.length / 10)) === 0 && (
                    <div style={{ fontSize:9, color:'#475569', marginTop:4, whiteSpace:'nowrap', transform:'rotate(-45deg)', transformOrigin:'top left' }}>
                      {shortDate(d.date)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div style={{ display:'flex', gap:20, marginTop:12 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ width:12, height:12, borderRadius:3, background:'#10b981' }} />
            <span style={{ fontSize:11, color:'#94a3b8' }}>New Customer</span>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <div style={{ width:12, height:12, borderRadius:3, background:'#f59e0b' }} />
            <span style={{ fontSize:11, color:'#94a3b8' }}>Repeat Customer</span>
          </div>
        </div>
      </div>

      {/* Revenue Breakdown - New vs Repeat */}
      <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:20 }}>
        <h3 style={{ margin:'0 0 16px', fontSize:14, fontWeight:700 }}>Revenue Comparison: New vs Repeat</h3>
        {k && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <RevenueBar label="New" value={k.newRevenue} total={k.newRevenue + k.repeatRevenue} color="#10b981" orders={k.newOrders} />
            <RevenueBar label="Repeat" value={k.repeatRevenue} total={k.newRevenue + k.repeatRevenue} color="#f59e0b" orders={k.repeatOrders} />
          </div>
        )}
      </div>
    </>
  );
}

function RevenueBar({ label, value, total, color, orders }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div style={{ padding:16, background:'#0b1121', border:'1px solid #1a2744', borderRadius:8 }}>
      <div style={{ fontSize:12, color:'#64748b', fontWeight:600, marginBottom:8 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:800, color, fontFamily:"'JetBrains Mono', monospace" }}>{fmtRupiah(value)}</div>
      <div style={{ fontSize:11, color:'#475569', marginTop:4 }}>{orders} orders · {fmtPct(pct)} share</div>
      <div style={{ marginTop:8, height:6, background:'#1a2744', borderRadius:3 }}>
        <div style={{ height:'100%', background: color, borderRadius:3, width:`${pct}%`, transition:'width 0.5s' }} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// COHORT TAB
// ═══════════════════════════════════════════════════
function CohortTab({ data }) {
  if (!data || data.length === 0) {
    return <div style={{ color:'#64748b', textAlign:'center', padding:40 }}>Belum ada data cohort. Minimal perlu data 2+ bulan untuk analisis cohort.</div>;
  }

  // Build cohort matrix
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
    <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:20, overflowX:'auto' }}>
      <h3 style={{ margin:'0 0 4px', fontSize:14, fontWeight:700 }}>Cohort Retention</h3>
      <p style={{ margin:'0 0 16px', fontSize:12, color:'#64748b' }}>
        Berapa customer dari cohort bulan X yang masih order di bulan-bulan berikutnya
      </p>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
        <thead>
          <tr>
            <th style={{ padding:'8px 12px', textAlign:'left', color:'#64748b', borderBottom:'1px solid #1a2744', fontWeight:600 }}>Cohort</th>
            <th style={{ padding:'8px 12px', textAlign:'center', color:'#64748b', borderBottom:'1px solid #1a2744', fontWeight:600 }}>Customers</th>
            {Array.from({ length: Math.min(maxMonthsSince + 1, 7) }, (_, i) => (
              <th key={i} style={{ padding:'8px 12px', textAlign:'center', color:'#64748b', borderBottom:'1px solid #1a2744', fontWeight:600 }}>
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
                <td style={{ padding:'8px 12px', borderBottom:'1px solid #0f172a', fontWeight:600, color:'#e2e8f0' }}>{month}</td>
                <td style={{ padding:'8px 12px', borderBottom:'1px solid #0f172a', textAlign:'center', fontFamily:'monospace', color:'#94a3b8' }}>{base}</td>
                {Array.from({ length: Math.min(maxMonthsSince + 1, 7) }, (_, i) => {
                  const cell = cohorts[month][i];
                  if (!cell) return <td key={i} style={{ padding:'8px 12px', borderBottom:'1px solid #0f172a', textAlign:'center', color:'#1a2744' }}>—</td>;
                  const retPct = base > 0 ? (cell.customers / base) * 100 : 0;
                  const intensity = Math.min(retPct / 100, 1);
                  return (
                    <td key={i} style={{
                      padding:'8px 12px', borderBottom:'1px solid #0f172a', textAlign:'center',
                      background: i === 0 ? 'rgba(59,130,246,0.15)' : `rgba(16,185,129,${intensity * 0.3})`,
                      color: i === 0 ? '#60a5fa' : retPct > 10 ? '#10b981' : '#475569',
                      fontWeight: retPct > 20 ? 700 : 400,
                      fontFamily:'monospace', fontSize:11,
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
    return <div style={{ color:'#64748b', textAlign:'center', padding:40 }}>Belum ada data customer.</div>;
  }

  return (
    <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:20, overflowX:'auto' }}>
      <h3 style={{ margin:'0 0 4px', fontSize:14, fontWeight:700 }}>Top 50 Customers by Revenue</h3>
      <p style={{ margin:'0 0 16px', fontSize:12, color:'#64748b' }}>
        Hanya data dari channel Scalev (customer phone tersedia)
      </p>
      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
        <thead>
          <tr>
            <th style={{ padding:'8px 12px', textAlign:'left', color:'#64748b', borderBottom:'1px solid #1a2744', fontWeight:600 }}>#</th>
            <th style={{ padding:'8px 12px', textAlign:'left', color:'#64748b', borderBottom:'1px solid #1a2744', fontWeight:600 }}>Customer</th>
            <th style={{ padding:'8px 12px', textAlign:'left', color:'#64748b', borderBottom:'1px solid #1a2744', fontWeight:600 }}>Channel</th>
            <th style={{ padding:'8px 12px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #1a2744', fontWeight:600 }}>Orders</th>
            <th style={{ padding:'8px 12px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #1a2744', fontWeight:600 }}>Total Revenue</th>
            <th style={{ padding:'8px 12px', textAlign:'right', color:'#64748b', borderBottom:'1px solid #1a2744', fontWeight:600 }}>AOV</th>
            <th style={{ padding:'8px 12px', textAlign:'center', color:'#64748b', borderBottom:'1px solid #1a2744', fontWeight:600 }}>First Order</th>
            <th style={{ padding:'8px 12px', textAlign:'center', color:'#64748b', borderBottom:'1px solid #1a2744', fontWeight:600 }}>Last Order</th>
            <th style={{ padding:'8px 12px', textAlign:'center', color:'#64748b', borderBottom:'1px solid #1a2744', fontWeight:600 }}>Type</th>
          </tr>
        </thead>
        <tbody>
          {customers.map((c, i) => {
            // Mask phone for privacy: show first 4 + last 3
            const phone = c.customer_phone || '';
            const maskedPhone = phone.length > 7 
              ? phone.slice(0, 4) + '****' + phone.slice(-3) 
              : phone;
            
            return (
              <tr key={i} style={{ borderBottom:'1px solid #0f172a' }}>
                <td style={{ padding:'8px 12px', color:'#475569' }}>{i + 1}</td>
                <td style={{ padding:'8px 12px' }}>
                  <div style={{ fontWeight:600, color:'#e2e8f0' }}>{c.first_name || 'N/A'}</div>
                  <div style={{ fontSize:10, color:'#475569', fontFamily:'monospace' }}>{maskedPhone}</div>
                </td>
                <td style={{ padding:'8px 12px' }}>
                  <span style={{
                    padding:'2px 8px', borderRadius:12, fontSize:10, fontWeight:600,
                    background: CHANNEL_COLORS[c.first_channel] ? `${CHANNEL_COLORS[c.first_channel]}20` : '#1a2744',
                    color: CHANNEL_COLORS[c.first_channel] || '#94a3b8',
                  }}>{c.first_channel}</span>
                </td>
                <td style={{ padding:'8px 12px', textAlign:'right', fontFamily:'monospace', fontWeight:600 }}>{c.total_orders}</td>
                <td style={{ padding:'8px 12px', textAlign:'right', fontFamily:'monospace', fontWeight:600, color:'#10b981' }}>
                  {fmtRupiah(c.total_revenue)}
                </td>
                <td style={{ padding:'8px 12px', textAlign:'right', fontFamily:'monospace', color:'#94a3b8' }}>
                  {fmtRupiah(c.avg_order_value)}
                </td>
                <td style={{ padding:'8px 12px', textAlign:'center', fontSize:11, color:'#94a3b8' }}>{c.first_order_date}</td>
                <td style={{ padding:'8px 12px', textAlign:'center', fontSize:11, color:'#94a3b8' }}>{c.last_order_date}</td>
                <td style={{ padding:'8px 12px', textAlign:'center' }}>
                  <span style={{
                    padding:'2px 8px', borderRadius:12, fontSize:10, fontWeight:700,
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
