// @ts-nocheck
'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { useSupabase } from '@/lib/supabase-browser';
import { fmtCompact, fmtRupiah, shortDate, CHANNEL_COLORS } from '@/lib/utils';
import { useDateRange } from '@/lib/DateRangeContext';
import { getCached, setCache } from '@/lib/dashboard-cache';
// PieChart removed – no longer used on this page
import { useActiveBrands } from '@/lib/ActiveBrandsContext';
import ChannelSlaSection from '@/components/ChannelSlaSection';
import ShipmentStatusSection from '@/components/ShipmentStatusSection';

// ── Normalize ad source → platform (same logic as marketing page) ──
// ── Ads Source → Marketing Platform (sales POV: NO organic spillover) ──
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

// ── Marketing Platform → Sales Channels served (sales POV, strict — no CS Manual) ──
const PLATFORM_CHANNEL_MAP = {
  'Meta Ads':    ['Scalev Ads'],
  'Google Ads':  ['Scalev Ads'],
  'Shopee Ads':  ['Shopee'],
  'TikTok Ads':  ['TikTok Shop'],
  'WABA MM Cost': ['WABA'],
};

// ── Tooltips for sales channels ──
const CHANNEL_TOOLTIP: Record<string, string> = {
  'Scalev Ads': 'Order dari form iklan Meta Ads yang masuk langsung ke Scalev',
  'CS Manual': 'Order manual oleh CS — sebagian demand diciptakan oleh Meta Ads',
};

// ── Channel grouping: channels under Scalev umbrella (share Meta Ads cost) ──
const SCALEV_CHANNELS = ['CS Manual', 'Scalev Ads', 'WABA'];

// ── Build reverse map: channel → platform ──
const CHANNEL_TO_PLATFORM = {};
for (const [platform, channels] of Object.entries(PLATFORM_CHANNEL_MAP)) {
  for (const ch of channels) {
    CHANNEL_TO_PLATFORM[ch] = platform;
  }
}

export default function ChannelsPage() {
  const supabase = useSupabase();
  const { dateRange, loading: dateLoading } = useDateRange();
  const [channelData, setChannelData] = useState([]);
  const [adsData, setAdsData] = useState([]);
  const [brandMapping, setBrandMapping] = useState([]);
  const [shipmentCounts, setShipmentCounts] = useState<{ date: string; product: string; channel: string; order_count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState('all');
  const [scalevExpanded, setScalevExpanded] = useState(false);
  const { isActiveBrand } = useActiveBrands();

  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    const { from, to } = dateRange;

    const cachedCh = getCached('daily_channel_data_ch', from, to);
    const cachedAds = getCached('daily_ads_spend_ch', from, to);
    const cachedBm = getCached('ads_store_brand_mapping', from, to);
    const cachedSc = getCached('daily_shipment_counts_ch', from, to);

    if (cachedCh && cachedAds && cachedBm && cachedSc) {
      setChannelData(cachedCh.filter(row => isActiveBrand(row.product)));
      setAdsData(cachedAds);
      setBrandMapping(cachedBm);
      setShipmentCounts(cachedSc.filter(row => isActiveBrand(row.product)));
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all([
      supabase.from('daily_channel_data')
        .select('date, product, channel, net_sales, gross_profit, mp_admin_cost')
        .gte('date', from).lte('date', to),
      supabase.from('daily_ads_spend')
        .select('date, source, spent, store, data_source, impressions, cpm')
        .gte('date', from).lte('date', to),
      supabase.from('ads_store_brand_mapping')
        .select('store_pattern, brand'),
      supabase.rpc('get_daily_shipment_counts', { p_from: from, p_to: to }),
    ]).then(([chRes, adsRes, bmRes, scRes]) => {
      // Log errors so RLS / permission issues surface in console
      if (chRes.error) console.error('[Channels] daily_channel_data error:', chRes.error);
      if (adsRes.error) console.error('[Channels] daily_ads_spend error:', adsRes.error);
      if (bmRes.error) console.error('[Channels] ads_store_brand_mapping error:', bmRes.error);
      if (scRes.error) console.error('[Channels] get_daily_shipment_counts error:', scRes.error);

      const chRows = chRes.data || [];
      const adsRows = adsRes.data || [];
      const bmRows = bmRes.data || [];
      const scRows = scRes.data || [];
      setCache('daily_channel_data_ch', from, to, chRows);
      setCache('daily_ads_spend_ch', from, to, adsRows);
      setCache('ads_store_brand_mapping', from, to, bmRows);
      setCache('daily_shipment_counts_ch', from, to, scRows);
      setChannelData(chRows.filter(row => isActiveBrand(row.product)));
      setAdsData(adsRows);
      setBrandMapping(bmRows);
      setShipmentCounts(scRows.filter(row => isActiveBrand(row.product)));
      setLoading(false);
    });
  }, [dateRange, supabase]);

  // ── Store → Brand lookup ──
  const storeBrandMap = useMemo(() => {
    const map = {};
    brandMapping.forEach(r => { map[r.store_pattern?.toLowerCase()] = r.brand; });
    return map;
  }, [brandMapping]);

  function getAdBrand(store) {
    if (!store) return null;
    const key = store.toLowerCase();
    return storeBrandMap[key] || null;
  }

  // Unique products for filter
  const products = useMemo(() => {
    const set = new Set();
    channelData.forEach(d => { if (d.product) set.add(d.product); });
    return Array.from(set).sort();
  }, [channelData]);

  // ── Aggregate ads spend by platform, filtered by brand ──
  const adsByPlatform = useMemo(() => {
    const byP = {};
    adsData.forEach(d => {
      // Filter by selected brand
      if (selectedProduct !== 'all') {
        const brand = getAdBrand(d.store);
        if (brand !== selectedProduct) return;
      }
      const platform = normPlatform(d.source);
      byP[platform] = (byP[platform] || 0) + Math.abs(Number(d.spent || 0));
    });
    return byP;
  }, [adsData, selectedProduct, storeBrandMap]);

  // ── Distribute ads to channels (sales POV — strict, no organic spillover) ──
  const adsPerChannel = useMemo(() => {
    const result = {};

    // First, collect revenue per channel (already filtered by product in channels memo)
    const revByChannel = {};
    channelData.forEach(d => {
      if (selectedProduct !== 'all' && d.product !== selectedProduct) return;
      revByChannel[d.channel] = (revByChannel[d.channel] || 0) + (Number(d.net_sales) || 0);
    });

    // For each platform, distribute its ads spend across mapped channels by revenue proportion
    for (const [platform, channels] of Object.entries(PLATFORM_CHANNEL_MAP)) {
      const totalAds = adsByPlatform[platform] || 0;
      if (totalAds <= 0) continue;

      const channelRevenues = channels.map(ch => ({ ch, rev: revByChannel[ch] || 0 }));
      const totalRev = channelRevenues.reduce((a, c) => a + c.rev, 0);

      for (const { ch, rev } of channelRevenues) {
        const share = totalRev > 0 ? rev / totalRev : 1 / channels.length;
        result[ch] = (result[ch] || 0) + totalAds * share;
      }
    }

    // Ads platforms not in PLATFORM_CHANNEL_MAP (e.g. Google Ads, SnackVideo Ads standalone)
    for (const [platform, spent] of Object.entries(adsByPlatform)) {
      if (PLATFORM_CHANNEL_MAP[platform]) continue;
      // Try direct channel name match
      result[platform] = (result[platform] || 0) + spent;
    }

    return result;
  }, [adsByPlatform, channelData, selectedProduct]);

  // Aggregate channel data — all metrics from single source (daily_channel_data) + ads
  const channels = useMemo(() => {
    const byC = {};
    channelData.forEach(d => {
      if (selectedProduct !== 'all' && d.product !== selectedProduct) return;
      if (!byC[d.channel]) byC[d.channel] = { revenue: 0, gp: 0, mpAdmin: 0 };
      byC[d.channel].revenue += Number(d.net_sales) || 0;
      byC[d.channel].gp += Number(d.gross_profit) || 0;
      byC[d.channel].mpAdmin += Math.abs(Number(d.mp_admin_cost) || 0);
    });

    const totalRevenue = Object.values(byC).reduce((a, v) => a + v.revenue, 0);

    return Object.entries(byC)
      .map(([ch, v]) => {
        const adsCost = adsPerChannel[ch] || 0;
        const totalCost = v.mpAdmin + adsCost;
        const profitAfterAll = v.gp - totalCost;
        return {
          name: ch,
          revenue: v.revenue,
          gp: v.gp,
          mpAdmin: v.mpAdmin,
          adsCost,
          totalCost,
          profitAfterAll,
          pct: totalRevenue > 0 ? (v.revenue / totalRevenue) * 100 : 0,
          gpMargin: v.revenue > 0 ? (v.gp / v.revenue) * 100 : 0,
          costRatio: v.revenue > 0 ? (totalCost / v.revenue) * 100 : 0,
          marginAfterAll: v.revenue > 0 ? (profitAfterAll / v.revenue) * 100 : 0,
        };
      })
      .filter(c => c.revenue > 0)
      .sort((a, b) => {
        // Pin Organik, Scalev, Reseller at top (in that order), rest sorted by revenue
        const pinOrder = ['CS Manual', 'Scalev Ads', 'Reseller'];
        const aPin = pinOrder.indexOf(a.name);
        const bPin = pinOrder.indexOf(b.name);
        if (aPin !== -1 && bPin !== -1) return aPin - bPin;
        if (aPin !== -1) return -1;
        if (bPin !== -1) return 1;
        return b.revenue - a.revenue;
      });
  }, [channelData, selectedProduct, adsPerChannel]);

  // ── Combined Daily Sales + Shipments pivot: date × channel → { orders, revenue } + Mkt Fee + MP Fee ──
  const dailyCombined = useMemo(() => {
    const byDate: Record<string, { channels: Record<string, { orders: number; revenue: number }>; mpFee: number; adsFee: number }> = {};
    const channelSet = new Set<string>();

    const ensureDate = (date: string) => {
      if (!byDate[date]) byDate[date] = { channels: {}, mpFee: 0, adsFee: 0 };
    };
    const ensureChannel = (date: string, ch: string) => {
      ensureDate(date);
      if (!byDate[date].channels[ch]) byDate[date].channels[ch] = { orders: 0, revenue: 0 };
    };

    // 1. Aggregate channel sales + mp_admin_cost per date
    channelData.forEach(d => {
      if (selectedProduct !== 'all' && d.product !== selectedProduct) return;
      if (!d.date) return;
      channelSet.add(d.channel);
      ensureChannel(d.date, d.channel);
      byDate[d.date].channels[d.channel].revenue += Number(d.net_sales) || 0;
      byDate[d.date].mpFee += Math.abs(Number(d.mp_admin_cost) || 0);
    });

    // 2. Aggregate shipment counts per date
    shipmentCounts.forEach(d => {
      if (selectedProduct !== 'all' && d.product !== selectedProduct) return;
      if (!d.date) return;
      channelSet.add(d.channel);
      ensureChannel(d.date, d.channel);
      byDate[d.date].channels[d.channel].orders += Number(d.order_count || 0);
    });

    // 3. Aggregate ads spend per date (ensures non-shipping days are included)
    adsData.forEach(d => {
      if (!d.date) return;
      if (selectedProduct !== 'all') {
        const brand = getAdBrand(d.store);
        if (brand !== selectedProduct) return;
      }
      ensureDate(d.date);
      byDate[d.date].adsFee += Math.abs(Number(d.spent) || 0);
    });

    // Sort channels: pin CS Manual, Scalev Ads, Reseller first, rest by total revenue desc
    const pinOrder = ['CS Manual', 'Scalev Ads', 'Reseller'];
    const chTotals: Record<string, number> = {};
    Object.values(byDate).forEach(row => {
      Object.entries(row.channels).forEach(([ch, val]) => { chTotals[ch] = (chTotals[ch] || 0) + val.revenue; });
    });
    const sortedChannels = Array.from(channelSet).sort((a, b) => {
      const aPin = pinOrder.indexOf(a);
      const bPin = pinOrder.indexOf(b);
      if (aPin !== -1 && bPin !== -1) return aPin - bPin;
      if (aPin !== -1) return -1;
      if (bPin !== -1) return 1;
      return (chTotals[b] || 0) - (chTotals[a] || 0);
    });

    const rows = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => {
        const totalOrders = Object.values(data.channels).reduce((sum, v) => sum + v.orders, 0);
        const totalRevenue = Object.values(data.channels).reduce((sum, v) => sum + v.revenue, 0);
        return { date, channels: data.channels, totalOrders, totalRevenue, mpFee: data.mpFee, adsFee: data.adsFee };
      });

    return { rows, channelNames: sortedChannels };
  }, [channelData, shipmentCounts, adsData, selectedProduct, storeBrandMap]);

  const totalRevenue = channels.reduce((a, c) => a + c.revenue, 0);
  const totalGP = channels.reduce((a, c) => a + c.gp, 0);
  const totalMpAdmin = channels.reduce((a, c) => a + c.mpAdmin, 0);
  const totalAdsCost = channels.reduce((a, c) => a + c.adsCost, 0);
  const totalCost = channels.reduce((a, c) => a + c.totalCost, 0);
  const totalProfitAfterAll = channels.reduce((a, c) => a + c.profitAfterAll, 0);
  const totalMpRevenue = channels.filter(c => c.mpAdmin > 0).reduce((a, c) => a + c.revenue, 0);

  // ── Product Breakdown: aggregate by product across all channels ──
  const productBreakdown = useMemo(() => {
    const byP = {};
    channelData.forEach(d => {
      if (selectedProduct !== 'all' && d.product !== selectedProduct) return;
      if (!byP[d.product]) byP[d.product] = { revenue: 0, gp: 0, mpAdmin: 0 };
      byP[d.product].revenue += Number(d.net_sales) || 0;
      byP[d.product].gp += Number(d.gross_profit) || 0;
      byP[d.product].mpAdmin += Math.abs(Number(d.mp_admin_cost) || 0);
    });

    // Distribute ads cost per product using brand mapping
    const adsByProduct = {};
    adsData.forEach(d => {
      if (selectedProduct !== 'all') {
        const brand = getAdBrand(d.store);
        if (brand !== selectedProduct) return;
      }
      const brand = getAdBrand(d.store) || 'Unknown';
      adsByProduct[brand] = (adsByProduct[brand] || 0) + Math.abs(Number(d.spent || 0));
    });

    return Object.entries(byP)
      .map(([product, v]) => {
        const adsCost = adsByProduct[product] || 0;
        const totalCostP = v.mpAdmin + adsCost;
        const profitAfterAll = v.gp - totalCostP;
        return {
          name: product,
          revenue: v.revenue,
          gp: v.gp,
          mpAdmin: v.mpAdmin,
          adsCost,
          totalCost: totalCostP,
          profitAfterAll,
          pct: totalRevenue > 0 ? (v.revenue / totalRevenue) * 100 : 0,
          gpMargin: v.revenue > 0 ? (v.gp / v.revenue) * 100 : 0,
          costRatio: v.revenue > 0 ? (totalCostP / v.revenue) * 100 : 0,
          marginAfterAll: v.revenue > 0 ? (profitAfterAll / v.revenue) * 100 : 0,
        };
      })
      .filter(p => p.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue);
  }, [channelData, adsData, selectedProduct, storeBrandMap, totalRevenue]);

  // ══════════════════════════════════════════════════════════════════════
  // WABA Promotion Analysis — daily funnel: sent → delivered → orders → cost → revenue
  // ══════════════════════════════════════════════════════════════════════
  const wabaAnalysis = useMemo(() => {
    const byDate: Record<string, { sent: number; delivered: number; orders: number; cost: number; revenue: number }> = {};

    // WABA message metrics from daily_ads_spend (data_source = 'whatsapp_api')
    adsData.forEach(d => {
      if (d.data_source !== 'whatsapp_api') return;
      if (!byDate[d.date]) byDate[d.date] = { sent: 0, delivered: 0, orders: 0, cost: 0, revenue: 0 };
      byDate[d.date].sent += Number(d.impressions || 0);       // impressions = sent
      byDate[d.date].delivered += Number(d.cpm || 0);           // cpm = delivered
      byDate[d.date].cost += Math.abs(Number(d.spent || 0));
    });

    // WABA channel orders & revenue from daily_channel_data
    channelData.forEach(d => {
      if (d.channel !== 'WABA') return;
      if (selectedProduct !== 'all' && d.product !== selectedProduct) return;
      if (!byDate[d.date]) byDate[d.date] = { sent: 0, delivered: 0, orders: 0, cost: 0, revenue: 0 };
      byDate[d.date].revenue += Number(d.net_sales || 0);
    });

    // WABA channel order counts from shipment data
    shipmentCounts.forEach(d => {
      if (d.channel !== 'WABA') return;
      if (selectedProduct !== 'all' && d.product !== selectedProduct) return;
      if (!byDate[d.date]) byDate[d.date] = { sent: 0, delivered: 0, orders: 0, cost: 0, revenue: 0 };
      byDate[d.date].orders += Number(d.order_count || 0);
    });

    const rows = Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        dateLabel: `${new Date(date).getDate()}/${new Date(date).getMonth() + 1}`,
        ...v,
        deliveryRate: v.sent > 0 ? (v.delivered / v.sent) * 100 : 0,
        costPerOrder: v.orders > 0 ? v.cost / v.orders : 0,
      }));

    const totals = rows.reduce((acc, r) => ({
      sent: acc.sent + r.sent,
      delivered: acc.delivered + r.delivered,
      orders: acc.orders + r.orders,
      cost: acc.cost + r.cost,
      revenue: acc.revenue + r.revenue,
    }), { sent: 0, delivered: 0, orders: 0, cost: 0, revenue: 0 });

    return {
      rows,
      totals: {
        ...totals,
        deliveryRate: totals.sent > 0 ? (totals.delivered / totals.sent) * 100 : 0,
        costPerOrder: totals.orders > 0 ? totals.cost / totals.orders : 0,
      },
    };
  }, [adsData, channelData, shipmentCounts, selectedProduct]);

  const KPI = ({ label, val, sub, color = '#3b82f6' }) => (
    <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: '16px 18px', flex: '1 1 160px', minWidth: 150, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1.1 }}>{val}</div>
      {sub && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{sub}</div>}
    </div>
  );

  if (dateLoading || (loading && channelData.length === 0)) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>
        <div className="spinner" style={{ width: 32, height: 32, border: '3px solid #1a2744', borderTop: '3px solid #3b82f6', borderRadius: '50%', margin: '0 auto 12px' }} />
        <div>Memuat data...</div>
      </div>
    );
  }

  if (channelData.length === 0 && !loading) {
    return (
      <div className="fade-in">
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Channel</h2>
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b', background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📡</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Belum Ada Data untuk Periode Ini</div>
          <div style={{ fontSize: 13 }}>Coba pilih rentang tanggal lain menggunakan filter di atas.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      {/* Header + Product Filter */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Channel</h2>
        <select
          value={selectedProduct}
          onChange={e => setSelectedProduct(e.target.value)}
          style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #1a2744',
            background: '#111a2e', color: '#e2e8f0', fontSize: 13, fontWeight: 500,
            cursor: 'pointer', outline: 'none',
          }}
        >
          <option value="all">Semua Produk</option>
          {products.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Pre-Feb disclaimer */}
      {dateRange.from < '2026-02-01' && (
        <div style={{ background: '#1e1b4b', border: '1px solid #3730a3', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 11, color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>ℹ️</span>
          <span>Data sebelum Feb 2026 tidak termasuk biaya admin marketplace (MP Fee).</span>
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <KPI label="Net Sales" val={`Rp ${fmtCompact(totalRevenue)}`} sub={`${channels.length} active channels`} color="#3b82f6" />
        <KPI
          label="Admin Fee"
          val={`Rp ${fmtCompact(totalMpAdmin)}`}
          sub={
            <span>
              <span style={{ color: '#c4b5fd' }}>{totalMpRevenue > 0 ? (totalMpAdmin / totalMpRevenue * 100).toFixed(1) : 0}%</span>
              <span style={{ color: '#64748b' }}> of MP rev</span>
              <span style={{ color: '#64748b', margin: '0 5px' }}>·</span>
              <span style={{ color: '#94a3b8' }}>{totalRevenue > 0 ? (totalMpAdmin / totalRevenue * 100).toFixed(1) : 0}%</span>
              <span style={{ color: '#64748b' }}> of total</span>
            </span>
          }
          color="#8b5cf6"
        />
        <KPI
          label="Mkt Cost"
          val={`Rp ${fmtCompact(totalAdsCost)}`}
          sub={`${totalRevenue > 0 ? (totalAdsCost / totalRevenue * 100).toFixed(1) : 0}% of revenue`}
          color="#f59e0b"
        />
        <KPI
          label="GP After Mkt + Adm"
          val={`Rp ${fmtCompact(totalProfitAfterAll)}`}
          sub={`Margin: ${totalRevenue > 0 ? (totalProfitAfterAll / totalRevenue * 100).toFixed(1) : 0}%`}
          color={totalProfitAfterAll >= 0 ? '#06b6d4' : '#ef4444'}
        />
      </div>

      {/* Combined Daily Sales & Shipments Table */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Daily Sales &amp; Shipments</div>
        {dailyCombined.rows.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: Math.max(600, 120 + dailyCombined.channelNames.length * 130 + 200), width: '100%' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #1a2744' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', position: 'sticky', left: 0, background: '#111a2e', zIndex: 1 }}>Date</th>
                {dailyCombined.channelNames.map(ch => (
                  <th key={ch} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', color: CHANNEL_COLORS[ch] || '#64748b' }}>{ch}</th>
                ))}
                <th style={{ padding: '8px 10px', textAlign: 'right', color: '#e2e8f0', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>Total</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: '#f59e0b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Mkt Fee</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', color: '#f59e0b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>MP Fee</th>
              </tr>
            </thead>
            <tbody>
              {dailyCombined.rows.map(row => (
                <tr key={row.date} style={{ borderBottom: '1px solid #1a2744' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: '#111a2e', zIndex: 1 }}>{shortDate(row.date)}</td>
                  {dailyCombined.channelNames.map(ch => {
                    const cell = row.channels[ch];
                    const hasData = cell && (cell.revenue || cell.orders);
                    return (
                      <td key={ch} style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>
                        {hasData ? (
                          <>
                            <div>{fmtRupiah(cell.revenue)}</div>
                            {cell.orders > 0 && <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>{cell.orders.toLocaleString('id-ID')}</div>}
                          </>
                        ) : <span style={{ color: '#334155' }}>—</span>}
                      </td>
                    );
                  })}
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>
                    <div>{fmtRupiah(row.totalRevenue)}</div>
                    <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>{row.totalOrders.toLocaleString('id-ID')}</div>
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#f59e0b' }}>{row.adsFee > 0 ? fmtRupiah(row.adsFee) : <span style={{ color: '#334155' }}>—</span>}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#f59e0b' }}>{row.mpFee > 0 ? fmtRupiah(row.mpFee) : <span style={{ color: '#334155' }}>—</span>}</td>
                </tr>
              ))}
              {/* Grand Total row */}
              <tr style={{ borderTop: '2px solid #1a2744', background: '#0b1121' }}>
                <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11, position: 'sticky', left: 0, background: '#0b1121', zIndex: 1 }}>TOTAL</td>
                {dailyCombined.channelNames.map(ch => {
                  const chOrders = dailyCombined.rows.reduce((sum, r) => sum + (r.channels[ch]?.orders || 0), 0);
                  const chRevenue = dailyCombined.rows.reduce((sum, r) => sum + (r.channels[ch]?.revenue || 0), 0);
                  return (
                    <td key={ch} style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: CHANNEL_COLORS[ch] || '#e2e8f0' }}>
                      {chRevenue > 0 ? (
                        <>
                          <div>{fmtRupiah(chRevenue)}</div>
                          {chOrders > 0 && <div style={{ fontSize: 10, fontStyle: 'italic', opacity: 0.7 }}>{chOrders.toLocaleString('id-ID')}</div>}
                        </>
                      ) : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                  );
                })}
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>
                  <div>{fmtRupiah(dailyCombined.rows.reduce((sum, r) => sum + r.totalRevenue, 0))}</div>
                  <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>{dailyCombined.rows.reduce((sum, r) => sum + r.totalOrders, 0).toLocaleString('id-ID')}</div>
                </td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>{fmtRupiah(dailyCombined.rows.reduce((sum, r) => sum + r.adsFee, 0))}</td>
                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>{fmtRupiah(dailyCombined.rows.reduce((sum, r) => sum + r.mpFee, 0))}</td>
              </tr>
            </tbody>
          </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 24, color: '#64748b', fontSize: 12 }}>Tidak ada data harian untuk periode ini.</div>
        )}
      </div>

      {/* Channel Breakdown Table */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, overflowX: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Channel Breakdown</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 800 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #1a2744' }}>
              {['Channel', 'Net Sales', '% Share', 'Admin Fee', 'Mkt Cost', 'Cost Ratio', 'GP After Mkt + Adm', 'Margin'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Channel' ? 'left' : 'right', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* ── Scalev Group (collapsible) + Other Channels ── */}
            {(() => {
              const scalevGroup = channels.filter(c => SCALEV_CHANNELS.includes(c.name));
              const otherChannels = channels.filter(c => !SCALEV_CHANNELS.includes(c.name));

              // Combined metrics for the Scalev row
              const sv = {
                revenue: scalevGroup.reduce((a, c) => a + c.revenue, 0),
                gp: scalevGroup.reduce((a, c) => a + c.gp, 0),
                mpAdmin: scalevGroup.reduce((a, c) => a + c.mpAdmin, 0),
                adsCost: scalevGroup.reduce((a, c) => a + c.adsCost, 0),
              };
              const svTotalCost = sv.mpAdmin + sv.adsCost;
              const svProfit = sv.gp - svTotalCost;
              const svPct = totalRevenue > 0 ? (sv.revenue / totalRevenue) * 100 : 0;
              const svCostRatio = sv.revenue > 0 ? (svTotalCost / sv.revenue) * 100 : 0;
              const svMargin = sv.revenue > 0 ? (svProfit / sv.revenue) * 100 : 0;

              const renderRow = (c) => (
                <tr key={c.name} style={{ borderBottom: '1px solid #1a2744' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ fontWeight: 600 }} title={CHANNEL_TOOLTIP[c.name] || ''}>{c.name}</div>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{fmtRupiah(c.revenue)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: '#64748b' }}>{c.pct.toFixed(1)}%</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#8b5cf6' }}>
                    {c.mpAdmin > 0 ? fmtRupiah(c.mpAdmin) : <span style={{ color: '#334155' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#f59e0b' }}>
                    {c.adsCost > 0 ? fmtRupiah(c.adsCost) : <span style={{ color: '#334155' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    {c.totalCost > 0 ? (
                      <span style={{
                        padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                        background: c.costRatio > 40 ? '#7f1d1d' : c.costRatio > 25 ? '#78350f' : '#064e3b',
                        color: c.costRatio > 40 ? '#ef4444' : c.costRatio > 25 ? '#f59e0b' : '#10b981',
                      }}>{c.costRatio.toFixed(1)}%</span>
                    ) : <span style={{ color: '#334155' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: c.profitAfterAll >= 0 ? '#10b981' : '#ef4444' }}>
                    {fmtRupiah(c.profitAfterAll)}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    <span style={{
                      padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                      background: c.marginAfterAll >= 30 ? '#064e3b' : c.marginAfterAll >= 10 ? '#78350f' : '#7f1d1d',
                      color: c.marginAfterAll >= 30 ? '#10b981' : c.marginAfterAll >= 10 ? '#f59e0b' : '#ef4444',
                    }}>{c.marginAfterAll.toFixed(1)}%</span>
                  </td>
                </tr>
              );

              return (
                <>
                  {/* Scalev combined row (clickable to expand) */}
                  {scalevGroup.length > 0 && (
                    <>
                      <tr
                        style={{ borderBottom: '1px solid #1a2744', cursor: 'pointer' }}
                        onClick={() => setScalevExpanded(prev => !prev)}
                        title="Klik untuk lihat breakdown CS Manual & Scalev Ads"
                      >
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 9, color: '#64748b', transition: 'transform 0.15s', display: 'inline-block', transform: scalevExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                            Scalev
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{fmtRupiah(sv.revenue)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#64748b' }}>{svPct.toFixed(1)}%</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#8b5cf6' }}>
                          {sv.mpAdmin > 0 ? fmtRupiah(sv.mpAdmin) : <span style={{ color: '#334155' }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#f59e0b' }}>
                          {sv.adsCost > 0 ? fmtRupiah(sv.adsCost) : <span style={{ color: '#334155' }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          {svTotalCost > 0 ? (
                            <span style={{
                              padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                              background: svCostRatio > 40 ? '#7f1d1d' : svCostRatio > 25 ? '#78350f' : '#064e3b',
                              color: svCostRatio > 40 ? '#ef4444' : svCostRatio > 25 ? '#f59e0b' : '#10b981',
                            }}>{svCostRatio.toFixed(1)}%</span>
                          ) : <span style={{ color: '#334155' }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: svProfit >= 0 ? '#10b981' : '#ef4444' }}>
                          {fmtRupiah(svProfit)}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          <span style={{
                            padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                            background: svMargin >= 30 ? '#064e3b' : svMargin >= 10 ? '#78350f' : '#7f1d1d',
                            color: svMargin >= 30 ? '#10b981' : svMargin >= 10 ? '#f59e0b' : '#ef4444',
                          }}>{svMargin.toFixed(1)}%</span>
                        </td>
                      </tr>
                      {/* Nested breakdown (visible when expanded) */}
                      {scalevExpanded && scalevGroup.map(c => (
                        <tr key={c.name} style={{ borderBottom: '1px solid #1a2744', background: '#0b1121' }}>
                          <td style={{ padding: '6px 10px', paddingLeft: 32 }}>
                            <div style={{ fontWeight: 500, fontSize: 11, color: '#94a3b8' }} title={CHANNEL_TOOLTIP[c.name] || ''}>{c.name}</div>
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: '#94a3b8' }}>{fmtRupiah(c.revenue)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 10, color: '#475569' }}>{c.pct.toFixed(1)}%</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: '#7c3aed' }}>
                            {c.mpAdmin > 0 ? fmtRupiah(c.mpAdmin) : <span style={{ color: '#334155' }}>—</span>}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: '#d97706' }}>
                            {c.adsCost > 0 ? fmtRupiah(c.adsCost) : <span style={{ color: '#334155' }}>—</span>}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                            {c.totalCost > 0 ? (
                              <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: c.costRatio > 40 ? '#7f1d1d' : c.costRatio > 25 ? '#78350f' : '#064e3b', color: c.costRatio > 40 ? '#ef4444' : c.costRatio > 25 ? '#f59e0b' : '#10b981' }}>{c.costRatio.toFixed(1)}%</span>
                            ) : <span style={{ color: '#334155' }}>—</span>}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: c.profitAfterAll >= 0 ? '#059669' : '#dc2626' }}>{fmtRupiah(c.profitAfterAll)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                            <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: c.marginAfterAll >= 30 ? '#064e3b' : c.marginAfterAll >= 10 ? '#78350f' : '#7f1d1d', color: c.marginAfterAll >= 30 ? '#10b981' : c.marginAfterAll >= 10 ? '#f59e0b' : '#ef4444' }}>{c.marginAfterAll.toFixed(1)}%</span>
                          </td>
                        </tr>
                      ))}
                    </>
                  )}
                  {/* Other channels (flat) */}
                  {otherChannels.map(c => renderRow(c))}
                </>
              );
            })()}
            {/* Total row */}
            <tr style={{ borderTop: '2px solid #1a2744', background: '#0b1121' }}>
              <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11 }}>TOTAL</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{fmtRupiah(totalRevenue)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>100%</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#8b5cf6' }}>{fmtRupiah(totalMpAdmin)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>{fmtRupiah(totalAdsCost)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: '#1a2744', color: '#e2e8f0' }}>
                  {totalRevenue > 0 ? (totalCost / totalRevenue * 100).toFixed(1) : 0}%
                </span>
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: totalProfitAfterAll >= 0 ? '#10b981' : '#ef4444' }}>
                {fmtRupiah(totalProfitAfterAll)}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: '#1a2744', color: '#e2e8f0' }}>
                  {totalRevenue > 0 ? (totalProfitAfterAll / totalRevenue * 100).toFixed(1) : 0}%
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Product Breakdown Table */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, overflowX: 'auto', marginTop: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Product Breakdown</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 800 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #1a2744' }}>
              {['Product', 'Net Sales', '% Share', 'Admin Fee', 'Mkt Cost', 'Cost Ratio', 'GP After Mkt + Adm', 'Margin'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Product' ? 'left' : 'right', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {productBreakdown.map(p => (
              <tr key={p.name} style={{ borderBottom: '1px solid #1a2744' }}>
                <td style={{ padding: '8px 10px' }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{fmtRupiah(p.revenue)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: '#64748b' }}>{p.pct.toFixed(1)}%</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#8b5cf6' }}>
                  {p.mpAdmin > 0 ? fmtRupiah(p.mpAdmin) : <span style={{ color: '#334155' }}>—</span>}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#f59e0b' }}>
                  {p.adsCost > 0 ? fmtRupiah(p.adsCost) : <span style={{ color: '#334155' }}>—</span>}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  {p.totalCost > 0 ? (
                    <span style={{
                      padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                      background: p.costRatio > 40 ? '#7f1d1d' : p.costRatio > 25 ? '#78350f' : '#064e3b',
                      color: p.costRatio > 40 ? '#ef4444' : p.costRatio > 25 ? '#f59e0b' : '#10b981',
                    }}>{p.costRatio.toFixed(1)}%</span>
                  ) : <span style={{ color: '#334155' }}>—</span>}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: p.profitAfterAll >= 0 ? '#10b981' : '#ef4444' }}>
                  {fmtRupiah(p.profitAfterAll)}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  <span style={{
                    padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                    background: p.marginAfterAll >= 30 ? '#064e3b' : p.marginAfterAll >= 10 ? '#78350f' : '#7f1d1d',
                    color: p.marginAfterAll >= 30 ? '#10b981' : p.marginAfterAll >= 10 ? '#f59e0b' : '#ef4444',
                  }}>{p.marginAfterAll.toFixed(1)}%</span>
                </td>
              </tr>
            ))}
            {/* Total row */}
            <tr style={{ borderTop: '2px solid #1a2744', background: '#0b1121' }}>
              <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11 }}>TOTAL</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{fmtRupiah(totalRevenue)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>100%</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#8b5cf6' }}>{fmtRupiah(totalMpAdmin)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>{fmtRupiah(totalAdsCost)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: '#1a2744', color: '#e2e8f0' }}>
                  {totalRevenue > 0 ? (totalCost / totalRevenue * 100).toFixed(1) : 0}%
                </span>
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: totalProfitAfterAll >= 0 ? '#10b981' : '#ef4444' }}>
                {fmtRupiah(totalProfitAfterAll)}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: '#1a2744', color: '#e2e8f0' }}>
                  {totalRevenue > 0 ? (totalProfitAfterAll / totalRevenue * 100).toFixed(1) : 0}%
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Shipment Status Section */}
      <div style={{ marginTop: 20 }}>
        <ShipmentStatusSection from={dateRange.from} to={dateRange.to} />
      </div>

      {/* Order SLA Section */}
      <div style={{ marginTop: 20 }}>
        <ChannelSlaSection from={dateRange.from} to={dateRange.to} />
      </div>

      {/* WABA Promotion Analysis */}
      {wabaAnalysis.rows.length > 0 && (
        <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, marginTop: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#25D366' }}>●</span> WABA Promotion Analysis
          </div>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 700 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1a2744' }}>
                  {['Date', 'MM Sent', 'MM Delivered', 'Delivery Rate', 'Order Qty', 'WABA MM Cost', 'Total Purchase', 'Cost/Order'].map((h, i) => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: i === 0 ? 'left' : 'right', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {wabaAnalysis.rows.map(r => (
                  <tr key={r.date} style={{ borderBottom: '1px solid #1a274422' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 500, whiteSpace: 'nowrap', fontSize: 12 }}>{r.dateLabel}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{r.sent > 0 ? r.sent.toLocaleString() : '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{r.delivered > 0 ? r.delivered.toLocaleString() : '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: r.deliveryRate >= 95 ? '#10b981' : r.deliveryRate >= 85 ? '#f59e0b' : '#ef4444' }}>{r.sent > 0 ? `${r.deliveryRate.toFixed(1)}%` : '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{r.orders > 0 ? r.orders.toLocaleString() : '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#25D366' }}>{r.cost > 0 ? fmtCompact(r.cost) : '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{r.revenue > 0 ? fmtCompact(r.revenue) : '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>{r.orders > 0 ? fmtCompact(r.costPerOrder) : '—'}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid #1a2744' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 12 }}>TOTAL</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{wabaAnalysis.totals.sent.toLocaleString()}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{wabaAnalysis.totals.delivered.toLocaleString()}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: wabaAnalysis.totals.deliveryRate >= 95 ? '#10b981' : '#f59e0b' }}>{wabaAnalysis.totals.sent > 0 ? `${wabaAnalysis.totals.deliveryRate.toFixed(1)}%` : '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{wabaAnalysis.totals.orders.toLocaleString()}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: '#25D366' }}>{fmtCompact(wabaAnalysis.totals.cost)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{fmtCompact(wabaAnalysis.totals.revenue)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12 }}>{wabaAnalysis.totals.orders > 0 ? fmtCompact(wabaAnalysis.totals.costPerOrder) : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
