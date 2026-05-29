// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import { fmtCompact, fmtRupiah } from '@/lib/utils';
import { useDateRange } from '@/lib/DateRangeContext';
import { getCached, setCache } from '@/lib/dashboard-cache';
import { getMarketingPageData } from '@/lib/marketing-actions';
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

// Ads source -> marketing platform.
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

// ── Platform colors ──
const PLATFORM_COLORS: Record<string, string> = {
  'Meta Ads': '#1877f2', 'Google Ads': '#4285f4', 'TikTok Ads': '#ff0050',
  'Shopee Ads': '#ee4d2d', 'SnackVideo Ads': '#fbbf24', 'Other Marketplace': '#64748b',
  'Reseller': '#f59e0b', 'WABA MM Cost': '#25D366', 'Other': '#64748b',
};

// Same direct attribution pattern as Sales Channel.
const DIRECT_PLATFORM_CHANNEL_MAP: Record<string, string[]> = {
  'Meta Ads': ['Scalev Ads'],
  'Google Ads': ['Scalev Ads'],
  'Shopee Ads': ['Shopee'],
  'TikTok Ads': ['TikTok Shop'],
  'WABA MM Cost': ['WABA'],
};

const CHANNEL_META: Record<string, { role: string; assist?: string; color: string; order: number }> = {
  'Scalev Ads': {
    role: 'Direct paid acquisition',
    assist: 'New leads dari Meta/Google',
    color: '#3b82f6',
    order: 10,
  },
  'CS Manual': {
    role: 'Assisted repeat demand',
    assist: 'Dipengaruhi ekosistem Scalev, tanpa direct paid attribution',
    color: '#f59e0b',
    order: 20,
  },
  WABA: {
    role: 'Retention / broadcast',
    assist: 'Direct WABA marketing message',
    color: '#25D366',
    order: 30,
  },
  Reseller: {
    role: 'Partner / non-paid',
    color: '#f59e0b',
    order: 40,
  },
  Shopee: {
    role: 'Marketplace paid',
    color: '#ee4d2d',
    order: 50,
  },
  'TikTok Shop': {
    role: 'Marketplace paid',
    color: '#00f2ea',
    order: 60,
  },
  Tokopedia: {
    role: 'Marketplace organic',
    color: '#22c55e',
    order: 70,
  },
  Lazada: {
    role: 'Marketplace organic',
    color: '#7c3aed',
    order: 80,
  },
  BliBli: {
    role: 'Marketplace organic',
    color: '#0ea5e9',
    order: 90,
  },
};

const SCALEV_ECOSYSTEM_CHANNELS = ['Scalev Ads', 'CS Manual', 'WABA'];
const SCALEV_ECOSYSTEM_SOURCES = ['Meta Ads', 'Google Ads', 'WABA MM Cost'];

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
  const [brandMatrixOpen, setBrandMatrixOpen] = useState(false);
  const [scalevExpanded, setScalevExpanded] = useState(false);
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

  const marketingChannelBreakdown = useMemo(() => {
    const currentAds = brandFilter === 'all'
      ? resolvedAdsData
      : attributedAdsData.filter(d => d.brand === brandFilter);
    const prevAds = brandFilter === 'all'
      ? resolvedPrevRangeAdsData
      : attributedPrevRangeAdsData.filter(d => d.brand === brandFilter);

    const currentChannels = filteredChannelData.filter(d => brandFilter === 'all' || d.product === brandFilter);
    const prevChannels = filteredPrevRangeChannelData.filter(d => brandFilter === 'all' || d.product === brandFilter);

    const buildSnapshot = (adsRows: any[], channelRows: any[]) => {
      const spendBySource: Record<string, number> = {};
      const revenueByChannel: Record<string, number> = {};
      const spendByChannel: Record<string, number> = {};
      const sourceDetailsByChannel: Record<string, { name: string; spent: number }[]> = {};
      const channels = new Set<string>();

      adsRows.forEach(d => {
        const source = normPlatform(d.source);
        spendBySource[source] = (spendBySource[source] || 0) + Math.abs(Number(d.spent || 0));
      });

      channelRows.forEach(d => {
        const channel = d.channel || 'Other';
        channels.add(channel);
        revenueByChannel[channel] = (revenueByChannel[channel] || 0) + Number(d.net_sales || 0);
      });

      Object.entries(DIRECT_PLATFORM_CHANNEL_MAP).forEach(([source, targetChannels]) => {
        const sourceSpend = spendBySource[source] || 0;
        if (sourceSpend <= 0) return;

        const targetRevenues = targetChannels.map(channel => ({
          channel,
          revenue: revenueByChannel[channel] || 0,
        }));
        const totalTargetRevenue = targetRevenues.reduce((sum, item) => sum + item.revenue, 0);

        targetRevenues.forEach(({ channel, revenue }) => {
          const share = totalTargetRevenue > 0 ? revenue / totalTargetRevenue : 1 / targetChannels.length;
          const channelSpend = sourceSpend * share;
          if (channelSpend <= 0) return;
          channels.add(channel);
          spendByChannel[channel] = (spendByChannel[channel] || 0) + channelSpend;
          if (!sourceDetailsByChannel[channel]) sourceDetailsByChannel[channel] = [];
          sourceDetailsByChannel[channel].push({ name: source, spent: channelSpend });
        });
      });

      Object.entries(spendBySource).forEach(([source, spent]) => {
        if (DIRECT_PLATFORM_CHANNEL_MAP[source] || spent <= 0) return;
        channels.add(source);
        spendByChannel[source] = (spendByChannel[source] || 0) + spent;
        if (!sourceDetailsByChannel[source]) sourceDetailsByChannel[source] = [];
        sourceDetailsByChannel[source].push({ name: source, spent });
      });

      return { spendBySource, revenueByChannel, spendByChannel, sourceDetailsByChannel, channels };
    };

    const current = buildSnapshot(currentAds, currentChannels);
    const prev = buildSnapshot(prevAds, prevChannels);

    const allChannels = new Set<string>([
      ...Array.from(current.channels),
      ...Array.from(prev.channels),
      ...Object.keys(current.spendByChannel),
      ...Object.keys(prev.spendByChannel),
    ]);

    const buildRow = (channel: string) => {
        const meta = CHANNEL_META[channel] || {
          role: current.spendByChannel[channel] > 0 ? 'Unmapped paid source' : 'Sales channel',
          color: PLATFORM_COLORS[channel] || '#64748b',
          order: 999,
        };
        const revenue = current.revenueByChannel[channel] || 0;
        const prevRevenue = prev.revenueByChannel[channel] || 0;
        const mktFee = current.spendByChannel[channel] || 0;
        const prevMktFee = prev.spendByChannel[channel] || 0;
        const mktFeePct = revenue > 0 ? (mktFee / revenue) * 100 : 0;
        const prevMktFeePct = prevRevenue > 0 ? (prevMktFee / prevRevenue) * 100 : 0;
        const roas = mktFee > 0 && revenue > 0 ? revenue / mktFee : 0;
        const prevRoas = prevMktFee > 0 && prevRevenue > 0 ? prevRevenue / prevMktFee : 0;
        const revenueDelta = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;
        const mktFeeDelta = prevMktFee > 0 ? ((mktFee - prevMktFee) / prevMktFee) * 100 : null;
        const mktFeePctDelta = prevRevenue > 0 ? mktFeePct - prevMktFeePct : null;
        const roasDelta = prevRoas > 0 && roas > 0 ? roas - prevRoas : null;
        const spendSalesGap = revenueDelta !== null && mktFeeDelta !== null ? mktFeeDelta - revenueDelta : null;
        const erosionScore = Math.max(0, mktFeePctDelta || 0) + Math.max(0, spendSalesGap || 0) / 5 + Math.max(0, -(roasDelta || 0));
        const sourceDetails = (current.sourceDetailsByChannel[channel] || [])
          .filter(source => source.spent > 0)
          .sort((a, b) => b.spent - a.spent);

        let signal = 'Monitor';
        let signalTone = 'neutral';
        if (revenue <= 0 && mktFee > 0) {
          signal = 'Unmapped spend';
          signalTone = 'warn';
        } else if (mktFee === 0 && channel === 'CS Manual' && revenue > 0) {
          signal = 'Assisted';
          signalTone = 'warn';
        } else if (mktFee === 0 && revenue > 0) {
          signal = 'Non-paid';
          signalTone = 'neutral';
        } else if ((revenueDelta || 0) < 0 && (mktFeeDelta || 0) > 0) {
          signal = 'Erosi biaya';
          signalTone = 'bad';
        } else if ((mktFeePctDelta || 0) > 3) {
          signal = 'Mkt fee % naik';
          signalTone = 'bad';
        } else if ((roasDelta || 0) < -0.5) {
          signal = 'ROAS turun';
          signalTone = 'warn';
        } else if ((revenueDelta || 0) > 0 && (mktFeeDelta === null || mktFeeDelta <= revenueDelta)) {
          signal = 'Efisien';
          signalTone = 'good';
        }

        return {
          key: channel,
          name: channel,
          role: meta.role,
          assist: meta.assist,
          color: meta.color,
          order: meta.order,
          revenue,
          prevRevenue,
          mktFee,
          prevMktFee,
          mktFeePct,
          prevMktFeePct,
          roas,
          prevRoas,
          revenueDelta,
          mktFeeDelta,
          mktFeePctDelta,
          roasDelta,
          spendSalesGap,
          erosionScore,
          sourceDetails,
          signal,
          signalTone,
        };
      };

    const rows = Array.from(allChannels)
      .map(buildRow)
      .filter(row => row.revenue > 0 || row.mktFee > 0)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return b.revenue - a.revenue;
      });

    const worstErosion = rows
      .filter(row => row.mktFee > 0 && (row.revenueDelta || 0) < 0 && (row.mktFeeDelta || 0) > 0)
      .sort((a, b) => b.erosionScore - a.erosionScore)[0] || null;

    const buildScalevEcosystem = () => {
      const revenue = SCALEV_ECOSYSTEM_CHANNELS.reduce((sum, channel) => sum + (current.revenueByChannel[channel] || 0), 0);
      const prevRevenue = SCALEV_ECOSYSTEM_CHANNELS.reduce((sum, channel) => sum + (prev.revenueByChannel[channel] || 0), 0);
      const mktFee = SCALEV_ECOSYSTEM_SOURCES.reduce((sum, source) => sum + (current.spendBySource[source] || 0), 0);
      const prevMktFee = SCALEV_ECOSYSTEM_SOURCES.reduce((sum, source) => sum + (prev.spendBySource[source] || 0), 0);
      const mktFeePct = revenue > 0 ? (mktFee / revenue) * 100 : 0;
      const prevMktFeePct = prevRevenue > 0 ? (prevMktFee / prevRevenue) * 100 : 0;
      const roas = mktFee > 0 && revenue > 0 ? revenue / mktFee : 0;
      const prevRoas = prevMktFee > 0 && prevRevenue > 0 ? prevRevenue / prevMktFee : 0;
      const revenueDelta = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : null;
      const mktFeeDelta = prevMktFee > 0 ? ((mktFee - prevMktFee) / prevMktFee) * 100 : null;
      const mktFeePctDelta = prevRevenue > 0 ? mktFeePct - prevMktFeePct : null;
      const roasDelta = prevRoas > 0 && roas > 0 ? roas - prevRoas : null;
      const spendSalesGap = revenueDelta !== null && mktFeeDelta !== null ? mktFeeDelta - revenueDelta : null;
      const erosionScore = Math.max(0, mktFeePctDelta || 0) + Math.max(0, spendSalesGap || 0) / 5 + Math.max(0, -(roasDelta || 0));
      const sourceDetails = SCALEV_ECOSYSTEM_SOURCES
        .map(source => ({ name: source, spent: current.spendBySource[source] || 0 }))
        .filter(source => source.spent > 0)
        .sort((a, b) => b.spent - a.spent);

      if (revenue <= 0 && mktFee <= 0) return null;

      let signal = 'Monitor';
      let signalTone = 'neutral';
      if ((revenueDelta || 0) < 0 && (mktFeeDelta || 0) > 0) {
        signal = 'Erosi biaya';
        signalTone = 'bad';
      } else if ((mktFeePctDelta || 0) > 3) {
        signal = 'Mkt fee % naik';
        signalTone = 'bad';
      } else if ((roasDelta || 0) < -0.5) {
        signal = 'ROAS turun';
        signalTone = 'warn';
      } else if ((revenueDelta || 0) > 0 && (mktFeeDelta === null || mktFeeDelta <= revenueDelta)) {
        signal = 'Efisien';
        signalTone = 'good';
      }

      return {
        key: 'scalev-ecosystem',
        name: 'Scalev',
        label: 'Scalev',
        role: 'Gabungan channel Scalev',
        assist: SCALEV_ECOSYSTEM_CHANNELS.join(' + '),
        color: '#3b82f6',
        channels: SCALEV_ECOSYSTEM_CHANNELS,
        sources: sourceDetails,
        sourceDetails,
        revenue,
        prevRevenue,
        mktFee,
        prevMktFee,
        mktFeePct,
        mktFeePctDelta,
        roas,
        roasDelta,
        revenueDelta,
        mktFeeDelta,
        spendSalesGap,
        erosionScore,
        signal,
        signalTone,
      };
    };

    const scalevEcosystem = buildScalevEcosystem();
    const directAttention = rows
      .filter(row => row.mktFee > 0 && (row.revenueDelta || 0) < 0 && (row.mktFeeDelta || 0) > 0)
      .sort((a, b) => b.erosionScore - a.erosionScore)[0] || null;
    const attention = directAttention || (scalevEcosystem && scalevEcosystem.mktFee > 0 && (scalevEcosystem.revenueDelta || 0) < 0 && (scalevEcosystem.mktFeeDelta || 0) > 0 ? scalevEcosystem : null);

    return { rows, worstErosion, attention, scalevEcosystem };
  }, [
    brandFilter,
    resolvedAdsData,
    attributedAdsData,
    resolvedPrevRangeAdsData,
    attributedPrevRangeAdsData,
    filteredChannelData,
    filteredPrevRangeChannelData,
  ]);

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

  const signalStyle = (tone: string) => {
    if (tone === 'bad') return { bg: 'var(--badge-red-bg)', color: 'var(--red)' };
    if (tone === 'warn') return { bg: 'var(--badge-yellow-bg)', color: 'var(--yellow)' };
    if (tone === 'good') return { bg: 'var(--badge-green-bg)', color: 'var(--green)' };
    return { bg: 'var(--border)', color: C.dim };
  };

  const renderEfficiencyRow = (row: any, options: { compact?: boolean; expandable?: boolean; expanded?: boolean; onClick?: () => void } = {}) => {
    const signal = signalStyle(row.signalTone);
    const mktFeePctColor = row.mktFeePct > 40 ? 'var(--red)' : row.mktFeePct > 25 ? 'var(--yellow)' : row.mktFeePct > 0 ? 'var(--green)' : C.dim;
    const label = row.label || row.name;
    const compact = options.compact === true;

    return (
      <tr
        key={row.key || row.name}
        onClick={options.onClick}
        title={options.expandable ? 'Klik untuk lihat detail Scalev Ads, CS Manual, dan WABA' : undefined}
        style={{
          borderBottom: `1px solid ${C.bdr}`,
          background: compact ? 'var(--bg)' : 'transparent',
          cursor: options.expandable ? 'pointer' : 'default',
        }}
      >
        <td style={{ padding: '8px 10px', paddingLeft: compact ? 28 : 10, textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            {options.expandable ? (
              <span style={{ fontSize: 10, color: C.dim, transition: 'transform 0.15s', display: 'inline-block', transform: options.expanded ? 'rotate(90deg)' : 'rotate(0deg)', marginTop: 2 }}>▶</span>
            ) : (
              <div style={{ width: 10, height: 10, borderRadius: 3, background: row.color, flexShrink: 0, marginTop: 3 }} />
            )}
            <div>
              <div style={{ fontWeight: compact ? 600 : 800, fontSize: compact ? 12 : 13 }}>{label}</div>
              <div style={{ color: C.dim, fontSize: 10, marginTop: 2 }}>{row.role}</div>
            </div>
          </div>
        </td>
        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: compact ? 600 : 800, fontSize: 11, whiteSpace: 'nowrap' }}>
          <div>{fmtRupiah(row.revenue)}</div>
          {row.revenueDelta !== null && (
            <div style={{ marginTop: 4, fontSize: 10, fontWeight: 500, color: row.revenueDelta >= 0 ? '#5b8a7a' : '#9b6b6b' }}>
              {row.revenueDelta >= 0 ? '▲' : '▼'} {row.revenueDelta >= 0 ? '+' : ''}{row.revenueDelta.toFixed(1)}%
            </div>
          )}
        </td>
        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: compact ? 600 : 800, fontSize: 11, whiteSpace: 'nowrap', color: row.mktFee > 0 ? 'var(--yellow)' : `${C.dim}66` }}>
          <div>{row.mktFee > 0 ? fmtRupiah(row.mktFee) : '—'}</div>
          {row.mktFeeDelta !== null && (
            <div style={{ marginTop: 4, fontSize: 10, fontWeight: 500, color: row.mktFeeDelta <= 0 ? '#5b8a7a' : '#9b6b6b' }}>
              {row.mktFeeDelta >= 0 ? '▲' : '▼'} {row.mktFeeDelta >= 0 ? '+' : ''}{row.mktFeeDelta.toFixed(1)}%
            </div>
          )}
        </td>
        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: compact ? 600 : 800, fontSize: 11, color: mktFeePctColor }}>
          <div>{row.mktFeePct > 0 ? `${row.mktFeePct.toFixed(1)}%` : '—'}</div>
          {row.mktFee > 0 && row.mktFeePctDelta !== null && (
            <div style={{ marginTop: 4, fontSize: 10, fontWeight: 500, color: row.mktFeePctDelta <= 0 ? '#5b8a7a' : '#9b6b6b' }}>
              {row.mktFeePctDelta >= 0 ? '▲' : '▼'} {row.mktFeePctDelta >= 0 ? '+' : ''}{row.mktFeePctDelta.toFixed(1)}pp
            </div>
          )}
        </td>
        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: compact ? 600 : 800, fontSize: 11, color: row.roas >= 3 ? 'var(--green)' : row.roas >= 1.5 ? 'var(--yellow)' : row.roas > 0 ? 'var(--red)' : `${C.dim}66` }}>
          <div>{row.roas > 0 ? `${row.roas.toFixed(1)}x` : '—'}</div>
          {row.roasDelta !== null && (
            <div style={{ marginTop: 4, fontSize: 10, fontWeight: 500, color: row.roasDelta >= 0 ? '#5b8a7a' : '#9b6b6b' }}>
              {row.roasDelta >= 0 ? '▲' : '▼'} {row.roasDelta >= 0 ? '+' : ''}{row.roasDelta.toFixed(1)}x
            </div>
          )}
        </td>
        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
          <span style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 800, background: signal.bg, color: signal.color, whiteSpace: 'nowrap' }}>
            {row.signal}
          </span>
        </td>
      </tr>
    );
  };

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Marketing</h2>
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}
          style={{ background: 'var(--border)', border: `1px solid ${C.bdr}`, borderRadius: 8, padding: '7px 12px', color: C.txt, fontSize: 13, cursor: 'pointer', outline: 'none' }}>
          <option value="all">All Brands</option>
          {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>

      {/* ── KPI Cards ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <KPI label="Net Sales" val={`Rp ${fmtCompact(totalRevenue)}`} sub={`Avg: Rp ${fmtCompact(activeDays > 0 ? totalRevenue / activeDays : 0)}/hari`} color="var(--accent)"
          delta={prevAdSpend && prevAdSpend.revenue > 0 ? { value: ((totalRevenue - prevAdSpend.revenue) / prevAdSpend.revenue) * 100 } : undefined} />
        <KPI label="Mkt Fee" val={`Rp ${fmtCompact(totalSpend)}`} sub={`Avg: Rp ${fmtCompact(activeDays > 0 ? totalSpend / activeDays : 0)}/hari`} color="var(--yellow)"
          delta={prevAdSpend && prevAdSpend.total > 0 ? { value: ((totalSpend - prevAdSpend.total) / prevAdSpend.total) * 100, higherIsBetter: false } : undefined} />
        <KPI label="Mkt Fee %" val={`${totalRatio.toFixed(1)}%`} sub={`Avg: ${avgDailyRatio.toFixed(1)}%/hari`} color={totalRatio > 30 ? 'var(--red)' : totalRatio > 20 ? 'var(--yellow)' : 'var(--green)'}
          delta={prevAdSpend && prevAdSpend.ratio > 0 ? { value: totalRatio - prevAdSpend.ratio, suffix: 'pp', higherIsBetter: false } : undefined} />
        <KPI label="Blended ROAS" val={`${totalRoas.toFixed(1)}x`} sub="Net sales / mkt fee" color="#8b5cf6"
          delta={prevAdSpend && prevAdSpend.roas > 0 ? { value: ((totalRoas - prevAdSpend.roas) / prevAdSpend.roas) * 100 } : undefined} />
      </div>

      {marketingChannelBreakdown.attention && (
        <div style={{
          background: 'rgba(245, 158, 11, 0.08)',
          border: `1px solid ${C.bdr}`,
          borderRadius: 10,
          padding: '10px 12px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          fontSize: 12,
        }}>
          {(() => {
            const row = marketingChannelBreakdown.attention;
            return (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 240 }}>
                  <span style={{ padding: '3px 8px', borderRadius: 5, background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontWeight: 800, fontSize: 10, textTransform: 'uppercase' }}>Attention</span>
                  <span style={{ color: C.txt, fontWeight: 700 }}>{row.name}</span>
                  <span style={{ color: C.dim }}>revenue turun, marketing cost naik</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontFamily: 'monospace' }}>
                  <span style={{ color: '#9b6b6b' }}>Sales {row.revenueDelta !== null ? `${row.revenueDelta >= 0 ? '+' : ''}${row.revenueDelta.toFixed(1)}%` : '—'}</span>
                  <span style={{ color: 'var(--yellow)' }}>Mkt {row.mktFeeDelta !== null ? `${row.mktFeeDelta >= 0 ? '+' : ''}${row.mktFeeDelta.toFixed(1)}%` : '—'}</span>
                  {row.spendSalesGap !== null && <span style={{ color: '#9b6b6b' }}>Gap {row.spendSalesGap >= 0 ? '+' : ''}{row.spendSalesGap.toFixed(1)}pp</span>}
                </div>
              </>
            );
          })()}
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, overflowX: 'auto', marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Sales Channel Marketing Efficiency</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 4, marginBottom: 12 }}>
          Direct attribution mengikuti pola Sales Channel; klik Scalev untuk melihat detail channel.
        </div>

        {brandFilter === 'all' && unmappedAdsSummary.total > 0 && (
          <div style={{
            marginBottom: 14,
            padding: '10px 12px',
            borderRadius: 10,
            border: `1px solid ${C.bdr}`,
            background: 'rgba(148, 163, 184, 0.08)',
            fontSize: 12,
            color: C.dim,
            lineHeight: 1.6,
          }}>
            Sebagian spend belum bisa diatribusikan ke brand:{' '}
            <span style={{ color: C.txt }}>
              {unmappedAdsSummary.platforms.map(({ platform, spent }) => `${platform} Rp ${fmtCompact(spent)}`).join(', ')}
            </span>
            . Spend ini tetap masuk total marketing dan direct channel attribution.
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed', minWidth: 940 }}>
          <colgroup>
            <col style={{ width: '26%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '16%' }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: `2px solid ${C.bdr}` }}>
              {['Sales Channel', 'Net Sales', 'Direct Mkt Fee', 'Mkt Fee %', 'ROAS', 'Signal'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Sales Channel' ? 'left' : 'right', color: C.dim, fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const scalevGroup = marketingChannelBreakdown.scalevEcosystem;
              const scalevRows = marketingChannelBreakdown.rows.filter(row => SCALEV_ECOSYSTEM_CHANNELS.includes(row.name));
              const otherRows = marketingChannelBreakdown.rows.filter(row => !SCALEV_ECOSYSTEM_CHANNELS.includes(row.name));

              return (
                <>
                  {scalevGroup && renderEfficiencyRow(scalevGroup, {
                    expandable: true,
                    expanded: scalevExpanded,
                    onClick: () => setScalevExpanded(prev => !prev),
                  })}
                  {scalevExpanded && scalevRows.map(row => renderEfficiencyRow(row, { compact: true }))}
                  {!scalevGroup && scalevRows.map(row => renderEfficiencyRow(row))}
                  {otherRows.map(row => renderEfficiencyRow(row))}
                </>
              );
            })()}
            <tr style={{ borderTop: `2px solid ${C.bdr}`, background: 'var(--bg)' }}>
              <td style={{ padding: '8px 10px' }}>
                <div style={{ fontWeight: 800 }}>TOTAL</div>
                <div style={{ color: C.dim, fontSize: 10, marginTop: 2 }}>Direct + assisted view</div>
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 11, whiteSpace: 'nowrap' }}>
                <div>{fmtRupiah(totalRevenue)}</div>
                {prevAdSpend && prevAdSpend.revenue > 0 && (
                  <div style={{ marginTop: 4, fontSize: 10, fontWeight: 500, color: totalRevenue >= prevAdSpend.revenue ? '#5b8a7a' : '#9b6b6b' }}>
                    {totalRevenue >= prevAdSpend.revenue ? '▲' : '▼'} {((totalRevenue - prevAdSpend.revenue) / prevAdSpend.revenue) >= 0 ? '+' : ''}{(((totalRevenue - prevAdSpend.revenue) / prevAdSpend.revenue) * 100).toFixed(1)}%
                  </div>
                )}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 11, whiteSpace: 'nowrap', color: 'var(--yellow)' }}>
                <div>{fmtRupiah(totalSpend)}</div>
                {prevAdSpend && prevAdSpend.total > 0 && (
                  <div style={{ marginTop: 4, fontSize: 10, fontWeight: 500, color: totalSpend <= prevAdSpend.total ? '#5b8a7a' : '#9b6b6b' }}>
                    {totalSpend >= prevAdSpend.total ? '▲' : '▼'} {((totalSpend - prevAdSpend.total) / prevAdSpend.total) >= 0 ? '+' : ''}{(((totalSpend - prevAdSpend.total) / prevAdSpend.total) * 100).toFixed(1)}%
                  </div>
                )}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 11 }}>
                <div>{totalRatio.toFixed(1)}%</div>
                {prevAdSpend && prevAdSpend.ratio > 0 && (
                  <div style={{ marginTop: 4, fontSize: 10, fontWeight: 500, color: totalRatio <= prevAdSpend.ratio ? '#5b8a7a' : '#9b6b6b' }}>
                    {(totalRatio - prevAdSpend.ratio) >= 0 ? '▲' : '▼'} {(totalRatio - prevAdSpend.ratio) >= 0 ? '+' : ''}{(totalRatio - prevAdSpend.ratio).toFixed(1)}pp
                  </div>
                )}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 11 }}>
                <div>{totalRoas.toFixed(1)}x</div>
                {prevAdSpend && prevAdSpend.roas > 0 && (
                  <div style={{ marginTop: 4, fontSize: 10, fontWeight: 500, color: totalRoas >= prevAdSpend.roas ? '#5b8a7a' : '#9b6b6b' }}>
                    {(totalRoas - prevAdSpend.roas) >= 0 ? '▲' : '▼'} {(totalRoas - prevAdSpend.roas) >= 0 ? '+' : ''}{(totalRoas - prevAdSpend.roas).toFixed(1)}x
                  </div>
                )}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right', color: C.dim }}>
                —
              </td>
            </tr>
          </tbody>
        </table>
      </div>

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
          </div>)}
        </div>
      )}

      {/* ── Brand × Traffic Source Matrix ── */}
      {brandFilter === 'all' && brandPlatformMatrix.rows?.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div
            onClick={() => setBrandMatrixOpen(!brandMatrixOpen)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
          >
            <span style={{ fontSize: 13, color: C.dim, transition: 'transform 0.2s', transform: brandMatrixOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Brand × Traffic Source Matrix</span>
            <span style={{ fontSize: 12, color: C.dim }}>({brandPlatformMatrix.rows.length} brands)</span>
          </div>
          {brandMatrixOpen && (
            <div style={{ overflowX: 'auto', marginTop: 16 }}>
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
          )}
        </div>
      )}
    </div>
  );
}
