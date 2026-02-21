// @ts-nocheck
'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { fmtCompact, fmtRupiah } from '@/lib/utils';
import { useDateRange } from '@/lib/DateRangeContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Line, Cell
} from 'recharts';

// ── Normalize store name ──
function normStore(s: string): string {
  if (!s) return 'Other';
  if (s === 'Purvu Store') return 'Purvu';
  return s;
}

// ── Normalize platform/source name for grouping ──
function normPlatform(source: string): string {
  if (!source) return 'Other';
  const s = source.toLowerCase();
  if (s.includes('cpas')) return 'CPAS';
  if (s.includes('shopee') && s.includes('live')) return 'Shopee Live';
  if (s.includes('shopee')) return 'Shopee Ads';
  if (s.includes('tiktok')) return 'TikTok Ads';
  if (s.includes('facebook')) return 'Facebook Ads';
  if (s.includes('google')) return 'Google Ads';
  if (s.includes('whatsapp') || s.includes('waba')) return 'WhatsApp';
  if (s.includes('snack')) return 'SnackVideo Ads';
  return source;
}

// ── Attribution map: which ads platforms contribute to which revenue channels ──
// Facebook Ads intentionally appears in BOTH Scalev and Shopee (demand generator spillover)
const ATTRIBUTION_MAP: Record<string, string[]> = {
  'Facebook Ads': ['Scalev', 'Shopee'],
  'Google Ads': ['Scalev'],
  'WhatsApp': ['Scalev'],
  'CPAS': ['Shopee'],
  'Shopee Ads': ['Shopee'],
  'Shopee Live': ['Shopee'],
  'TikTok Ads': ['TikTok'],
  'SnackVideo Ads': [],
};

// Revenue channels for the matrix
const REVENUE_CHANNELS = ['Scalev', 'Shopee', 'TikTok'];

// ── Platform colors ──
const PLATFORM_COLORS: Record<string, string> = {
  'Facebook Ads': '#1877f2',
  'TikTok Ads': '#ff0050',
  'Shopee Ads': '#ee4d2d',
  'Shopee Live': '#f97316',
  'CPAS': '#8b5cf6',
  'Google Ads': '#4285f4',
  'WhatsApp': '#25d366',
  'SnackVideo Ads': '#fbbf24',
  'Other': '#64748b',
};

// ── Channel colors ──
const CHANNEL_COLORS: Record<string, string> = {
  'Scalev': '#3b82f6',
  'Shopee': '#ee4d2d',
  'TikTok': '#ff0050',
  'Tokopedia': '#10b981',
  'BliBli': '#06b6d4',
  'Lazada': '#1a237e',
  'Reseller': '#f59e0b',
};

// ── Brand colors ──
const BRAND_COLORS: Record<string, string> = {
  'Roove': '#3b82f6',
  'Purvu': '#8b5cf6',
  'Pluve': '#06b6d4',
  'Osgard': '#f97316',
  'DrHyun': '#ec4899',
  'Calmara': '#f59e0b',
  'Globite': '#10b981',
  'Other': '#64748b',
};

export default function MarketingPage() {
  const supabase = createClient();
  const { dateRange, loading: dateLoading } = useDateRange();

  const [prodData, setProdData] = useState<any[]>([]);
  const [adsData, setAdsData] = useState<any[]>([]);
  const [channelData, setChannelData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [brandFilter, setBrandFilter] = useState('all');

  // ── Fetch data ──
  useEffect(() => {
    if (!dateRange.from || !dateRange.to) return;
    setLoading(true);
    Promise.all([
      supabase
        .from('daily_product_summary')
        .select('date, product, net_sales, mkt_cost')
        .gte('date', dateRange.from)
        .lte('date', dateRange.to),
      supabase
        .from('daily_ads_spend')
        .select('date, source, spent, store')
        .gte('date', dateRange.from)
        .lte('date', dateRange.to),
      supabase
        .from('daily_channel_data')
        .select('date, channel, net_sales')
        .gte('date', dateRange.from)
        .lte('date', dateRange.to),
    ]).then(([{ data: prod }, { data: ads }, { data: ch }]) => {
      setProdData(prod || []);
      setAdsData(ads || []);
      setChannelData(ch || []);
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
      totalRevenue: rev,
      totalSpend: spend,
      totalRatio: rev > 0 ? (spend / rev) * 100 : 0,
      totalRoas: spend > 0 ? rev / spend : 0,
      avgDailyRatio: dailyRatios.length > 0 ? dailyRatios.reduce((a, b) => a + b, 0) / dailyRatios.length : 0,
      avgDailyRoas: dailyRoas.length > 0 ? dailyRoas.reduce((a, b) => a + b, 0) / dailyRoas.length : 0,
      activeDays: days.length,
    };
  }, [prodData, adsData]);

  // ── Daily chart data (Revenue + Spend + Ratio) ──
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
    return {
      data: sortedDates.map(([date, vals]) => ({ date, ...vals })),
      brands: Array.from(brands).sort(),
    };
  }, [adsData]);

  // ── Unique brands for filter ──
  const uniqueBrands = useMemo(() => {
    const set = new Set<string>();
    adsData.forEach(d => {
      const brand = normStore(d.store);
      if (brand && brand !== 'Other') set.add(brand);
    });
    return Array.from(set).sort();
  }, [adsData]);

  // ── Platform breakdown (with blended ROAS) ──
  const platformBreakdown = useMemo(() => {
    const filtered = brandFilter === 'all'
      ? adsData
      : adsData.filter(d => normStore(d.store) === brandFilter);

    const filteredRevenue = prodData.reduce((s, d) => s + Number(d.net_sales || 0), 0);

    const byPlatform: Record<string, number> = {};
    filtered.forEach(d => {
      const platform = normPlatform(d.source);
      byPlatform[platform] = (byPlatform[platform] || 0) + Math.abs(Number(d.spent || 0));
    });

    const total = Object.values(byPlatform).reduce((a, b) => a + b, 0);
    const numDays = new Set(filtered.map(d => d.date)).size || 1;

    return Object.entries(byPlatform)
      .sort(([, a], [, b]) => b - a)
      .map(([platform, spent]) => ({
        platform,
        spent,
        pct: total > 0 ? (spent / total) * 100 : 0,
        dailyAvg: spent / numDays,
        blendedRoas: spent > 0 ? filteredRevenue / spent : 0,
        color: PLATFORM_COLORS[platform] || '#64748b',
      }));
  }, [adsData, prodData, brandFilter]);

  // ── Per-brand breakdown table ──
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
      .map(([brand, platforms_data]) => {
        const total = Object.values(platforms_data).reduce((a, b) => a + b, 0);
        return { brand, ...platforms_data, _total: total };
      })
      .sort((a, b) => b._total - a._total);

    return { rows, platforms };
  }, [adsData, brandFilter]);

  // ══════════════════════════════════════════════════════════════════════
  // ATTRIBUTION: Channel Revenue + Attributed Spend → Channel ROAS
  // ══════════════════════════════════════════════════════════════════════

  // Aggregate revenue per channel from daily_channel_data
  const channelRevenue = useMemo(() => {
    const byCh: Record<string, number> = {};
    channelData.forEach(d => {
      const ch = d.channel || 'Other';
      byCh[ch] = (byCh[ch] || 0) + Number(d.net_sales || 0);
    });
    return byCh;
  }, [channelData]);

  // Aggregate spend per normalized platform
  const platformSpend = useMemo(() => {
    const byP: Record<string, number> = {};
    adsData.forEach(d => {
      const p = normPlatform(d.source);
      byP[p] = (byP[p] || 0) + Math.abs(Number(d.spent || 0));
    });
    return byP;
  }, [adsData]);

  // Build channel ROAS data
  const channelRoasData = useMemo(() => {
    return REVENUE_CHANNELS.map(ch => {
      const revenue = channelRevenue[ch] || 0;

      // Find all platforms that attribute to this channel
      const attributedPlatforms = Object.entries(ATTRIBUTION_MAP)
        .filter(([, channels]) => channels.includes(ch))
        .map(([platform]) => platform);

      // Sum their spend
      const attributedSpend = attributedPlatforms.reduce(
        (sum, p) => sum + (platformSpend[p] || 0), 0
      );

      // Check for double-counted platforms (platforms attributed to multiple channels)
      const doubleCountedPlatforms = attributedPlatforms.filter(p => {
        const attrs = ATTRIBUTION_MAP[p] || [];
        return attrs.length > 1;
      });

      return {
        channel: ch,
        revenue,
        attributedSpend,
        roas: attributedSpend > 0 ? revenue / attributedSpend : 0,
        platforms: attributedPlatforms,
        platformDetails: attributedPlatforms.map(p => ({
          name: p,
          spend: platformSpend[p] || 0,
          isShared: (ATTRIBUTION_MAP[p] || []).length > 1,
          sharedWith: (ATTRIBUTION_MAP[p] || []).filter(c => c !== ch),
        })),
        hasDoubleCount: doubleCountedPlatforms.length > 0,
        doubleCountedPlatforms,
        color: CHANNEL_COLORS[ch] || '#64748b',
      };
    }).filter(d => d.revenue > 0 || d.attributedSpend > 0);
  }, [channelRevenue, platformSpend]);

  // ── Product efficiency ──
  const prodEfficiency = useMemo(() => {
    const byP: Record<string, { s: number; m: number }> = {};
    prodData.forEach((d: any) => {
      if (!byP[d.product]) byP[d.product] = { s: 0, m: 0 };
      byP[d.product].s += Number(d.net_sales);
      byP[d.product].m += Math.abs(Number(d.mkt_cost));
    });
    return Object.entries(byP)
      .filter(([, v]) => v.m > 0)
      .sort((a, b) => (a[1].s > 0 ? a[1].m / a[1].s : 999) - (b[1].s > 0 ? b[1].m / b[1].s : 999))
      .map(([p, v]) => ({
        sku: p,
        spend: v.m,
        sales: v.s,
        ratio: v.s > 0 ? (v.m / v.s) * 100 : 0,
        roas: v.m > 0 ? v.s / v.m : 0,
      }));
  }, [prodData]);

  // ── Daily dynamics table ──
  const dailyDynamics = useMemo(() => {
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
        dateRaw: date,
        revenue: v.rev,
        spend: v.spend,
        ratio: v.rev > 0 ? (v.spend / v.rev) * 100 : 0,
        roas: v.spend > 0 ? v.rev / v.spend : 0,
      }));
  }, [prodData, adsData]);

  // ── Styles ──
  const C = {
    bg: '#0a0f1a',
    card: '#111a2e',
    bdr: '#1a2744',
    dim: '#64748b',
    txt: '#e2e8f0',
  };

  const KPI = ({ label, val, sub, color = '#3b82f6' }: any) => (
    <div style={{
      background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12,
      padding: '16px 18px', flex: '1 1 160px', minWidth: 150, position: 'relative', overflow: 'hidden'
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color }} />
      <div style={{ fontSize: 11, color: C.dim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'monospace', lineHeight: 1.1 }}>{val}</div>
      {sub && <div style={{ fontSize: 11, color: C.dim, marginTop: 4 }}>{sub}</div>}
    </div>
  );

  if (loading || dateLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}>
        <div style={{ color: C.dim, fontSize: 14 }}>Memuat data marketing...</div>
      </div>
    );
  }

  if (adsData.length === 0 && prodData.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Belum Ada Data Marketing</div>
        <div style={{ fontSize: 13, color: C.dim }}>Upload data melalui halaman Admin atau ubah filter tanggal.</div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>Marketing</h2>

      {/* ── KPI Cards ── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <KPI
          label="Total Revenue"
          val={`Rp ${fmtCompact(totalRevenue)}`}
          sub={`Avg: Rp ${fmtCompact(activeDays > 0 ? totalRevenue / activeDays : 0)}/hari`}
          color="#3b82f6"
        />
        <KPI
          label="Total Ad Spend"
          val={`Rp ${fmtCompact(totalSpend)}`}
          sub={`Avg: Rp ${fmtCompact(activeDays > 0 ? totalSpend / activeDays : 0)}/hari`}
          color="#f59e0b"
        />
        <KPI
          label="Mkt Ratio"
          val={`${totalRatio.toFixed(1)}%`}
          sub={`Avg: ${avgDailyRatio.toFixed(1)}%/hari`}
          color={totalRatio > 30 ? '#ef4444' : totalRatio > 20 ? '#f59e0b' : '#10b981'}
        />
        <KPI
          label="ROAS"
          val={`${totalRoas.toFixed(1)}x`}
          sub={`Avg: ${avgDailyRoas.toFixed(1)}x/hari`}
          color="#8b5cf6"
        />
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
                        <span>Total</span>
                        <span style={{ fontFamily: 'monospace' }}>Rp {fmtCompact(total)}</span>
                      </div>
                    </div>
                  );
                }}
              />
              {dailyBrandData.brands.map((brand, idx) => (
                <Bar
                  key={brand}
                  dataKey={brand}
                  stackId="a"
                  fill={BRAND_COLORS[brand] || '#64748b'}
                  radius={idx === dailyBrandData.brands.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                />
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
      {/* Ad Spend by Platform — Per Brand                                 */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Ad Spend by Platform — Per Brand</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>Biaya ads per platform (tanpa admin marketplace fee)</div>
          </div>
          <select
            value={brandFilter}
            onChange={(e) => setBrandFilter(e.target.value)}
            style={{
              background: '#1a2744', border: `1px solid ${C.bdr}`, borderRadius: 8,
              padding: '6px 12px', color: C.txt, fontSize: 13, cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="all">All Brands</option>
            {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        {platformBreakdown.length > 0 ? (
          <>
            {/* Horizontal bar chart */}
            <ResponsiveContainer width="100%" height={Math.max(platformBreakdown.length * 44, 120)}>
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
                          <span style={{ color: C.dim }}>% of Total</span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{d.pct.toFixed(1)}%</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20, marginBottom: 2 }}>
                          <span style={{ color: C.dim }}>Daily Avg</span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmtRupiah(d.dailyAvg)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 20 }}>
                          <span style={{ color: C.dim }}>Blended ROAS</span>
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{d.blendedRoas.toFixed(1)}x</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="spent" radius={[0, 6, 6, 0]}>
                  {platformBreakdown.map((entry, i) => (
                    <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            {/* Detail table with Blended ROAS */}
            <div style={{ overflowX: 'auto', marginTop: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                    {['Platform', 'Spent', '% of Total', 'Daily Avg', 'Blended ROAS'].map(h => (
                      <th key={h} style={{
                        padding: '8px 10px', textAlign: h === 'Platform' ? 'left' : 'right',
                        color: C.dim, fontWeight: 600, fontSize: 11, whiteSpace: 'nowrap',
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {platformBreakdown.map((p) => (
                    <tr key={p.platform} style={{ borderBottom: `1px solid ${C.bdr}22` }}>
                      <td style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 3, background: p.color, flexShrink: 0 }} />
                        <span style={{ fontWeight: 600 }}>{p.platform}</span>
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                        Rp {fmtCompact(p.spent)}
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.dim }}>
                        {p.pct.toFixed(1)}%
                      </td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', color: C.dim }}>
                        Rp {fmtCompact(p.dailyAvg)}
                      </td>
                      <td style={{
                        padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600,
                        color: p.blendedRoas >= 3 ? '#10b981' : p.blendedRoas >= 1.5 ? '#f59e0b' : '#ef4444',
                      }}>
                        {p.blendedRoas.toFixed(1)}x
                      </td>
                    </tr>
                  ))}
                  {/* Total row */}
                  <tr style={{ borderTop: `2px solid ${C.bdr}` }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>TOTAL</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                      Rp {fmtCompact(platformBreakdown.reduce((s, p) => s + p.spent, 0))}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>100%</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                      Rp {fmtCompact(platformBreakdown.reduce((s, p) => s + p.dailyAvg, 0))}
                    </td>
                    <td style={{
                      padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700,
                      color: totalRoas >= 3 ? '#10b981' : totalRoas >= 1.5 ? '#f59e0b' : '#ef4444',
                    }}>
                      {totalRoas.toFixed(1)}x
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '30px 0', color: C.dim, fontSize: 13 }}>
            Tidak ada data ads untuk {brandFilter === 'all' ? 'periode ini' : brandFilter}
          </div>
        )}
      </div>

      {/* ── Brand × Platform Matrix ── */}
      {brandFilter === 'all' && brandPlatformMatrix.rows?.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Brand × Platform Matrix</div>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>Perbandingan alokasi ads spend tiap brand ke tiap platform</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', color: C.dim, fontWeight: 600, fontSize: 11, position: 'sticky', left: 0, background: C.card }}>Brand</th>
                  {brandPlatformMatrix.platforms?.map((p: string) => (
                    <th key={p} style={{
                      padding: '8px 6px', textAlign: 'right', color: PLATFORM_COLORS[p] || C.dim,
                      fontWeight: 600, fontSize: 10, whiteSpace: 'nowrap',
                    }}>{p}</th>
                  ))}
                  <th style={{ padding: '8px 10px', textAlign: 'right', color: '#f1f5f9', fontWeight: 700, fontSize: 11 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {brandPlatformMatrix.rows?.map((row: any) => (
                  <tr key={row.brand} style={{ borderBottom: `1px solid ${C.bdr}22` }}>
                    <td style={{
                      padding: '8px 10px', fontWeight: 600, position: 'sticky', left: 0, background: C.card,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: BRAND_COLORS[row.brand] || '#64748b', flexShrink: 0 }} />
                      {row.brand}
                    </td>
                    {brandPlatformMatrix.platforms?.map((p: string) => (
                      <td key={p} style={{
                        padding: '8px 6px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11,
                        color: row[p] > 0 ? C.txt : `${C.dim}66`,
                      }}>
                        {row[p] > 0 ? fmtCompact(row[p]) : '—'}
                      </td>
                    ))}
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>
                      {fmtCompact(row._total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* ATTRIBUTION MATRIX + CHANNEL ROAS                                */}
      {/* ══════════════════════════════════════════════════════════════════ */}
      {channelRoasData.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Attribution Matrix & Channel ROAS</div>
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 16 }}>
            Mapping ads platform ke revenue channel — menunjukkan kemana spend mengalir menjadi revenue
          </div>

          {/* ── Attribution Matrix Table ── */}
          <div style={{ overflowX: 'auto', marginBottom: 20 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 480 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: C.dim, fontWeight: 600, fontSize: 11 }}>
                    Ads Platform
                  </th>
                  {REVENUE_CHANNELS.map(ch => (
                    <th key={ch} style={{
                      padding: '8px 12px', textAlign: 'center',
                      color: CHANNEL_COLORS[ch] || C.dim, fontWeight: 700, fontSize: 12,
                    }}>
                      {ch}
                    </th>
                  ))}
                  <th style={{ padding: '8px 12px', textAlign: 'right', color: C.dim, fontWeight: 600, fontSize: 11 }}>
                    Spend
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(ATTRIBUTION_MAP)
                  .filter(([platform]) => (platformSpend[platform] || 0) > 0)
                  .sort(([a], [b]) => (platformSpend[b] || 0) - (platformSpend[a] || 0))
                  .map(([platform, channels]) => (
                    <tr key={platform} style={{ borderBottom: `1px solid ${C.bdr}22` }}>
                      <td style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          width: 10, height: 10, borderRadius: 3, flexShrink: 0,
                          background: PLATFORM_COLORS[platform] || '#64748b',
                        }} />
                        <span style={{ fontWeight: 600 }}>{platform}</span>
                        {channels.length > 1 && (
                          <span style={{
                            fontSize: 9, background: '#fbbf2422', color: '#fbbf24', padding: '1px 5px',
                            borderRadius: 4, fontWeight: 600, whiteSpace: 'nowrap',
                          }}>
                            SHARED
                          </span>
                        )}
                      </td>
                      {REVENUE_CHANNELS.map(ch => (
                        <td key={ch} style={{ padding: '8px 12px', textAlign: 'center' }}>
                          {channels.includes(ch) ? (
                            <div style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 24, height: 24, borderRadius: 6,
                              background: `${CHANNEL_COLORS[ch]}22`,
                            }}>
                              <span style={{ color: CHANNEL_COLORS[ch], fontSize: 14, fontWeight: 700 }}>✓</span>
                            </div>
                          ) : (
                            <span style={{ color: `${C.dim}44`, fontSize: 14 }}>—</span>
                          )}
                        </td>
                      ))}
                      <td style={{
                        padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11, color: C.dim,
                      }}>
                        Rp {fmtCompact(platformSpend[platform] || 0)}
                      </td>
                    </tr>
                  ))
                }
                {/* Revenue row at bottom */}
                <tr style={{ borderTop: `2px solid ${C.bdr}` }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700, fontSize: 11, color: C.dim }}>
                    CHANNEL REVENUE
                  </td>
                  {REVENUE_CHANNELS.map(ch => (
                    <td key={ch} style={{
                      padding: '10px 12px', textAlign: 'center', fontFamily: 'monospace',
                      fontWeight: 700, fontSize: 12, color: CHANNEL_COLORS[ch],
                    }}>
                      Rp {fmtCompact(channelRevenue[ch] || 0)}
                    </td>
                  ))}
                  <td style={{
                    padding: '10px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12,
                  }}>
                    Rp {fmtCompact(totalSpend)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* ── Channel ROAS Cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 16 }}>
            {channelRoasData.map(d => (
              <div key={d.channel} style={{
                background: `${C.bdr}33`, border: `1px solid ${C.bdr}`, borderRadius: 10,
                padding: '14px 16px', position: 'relative', overflow: 'hidden',
              }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: d.color }} />

                {/* Header: Channel name + ROAS */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: d.color }}>{d.channel}</span>
                  </div>
                  <div style={{
                    fontSize: 18, fontWeight: 800, fontFamily: 'monospace',
                    color: d.roas >= 3 ? '#10b981' : d.roas >= 1.5 ? '#f59e0b' : '#ef4444',
                  }}>
                    {d.roas.toFixed(1)}x
                  </div>
                </div>

                {/* Revenue & Spend */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 8 }}>
                  <div>
                    <div style={{ color: C.dim, marginBottom: 2 }}>Revenue</div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>Rp {fmtCompact(d.revenue)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: C.dim, marginBottom: 2 }}>Attributed Spend</div>
                    <div style={{ fontFamily: 'monospace', fontWeight: 600 }}>Rp {fmtCompact(d.attributedSpend)}</div>
                  </div>
                </div>

                {/* Platform breakdown */}
                <div style={{ borderTop: `1px solid ${C.bdr}`, paddingTop: 8 }}>
                  <div style={{ fontSize: 10, color: C.dim, marginBottom: 4, fontWeight: 600 }}>SUMBER ADS SPEND:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {d.platformDetails.map(p => (
                      <div key={p.name} style={{
                        display: 'flex', alignItems: 'center', gap: 4, fontSize: 10,
                        padding: '2px 8px', borderRadius: 4,
                        background: p.isShared ? '#fbbf2411' : `${C.bdr}66`,
                        border: p.isShared ? '1px solid #fbbf2433' : `1px solid ${C.bdr}`,
                      }}>
                        <div style={{
                          width: 6, height: 6, borderRadius: 2,
                          background: PLATFORM_COLORS[p.name] || '#64748b',
                        }} />
                        <span style={{ color: C.txt, fontWeight: 500 }}>{p.name}</span>
                        <span style={{ color: C.dim, fontFamily: 'monospace' }}>
                          {fmtCompact(p.spend)}
                        </span>
                        {p.isShared && (
                          <span style={{ color: '#fbbf24', fontSize: 8, fontWeight: 700 }}>★</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Double count warning */}
                {d.hasDoubleCount && (
                  <div style={{
                    marginTop: 8, fontSize: 10, color: '#fbbf24', lineHeight: 1.4,
                    display: 'flex', alignItems: 'flex-start', gap: 4,
                  }}>
                    <span style={{ flexShrink: 0 }}>★</span>
                    <span>
                      {d.doubleCountedPlatforms.join(', ')} juga diatribusikan ke{' '}
                      {d.doubleCountedPlatforms
                        .flatMap(p => (ATTRIBUTION_MAP[p] || []).filter(c => c !== d.channel))
                        .filter((v, i, a) => a.indexOf(v) === i)
                        .join(', ')
                      }
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ── Meta Demand Generator Callout ── */}
          <div style={{
            padding: '12px 16px', borderRadius: 10,
            background: 'linear-gradient(135deg, #1877f211 0%, #8b5cf611 100%)',
            border: '1px solid #1877f233',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 16, lineHeight: 1.4, flexShrink: 0 }}>💡</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#93c5fd', marginBottom: 4 }}>
                  Meta (Facebook Ads + CPAS) sebagai Demand Generator
                </div>
                <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.6 }}>
                  Facebook Ads ditandai <span style={{ color: '#fbbf24', fontWeight: 600 }}>★ SHARED</span> karena
                  berfungsi sebagai <span style={{ color: '#93c5fd', fontWeight: 600 }}>demand generator</span> yang
                  menciptakan awareness & purchase intent. Spillover terjadi ke:{' '}
                  <span style={{ color: CHANNEL_COLORS['Scalev'] }}>Scalev</span> (direct purchase via website),{' '}
                  <span style={{ color: CHANNEL_COLORS['Shopee'] }}>Shopee</span> (konsumen cari di marketplace setelah lihat iklan),
                  dan repeat order organik.
                  Karena itu, Channel ROAS di atas <span style={{ fontWeight: 600, color: C.txt }}>tidak bisa dijumlahkan</span> —
                  spend Facebook Ads dihitung ganda di Scalev dan Shopee.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Daily Dynamics Table ── */}
      {dailyDynamics.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Dinamika Harian</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                  {['Tanggal', 'Revenue', 'Ad Spend', 'Mkt Ratio', 'ROAS'].map(h => (
                    <th key={h} style={{
                      padding: '8px 10px', textAlign: h === 'Tanggal' ? 'left' : 'right',
                      color: C.dim, fontWeight: 600, fontSize: 11,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyDynamics.map(d => (
                  <tr key={d.dateRaw} style={{ borderBottom: `1px solid ${C.bdr}22` }}>
                    <td style={{ padding: '8px 10px', fontWeight: 500 }}>{d.date}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>Rp {fmtCompact(d.revenue)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace' }}>Rp {fmtCompact(d.spend)}</td>
                    <td style={{
                      padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600,
                      color: d.ratio > 40 ? '#ef4444' : d.ratio > 25 ? '#f59e0b' : '#10b981',
                    }}>
                      {d.ratio.toFixed(1)}%
                    </td>
                    <td style={{
                      padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace',
                      color: d.roas >= 3 ? '#10b981' : d.roas >= 1.5 ? '#f59e0b' : '#ef4444',
                    }}>
                      {d.roas.toFixed(1)}x
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${C.bdr}`, background: `${C.bdr}33` }}>
                  <td style={{ padding: '8px 10px', fontWeight: 700 }}>AVERAGE</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                    Rp {fmtCompact(dailyDynamics.reduce((s, d) => s + d.revenue, 0) / dailyDynamics.length)}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                    Rp {fmtCompact(dailyDynamics.reduce((s, d) => s + d.spend, 0) / dailyDynamics.length)}
                  </td>
                  <td style={{
                    padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700,
                    color: avgDailyRatio > 40 ? '#ef4444' : avgDailyRatio > 25 ? '#f59e0b' : '#10b981',
                  }}>
                    {avgDailyRatio.toFixed(1)}%
                  </td>
                  <td style={{
                    padding: '8px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700,
                    color: avgDailyRoas >= 3 ? '#10b981' : avgDailyRoas >= 1.5 ? '#f59e0b' : '#ef4444',
                  }}>
                    {avgDailyRoas.toFixed(1)}x
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Marketing Efficiency per Product ── */}
      {prodEfficiency.length > 0 && (
        <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Marketing Efficiency — Per Produk</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
            {prodEfficiency.map(p => (
              <div key={p.sku} style={{
                background: `${C.bdr}33`, border: `1px solid ${C.bdr}`, borderRadius: 10, padding: '12px 14px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{p.sku}</span>
                  <span style={{
                    fontSize: 12, fontWeight: 700, fontFamily: 'monospace',
                    color: p.ratio > 40 ? '#ef4444' : p.ratio > 25 ? '#f59e0b' : '#10b981',
                  }}>
                    {p.ratio.toFixed(1)}%
                  </span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: C.bdr, overflow: 'hidden', marginBottom: 4 }}>
                  <div style={{
                    width: `${Math.min(p.ratio, 100)}%`, height: '100%', borderRadius: 3,
                    background: p.ratio > 40 ? '#ef4444' : p.ratio > 25 ? '#f59e0b' : '#10b981',
                  }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.dim }}>
                  <span>Spend: Rp {fmtCompact(p.spend)}</span>
                  <span>ROAS: {p.roas.toFixed(1)}x</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
