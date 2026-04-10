// @ts-nocheck
'use client';
import React, { useState, useEffect, useMemo } from 'react';
import { fmtCompact, fmtRupiah, shortDate, CHANNEL_COLORS } from '@/lib/utils';
import { useDateRange } from '@/lib/DateRangeContext';
import { getCached, setCache } from '@/lib/dashboard-cache';
import { getChannelsPageData } from '@/lib/channels-actions';
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
  const { dateRange, loading: dateLoading } = useDateRange();
  const [channelData, setChannelData] = useState([]);
  const [adsData, setAdsData] = useState([]);
  const [brandMapping, setBrandMapping] = useState([]);
  const [shipmentCounts, setShipmentCounts] = useState<{ date: string; product: string; channel: string; order_count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('all');
  const [scalevExpanded, setScalevExpanded] = useState(false);
  const [dailySalesOpen, setDailySalesOpen] = useState(false);
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set());
  const [prevChannelData, setPrevChannelData] = useState<any[]>([]);
  const [prevAdsData, setPrevAdsData] = useState<any[]>([]);
  const { activeBrands, error: activeBrandsError, isActiveBrand } = useActiveBrands();

  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    const { from, to } = dateRange;
    const fromDate = new Date(from + 'T00:00:00');
    const toDate = new Date(to + 'T00:00:00');
    const prevFrom = new Date(fromDate.getFullYear(), fromDate.getMonth() - 1, fromDate.getDate());
    const prevTo = new Date(toDate.getFullYear(), toDate.getMonth() - 1, toDate.getDate());
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const pf = fmt(prevFrom);
    const pt = fmt(prevTo);

    const cached = getCached<any>('channels_page_data', from, to, `${pf}|${pt}`);

    if (cached) {
      setChannelData(cached.channel.filter(row => isActiveBrand(row.product)));
      setAdsData(cached.ads);
      setBrandMapping(cached.brandMapping);
      setShipmentCounts(cached.shipmentCounts.filter(row => isActiveBrand(row.product)));
      setPrevChannelData(cached.prevChannel.filter(row => isActiveBrand(row.product)));
      setPrevAdsData(cached.prevAds);
      setError('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError('');

    getChannelsPageData({ from, to, prevFrom: pf, prevTo: pt })
      .then((data) => {
        if (cancelled) return;
        setCache('channels_page_data', from, to, data, `${pf}|${pt}`);
        setChannelData(data.channel.filter(row => isActiveBrand(row.product)));
        setAdsData(data.ads);
        setBrandMapping(data.brandMapping);
        setShipmentCounts(data.shipmentCounts.filter(row => isActiveBrand(row.product)));
        setPrevChannelData(data.prevChannel.filter(row => isActiveBrand(row.product)));
        setPrevAdsData(data.prevAds);
        setError('');
        setLoading(false);
      })
      .catch((e: any) => {
        if (cancelled) return;
        console.error('[Channels] load error:', e);
        setChannelData([]);
        setAdsData([]);
        setBrandMapping([]);
        setShipmentCounts([]);
        setPrevChannelData([]);
        setPrevAdsData([]);
        setError(e?.message || 'Gagal memuat data Sales Channel.');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [dateRange.from, dateRange.to, activeBrands, activeBrandsError, isActiveBrand]);

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
      const brand = getAdBrand(d.store);
      if (selectedProduct !== 'all') {
        if (brand !== selectedProduct) return;
      } else {
        // Skip ads without brand mapping or inactive brands (consistent with overview)
        if (!brand || !isActiveBrand(brand)) return;
      }
      const platform = normPlatform(d.source);
      byP[platform] = (byP[platform] || 0) + Math.abs(Number(d.spent || 0));
    });
    return byP;
  }, [adsData, selectedProduct, storeBrandMap, activeBrandsError, isActiveBrand]);

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

  // ── Previous month KPIs for delta comparison (total + per channel) ──
  const prevRevenue = useMemo(() => {
    if (prevChannelData.length === 0) return null;
    const filtered = prevChannelData.filter(d => selectedProduct === 'all' || d.product === selectedProduct);
    const total = filtered.reduce((sum, d) => sum + (Number(d.net_sales) || 0), 0);
    const gp = filtered.reduce((sum, d) => sum + (Number(d.gross_profit) || 0), 0);
    const mpAdmin = filtered.reduce((sum, d) => sum + Math.abs(Number(d.mp_admin_cost) || 0), 0);
    // Compute prev ads cost
    let adsCost = 0;
    prevAdsData.forEach(d => {
      if (selectedProduct !== 'all') {
        const brand = getAdBrand(d.store);
        if (brand !== selectedProduct) return;
      } else {
        const brand = getAdBrand(d.store);
        if (!brand || !isActiveBrand(brand)) return;
      }
      adsCost += Math.abs(Number(d.spent || 0));
    });
    const totalCost = mpAdmin + adsCost;
    const profitAfterAll = gp - totalCost;
    const byChannel: Record<string, number> = {};
    filtered.forEach(d => {
      if (d.channel) byChannel[d.channel] = (byChannel[d.channel] || 0) + (Number(d.net_sales) || 0);
    });
    return { total, gp, mpAdmin, adsCost, totalCost, profitAfterAll, byChannel };
  }, [prevChannelData, prevAdsData, selectedProduct, storeBrandMap, activeBrandsError, isActiveBrand]);

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


  const prevMonthLabel = useMemo(() => {
    if (!dateRange.from) return '';
    const d = new Date(dateRange.from + 'T00:00:00');
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return prev.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
  }, [dateRange.from]);

  const DeltaLine = ({ value, suffix, higherIsBetter, label: lbl }: { value: number; suffix?: string; higherIsBetter?: boolean; label?: string }) => (
    <div style={{ fontSize: 10, marginTop: 4, color: ((value > 0) === (higherIsBetter !== false)) ? '#5b8a7a' : '#9b6b6b' }}>
      {value > 0 ? '▲' : '▼'} {value >= 0 ? '+' : ''}{value.toFixed(1)}{suffix || '%'}{lbl ? ` ${lbl}` : ` vs ${prevMonthLabel}`}
    </div>
  );
  const KPI = ({ label, val, sub, color = 'var(--accent)', delta, delta2 }: { label: string; val: string; sub?: string; color?: string; delta?: any; delta2?: any }) => (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', flex: '1 1 160px', minWidth: 150, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{ fontSize: 11, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1.1 }}>{val}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>{sub}</div>}
      {delta && delta.value !== 0 && <DeltaLine {...delta} />}
      {delta2 && delta2.value !== 0 && <DeltaLine {...delta2} />}
    </div>
  );

  if (dateLoading || (loading && channelData.length === 0)) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--dim)' }}>
        <div className="spinner" style={{ width: 32, height: 32, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%', margin: '0 auto 12px' }} />
        <div>Memuat data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fade-in">
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Channel</h2>
        <div style={{ background: 'rgba(127,29,29,0.15)', border: '1px solid #991b1b', borderRadius: 12, padding: 18, color: '#fca5a5' }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Data Sales Channel Gagal Dimuat</div>
          <div style={{ fontSize: 13 }}>{error}</div>
        </div>
      </div>
    );
  }

  if (channelData.length === 0 && !loading) {
    return (
      <div className="fade-in">
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Channel</h2>
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--dim)', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12 }}>
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
            padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--card)', color: 'var(--text)', fontSize: 13, fontWeight: 500,
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
        <KPI label="Net Sales" val={`Rp ${fmtCompact(totalRevenue)}`} sub={`${channels.length} active channels`} color="var(--accent)"
          delta={prevRevenue && prevRevenue.total > 0 ? { value: ((totalRevenue - prevRevenue.total) / prevRevenue.total) * 100 } : undefined} />
        <KPI
          label="Admin Fee"
          val={`Rp ${fmtCompact(totalMpAdmin)}`}
          sub={
            <span>
              <span style={{ color: '#c4b5fd' }}>{totalMpRevenue > 0 ? (totalMpAdmin / totalMpRevenue * 100).toFixed(1) : 0}%</span>
              <span style={{ color: 'var(--dim)' }}> of MP rev</span>
              <span style={{ color: 'var(--dim)', margin: '0 5px' }}>·</span>
              <span style={{ color: 'var(--text-secondary)' }}>{totalRevenue > 0 ? (totalMpAdmin / totalRevenue * 100).toFixed(1) : 0}%</span>
              <span style={{ color: 'var(--dim)' }}> of total</span>
            </span>
          }
          color="#8b5cf6"
          delta={prevRevenue && prevRevenue.mpAdmin > 0 ? { value: ((totalMpAdmin - prevRevenue.mpAdmin) / prevRevenue.mpAdmin) * 100, higherIsBetter: false } : undefined}
        />
        <KPI
          label="Mkt Cost"
          val={`Rp ${fmtCompact(totalAdsCost)}`}
          sub={`${totalRevenue > 0 ? (totalAdsCost / totalRevenue * 100).toFixed(1) : 0}% of revenue`}
          color="var(--yellow)"
          delta={prevRevenue && prevRevenue.adsCost > 0 ? { value: ((totalAdsCost - prevRevenue.adsCost) / prevRevenue.adsCost) * 100, higherIsBetter: false } : undefined}
        />
        <KPI
          label="GP After Mkt + Adm"
          val={`Rp ${fmtCompact(totalProfitAfterAll)}`}
          sub={`Margin: ${totalRevenue > 0 ? (totalProfitAfterAll / totalRevenue * 100).toFixed(1) : 0}%`}
          color={totalProfitAfterAll >= 0 ? '#06b6d4' : 'var(--red)'}
          delta={prevRevenue && prevRevenue.profitAfterAll !== 0 ? { value: ((totalProfitAfterAll - prevRevenue.profitAfterAll) / Math.abs(prevRevenue.profitAfterAll)) * 100 } : undefined}
          delta2={prevRevenue && prevRevenue.total > 0 ? { value: (totalRevenue > 0 ? totalProfitAfterAll / totalRevenue * 100 : 0) - (prevRevenue.profitAfterAll / prevRevenue.total * 100), suffix: 'pp', label: 'margin' } : undefined}
        />
      </div>

      {/* Combined Daily Sales & Shipments Table (Collapsible) */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <div
          onClick={() => setDailySalesOpen(!dailySalesOpen)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
        >
          <span style={{ fontSize: 13, color: 'var(--dim)', transition: 'transform 0.2s', transform: dailySalesOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>&#9654;</span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>Active Daily Sales &amp; Shipments</span>
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>({dailyCombined.rows.length} days · month-over-month)</span>
        </div>
        {dailySalesOpen && dailyCombined.rows.length > 0 ? (<>
          {/* Hide/unhide channel toggles */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
            {dailyCombined.channelNames.map(ch => {
              const isHidden = hiddenChannels.has(ch);
              return (
                <button key={ch} onClick={() => {
                  setHiddenChannels(prev => {
                    const next = new Set(prev);
                    if (next.has(ch)) next.delete(ch); else next.add(ch);
                    return next;
                  });
                }} style={{
                  padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6,
                  border: `1px solid ${isHidden ? 'var(--border)' : (CHANNEL_COLORS[ch] || 'var(--dim)')}`,
                  background: isHidden ? 'transparent' : `${CHANNEL_COLORS[ch] || 'var(--dim)'}15`,
                  color: isHidden ? 'var(--dim)' : (CHANNEL_COLORS[ch] || 'var(--text)'),
                  cursor: 'pointer', opacity: isHidden ? 0.5 : 1, textDecoration: isHidden ? 'line-through' : 'none',
                }}>
                  {ch}
                </button>
              );
            })}
          </div>
          {(() => {
            const visibleChannels = dailyCombined.channelNames.filter(ch => !hiddenChannels.has(ch));
            const visibleRows = dailyCombined.rows.filter(row => {
              const totalOrders = visibleChannels.reduce((sum, ch) => sum + (row.channels[ch]?.orders || 0), 0);
              const totalRevenue = visibleChannels.reduce((sum, ch) => sum + (row.channels[ch]?.revenue || 0), 0);
              return totalOrders > 0 || totalRevenue > 0;
            });
            return (
          <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, minWidth: Math.max(600, 120 + visibleChannels.length * 130 + 130), width: '100%' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--dim)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }}>Date</th>
                {visibleChannels.map(ch => (
                  <th key={ch} style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, fontSize: 10, textTransform: 'uppercase', color: CHANNEL_COLORS[ch] || 'var(--dim)' }}>{ch}</th>
                ))}
                <th style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--text)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(row => {
                const rowTotalOrders = visibleChannels.reduce((sum, ch) => sum + (row.channels[ch]?.orders || 0), 0);
                const rowTotalRevenue = visibleChannels.reduce((sum, ch) => sum + (row.channels[ch]?.revenue || 0), 0);
                return (
                <tr key={row.date} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 }}>{shortDate(row.date)}</td>
                  {visibleChannels.map(ch => {
                    const cell = row.channels[ch];
                    const hasData = cell && (cell.revenue || cell.orders);
                    return (
                      <td key={ch} style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>
                        {hasData ? (
                          <>
                            <div>{fmtRupiah(cell.revenue)}</div>
                            {cell.orders > 0 && <div style={{ fontSize: 10, color: 'var(--dim)', fontStyle: 'italic' }}>{cell.orders.toLocaleString('id-ID')}</div>}
                          </>
                        ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                    );
                  })}
                  <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>
                    <div>{fmtRupiah(rowTotalRevenue)}</div>
                    <div style={{ fontSize: 10, color: 'var(--dim)', fontStyle: 'italic' }}>{rowTotalOrders.toLocaleString('id-ID')}</div>
                  </td>
                </tr>
                );
              })}
              {/* Grand Total row */}
              <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg)' }}>
                <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11, position: 'sticky', left: 0, background: 'var(--bg)', zIndex: 1 }}>TOTAL</td>
                {visibleChannels.map(ch => {
                  const chOrders = visibleRows.reduce((sum, r) => sum + (r.channels[ch]?.orders || 0), 0);
                  const chRevenue = visibleRows.reduce((sum, r) => sum + (r.channels[ch]?.revenue || 0), 0);
                  const prevChRev = prevRevenue?.byChannel[ch];
                  const chDelta = prevChRev && prevChRev > 0 ? ((chRevenue - prevChRev) / prevChRev) * 100 : null;
                  return (
                    <td key={ch} style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: CHANNEL_COLORS[ch] || 'var(--text)' }}>
                      {chRevenue > 0 ? (
                        <>
                          <div>{fmtRupiah(chRevenue)}</div>
                          {chOrders > 0 && <div style={{ fontSize: 10, fontStyle: 'italic', opacity: 0.7 }}>{chOrders.toLocaleString('id-ID')}</div>}
                          {chDelta !== null && (
                            <div style={{ fontSize: 10, marginTop: 2, color: chDelta >= 0 ? '#5b8a7a' : '#9b6b6b' }}>
                              {chDelta >= 0 ? '▲' : '▼'} {chDelta >= 0 ? '+' : ''}{chDelta.toFixed(1)}%
                            </div>
                          )}
                        </>
                      ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                  );
                })}
                {(() => {
                  const grandRevenue = visibleRows.reduce((sum, r) => sum + visibleChannels.reduce((s, ch) => s + (r.channels[ch]?.revenue || 0), 0), 0);
                  const grandOrders = visibleRows.reduce((sum, r) => sum + visibleChannels.reduce((s, ch) => s + (r.channels[ch]?.orders || 0), 0), 0);
                  const revDelta = prevRevenue && prevRevenue.total > 0 ? ((grandRevenue - prevRevenue.total) / prevRevenue.total) * 100 : null;
                  return (
                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>
                      <div>{fmtRupiah(grandRevenue)}</div>
                      <div style={{ fontSize: 10, color: 'var(--dim)', fontStyle: 'italic' }}>{grandOrders.toLocaleString('id-ID')}</div>
                      {revDelta !== null && (
                        <div style={{ fontSize: 10, marginTop: 2, color: revDelta >= 0 ? '#5b8a7a' : '#9b6b6b' }}>
                          {revDelta >= 0 ? '▲' : '▼'} {revDelta >= 0 ? '+' : ''}{revDelta.toFixed(1)}% vs prev
                        </div>
                      )}
                    </td>
                  );
                })()}
              </tr>
            </tbody>
          </table>
          </div>
            );
          })()}
        </>) : dailySalesOpen ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--dim)', fontSize: 12 }}>Tidak ada data harian untuk periode ini.</div>
        ) : null}
      </div>

      {/* Channel Breakdown Table */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, overflowX: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Channel Breakdown</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 800 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              {['Channel', 'Net Sales', '% Share', 'Admin Fee', 'Mkt Cost', 'Cost Ratio', 'GP After Mkt + Adm', 'Margin'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Channel' ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
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
                <tr key={c.name} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ fontWeight: 600 }} title={CHANNEL_TOOLTIP[c.name] || ''}>{c.name}</div>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{fmtRupiah(c.revenue)}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--dim)' }}>{c.pct.toFixed(1)}%</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#8b5cf6' }}>
                    {c.mpAdmin > 0 ? fmtRupiah(c.mpAdmin) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: 'var(--yellow)' }}>
                    {c.adsCost > 0 ? fmtRupiah(c.adsCost) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    {c.totalCost > 0 ? (
                      <span style={{
                        padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                        background: c.costRatio > 40 ? 'var(--badge-red-bg)' : c.costRatio > 25 ? 'var(--badge-yellow-bg)' : 'var(--badge-green-bg)',
                        color: c.costRatio > 40 ? 'var(--red)' : c.costRatio > 25 ? 'var(--yellow)' : 'var(--green)',
                      }}>{c.costRatio.toFixed(1)}%</span>
                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: c.profitAfterAll >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {fmtRupiah(c.profitAfterAll)}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    <span style={{
                      padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                      background: c.marginAfterAll >= 30 ? 'var(--badge-green-bg)' : c.marginAfterAll >= 10 ? 'var(--badge-yellow-bg)' : 'var(--badge-red-bg)',
                      color: c.marginAfterAll >= 30 ? 'var(--green)' : c.marginAfterAll >= 10 ? 'var(--yellow)' : 'var(--red)',
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
                        style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                        onClick={() => setScalevExpanded(prev => !prev)}
                        title="Klik untuk lihat breakdown CS Manual & Scalev Ads"
                      >
                        <td style={{ padding: '8px 10px' }}>
                          <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 9, color: 'var(--dim)', transition: 'transform 0.15s', display: 'inline-block', transform: scalevExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                            Scalev
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{fmtRupiah(sv.revenue)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--dim)' }}>{svPct.toFixed(1)}%</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#8b5cf6' }}>
                          {sv.mpAdmin > 0 ? fmtRupiah(sv.mpAdmin) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: 'var(--yellow)' }}>
                          {sv.adsCost > 0 ? fmtRupiah(sv.adsCost) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          {svTotalCost > 0 ? (
                            <span style={{
                              padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                              background: svCostRatio > 40 ? 'var(--badge-red-bg)' : svCostRatio > 25 ? 'var(--badge-yellow-bg)' : 'var(--badge-green-bg)',
                              color: svCostRatio > 40 ? 'var(--red)' : svCostRatio > 25 ? 'var(--yellow)' : 'var(--green)',
                            }}>{svCostRatio.toFixed(1)}%</span>
                          ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: svProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {fmtRupiah(svProfit)}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                          <span style={{
                            padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                            background: svMargin >= 30 ? 'var(--badge-green-bg)' : svMargin >= 10 ? 'var(--badge-yellow-bg)' : 'var(--badge-red-bg)',
                            color: svMargin >= 30 ? 'var(--green)' : svMargin >= 10 ? 'var(--yellow)' : 'var(--red)',
                          }}>{svMargin.toFixed(1)}%</span>
                        </td>
                      </tr>
                      {/* Nested breakdown (visible when expanded) */}
                      {scalevExpanded && scalevGroup.map(c => (
                        <tr key={c.name} style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                          <td style={{ padding: '6px 10px', paddingLeft: 32 }}>
                            <div style={{ fontWeight: 500, fontSize: 11, color: 'var(--text-secondary)' }} title={CHANNEL_TOOLTIP[c.name] || ''}>{c.name}</div>
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: 'var(--text-secondary)' }}>{fmtRupiah(c.revenue)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontSize: 10, color: 'var(--text-muted)' }}>{c.pct.toFixed(1)}%</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: '#7c3aed' }}>
                            {c.mpAdmin > 0 ? fmtRupiah(c.mpAdmin) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: '#d97706' }}>
                            {c.adsCost > 0 ? fmtRupiah(c.adsCost) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                            {c.totalCost > 0 ? (
                              <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: c.costRatio > 40 ? 'var(--badge-red-bg)' : c.costRatio > 25 ? 'var(--badge-yellow-bg)' : 'var(--badge-green-bg)', color: c.costRatio > 40 ? 'var(--red)' : c.costRatio > 25 ? 'var(--yellow)' : 'var(--green)' }}>{c.costRatio.toFixed(1)}%</span>
                            ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                          </td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 10, color: c.profitAfterAll >= 0 ? '#059669' : '#dc2626' }}>{fmtRupiah(c.profitAfterAll)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                            <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: c.marginAfterAll >= 30 ? 'var(--badge-green-bg)' : c.marginAfterAll >= 10 ? 'var(--badge-yellow-bg)' : 'var(--badge-red-bg)', color: c.marginAfterAll >= 30 ? 'var(--green)' : c.marginAfterAll >= 10 ? 'var(--yellow)' : 'var(--red)' }}>{c.marginAfterAll.toFixed(1)}%</span>
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
            <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg)' }}>
              <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11 }}>TOTAL</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{fmtRupiah(totalRevenue)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>100%</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#8b5cf6' }}>{fmtRupiah(totalMpAdmin)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: 'var(--yellow)' }}>{fmtRupiah(totalAdsCost)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'var(--border)', color: 'var(--text)' }}>
                  {totalRevenue > 0 ? (totalCost / totalRevenue * 100).toFixed(1) : 0}%
                </span>
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: totalProfitAfterAll >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtRupiah(totalProfitAfterAll)}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'var(--border)', color: 'var(--text)' }}>
                  {totalRevenue > 0 ? (totalProfitAfterAll / totalRevenue * 100).toFixed(1) : 0}%
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Product Breakdown Table */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16, overflowX: 'auto', marginTop: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Product Breakdown</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 800 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              {['Product', 'Net Sales', '% Share', 'Admin Fee', 'Mkt Cost', 'Cost Ratio', 'GP After Mkt + Adm', 'Margin'].map(h => (
                <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Product' ? 'left' : 'right', color: 'var(--dim)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {productBreakdown.map(p => (
              <tr key={p.name} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 10px' }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{fmtRupiah(p.revenue)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--dim)' }}>{p.pct.toFixed(1)}%</td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: '#8b5cf6' }}>
                  {p.mpAdmin > 0 ? fmtRupiah(p.mpAdmin) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: 'var(--yellow)' }}>
                  {p.adsCost > 0 ? fmtRupiah(p.adsCost) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  {p.totalCost > 0 ? (
                    <span style={{
                      padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                      background: p.costRatio > 40 ? 'var(--badge-red-bg)' : p.costRatio > 25 ? 'var(--badge-yellow-bg)' : 'var(--badge-green-bg)',
                      color: p.costRatio > 40 ? 'var(--red)' : p.costRatio > 25 ? 'var(--yellow)' : 'var(--green)',
                    }}>{p.costRatio.toFixed(1)}%</span>
                  ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: p.profitAfterAll >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmtRupiah(p.profitAfterAll)}
                </td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  <span style={{
                    padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700,
                    background: p.marginAfterAll >= 30 ? 'var(--badge-green-bg)' : p.marginAfterAll >= 10 ? 'var(--badge-yellow-bg)' : 'var(--badge-red-bg)',
                    color: p.marginAfterAll >= 30 ? 'var(--green)' : p.marginAfterAll >= 10 ? 'var(--yellow)' : 'var(--red)',
                  }}>{p.marginAfterAll.toFixed(1)}%</span>
                </td>
              </tr>
            ))}
            {/* Total row */}
            <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg)' }}>
              <td style={{ padding: '8px 10px', fontWeight: 700, fontSize: 11 }}>TOTAL</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{fmtRupiah(totalRevenue)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>100%</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#8b5cf6' }}>{fmtRupiah(totalMpAdmin)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: 'var(--yellow)' }}>{fmtRupiah(totalAdsCost)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'var(--border)', color: 'var(--text)' }}>
                  {totalRevenue > 0 ? (totalCost / totalRevenue * 100).toFixed(1) : 0}%
                </span>
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: totalProfitAfterAll >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtRupiah(totalProfitAfterAll)}
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                <span style={{ padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, background: 'var(--border)', color: 'var(--text)' }}>
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

    </div>
  );
}
