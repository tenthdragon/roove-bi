// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSupabase } from '@/lib/supabase-browser';
import { useDateRange } from '@/lib/DateRangeContext';
import { getCached, setCache } from '@/lib/dashboard-cache';
// Recharts removed — daily trend is now a table
import { useActiveBrands } from '@/lib/ActiveBrandsContext';
import { fmtCompact, fmtRupiah, shortDate, PRODUCT_COLORS, getBrandColor } from '@/lib/utils';
import CashFlowSection from '@/components/CashFlowSection';

// Daily trend color coding for margin
const marginColor = (v: number) => v >= 30 ? '#10b981' : v >= 0 ? '#f59e0b' : '#ef4444';
const marginBg = (v: number) => v >= 30 ? '#064e3b' : v >= 0 ? '#78350f' : '#7f1d1d';

export default function OverviewPage() {
  const supabase = useSupabase();
  const { dateRange, loading: dateLoading } = useDateRange();
  const [dailyData, setDailyData] = useState([]);
  const [loading, setLoading] = useState(true);
  const { activeBrands, isActiveBrand } = useActiveBrands();
  const [userRole, setUserRole] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase.from('profiles').select('role').eq('id', user.id).single()
          .then(({ data }) => setUserRole(data?.role || null));
      }
    });
  }, [supabase]);

  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    const cached = getCached<any[]>('daily_product_summary', dateRange.from, dateRange.to);
    if (cached) {
      setDailyData(cached.filter(row => isActiveBrand(row.product)));
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase.from('daily_product_summary')
      .select('*')
      .gte('date', dateRange.from)
      .lte('date', dateRange.to)
      .order('date')
      .then(({ data: d }) => {
        const rows = d || [];
        setCache('daily_product_summary', dateRange.from, dateRange.to, rows);
        setDailyData(rows.filter(row => isActiveBrand(row.product)));
        setLoading(false);
      });
  }, [dateRange, supabase]);

  const totalMpFee = useMemo(() => {
    return dailyData.reduce((a, d) => a + Math.abs(Number(d.mp_admin_cost) || 0), 0);
  }, [dailyData]);

  const kpi = useMemo(() => {
    const byDate = {};
    dailyData.forEach(d => {
      if (!byDate[d.date]) byDate[d.date] = { s:0, g:0, n:0, mp:0 };
      byDate[d.date].s += Number(d.net_sales);
      byDate[d.date].g += Number(d.gross_profit);
      byDate[d.date].n += Number(d.net_after_mkt);
      byDate[d.date].mp += Math.abs(Number(d.mp_admin_cost) || 0);
    });
    const dates = Object.keys(byDate).sort();
    const ts = dates.reduce((a,d) => a + byDate[d].s, 0);
    const tg = dates.reduce((a,d) => a + byDate[d].g, 0);
    const tn = dates.reduce((a,d) => a + byDate[d].n, 0);
    const tm = tg - tn;
    const ad = dates.filter(d => byDate[d].s > 0).length;
    const chart = dates.map(d => {
      const totalMkt = byDate[d].g - byDate[d].n;
      const mpFee = byDate[d].mp;
      const adsFee = totalMkt - mpFee;
      const cogs = byDate[d].s - byDate[d].g;
      const gpM = byDate[d].s > 0 ? byDate[d].g / byDate[d].s * 100 : 0;
      const nM = byDate[d].s > 0 ? byDate[d].n / byDate[d].s * 100 : 0;
      return {
        date: shortDate(d),
        'Net Sales': byDate[d].s,
        'Gross Profit': byDate[d].g,
        'COGS': cogs,
        'GP After Mkt + Adm': byDate[d].n,
        'Mkt Fee': adsFee,
        'MP Fee': mpFee,
        gpM, nM,
      };
    });
    const tMp = dates.reduce((a,d) => a + byDate[d].mp, 0);
    const tAds = tm - tMp;
    const tCogs = ts - tg;
    return { ts, tg, tn, tm, tMp, tAds, tCogs, ad, chart, gpM: ts>0?tg/ts*100:0, nM: ts>0?tn/ts*100:0, mR: ts>0?tm/ts*100:0, avg: ad>0?ts/ad:0 };
  }, [dailyData]);

  const productTable = useMemo(() => {
    const byP = {};
    dailyData.forEach(d => {
      if (!byP[d.product]) byP[d.product] = { s:0, g:0, n:0, mp:0, mc:0 };
      byP[d.product].s += Number(d.net_sales);
      byP[d.product].g += Number(d.gross_profit);
      byP[d.product].n += Number(d.net_after_mkt);
      byP[d.product].mp += Math.abs(Number(d.mp_admin_cost) || 0);
      byP[d.product].mc += Math.abs(Number(d.mkt_cost) || 0);
    });
    return Object.entries(byP).filter(([,v]) => v.s > 0).sort((a,b) => b[1].s - a[1].s)
      .map(([p, v]) => {
        const cogs = v.s - v.g;
        const adsFee = v.mc - v.mp;
        return { sku: p, sales: v.s, cogs, gp: v.g, adsFee, mpFee: v.mp, nam: v.n, gmpR: v.s>0?v.n/v.s*100:0, mktR: v.s>0?v.mc/v.s*100:0, sp: kpi.ts>0?v.s/kpi.ts*100:0 };
      });
  }, [dailyData, kpi.ts]);

  const hasPreFebData = dateRange.from < '2026-02-01';
  const mpFeePercent = kpi.tm > 0 ? (totalMpFee / kpi.tm * 100) : 0;

  const cashFlowPeriodStart = useMemo(() => {
    if (!dateRange.from) return null;
    const [y, m] = dateRange.from.split('-');
    return `${y}-${m}-01`;
  }, [dateRange.from]);

  const isOwnerOrAdmin = userRole === 'owner' || userRole === 'admin';

  const KPI = ({ label, val, sub, color='#3b82f6' }) => (
    <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:'16px 18px', flex:'1 1 160px', minWidth:150, position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:color }} />
      <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6, fontWeight:600 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, fontFamily:'monospace', lineHeight:1.1 }}>{val}</div>
      {sub && <div style={{ fontSize:11, color:'#64748b', marginTop:4 }}>{sub}</div>}
    </div>
  );

  if (dateLoading || (loading && dailyData.length === 0)) {
    return (
      <div style={{ textAlign:'center', padding:60, color:'#64748b' }}>
        <div className="spinner" style={{ width:32, height:32, border:'3px solid #1a2744', borderTop:'3px solid #3b82f6', borderRadius:'50%', margin:'0 auto 12px' }} />
        <div>Memuat data...</div>
      </div>
    );
  }

  if (dailyData.length === 0 && !loading) {
    return (
      <div className="fade-in">
        <h2 style={{ margin:'0 0 16px', fontSize:18, fontWeight:700 }}>Overview</h2>
        <div style={{ textAlign:'center', padding:60, color:'#64748b', background:'#111a2e', border:'1px solid #1a2744', borderRadius:12 }}>
          <div style={{ fontSize:48, marginBottom:16 }}>📊</div>
          <div style={{ fontSize:18, fontWeight:600, marginBottom:8 }}>Belum Ada Data untuk Periode Ini</div>
          <div style={{ fontSize:13 }}>Coba pilih rentang tanggal lain menggunakan filter di atas, atau upload data di halaman Admin.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:12 }}>
        <div><h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>Overview</h2><div style={{ fontSize:12, color:'#64748b' }}>{kpi.ad} active days</div></div>
      </div>

      {/* ── KPI Cards ── */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:20 }}>
        <KPI label="Net Sales" val={`Rp ${fmtCompact(kpi.ts)}`} sub={`Avg: ${fmtRupiah(kpi.avg)}/hari`} />
        <KPI label="Gross Profit" val={`Rp ${fmtCompact(kpi.tg)}`} sub={`GP Margin: ${kpi.gpM.toFixed(1)}%`} color="#10b981" />
        <KPI label="Mkt Cost + MP Fee" val={`Rp ${fmtCompact(kpi.tm)}`} sub={totalMpFee > 0 ? `MP Fee: Rp ${fmtCompact(totalMpFee)} (${mpFeePercent.toFixed(1)}%)` : 'MP Fee: tidak tersedia'} color="#f59e0b" />
        <KPI label="GP After Mkt + Adm" val={`Rp ${fmtCompact(kpi.tn)}`} sub={`Margin After Mkt: ${kpi.nM.toFixed(1)}%`} color="#06b6d4" />
      </div>

      {/* ── Cash Flow Status (owner/admin) ── */}
      {isOwnerOrAdmin && cashFlowPeriodStart && (
        <CashFlowSection netSales={kpi.ts} periodStart={cashFlowPeriodStart} />
      )}

      {hasPreFebData && (
        <div style={{ background:'#1e1b4b', border:'1px solid #3730a3', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:11, color:'#a5b4fc', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:16 }}>ℹ️</span>
          <span>Data sebelum Feb 2026 tidak termasuk biaya admin marketplace (MP Fee).</span>
        </div>
      )}

      {kpi.chart.length > 0 && (
        <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:16, marginBottom:20, overflowX:'auto' }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>Tren Harian</div>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:820 }}>
            <thead>
              <tr style={{ borderBottom:'2px solid #1a2744' }}>
                <th style={{ padding:'8px 10px', textAlign:'left', color:'#64748b', fontWeight:600, fontSize:10, textTransform:'uppercase', position:'sticky', left:0, background:'#111a2e', zIndex:1 }}>Tanggal</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'#3b82f6', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Net Sales</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'#ef4444', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>COGS</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'#f59e0b', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Mkt Fee</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'#f59e0b', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>MP Fee</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'#06b6d4', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>GP After Mkt + Adm</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'#06b6d4', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {kpi.chart.map((row, i) => (
                <tr key={i} style={{ borderBottom:'1px solid #0f172a' }}>
                  <td style={{ padding:'8px 10px', fontWeight:600, whiteSpace:'nowrap', position:'sticky', left:0, background:'#111a2e', zIndex:1 }}>{row.date}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11 }}>{fmtRupiah(row['Net Sales'])}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'#ef4444' }}>{fmtRupiah(row['COGS'])}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'#f59e0b' }}>{fmtRupiah(row['Mkt Fee'])}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'#f59e0b' }}>{fmtRupiah(row['MP Fee'])}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color: row['GP After Mkt + Adm'] >= 0 ? '#06b6d4' : '#ef4444' }}>{fmtRupiah(row['GP After Mkt + Adm'])}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right' }}>
                    <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background: marginBg(row.nM), color: marginColor(row.nM) }}>{row.nM.toFixed(1)}%</span>
                  </td>
                </tr>
              ))}
              {/* TOTAL row */}
              <tr style={{ borderTop:'2px solid #1a2744', fontWeight:700 }}>
                <td style={{ padding:'10px 10px', position:'sticky', left:0, background:'#111a2e', zIndex:1, textTransform:'uppercase', fontSize:11, letterSpacing:'0.05em' }}>Total</td>
                <td style={{ padding:'10px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11 }}>{fmtRupiah(kpi.ts)}</td>
                <td style={{ padding:'10px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'#ef4444' }}>{fmtRupiah(kpi.tCogs)}</td>
                <td style={{ padding:'10px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'#f59e0b' }}>{fmtRupiah(kpi.tAds)}</td>
                <td style={{ padding:'10px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'#f59e0b' }}>{fmtRupiah(kpi.tMp)}</td>
                <td style={{ padding:'10px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color: kpi.tn >= 0 ? '#06b6d4' : '#ef4444' }}>{fmtRupiah(kpi.tn)}</td>
                <td style={{ padding:'10px 10px', textAlign:'right' }}>
                  <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background: marginBg(kpi.nM), color: marginColor(kpi.nM) }}>{kpi.nM.toFixed(1)}%</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div style={{ background:'#111a2e', border:'1px solid #1a2744', borderRadius:12, padding:16, overflowX:'auto' }}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>Ringkasan Per Produk</div>
        <div style={{ overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:900 }}>
          <thead><tr style={{ borderBottom:'2px solid #1a2744' }}>
            {['SKU','Net Sales','%','COGS','Mkt Fee','Admin Fee','GP After Mkt + Adm','Margin After Mkt','Mkt Ratio'].map(h => (
              <th key={h} style={{ padding:'8px 10px', textAlign:h==='SKU'?'left':'right', color:'#64748b', fontWeight:600, fontSize:10, textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {productTable.map(p => (
              <tr key={p.sku} style={{ borderBottom:'1px solid #1a2744' }}>
                <td style={{ padding:'8px 10px', fontWeight:600, whiteSpace:'nowrap' }}>
                  <span style={{ display:'inline-block', width:8, height:8, borderRadius:2, background: getBrandColor(p.sku, activeBrands) || PRODUCT_COLORS[p.sku] || '#64748b', marginRight:8, verticalAlign:'middle' }} />{p.sku}
                </td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11 }}>{fmtRupiah(p.sales)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right', color:'#64748b' }}>{p.sp.toFixed(1)}%</td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'#64748b' }}>{fmtRupiah(p.cogs)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'#f59e0b' }}>{fmtRupiah(p.adsFee)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'#64748b' }}>{fmtRupiah(p.mpFee)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:p.nam>=0?'#10b981':'#ef4444' }}>{fmtRupiah(p.nam)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right' }}>
                  <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background:p.gmpR>=30?'#064e3b':p.gmpR>=0?'#78350f':'#7f1d1d', color:p.gmpR>=30?'#10b981':p.gmpR>=0?'#f59e0b':'#ef4444' }}>{p.gmpR.toFixed(1)}%</span>
                </td>
                <td style={{ padding:'8px 10px', textAlign:'right' }}>
                  <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background:p.mktR>40?'#7f1d1d':p.mktR>25?'#78350f':'#064e3b', color:p.mktR>40?'#ef4444':p.mktR>25?'#f59e0b':'#10b981' }}>{p.mktR.toFixed(1)}%</span>
                </td>
              </tr>
            ))}
            {(() => {
              const tSales = productTable.reduce((a, p) => a + p.sales, 0);
              const tCogs = productTable.reduce((a, p) => a + p.cogs, 0);
              const tAds = productTable.reduce((a, p) => a + p.adsFee, 0);
              const tMp = productTable.reduce((a, p) => a + p.mpFee, 0);
              const tNam = productTable.reduce((a, p) => a + p.nam, 0);
              const tMc = tAds + tMp;
              const marginR = tSales > 0 ? tNam / tSales * 100 : 0;
              const mktR = tSales > 0 ? tMc / tSales * 100 : 0;
              return (
                <tr style={{ borderTop:'2px solid #1a2744' }}>
                  <td style={{ padding:'8px 10px', fontWeight:700, fontSize:12 }}>TOTAL</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700 }}>{fmtRupiah(tSales)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', color:'#64748b', fontWeight:700 }}>100%</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700, color:'#64748b' }}>{fmtRupiah(tCogs)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700, color:'#f59e0b' }}>{fmtRupiah(tAds)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700, color:'#64748b' }}>{fmtRupiah(tMp)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700, color:tNam>=0?'#10b981':'#ef4444' }}>{fmtRupiah(tNam)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right' }}>
                    <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background:marginR>=30?'#064e3b':marginR>=0?'#78350f':'#7f1d1d', color:marginR>=30?'#10b981':marginR>=0?'#f59e0b':'#ef4444' }}>{marginR.toFixed(1)}%</span>
                  </td>
                  <td style={{ padding:'8px 10px', textAlign:'right' }}>
                    <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background:mktR>40?'#7f1d1d':mktR>25?'#78350f':'#064e3b', color:mktR>40?'#ef4444':mktR>25?'#f59e0b':'#10b981' }}>{mktR.toFixed(1)}%</span>
                  </td>
                </tr>
              );
            })()}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
