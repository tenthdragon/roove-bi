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
const marginColor = (v: number) => v >= 30 ? 'var(--green)' : v >= 0 ? 'var(--yellow)' : 'var(--red)';
const marginBg = (v: number) => v >= 30 ? 'var(--badge-green-bg)' : v >= 0 ? 'var(--badge-yellow-bg)' : 'var(--badge-red-bg)';

export default function OverviewPage() {
  const supabase = useSupabase();
  const { dateRange, loading: dateLoading } = useDateRange();
  const [dailyData, setDailyData] = useState([]);
  const [overheadData, setOverheadData] = useState([]);
  const [shipmentData, setShipmentData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [prevDailyData, setPrevDailyData] = useState([]);
  const [prevOverheadData, setPrevOverheadData] = useState([]);
  const { activeBrands, isActiveBrand } = useActiveBrands();
  const [userRole, setUserRole] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showTren, setShowTren] = useState(false);

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
    } else {
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
    }
    // Fetch shipment counts
    supabase.rpc('get_daily_shipment_counts', { p_from: dateRange.from, p_to: dateRange.to })
      .then(({ data }) => setShipmentData(data || []));
    // Fetch overhead for months in range
    const fromYM = dateRange.from.slice(0, 7);
    const toYM = dateRange.to.slice(0, 7);
    supabase.from('monthly_overhead')
      .select('year_month, amount')
      .gte('year_month', fromYM)
      .lte('year_month', toYM)
      .then(({ data }) => setOverheadData(data || []));
  }, [dateRange, supabase]);

  // ── Fetch previous month data — same relative date range (MoM) ──
  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    const from = new Date(dateRange.from + 'T00:00:00');
    const to = new Date(dateRange.to + 'T00:00:00');
    const prevFrom_ = new Date(from.getFullYear(), from.getMonth() - 1, from.getDate());
    const prevTo_ = new Date(to.getFullYear(), to.getMonth() - 1, to.getDate());
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const prevFrom = fmt(prevFrom_);
    const prevTo = fmt(prevTo_);

    const cachedPrev = getCached('daily_product_summary_prev', prevFrom, prevTo);
    if (cachedPrev) {
      setPrevDailyData(cachedPrev.filter(row => isActiveBrand(row.product)));
    } else {
      supabase.from('daily_product_summary').select('*')
        .gte('date', prevFrom).lte('date', prevTo).order('date')
        .then(({ data: d }) => {
          const rows = d || [];
          setCache('daily_product_summary_prev', prevFrom, prevTo, rows);
          setPrevDailyData(rows.filter(row => isActiveBrand(row.product)));
        });
    }
    // Fetch prev month overhead
    const prevYM = prevFrom.slice(0, 7);
    const cachedOH = getCached('monthly_overhead_prev', prevYM, prevYM);
    if (cachedOH) {
      setPrevOverheadData(cachedOH);
    } else {
      supabase.from('monthly_overhead').select('year_month, amount')
        .eq('year_month', prevYM)
        .then(({ data }) => {
          const rows = data || [];
          setCache('monthly_overhead_prev', prevYM, prevYM, rows);
          setPrevOverheadData(rows);
        });
    }
  }, [dateRange, supabase]);

  const totalMpFee = useMemo(() => {
    return dailyData.reduce((a, d) => a + Math.abs(Number(d.mp_admin_cost) || 0), 0);
  }, [dailyData]);

  // Build overhead per-day lookup: date (YYYY-MM-DD) → daily overhead amount
  const overheadPerDay = useMemo(() => {
    const map = {};
    overheadData.forEach(o => {
      const [y, m] = o.year_month.split('-').map(Number);
      const days = new Date(y, m, 0).getDate();
      const daily = Number(o.amount) / days;
      // Pre-compute for each day in the month
      for (let d = 1; d <= days; d++) {
        const key = `${o.year_month}-${String(d).padStart(2, '0')}`;
        map[key] = daily;
      }
    });
    return map;
  }, [overheadData]);

  // Build shipment-per-day lookup
  const shipPerDay = useMemo(() => {
    const map: Record<string, number> = {};
    shipmentData.forEach((r: any) => {
      if (!isActiveBrand(r.product)) return;
      map[r.date] = (map[r.date] || 0) + Number(r.order_count);
    });
    return map;
  }, [shipmentData, activeBrands]);

  const kpi = useMemo(() => {
    // Build all dates in the selected range so days with only overhead/ads still appear
    const byDate: Record<string, { s:number; g:number; n:number; mp:number }> = {};
    if (dateRange.from && dateRange.to) {
      const cur = new Date(dateRange.from + 'T00:00:00');
      const end = new Date(dateRange.to + 'T00:00:00');
      while (cur <= end) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-${String(cur.getDate()).padStart(2,'0')}`;
        byDate[key] = { s:0, g:0, n:0, mp:0 };
        cur.setDate(cur.getDate() + 1);
      }
    }
    dailyData.forEach(d => {
      if (!byDate[d.date]) return; // skip dates outside selected range
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
    const hasOverhead = overheadData.length > 0;
    const chart = dates.map(d => {
      const totalMkt = byDate[d].g - byDate[d].n;
      const mpFee = byDate[d].mp;
      const adsFee = totalMkt - mpFee;
      const cogs = byDate[d].s - byDate[d].g;
      const overhead = overheadPerDay[d] || 0;
      const estNetProfit = byDate[d].n - overhead;
      const gpM = byDate[d].s > 0 ? byDate[d].g / byDate[d].s * 100 : 0;
      const nM = byDate[d].s > 0 ? byDate[d].n / byDate[d].s * 100 : 0;
      const npM = byDate[d].s > 0 ? estNetProfit / byDate[d].s * 100 : 0;
      return {
        date: shortDate(d),
        rawDate: d,
        shipment: shipPerDay[d] || 0,
        'Net Sales': byDate[d].s,
        'Gross Profit': byDate[d].g,
        'COGS': cogs,
        'GP After Mkt + Adm': byDate[d].n,
        'Mkt Fee': adsFee,
        'MP Fee': mpFee,
        'Overhead': overhead,
        'Est. Net Profit': estNetProfit,
        gpM, nM, npM,
      };
    });
    const tShipment = chart.reduce((a,r) => a + r.shipment, 0);
    const tMp = dates.reduce((a,d) => a + byDate[d].mp, 0);
    const tAds = tm - tMp;
    const tCogs = ts - tg;
    const tOverhead = chart.reduce((a,r) => a + r['Overhead'], 0);
    const tNetProfit = tn - tOverhead;
    const npM = ts > 0 ? tNetProfit / ts * 100 : 0;
    return { ts, tg, tn, tm, tMp, tAds, tCogs, tOverhead, tNetProfit, tShipment, npM, hasOverhead, ad, chart, gpM: ts>0?tg/ts*100:0, nM: ts>0?tn/ts*100:0, mR: ts>0?tm/ts*100:0, avg: ad>0?ts/ad:0 };
  }, [dailyData, overheadPerDay, overheadData, shipPerDay, dateRange]);

  // ── Previous month KPIs (for delta comparison) ──
  const prevKpi = useMemo(() => {
    if (prevDailyData.length === 0) return null;
    const byDate = {};
    prevDailyData.forEach(d => {
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
    return { ts, tg, tn, tm, gpM: ts>0?tg/ts*100:0, nM: ts>0?tn/ts*100:0 };
  }, [prevDailyData]);

  const prevMonthLabel = useMemo(() => {
    if (!dateRange.from) return '';
    const fromDate = new Date(dateRange.from + 'T00:00:00');
    const prevMonth = new Date(fromDate.getFullYear(), fromDate.getMonth() - 1, 1);
    return prevMonth.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
  }, [dateRange.from]);

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

  const DeltaLine = ({ value, suffix, higherIsBetter, label: lbl }: { value: number; suffix?: string; higherIsBetter?: boolean; label?: string }) => (
    <div style={{ fontSize: 10, marginTop: 4, color: ((value > 0) === (higherIsBetter !== false)) ? '#5b8a7a' : '#9b6b6b' }}>
      {value > 0 ? '▲' : '▼'} {value >= 0 ? '+' : ''}{value.toFixed(1)}{suffix || '%'}{lbl ? ` ${lbl}` : ` vs ${prevMonthLabel}`}
    </div>
  );
  const KPI = ({ label, val, sub, color='var(--accent)', delta, delta2 }: { label: string; val: string; sub?: string; color?: string; delta?: { value: number; suffix?: string; higherIsBetter?: boolean; label?: string }; delta2?: { value: number; suffix?: string; higherIsBetter?: boolean; label?: string } }) => (
    <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:'16px 18px', flex:'1 1 160px', minWidth:150, position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:color }} />
      <div style={{ fontSize:11, color:'var(--dim)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6, fontWeight:600 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, fontFamily:'monospace', lineHeight:1.1 }}>{val}</div>
      {sub && <div style={{ fontSize:11, color:'var(--dim)', marginTop:4 }}>{sub}</div>}
      {delta && delta.value !== 0 && <DeltaLine {...delta} />}
      {delta2 && delta2.value !== 0 && <DeltaLine {...delta2} />}
    </div>
  );

  if (dateLoading || (loading && dailyData.length === 0)) {
    return (
      <div style={{ textAlign:'center', padding:60, color:'var(--dim)' }}>
        <div className="spinner" style={{ width:32, height:32, border:'3px solid var(--border)', borderTop:'3px solid var(--accent)', borderRadius:'50%', margin:'0 auto 12px' }} />
        <div>Memuat data...</div>
      </div>
    );
  }

  if (dailyData.length === 0 && !loading) {
    return (
      <div className="fade-in">
        <h2 style={{ margin:'0 0 16px', fontSize:18, fontWeight:700 }}>Overview</h2>
        <div style={{ textAlign:'center', padding:60, color:'var(--dim)', background:'var(--card)', border:'1px solid var(--border)', borderRadius:12 }}>
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
        <div><h2 style={{ margin:0, fontSize:18, fontWeight:700 }}>Overview</h2><div style={{ fontSize:12, color:'var(--dim)' }}>{kpi.ad} active days</div></div>
      </div>

      {/* ── KPI Cards ── */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:20 }}>
        <KPI label="Net Sales" val={`Rp ${fmtCompact(kpi.ts)}`} sub={`Avg: ${fmtRupiah(kpi.avg)}/hari`}
          delta={prevKpi && prevKpi.ts > 0 ? { value: ((kpi.ts - prevKpi.ts) / prevKpi.ts) * 100 } : undefined} />
        <KPI label="Gross Profit" val={`Rp ${fmtCompact(kpi.tg)}`} sub={`GP Margin: ${kpi.gpM.toFixed(1)}%`} color="var(--green)"
          delta={prevKpi && prevKpi.tg > 0 ? { value: ((kpi.tg - prevKpi.tg) / prevKpi.tg) * 100 } : undefined}
          delta2={prevKpi && prevKpi.gpM > 0 ? { value: kpi.gpM - prevKpi.gpM, suffix: 'pp', label: 'margin' } : undefined} />
        <KPI label="Mkt Cost + MP Fee" val={`Rp ${fmtCompact(kpi.tm)}`} sub={totalMpFee > 0 ? `MP Fee: Rp ${fmtCompact(totalMpFee)} (${mpFeePercent.toFixed(1)}%)` : 'MP Fee: tidak tersedia'} color="var(--yellow)"
          delta={prevKpi && prevKpi.tm > 0 ? { value: ((kpi.tm - prevKpi.tm) / prevKpi.tm) * 100, higherIsBetter: false } : undefined} />
        <KPI label="GP After Mkt + Adm" val={`Rp ${fmtCompact(kpi.tn)}`} sub={`Margin After Mkt: ${kpi.nM.toFixed(1)}%`} color="#06b6d4"
          delta={prevKpi && prevKpi.tn > 0 ? { value: ((kpi.tn - prevKpi.tn) / prevKpi.tn) * 100 } : undefined}
          delta2={prevKpi && prevKpi.nM > 0 ? { value: kpi.nM - prevKpi.nM, suffix: 'pp', label: 'margin' } : undefined} />
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
        <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:16, marginBottom:20, overflowX:'auto' }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom: showTren ? 12 : 0, display:'flex', alignItems:'center', gap:10, cursor:'pointer' }} onClick={() => setShowTren(v => !v)}>
            <span style={{ transition:'transform 0.2s', display:'inline-block', transform: showTren ? 'rotate(90deg)' : 'rotate(0deg)', fontSize:10, color:'var(--dim)' }}>&#9654;</span>
            Tren Harian
            {showTren && (
              <button onClick={e => { e.stopPropagation(); setShowDetail(v => !v); }} style={{ background:'none', border:'1px solid var(--border)', borderRadius:6, padding:'2px 8px', cursor:'pointer', fontSize:10, color: showDetail ? '#a78bfa' : 'var(--dim)', display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ transition:'transform 0.2s', display:'inline-block', transform: showDetail ? 'rotate(90deg)' : 'rotate(0deg)', fontSize:8 }}>&#9654;</span>
                Detail
              </button>
            )}
          </div>
          {showTren && <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth: showDetail ? (kpi.hasOverhead ? 1100 : 920) : 820 }}>
            <thead>
              <tr style={{ borderBottom:'2px solid var(--border)' }}>
                <th style={{ padding:'8px 10px', textAlign:'left', color:'var(--dim)', fontWeight:600, fontSize:10, textTransform:'uppercase', position:'sticky', left:0, background:'var(--card)', zIndex:1 }}>Tanggal</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--dim)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Shipment</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--accent)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Net Sales</th>
                {showDetail && <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--red)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>COGS</th>}
                <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--yellow)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Mkt Fee</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--yellow)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>MP Fee</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'#06b6d4', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>GP After Mkt + Adm</th>
                {kpi.hasOverhead && showDetail && <th style={{ padding:'8px 10px', textAlign:'right', color:'#a78bfa', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Overhead</th>}
                {kpi.hasOverhead && <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--green)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Est. Net Profit</th>}
              </tr>
            </thead>
            <tbody>
              {kpi.chart.map((row, i) => (
                <tr key={i} style={{ borderBottom:'1px solid var(--bg-deep)' }}>
                  <td style={{ padding:'8px 10px', fontWeight:600, whiteSpace:'nowrap', position:'sticky', left:0, background:'var(--card)', zIndex:1 }}>{row.date}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'var(--text-secondary)' }}>{row.shipment > 0 ? row.shipment.toLocaleString('id-ID') : '—'}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11 }}>{fmtRupiah(row['Net Sales'])}</td>
                  {showDetail && <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'var(--red)' }}>{fmtRupiah(row['COGS'])}</td>}
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'var(--yellow)' }}>{fmtRupiah(row['Mkt Fee'])}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'var(--yellow)' }}>{fmtRupiah(row['MP Fee'])}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color: row['GP After Mkt + Adm'] >= 0 ? '#06b6d4' : 'var(--red)' }}>{fmtRupiah(row['GP After Mkt + Adm'])}</td>
                  {kpi.hasOverhead && showDetail && <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'#a78bfa' }}>{fmtRupiah(row['Overhead'])}</td>}
                  {kpi.hasOverhead && <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color: row['Est. Net Profit'] >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtRupiah(row['Est. Net Profit'])}</td>}
                </tr>
              ))}
              {/* TOTAL row with % of net sales */}
              <tr style={{ borderTop:'2px solid var(--border)', fontWeight:700 }}>
                <td style={{ padding:'10px 10px', position:'sticky', left:0, background:'var(--card)', zIndex:1, textTransform:'uppercase', fontSize:11, letterSpacing:'0.05em' }}>Total</td>
                <td style={{ padding:'10px 10px', textAlign:'right' }}>
                  <div style={{ fontFamily:'monospace', fontSize:11, color:'var(--text-secondary)' }}>{kpi.tShipment.toLocaleString('id-ID')}</div>
                </td>
                <td style={{ padding:'10px 10px', textAlign:'right' }}>
                  <div style={{ fontFamily:'monospace', fontSize:11 }}>{fmtRupiah(kpi.ts)}</div>
                  <div style={{ fontSize:9, color:'var(--dim)', marginTop:2 }}>100%</div>
                </td>
                {showDetail && (
                  <td style={{ padding:'10px 10px', textAlign:'right' }}>
                    <div style={{ fontFamily:'monospace', fontSize:11, color:'var(--red)' }}>{fmtRupiah(kpi.tCogs)}</div>
                    <div style={{ fontSize:9, color:'var(--dim)', marginTop:2 }}>{kpi.ts > 0 ? (kpi.tCogs / kpi.ts * 100).toFixed(1) : 0}%</div>
                  </td>
                )}
                <td style={{ padding:'10px 10px', textAlign:'right' }}>
                  <div style={{ fontFamily:'monospace', fontSize:11, color:'var(--yellow)' }}>{fmtRupiah(kpi.tAds)}</div>
                  <div style={{ fontSize:9, color:'var(--dim)', marginTop:2 }}>{kpi.ts > 0 ? (kpi.tAds / kpi.ts * 100).toFixed(1) : 0}%</div>
                </td>
                <td style={{ padding:'10px 10px', textAlign:'right' }}>
                  <div style={{ fontFamily:'monospace', fontSize:11, color:'var(--yellow)' }}>{fmtRupiah(kpi.tMp)}</div>
                  <div style={{ fontSize:9, color:'var(--dim)', marginTop:2 }}>{kpi.ts > 0 ? (kpi.tMp / kpi.ts * 100).toFixed(1) : 0}%</div>
                </td>
                <td style={{ padding:'10px 10px', textAlign:'right' }}>
                  <div style={{ fontFamily:'monospace', fontSize:11, color: kpi.tn >= 0 ? '#06b6d4' : 'var(--red)' }}>{fmtRupiah(kpi.tn)}</div>
                  <div style={{ fontSize:9, color:'var(--dim)', marginTop:2 }}>{kpi.ts > 0 ? (kpi.tn / kpi.ts * 100).toFixed(1) : 0}%</div>
                </td>
                {kpi.hasOverhead && showDetail && (
                  <td style={{ padding:'10px 10px', textAlign:'right' }}>
                    <div style={{ fontFamily:'monospace', fontSize:11, color:'#a78bfa' }}>{fmtRupiah(kpi.tOverhead)}</div>
                    <div style={{ fontSize:9, color:'var(--dim)', marginTop:2 }}>{kpi.ts > 0 ? (kpi.tOverhead / kpi.ts * 100).toFixed(1) : 0}%</div>
                  </td>
                )}
                {kpi.hasOverhead && (
                  <td style={{ padding:'10px 10px', textAlign:'right' }}>
                    <div style={{ fontFamily:'monospace', fontSize:11, color: kpi.tNetProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtRupiah(kpi.tNetProfit)}</div>
                    <div style={{ fontSize:9, marginTop:2 }}><span style={{ padding:'1px 5px', borderRadius:4, fontWeight:700, background: marginBg(kpi.npM), color: marginColor(kpi.npM) }}>{kpi.npM.toFixed(1)}%</span></div>
                  </td>
                )}
              </tr>
            </tbody>
          </table>}
        </div>
      )}

      <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:16, overflowX:'auto' }}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:12 }}>Ringkasan Per Produk</div>
        <div style={{ overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:900 }}>
          <thead><tr style={{ borderBottom:'2px solid var(--border)' }}>
            {['SKU','Net Sales','%','COGS','Mkt Fee','Admin Fee','GP After Mkt + Adm','Margin After Mkt','Mkt Ratio'].map(h => (
              <th key={h} style={{ padding:'8px 10px', textAlign:h==='SKU'?'left':'right', color:'var(--dim)', fontWeight:600, fontSize:10, textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {productTable.map(p => (
              <tr key={p.sku} style={{ borderBottom:'1px solid var(--border)' }}>
                <td style={{ padding:'8px 10px', fontWeight:600, whiteSpace:'nowrap' }}>
                  <span style={{ display:'inline-block', width:8, height:8, borderRadius:2, background: getBrandColor(p.sku, activeBrands) || PRODUCT_COLORS[p.sku] || 'var(--dim)', marginRight:8, verticalAlign:'middle' }} />{p.sku}
                </td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11 }}>{fmtRupiah(p.sales)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right', color:'var(--dim)' }}>{p.sp.toFixed(1)}%</td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'var(--dim)' }}>{fmtRupiah(p.cogs)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'var(--yellow)' }}>{fmtRupiah(p.adsFee)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'var(--dim)' }}>{fmtRupiah(p.mpFee)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:p.nam>=0?'var(--green)':'var(--red)' }}>{fmtRupiah(p.nam)}</td>
                <td style={{ padding:'8px 10px', textAlign:'right' }}>
                  <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background:p.gmpR>=30?'var(--badge-green-bg)':p.gmpR>=0?'var(--badge-yellow-bg)':'var(--badge-red-bg)', color:p.gmpR>=30?'var(--green)':p.gmpR>=0?'var(--yellow)':'var(--red)' }}>{p.gmpR.toFixed(1)}%</span>
                </td>
                <td style={{ padding:'8px 10px', textAlign:'right' }}>
                  <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background:p.mktR>40?'var(--badge-red-bg)':p.mktR>25?'var(--badge-yellow-bg)':'var(--badge-green-bg)', color:p.mktR>40?'var(--red)':p.mktR>25?'var(--yellow)':'var(--green)' }}>{p.mktR.toFixed(1)}%</span>
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
                <tr style={{ borderTop:'2px solid var(--border)' }}>
                  <td style={{ padding:'8px 10px', fontWeight:700, fontSize:12 }}>TOTAL</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700 }}>{fmtRupiah(tSales)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', color:'var(--dim)', fontWeight:700 }}>100%</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700, color:'var(--dim)' }}>{fmtRupiah(tCogs)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700, color:'var(--yellow)' }}>{fmtRupiah(tAds)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700, color:'var(--dim)' }}>{fmtRupiah(tMp)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700, color:tNam>=0?'var(--green)':'var(--red)' }}>{fmtRupiah(tNam)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right' }}>
                    <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background:marginR>=30?'var(--badge-green-bg)':marginR>=0?'var(--badge-yellow-bg)':'var(--badge-red-bg)', color:marginR>=30?'var(--green)':marginR>=0?'var(--yellow)':'var(--red)' }}>{marginR.toFixed(1)}%</span>
                  </td>
                  <td style={{ padding:'8px 10px', textAlign:'right' }}>
                    <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background:mktR>40?'var(--badge-red-bg)':mktR>25?'var(--badge-yellow-bg)':'var(--badge-green-bg)', color:mktR>40?'var(--red)':mktR>25?'var(--yellow)':'var(--green)' }}>{mktR.toFixed(1)}%</span>
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
