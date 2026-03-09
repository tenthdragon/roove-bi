// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSupabase } from '@/lib/supabase-browser';
import { fmtCompact, fmtRupiah } from '@/lib/utils';
import { useDateRange } from '@/lib/DateRangeContext';
import { getCached, setCache } from '@/lib/dashboard-cache';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Line, Cell
} from 'recharts';
import { useActiveBrands } from '@/lib/ActiveBrandsContext';
import { buildBrandColorMap } from '@/lib/utils';

// ── Normalize store name ──
function normStore(s: string): string {
  if (!s) return 'Other';
  if (s === 'Purvu Store') return 'Purvu';
  return s;
}

// ── Mapping: Ads Source → Marketing Platform ──
// Marketing POV: ads spend attributed to all sales channels they impact (including organic spillover)
//
// Sales Channel (DB)  | Marketing Channels that serve it
// ────────────────────|──────────────────────────────────
// Scalev (="Facebook Ads" in DB) | Meta Ads (Non CPAS, WABA/CTWA), Google Ads
// Organik             | WhatsApp BC / Marketing Message (future)
// Shopee              | Shopee Ads, Meta Ads CPAS
// TikTok Shop         | TikTok Ads, TikTokShop Ads
// MP lain             | MP lain Ads (future)
//
// NOTE: On marketing page, Meta Ads also attributes to Organik (spillover effect).
//       On channels/sales page, Organik has zero ads cost.
function normPlatform(source: string): string {
  if (!source) return 'Other';
  const s = source.toLowerCase();
  if (s.includes('cpas')) return 'Shopee Ads';
  if (s.includes('shopee')) return 'Shopee Ads';
  if (s.includes('tiktok')) return 'TikTok Ads';
  if (s.includes('facebook')) return 'Meta Ads';
  if (s.includes('whatsapp') || s.includes('waba')) return 'Meta Ads';
  if (s.includes('google')) return 'Google Ads';
  if (s.includes('snack')) return 'SnackVideo Ads';
  return source;
}

// ── Sub-source label for breakdown detail ──
function getSubSource(source: string): string | null {
  if (!source) return null;
  const s = source.toLowerCase();
  if (s.includes('cpas')) return 'CPAS';
  if (s.includes('shopee') && s.includes('live')) return 'Shopee Live';
  if (s.includes('whatsapp') || s.includes('waba')) return 'WABA/CTWA';
  if (s.includes('tiktok shop') || s.includes('tiktokshop')) return 'TikTok Shop';
  return null;
}

// ── Marketing Platform → Sales Channels served (marketing POV, includes organic spillover) ──
// "Facebook Ads" below is the DB value for Scalev website orders (displayed as "Scalev")
const PLATFORM_CHANNEL_MAP: Record<string, string[]> = {
  'Meta Ads':          ['Facebook Ads', 'Organik'],
  'Google Ads':        ['Facebook Ads', 'Organik'],
  'Shopee Ads':        ['Shopee'],
  'TikTok Ads':        ['TikTok', 'TikTok Shop'],
  'Other Marketplace': ['Tokopedia', 'BliBli', 'Lazada'],
};

const PLATFORM_CHANNEL_LABEL: Record<string, string> = {
  'Meta Ads':          'Scalev',
  'Google Ads':        'Scalev',
  'Shopee Ads':        'Shopee',
  'TikTok Ads':        'TikTok',
  'Other Marketplace': 'Other MP',
};

// ── Platform colors ──
const PLATFORM_COLORS: Record<string, string> = {
  'Meta Ads': '#1877f2', 'Google Ads': '#4285f4', 'TikTok Ads': '#ff0050',
  'Shopee Ads': '#ee4d2d', 'SnackVideo Ads': '#fbbf24', 'Other Marketplace': '#64748b',
  'Reseller': '#f59e0b', 'Other': '#64748b',
};

// ── Channel colors ──
const CHANNEL_COLORS: Record<string, string> = {
  'Scalev': '#3b82f6', 'Shopee': '#ee4d2d', 'TikTok': '#ff0050',
  'Tokopedia': '#10b981', 'BliBli': '#06b6d4', 'Lazada': '#1a237e', 'Reseller': '#f59e0b',
};

export default function MarketingPage() {
  const supabase = useSupabase();
  const { dateRange, loading: dateLoading } = useDateRange();
  const [prodData, setProdData] = useState<any[]>([]);
  const [adsData, setAdsData] = useState<any[]>([]);
  const [channelData, setChannelData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [brandFilter, setBrandFilter] = useState('all');

  // ── Fetch data (with cache) ──
  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    const { from, to } = dateRange;

    // Check cache for all 3 tables
    const cachedProd = getCached<any[]>('daily_product_summary_mkt', from, to);
    const cachedAds  = getCached<any[]>('daily_ads_spend', from, to);
    const cachedCh   = getCached<any[]>('daily_channel_data_mkt', from, to);

    if (cachedProd && cachedAds && cachedCh) {
      setProdData(cachedProd.filter(d => isActiveBrand(d.product)));
      setAdsData(cachedAds);
      setChannelData(cachedCh);
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all([
      supabase.from('daily_product_summary').select('date, product, net_sales, mkt_cost')
        .gte('date', from).lte('date', to),
      supabase.from('daily_ads_spend').select('date, source, spent, store')
        .gte('date', from).lte('date', to),
      supabase.from('daily_channel_data').select('date, channel, product, net_sales, mp_admin_cost')
        .gte('date', from).lte('date', to),
    ]).then(([{ data: prod }, { data: ads }, { data: ch }]) => {
      const prodRows = prod || [];
      const adsRows = ads || [];
      const chRows = ch || [];
      setCache('daily_product_summary_mkt', from, to, prodRows);
      setCache('daily_ads_spend', from, to, adsRows);
      setCache('daily_channel_data_mkt', from, to, chRows);
      setProdData(prodRows.filter(d => isActiveBrand(d.product)));
      setAdsData(adsRows);
      setChannelData(chRows);
      setLoading(false);
    });
  }, [dateRange, supabase]);

  // ── KPI calculations ──
  const { totalRevenue, totalSpend, totalRatio, totalRoas, avgDailyRatio, avgDailyRoas, activeDays } = useMemo(() => {
    const rev = prodData.reduce((s, d) => s + Number(d.net_sales || 0), 0);
    const spend = adsData.reduce((s, d) => s + Math.abs(Number(d.spent || 0)), 0);
    const byDate: Record<string, { rev: number; spend: number }> = {};
    prodData.forEach(d => {
      if (!byDate[d.date]) byDate[d.date] = { rev: 0, spend: 0 };
      byDate[d.date].rev += Number(d.net_sales || 0);
    });
    adsData.forEach(d => {
      if (!byDate[d.date]) byDate[d.date] = { rev: 0, spend: 0 };
      byDate[d.date].spend += Math.abs(Number(d.spent || 0));
    });
    const days = Object.values(byDate).filter(d => d.rev > 0 || d.spend > 0);
    const dailyRatios = days.map(d => d.rev > 0 ? (d.spend / d.rev) * 100 : 0);
    const dailyRoas = days.map(d => d.spend > 0 ? d.rev / d.spend : 0);
    return {
      totalRevenue: rev, totalSpend: spend,
      totalRatio: rev > 0 ? (spend / rev) * 100 : 0,
      totalRoas: spend > 0 ? rev / spend : 0,
      avgDailyRatio: dailyRatios.length > 0 ? dailyRatios.reduce((a, b) => a + b, 0) / dailyRatios.length : 0,
      avgDailyRoas: dailyRoas.length > 0 ? dailyRoas.reduce((a, b) => a + b, 0) / dailyRoas.length : 0,
      activeDays: days.length,
    };
  }, [prodData, adsData]);

  // ── Daily chart data ──
  const ratioChartData = useMemo(() => {
    const byDate: Record<string, { rev: number; spend: number }> = {};
    prodData.forEach(d => {
      if (!byDate[d.date]) byDate[d.date] = { rev: 0, spend: 0 };
      byDate[d.date].rev += Number(d.net_sales || 0);
    });
    adsData.forEach(d => {
      if (!byDate[d.date]) byDate[d.date] = { rev: 0, spend: 0 };
      byDate[d.date].spend += Math.abs(Number(d.spent || 0));
    });
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([, v]) => v.rev > 0 || v.spend > 0)
      .map(([date, v]) => ({
        date: new Date(date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
        Revenue: v.rev,
        'Ad Spend': v.spend,
        'Mkt Ratio %': v.rev > 0 ? parseFloat(((v.spend / v.rev) * 100).toFixed(1)) : 0,
      }));
  }, [prodData, adsData]);

  // ── Daily Ad Spend by Brand ──
  const dailyBrandData = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {};
    const brands = new Set<string>();
    adsData.forEach(d => {
      const date = new Date(d.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      const brand = normStore(d.store);
      brands.add(brand);
      if (!byDate[date]) byDate[date] = {};
      byDate[date][brand] = (byDate[date][brand] || 0) + Math.abs(Number(d.spent || 0));
    });
    const sortedDates = Object.entries(byDate).sort(([a], [b]) => {
      const da = new Date(a.split(' ').reverse().join(' '));
      const db = new Date(b.split(' ').reverse().join(' '));
      return da.getTime() - db.getTime();
    });
    return { data: sortedDates.map(([date, vals]) => ({ date, ...vals })), brands: Array.from(brands).sort() };
  }, [adsData]);

  // ── Unique brands for filter ──
  const uniqueBrands = useMemo(() => {
    const set = new Set<string>();
    adsData.forEach(d => { const brand = normStore(d.store); if (brand && brand !== 'Other') set.add(brand); });
    return Array.from(set).sort();
  }, [adsData]);

  const { activeBrands, isActiveBrand } = useActiveBrands();

const BRAND_COLORS = useMemo(() => {
  return buildBrandColorMap([...uniqueBrands, ...activeBrands]);
}, [uniqueBrands, activeBrands]);



  // ══════════════════════════════════════════════════════════════════════
  // DAILY AD SPEND BY TRAFFIC SOURCE — standalone table (like Daily Shipments)
  // ══════════════════════════════════════════════════════════════════════
  const dailyTrafficSource = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {};
    const sources = new Set<string>();
    const revenueByDate: Record<string, number> = {};

    prodData.forEach(d => {
      revenueByDate[d.date] = (revenueByDate[d.date] || 0) + Number(d.net_sales || 0);
    });

    adsData.forEach(d => {
      const platform = normPlatform(d.source);
      sources.add(platform);
      if (!byDate[d.date]) byDate[d.date] = {};
      byDate[d.date][platform] = (byDate[d.date][platform] || 0) + Math.abs(Number(d.spent || 0));
    });

    const sourceOrder = ['Meta Ads', 'Google Ads', 'Shopee Ads', 'TikTok Ads', 'SnackVideo Ads', 'Other'];
    const sortedSources = sourceOrder.filter(s => sources.has(s));
    sources.forEach(s => { if (!sortedSources.includes(s)) sortedSources.push(s); });

    const rows = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, vals]) => {
        const total = Object.values(vals).reduce((a, b) => a + b, 0);
        const rev = revenueByDate[date] || 0;
        const ratio = rev > 0 ? (total / rev) * 100 : 0;
        return {
          date,
          dateLabel: `${new Date(date).getDate()}/${new Date(date).getMonth() + 1}`,
          values: vals,
          total,
          rev,
          ratio,
        };
      });

    const totals: Record<string, number> = {};
    sortedSources.forEach(s => { totals[s] = rows.reduce((sum, r) => sum + (r.values[s] || 0), 0); });
    const grandTotal = rows.reduce((s, r) => s + r.total, 0);
    const grandRev = rows.reduce((s, r) => s + r.rev, 0);
    const grandRatio = grandRev > 0 ? (grandTotal / grandRev) * 100 : 0;

    return { rows, sources: sortedSources, totals, grandTotal, grandRatio };
  }, [adsData, prodData]);

  // ══════════════════════════════════════════════════════════════════════
  // PLATFORM BREAKDOWN — exclusive Channel ROAS + sub-source breakdown
  // ══════════════════════════════════════════════════════════════════════
  const platformBreakdown = useMemo(() => {
    const filteredAds = brandFilter === 'all' ? adsData : adsData.filter(d => normStore(d.store) === brandFilter);

    const byPlatform: Record<string, { total: number; subs: Record<string, number> }> = {};
    filteredAds.forEach(d => {
      const platform = normPlatform(d.source);
      const sub = getSubSource(d.source);
      const spent = Math.abs(Number(d.spent || 0));
      if (!byPlatform[platform]) byPlatform[platform] = { total: 0, subs: {} };
      byPlatform[platform].total += spent;
      if (sub) { byPlatform[platform].subs[sub] = (byPlatform[platform].subs[sub] || 0) + spent; }
    });

    const channelRev: Record<string, number> = {};
    channelData.forEach(d => {
      if (brandFilter !== 'all' && d.product !== brandFilter) return;
      const ch = d.channel || 'Other';
      channelRev[ch] = (channelRev[ch] || 0) + Number(d.net_sales || 0);
    });

    const channelAdminFee: Record<string, number> = {};
    channelData.forEach(d => {
      if (brandFilter !== 'all' && d.product !== brandFilter) return;
      const ch = d.channel || 'Other';
      channelAdminFee[ch] = (channelAdminFee[ch] || 0) + Math.abs(Number(d.mp_admin_cost || 0));
    });

    const totalSpendAll = Object.values(byPlatform).reduce((a, b) => a + b.total, 0);
    const numDays = new Set(filteredAds.map(d => d.date)).size || 1;

    const result = Object.entries(byPlatform)
      .sort(([, a], [, b]) => b.total - a.total)
      .map(([platform, data]) => {
        const revenueChannels = PLATFORM_CHANNEL_MAP[platform];
        const revenueLabel = PLATFORM_CHANNEL_LABEL[platform] || '—';
        const channelRevenue = revenueChannels ? revenueChannels.reduce((sum, ch) => sum + (channelRev[ch] || 0), 0) : 0;
        const adminFee = revenueChannels ? revenueChannels.reduce((sum, ch) => sum + (channelAdminFee[ch] || 0), 0) : 0;
        const roas = data.total > 0 && channelRevenue > 0 ? channelRevenue / data.total : 0;
        const totalCost = data.total + adminFee;
        const effectiveRoas = totalCost > 0 && channelRevenue > 0 ? channelRevenue / totalCost : 0;

        const subDetails = Object.entries(data.subs)
          .sort(([, a], [, b]) => b - a)
          .map(([name, spent]) => ({ name, spent, pct: data.total > 0 ? (spent / data.total) * 100 : 0 }));

        return {
          platform, spent: data.total,
          pct: totalSpendAll > 0 ? (data.total / totalSpendAll) * 100 : 0,
          dailyAvg: data.total / numDays, roas, adminFee, effectiveRoas,
          revenueChannel: revenueLabel, channelRevenue, subDetails,
          color: PLATFORM_COLORS[platform] || '#64748b',
        };
      });

    // Other Marketplace row
    const otherMpChannels = PLATFORM_CHANNEL_MAP['Other Marketplace'] || [];
    const otherMpRevenue = otherMpChannels.reduce((sum, ch) => sum + (channelRev[ch] || 0), 0);
    if (otherMpRevenue > 0) {
      const otherMpSubs = otherMpChannels
        .map(ch => ({ name: ch, spent: channelRev[ch] || 0, pct: otherMpRevenue > 0 ? ((channelRev[ch] || 0) / otherMpRevenue) * 100 : 0 }))
        .filter(s => s.spent > 0).sort((a, b) => b.spent - a.spent);
      const otherMpAdminFee = otherMpChannels.reduce((sum, ch) => sum + (channelAdminFee[ch] || 0), 0);
      result.push({
        platform: 'Other Marketplace', spent: 0, pct: 0, dailyAvg: 0, roas: 0,
        adminFee: otherMpAdminFee,
        effectiveRoas: otherMpAdminFee > 0 && otherMpRevenue > 0 ? otherMpRevenue / otherMpAdminFee : 0,
        revenueChannel: 'Other MP', channelRevenue: otherMpRevenue, subDetails: otherMpSubs, color: '#64748b',
      });
    }

    // Reseller row
    const resellerRevenue = channelRev['Reseller'] || 0;
    if (resellerRevenue > 0) {
      result.push({
        platform: 'Reseller', spent: 0, pct: 0, dailyAvg: 0, roas: 0,
        adminFee: 0, effectiveRoas: 0, revenueChannel: 'Reseller',
        channelRevenue: resellerRevenue, subDetails: [], color: '#f59e0b',
      });
    }

    return result;
  }, [adsData, channelData, brandFilter]);

  // ── Per-brand matrix ──
  const brandPlatformMatrix = useMemo(() => {
    if (brandFilter !== 'all') return [];
    const matrix: Record<string, Record<string, number>> = {};
    const allPlatforms = new Set<string>();
    adsData.forEach(d => {
      const brand = normStore(d.store);
      const platform = normPlatform(d.source);
      allPlatforms.add(platform);
      if (!matrix[brand]) matrix[brand] = {};
      matrix[brand][platform] = (matrix[brand][platform] || 0) + Math.abs(Number(d.spent || 0));
    });
    const platforms = Array.from(allPlatforms).sort();
    const rows = Object.entries(matrix)
      .map(([brand, pd]) => ({ brand, ...pd, _total: Object.values(pd).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b._total - a._total);
    return { rows, platforms };
  }, [adsData, brandFilter]);

  // ── Filtered total revenue (respects brandFilter, no double counting) ──
  const filteredTotalRevenue = useMemo(() => {
    return channelData.reduce((sum, d) => {
      if (brandFilter !== 'all' && d.product !== brandFilter) return sum;
      return sum + Number(d.net_sales || 0);
    }, 0);
  }, [channelData, brandFilter]);

  // ── Styles ──
  const C = { bg: '#0a0f1a', card: '#111a2e', bdr: '#1a2744', dim: '#64748b', txt: '#e2e8f0' };

  const KPI = ({ label, val, sub, color = '#3b82f6' }: any) => (
    <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: '16px 18px', flex: '1 1 160px', minWidth: 150, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{ fontSize: 11, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1.1 }}>{val}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{sub}</div>}
    </div>
  );

  if (loading || dateLoading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
      <div style={{ color: C.dim, fontSize: 14 }}>Memuat data marketing...</div>
    </div>
  );

  if (adsData.length === 0 && prodData.length === 0) return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Belum Ada Data Marketing</div>
      <div style={{ fontSize: 13, color: C.dim }}>Upload data melalui halaman Admin atau ubah filter tanggal.</div>
    </div>
  );

  return (
    <div className="fade-in">
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Marketing</h2>

      {/* ── KPI Cards ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <KPI label="Total Revenue" val={`Rp ${fmtCompact(totalRevenue)}`} sub={`Avg: Rp ${fmtCompact(activeDays > 0 ? totalRevenue / activeDays : 0)}/hari`} color="#3b82f6" />
        <KPI label="Total Ad Spend" val={`Rp ${fmtCompact(totalSpend)}`} sub={`Avg: Rp ${fmtCompact(activeDays > 0 ? totalSpend / activeDays : 0)}/hari`} color="#f59e0b" />
        <KPI label="Mkt Ratio" val={`${totalRatio.toFixed(1)}%`} sub={`Avg: ${avgDailyRatio.toFixed(1)}%/hari`} color={totalRatio > 30 ? '#ef4444' : totalRatio > 20 ? '#f59e0b' : '#10b981'} />
        <KPI label="Eff. ROAS" val={`${(() => { const totalAdmin = platformBreakdown.reduce((s, p) => s + (p.adminFee || 0), 0); const tc = totalSpend + totalAdmin; return tc > 0 ? (totalRevenue / tc).toFixed(1) : '0.0'; })()}x`} sub={`Ads only: ${totalRoas.toFixed(1)}x`} color="#8b5cf6" />
      </div>

      {/* ── Daily Ad Spend & Mkt Ratio Chart ── */}
      {ratioChartData.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Daily Ad Spend & Marketing Ratio</div>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={ratioChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.bdr} />
              <XAxis dataKey="date" stroke={C.dim} fontSize={11} />
              <YAxis yAxisId="left" stroke={C.dim} fontSize={11} tickFormatter={(v: number) => fmtCompact(v)} />
              <YAxis yAxisId="right" orientation="right" stroke="#ef4444" fontSize={11} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div style={{ background: '#1e293b', border: `1px solid ${C.bdr}`, borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
                      {payload.map((p: any, i: number) => (
                        <div key={i} style={{ color: p.color || p.stroke, marginBottom: 2, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span>{p.name}</span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                            {p.name === 'Mkt Ratio %' ? `${p.value}%` : `Rp ${fmtCompact(p.value)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Bar yAxisId="left" dataKey="Revenue" fill="#3b82f6" fillOpacity={0.4} radius={[4, 4, 0, 0]} />
              <Bar yAxisId="left" dataKey="Ad Spend" fill="#f59e0b" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
              <Line yAxisId="right" type="monotone" dataKey="Mkt Ratio %" stroke="#ef4444" strokeWidth={2} dot={{ fill: '#ef4444', r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>

        </div>
      )}

      {/* ── Daily Ad Spend by Traffic Source — Standalone Table ── */}
      {dailyTrafficSource.rows.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Daily Ad Spend</div>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', color: C.dim, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', left: 0, background: C.card, zIndex: 1 }}>Date</th>
                  {dailyTrafficSource.sources.map(s => (
                    <th key={s} style={{ padding: '8px 8px', textAlign: 'right', color: PLATFORM_COLORS[s] || C.dim, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{s.replace(' Ads', '')}</th>
                  ))}
                  <th style={{ padding: '8px 10px', textAlign: 'right', color: C.dim, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', color: C.dim, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Mkt Ratio</th>
                </tr>
              </thead>
              <tbody>
                {dailyTrafficSource.rows.map((r) => (
                  <tr key={r.date} style={{ borderBottom: `1px solid ${C.bdr}22` }}>
                    <td style={{ padding: '8px 10px', fontWeight: 500, whiteSpace: 'nowrap', fontSize: 12, position: 'sticky', left: 0, background: C.card, zIndex: 1 }}>{r.dateLabel}</td>
                    {dailyTrafficSource.sources.map(s => (
                      <td key={s} style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: (r.values[s] || 0) > 0 ? C.txt : `${C.dim}44` }}>
                        {(r.values[s] || 0) > 0 ? fmtCompact(r.values[s]) : '—'}
                      </td>
                    ))}
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, fontSize: 12 }}>{fmtCompact(r.total)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: r.ratio > 40 ? '#ef4444' : r.ratio > 25 ? '#f59e0b' : '#10b981' }}>
                      {r.ratio > 0 ? `${r.ratio.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${C.bdr}` }}>
                  <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 12, position: 'sticky', left: 0, background: C.card, zIndex: 1 }}>TOTAL</td>
                  {dailyTrafficSource.sources.map(s => (
                    <td key={s} style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: PLATFORM_COLORS[s] || C.txt }}>
                      {dailyTrafficSource.totals[s] > 0 ? fmtCompact(dailyTrafficSource.totals[s]) : '—'}
                    </td>
                  ))}
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{fmtCompact(dailyTrafficSource.grandTotal)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: dailyTrafficSource.grandRatio > 40 ? '#ef4444' : dailyTrafficSource.grandRatio > 25 ? '#f59e0b' : '#10b981' }}>
                    {dailyTrafficSource.grandRatio.toFixed(1)}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Daily Ad Spend by Brand ── */}
      {dailyBrandData.data.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Daily Ad Spend — By Brand</div>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>Breakdown pengeluaran iklan harian per brand</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dailyBrandData.data}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.bdr} />
              <XAxis dataKey="date" stroke={C.dim} fontSize={11} />
              <YAxis stroke={C.dim} fontSize={11} tickFormatter={(v: number) => fmtCompact(v)} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0);
                  return (
                    <div style={{ background: '#1e293b', border: `1px solid ${C.bdr}`, borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
                      {payload.filter((p: any) => p.value > 0).map((p: any, i: number) => (
                        <div key={i} style={{ color: p.fill, marginBottom: 2, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span>{p.dataKey}</span>
                          <span style={{ fontFamily: 'monospace' }}>Rp {fmtCompact(p.value)}</span>
                        </div>
                      ))}
                      <div style={{ borderTop: '1px solid #334155', marginTop: 4, paddingTop: 4, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
                        <span>Total</span><span style={{ fontFamily: 'monospace' }}>Rp {fmtCompact(total)}</span>
                      </div>
                    </div>
                  );
                }}
              />
              {dailyBrandData.brands.map((brand, idx) => (
                <Bar key={brand} dataKey={brand} stackId="a" fill={BRAND_COLORS[brand] || '#64748b'}
                  radius={idx === dailyBrandData.brands.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, justifyContent: 'center' }}>
            {dailyBrandData.brands.map(b => (
              <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: C.dim }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: BRAND_COLORS[b] || '#64748b' }} />{b}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* Ad Spend by Traffic Source — Exclusive Channel ROAS              */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Ad Spend by Traffic Source</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>ROAS per channel atribusi — exclusive, tanpa double count</div>
          </div>
          <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}
            style={{ background: '#1a2744', border: `1px solid ${C.bdr}`, borderRadius: 8, padding: '6px 12px', color: C.txt, fontSize: 13, cursor: 'pointer', outline: 'none' }}>
            <option value="all">All Brands</option>
            {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {platformBreakdown.length > 0 ? (
          <>
            {/* Bar chart */}
            <ResponsiveContainer width="100%" height={Math.max(platformBreakdown.length * 50, 120)}>
              <BarChart data={platformBreakdown} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.bdr} horizontal={false} />
                <XAxis type="number" stroke={C.dim} fontSize={11} tickFormatter={(v: number) => fmtCompact(v)} />
                <YAxis type="category" dataKey="platform" stroke={C.dim} fontSize={12} width={110} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={{ background: '#1e293b', border: `1px solid ${C.bdr}`, borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
                        <div style={{ fontWeight: 700, marginBottom: 6, color: d.color }}>{d.platform}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, marginBottom: 2 }}>
                          <span style={{ color: C.dim }}>Total Spent</span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmtRupiah(d.spent)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, marginBottom: 2 }}>
                          <span style={{ color: C.dim }}>Revenue ({d.revenueChannel})</span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmtRupiah(d.channelRevenue)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
                          <span style={{ color: C.dim }}>ROAS</span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: d.roas >= 3 ? '#10b981' : d.roas >= 1.5 ? '#f59e0b' : '#ef4444' }}>
                            {d.roas > 0 ? `${d.roas.toFixed(1)}x` : '—'}
                          </span>
                        </div>
                        {d.subDetails.length > 0 && (
                          <div style={{ borderTop: '1px solid #334155', marginTop: 6, paddingTop: 6 }}>
                            <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>Termasuk:</div>
                            {d.subDetails.map((s: any) => (
                              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 11, color: '#94a3b8' }}>
                                <span>{s.name}</span>
                                <span style={{ fontFamily: 'monospace' }}>{fmtRupiah(s.spent)} ({s.pct.toFixed(0)}%)</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="spent" radius={[0, 6, 6, 0]}>
                  {platformBreakdown.map((entry, i) => <Cell key={i} fill={entry.color} fillOpacity={0.85} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Detail table */}
            <div style={{ overflowX: 'auto', marginTop: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                    {['Traffic Source', 'Spent', '% of Total', 'Daily Avg', 'Channel', 'Revenue', 'ROAS', 'Admin Fee', 'Eff. ROAS'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Traffic Source' ? 'left' : 'right', color: C.dim, fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {platformBreakdown.map((p) => (
                    <tr key={p.platform} style={{ borderBottom: `1px solid ${C.bdr}22` }}>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                          <div>
                            <span style={{ fontWeight: 600 }}>{p.platform}</span>
                            {p.subDetails.length > 0 && (
                              <div style={{ fontSize: 10, color: C.dim, marginTop: 2, lineHeight: 1.4 }}>
                                {p.spent > 0
                                  ? `Termasuk: ${p.subDetails.map(s => `${s.name} ${s.pct.toFixed(0)}%`).join(', ')}`
                                  : p.subDetails.map(s => `${s.name}: Rp ${fmtCompact(s.spent)}`).join(', ')
                                }
                              </div>
                            )}
                            {p.platform === 'Meta Ads' && (
                              <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>Serve 2 sales channel: Scalev + Organik (spillover)</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>Rp {fmtCompact(p.spent)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.dim }}>{p.pct.toFixed(1)}%</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.dim }}>Rp {fmtCompact(p.dailyAvg)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontSize: 11, color: CHANNEL_COLORS[p.revenueChannel] || C.dim }}>{p.revenueChannel}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.dim }}>Rp {fmtCompact(p.channelRevenue)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: p.roas >= 3 ? '#10b981' : p.roas >= 1.5 ? '#f59e0b' : '#ef4444' }}>
                        {p.roas > 0 ? `${p.roas.toFixed(1)}x` : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: p.adminFee > 0 ? '#f59e0b' : `${C.dim}66` }}>
                        {p.adminFee > 0 ? `Rp ${fmtCompact(p.adminFee)}` : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: p.effectiveRoas >= 3 ? '#10b981' : p.effectiveRoas >= 1.5 ? '#f59e0b' : p.effectiveRoas > 0 ? '#ef4444' : `${C.dim}44` }}>
                        {p.effectiveRoas > 0 ? `${p.effectiveRoas.toFixed(1)}x` : p.adminFee === 0 && p.roas > 0 ? `${p.roas.toFixed(1)}x` : '—'}
                      </td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: `2px solid ${C.bdr}` }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>TOTAL</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>Rp {fmtCompact(platformBreakdown.reduce((s, p) => s + p.spent, 0))}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>100%</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>Rp {fmtCompact(platformBreakdown.reduce((s, p) => s + p.dailyAvg, 0))}</td>
                    <td style={{ padding: '8px 10px' }}></td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>Rp {fmtCompact(filteredTotalRevenue)}</td>
                    {(() => {
                      const filteredSpend = platformBreakdown.reduce((s, p) => s + p.spent, 0);
                      const filteredRoas = filteredSpend > 0 ? filteredTotalRevenue / filteredSpend : 0;
                      const totalAdmin = platformBreakdown.reduce((s, p) => s + p.adminFee, 0);
                      const totalAllCost = filteredSpend + totalAdmin;
                      const effRoas = totalAllCost > 0 ? filteredTotalRevenue / totalAllCost : 0;
                      return (
                        <>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: filteredRoas >= 3 ? '#10b981' : filteredRoas >= 1.5 ? '#f59e0b' : '#ef4444' }}>{filteredRoas.toFixed(1)}x</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#f59e0b' }}>Rp {fmtCompact(totalAdmin)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: effRoas >= 3 ? '#10b981' : effRoas >= 1.5 ? '#f59e0b' : '#ef4444' }}>{effRoas.toFixed(1)}x</td>
                        </>
                      );
                    })()}
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Meta Demand Generator Callout */}
            <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 10, background: 'linear-gradient(135deg, #1877f211 0%, #8b5cf611 100%)', border: '1px solid #1877f233' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 16, lineHeight: 1.4, flexShrink: 0 }}>💡</span>
                <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.6 }}>
                  <span style={{ fontWeight: 700, color: '#93c5fd' }}>Meta Ads sebagai Demand Generator — </span>
                  ROAS Meta Ads dihitung exclusive terhadap revenue <span style={{ color: CHANNEL_COLORS['Scalev'], fontWeight: 600 }}>Scalev</span>.
                  Namun Meta Ads juga menciptakan demand yang spillover ke{' '}
                  <span style={{ color: CHANNEL_COLORS['Shopee'], fontWeight: 600 }}>Shopee</span> (konsumen search di marketplace setelah lihat iklan)
                  dan <span style={{ color: '#10b981', fontWeight: 600 }}>repeat order organik</span>.
                  Kontribusi sebenarnya Meta Ads kemungkinan lebih besar dari ROAS yang ditampilkan.
                </div>
              </div>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '30px 0', color: C.dim, fontSize: 13 }}>
            Tidak ada data ads untuk {brandFilter === 'all' ? 'periode ini' : brandFilter}
          </div>
        )}
      </div>

      {/* ── Brand × Traffic Source Matrix ── */}
      {brandFilter === 'all' && brandPlatformMatrix.rows?.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Brand × Traffic Source Matrix</div>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>Alokasi ads spend tiap brand ke tiap traffic source</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 500 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', color: C.dim, fontWeight: 600, fontSize: 11, position: 'sticky', left: 0, background: C.card }}>Brand</th>
                  {brandPlatformMatrix.platforms?.map((p: string) => (
                    <th key={p} style={{ padding: '8px 6px', textAlign: 'right', color: PLATFORM_COLORS[p] || C.dim, fontWeight: 600, fontSize: 10, whiteSpace: 'nowrap' }}>{p}</th>
                  ))}
                  <th style={{ padding: '8px 10px', textAlign: 'right', color: '#f1f5f9', fontWeight: 700, fontSize: 11 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {brandPlatformMatrix.rows?.map((row: any) => (
                  <tr key={row.brand} style={{ borderBottom: `1px solid ${C.bdr}22` }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600, position: 'sticky', left: 0, background: C.card, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: BRAND_COLORS[row.brand] || '#64748b', flexShrink: 0 }} />
                      {row.brand}
                    </td>
                    {brandPlatformMatrix.platforms?.map((p: string) => (
                      <td key={p} style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: row[p] > 0 ? C.txt : `${C.dim}66` }}>
                        {row[p] > 0 ? fmtCompact(row[p]) : '—'}
                      </td>
                    ))}
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{fmtCompact(row._total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
