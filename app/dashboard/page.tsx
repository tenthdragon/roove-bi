// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSupabase } from '@/lib/supabase-browser';
import { useDateRange } from '@/lib/DateRangeContext';
import { getCached, setCache } from '@/lib/dashboard-cache';
import { getOverviewCoreData, getOverviewFeeData } from '@/lib/overview-actions';
// Recharts removed — daily trend is now a table
import { useActiveBrands } from '@/lib/ActiveBrandsContext';
import { fmtCompact, fmtRupiah, shortDate, PRODUCT_COLORS, getBrandColor } from '@/lib/utils';
import CashFlowSection from '@/components/CashFlowSection';

// Daily trend color coding for margin
const marginColor = (v: number) => v >= 30 ? 'var(--green)' : v >= 0 ? 'var(--yellow)' : 'var(--red)';
const marginBg = (v: number) => v >= 30 ? 'var(--badge-green-bg)' : v >= 0 ? 'var(--badge-yellow-bg)' : 'var(--badge-red-bg)';

function formatIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftIsoDateByMonthsClamped(value: string, deltaMonths: number) {
  const [year, month, day] = value.split('-').map(Number);
  const totalMonths = year * 12 + (month - 1) + deltaMonths;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = ((totalMonths % 12) + 12) % 12;
  const targetMonth = targetMonthIndex + 1;
  const targetDay = Math.min(day, getDaysInMonth(targetYear, targetMonth));
  return formatIsoDate(targetYear, targetMonth, targetDay);
}

function getDateKeysInRange(from: string, to: string) {
  if (!from || !to) return [];

  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const keys: string[] = [];

  while (cursor <= end) {
    keys.push(formatIsoDate(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth() + 1,
      cursor.getUTCDate()
    ));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

function buildOverheadPerDayLookup(rows: Array<{ year_month: string; amount: number | string }>) {
  const map: Record<string, number> = {};

  rows.forEach((row) => {
    if (!row?.year_month) return;

    const [year, month] = row.year_month.split('-').map(Number);
    const days = getDaysInMonth(year, month);
    const dailyAmount = Number(row.amount || 0) / days;

    for (let day = 1; day <= days; day++) {
      map[formatIsoDate(year, month, day)] = dailyAmount;
    }
  });

  return map;
}

export default function OverviewPage() {
  const supabase = useSupabase();
  const { dateRange, loading: dateLoading } = useDateRange();
  const [dailyData, setDailyData] = useState([]);
  const [overheadData, setOverheadData] = useState([]);
  const [shipmentData, setShipmentData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [prevDailyData, setPrevDailyData] = useState([]);
  const [prevOverheadData, setPrevOverheadData] = useState([]);
  const [adsData, setAdsData] = useState<any[]>([]);
  const [channelData, setChannelData] = useState<any[]>([]);
  const [shippingData, setShippingData] = useState<any[]>([]);
  const [prevAdsData, setPrevAdsData] = useState<any[]>([]);
  const [prevChannelData, setPrevChannelData] = useState<any[]>([]);
  const [prevShippingData, setPrevShippingData] = useState<any[]>([]);
  const [feeLoading, setFeeLoading] = useState(true);
  const [feeError, setFeeError] = useState('');
  const [shippingError, setShippingError] = useState('');
  const [prevShippingError, setPrevShippingError] = useState('');
  const { activeBrands, error: activeBrandsError, isActiveBrand } = useActiveBrands();
  const [userRole, setUserRole] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [showTren, setShowTren] = useState(false);

  function getPrevRange(from: string, to: string) {
    return {
      prevFrom: shiftIsoDateByMonthsClamped(from, -1),
      prevTo: shiftIsoDateByMonthsClamped(to, -1),
    };
  }

  const prevRange = useMemo(() => {
    if (!dateRange.from || !dateRange.to) return null;
    return getPrevRange(dateRange.from, dateRange.to);
  }, [dateRange.from, dateRange.to]);

  const rangeDates = useMemo(
    () => getDateKeysInRange(dateRange.from, dateRange.to),
    [dateRange.from, dateRange.to]
  );

  const prevRangeDates = useMemo(
    () => prevRange ? getDateKeysInRange(prevRange.prevFrom, prevRange.prevTo) : [],
    [prevRange]
  );

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase.from('profiles').select('role').eq('id', user.id).single()
          .then(({ data }) => setUserRole(data?.role || null));
      }
    });
  }, [supabase]);

  useEffect(() => {
    if (!dateRange.from || !dateRange.to || !prevRange) return;
    const { prevFrom, prevTo } = prevRange;
    const cached = getCached<any>('overview_core_data', dateRange.from, dateRange.to, `${prevFrom}|${prevTo}`);
    if (cached) {
      setDailyData(cached.daily.filter(row => isActiveBrand(row.product)));
      setShipmentData(cached.shipment || []);
      setOverheadData(cached.overhead || []);
      setPrevDailyData(cached.prevDaily.filter(row => isActiveBrand(row.product)));
      setPrevOverheadData(cached.prevOverhead || []);
      setLoadError('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError('');

    getOverviewCoreData({
      from: dateRange.from,
      to: dateRange.to,
      prevFrom,
      prevTo,
    })
      .then((data) => {
        if (cancelled) return;
        setCache('overview_core_data', dateRange.from, dateRange.to, data, `${prevFrom}|${prevTo}`);
        setDailyData(data.daily.filter(row => isActiveBrand(row.product)));
        setShipmentData(data.shipment || []);
        setOverheadData(data.overhead || []);
        setPrevDailyData(data.prevDaily.filter(row => isActiveBrand(row.product)));
        setPrevOverheadData(data.prevOverhead || []);
        setLoadError('');
        setLoading(false);
      })
      .catch((e: any) => {
        if (cancelled) return;
        console.error('[Overview] core load error:', e);
        setLoadError(e?.message || 'Gagal memuat data Overview.');
        setDailyData([]);
        setShipmentData([]);
        setOverheadData([]);
        setPrevDailyData([]);
        setPrevOverheadData([]);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [dateRange.from, dateRange.to, prevRange, activeBrands, activeBrandsError, isActiveBrand]);

  useEffect(() => {
    if (!dateRange.from || !dateRange.to || !prevRange) return;
    const { prevFrom, prevTo } = prevRange;

    const cachedAds = getCached<any[]>('overview_ads_spend_v2', dateRange.from, dateRange.to);
    const cachedCh = getCached<any[]>('overview_channel_data_v2', dateRange.from, dateRange.to);
    const cachedShipping = getCached<any[]>('overview_shipping_charge_data_v4', dateRange.from, dateRange.to);
    const cachedShippingError = getCached<string>('overview_shipping_charge_error_v4', dateRange.from, dateRange.to) || '';
    const cachedPrevAds = getCached<any[]>('overview_ads_spend_prev_v2', prevFrom, prevTo);
    const cachedPrevCh = getCached<any[]>('overview_channel_data_prev_v2', prevFrom, prevTo);
    const cachedPrevShipping = getCached<any[]>('overview_shipping_charge_data_prev_v4', prevFrom, prevTo);
    const cachedPrevShippingError = getCached<string>('overview_shipping_charge_prev_error_v4', prevFrom, prevTo) || '';

    if (cachedAds && cachedCh && cachedShipping && cachedPrevAds && cachedPrevCh && cachedPrevShipping) {
      setAdsData(cachedAds);
      setChannelData(cachedCh);
      setShippingData(cachedShipping.filter(row => isActiveBrand(row.product)));
      setPrevAdsData(cachedPrevAds);
      setPrevChannelData(cachedPrevCh);
      setPrevShippingData(cachedPrevShipping.filter(row => isActiveBrand(row.product)));
      setFeeError('');
      setShippingError(cachedShippingError);
      setPrevShippingError(cachedPrevShippingError);
      setFeeLoading(false);
      return;
    }

    let cancelled = false;
    setFeeLoading(true);
    setFeeError('');

    getOverviewFeeData({
      from: dateRange.from,
      to: dateRange.to,
      prevFrom,
      prevTo,
    })
      .then((data) => {
        if (cancelled) return;
        setCache('overview_ads_spend_v2', dateRange.from, dateRange.to, data.ads);
        setCache('overview_channel_data_v2', dateRange.from, dateRange.to, data.channel);
        setCache('overview_shipping_charge_data_v4', dateRange.from, dateRange.to, data.shipping);
        setCache('overview_shipping_charge_error_v4', dateRange.from, dateRange.to, data.shippingError || '');
        setCache('overview_ads_spend_prev_v2', prevFrom, prevTo, data.prevAds);
        setCache('overview_channel_data_prev_v2', prevFrom, prevTo, data.prevChannel);
        setCache('overview_shipping_charge_data_prev_v4', prevFrom, prevTo, data.prevShipping);
        setCache('overview_shipping_charge_prev_error_v4', prevFrom, prevTo, data.prevShippingError || '');
        setAdsData(data.ads);
        setChannelData(data.channel);
        setShippingData(data.shipping.filter(row => isActiveBrand(row.product)));
        setPrevAdsData(data.prevAds);
        setPrevChannelData(data.prevChannel);
        setPrevShippingData(data.prevShipping.filter(row => isActiveBrand(row.product)));
        setFeeError('');
        setShippingError(data.shippingError || '');
        setPrevShippingError(data.prevShippingError || '');
        setFeeLoading(false);
      })
      .catch((e: any) => {
        if (cancelled) return;
        console.error('[Overview] fee load error:', e);
        setFeeError(e?.message || 'Gagal memuat biaya marketing Overview.');
        setAdsData([]);
        setChannelData([]);
        setShippingData([]);
        setPrevAdsData([]);
        setPrevChannelData([]);
        setPrevShippingData([]);
        setFeeLoading(false);
        setShippingError('');
        setPrevShippingError('');
      });

    return () => { cancelled = true; };
  }, [dateRange.from, dateRange.to, prevRange, activeBrands, activeBrandsError, isActiveBrand]);

  // Build overhead per-day lookup: date (YYYY-MM-DD) → daily overhead amount
  const overheadPerDay = useMemo(() => {
    return buildOverheadPerDayLookup(overheadData);
  }, [overheadData]);

  const prevOverheadPerDay = useMemo(() => {
    return buildOverheadPerDayLookup(prevOverheadData);
  }, [prevOverheadData]);

  // Build shipment-per-day lookup
  const shipPerDay = useMemo(() => {
    const map: Record<string, number> = {};
    shipmentData.forEach((r: any) => {
      if (!isActiveBrand(r.product)) return;
      map[r.date] = (map[r.date] || 0) + Number(r.order_count);
    });
    return map;
  }, [shipmentData, activeBrands, activeBrandsError, isActiveBrand]);

  // Build per-day ads spend lookup (from daily_ads_spend — matches marketing page)
  const adsByDate = useMemo(() => {
    const map: Record<string, number> = {};
    adsData.forEach(d => { map[d.date] = (map[d.date] || 0) + Math.abs(Number(d.spent || 0)); });
    return map;
  }, [adsData]);

  // Build per-day MP fee lookup (from daily_channel_data — matches channels page)
  const mpByDate = useMemo(() => {
    const map: Record<string, number> = {};
    channelData.forEach(d => {
      if (!isActiveBrand(d.product)) return;
      map[d.date] = (map[d.date] || 0) + Math.abs(Number(d.mp_admin_cost) || 0);
    });
    return map;
  }, [channelData, activeBrands, activeBrandsError, isActiveBrand]);

  const shippingByDate = useMemo(() => {
    const map: Record<string, number> = {};
    shippingData.forEach(d => {
      if (!isActiveBrand(d.product)) return;
      map[d.date] = (map[d.date] || 0) + Number(d.shipping_charge || 0);
    });
    return map;
  }, [shippingData, activeBrands, activeBrandsError, isActiveBrand]);

  const kpi = useMemo(() => {
    // Build all dates in the selected range so days with only overhead/ads still appear
    const byDate: Record<string, { s:number; g:number }> = {};
    rangeDates.forEach((dateKey) => {
      byDate[dateKey] = { s: 0, g: 0 };
    });
    dailyData.forEach(d => {
      if (!byDate[d.date]) return;
      byDate[d.date].s += Number(d.net_sales);
      byDate[d.date].g += Number(d.gross_profit);
    });
    const dates = rangeDates;
    const ts = dates.reduce((a,d) => a + byDate[d].s, 0);
    const tg = dates.reduce((a,d) => a + byDate[d].g, 0);
    const tCogs = ts - tg;
    // Explicit totals from dedicated tables
    const tAds = adsData.reduce((s, d) => s + Math.abs(Number(d.spent || 0)), 0);
    const tMp = channelData.filter(d => isActiveBrand(d.product)).reduce((s, d) => s + Math.abs(Number(d.mp_admin_cost) || 0), 0);
    const tShipping = shippingData.reduce((s, d) => s + Number(d.shipping_charge || 0), 0);
    const ad = dates.filter(d => byDate[d].s > 0).length;
    const hasOverhead = overheadData.length > 0;
    const tOverheadRaw = dates.reduce((a, d) => a + (overheadPerDay[d] || 0), 0);
    const tNetProfit = tg - tAds - tMp - tShipping - tOverheadRaw;
    const npM = ts > 0 ? tNetProfit / ts * 100 : 0;
    const chart = dates.map(d => {
      const adsFee = adsByDate[d] || 0;
      const mpFee = mpByDate[d] || 0;
      const shippingFee = shippingByDate[d] || 0;
      const cogs = byDate[d].s - byDate[d].g;
      const overhead = overheadPerDay[d] || 0;
      const estNetProfit = byDate[d].g - adsFee - mpFee - shippingFee - overhead;
      const gpM = byDate[d].s > 0 ? byDate[d].g / byDate[d].s * 100 : 0;
      const npMd = byDate[d].s > 0 ? estNetProfit / byDate[d].s * 100 : 0;
      return {
        date: shortDate(d),
        rawDate: d,
        shipment: shipPerDay[d] || 0,
        'Net Sales': byDate[d].s,
        'Gross Profit': byDate[d].g,
        'COGS': cogs,
        'Mkt Fee': adsFee,
        'MP Fee': mpFee,
        'Shipping Fee': shippingFee,
        'Overhead': overhead,
        'Net Profit': estNetProfit,
        gpM, npM: npMd,
      };
    });
    const tShipment = chart.reduce((a,r) => a + r.shipment, 0);
    return { ts, tg, tCogs, tAds, tMp, tShipping, tOverhead: tOverheadRaw, tNetProfit, tShipment, npM, hasOverhead, ad, chart, gpM: ts>0?tg/ts*100:0, mR: ts>0?(tAds+tMp)/ts*100:0, avg: ad>0?ts/ad:0 };
  }, [dailyData, adsData, channelData, shippingData, overheadPerDay, overheadData, shipPerDay, rangeDates, adsByDate, mpByDate, shippingByDate, activeBrands, activeBrandsError, isActiveBrand]);

  // ── Previous month KPIs (for delta comparison) ──
  const prevKpi = useMemo(() => {
    if (prevDailyData.length === 0) return null;
    let ts = 0, tg = 0;
    prevDailyData.forEach(d => { ts += Number(d.net_sales); tg += Number(d.gross_profit); });
    const tAds = prevAdsData.reduce((s, d) => s + Math.abs(Number(d.spent || 0)), 0);
    const tMp = prevChannelData.filter(d => isActiveBrand(d.product)).reduce((s, d) => s + Math.abs(Number(d.mp_admin_cost) || 0), 0);
    const tShipping = prevShippingData.reduce((s, d) => s + Number(d.shipping_charge || 0), 0);
    const prevOH = prevRangeDates.reduce((sum, dateKey) => sum + (prevOverheadPerDay[dateKey] || 0), 0);
    const tNetProfit = tg - tAds - tMp - tShipping - prevOH;
    return { ts, tg, tAds, tMp, tShipping, tNetProfit, gpM: ts>0?tg/ts*100:0, npM: ts>0?tNetProfit/ts*100:0 };
  }, [prevDailyData, prevAdsData, prevChannelData, prevShippingData, prevRangeDates, prevOverheadPerDay, activeBrands, activeBrandsError, isActiveBrand]);

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

  const supportsCashFlowOverview = useMemo(() => {
    if (!dateRange.from || !dateRange.to) return false;
    return dateRange.from.slice(0, 7) === dateRange.to.slice(0, 7) && dateRange.from.endsWith('-01');
  }, [dateRange.from, dateRange.to]);

  const cashFlowPeriodStart = useMemo(() => {
    if (!supportsCashFlowOverview || !dateRange.from) return null;
    const [y, m] = dateRange.from.split('-');
    return `${y}-${m}-01`;
  }, [dateRange.from, supportsCashFlowOverview]);

  const isOwnerOrAdmin = userRole === 'owner' || userRole === 'admin';

  const DeltaLine = ({ value, suffix, higherIsBetter, label: lbl }: { value: number; suffix?: string; higherIsBetter?: boolean; label?: string }) => (
    <div style={{ fontSize: 10, marginTop: 4, color: ((value > 0) === (higherIsBetter !== false)) ? '#5b8a7a' : '#9b6b6b' }}>
      {value > 0 ? '▲' : '▼'} {value >= 0 ? '+' : ''}{value.toFixed(1)}{suffix || '%'}{lbl ? ` ${lbl}` : ` vs ${prevMonthLabel}`}
    </div>
  );
  const KPI = ({ label, val, sub, color='var(--accent)', delta, delta2 }: { label: string; val: string; sub?: string; color?: string; delta?: { value: number; suffix?: string; higherIsBetter?: boolean; label?: string }; delta2?: { value: number; suffix?: string; higherIsBetter?: boolean; label?: string } }) => (
    <div style={{ background:'var(--card)', border:'1px solid var(--border)', borderRadius:12, padding:'16px 18px', flex:'1 1 160px', minWidth:150, maxWidth:320, position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:3, background:color }} />
      <div style={{ fontSize:11, color:'var(--dim)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6, fontWeight:600 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, fontFamily:'monospace', lineHeight:1.1 }}>{val}</div>
      {sub && <div style={{ fontSize:11, color:'var(--dim)', marginTop:4 }}>{sub}</div>}
      {delta && delta.value !== 0 && <DeltaLine {...delta} />}
      {delta2 && delta2.value !== 0 && <DeltaLine {...delta2} />}
    </div>
  );

  if (dateLoading || loading || feeLoading) {
    return (
      <div style={{ textAlign:'center', padding:60, color:'var(--dim)' }}>
        <div className="spinner" style={{ width:32, height:32, border:'3px solid var(--border)', borderTop:'3px solid var(--accent)', borderRadius:'50%', margin:'0 auto 12px' }} />
        <div>Memuat data...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ background: 'rgba(127,29,29,0.15)', border: '1px solid #991b1b', borderRadius: 12, padding: 18, color: '#fca5a5' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Overview Gagal Dimuat</div>
          <div style={{ fontSize: 13 }}>{loadError}</div>
        </div>
      </div>
    );
  }

  if (activeBrandsError) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ background: 'rgba(120,53,15,0.12)', border: '1px solid rgba(146,64,14,0.45)', borderRadius: 12, padding: 18, color: '#fcd34d' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Filter Brand Gagal Dimuat</div>
          <div style={{ fontSize: 13 }}>{activeBrandsError}</div>
        </div>
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

      {feeError && (
        <div style={{ background:'rgba(120,53,15,0.12)', border:'1px solid rgba(146,64,14,0.45)', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:12, color:'#fcd34d' }}>
          Data biaya marketing gagal dimuat penuh: {feeError}
        </div>
      )}

      {/* ── KPI Cards — Row 1: Revenue & Profit ── */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:12 }}>
        <KPI label="Net Sales" val={`Rp ${fmtCompact(kpi.ts)}`} sub={`Avg: ${fmtRupiah(kpi.avg)}/hari`}
          delta={prevKpi && prevKpi.ts > 0 ? { value: ((kpi.ts - prevKpi.ts) / prevKpi.ts) * 100 } : undefined} />
        <KPI label="Gross Profit" val={`Rp ${fmtCompact(kpi.tg)}`} sub={`GP Margin: ${kpi.gpM.toFixed(1)}%`} color="var(--green)"
          delta={prevKpi && prevKpi.tg > 0 ? { value: ((kpi.tg - prevKpi.tg) / prevKpi.tg) * 100 } : undefined}
          delta2={prevKpi && prevKpi.gpM > 0 ? { value: kpi.gpM - prevKpi.gpM, suffix: 'pp', label: 'margin' } : undefined} />
        <KPI label="Net Profit" val={`Rp ${fmtCompact(kpi.tNetProfit)}`} sub={`NP Margin: ${kpi.npM.toFixed(1)}%`} color={kpi.tNetProfit >= 0 ? 'var(--green)' : 'var(--red)'}
          delta={!shippingError && !prevShippingError && prevKpi && prevKpi.tNetProfit !== 0 ? { value: prevKpi.tNetProfit !== 0 ? ((kpi.tNetProfit - prevKpi.tNetProfit) / Math.abs(prevKpi.tNetProfit)) * 100 : 0 } : undefined}
          delta2={!shippingError && !prevShippingError && prevKpi ? { value: kpi.npM - prevKpi.npM, suffix: 'pp', label: 'margin' } : undefined} />
      </div>
      {/* ── KPI Cards — Row 2: Cost Breakdown ── */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:20 }}>
        <KPI label="COGS" val={`Rp ${fmtCompact(kpi.tCogs)}`} sub={`${kpi.ts > 0 ? (kpi.tCogs / kpi.ts * 100).toFixed(1) : '0'}% of sales`} color="var(--dim)" />
        <KPI label="Marketing Fee" val={feeError ? '—' : `Rp ${fmtCompact(kpi.tAds)}`} sub={feeError ? 'Data ads tidak tersedia' : `${kpi.ts > 0 ? (kpi.tAds / kpi.ts * 100).toFixed(1) : '0'}% of sales`} color="var(--yellow)"
          delta={prevKpi && prevKpi.tAds > 0 ? { value: ((kpi.tAds - prevKpi.tAds) / prevKpi.tAds) * 100, higherIsBetter: false } : undefined} />
        <KPI label="MP Fee" val={feeError ? '—' : `Rp ${fmtCompact(kpi.tMp)}`} sub={feeError ? 'Data channel tidak tersedia' : `${kpi.ts > 0 ? (kpi.tMp / kpi.ts * 100).toFixed(1) : '0'}% of sales`} color="var(--yellow)"
          delta={prevKpi && prevKpi.tMp > 0 ? { value: ((kpi.tMp - prevKpi.tMp) / prevKpi.tMp) * 100, higherIsBetter: false } : undefined} />
        <KPI label="Shipping Fee" val={shippingError ? '—' : `Rp ${fmtCompact(kpi.tShipping)}`} sub={shippingError ? 'Data shipping tidak tersedia' : `${kpi.ts > 0 ? (kpi.tShipping / kpi.ts * 100).toFixed(1) : '0'}% of sales`} color="#0ea5e9"
          delta={!shippingError && !prevShippingError && prevKpi && prevKpi.tShipping > 0 ? { value: ((kpi.tShipping - prevKpi.tShipping) / prevKpi.tShipping) * 100, higherIsBetter: false } : undefined} />
        {kpi.hasOverhead && <KPI label="Overhead" val={`Rp ${fmtCompact(kpi.tOverhead)}`} sub="estimated" color="#a78bfa" />}
      </div>

      {/* ── Cash Flow Status (owner/admin) ── */}
      {isOwnerOrAdmin && cashFlowPeriodStart && (
        <CashFlowSection netSales={kpi.ts} periodStart={cashFlowPeriodStart} />
      )}
      {isOwnerOrAdmin && !cashFlowPeriodStart && (
        <div style={{ background:'rgba(120,53,15,0.12)', border:'1px solid rgba(146,64,14,0.45)', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:12, color:'#fcd34d' }}>
          Cash Flow Status hanya ditampilkan untuk rentang 1 bulan yang dimulai dari tanggal 1.
        </div>
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
          {showTren && <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12, minWidth: showDetail ? 1210 : 930 }}>
            <thead>
              <tr style={{ borderBottom:'2px solid var(--border)' }}>
                <th style={{ padding:'8px 10px', textAlign:'left', color:'var(--dim)', fontWeight:600, fontSize:10, textTransform:'uppercase', position:'sticky', left:0, background:'var(--card)', zIndex:1 }}>Tanggal</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--dim)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Shipment</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--accent)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Net Sales</th>
                {showDetail && <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--dim)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>COGS</th>}
                <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--green)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Gross Profit</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--yellow)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Mkt Fee</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--yellow)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>MP Fee</th>
                <th style={{ padding:'8px 10px', textAlign:'right', color:'#0ea5e9', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Shipping Fee</th>
                {showDetail && <th style={{ padding:'8px 10px', textAlign:'right', color:'#a78bfa', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Overhead</th>}
                <th style={{ padding:'8px 10px', textAlign:'right', color:'var(--green)', fontWeight:600, fontSize:10, textTransform:'uppercase' }}>Net Profit</th>
              </tr>
            </thead>
            <tbody>
              {kpi.chart.map((row, i) => (
                <tr key={i} style={{ borderBottom:'1px solid var(--bg-deep)' }}>
                  <td style={{ padding:'8px 10px', fontWeight:600, whiteSpace:'nowrap', position:'sticky', left:0, background:'var(--card)', zIndex:1 }}>{row.date}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'var(--text-secondary)' }}>{row.shipment > 0 ? row.shipment.toLocaleString('id-ID') : '—'}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11 }}>{fmtRupiah(row['Net Sales'])}</td>
                  {showDetail && <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'var(--dim)' }}>{fmtRupiah(row['COGS'])}</td>}
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'var(--green)' }}>{fmtRupiah(row['Gross Profit'])}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'var(--yellow)' }}>{fmtRupiah(row['Mkt Fee'])}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'var(--yellow)' }}>{fmtRupiah(row['MP Fee'])}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'#0ea5e9' }}>{fmtRupiah(row['Shipping Fee'])}</td>
                  {showDetail && <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color:'#a78bfa' }}>{fmtRupiah(row['Overhead'])}</td>}
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, color: row['Net Profit'] >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtRupiah(row['Net Profit'])}</td>
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
                    <div style={{ fontFamily:'monospace', fontSize:11, color:'var(--dim)' }}>{fmtRupiah(kpi.tCogs)}</div>
                    <div style={{ fontSize:9, color:'var(--dim)', marginTop:2 }}>{kpi.ts > 0 ? (kpi.tCogs / kpi.ts * 100).toFixed(1) : 0}%</div>
                  </td>
                )}
                <td style={{ padding:'10px 10px', textAlign:'right' }}>
                  <div style={{ fontFamily:'monospace', fontSize:11, color:'var(--green)' }}>{fmtRupiah(kpi.tg)}</div>
                  <div style={{ fontSize:9, color:'var(--dim)', marginTop:2 }}>{kpi.gpM.toFixed(1)}%</div>
                </td>
                <td style={{ padding:'10px 10px', textAlign:'right' }}>
                  <div style={{ fontFamily:'monospace', fontSize:11, color:'var(--yellow)' }}>{fmtRupiah(kpi.tAds)}</div>
                  <div style={{ fontSize:9, color:'var(--dim)', marginTop:2 }}>{kpi.ts > 0 ? (kpi.tAds / kpi.ts * 100).toFixed(1) : 0}%</div>
                </td>
                <td style={{ padding:'10px 10px', textAlign:'right' }}>
                  <div style={{ fontFamily:'monospace', fontSize:11, color:'var(--yellow)' }}>{fmtRupiah(kpi.tMp)}</div>
                  <div style={{ fontSize:9, color:'var(--dim)', marginTop:2 }}>{kpi.ts > 0 ? (kpi.tMp / kpi.ts * 100).toFixed(1) : 0}%</div>
                </td>
                <td style={{ padding:'10px 10px', textAlign:'right' }}>
                  <div style={{ fontFamily:'monospace', fontSize:11, color:'#0ea5e9' }}>{fmtRupiah(kpi.tShipping)}</div>
                  <div style={{ fontSize:9, color:'var(--dim)', marginTop:2 }}>{kpi.ts > 0 ? (kpi.tShipping / kpi.ts * 100).toFixed(1) : 0}%</div>
                </td>
                {showDetail && (
                  <td style={{ padding:'10px 10px', textAlign:'right' }}>
                    <div style={{ fontFamily:'monospace', fontSize:11, color:'#a78bfa' }}>{fmtRupiah(kpi.tOverhead)}</div>
                    <div style={{ fontSize:9, color:'var(--dim)', marginTop:2 }}>{kpi.ts > 0 ? (kpi.tOverhead / kpi.ts * 100).toFixed(1) : 0}%</div>
                  </td>
                )}
                <td style={{ padding:'10px 10px', textAlign:'right' }}>
                  <div style={{ fontFamily:'monospace', fontSize:11, color: kpi.tNetProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtRupiah(kpi.tNetProfit)}</div>
                  <div style={{ fontSize:9, marginTop:2 }}><span style={{ padding:'1px 5px', borderRadius:4, fontWeight:700, background: marginBg(kpi.npM), color: marginColor(kpi.npM) }}>{kpi.npM.toFixed(1)}%</span></div>
                </td>
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
            {['SKU','Net Sales','%','COGS','Mkt Fee','MP Fee','Net Profit','NP Margin','Mkt Ratio'].map(h => (
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
              // Use explicit KPI totals for the TOTAL row
              const tMc = kpi.tAds + kpi.tMp;
              const tNp = kpi.tNetProfit;
              const npMargin = kpi.ts > 0 ? tNp / kpi.ts * 100 : 0;
              const mktR = kpi.ts > 0 ? tMc / kpi.ts * 100 : 0;
              return (
                <tr style={{ borderTop:'2px solid var(--border)' }}>
                  <td style={{ padding:'8px 10px', fontWeight:700, fontSize:12 }}>TOTAL</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700 }}>{fmtRupiah(tSales)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', color:'var(--dim)', fontWeight:700 }}>100%</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700, color:'var(--dim)' }}>{fmtRupiah(tCogs)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700, color:'var(--yellow)' }}>{fmtRupiah(kpi.tAds)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700, color:'var(--dim)' }}>{fmtRupiah(kpi.tMp)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right', fontFamily:'monospace', fontSize:11, fontWeight:700, color:tNp>=0?'var(--green)':'var(--red)' }}>{fmtRupiah(tNp)}</td>
                  <td style={{ padding:'8px 10px', textAlign:'right' }}>
                    <span style={{ padding:'2px 7px', borderRadius:5, fontSize:10, fontWeight:700, background:npMargin>=30?'var(--badge-green-bg)':npMargin>=0?'var(--badge-yellow-bg)':'var(--badge-red-bg)', color:npMargin>=30?'var(--green)':npMargin>=0?'var(--yellow)':'var(--red)' }}>{npMargin.toFixed(1)}%</span>
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
