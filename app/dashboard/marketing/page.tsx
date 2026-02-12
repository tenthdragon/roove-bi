// @ts-nocheck
'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { fmtCompact, fmtRupiah, shortDate } from '@/lib/utils';
import DateRangePicker from '@/components/DateRangePicker';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function MarketingPage() {
  const supabase = createClient();
  const [adsData, setAdsData] = useState<any[]>([]);
  const [prodData, setProdData] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [dateExtent, setDateExtent] = useState({ earliest: '', latest: '' });

  useEffect(() => {
    async function init() {
      const { data: f } = await supabase.from('daily_ads_spend').select('date').order('date',{ascending:true}).limit(1);
      const { data: l } = await supabase.from('daily_ads_spend').select('date').order('date',{ascending:false}).limit(1);
      setDateExtent({ earliest: f?.[0]?.date||'', latest: l?.[0]?.date||'' });
      setDateRange({ from: f?.[0]?.date||'', to: l?.[0]?.date||'' });
    }
    init();
  }, [supabase]);

  useEffect(() => {
    if (!dateRange.from) return;
    Promise.all([
      supabase.from('daily_ads_spend').select('date, spent, store').gte('date',dateRange.from).lte('date',dateRange.to).order('date'),
      supabase.from('daily_product_summary').select('product, net_sales, mkt_cost').gte('date',dateRange.from).lte('date',dateRange.to),
    ]).then(([{ data: a }, { data: p }]) => { setAdsData(a||[]); setProdData(p||[]); });
  }, [dateRange, supabase]);

  const totalSpend = useMemo(() => adsData.reduce((a,d) => a + Number(d.spent), 0), [adsData]);
  const totalSales = useMemo(() => prodData.reduce((a,d) => a + Number(d.net_sales), 0), [prodData]);

  const dailyAds = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {};
    const stores = new Set<string>();
    adsData.forEach((d:any) => {
      if (!byDate[d.date]) byDate[d.date] = {};
      const store = d.store || 'Other';
      stores.add(store);
      byDate[d.date][store] = (byDate[d.date][store]||0) + Number(d.spent);
    });
    return { data: Object.keys(byDate).sort().map(d => ({ date: shortDate(d), ...byDate[d] })), stores: Array.from(stores) };
  }, [adsData]);

  const prodEfficiency = useMemo(() => {
    const byP: Record<string, { s:number; m:number }> = {};
    prodData.forEach((d:any) => {
      if (!byP[d.product]) byP[d.product] = { s:0, m:0 };
      byP[d.product].s += Number(d.net_sales); byP[d.product].m += Math.abs(Number(d.mkt_cost));
    });
    return Object.entries(byP).filter(([,v])=>v.m>0).sort((a,b)=>(a[1].s>0?a[1].m/a[1].s:999)-(b[1].s>0?b[1].m/b[1].s:999))
      .map(([p,v]) => ({ sku:p, spend:v.m, sales:v.s, ratio:v.s>0?v.m/v.s*100:0, roas:v.m>0?v.s/v.m:0 }));
  }, [prodData]);

  const storeColors: Record<string,string> = { Roove:'#3b82f6', 'Purvu Store':'#8b5cf6', Pluve:'#06b6d4', Osgard:'#f97316', DrHyun:'#ec4899', Calmara:'#f59e0b' };

  const KPI = ({ label, val, sub, color='#3b82f6' }: any) => (
    <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:'16px 18px', flex:'1 1 160px', minWidth:150, position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:color }} />
      <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6, fontWeight:600 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, fontFamily:'monospace', lineHeight:1.1 }}>{val}</div>
      {sub && <div style={{ fontSize:11, color:'#64748b', marginTop:4 }}>{sub}</div>}
    </div>
  );

  return (
    <div className="fade-in">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:12 }}>
        <h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>Marketing</h2>
        <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={(f,t)=>setDateRange({from:f,to:t})} earliest={dateExtent.earliest} latest={dateExtent.latest} />
      </div>
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:20 }}>
        <KPI label="Total Ad Spend" val={`Rp ${fmtCompact(totalSpend)}`} color="#f59e0b" />
        <KPI label="Avg Daily" val={`Rp ${fmtCompact(totalSpend/Math.max(dailyAds.data.length,1))}`} color="#f97316" />
        <KPI label="Mkt Ratio" val={`${totalSales>0?(totalSpend/totalSales*100).toFixed(1):0}%`} color={totalSales>0&&totalSpend/totalSales>0.3?'#ef4444':'#10b981'} />
        <KPI label="ROAS" val={`${totalSpend>0?(totalSales/totalSpend).toFixed(1):0}x`} color="#8b5cf6" />
      </div>
      {dailyAds.data.length > 0 && (
        <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:16, marginBottom:20 }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>Daily Ad Spend by Brand</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dailyAds.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2744" />
              <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v:number)=>fmtCompact(v)} />
              <Tooltip formatter={(v:number)=>fmtRupiah(v)} />
              {dailyAds.stores.map((s,i) => <Bar key={s} dataKey={s} stackId="a" fill={storeColors[s]||`hsl(${i*60},60%,50%)`} />)}
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginTop:8, justifyContent:'center' }}>
            {dailyAds.stores.map(s => (<div key={s} style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color:'#64748b' }}><div style={{ width:8, height:8, borderRadius:2, background:storeColors[s]||'#64748b' }} />{s}</div>))}
          </div>
        </div>
      )}
      <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:16 }}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>Marketing Efficiency</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:10 }}>
          {prodEfficiency.map(p => (
            <div key={p.sku} style={{ padding:12, background:'#0b1121', borderRadius:8, border:'1px solid #1a2744' }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
                <span style={{ fontWeight:600 }}>{p.sku}</span>
                <span style={{ fontSize:16, fontWeight:800, fontFamily:'monospace', color:p.ratio>40?'#ef4444':p.ratio>25?'#f59e0b':'#10b981' }}>{p.ratio.toFixed(1)}%</span>
              </div>
              <div style={{ height:6, borderRadius:3, background:'#1a2744', overflow:'hidden', marginBottom:4 }}>
                <div style={{ width:`${Math.min(p.ratio,100)}%`, height:'100%', borderRadius:3, background:p.ratio>40?'#ef4444':p.ratio>25?'#f59e0b':'#10b981' }} />
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#64748b' }}>
                <span>Spend: Rp {fmtCompact(p.spend)}</span><span>ROAS: {p.roas.toFixed(1)}x</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
