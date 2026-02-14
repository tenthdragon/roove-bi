// @ts-nocheck
'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { fmtCompact, fmtRupiah, PRODUCT_COLORS } from '@/lib/utils';
import { useDateRange } from '@/lib/DateRangeContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

export default function ProductsPage() {
  const supabase = createClient();
  const { dateRange, loading: dateLoading } = useDateRange();
  const [data, setData] = useState([]);
  const [mpData, setMpData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    setLoading(true);
    Promise.all([
      supabase.from('daily_product_summary').select('*').gte('date', dateRange.from).lte('date', dateRange.to),
      supabase.from('daily_channel_data').select('product, mp_admin_cost').gte('date', dateRange.from).lte('date', dateRange.to),
    ]).then(([{ data: d }, { data: mp }]) => {
      setData(d || []);
      setMpData(mp || []);
      setLoading(false);
    });
  }, [dateRange, supabase]);

  // MP fee per product
  const mpFeeByProduct = useMemo(() => {
    const byP = {};
    mpData.forEach(d => {
      if (!byP[d.product]) byP[d.product] = 0;
      byP[d.product] += Math.abs(Number(d.mp_admin_cost) || 0);
    });
    return byP;
  }, [mpData]);

  const products = useMemo(() => {
    const byP = {};
    data.forEach(d => {
      if (!byP[d.product]) byP[d.product] = { s:0, g:0, n:0, m:0 };
      byP[d.product].s += Number(d.net_sales); byP[d.product].g += Number(d.gross_profit);
      byP[d.product].n += Number(d.net_after_mkt); byP[d.product].m += Math.abs(Number(d.mkt_cost));
    });
    return Object.entries(byP).filter(([,v]) => v.s > 0).sort((a, b) => b[1].s - a[1].s)
      .map(([p, v]) => {
        const mpFee = mpFeeByProduct[p] || 0;
        const mpFeePct = v.m > 0 ? (mpFee / v.m * 100) : 0;
        return {
          sku: p, sales: v.s, gp: v.g, nam: v.n, mkt: v.m, mpFee, mpFeePct,
          margin: v.s > 0 ? v.n / v.s * 100 : 0,
          mktR: v.s > 0 ? v.m / v.s * 100 : 0,
        };
      });
  }, [data, mpFeeByProduct]);

  const hasPreFebData = dateRange.from < '2026-02-01';

  if (dateLoading || (loading && data.length === 0)) {
    return (
      <div style={{ textAlign:'center', padding:60, color:'#64748b' }}>
        <div className="spinner" style={{ width:32, height:32, border:'3px solid #1a2744', borderTop:'3px solid #3b82f6', borderRadius:'50%', margin:'0 auto 12px' }} />
        <div>Memuat data...</div>
      </div>
    );
  }

  if (data.length === 0 && !loading) {
    return (
      <div className="fade-in">
        <h2 style={{ margin:'0 0 16px', fontSize:18, fontWeight:700 }}>Produk</h2>
        <div style={{ textAlign:'center', padding:60, color:'#64748b', background:'#111a2e', border:'1px solid #1a2744', borderRadius:12 }}>
          <div style={{ fontSize:48, marginBottom:16 }}>📦</div>
          <div style={{ fontSize:18, fontWeight:600, marginBottom:8 }}>Belum Ada Data untuk Periode Ini</div>
          <div style={{ fontSize:13 }}>Coba pilih rentang tanggal lain menggunakan filter di atas.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <h2 style={{ margin:'0 0 16px', fontSize:18, fontWeight:700 }}>Produk</h2>

      {hasPreFebData && (
        <div style={{ background:'#1e1b4b', border:'1px solid #3730a3', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:11, color:'#a5b4fc', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:16 }}>ℹ️</span>
          <span>Data sebelum Feb 2026 tidak termasuk biaya admin marketplace (MP Fee).</span>
        </div>
      )}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:14, marginBottom:20 }}>
        {products.map(p => (
          <div key={p.sku} style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:18, position:'relative', overflow:'hidden' }}>
            <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:PRODUCT_COLORS[p.sku]||'#64748b' }} />
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
              <div style={{ fontSize:15, fontWeight:700 }}>{p.sku}</div>
              <span style={{ padding:'3px 8px', borderRadius:6, fontSize:10, fontWeight:700, background:p.margin>=20?'#064e3b':p.margin>=0?'#78350f':'#7f1d1d', color:p.margin>=20?'#10b981':p.margin>=0?'#f59e0b':'#ef4444' }}>Margin After Mkt {p.margin.toFixed(1)}%</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, fontSize:12 }}>
              <div><div style={{ fontSize:10, color:'#64748b' }}>NET SALES</div><div style={{ fontWeight:700, fontFamily:'monospace' }}>Rp {fmtCompact(p.sales)}</div></div>
              <div><div style={{ fontSize:10, color:'#64748b' }}>GROSS PROFIT</div><div style={{ fontWeight:700, fontFamily:'monospace', color:'#10b981' }}>Rp {fmtCompact(p.gp)}</div></div>
              <div>
                <div style={{ fontSize:10, color:'#64748b' }}>MKT COST + MP FEE</div>
                <div style={{ fontWeight:700, fontFamily:'monospace', color:'#f59e0b' }}>Rp {fmtCompact(p.mkt)}</div>
                {p.mpFee > 0 && <div style={{ fontSize:9, color:'#8b5cf6' }}>MP Fee: {p.mpFeePct.toFixed(0)}%</div>}
              </div>
              <div><div style={{ fontSize:10, color:'#64748b' }}>PROFIT AFTER MKT</div><div style={{ fontWeight:700, fontFamily:'monospace', color:p.nam>=0?'#06b6d4':'#ef4444' }}>Rp {fmtCompact(p.nam)}</div></div>
            </div>
          </div>
        ))}
      </div>
      {products.length > 0 && (
        <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:16 }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>Net Sales vs Profit After Mkt</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={products.map(p=>({name:p.sku,'Net Sales':p.sales,'Profit After Mkt':p.nam}))} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2744" />
              <XAxis type="number" stroke="#64748b" fontSize={11} tickFormatter={v=>fmtCompact(v)} />
              <YAxis type="category" dataKey="name" stroke="#64748b" fontSize={11} width={65} />
              <Tooltip formatter={v=>fmtRupiah(v)} />
              <Bar dataKey="Net Sales" fill="#3b82f6" fillOpacity={0.6} radius={[0,4,4,0]} />
              <Bar dataKey="Profit After Mkt" radius={[0,4,4,0]}>
                {products.map((p,i) => <Cell key={i} fill={p.nam>=0?'#10b981':'#ef4444'} fillOpacity={0.6} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
