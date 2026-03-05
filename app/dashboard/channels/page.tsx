// @ts-nocheck
'use client';
import { useState, useEffect, useMemo } from 'react';
import { useSupabase } from '@/lib/supabase-browser';
import { fmtCompact, fmtRupiah, shortDate, CHANNEL_COLORS } from '@/lib/utils';
import { useDateRange } from '@/lib/DateRangeContext';
import { getCached, setCache } from '@/lib/dashboard-cache';
// PieChart removed – no longer used on this page
import { useActiveBrands } from '@/lib/ActiveBrandsContext';
import ChannelSlaSection from '@/components/ChannelSlaSection';

// ── Normalize ad source → platform (same logic as marketing page) ──
// ── Ads Source → Marketing Platform (sales POV: NO organic spillover) ──
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

// ── Marketing Platform → Sales Channels served (sales POV, strict — no Organik) ──
// "Facebook Ads" is the DB value for Scalev website orders
const PLATFORM_CHANNEL_MAP = {
  'Meta Ads':    ['Facebook Ads'],
  'Google Ads':  ['Facebook Ads'],
  'Shopee Ads':  ['Shopee'],
  'TikTok Ads':  ['TikTok', 'TikTok Shop'],
};

// ── Sales channel display names (DB value → display label) ──
const CHANNEL_DISPLAY_NAME: Record<string, string> = {
  'Facebook Ads': 'Scalev',
};

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
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState('all');
  const { isActiveBrand } = useActiveBrands();

  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    const { from, to } = dateRange;

    const cachedCh = getCached('daily_channel_data_ch', from, to);
    const cachedAds = getCached('daily_ads_spend_ch', from, to);
    const cachedBm = getCached('ads_store_brand_mapping', from, to);

    if (cachedCh && cachedAds && cachedBm) {
      setChannelData(cachedCh.filter(row => isActiveBrand(row.product)));
      setAdsData(cachedAds);
      setBrandMapping(cachedBm);
      setLoading(false);
      return;
    }

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
      // Log errors so RLS / permission issues surface in console
      if (chRes.error) console.error('[Channels] daily_channel_data error:', chRes.error);
      if (adsRes.error) console.error('[Channels] daily_ads_spend error:', adsRes.error);
      if (bmRes.error) console.error('[Channels] ads_store_brand_mapping error:', bmRes.error);

      const chRows = chRes.data || [];
      const adsRows = adsRes.data || [];
      const bmRows = bmRes.data || [];
      setCache('daily_channel_data_ch', from, to, chRows);
      setCache('daily_ads_spend_ch', from, to, adsRows);
      setCache('ads_store_brand_mapping', from, to, bmRows);
      setChannelData(chRows.filter(row => isActiveBrand(row.product)));
      setAdsData(adsRows);
      setBrandMapping(bmRows);
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
          name: CHANNEL_DISPLAY_NAME[ch] || ch,
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
        const pinOrder = ['Organik', 'Scalev', 'Reseller'];
        const aPin = pinOrder.indexOf(a.name);
        const bPin = pinOrder.indexOf(b.name);
        if (aPin !== -1 && bPin !== -1) return aPin - bPin;
        if (aPin !== -1) return -1;
        if (bPin !== -1) return 1;
        return b.revenue - a.revenue;
      });
  }, [channelData, selectedProduct, adsPerChannel]);

  // ── Daily Sales pivot: date × channel → net_sales ──
  const dailySales = useMemo(() => {
    const byDate: Record<string, Record<string, number>> = {};
    const channelSet = new Set<string>();

    channelData.forEach(d => {
      if (selectedProduct !== 'all' && d.product !== selectedProduct) return;
      if (!d.date) return;
      const displayName = CHANNEL_DISPLAY_NAME[d.channel] || d.channel;
      channelSet.add(displayName);
      if (!byDate[d.date]) byDate[d.date] = {};
      byDate[d.date][displayName] = (byDate[d.date][displayName] || 0) + (Number(d.net_sales) || 0);
    });

    // Sort channels: pin Organik, Scalev, Reseller first, rest by total revenue desc
    const pinOrder = ['Organik', 'Scalev', 'Reseller'];
    const chTotals: Record<string, number> = {};
    Object.values(byDate).forEach(row => {
      Object.entries(row).forEach(([ch, val]) => { chTotals[ch] = (chTotals[ch] || 0) + val; });
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
      .map(([date, chMap]) => {
        const total = Object.values(chMap).reduce((sum, v) => sum + v, 0);
        return { date, channels: chMap, total };
      });

    return { rows, channelNames: sortedChannels };
  }, [channelData, selectedProduct]);

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

      {/* Daily Sales Table */}
      <div style={{ background: '#111a2e', border: '1px solid #1a2744', borderRadius: 12, padding: 16, overflowX: 'auto', marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Daily Sales</div>
        {dailySales.rows.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: Math.max(600, 120 + dailySales.channelNames.length * 130) }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #1a2744' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: '#64748b', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', position: 'sticky', left: 0, background: '#111a2e', zIndex: 1 }}>Date</th>
                {dailySales.channelNames.map(ch => (
                  <th key={ch} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', color: CHANNEL_COLORS[ch] || '#64748b' }}>{ch}</th>
                ))}
                <th style={{ padding: '8px 10px', textAlign: 'right', color: '#e2e8f0', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {dailySales.rows.map(row => (
                <tr key={row.date} style={{ borderBottom: '1px solid #1a2744' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: '#111a2e', zIndex: 1 }}>{shortDate(row.date)}</td>
                  {dailySales.channelNames.map(ch => (
                    <td key={ch} style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>
                      {row.channels[ch] ? fmtRupiah(row.channels[ch]) : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                  ))}
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{fmtRupiah(row.total)}</td>
                </tr>
              ))}
              {/* Grand Total row */}
              <tr style={{ borderTop: '2px solid #1a2744', background: '#0b1121' }}>
                <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11, position: 'sticky', left: 0, background: '#0b1121', zIndex: 1 }}>TOTAL</td>
                {dailySales.channelNames.map(ch => {
                  const chTotal = dailySales.rows.reduce((sum, r) => sum + (r.channels[ch] || 0), 0);
                  return (
                    <td key={ch} style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: CHANNEL_COLORS[ch] || '#e2e8f0' }}>
                      {chTotal > 0 ? fmtRupiah(chTotal) : <span style={{ color: '#334155' }}>—</span>}
                    </td>
                  );
                })}
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{fmtRupiah(dailySales.rows.reduce((sum, r) => sum + r.total, 0))}</td>
              </tr>
            </tbody>
          </table>
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
            {channels.map(c => (
              <tr key={c.name} style={{ borderBottom: '1px solid #1a2744' }}>
                <td style={{ padding: '8px 10px' }}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
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

      {/* Order SLA Section */}
      <div style={{ marginTop: 20 }}>
        <ChannelSlaSection from={dateRange.from} to={dateRange.to} />
      </div>
    </div>
  );
}
