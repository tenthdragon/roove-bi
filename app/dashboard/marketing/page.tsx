// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import { fmtCompact, fmtRupiah } from '@/lib/utils';
import { useDateRange } from '@/lib/DateRangeContext';
import { getCached, setCache } from '@/lib/dashboard-cache';
import { getMarketingPageData } from '@/lib/marketing-actions';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Line, Cell
} from 'recharts';
import { useActiveBrands } from '@/lib/ActiveBrandsContext';
import { buildBrandColorMap } from '@/lib/utils';

function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftIsoDateByMonthsClamped(value: string, deltaMonths: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const totalMonths = year * 12 + (month - 1) + deltaMonths;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = ((totalMonths % 12) + 12) % 12;
  const targetMonth = targetMonthIndex + 1;
  const targetDay = Math.min(day, getDaysInMonth(targetYear, targetMonth));
  return formatIsoDate(targetYear, targetMonth, targetDay);
}

const LEGACY_STORE_BRAND_FALLBACKS: Record<string, string> = {
  'purvu store': 'Purvu',
  plume: 'Pluve',
};

// ── Mapping: Ads Source → Marketing Platform ──
// Marketing POV: ads spend attributed to all sales channels they impact (including organic spillover)
//
// Sales Channel (DB)  | Marketing Channels that serve it
// ────────────────────|──────────────────────────────────
// Scalev Ads              | Meta Ads (Non CPAS, WABA/CTWA), Google Ads
// CS Manual               | WhatsApp BC / Marketing Message (future)
// Shopee              | Shopee Ads, Meta Ads CPAS
// TikTok Shop         | TikTok Ads, TikTokShop Ads
// MP lain             | MP lain Ads (future)
//
// NOTE: On marketing page, Meta Ads also attributes to CS Manual (spillover effect).
//       On channels/sales page, CS Manual has zero ads cost.
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

// ── Sub-source label for breakdown detail ──
function getSubSource(source: string): string | null {
  if (!source) return null;
  const s = source.toLowerCase();
  if (s.includes('cpas')) return 'CPAS';
  if (s.includes('shopee') && s.includes('live')) return 'Shopee Live';
  // WABA is its own platform now, no sub-source needed
  if (s.includes('tiktok shop') || s.includes('tiktokshop')) return 'TikTok Shop';
  return null;
}

// ── Marketing Platform → Sales Channels served (marketing POV, includes organic spillover) ──
const PLATFORM_CHANNEL_MAP: Record<string, string[]> = {
  'Meta Ads':          ['Scalev Ads', 'CS Manual'],
  'Google Ads':        ['Scalev Ads', 'CS Manual'],
  'Shopee Ads':        ['Shopee'],
  'TikTok Ads':        ['TikTok Shop'],
  'Other Marketplace': ['Tokopedia', 'BliBli', 'Lazada'],
  'WABA MM Cost':      ['WABA'],
};

const PLATFORM_CHANNEL_LABEL: Record<string, string> = {
  'Meta Ads':          'Scalev Ads',
  'Google Ads':        'Scalev Ads',
  'Shopee Ads':        'Shopee',
  'TikTok Ads':        'TikTok Shop',
  'Other Marketplace': 'Other MP',
  'WABA MM Cost':      'WABA',
};

// ── Platform colors ──
const PLATFORM_COLORS: Record<string, string> = {
  'Meta Ads': '#1877f2', 'Google Ads': '#4285f4', 'TikTok Ads': '#ff0050',
  'Shopee Ads': '#ee4d2d', 'SnackVideo Ads': '#fbbf24', 'Other Marketplace': '#64748b',
  'Reseller': '#f59e0b', 'WABA MM Cost': '#25D366', 'Other': '#64748b',
};

// ── Channel colors ──
const CHANNEL_COLORS: Record<string, string> = {
  'Scalev Ads': '#1877f2', 'CS Manual': '#10b981', 'Shopee': '#ee4d2d', 'TikTok Shop': '#00f2ea',
  'Tokopedia': '#42b549', 'BliBli': '#06b6d4', 'Lazada': '#1a237e', 'Reseller': '#f59e0b',
};

export default function MarketingPage() {
  const { dateRange, loading: dateLoading } = useDateRange();
  const [rawProdData, setRawProdData] = useState<any[]>([]);
  const [adsData, setAdsData] = useState<any[]>([]);
  const [channelData, setChannelData] = useState<any[]>([]);
  const [brandMapping, setBrandMapping] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  const [dailyAdSpendOpen, setDailyAdSpendOpen] = useState(false);
  const [prevRangeAdsData, setPrevRangeAdsData] = useState<any[]>([]);
  const [prevRangeChannelData, setPrevRangeChannelData] = useState<any[]>([]);
  const { activeBrands, loading: activeBrandsLoading, error: activeBrandsError, isActiveBrand } = useActiveBrands();

  const storeBrandMap = useMemo(() => {
    const map: Record<string, string> = {};
    brandMapping.forEach(row => {
      if (!row.store_pattern || !row.brand) return;
      map[row.store_pattern.toLowerCase()] = row.brand;
    });
    return map;
  }, [brandMapping]);

  const activeBrandMap = useMemo(() => {
    const map: Record<string, string> = {};
    activeBrands.forEach((brand) => {
      if (!brand) return;
      map[brand.toLowerCase()] = brand;
    });
    return map;
  }, [activeBrands]);

  const getAdBrand = (store: string) => {
    if (!store) return null;
    const key = store.trim().toLowerCase();
    return storeBrandMap[key] || activeBrandMap[key] || LEGACY_STORE_BRAND_FALLBACKS[key] || null;
  };

  const prodData = useMemo(
    () => rawProdData.filter(d => isActiveBrand(d.product)),
    [rawProdData, activeBrands, activeBrandsError, isActiveBrand]
  );

  const resolvedAdsData = useMemo(() => {
    return adsData
      .map((d) => {
        const brand = getAdBrand(d.store);
        return { ...d, brand };
      })
      .filter((d) => !d.brand || isActiveBrand(d.brand));
  }, [adsData, storeBrandMap, activeBrandMap, activeBrands, activeBrandsError, isActiveBrand]);

  const attributedAdsData = useMemo(
    () => resolvedAdsData.filter((d) => Boolean(d.brand)),
    [resolvedAdsData]
  );

  const filteredChannelData = useMemo(
    () => channelData.filter(d => isActiveBrand(d.product)),
    [channelData, activeBrands, activeBrandsError, isActiveBrand]
  );

  const resolvedPrevRangeAdsData = useMemo(() => {
    return prevRangeAdsData
      .map((d) => {
        const brand = getAdBrand(d.store);
        return { ...d, brand };
      })
      .filter((d) => !d.brand || isActiveBrand(d.brand));
  }, [prevRangeAdsData, storeBrandMap, activeBrandMap, activeBrands, activeBrandsError, isActiveBrand]);

  const attributedPrevRangeAdsData = useMemo(
    () => resolvedPrevRangeAdsData.filter((d) => Boolean(d.brand)),
    [resolvedPrevRangeAdsData]
  );

  const filteredPrevRangeChannelData = useMemo(
    () => prevRangeChannelData.filter(d => isActiveBrand(d.product)),
    [prevRangeChannelData, activeBrands, activeBrandsError, isActiveBrand]
  );

  const unmappedAdsSummary = useMemo(() => {
    const byPlatform: Record<string, number> = {};
    let total = 0;

    resolvedAdsData.forEach((d) => {
      if (d.brand) return;
      const spent = Math.abs(Number(d.spent || 0));
      if (spent <= 0) return;
      const platform = normPlatform(d.source);
      byPlatform[platform] = (byPlatform[platform] || 0) + spent;
      total += spent;
    });

    const platforms = Object.entries(byPlatform)
      .map(([platform, spent]) => ({ platform, spent }))
      .sort((a, b) => b.spent - a.spent);

    return { total, platforms };
  }, [resolvedAdsData]);

  function getComparisonRanges(from: string, to: string) {
    return {
      prevRangeFrom: shiftIsoDateByMonthsClamped(from, -1),
      prevRangeTo: shiftIsoDateByMonthsClamped(to, -1),
    };
  }

  // ── Fetch data (with cache) ──
  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    const { from, to } = dateRange;
    const { prevRangeFrom, prevRangeTo } = getComparisonRanges(from, to);

    const cachedProd = getCached<any[]>('daily_product_summary_mkt', from, to);
    const cachedAds = getCached<any[]>('daily_ads_spend', from, to);
    const cachedCh = getCached<any[]>('daily_channel_data_mkt', from, to);
    const cachedBrandMapping = getCached<any[]>('ads_store_brand_mapping_mkt', 'all', 'all');
    const cachedPrevRangeAds = getCached<any[]>('daily_ads_spend_prev_range', prevRangeFrom, prevRangeTo);
    const cachedPrevRangeCh = getCached<any[]>('daily_channel_data_prev_range', prevRangeFrom, prevRangeTo);

    if (cachedProd && cachedAds && cachedCh && cachedBrandMapping && cachedPrevRangeAds && cachedPrevRangeCh) {
      setRawProdData(cachedProd);
      setAdsData(cachedAds);
      setChannelData(cachedCh);
      setBrandMapping(cachedBrandMapping);
      setPrevRangeAdsData(cachedPrevRangeAds);
      setPrevRangeChannelData(cachedPrevRangeCh);
      setError('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    getMarketingPageData({
      from,
      to,
      prevRangeFrom,
      prevRangeTo,
    })
      .then((data) => {
        if (cancelled) return;

        setCache('daily_product_summary_mkt', from, to, data.prod);
        setCache('daily_ads_spend', from, to, data.ads);
        setCache('daily_channel_data_mkt', from, to, data.channel);
        setCache('ads_store_brand_mapping_mkt', 'all', 'all', data.brandMapping);
        setCache('daily_ads_spend_prev_range', prevRangeFrom, prevRangeTo, data.prevRangeAds);
        setCache('daily_channel_data_prev_range', prevRangeFrom, prevRangeTo, data.prevRangeChannel);

        setRawProdData(data.prod);
        setAdsData(data.ads);
        setChannelData(data.channel);
        setBrandMapping(data.brandMapping);
        setPrevRangeAdsData(data.prevRangeAds);
        setPrevRangeChannelData(data.prevRangeChannel);
        setError('');
        setLoading(false);
      })
      .catch((e: any) => {
        if (cancelled) return;
        console.error('[Marketing] load error:', e);
        setError(e?.message || 'Gagal memuat data marketing.');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [dateRange.from, dateRange.to]);

  // ── KPI calculations ──
  const { totalRevenue, totalSpend, totalRatio, totalRoas, avgDailyRatio, avgDailyRoas, activeDays } = useMemo(() => {
    const rev = prodData.reduce((s, d) => s + Number(d.net_sales || 0), 0);
    const spend = resolvedAdsData.reduce((s, d) => s + Math.abs(Number(d.spent || 0)), 0);
    const byDate: Record<string, { rev: number; spend: number }> = {};
    prodData.forEach(d => {
      if (!byDate[d.date]) byDate[d.date] = { rev: 0, spend: 0 };
      byDate[d.date].rev += Number(d.net_sales || 0);
    });
    resolvedAdsData.forEach(d => {
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
  }, [prodData, resolvedAdsData]);

  // ── Daily chart data ──
  const ratioChartData = useMemo(() => {
    const byDate: Record<string, { rev: number; spend: number }> = {};
    prodData.forEach(d => {
      if (!byDate[d.date]) byDate[d.date] = { rev: 0, spend: 0 };
      byDate[d.date].rev += Number(d.net_sales || 0);
    });
    resolvedAdsData.forEach(d => {
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
  }, [prodData, resolvedAdsData]);

  // ── Daily Ad Spend by Brand ──
  const dailyBrandData = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {};
    const brands = new Set<string>();
    attributedAdsData.forEach(d => {
      const date = new Date(d.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      const brand = d.brand;
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
  }, [attributedAdsData]);

  // ── Unique brands for filter ──
  const uniqueBrands = useMemo(() => {
    const set = new Set<string>();
    attributedAdsData.forEach(d => { if (d.brand) set.add(d.brand); });
    return Array.from(set).sort();
  }, [attributedAdsData]);

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

    resolvedAdsData.forEach(d => {
      const platform = normPlatform(d.source);
      sources.add(platform);
      if (!byDate[d.date]) byDate[d.date] = {};
      byDate[d.date][platform] = (byDate[d.date][platform] || 0) + Math.abs(Number(d.spent || 0));
    });

    const sourceOrder = ['Meta Ads', 'Google Ads', 'Shopee Ads', 'TikTok Ads', 'SnackVideo Ads', 'WABA MM Cost', 'Other'];
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
  }, [resolvedAdsData, prodData]);

  // ── Previous month ad spend per platform (MoM delta for daily table) ──
  const prevAdSpend = useMemo(() => {
    if (resolvedPrevRangeAdsData.length === 0) return null;
    const byPlatform: Record<string, number> = {};
    let total = 0;
    resolvedPrevRangeAdsData.forEach(d => {
      const platform = normPlatform(d.source);
      const spent = Math.abs(Number(d.spent || 0));
      byPlatform[platform] = (byPlatform[platform] || 0) + spent;
      total += spent;
    });
    const prevRev = filteredPrevRangeChannelData
      .reduce((sum, d) => sum + (Number(d.net_sales) || 0), 0);
    const ratio = prevRev > 0 ? (total / prevRev) * 100 : 0;
    const prevAdmin = filteredPrevRangeChannelData
      .reduce((sum, d) => sum + Math.abs(Number(d.mp_admin_cost) || 0), 0);
    const roas = total > 0 ? prevRev / total : 0;
    const effRoas = (total + prevAdmin) > 0 ? prevRev / (total + prevAdmin) : 0;
    return { byPlatform, total, ratio, revenue: prevRev, roas, effRoas };
  }, [resolvedPrevRangeAdsData, filteredPrevRangeChannelData]);

  // ══════════════════════════════════════════════════════════════════════
  // PLATFORM BREAKDOWN — exclusive Channel ROAS + sub-source breakdown
  // ══════════════════════════════════════════════════════════════════════
  const platformBreakdown = useMemo(() => {
    const filteredAds = brandFilter === 'all'
      ? resolvedAdsData
      : attributedAdsData.filter(d => d.brand === brandFilter);

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
    filteredChannelData.forEach(d => {
      if (brandFilter !== 'all' && d.product !== brandFilter) return;
      const ch = d.channel || 'Other';
      channelRev[ch] = (channelRev[ch] || 0) + Number(d.net_sales || 0);
    });

    const channelAdminFee: Record<string, number> = {};
    filteredChannelData.forEach(d => {
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
  }, [resolvedAdsData, attributedAdsData, filteredChannelData, brandFilter]);

  // ── Previous month ROAS lookup (for delta comparison) ──
  const prevRoasMap = useMemo(() => {
    const map: Record<string, { roas: number; effectiveRoas: number }> = {};
    if (resolvedPrevRangeAdsData.length === 0) return map;

    const filteredPrevAds = brandFilter === 'all'
      ? resolvedPrevRangeAdsData
      : attributedPrevRangeAdsData.filter(d => d.brand === brandFilter);

    const byPlatform: Record<string, number> = {};
    filteredPrevAds.forEach(d => {
      const platform = normPlatform(d.source);
      byPlatform[platform] = (byPlatform[platform] || 0) + Math.abs(Number(d.spent || 0));
    });

    const channelRev: Record<string, number> = {};
    const channelAdmin: Record<string, number> = {};
    filteredPrevRangeChannelData.forEach(d => {
      if (brandFilter !== 'all' && d.product !== brandFilter) return;
      const ch = d.channel || 'Other';
      channelRev[ch] = (channelRev[ch] || 0) + Number(d.net_sales || 0);
      channelAdmin[ch] = (channelAdmin[ch] || 0) + Math.abs(Number(d.mp_admin_cost || 0));
    });

    Object.entries(byPlatform).forEach(([platform, spent]) => {
      const revenueChannels = PLATFORM_CHANNEL_MAP[platform];
      const rev = revenueChannels ? revenueChannels.reduce((sum, ch) => sum + (channelRev[ch] || 0), 0) : 0;
      const admin = revenueChannels ? revenueChannels.reduce((sum, ch) => sum + (channelAdmin[ch] || 0), 0) : 0;
      const roas = spent > 0 && rev > 0 ? rev / spent : 0;
      const totalCost = spent + admin;
      const effectiveRoas = totalCost > 0 && rev > 0 ? rev / totalCost : 0;
      map[platform] = { roas, effectiveRoas };
    });

    // Other Marketplace (no ads spend, admin fee only)
    const otherMpChannels = PLATFORM_CHANNEL_MAP['Other Marketplace'] || [];
    const otherMpRevenue = otherMpChannels.reduce((sum, ch) => sum + (channelRev[ch] || 0), 0);
    const otherMpAdmin = otherMpChannels.reduce((sum, ch) => sum + (channelAdmin[ch] || 0), 0);
    if (otherMpRevenue > 0) {
      map['Other Marketplace'] = { roas: 0, effectiveRoas: otherMpAdmin > 0 ? otherMpRevenue / otherMpAdmin : 0 };
    }

    // TOTAL row
    const totalSpendPrev = Object.values(byPlatform).reduce((a, b) => a + b, 0);
    const totalRevPrev = filteredPrevRangeChannelData.reduce((sum, d) => {
      if (brandFilter !== 'all' && d.product !== brandFilter) return sum;
      return sum + Number(d.net_sales || 0);
    }, 0);
    const totalAdminPrev = Object.values(channelAdmin).reduce((a, b) => a + b, 0);
    const totalRoasPrev = totalSpendPrev > 0 ? totalRevPrev / totalSpendPrev : 0;
    const totalEffRoasPrev = (totalSpendPrev + totalAdminPrev) > 0 ? totalRevPrev / (totalSpendPrev + totalAdminPrev) : 0;
    map['__TOTAL__'] = { roas: totalRoasPrev, effectiveRoas: totalEffRoasPrev };

    return map;
  }, [resolvedPrevRangeAdsData, attributedPrevRangeAdsData, filteredPrevRangeChannelData, brandFilter]);

  // ── Delta helpers ──
  const prevMonthLabel = useMemo(() => {
    if (!dateRange.from) return '';
    const fromDate = new Date(dateRange.from + 'T00:00:00');
    const prevMonth = new Date(fromDate.getFullYear(), fromDate.getMonth() - 1, 1);
    return prevMonth.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
  }, [dateRange.from]);

  // ── Per-brand matrix ──
  const brandPlatformMatrix = useMemo(() => {
    if (brandFilter !== 'all') return [];
    const matrix: Record<string, Record<string, number>> = {};
    const allPlatforms = new Set<string>();
    resolvedAdsData.forEach(d => {
      const platform = normPlatform(d.source);
      allPlatforms.add(platform);
    });
    attributedAdsData.forEach(d => {
      const brand = d.brand;
      const platform = normPlatform(d.source);
      if (!matrix[brand]) matrix[brand] = {};
      matrix[brand][platform] = (matrix[brand][platform] || 0) + Math.abs(Number(d.spent || 0));
    });
    const platforms = Array.from(allPlatforms).sort();
    const rows = Object.entries(matrix)
      .map(([brand, pd]) => ({ brand, ...pd, _total: Object.values(pd).reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b._total - a._total);
    return { rows, platforms };
  }, [resolvedAdsData, attributedAdsData, brandFilter]);

  // ── Filtered total revenue (respects brandFilter, no double counting) ──
  const filteredTotalRevenue = useMemo(() => {
    return filteredChannelData.reduce((sum, d) => {
      if (brandFilter !== 'all' && d.product !== brandFilter) return sum;
      return sum + Number(d.net_sales || 0);
    }, 0);
  }, [filteredChannelData, brandFilter]);

  // ── Styles ──
  const C = { bg: 'var(--bg)', card: 'var(--card)', bdr: 'var(--border)', dim: 'var(--dim)', txt: 'var(--text)' };

  const DeltaLine = ({ value, suffix, higherIsBetter, label: lbl }: { value: number; suffix?: string; higherIsBetter?: boolean; label?: string }) => (
    <div style={{ fontSize: 10, marginTop: 4, color: ((value > 0) === (higherIsBetter !== false)) ? '#5b8a7a' : '#9b6b6b' }}>
      {value > 0 ? '▲' : '▼'} {value >= 0 ? '+' : ''}{value.toFixed(1)}{suffix || '%'}{lbl ? ` ${lbl}` : ` vs ${prevMonthLabel}`}
    </div>
  );
  const KPI = ({ label, val, sub, color = 'var(--accent)', delta, delta2 }: any) => (
    <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: '16px 18px', flex: '1 1 160px', minWidth: 150, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{ fontSize: 11, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1.1 }}>{val}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{sub}</div>}
      {delta && delta.value !== 0 && <DeltaLine {...delta} />}
      {delta2 && delta2.value !== 0 && <DeltaLine {...delta2} />}
    </div>
  );

  if (loading || dateLoading || activeBrandsLoading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
      <div style={{ color: C.dim, fontSize: 14 }}>Memuat data marketing...</div>
    </div>
  );

  if (error) return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Data Marketing Gagal Dimuat</div>
      <div style={{ fontSize: 13, color: C.dim, maxWidth: 560, margin: '0 auto' }}>{error}</div>
    </div>
  );

  if (activeBrandsError) return (
    <div style={{ textAlign: 'center', padding: '60px 20px' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Filter Brand Gagal Dimuat</div>
      <div style={{ fontSize: 13, color: C.dim, maxWidth: 560, margin: '0 auto' }}>{activeBrandsError}</div>
    </div>
  );

  if (resolvedAdsData.length === 0 && prodData.length === 0) return (
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
        <KPI label="Total Revenue" val={`Rp ${fmtCompact(totalRevenue)}`} sub={`Avg: Rp ${fmtCompact(activeDays > 0 ? totalRevenue / activeDays : 0)}/hari`} color="var(--accent)"
          delta={prevAdSpend && prevAdSpend.revenue > 0 ? { value: ((totalRevenue - prevAdSpend.revenue) / prevAdSpend.revenue) * 100 } : undefined} />
        <KPI label="Total Ad Spend" val={`Rp ${fmtCompact(totalSpend)}`} sub={`Avg: Rp ${fmtCompact(activeDays > 0 ? totalSpend / activeDays : 0)}/hari`} color="var(--yellow)"
          delta={prevAdSpend && prevAdSpend.total > 0 ? { value: ((totalSpend - prevAdSpend.total) / prevAdSpend.total) * 100, higherIsBetter: false } : undefined} />
        <KPI label="Mkt Ratio" val={`${totalRatio.toFixed(1)}%`} sub={`Avg: ${avgDailyRatio.toFixed(1)}%/hari`} color={totalRatio > 30 ? 'var(--red)' : totalRatio > 20 ? 'var(--yellow)' : 'var(--green)'}
          delta={prevAdSpend && prevAdSpend.ratio > 0 ? { value: totalRatio - prevAdSpend.ratio, suffix: 'pp', higherIsBetter: false } : undefined} />
        {(() => { const totalAdmin = platformBreakdown.reduce((s, p) => s + (p.adminFee || 0), 0); const tc = totalSpend + totalAdmin; const curEffRoas = tc > 0 ? totalRevenue / tc : 0; return (
        <KPI label="Eff. ROAS" val={`${curEffRoas.toFixed(1)}x`} sub={`Ads only: ${totalRoas.toFixed(1)}x`} color="#8b5cf6"
          delta={prevAdSpend && prevAdSpend.effRoas > 0 ? { value: ((curEffRoas - prevAdSpend.effRoas) / prevAdSpend.effRoas) * 100 } : undefined} />
        ); })()}
      </div>

      {/* ── Daily Ad Spend & Mkt Ratio Chart ── */}
      {ratioChartData.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
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
                    <div style={{ background: 'var(--bg-deep)', border: `1px solid ${C.bdr}`, borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
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

      {/* ── Daily Ad Spend (Collapsible) ── */}
      {dailyTrafficSource.rows.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div
            onClick={() => setDailyAdSpendOpen(!dailyAdSpendOpen)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
          >
            <span style={{ fontSize: 13, color: C.dim, transition: 'transform 0.2s', transform: dailyAdSpendOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Daily Ad Spend</span>
            <span style={{ fontSize: 12, color: C.dim }}>({dailyTrafficSource.rows.length} days · month-over-month)</span>
          </div>
          {dailyAdSpendOpen && (<div style={{ marginTop: 16 }}>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', color: C.dim, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', left: 0, background: C.card, zIndex: 1 }}>Date</th>
                  {dailyTrafficSource.sources.map(s => {
                    const tooltip = s === 'Meta Ads' ? 'Meta Ads (not include Meta CPAS)' : s === 'Shopee Ads' ? 'Shopee Ads (include Meta CPAS)' : undefined;
                    return (
                      <th key={s} title={tooltip} style={{ padding: '8px 8px', textAlign: 'right', color: PLATFORM_COLORS[s] || C.dim, fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', cursor: tooltip ? 'help' : undefined }}>
                        {s}{tooltip ? ' ⓘ' : ''}
                      </th>
                    );
                  })}
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
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: r.ratio > 40 ? 'var(--red)' : r.ratio > 25 ? 'var(--yellow)' : 'var(--green)' }}>
                      {r.ratio > 0 ? `${r.ratio.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${C.bdr}` }}>
                  <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 12, position: 'sticky', left: 0, background: C.card, zIndex: 1 }}>TOTAL</td>
                  {dailyTrafficSource.sources.map(s => {
                    const cur = dailyTrafficSource.totals[s] || 0;
                    const prev = prevAdSpend?.byPlatform[s];
                    const delta = prev && prev > 0 ? ((cur - prev) / prev) * 100 : null;
                    return (
                      <td key={s} style={{ padding: '8px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: PLATFORM_COLORS[s] || C.txt }}>
                        {cur > 0 ? (
                          <>
                            <div>{fmtCompact(cur)}</div>
                            {delta !== null && (
                              <div style={{ fontSize: 10, marginTop: 2, fontWeight: 400, color: delta <= 0 ? '#5b8a7a' : '#9b6b6b' }}>
                                {delta >= 0 ? '▲' : '▼'} {delta >= 0 ? '+' : ''}{delta.toFixed(1)}%
                              </div>
                            )}
                          </>
                        ) : '—'}
                      </td>
                    );
                  })}
                  {(() => {
                    const grandDelta = prevAdSpend && prevAdSpend.total > 0 ? ((dailyTrafficSource.grandTotal - prevAdSpend.total) / prevAdSpend.total) * 100 : null;
                    return (
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>
                        <div>{fmtCompact(dailyTrafficSource.grandTotal)}</div>
                        {grandDelta !== null && (
                          <div style={{ fontSize: 10, marginTop: 2, fontWeight: 400, color: grandDelta <= 0 ? '#5b8a7a' : '#9b6b6b' }}>
                            {grandDelta >= 0 ? '▲' : '▼'} {grandDelta >= 0 ? '+' : ''}{grandDelta.toFixed(1)}% vs prev
                          </div>
                        )}
                      </td>
                    );
                  })()}
                  {(() => {
                    const ratioDelta = prevAdSpend && prevAdSpend.ratio > 0 ? dailyTrafficSource.grandRatio - prevAdSpend.ratio : null;
                    return (
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: dailyTrafficSource.grandRatio > 40 ? 'var(--red)' : dailyTrafficSource.grandRatio > 25 ? 'var(--yellow)' : 'var(--green)' }}>
                        <div>{dailyTrafficSource.grandRatio.toFixed(1)}%</div>
                        {ratioDelta !== null && (
                          <div style={{ fontSize: 10, marginTop: 2, fontWeight: 400, color: ratioDelta <= 0 ? '#5b8a7a' : '#9b6b6b' }}>
                            {ratioDelta >= 0 ? '▲' : '▼'} {ratioDelta >= 0 ? '+' : ''}{ratioDelta.toFixed(1)}pp
                          </div>
                        )}
                      </td>
                    );
                  })()}
                </tr>
              </tbody>
            </table>
          </div>

      {/* ── Daily Ad Spend by Brand ── */}
      {dailyBrandData.data.length > 0 && (<>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, marginTop: 20 }}>Daily Ad Spend — By Brand</div>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>Breakdown pengeluaran iklan harian per brand</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dailyBrandData.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2744" />
              <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v: number) => fmtCompact(v)} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0);
                  return (
                    <div style={{ background: 'var(--bg-deep)', border: `1px solid ${C.bdr}`, borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
                      <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
                      {payload.filter((p: any) => p.value > 0).map((p: any, i: number) => (
                        <div key={i} style={{ color: p.fill, marginBottom: 2, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                          <span>{p.dataKey}</span>
                          <span style={{ fontFamily: 'monospace' }}>Rp {fmtCompact(p.value)}</span>
                        </div>
                      ))}
                      <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 4, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
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
      </>)}
          </div>)}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* Ad Spend by Traffic Source — Exclusive Channel ROAS              */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Ad Spend by Traffic Source</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>ROAS per channel atribusi — exclusive, tanpa double count{prevMonthLabel ? ` • Delta vs ${prevMonthLabel}` : ''}</div>
          </div>
          <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}
            style={{ background: 'var(--border)', border: `1px solid ${C.bdr}`, borderRadius: 8, padding: '6px 12px', color: C.txt, fontSize: 13, cursor: 'pointer', outline: 'none' }}>
            <option value="all">All Brands</option>
            {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {brandFilter === 'all' && unmappedAdsSummary.total > 0 && (
          <div style={{
            marginBottom: 16,
            padding: '10px 12px',
            borderRadius: 10,
            border: `1px solid ${C.bdr}`,
            background: 'rgba(148, 163, 184, 0.08)',
            fontSize: 12,
            color: C.dim,
            lineHeight: 1.6,
          }}>
            Sebagian spend belum bisa diatribusikan ke brand:
            {' '}
            <span style={{ color: C.txt }}>
              {unmappedAdsSummary.platforms.map(({ platform, spent }) => `${platform} Rp ${fmtCompact(spent)}`).join(', ')}
            </span>
            . Spend ini tetap masuk total Marketing dan breakdown traffic source, tetapi tidak dimasukkan ke chart/matrix per-brand sampai mapping store-brand dibenahi.
          </div>
        )}

        {platformBreakdown.length > 0 ? (
          <>
            {/* Bar chart */}
            <ResponsiveContainer width="100%" height={Math.max(platformBreakdown.length * 50, 120)}>
              <BarChart data={platformBreakdown} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1a2744" horizontal={false} />
                <XAxis type="number" stroke="#64748b" fontSize={11} tickFormatter={(v: number) => fmtCompact(v)} />
                <YAxis type="category" dataKey="platform" stroke="#64748b" fontSize={12} width={110} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div style={{ background: 'var(--bg-deep)', border: `1px solid ${C.bdr}`, borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
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
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: d.roas >= 3 ? 'var(--green)' : d.roas >= 1.5 ? 'var(--yellow)' : 'var(--red)' }}>
                            {d.roas > 0 ? `${d.roas.toFixed(1)}x` : '—'}
                          </span>
                        </div>
                        {d.subDetails.length > 0 && (
                          <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
                            <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>Termasuk:</div>
                            {d.subDetails.map((s: any) => (
                              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 11, color: 'var(--text-secondary)' }}>
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
                              <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>Serve 2 sales channel: Scalev Ads + CS Manual (spillover)</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>Rp {fmtCompact(p.spent)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.dim }}>{p.pct.toFixed(1)}%</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.dim }}>Rp {fmtCompact(p.dailyAvg)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontSize: 11, color: CHANNEL_COLORS[p.revenueChannel] || C.dim }}>{p.revenueChannel}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.dim }}>Rp {fmtCompact(p.channelRevenue)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: p.roas >= 3 ? 'var(--green)' : p.roas >= 1.5 ? 'var(--yellow)' : 'var(--red)' }}>
                        {p.roas > 0 ? `${p.roas.toFixed(1)}x` : '—'}
                        {(() => {
                          const prev = prevRoasMap[p.platform];
                          if (!prev || prev.roas === 0 || p.roas === 0) return null;
                          const d = p.roas - prev.roas;
                          return (
                            <div style={{ fontSize: 9, marginTop: 2, color: d > 0 ? '#5b8a7a' : d < 0 ? '#9b6b6b' : '#555' }}>
                              {d > 0 ? '▲' : d < 0 ? '▼' : '—'} {d >= 0 ? '+' : ''}{d.toFixed(1)}x
                            </div>
                          );
                        })()}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: p.adminFee > 0 ? 'var(--yellow)' : `${C.dim}66` }}>
                        {p.adminFee > 0 ? `Rp ${fmtCompact(p.adminFee)}` : '—'}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: p.effectiveRoas >= 3 ? 'var(--green)' : p.effectiveRoas >= 1.5 ? 'var(--yellow)' : p.effectiveRoas > 0 ? 'var(--red)' : `${C.dim}44` }}>
                        {p.effectiveRoas > 0 ? `${p.effectiveRoas.toFixed(1)}x` : p.adminFee === 0 && p.roas > 0 ? `${p.roas.toFixed(1)}x` : '—'}
                        {(() => {
                          const prev = prevRoasMap[p.platform];
                          const currEff = p.effectiveRoas > 0 ? p.effectiveRoas : (p.adminFee === 0 && p.roas > 0 ? p.roas : 0);
                          const prevEff = prev ? prev.effectiveRoas : 0;
                          if (prevEff === 0 || currEff === 0) return null;
                          const d = currEff - prevEff;
                          return (
                            <div style={{ fontSize: 9, marginTop: 2, color: d > 0 ? '#5b8a7a' : d < 0 ? '#9b6b6b' : '#555' }}>
                              {d > 0 ? '▲' : d < 0 ? '▼' : '—'} {d >= 0 ? '+' : ''}{d.toFixed(1)}x
                            </div>
                          );
                        })()}
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
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: filteredRoas >= 3 ? 'var(--green)' : filteredRoas >= 1.5 ? 'var(--yellow)' : 'var(--red)' }}>
                            {filteredRoas.toFixed(1)}x
                            {(() => {
                              const prev = prevRoasMap['__TOTAL__'];
                              if (!prev || prev.roas === 0 || filteredRoas === 0) return null;
                              const d = filteredRoas - prev.roas;
                              return (
                                <div style={{ fontSize: 9, marginTop: 2, color: d > 0 ? '#5b8a7a' : d < 0 ? '#9b6b6b' : '#555' }}>
                                  {d > 0 ? '▲' : d < 0 ? '▼' : '—'} {d >= 0 ? '+' : ''}{d.toFixed(1)}x
                                </div>
                              );
                            })()}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: 'var(--yellow)' }}>Rp {fmtCompact(totalAdmin)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: effRoas >= 3 ? 'var(--green)' : effRoas >= 1.5 ? 'var(--yellow)' : 'var(--red)' }}>
                            {effRoas.toFixed(1)}x
                            {(() => {
                              const prev = prevRoasMap['__TOTAL__'];
                              if (!prev || prev.effectiveRoas === 0 || effRoas === 0) return null;
                              const d = effRoas - prev.effectiveRoas;
                              return (
                                <div style={{ fontSize: 9, marginTop: 2, color: d > 0 ? '#5b8a7a' : d < 0 ? '#9b6b6b' : '#555' }}>
                                  {d > 0 ? '▲' : d < 0 ? '▼' : '—'} {d >= 0 ? '+' : ''}{d.toFixed(1)}x
                                </div>
                              );
                            })()}
                          </td>
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
                  dan <span style={{ color: 'var(--green)', fontWeight: 600 }}>repeat order organik</span>.
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
