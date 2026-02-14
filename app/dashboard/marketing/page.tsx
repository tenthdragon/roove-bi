// @ts-nocheck
'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { fmtCompact, fmtRupiah, shortDate } from '@/lib/utils';
import { useDateRange } from '@/lib/DateRangeContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Line, ComposedChart } from 'recharts';

export default function MarketingPage() {
  const supabase = createClient();
  const { dateRange, loading: dateLoading } = useDateRange();
  const [adsData, setAdsData] = useState<any[]>([]);
  const [prodData, setProdData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    setLoading(true);
    Promise.all([
      supabase.from('daily_ads_spend').select('date, spent, store').gte('date', dateRange.from).lte('date', dateRange.to).order('date'),
      supabase.from('daily_product_summary').select('date, product, net_sales, mkt_cost').gte('date', dateRange.from).lte('date', dateRange.to),
    ]).then(([{ data: a }, { data: p }]) => {
      setAdsData(a || []);
      setProdData(p || []);
      setLoading(false);
    });
  }, [dateRange, supabase]);

  // ── Aggregations ──
  const { totalSpend, totalRevenue, activeDays, dailyByDate, avgDailyRatio, avgDailyRoas } = useMemo(() => {
    // Revenue per date
    const revByDate: Record<string, number> = {};
    prodData.forEach((d: any) => {
      revByDate[d.date] = (revByDate[d.date] || 0) + Number(d.net_sales);
    });

    // Spend per date
    const spendByDate: Record<string, number> = {};
    adsData.forEach((d: any) => {
      spendByDate[d.date] = (spendByDate[d.date] || 0) + Number(d.spent);
    });

    // Merge all dates
    const allDates = [...new Set([...Object.keys(revByDate), ...Object.keys(spendByDate)])].sort();

    const totalSpend = Object.values(spendByDate).reduce((a, v) => a + v, 0);
    const totalRevenue = Object.values(revByDate).reduce((a, v) => a + v, 0);

    // Daily dynamics for table and avg calculations
    let ratioSum = 0;
    let roasSum = 0;
    let countDays = 0;

    const dailyByDate = allDates.map(date => {
      const rev = revByDate[date] || 0;
      const spend = spendByDate[date] || 0;
      const ratio = rev > 0 ? (spend / rev) * 100 : 0;
      const roas = spend > 0 ? rev / spend : 0;

      if (rev > 0 || spend > 0) {
        ratioSum += ratio;
        roasSum += roas;
        countDays++;
      }

      return { date, revenue: rev, spend, ratio, roas };
    });

    return {
      totalSpend,
      totalRevenue,
      activeDays: countDays,
      dailyByDate,
      avgDailyRatio: countDays > 0 ? ratioSum / countDays : 0,
      avgDailyRoas: countDays > 0 ? roasSum / countDays : 0,
    };
  }, [adsData, prodData]);

  // Daily ad spend by store (for stacked bar chart)
  const dailyAds = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {};
    const stores = new Set<string>();
    adsData.forEach((d: any) => {
      if (!byDate[d.date]) byDate[d.date] = {};
      const store = d.store || 'Other';
      stores.add(store);
      byDate[d.date][store] = (byDate[d.date][store] || 0) + Number(d.spent);
    });
    return { data: Object.keys(byDate).sort().map(d => ({ date: shortDate(d), ...byDate[d] })), stores: Array.from(stores) };
  }, [adsData]);

  // Marketing efficiency per product
  const prodEfficiency = useMemo(() => {
    const byP: Record<string, { s: number; m: number }> = {};
    prodData.forEach((d: any) => {
      if (!byP[d.product]) byP[d.product] = { s: 0, m: 0 };
      byP[d.product].s += Number(d.net_sales);
      byP[d.product].m += Math.abs(Number(d.mkt_cost));
    });
    return Object.entries(byP).filter(([, v]) => v.m > 0).sort((a, b) => (a[1].s > 0 ? a[1].m / a[1].s : 999) - (b[1].s > 0 ? b[1].m / b[1].s : 999))
      .map(([p, v]) => ({ sku: p, spend: v.m, sales: v.s, ratio: v.s > 0 ? v.m / v.s * 100 : 0, roas: v.m > 0 ? v.s / v.m : 0 }));
  }, [prodData]);

  // Chart data: daily ratio trend
  const ratioChartData = useMemo(() => {
    return dailyByDate
      .filter(d => d.revenue > 0 || d.spend > 0)
      .map(d => ({
        date: shortDate(d.date),
        'Ad Spend': d.spend,
        'Revenue': d.revenue,
        'Mkt Ratio %': Number(d.ratio.toFixed(1)),
      }));
  }, [dailyByDate]);

  const storeColors: Record<string, string> = { Roove: '#3b82f6', 'Purvu Store': '#8b5cf6', Pluve: '#06b6d4', Osgard: '#f97316', DrHyun: '#ec4899', Calmara: '#f59e0b' };

  const totalRatio = totalRevenue > 0 ? (totalSpend / totalRevenue) * 100 : 0;
  const totalRoas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

  const KPI = ({ label, val, sub, color = '#3b82f6' }: any) => (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: '16px 18px', flex: '1 1 160px', minWidth: 150, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1.1 }}>{val}</div>
      {sub && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{sub}</div>}
    </div>
  );

  // ── Loading ──
  if (dateLoading || (loading && adsData.length === 0 && prodData.length === 0)) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>
        <div className="spinner" style={{ width: 32, height: 32, border: '3px solid #1a2744', borderTop: '3px solid #3b82f6', borderRadius: '50%', margin: '0 auto 12px' }} />
        <div>Memuat data...</div>
      </div>
    );
  }

  // ── Empty ──
  if (adsData.length === 0 && prodData.length === 0 && !loading) {
    return (
      <div className="fade-in">
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Marketing</h2>
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b', background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📢</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Belum Ada Data untuk Periode Ini</div>
          <div style={{ fontSize: 13 }}>Coba pilih rentang tanggal lain menggunakan filter di atas.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Marketing</h2>

      {/* ── 4 KPI Cards ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <KPI
          label="Total Revenue"
          val={`Rp ${fmtCompact(totalRevenue)}`}
          sub={`Avg: Rp ${fmtCompact(activeDays > 0 ? totalRevenue / activeDays : 0)}/hari`}
          color="#3b82f6"
        />
        <KPI
          label="Total Ad Spend"
          val={`Rp ${fmtCompact(totalSpend)}`}
          sub={`Avg: Rp ${fmtCompact(activeDays > 0 ? totalSpend / activeDays : 0)}/hari`}
          color="#f59e0b"
        />
        <KPI
          label="Mkt Ratio"
          val={`${totalRatio.toFixed(1)}%`}
          sub={`Avg: ${avgDailyRatio.toFixed(1)}%/hari`}
          color={totalRatio > 30 ? '#ef4444' : totalRatio > 20 ? '#f59e0b' : '#10b981'}
        />
        <KPI
          label="ROAS"
          val={`${totalRoas.toFixed(1)}x`}
          sub={`Avg: ${avgDailyRoas.toFixed(1)}x/hari`}
          color="#8b5cf6"
        />
      </div>

      {/* ── Daily Ad Spend + Mkt Ratio Chart ── */}
      {ratioChartData.length > 0 && (
        <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Daily Ad Spend & Marketing Ratio</div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={ratioChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2744" />
              <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
              <YAxis yAxisId="left" stroke="#64748b" fontSize={11} tickFormatter={(v: number) => fmtCompact(v)} />
              <YAxis yAxisId="right" orientation="right" stroke="#ef4444" fontSize={11} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div style={{ background: '#1e293b', border: '1px solid #1a2744', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
                      {payload.map((p: any, i: number) => (
                        <div key={i} style={{ color: p.color || p.stroke, marginBottom: 2, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span>{p.name}</span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {p.name === 'Mkt Ratio %' ? `${p.value}%` : fmtRupiah(p.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Bar yAxisId="left" dataKey="Revenue" fill="#3b82f6" fillOpacity={0.25} radius={[3, 3, 0, 0]} />
              <Bar yAxisId="left" dataKey="Ad Spend" fill="#f59e0b" fillOpacity={0.5} radius={[3, 3, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="Mkt Ratio %" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3, fill: '#ef4444' }} />
            </ComposedChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748b' }}><div style={{ width: 8, height: 8, borderRadius: 2, background: '#3b82f6' }} />Revenue</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748b' }}><div style={{ width: 8, height: 8, borderRadius: 2, background: '#f59e0b' }} />Ad Spend</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748b' }}><div style={{ width: 12, height: 3, borderRadius: 2, background: '#ef4444' }} />Mkt Ratio %</div>
          </div>
        </div>
      )}

      {/* ── Daily Ad Spend by Brand ── */}
      {dailyAds.data.length > 0 && (
        <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Daily Ad Spend by Brand</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dailyAds.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2744" />
              <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v: number) => fmtCompact(v)} />
              <Tooltip formatter={(v: number) => fmtRupiah(v)} />
              {dailyAds.stores.map((s, i) => <Bar key={s} dataKey={s} stackId="a" fill={storeColors[s] || `hsl(${i * 60},60%,50%)`} />)}
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, justifyContent: 'center' }}>
            {dailyAds.stores.map(s => (<div key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748b' }}><div style={{ width: 8, height: 8, borderRadius: 2, background: storeColors[s] || '#64748b' }} />{s}</div>))}
          </div>
        </div>
      )}

      {/* ── Daily Dynamics Table ── */}
      {dailyByDate.length > 0 && (
        <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, marginBottom: 20, overflowX: 'auto' }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Dinamika Harian</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 520 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #1a2744' }}>
                {['Tanggal', 'Revenue', 'Ad Spend', 'Mkt Ratio', 'ROAS'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Tanggal' ? 'left' : 'right', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dailyByDate.filter(d => d.revenue > 0 || d.spend > 0).map(d => (
                <tr key={d.date} style={{ borderBottom: '1px solid #1a2744' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 500 }}>{shortDate(d.date)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{fmtRupiah(d.revenue)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{fmtRupiah(d.spend)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    <span style={{
                      padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                      background: d.ratio > 40 ? '#7f1d1d' : d.ratio > 25 ? '#78350f' : '#064e3b',
                      color: d.ratio > 40 ? '#ef4444' : d.ratio > 25 ? '#f59e0b' : '#10b981',
                    }}>{d.ratio.toFixed(1)}%</span>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    <span style={{
                      fontFamily: 'monospace', fontWeight: 700, fontSize: 11,
                      color: d.roas >= 3 ? '#10b981' : d.roas >= 2 ? '#f59e0b' : '#ef4444',
                    }}>{d.roas.toFixed(1)}x</span>
                  </td>
                </tr>
              ))}
              {/* Average row */}
              <tr style={{ borderTop: '2px solid #1a2744', background: '#0b1121' }}>
                <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11 }}>AVERAGE</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{fmtRupiah(activeDays > 0 ? totalRevenue / activeDays : 0)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{fmtRupiah(activeDays > 0 ? totalSpend / activeDays : 0)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: '#1a2744', color: '#e2e8f0' }}>{avgDailyRatio.toFixed(1)}%</span>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11, color: '#e2e8f0' }}>{avgDailyRoas.toFixed(1)}x</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* ── Marketing Efficiency per Product ── */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Marketing Efficiency</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 10 }}>
          {prodEfficiency.map(p => (
            <div key={p.sku} style={{ padding: 12, background: '#0b1121', borderRadius: 8, border: '1px solid #1a2744' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>{p.sku}</span>
                <span style={{ fontSize: 16, fontWeight: 800, fontFamily: 'monospace', color: p.ratio > 40 ? '#ef4444' : p.ratio > 25 ? '#f59e0b' : '#10b981' }}>{p.ratio.toFixed(1)}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: '#1a2744', overflow: 'hidden', marginBottom: 4 }}>
                <div style={{ width: `${Math.min(p.ratio, 100)}%`, height: '100%', borderRadius: 3, background: p.ratio > 40 ? '#ef4444' : p.ratio > 25 ? '#f59e0b' : '#10b981' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b' }}>
                <span>Spend: Rp {fmtCompact(p.spend)}</span><span>ROAS: {p.roas.toFixed(1)}x</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
