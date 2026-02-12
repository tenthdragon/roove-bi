// @ts-nocheck
'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { fmtCompact, fmtRupiah, PRODUCT_COLORS } from '@/lib/utils';
import DateRangePicker from '@/components/DateRangePicker';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

export default function ProductsPage() {
  const supabase = createClient();
  const [data, setData] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [dateExtent, setDateExtent] = useState({ earliest: '', latest: '' });

  useEffect(() => {
    async function init() {
      const { data: f } = await supabase.from('daily_product_summary').select('date').order('date',{ascending:true}).limit(1);
      const { data: l } = await supabase.from('daily_product_summary').select('date').order('date',{ascending:false}).limit(1);
      setDateExtent({ earliest: f?.[0]?.date||'', latest: l?.[0]?.date||'' });
      setDateRange({ from: f?.[0]?.date||'', to: l?.[0]?.date||'' });
    }
    init();
  }, [supabase]);

  useEffect(() => {
    if (!dateRange.from) return;
    supabase.from('daily_product_summary').select('*').gte('date',dateRange.from).lte('date',dateRange.to)
      .then(({ data:d }) => setData(d || []));
  }, [dateRange, supabase]);

  const products = useMemo(() => {
    const byP: Record<string, { s:number; g:number; n:number; m:number }> = {};
    data.forEach((d:any) => {
      if (!byP[d.product]) byP[d.product] = { s:0, g:0, n:0, m:0 };
      byP[d.product].s += Number(d.net_sales); byP[d.product].g += Number(d.gross_profit);
      byP[d.product].n += Number(d.net_after_mkt); byP[d.product].m += Math.abs(Number(d.mkt_cost));
    });
    return Object.entries(byP).filter(([,v])=>v.s>0).sort((a,b)=>b[1].s-a[1].s)
      .map(([p,v]) => ({ sku:p, sales:v.s, gp:v.g, nam:v.n, mkt:v.m, margin:v.s>0?v.n/v.s*100:0, mktR:v.s>0?v.m/v.s*100:0 }));
  }, [data]);

  return (
    <div className="fade-in">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:12 }}>
        <h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>Produk</h2>
        <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={(f,t)=>setDateRange({from:f,to:t})} earliest={dateExtent.earliest} latest={dateExtent.latest} />
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:14, marginBottom:20 }}>
        {products.map(p => (
          <div key={p.sku} style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:18, position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:PRODUCT_COLORS[p.sku]||'#64748b' }} />
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
              <div style={{ fontSize:15, fontWeight:700 }}>{p.sku}</div>
              <span style={{ padding:'3px 8px', borderRadius:6, fontSize:11, fontWeight:700, background:p.margin>=20?'#064e3b':p.margin>=0?'#78350f':'#7f1d1d', color:p.margin>=20?'#10b981':p.margin>=0?'#f59e0b':'#ef4444' }}>NM {p.margin.toFixed(1)}%</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, fontSize:12 }}>
              <div><div style={{ fontSize:10, color:'#64748b' }}>SALES</div><div style={{ fontWeight:700, fontFamily:'monospace' }}>Rp {fmtCompact(p.sales)}</div></div>
              <div><div style={{ fontSize:10, color:'#64748b' }}>GROSS PROFIT</div><div style={{ fontWeight:700, fontFamily:'monospace', color:'#10b981' }}>Rp {fmtCompact(p.gp)}</div></div>
              <div><div style={{ fontSize:10, color:'#64748b' }}>NET AFTER MKT</div><div style={{ fontWeight:700, fontFamily:'monospace', color:p.nam>=0?'#06b6d4':'#ef4444' }}>Rp {fmtCompact(p.nam)}</div></div>
              <div><div style={{ fontSize:10, color:'#64748b' }}>MKT RATIO</div><div style={{ fontWeight:700, fontFamily:'monospace', color:p.mktR>40?'#ef4444':p.mktR>25?'#f59e0b':'#10b981' }}>{p.mktR.toFixed(1)}%</div></div>
            </div>
          </div>
        ))}
      </div>
      {products.length > 0 && (
        <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:16 }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>Sales vs Net After Marketing</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={products.map(p=>({name:p.sku,Sales:p.sales,'Net After Mkt':p.nam}))} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2744" />
              <XAxis type="number" stroke="#64748b" fontSize={11} tickFormatter={(v:number)=>fmtCompact(v)} />
              <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={11} width={65} />
              <Tooltip formatter={(v:number)=>fmtRupiah(v)} />
              <Bar dataKey="Sales" fill="#3b82f6" fillOpacity={0.6} radius={[0,4,4,0]} />
              <Bar dataKey="Net After Mkt" radius={[0,4,4,0]}>
                {products.map((p,i) => <Cell key={i} fill={p.nam>=0?'#10b981':'#ef4444'} fillOpacity={0.6} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}