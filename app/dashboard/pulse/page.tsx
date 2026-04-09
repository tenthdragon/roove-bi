// @ts-nocheck
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSupabase } from '@/lib/supabase-browser';
import { fmtCompact, fmtRupiah, fmtPct, CHANNEL_COLORS } from '@/lib/utils';
import { useDateRange } from '@/lib/DateRangeContext';
import { getCached, setCache } from '@/lib/dashboard-cache';
import { useActiveBrands } from '@/lib/ActiveBrandsContext';
import { fetchCustomerKPIs, fetchChannelLtv90d, fetchChannelCac } from '@/lib/scalev-actions';
import { getStockBalance } from '@/lib/warehouse-ledger-actions';

// ── Margin color helpers (same as overview) ──
const marginColor = (v: number) => v >= 30 ? 'var(--green)' : v >= 0 ? 'var(--yellow)' : 'var(--red)';
const marginBg = (v: number) => v >= 30 ? 'var(--badge-green-bg)' : v >= 0 ? 'var(--badge-yellow-bg)' : 'var(--badge-red-bg)';

// ── Normalize ad source → platform (same as channels page) ──
function normPlatform(source: string): string {
  if (!source) return 'Other';
  const s = source.toLowerCase();
  if (s.includes('cpas')) return 'Shopee Ads';
  if (s.includes('shopee')) return 'Shopee Ads';
  if (s.includes('tiktok')) return 'TikTok Ads';
  if (s.includes('facebook')) return 'Meta Ads';
  if (s.includes('whatsapp') || s.includes('waba')) return 'WABA MM Cost';
  if (s.includes('google')) return 'Google Ads';
  if (s.includes('snack')) return 'SnackVideo Ads';
  return source;
}

// ── Marketing Platform → Sales Channels (sales POV, strict) ──
const PLATFORM_CHANNEL_MAP: Record<string, string[]> = {
  'Meta Ads':     ['Scalev Ads'],
  'Google Ads':   ['Scalev Ads'],
  'Shopee Ads':   ['Shopee'],
  'TikTok Ads':   ['TikTok Shop'],
  'WABA MM Cost': ['WABA'],
};

// ── DTC vs Marketplace classification ──
const DTC_CHANNELS = new Set(['CS Manual', 'Scalev Ads', 'WABA']);

// ── Shared card style ──
const card = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: 20, marginBottom: 16,
};
const sectionTitle = { fontSize: 15, fontWeight: 700, marginBottom: 12, color: 'var(--text)' };
const dimText = { fontSize: 11, color: 'var(--dim)' };

// ── Insight types ──
type InsightType = 'problem' | 'watch' | 'opportunity';
interface Insight {
  type: InsightType;
  message: string;
  impact: number;
  section: string;
}

const INSIGHT_COLORS: Record<InsightType, string> = {
  problem: 'var(--red)',
  watch: 'var(--yellow)',
  opportunity: 'var(--green)',
};
const INSIGHT_LABELS: Record<InsightType, string> = {
  problem: 'Problem',
  watch: 'Watch',
  opportunity: 'Opportunity',
};
const INSIGHT_BG: Record<InsightType, string> = {
  problem: 'var(--badge-red-bg)',
  watch: 'var(--badge-yellow-bg)',
  opportunity: 'var(--badge-green-bg)',
};

export default function PulsePage() {
  const supabase = useSupabase();
  const { dateRange, loading: dateLoading } = useDateRange();
  const { isActiveBrand } = useActiveBrands();

  // ── State: client-side data ──
  const [channelData, setChannelData] = useState<any[]>([]);
  const [adsData, setAdsData] = useState<any[]>([]);
  const [brandMapping, setBrandMapping] = useState<any[]>([]);
  const [overheadData, setOverheadData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // ── State: server actions ──
  const [customerKpis, setCustomerKpis] = useState<any>(null);
  const [prevCustomerKpis, setPrevCustomerKpis] = useState<any>(null);
  const [ltvData, setLtvData] = useState<any[]>([]);
  const [cacData, setCacData] = useState<any[]>([]);
  const [stockData, setStockData] = useState<any[]>([]);

  // ── Fetch client-side data ──
  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    const { from, to } = dateRange;

    const cachedCh = getCached('pulse_channel', from, to);
    const cachedAds = getCached('pulse_ads', from, to);
    const cachedBm = getCached('pulse_bm', from, to);

    if (cachedCh && cachedAds && cachedBm) {
      setChannelData(cachedCh.filter(r => isActiveBrand(r.product)));
      setAdsData(cachedAds);
      setBrandMapping(cachedBm);
      setLoading(false);
    } else {
      setLoading(true);
      Promise.all([
        supabase.from('daily_channel_data')
          .select('date, product, channel, net_sales, gross_profit, mp_admin_cost')
          .gte('date', from).lte('date', to),
        supabase.from('daily_ads_spend')
          .select('date, source, spent, store')
          .gte('date', from).lte('date', to),
        supabase.from('ads_store_brand_mapping')
          .select('store_pattern, brand'),
      ]).then(([chRes, adsRes, bmRes]) => {
        const ch = chRes.data || [];
        const ads = adsRes.data || [];
        const bm = bmRes.data || [];
        setCache('pulse_channel', from, to, ch);
        setCache('pulse_ads', from, to, ads);
        setCache('pulse_bm', from, to, bm);
        setChannelData(ch.filter(r => isActiveBrand(r.product)));
        setAdsData(ads);
        setBrandMapping(bm);
        setLoading(false);
      });
    }

    // Overhead
    const fromYM = from.slice(0, 7);
    const toYM = to.slice(0, 7);
    supabase.from('monthly_overhead').select('year_month, amount')
      .gte('year_month', fromYM).lte('year_month', toYM)
      .then(({ data }) => setOverheadData(data || []));
  }, [dateRange, supabase]);

  // ── Fetch server action data ──
  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    const { from, to } = dateRange;

    // Customer KPIs for current + previous period
    fetchCustomerKPIs(from, to).then(setCustomerKpis).catch(() => {});

    // Previous month KPIs
    const fD = new Date(from + 'T00:00:00');
    const tD = new Date(to + 'T00:00:00');
    const prevFrom = new Date(fD.getFullYear(), fD.getMonth() - 1, fD.getDate());
    const prevTo = new Date(tD.getFullYear(), tD.getMonth() - 1, tD.getDate());
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    fetchCustomerKPIs(fmt(prevFrom), fmt(prevTo)).then(setPrevCustomerKpis).catch(() => {});

    // LTV & CAC
    fetchChannelLtv90d().then(setLtvData).catch(() => {});
    fetchChannelCac().then(setCacData).catch(() => {});

    // Stock balance
    getStockBalance().then(setStockData).catch(() => {});
  }, [dateRange]);

  // ── Store → Brand lookup ──
  const storeBrandMap = useMemo(() => {
    const map: Record<string, string> = {};
    brandMapping.forEach(r => { map[r.store_pattern?.toLowerCase()] = r.brand; });
    return map;
  }, [brandMapping]);

  const getAdBrand = (store: string) => {
    if (!store) return null;
    return storeBrandMap[store.toLowerCase()] || null;
  };

  // ══════════════════════════════════════════════════════════════
  // SECTION 1: Profitability Matrix (Brand x Channel)
  // ══════════════════════════════════════════════════════════════
  const profMatrix = useMemo(() => {
    // Accumulate channel data: brand+channel → {sales, gp, mpFee}
    const cells: Record<string, { sales: number; gp: number; mpFee: number; adsCost: number }> = {};
    const allBrands = new Set<string>();
    const allChannels = new Set<string>();

    channelData.forEach(r => {
      const key = `${r.product}||${r.channel}`;
      if (!cells[key]) cells[key] = { sales: 0, gp: 0, mpFee: 0 };
      cells[key].sales += Number(r.net_sales) || 0;
      cells[key].gp += Number(r.gross_profit) || 0;
      cells[key].mpFee += Math.abs(Number(r.mp_admin_cost) || 0);
      allBrands.add(r.product);
      allChannels.add(r.channel);
    });

    // NOTE: Ads cost is NOT attributed to individual channels.
    // Marketing creates demand (mental availability) across ALL channels — Byron Sharp.
    // Ads efficiency is measured separately as blended ROAS in mktEfficiency.

    // Compute overhead allocation — prorate monthly overhead to match date range
    let totalOverhead = 0;
    if (dateRange.from && dateRange.to) {
      const rangeFrom = new Date(dateRange.from + 'T00:00:00');
      const rangeTo = new Date(dateRange.to + 'T00:00:00');
      overheadData.forEach(o => {
        const [y, m] = o.year_month.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate();
        const monthStart = new Date(y, m - 1, 1);
        const monthEnd = new Date(y, m - 1, daysInMonth);
        const overlapStart = rangeFrom > monthStart ? rangeFrom : monthStart;
        const overlapEnd = rangeTo < monthEnd ? rangeTo : monthEnd;
        const overlapDays = Math.max(0, Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1);
        totalOverhead += (Number(o.amount) || 0) * (overlapDays / daysInMonth);
      });
    }
    const totalSales = Object.values(cells).reduce((a, c) => a + c.sales, 0);

    // Build result rows — operational margin only (GP - MP Fee - Overhead)
    const rows: { brand: string; channel: string; sales: number; netProfit: number; margin: number }[] = [];
    for (const [key, c] of Object.entries(cells)) {
      if (c.sales <= 0) continue;
      const [brand, channel] = key.split('||');
      const overhead = totalSales > 0 ? totalOverhead * (c.sales / totalSales) : 0;
      const netProfit = c.gp - c.mpFee - overhead;
      const margin = c.sales > 0 ? (netProfit / c.sales) * 100 : 0;
      rows.push({ brand, channel, sales: c.sales, netProfit, margin });
    }

    // Sort and pick top/bottom
    const sorted = [...rows].sort((a, b) => a.margin - b.margin);
    const bottom3 = sorted.filter(r => r.margin < 30).slice(0, 3);
    const top3 = sorted.filter(r => r.margin >= 0).slice(-3).reverse();

    // Build matrix structure
    const brands = [...allBrands].sort();
    const channels = [...allChannels].sort((a, b) => {
      // DTC first, then marketplace
      const aD = DTC_CHANNELS.has(a) ? 0 : 1;
      const bD = DTC_CHANNELS.has(b) ? 0 : 1;
      return aD - bD || a.localeCompare(b);
    });

    const matrix: Record<string, Record<string, { sales: number; netProfit: number; margin: number } | null>> = {};
    brands.forEach(b => {
      matrix[b] = {};
      channels.forEach(ch => {
        const r = rows.find(x => x.brand === b && x.channel === ch);
        matrix[b][ch] = r || null;
      });
    });

    return { brands, channels, matrix, top3, bottom3, totalSales };
  }, [channelData, adsData, brandMapping, overheadData]);

  // ══════════════════════════════════════════════════════════════
  // MARKETING INVESTMENT EFFICIENCY (blended — not per channel)
  // Marketing = demand generation across ALL channels (Byron Sharp)
  // ══════════════════════════════════════════════════════════════
  const mktEfficiency = useMemo(() => {
    let totalAds = 0;
    adsData.forEach(r => {
      const brand = getAdBrand(r.store);
      if (!brand || !isActiveBrand(brand)) return;
      totalAds += Number(r.spent) || 0;
    });
    const totalRev = profMatrix.totalSales;
    const blendedRoas = totalAds > 0 ? totalRev / totalAds : 0;
    const mktRatio = totalRev > 0 ? (totalAds / totalRev) * 100 : 0;
    return { totalAds, totalRev, blendedRoas, mktRatio };
  }, [adsData, brandMapping, profMatrix.totalSales]);

  // ══════════════════════════════════════════════════════════════
  // SECTION 2: Unit Economics (LTV:CAC per Channel)
  // ══════════════════════════════════════════════════════════════
  const unitEcon = useMemo(() => {
    if (!ltvData.length || !cacData.length) return [];
    // Latest month CAC per channel
    const cacMap: Record<string, number> = {};
    cacData.forEach(r => {
      const ch = r.channel_group;
      if (!cacMap[ch] || r.month > cacMap[ch + '_m']) {
        cacMap[ch] = Number(r.cac) || 0;
        cacMap[ch + '_m'] = r.month;
      }
    });

    return ltvData.map(r => {
      const ltv = Number(r.avg_ltv_90d) || 0;
      const cac = cacMap[r.channel_group] || 0;
      const ratio = cac > 0 ? ltv / cac : ltv > 0 ? 99 : 0;
      return {
        channel: r.channel_group,
        ltv,
        cac,
        ratio,
        customers: Number(r.customer_count) || 0,
      };
    }).filter(r => r.customers > 0).sort((a, b) => b.ratio - a.ratio);
  }, [ltvData, cacData]);

  // ══════════════════════════════════════════════════════════════
  // SECTION 3: Revenue Quality (DTC vs MP + Repeat)
  // ══════════════════════════════════════════════════════════════
  const revQuality = useMemo(() => {
    let dtcSales = 0, dtcGp = 0, mpSales = 0, mpGp = 0;
    channelData.forEach(r => {
      const s = Number(r.net_sales) || 0;
      const g = Number(r.gross_profit) || 0;
      if (DTC_CHANNELS.has(r.channel)) {
        dtcSales += s; dtcGp += g;
      } else {
        mpSales += s; mpGp += g;
      }
    });
    const total = dtcSales + mpSales;
    const dtcPct = total > 0 ? (dtcSales / total) * 100 : 0;
    const mpPct = total > 0 ? (mpSales / total) * 100 : 0;
    const dtcMargin = dtcSales > 0 ? (dtcGp / dtcSales) * 100 : 0;
    const mpMargin = mpSales > 0 ? (mpGp / mpSales) * 100 : 0;

    const repeatRate = customerKpis?.repeatRate || 0;
    const prevRepeatRate = prevCustomerKpis?.repeatRate || 0;
    const repeatDelta = repeatRate - prevRepeatRate;
    const newRev = customerKpis?.newRevenue || 0;
    const repeatRev = customerKpis?.repeatRevenue || 0;

    return { dtcSales, mpSales, dtcPct, mpPct, dtcMargin, mpMargin, total, repeatRate, prevRepeatRate, repeatDelta, newRev, repeatRev };
  }, [channelData, customerKpis, prevCustomerKpis]);

  // ══════════════════════════════════════════════════════════════
  // SECTION 4: Inventory Days
  // ══════════════════════════════════════════════════════════════
  const inventoryDays = useMemo(() => {
    if (!stockData.length || !channelData.length) return [];
    // Compute daily demand per brand from channel data
    const salesByBrand: Record<string, number> = {};
    channelData.forEach(r => {
      salesByBrand[r.product] = (salesByBrand[r.product] || 0) + (Number(r.net_sales) || 0);
    });
    const daysInRange = dateRange.from && dateRange.to
      ? Math.max(1, Math.ceil((new Date(dateRange.to + 'T00:00:00').getTime() - new Date(dateRange.from + 'T00:00:00').getTime()) / 86400000) + 1)
      : 30;

    // Group stock by category (which maps to brand)
    const stockByCategory: Record<string, { qty: number; value: number; products: string[] }> = {};
    stockData.forEach(r => {
      const cat = r.category || 'Other';
      if (!stockByCategory[cat]) stockByCategory[cat] = { qty: 0, value: 0, products: [] };
      stockByCategory[cat].qty += Number(r.current_qty) || 0;
      stockByCategory[cat].value += (Number(r.current_qty) || 0) * (Number(r.hpp) || 0);
      if (r.product_name) stockByCategory[cat].products.push(r.product_name);
    });

    const result: { brand: string; currentStock: number; stockValue: number; dailyDemandRp: number; daysOfInventory: number }[] = [];
    for (const [cat, st] of Object.entries(stockByCategory)) {
      if (st.qty <= 0) continue;
      const dailySalesRp = (salesByBrand[cat] || 0) / daysInRange;
      // Estimate DOI using value-based approach
      const doi = dailySalesRp > 0 ? st.value / dailySalesRp : 999;
      result.push({ brand: cat, currentStock: st.qty, stockValue: st.value, dailyDemandRp: dailySalesRp, daysOfInventory: Math.round(doi) });
    }
    return result.sort((a, b) => b.daysOfInventory - a.daysOfInventory);
  }, [stockData, channelData, dateRange]);

  // ── Overhead % ──
  // Prorated overhead matching the date range (same logic as profMatrix)
  const proratedOverhead = useMemo(() => {
    let total = 0;
    if (dateRange.from && dateRange.to) {
      const rangeFrom = new Date(dateRange.from + 'T00:00:00');
      const rangeTo = new Date(dateRange.to + 'T00:00:00');
      overheadData.forEach(o => {
        const [y, m] = o.year_month.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate();
        const monthStart = new Date(y, m - 1, 1);
        const monthEnd = new Date(y, m - 1, daysInMonth);
        const overlapStart = rangeFrom > monthStart ? rangeFrom : monthStart;
        const overlapEnd = rangeTo < monthEnd ? rangeTo : monthEnd;
        const overlapDays = Math.max(0, Math.ceil((overlapEnd.getTime() - overlapStart.getTime()) / 86400000) + 1);
        total += (Number(o.amount) || 0) * (overlapDays / daysInMonth);
      });
    }
    return total;
  }, [overheadData, dateRange]);

  const overheadPct = useMemo(() => {
    return profMatrix.totalSales > 0 ? (proratedOverhead / profMatrix.totalSales) * 100 : 0;
  }, [proratedOverhead, profMatrix.totalSales]);

  // ══════════════════════════════════════════════════════════════
  // SECTION 5: Action Radar — Auto-Generated Insights
  // ══════════════════════════════════════════════════════════════
  const insights = useMemo(() => {
    const list: Insight[] = [];

    // Rule 1: Negative OPERATIONAL margin (GP - MP Fee - Overhead, before ads)
    for (const [brand, channels] of Object.entries(profMatrix.matrix)) {
      for (const [ch, cell] of Object.entries(channels)) {
        if (!cell) continue;
        if (cell.margin < 0) {
          list.push({
            type: 'problem',
            message: `${brand} margin operasional negatif (${fmtPct(cell.margin)}) di ${ch} — COGS atau MP fee terlalu tinggi`,
            impact: Math.abs(cell.netProfit),
            section: 'profitability',
          });
        }
      }
    }

    // Rule 2: High margin + low revenue share = growth opportunity
    for (const [brand, channels] of Object.entries(profMatrix.matrix)) {
      for (const [ch, cell] of Object.entries(channels)) {
        if (!cell) continue;
        const share = profMatrix.totalSales > 0 ? (cell.sales / profMatrix.totalSales) * 100 : 0;
        if (cell.margin > 30 && share < 10 && cell.sales > 0) {
          list.push({
            type: 'opportunity',
            message: `${ch} margin operasional tinggi (${fmtPct(cell.margin)}) untuk ${brand} tapi hanya ${fmtPct(share)} dari total revenue — peluang scale`,
            impact: cell.sales * 0.5,
            section: 'profitability',
          });
        }
      }
    }

    // Rule 2b: Blended marketing efficiency
    if (mktEfficiency.totalAds > 0) {
      if (mktEfficiency.blendedRoas < 2) {
        list.push({
          type: 'problem',
          message: `Blended ROAS ${mktEfficiency.blendedRoas.toFixed(1)}x — setiap Rp 1 ads menghasilkan kurang dari Rp 2 revenue di seluruh channel`,
          impact: mktEfficiency.totalAds * 0.3,
          section: 'marketing',
        });
      } else if (mktEfficiency.blendedRoas > 5) {
        list.push({
          type: 'opportunity',
          message: `Blended ROAS ${mktEfficiency.blendedRoas.toFixed(1)}x — marketing sangat efisien, ada ruang untuk scale spend`,
          impact: mktEfficiency.totalAds * 0.3,
          section: 'marketing',
        });
      }
      if (mktEfficiency.mktRatio > 30) {
        list.push({
          type: 'watch',
          message: `Marketing spend ${fmtPct(mktEfficiency.mktRatio)} dari revenue — di atas 30%, monitor efisiensi`,
          impact: mktEfficiency.totalAds,
          section: 'marketing',
        });
      }
    }

    // Rule 3: LTV:CAC signals
    unitEcon.forEach(ue => {
      if (ue.ratio > 3.5) {
        list.push({
          type: 'opportunity',
          message: `LTV:CAC di ${ue.channel} adalah ${ue.ratio.toFixed(1)}x — ruang untuk scale spend ~30%`,
          impact: ue.cac * ue.customers * 0.3,
          section: 'unit_economics',
        });
      }
      if (ue.ratio > 0 && ue.ratio < 1.5) {
        list.push({
          type: 'problem',
          message: `LTV:CAC di ${ue.channel} hanya ${ue.ratio.toFixed(1)}x — biaya akuisisi melebihi value`,
          impact: (ue.cac - ue.ltv) * ue.customers,
          section: 'unit_economics',
        });
      }
    });

    // Rule 4: Repeat rate decline
    if (revQuality.prevRepeatRate > 0 && revQuality.repeatDelta < -3) {
      list.push({
        type: 'problem',
        message: `Repeat rate turun dari ${fmtPct(revQuality.prevRepeatRate)} ke ${fmtPct(revQuality.repeatRate)} MoM — masalah retensi`,
        impact: Math.abs(revQuality.repeatDelta / 100) * revQuality.total,
        section: 'revenue_quality',
      });
    }

    // Rule 5: High marketplace dependency
    if (revQuality.mpPct > 70) {
      list.push({
        type: 'watch',
        message: `${fmtPct(revQuality.mpPct)} revenue dari marketplace — risiko ketergantungan platform tinggi`,
        impact: revQuality.mpSales * 0.05,
        section: 'revenue_quality',
      });
    }

    // Rule 6: Inventory alerts
    inventoryDays.forEach(inv => {
      if (inv.daysOfInventory > 90 && inv.daysOfInventory < 999) {
        list.push({
          type: 'watch',
          message: `${inv.brand} memiliki ${inv.daysOfInventory} hari stok — flash sale direkomendasikan`,
          impact: inv.stockValue,
          section: 'inventory',
        });
      }
      if (inv.daysOfInventory < 14 && inv.currentStock > 0 && inv.dailyDemandRp > 0) {
        list.push({
          type: 'problem',
          message: `${inv.brand} hanya tersisa ${inv.daysOfInventory} hari stok — segera reorder`,
          impact: inv.dailyDemandRp * 14,
          section: 'inventory',
        });
      }
    });

    // Rule 7: Overhead creep
    if (overheadPct > 20) {
      list.push({
        type: 'watch',
        message: `Overhead ${fmtPct(overheadPct)} dari revenue — di atas threshold 20%`,
        impact: proratedOverhead,
        section: 'cash_efficiency',
      });
    }

    // Sort by impact descending, take top 7
    return list.sort((a, b) => b.impact - a.impact).slice(0, 7);
  }, [profMatrix, mktEfficiency, unitEcon, revQuality, inventoryDays, overheadPct, proratedOverhead]);

  // ══════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════

  if (dateLoading || loading) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--dim)' }}>Loading Business Pulse...</div>;
  }

  return (
    <div className="fade-in" style={{ maxWidth: 1200 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 2, color: 'var(--text)' }}>Business Pulse</h2>
      <p style={{ ...dimText, marginBottom: 20 }}>Sintesis strategis lintas seluruh domain — inti problem & opportunity</p>

      {/* ── ACTION RADAR (top — most important) ── */}
      {insights.length > 0 && (
        <div style={{ ...card, borderLeft: '3px solid var(--accent)' }}>
          <div style={{ ...sectionTitle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Action Radar</span>
            <span style={{ ...dimText, fontWeight: 400 }}>Top insights berdasarkan estimasi dampak</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {insights.map((ins, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)',
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: INSIGHT_COLORS[ins.type],
                }} />
                <div style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{ins.message}</div>
                <div style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600, flexShrink: 0,
                  background: INSIGHT_BG[ins.type], color: INSIGHT_COLORS[ins.type],
                }}>
                  {INSIGHT_LABELS[ins.type]}
                </div>
                <div style={{ fontSize: 11, color: 'var(--dim)', flexShrink: 0, minWidth: 70, textAlign: 'right' }}>
                  ~{fmtCompact(ins.impact)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MARKETING INVESTMENT EFFICIENCY ── */}
      {mktEfficiency.totalAds > 0 && (
        <div style={card}>
          <div style={sectionTitle}>Marketing Investment Efficiency</div>
          <p style={{ ...dimText, marginBottom: 12, marginTop: -8 }}>
            Marketing menciptakan demand (mental availability) yang diserap oleh seluruh sales channel secara fluid — tidak bisa diatribusi 1:1 ke channel tertentu.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>Total Ads Spend</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{fmtCompact(mktEfficiency.totalAds)}</div>
            </div>
            <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>Total Revenue (all channels)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{fmtCompact(mktEfficiency.totalRev)}</div>
            </div>
            <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>Blended ROAS</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: mktEfficiency.blendedRoas >= 3 ? 'var(--green)' : mktEfficiency.blendedRoas >= 2 ? 'var(--yellow)' : 'var(--red)' }}>
                {mktEfficiency.blendedRoas.toFixed(1)}x
              </div>
            </div>
            <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>Mkt Ratio (% of Revenue)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: mktEfficiency.mktRatio <= 20 ? 'var(--green)' : mktEfficiency.mktRatio <= 30 ? 'var(--yellow)' : 'var(--red)' }}>
                {fmtPct(mktEfficiency.mktRatio)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PROFITABILITY MATRIX ── */}
      <div style={card}>
        <div style={sectionTitle}>Channel Operating Margin (Brand x Channel)</div>
        <p style={{ ...dimText, marginBottom: 12, marginTop: -8 }}>
          Margin operasional per channel: GP - MP Fee - Overhead. Tanpa ads cost — karena marketing menciptakan demand lintas seluruh channel secara fluid. Hijau {'\u2265'}30%, kuning 0-30%, merah {'<'}0%.
        </p>
        {profMatrix.brands.length === 0 ? (
          <div style={dimText}>Tidak ada data untuk periode ini</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontWeight: 600 }}>Brand</th>
                  {profMatrix.channels.map(ch => (
                    <th key={ch} style={{
                      textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--border)',
                      color: CHANNEL_COLORS[ch] || 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap',
                    }}>
                      {ch}
                    </th>
                  ))}
                  <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontWeight: 700 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {profMatrix.brands.map(brand => {
                  const brandTotal = profMatrix.channels.reduce((acc, ch) => {
                    const c = profMatrix.matrix[brand][ch];
                    return { sales: acc.sales + (c?.sales || 0), netProfit: acc.netProfit + (c?.netProfit || 0) };
                  }, { sales: 0, netProfit: 0 });
                  const brandMargin = brandTotal.sales > 0 ? (brandTotal.netProfit / brandTotal.sales) * 100 : 0;
                  return (
                    <tr key={brand}>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>{brand}</td>
                      {profMatrix.channels.map(ch => {
                        const c = profMatrix.matrix[brand][ch];
                        if (!c) return <td key={ch} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--dim)', textAlign: 'right' }}>-</td>;
                        return (
                          <td key={ch} style={{
                            padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'right',
                            background: marginBg(c.margin),
                          }}>
                            <div style={{ color: marginColor(c.margin), fontWeight: 700, fontSize: 12 }}>{fmtPct(c.margin)}</div>
                            <div style={{ color: 'var(--dim)', fontSize: 10 }}>{fmtCompact(c.netProfit)}</div>
                          </td>
                        );
                      })}
                      <td style={{
                        padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'right',
                        background: marginBg(brandMargin),
                      }}>
                        <div style={{ color: marginColor(brandMargin), fontWeight: 700, fontSize: 12 }}>{fmtPct(brandMargin)}</div>
                        <div style={{ color: 'var(--dim)', fontSize: 10 }}>{fmtCompact(brandTotal.netProfit)}</div>
                      </td>
                    </tr>
                  );
                })}
                {/* Channel totals row */}
                <tr>
                  <td style={{ padding: '6px 8px', fontWeight: 700, color: 'var(--text)' }}>Total</td>
                  {profMatrix.channels.map(ch => {
                    const chTotal = profMatrix.brands.reduce((acc, b) => {
                      const c = profMatrix.matrix[b][ch];
                      return { sales: acc.sales + (c?.sales || 0), netProfit: acc.netProfit + (c?.netProfit || 0) };
                    }, { sales: 0, netProfit: 0 });
                    const chMargin = chTotal.sales > 0 ? (chTotal.netProfit / chTotal.sales) * 100 : 0;
                    return (
                      <td key={ch} style={{ padding: '6px 8px', textAlign: 'right', background: marginBg(chMargin) }}>
                        <div style={{ color: marginColor(chMargin), fontWeight: 700, fontSize: 12 }}>{fmtPct(chMargin)}</div>
                        <div style={{ color: 'var(--dim)', fontSize: 10 }}>{fmtCompact(chTotal.netProfit)}</div>
                      </td>
                    );
                  })}
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {(() => {
                      const gt = Object.values(profMatrix.matrix).flatMap(chs => Object.values(chs)).filter(Boolean);
                      const s = gt.reduce((a, c) => a + c.sales, 0);
                      const n = gt.reduce((a, c) => a + c.netProfit, 0);
                      const m = s > 0 ? (n / s) * 100 : 0;
                      return (
                        <>
                          <div style={{ color: marginColor(m), fontWeight: 700, fontSize: 12 }}>{fmtPct(m)}</div>
                          <div style={{ color: 'var(--dim)', fontSize: 10 }}>{fmtCompact(n)}</div>
                        </>
                      );
                    })()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Top 3 / Bottom 3 highlights */}
        {(profMatrix.top3.length > 0 || profMatrix.bottom3.length > 0) && (
          <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
            {profMatrix.top3.length > 0 && (
              <div style={{ flex: 1, minWidth: 250 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--green)', marginBottom: 4 }}>Top Performers</div>
                {profMatrix.top3.map((r, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--text)', padding: '2px 0' }}>
                    {r.brand} x {r.channel}: <span style={{ color: 'var(--green)', fontWeight: 600 }}>{fmtPct(r.margin)}</span> ({fmtCompact(r.netProfit)})
                  </div>
                ))}
              </div>
            )}
            {profMatrix.bottom3.length > 0 && (
              <div style={{ flex: 1, minWidth: 250 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)', marginBottom: 4 }}>Needs Attention</div>
                {profMatrix.bottom3.map((r, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--text)', padding: '2px 0' }}>
                    {r.brand} x {r.channel}: <span style={{ color: marginColor(r.margin), fontWeight: 600 }}>{fmtPct(r.margin)}</span> ({fmtCompact(r.netProfit)})
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── TWO-COLUMN: Unit Economics + Revenue Quality ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>

        {/* ── UNIT ECONOMICS ── */}
        <div style={card}>
          <div style={sectionTitle}>Unit Economics Health</div>
          <p style={{ ...dimText, marginBottom: 10, marginTop: -8 }}>LTV:CAC per channel. Hijau {'>'}3x, kuning 1.5-3x, merah {'<'}1.5x</p>
          {unitEcon.length === 0 ? (
            <div style={dimText}>Data LTV/CAC belum tersedia</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  {['Channel', 'LTV 90d', 'CAC', 'LTV:CAC', 'Customers'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Channel' ? 'left' : 'right', padding: '4px 6px', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontWeight: 600, fontSize: 11 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unitEcon.map(ue => {
                  const ratioColor = ue.ratio >= 3 ? 'var(--green)' : ue.ratio >= 1.5 ? 'var(--yellow)' : 'var(--red)';
                  return (
                    <tr key={ue.channel}>
                      <td style={{ padding: '6px', borderBottom: '1px solid var(--border)', fontWeight: 600, color: 'var(--text)' }}>{ue.channel || 'Other'}</td>
                      <td style={{ padding: '6px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text)' }}>{fmtCompact(ue.ltv)}</td>
                      <td style={{ padding: '6px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--text)' }}>{fmtCompact(ue.cac)}</td>
                      <td style={{ padding: '6px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: ratioColor, display: 'inline-block' }} />
                          <span style={{ color: ratioColor, fontWeight: 700 }}>{ue.ratio >= 99 ? '\u221e' : ue.ratio.toFixed(1)}x</span>
                        </span>
                      </td>
                      <td style={{ padding: '6px', borderBottom: '1px solid var(--border)', textAlign: 'right', color: 'var(--dim)' }}>{ue.customers.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── REVENUE QUALITY ── */}
        <div style={card}>
          <div style={sectionTitle}>Revenue Quality</div>
          <p style={{ ...dimText, marginBottom: 10, marginTop: -8 }}>Komposisi DTC vs Marketplace & kesehatan repeat</p>

          {/* DTC vs MP bar */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 28, marginBottom: 6 }}>
              {revQuality.dtcPct > 0 && (
                <div style={{ width: `${revQuality.dtcPct}%`, background: 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', minWidth: 40 }}>
                  DTC {fmtPct(revQuality.dtcPct, 0)}
                </div>
              )}
              {revQuality.mpPct > 0 && (
                <div style={{ width: `${revQuality.mpPct}%`, background: '#ee4d2d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', minWidth: 40 }}>
                  MP {fmtPct(revQuality.mpPct, 0)}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--dim)' }}>
              <span>DTC: {fmtCompact(revQuality.dtcSales)} (margin {fmtPct(revQuality.dtcMargin)})</span>
              <span>MP: {fmtCompact(revQuality.mpSales)} (margin {fmtPct(revQuality.mpMargin)})</span>
            </div>
          </div>

          {/* Repeat rate */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>Repeat Rate</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
                {fmtPct(revQuality.repeatRate)}
              </div>
              {prevCustomerKpis && (
                <div style={{ fontSize: 11, color: revQuality.repeatDelta >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 2 }}>
                  {revQuality.repeatDelta >= 0 ? '+' : ''}{fmtPct(revQuality.repeatDelta)} MoM
                </div>
              )}
            </div>
            <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4 }}>Revenue Split</div>
              <div style={{ fontSize: 12, color: 'var(--text)' }}>
                <div>New: <strong>{fmtCompact(revQuality.newRev)}</strong></div>
                <div>Repeat: <strong style={{ color: 'var(--green)' }}>{fmtCompact(revQuality.repeatRev)}</strong></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── INVENTORY & OVERHEAD (compact) ── */}
      <div style={card}>
        <div style={sectionTitle}>Inventory & Overhead</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>

          {/* Days of Inventory */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Days of Inventory (estimasi)</div>
            {inventoryDays.length === 0 ? (
              <div style={dimText}>Data warehouse belum tersedia</div>
            ) : (
              inventoryDays.slice(0, 8).map(inv => {
                const barColor = inv.daysOfInventory > 90 ? 'var(--red)' : inv.daysOfInventory > 45 ? 'var(--yellow)' : 'var(--green)';
                const barWidth = Math.min(100, (inv.daysOfInventory / 120) * 100);
                return (
                  <div key={inv.brand} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 80, fontSize: 11, color: 'var(--text)', fontWeight: 500, flexShrink: 0 }}>{inv.brand}</div>
                    <div style={{ flex: 1, height: 14, background: 'var(--bg)', borderRadius: 4, overflow: 'hidden', border: '1px solid var(--border)' }}>
                      <div style={{ width: `${barWidth}%`, height: '100%', background: barColor, borderRadius: 4, transition: 'width 0.3s' }} />
                    </div>
                    <div style={{ width: 50, fontSize: 11, color: barColor, fontWeight: 600, textAlign: 'right' }}>
                      {inv.daysOfInventory >= 999 ? 'N/A' : `${inv.daysOfInventory}d`}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Overhead gauge */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Overhead vs Revenue</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 80, height: 80, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
                border: `3px solid ${overheadPct > 20 ? 'var(--red)' : overheadPct > 15 ? 'var(--yellow)' : 'var(--green)'}`,
              }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: overheadPct > 20 ? 'var(--red)' : 'var(--text)' }}>{fmtPct(overheadPct, 0)}</div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--dim)' }}>
                <div>Overhead: {fmtCompact(proratedOverhead)}</div>
                <div>Revenue: {fmtCompact(profMatrix.totalSales)}</div>
                <div style={{ marginTop: 4, color: overheadPct > 20 ? 'var(--red)' : 'var(--text)' }}>
                  Target: {'<'}20%
                </div>
              </div>
            </div>
            <p style={{ ...dimText, marginTop: 12 }}>
              Section Cash Flow akan tersedia setelah fitur mutasi bank aktif.
            </p>
          </div>
        </div>
      </div>

      {/* ── ATTRIBUTION CONTEXT (for LLM and human readers) ── */}
      <div style={{ ...card, borderLeft: '3px solid var(--dim)', opacity: 0.85 }} data-context="attribution-model">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Cara Baca Halaman Ini</div>
        <div style={{ fontSize: 12, color: 'var(--dim)', lineHeight: 1.7 }}>
          <p style={{ marginBottom: 8 }}>
            <strong>Marketing channel {'\u2260'} sales channel.</strong> Dalam D2C yang terfragmentasi, marketing (Meta Ads, Google Ads, TikTok Ads)
            menciptakan <em>mental availability</em> — demand yang kemudian diserap secara fluid oleh berbagai sales channel
            (Scalev, CS Manual, Shopee, TikTok Shop, dll). Atribusi 1:1 tidak dimungkinkan dan akan menghasilkan false signal.
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong>Channel Operating Margin</strong> mengukur efisiensi operasional tiap channel dalam menyerap demand: berapa margin setelah COGS, marketplace fee, dan overhead — tanpa ads cost.
            Ini menjawab: <em>"Channel mana yang paling efisien secara operasional?"</em>
          </p>
          <p style={{ marginBottom: 8 }}>
            <strong>Marketing Investment Efficiency</strong> mengukur efektivitas total investasi marketing terhadap total revenue seluruh channel.
            Blended ROAS = total revenue / total ads spend. Ini menjawab: <em>"Apakah investasi marketing saya menghasilkan secara keseluruhan?"</em>
          </p>
          <p style={{ margin: 0 }}>
            Kedua metrik harus dibaca bersama: channel operating margin tinggi + blended ROAS sehat = bisnis sehat.
            Channel margin tinggi tapi ROAS rendah = marketing belum efisien. ROAS tinggi tapi channel margin rendah = masalah operasional/COGS.
          </p>
        </div>
      </div>
    </div>
  );
}
