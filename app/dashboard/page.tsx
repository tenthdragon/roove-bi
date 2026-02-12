// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { fmtCompact, fmtRupiah, shortDate, PRODUCT_COLORS } from '@/lib/utils';
import DateRangePicker from '@/components/DateRangePicker';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, ComposedChart, Bar, Line } from 'recharts';

const TT = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (<div style={{ background:'#1e293b', border:'1px solid #1a2744', borderRadius:8, padding:'10px 14px', fontSize:12, maxWidth:320 }}>
    <div style={{ fontWeight:700, marginBottom:6 }}>{label}</div>
    {payload.filter((p:any)=>p.value!==0).map((p:any,i:number) => (
      <div key={i} style={{ color:p.color||p.stroke, marginBottom:2, display:'flex', justifyContent:'space-between', gap:16 }}>
        <span>{p.name}</span><span style={{ fontFamily:'monospace', fontWeight:600 }}>{fmtRupiah(Math.abs(p.value))}</span>
      </div>
    ))}
  </div>);
};

export default function OverviewPage() {
  const supabase = createClient();
  const [dailyData, setDailyData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [dateExtent, setDateExtent] = useState({ earliest: '', latest: '' });

  useEffect(() => {
    async function init() {
      const { data: first } = await supabase.from('daily_product_summary').select('date').order('date', { ascending: true }).limit(1);
      const { data: last } = await supabase.from('daily_product_summary').select('date').order('date', { ascending: false }).limit(1);
      const earliest = first?.[0]?.date || '2026-02-01';
      const latest = last?.[0]?.date || '2026-02-28';
      setDateExtent({ earliest, latest });
      setDateRange({ from: earliest, to: latest });
    }
    init();
  }, [supabase]);

  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    async function load() {
      setLoading(true);
      const { data } = await supabase.from('daily_product_summary').select('*').gte('date', dateRange.from).lte('date', dateRange.to).order('date');
      setDailyData(data || []);
      setLoading(false);
    }
    load();
  }, [dateRange, supabase]);

  const kpi = useMemo(() => {
    const byDate: Record<string, { s:number; g:number; n:number; m:number }> = {};
    dailyData.forEach((d: any) => {
      if (!byDate[d.date]) byDate[d.date] = { s:0, g:0, n:0, m:0 };
      byDate[d.date].s += Number(d.net_sales);
      byDate[d.date].g += Number(d.gross_profit);
      byDate[d.date].n += Number(d.net_after_mkt);
      byDate[d.date].m += Math.abs(Number(d.mkt_cost));
    });
    const dates = Object.keys(byDate).sort();
    const ts = dates.reduce((a,d) => a + byDate[d].s, 0);
    const tg = dates.reduce((a,d) => a + byDate[d].g, 0);
    const tn = dates.reduce((a,d) => a + byDate[d].n, 0);
    const tm = dates.reduce((a,d) => a + byDate[d].m, 0);
    const ad = dates.filter(d => byDate[d].s > 0).length;
    const chart = dates.map(d => ({ date: shortDate(d), 'Net Sales': byDate[d].s, 'Gross Profit': byDate[d].g, 'Net After Mkt': byDate[d].n, 'Ad Spend': byDate[d].m }));
    return { ts, tg, tn, tm, ad, chart, gpM: ts>0?tg/ts*100:0, nM: ts>0?tn/ts*100:0, mR: ts>0?tm/ts*100:0, avg: ad>0?ts/ad:0 };
  }, [dailyData]);

  // Aggregate by product
  const productTable = useMemo(() => {
    const byP: Record<string, { s:number; g:number; n:number; m:number }> = {};
    dailyData.forEach((d: any) => {
      if (!byP[d.product]) byP[d.product] = { s:0, g:0, n:0, m:0 };
      byP[d.product].s += Number(d.net_sales);
      byP[d.product].g += Number(d.gross_profit);
      byP[d.product].n += Number(d.net_after_mkt);
      byP[d.product].m += Math.abs(Number(d.mkt_cost));
    });
    return Object.entries(byP).filter(([,v]) => v.s > 0).sort((a,b) => b[1].s - a[1].s)
      .map(([p, v]) => ({ sku: p, sales: v.s, gp: v.g, nam: v.n, mkt: v.m, gmpR: v.s>0?v.n/v.s*100:0, mktR: v.s>0?v.m/v.s*100:0, sp: kpi.ts>0?v.s/kpi.ts*100:0 }));
  }, [dailyData, kpi.ts]);

  const KPI = ({ label, val, sub, color='#3b82f6' }: any) => (
    <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:'16px 18px', flex:'1 1 160px', minWidth:150, position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:color }} />
      <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6, fontWeight:600 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, fontFamily:'monospace', lineHeight:1.1 }}>{val}</div>
      {sub && <div style={{ fontSize:11, color:'#64748b', marginTop:4 }}>{sub}</div>}
    </div>
  );

  if (dailyData.length === 0 && !loading) {
    return <div style={{ textAlign:'center', padding:60, color:'#64748b' }}><div style={{ fontSize:48, marginBottom:16 }}>📊</div><div style={{ fontSize:18, fontWeight:600, marginBottom:8 }}>Belum Ada Data</div><div>Upload file Excel di halaman Admin untuk memulai.</div></div>;
  }

  return (
    <div className="fade-in">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:12 }}>
        <div><h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>Overview</h2><div style={{ fontSize:12, color:'#64748b' }}>{kpi.ad} active days</div></div>
        <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={(f,t) => setDateRange({from:f,to:t})} earliest={dateExtent.earliest} latest={dateExtent.latest} />
      </div>

      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:20 }}>
        <KPI label="Net Sales" val={`Rp ${fmtCompact(kpi.ts)}`} sub={`Avg: ${fmtRupiah(kpi.avg)}/hari`} />
        <KPI label="Gross Profit" val={`Rp ${fmtCompact(kpi.tg)}`} sub={`Margin: ${kpi.gpM.toFixed(1)}%`} color="#10b981" />
        <KPI label="Net After Mkt" val={`Rp ${fmtCompact(kpi.tn)}`} sub={`Margin: ${kpi.nM.toFixed(1)}%`} color="#06b6d4" />
        <KPI label="Ad Spend" val={`Rp ${fmtCompact(kpi.tm)}`} sub={`${kpi.mR.toFixed(1)}% of sales`} color="#f59e0b" />
      </div>

      {kpi.chart.length > 0 && (
        <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:16, marginBottom:20 }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>Tren Harian</div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={kpi.chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2744" />
              <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v:number) => fmtCompact(v)} />
              <Tooltip content={<TT />} />
              <Area type="monotone" dataKey="Net Sales" fill="#3b82f6" fillOpacity={0.12} stroke="#3b82f6" strokeWidth={2.5} />
              <Line type="monotone" dataKey="Gross Profit" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Net After Mkt" stroke="#06b6d4" strokeWidth={2} dot={false} strokeDasharray="5 3" />
              <Bar dataKey="Ad Spend" fill="#f59e0b" fillOpacity={0.35} radius={[3,3,0,0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Product Table */}
      <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:16, overflowX:'auto' }}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>Ringkasan Per Produk</div>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:700 }}>
          <thead><tr style={{ borderBottom:'2px solid #1a2744' }}>
            {['SKU','Sales',"%",'Gross Profit','Net After Mkt','GMP Real','% Mkt'].map(h => (
              <th key={h} style={{ padding:'8px 10px', textAlign:h==='SKU'?'left':'right', color:'#64748b', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {productTable.map(p => (
              <tr key={p.sku} style={{ borderBottom:'1px solid #1a2744' }}>
                <td style={{ padding:'8px 10px', fontWeight:600 }}>
                  <span style={{ display:'inline-block', width:8, height:8, borderRadius:2, background: PRODUCT_COLORS[p.sku] || '#64748b', marginRight:8, verticalAlign:'middle' }} />{p.sku}
                </td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11 }}>{fmtRupiah(p.sales)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right', color:'#64748b' }}>{p.sp.toFixed(1)}%</td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11 }}>{fmtRupiah(p.gp)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:p.nam>=0?'#10b981':'#ef4444' }}>{fmtRupiah(p.nam)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right' }}>
                  <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background:p.gmpR>=30?'#064e3b':p.gmpR>=0?'#78350f':'#7f1d1d', color:p.gmpR>=30?'#10b981':p.gmpR>=0?'#f59e0b':'#ef4444' }}>{p.gmpR.toFixed(1)}%</span>
                </td>
                <td style={{ padding:'8px 10px', textAlign:'right' }}>
                  <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background:p.mktR>40?'#7f1d1d':p.mktR>25?'#78350f':'#064e3b', color:p.mktR>40?'#ef4444':p.mktR>25?'#f59e0b':'#10b981' }}>{p.mktR.toFixed(1)}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
