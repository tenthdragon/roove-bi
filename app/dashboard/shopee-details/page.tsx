// @ts-nocheck
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDateRange } from '@/lib/DateRangeContext';
import { getShopeeDetailsData } from '@/lib/marketing-actions';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { fmtRupiah } from '@/lib/utils';
import {
  calculateAttributedRevenueAfterAdminFee,
  resolveShopeeAdminFeeRate,
} from '@/lib/shopee-campaign-metrics';

const C = {
  bg: 'var(--bg)',
  card: 'var(--card)',
  bdr: 'var(--border)',
  txt: 'var(--text)',
  dim: 'var(--dim)',
};

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function isCpasSource(source: string | null | undefined) {
  return String(source || '').toLowerCase().includes('cpas');
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function formatCount(value: number) {
  return Math.round(value).toLocaleString('id-ID');
}

function campaignStatusLabel(value: string) {
  const labels: Record<string, string> = {
    ongoing: 'Berjalan',
    scheduled: 'Terjadwal',
    paused: 'Nonaktif',
    ended: 'Berakhir',
    deleted: 'Dihapus',
    closed: 'Ditutup',
  };
  return labels[String(value || '').toLowerCase()] || value || 'Status tidak diketahui';
}

type ShopeeDetailsTab =
  | 'cpas'
  | 'product'
  | 'automatic'
  | 'shop'
  | 'live'
  | 'video'
  | 'banner';

type ShopeeDetailsTabDefinition = {
  id: ShopeeDetailsTab;
  label: string;
  group: 'Eksternal' | 'Internal Shopee';
  apiAvailable: boolean;
};

const SHOPEE_DETAIL_TABS: ShopeeDetailsTabDefinition[] = [
  { id: 'cpas', label: 'CPAS', group: 'Eksternal', apiAvailable: true },
  { id: 'product', label: 'Iklan Produk', group: 'Internal Shopee', apiAvailable: true },
  { id: 'automatic', label: 'Iklan Produk Otomatis', group: 'Internal Shopee', apiAvailable: true },
  { id: 'shop', label: 'Iklan Toko+', group: 'Internal Shopee', apiAvailable: false },
  { id: 'live', label: 'Iklan Live', group: 'Internal Shopee', apiAvailable: false },
  { id: 'video', label: 'Iklan Video', group: 'Internal Shopee', apiAvailable: false },
  { id: 'banner', label: 'Iklan Banner', group: 'Internal Shopee', apiAvailable: false },
];

const UNSUPPORTED_AD_TYPES: Record<'shop' | 'live' | 'video' | 'banner', {
  title: string;
  detail: string;
  variants?: string[];
}> = {
  shop: {
    title: 'Iklan Toko+',
    detail: 'Campaign, keyword, dan SOV belum tersedia melalui Open API publik.',
  },
  live: {
    title: 'Iklan Live',
    detail: 'Campaign dan performa Iklan Live belum tersedia melalui Open API publik.',
  },
  video: {
    title: 'Iklan Video',
    detail: 'Campaign dan performa Iklan Video belum tersedia melalui Open API publik.',
  },
  banner: {
    title: 'Iklan Banner',
    detail: 'Campaign dan performa Iklan Banner belum tersedia melalui Open API publik.',
    variants: ['Brand Max', 'Search Brand'],
  },
};

const DETAIL_PAGE_SIZE = 10;

function paginateRows<T>(rows: T[], requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / DETAIL_PAGE_SIZE));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * DETAIL_PAGE_SIZE;
  return {
    page,
    totalPages,
    rows: rows.slice(start, start + DETAIL_PAGE_SIZE),
  };
}

function Pagination({ page, totalPages, onChange }: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pageNumbers = Array.from(new Set(
    [1, page - 1, page, page + 1, totalPages]
      .filter((value) => value >= 1 && value <= totalPages),
  )).sort((a, b) => a - b);

  return (
    <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.bdr}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ color: C.dim, fontSize: 9 }}>Halaman {page} dari {totalPages}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          style={{ border: `1px solid ${C.bdr}`, background: 'transparent', color: page <= 1 ? C.dim : C.txt, borderRadius: 6, padding: '5px 8px', fontSize: 10, cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.45 : 1 }}
        >
          ‹
        </button>
        {pageNumbers.map((pageNumber, index) => (
          <span key={pageNumber} style={{ display: 'contents' }}>
            {index > 0 && pageNumber - pageNumbers[index - 1] > 1 && (
              <span style={{ color: C.dim, padding: '0 2px', fontSize: 10 }}>…</span>
            )}
            <button
              type="button"
              onClick={() => onChange(pageNumber)}
              style={{ border: `1px solid ${pageNumber === page ? '#ee4d2d' : C.bdr}`, background: pageNumber === page ? 'rgba(238, 77, 45, 0.10)' : 'transparent', color: pageNumber === page ? '#ee4d2d' : C.txt, borderRadius: 6, minWidth: 28, padding: '5px 7px', fontSize: 10, fontWeight: pageNumber === page ? 800 : 500, cursor: 'pointer' }}
            >
              {pageNumber}
            </button>
          </span>
        ))}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          style={{ border: `1px solid ${C.bdr}`, background: 'transparent', color: page >= totalPages ? C.dim : C.txt, borderRadius: 6, padding: '5px 8px', fontSize: 10, cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.45 : 1 }}
        >
          ›
        </button>
      </div>
    </div>
  );
}

function DetailEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: '42px 18px', color: C.dim, fontSize: 11, textAlign: 'center' }}>
      {children}
    </div>
  );
}

function UnsupportedAdTypePanel({ type }: { type: 'shop' | 'live' | 'video' | 'banner' }) {
  const config = UNSUPPORTED_AD_TYPES[type];

  return (
    <>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.bdr}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{config.title}</div>
        <span style={{ borderRadius: 999, padding: '4px 8px', background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 9, fontWeight: 800 }}>
          API publik belum tersedia
        </span>
      </div>
      <div style={{ padding: '34px 18px', textAlign: 'center' }}>
        <div style={{ color: C.dim, fontSize: 11 }}>{config.detail}</div>
        {config.variants && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {config.variants.map((variant) => (
              <span key={variant} style={{ border: `1px solid ${C.bdr}`, borderRadius: 999, padding: '4px 8px', color: C.dim, fontSize: 9 }}>
                {variant}
              </span>
            ))}
          </div>
        )}
        <div style={{ marginTop: 9, color: C.dim, fontSize: 9 }}>Tidak ada data dummy.</div>
      </div>
    </>
  );
}

function adjustedPreviewRoas(expense: number, revenue: number, feeRate: number | null) {
  if (expense <= 0 || feeRate == null) return null;
  const adjustedRevenue = calculateAttributedRevenueAfterAdminFee(revenue, feeRate);
  return adjustedRevenue == null ? null : adjustedRevenue / expense;
}

function buildPreviewCpasRows() {
  const names = [
    'Roove CPAS · Main Catalog',
    'Roove CPAS · Retargeting',
    'Roove CPAS · Seasonal',
  ];

  return names.map((name, index) => {
    const spend = 420_000 + (names.length - index) * 137_500;
    const reportedRoas = 2.1 + ((index * 37) % 31) / 10;
    const impressions = Math.round(spend / (31_000 + index * 3_500) * 1000);
    return {
      account: name,
      sourceLabel: 'Ad account · Meta CPAS',
      spend,
      impressions,
      attributedRevenue: Math.round(spend * reportedRoas),
      reportedRoas,
      isPreview: true,
    };
  });
}

function buildPreviewProductRows(feeRate: number | null) {
  const names = [
    'Globite Collagen 2 Botol',
    'Roove Collagen Drink 10 Sachet',
    'Osgard Magnesium',
    'Globite Gummy Collagen',
    'Roove Collagen 50 Sachet',
    'Collagen Mix Rasa Free',
    'Blueberry Collagen Drink',
    'Roove Whitening Bundle',
    'Osgard Joint Care Bundle',
    'Collagen Trial Pack',
    'Roove Monthly Package',
    'Globite Live Promo',
  ];

  return names.map((name, index) => {
    const expense = 360_000 + (names.length - index) * 124_000;
    const platformRoas = 2.4 + ((index * 29) % 57) / 10;
    const broadGmv = Math.round(expense * platformRoas);
    const targetRoas = 3.5 + (index % 5) * 0.7;
    const apiTargetRoas = index % 3 === 2 ? null : targetRoas;
    const isRunning = index % 5 !== 4;
    const clicks = 180 + index * 31;
    const impressions = Math.round(clicks / (0.012 + (index % 4) * 0.003));
    return {
      key: `preview-product-${index + 1}`,
      campaign_id: 910_000_000_000 + index,
      ad_name: `${name} Campaign`,
      campaign_status: isRunning ? 'ongoing' : 'paused',
      bidding_method: index % 3 === 2 ? 'manual' : 'auto',
      campaign_budget: index % 4 === 0 ? 0 : 1_000_000 + (index % 3) * 500_000,
      targetRoas: apiTargetRoas,
      products: [{ product_name: name, item_id: 920_000_000_000 + index }],
      itemIds: [920_000_000_000 + index],
      keywords: [],
      expense,
      impressions,
      clicks,
      broadGmv,
      broadOrder: 8 + index * 2,
      directGmv: Math.round(broadGmv * 0.74),
      actualRoas: platformRoas,
      adjustedRoas: adjustedPreviewRoas(expense, broadGmv, feeRate),
      isRunning,
      signal: apiTargetRoas == null
        ? 'Tanpa target'
        : platformRoas >= apiTargetRoas ? 'Tercapai' : 'Di bawah target',
      signalTone: apiTargetRoas == null || platformRoas >= apiTargetRoas ? 'good' : 'bad',
      isPreview: true,
    };
  });
}

function buildPreviewGmsItems(feeRate: number | null) {
  const names = [
    'Roove Collagen Drink 50 Sachet',
    'Roove Collagen Drink 10 Sachet',
    'Roove Collagen Mix Rasa Free',
    'Roove Blueberry Collagen Drink',
    'Roove Collagen Drink 20 Sachet',
    'Globite Gummy Collagen 2 Botol',
    'Globite Collagen Trial Pack',
    'Osgard Magnesium',
    'Osgard Joint Care Bundle',
    'Roove Collagen Monthly Pack',
    'Roove Whitening Bundle',
    'Roove Live Promo Package',
    'Globite Best Seller Bundle',
    'Roove Starter Pack',
  ];

  return names.map((name, index) => {
    const impressions = Math.max(260, 10_300 - index * 670);
    const clicks = Math.max(4, Math.round(impressions * (0.012 + (index % 4) * 0.003)));
    const expense = Math.max(18_500, 603_711 - index * 41_600);
    const platformRoas = 2.7 + ((index * 37) % 73) / 10;
    const revenue = Math.round(expense * platformRoas);
    const directRoas = platformRoas * (0.68 + (index % 4) * 0.05);
    const broadOrders = Math.max(1, Math.round(clicks * (0.045 + (index % 3) * 0.012)));
    return {
      itemId: 256_815_290_000 + index,
      name,
      impressions,
      clicks,
      expense,
      broadGmv: revenue,
      broadOrders,
      directOrders: Math.max(1, Math.round(broadOrders * (0.68 + (index % 3) * 0.08))),
      platformRoas,
      directRoas,
      adjustedRoas: adjustedPreviewRoas(expense, revenue, feeRate),
      isPreview: true,
    };
  });
}

function buildPreviewCpcDailyRows(dateFrom: string, dateTo: string) {
  const from = new Date(`${dateFrom}T00:00:00Z`);
  const to = new Date(`${dateTo}T00:00:00Z`);
  const days: string[] = [];
  const cursor = new Date(from);

  while (cursor <= to && days.length < 31) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days.map((date, index) => {
    const impressions = 18_600 + index * 1_470;
    const clicks = 290 + index * 23;
    const expense = 760_000 + index * 84_000;
    const broadRoas = 4.2 + (index % 5) * 0.54;
    const directRoas = broadRoas * (0.68 + (index % 3) * 0.06);
    const broadOrder = 18 + index * 2;
    const directOrder = Math.max(1, Math.round(broadOrder * 0.72));
    return {
      metric_date: date,
      impressions,
      clicks,
      ctr: clicks / impressions * 100,
      direct_order: directOrder,
      broad_order: broadOrder,
      direct_item_sold: directOrder + (index % 3),
      broad_item_sold: broadOrder + 2 + (index % 4),
      direct_gmv: Math.round(expense * directRoas),
      broad_gmv: Math.round(expense * broadRoas),
      expense,
      cost_per_conversion: expense / broadOrder,
      direct_roas: directRoas,
      broad_roas: broadRoas,
      isPreview: true,
    };
  });
}

function MetricCard({ label, value, sub, color = C.txt, title, preview = false }: {
  label: string;
  value: string;
  sub: string;
  color?: string;
  title?: string;
  preview?: boolean;
}) {
  return (
    <div title={title} style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: '14px 15px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 10, color: C.dim, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        {preview && (
          <span style={{ borderRadius: 999, padding: '2px 6px', background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 7, fontWeight: 800, whiteSpace: 'nowrap' }}>Preview API</span>
        )}
      </div>
      <div style={{ marginTop: 7, color, fontFamily: 'monospace', fontSize: 20, fontWeight: 800, overflowWrap: 'anywhere' }}>{value}</div>
      <div style={{ marginTop: 5, color: C.dim, fontSize: 10, lineHeight: 1.5 }}>{sub}</div>
    </div>
  );
}

export default function ShopeeDetailsPage() {
  const { activeWorkspace } = useWorkspace();
  const { dateRange, loading: dateLoading } = useDateRange();
  const [data, setData] = useState({
    ads: [],
    channel: [],
    shopeeAdsMetrics: [],
    shopeeFeeRates: [],
    campaigns: [],
    campaignMetrics: [],
    campaignSchemaReady: true,
    globalCm3AdsSpend: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<ShopeeDetailsTab>('cpas');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const syncNavigationState = () => {
      const params = new URLSearchParams(window.location.search);
      const rawTab = params.get('tab');
      const requestedTab = rawTab === 'gms' || rawTab === 'automatic'
        ? 'automatic'
        : rawTab === 'cpc'
          ? 'product'
          : rawTab as ShopeeDetailsTab | null;
      const nextTab = SHOPEE_DETAIL_TABS.some((tab) => tab.id === requestedTab)
        ? requestedTab as ShopeeDetailsTab
        : 'cpas';
      const requestedPage = Number(params.get('page') || 1);
      setActiveTab(nextTab);
      setCurrentPage(Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);

      if (rawTab !== nextTab) {
        params.set('tab', nextTab);
        const query = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
      }
    };

    syncNavigationState();
    window.addEventListener('popstate', syncNavigationState);
    return () => window.removeEventListener('popstate', syncNavigationState);
  }, []);

  const navigateDetail = (tab: ShopeeDetailsTab, page = 1) => {
    setActiveTab(tab);
    setCurrentPage(page);
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tab);
    if (page > 1) params.set('page', String(page));
    else params.delete('page');
    const query = params.toString();
    window.history.pushState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  };

  useEffect(() => {
    if (dateLoading) return;

    let cancelled = false;
    setLoading(true);
    setError('');

    getShopeeDetailsData({ from: dateRange.from, to: dateRange.to })
      .then((result) => {
        if (cancelled) return;
        setData({
          ads: result.ads || [],
          channel: result.channel || [],
          shopeeAdsMetrics: result.shopeeAdsMetrics || [],
          shopeeFeeRates: result.shopeeFeeRates || [],
          campaigns: result.campaigns || [],
          campaignMetrics: result.campaignMetrics || [],
          campaignSchemaReady: result.campaignSchemaReady !== false,
          globalCm3AdsSpend: Number(result.globalCm3AdsSpend || 0),
        });
        setLoading(false);
      })
      .catch((loadError: any) => {
        if (cancelled) return;
        console.error('[Shopee Details] load error:', loadError);
        setError(loadError?.message || 'Gagal memuat Shopee Details.');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeWorkspace.id, dateLoading, dateRange.from, dateRange.to]);

  const overview = useMemo(() => {
    const actualShopeeSales = data.channel
      .reduce((sum, row: any) => sum + Number(row.net_sales || 0), 0);

    const shopeeSpend = data.shopeeAdsMetrics
      .reduce((sum, row: any) => sum + Math.abs(Number(row.expense || 0)), 0);
    const shopeeBroadGmv = data.shopeeAdsMetrics
      .reduce((sum, row: any) => sum + Number(row.broad_gmv || 0), 0);
    const shopeeDirectGmv = data.shopeeAdsMetrics
      .reduce((sum, row: any) => sum + Number(row.direct_gmv || 0), 0);
    const cpasRows = data.ads.filter((row: any) => (
      row.data_source === 'meta_api' && isCpasSource(row.source)
    ));
    const cpasSpend = cpasRows
      .reduce((sum: number, row: any) => sum + Math.abs(Number(row.spent || 0)), 0);
    const cpasRevenueRows = cpasRows.filter((row: any) => (
      row.platform_attributed_revenue !== null
      && row.platform_attributed_revenue !== undefined
      && Number.isFinite(Number(row.platform_attributed_revenue))
    ));
    const hasShopeeMetrics = data.shopeeAdsMetrics.length > 0;
    const hasCpasRows = cpasRows.length > 0;
    const hasCompletePaidSpend = hasShopeeMetrics && hasCpasRows;
    const totalPaidSpend = shopeeSpend + cpasSpend;

    return {
      actualShopeeSales,
      actualBlendedRoas: hasCompletePaidSpend && totalPaidSpend > 0
        ? actualShopeeSales / totalPaidSpend
        : null,
      totalPaidSpend,
      shopeeSpend,
      shopeeBroadGmv,
      shopeeDirectGmv,
      hasShopeeMetrics,
      cpasSpend,
      hasCpasRows,
      hasCompletePaidSpend,
      hasMetaRevenue: cpasRevenueRows.length > 0,
    };
  }, [data]);

  const campaignResume = useMemo(() => {
    const byCampaign = new Map<string, any>();

    data.campaigns.forEach((campaign: any) => {
      const key = `${campaign.shop_config_id}:${campaign.campaign_id}`;
      const products = asArray(campaign.products);
      const itemIds = asArray(campaign.item_ids);
      const keywords = asArray(campaign.selected_keywords);
      const targetRoas = Number(campaign.roas_target || 0);

      byCampaign.set(key, {
        key,
        ...campaign,
        products,
        itemIds,
        keywords,
        targetRoas: targetRoas > 0 ? targetRoas : null,
        impressions: 0,
        clicks: 0,
        expense: 0,
        broadGmv: 0,
        broadOrder: 0,
        directGmv: 0,
        directOrder: 0,
        adjustedBroadGmv: 0,
        metricRowCount: 0,
        feeCoveredMetricRows: 0,
      });
    });

    data.campaignMetrics.forEach((metric: any) => {
      const key = `${metric.shop_config_id}:${metric.campaign_id}`;
      const current = byCampaign.get(key) || {
        key,
        shop_config_id: metric.shop_config_id,
        shop_id: metric.shop_id,
        shop_name: `Shopee Shop ${metric.shop_id}`,
        campaign_id: metric.campaign_id,
        campaign_type: metric.campaign_type,
        ad_type: metric.ad_type,
        ad_name: metric.ad_name,
        campaign_status: '',
        bidding_method: '',
        campaign_placement: metric.campaign_placement,
        campaign_budget: 0,
        targetRoas: null,
        products: [],
        itemIds: [],
        keywords: [],
        impressions: 0,
        clicks: 0,
        expense: 0,
        broadGmv: 0,
        broadOrder: 0,
        directGmv: 0,
        directOrder: 0,
        adjustedBroadGmv: 0,
        metricRowCount: 0,
        feeCoveredMetricRows: 0,
      };

      const broadGmv = Number(metric.broad_gmv || 0);
      const adminFeeRate = resolveShopeeAdminFeeRate(
        data.shopeeFeeRates,
        String(metric.metric_date || '').slice(0, 10),
      );
      current.impressions += Number(metric.impressions || 0);
      current.clicks += Number(metric.clicks || 0);
      current.expense += Math.abs(Number(metric.expense || 0));
      current.broadGmv += broadGmv;
      current.broadOrder += Number(metric.broad_order || 0);
      current.directGmv += Number(metric.direct_gmv || 0);
      current.directOrder += Number(metric.direct_order || 0);
      current.metricRowCount += 1;
      if (adminFeeRate != null) {
        current.feeCoveredMetricRows += 1;
        current.adjustedBroadGmv += calculateAttributedRevenueAfterAdminFee(
          broadGmv,
          adminFeeRate,
        ) || 0;
      }
      byCampaign.set(key, current);
    });

    const rows = Array.from(byCampaign.values()).map((campaign) => {
      const actualRoas = campaign.expense > 0 ? campaign.broadGmv / campaign.expense : null;
      const adjustedRoas = campaign.expense > 0
        && campaign.metricRowCount > 0
        && campaign.feeCoveredMetricRows === campaign.metricRowCount
        ? campaign.adjustedBroadGmv / campaign.expense
        : null;
      const targetRoas = campaign.targetRoas as number | null;
      let signal = 'Belum delivery';
      let signalTone = 'neutral';

      if (campaign.expense > 0 && campaign.broadOrder <= 0) {
        signal = 'Belum ada order';
        signalTone = 'bad';
      } else if (actualRoas != null && targetRoas != null && actualRoas >= targetRoas) {
        signal = 'Tercapai';
        signalTone = 'good';
      } else if (actualRoas != null && targetRoas != null && actualRoas >= targetRoas * 0.8) {
        signal = 'Dekat target';
        signalTone = 'warn';
      } else if (actualRoas != null && targetRoas != null) {
        signal = 'Di bawah target';
        signalTone = 'bad';
      } else if (actualRoas != null) {
        signal = 'Tanpa target';
        signalTone = (adjustedRoas ?? actualRoas) >= 1 ? 'good' : 'bad';
      }

      return {
        ...campaign,
        actualRoas,
        adjustedRoas,
        signal,
        signalTone,
        isRunning: String(campaign.campaign_status || '').toLowerCase() === 'ongoing',
      };
    }).sort((a, b) => (
      Number(b.isRunning) - Number(a.isRunning)
      || b.expense - a.expense
      || String(a.ad_name).localeCompare(String(b.ad_name))
    ));

    const effectiveFeeRates = Array.from(new Set(
      data.campaignMetrics
        .map((metric: any) => resolveShopeeAdminFeeRate(
          data.shopeeFeeRates,
          String(metric.metric_date || '').slice(0, 10),
        ))
        .filter((rate: number | null): rate is number => rate != null),
    )).sort((a, b) => a - b);
    const fallbackFeeRate = resolveShopeeAdminFeeRate(data.shopeeFeeRates, dateRange.to);
    if (effectiveFeeRates.length === 0 && fallbackFeeRate != null) {
      effectiveFeeRates.push(fallbackFeeRate);
    }
    const feeRateLabel = effectiveFeeRates.length === 0
      ? null
      : effectiveFeeRates.length === 1
        ? `${(effectiveFeeRates[0] * 100).toFixed(2)}%`
        : `${(effectiveFeeRates[0] * 100).toFixed(2)}–${(effectiveFeeRates[effectiveFeeRates.length - 1] * 100).toFixed(2)}%`;

    return {
      rows,
      active: rows.filter((row) => row.isRunning).length,
      achieved: rows.filter((row) => row.signal === 'Tercapai').length,
      attention: rows.filter((row) => row.signalTone === 'bad').length,
      feeRateLabel,
    };
  }, [data.campaignMetrics, data.campaigns, data.shopeeFeeRates, dateRange.to]);

  const cpasResume = useMemo(() => {
    const byAccount = new Map<string, any>();

    data.ads
      .filter((row: any) => row.data_source === 'meta_api' && isCpasSource(row.source))
      .forEach((row: any) => {
        const account = String(row.ad_account || '').trim() || 'Akun CPAS';
        const current = byAccount.get(account) || {
          account,
          sources: new Set<string>(),
          spend: 0,
          impressions: 0,
          attributedRevenue: 0,
          revenueRows: 0,
          reportedRoasValue: 0,
          reportedRoasSpend: 0,
        };
        const spend = Math.abs(Number(row.spent || 0));
        const source = String(row.source || '').trim();
        const attributedRevenue = Number(row.platform_attributed_revenue);
        const reportedRoas = Number(row.platform_reported_roas);

        if (source) current.sources.add(source);
        current.spend += spend;
        current.impressions += Number(row.impressions || 0);
        if (row.platform_attributed_revenue != null && Number.isFinite(attributedRevenue)) {
          current.attributedRevenue += attributedRevenue;
          current.revenueRows += 1;
        }
        if (row.platform_reported_roas != null && Number.isFinite(reportedRoas) && spend > 0) {
          current.reportedRoasValue += spend * reportedRoas;
          current.reportedRoasSpend += spend;
        }
        byAccount.set(account, current);
      });

    const rows = Array.from(byAccount.values())
      .map((row) => ({
        ...row,
        sourceLabel: Array.from(row.sources as Set<string>).join(', ') || 'Meta CPAS',
        attributedRevenue: row.revenueRows > 0 ? row.attributedRevenue : null,
        reportedRoas: row.reportedRoasSpend > 0
          ? row.reportedRoasValue / row.reportedRoasSpend
          : null,
      }))
      .sort((a, b) => b.spend - a.spend || a.account.localeCompare(b.account));

    return { rows };
  }, [data.ads]);

  const previewFeeRate = resolveShopeeAdminFeeRate(data.shopeeFeeRates, dateRange.to);
  const previewCpasRows = useMemo(() => buildPreviewCpasRows(), []);
  const previewProductRows = useMemo(
    () => buildPreviewProductRows(previewFeeRate),
    [previewFeeRate],
  );
  const gmsItemRows = useMemo(
    () => buildPreviewGmsItems(previewFeeRate),
    [previewFeeRate],
  );
  const previewCpcDailyRows = useMemo(
    () => buildPreviewCpcDailyRows(dateRange.from, dateRange.to),
    [dateRange.from, dateRange.to],
  );

  const cpasRows = cpasResume.rows.length > 0 ? cpasResume.rows : previewCpasRows;
  const cpasIsPreview = cpasResume.rows.length === 0;
  const syncedProductRows = campaignResume.rows.filter((row: any) => (
    String(row.ad_type || '').toLowerCase() !== 'auto'
  ));
  const productRows = syncedProductRows.length > 0 ? syncedProductRows : previewProductRows;
  const productIsPreview = syncedProductRows.length === 0 || productRows.every((row: any) => (
    row.isPreview || String(row.ad_name || '').toLowerCase().includes('preview')
  ));
  const productSummary = {
    active: productRows.filter((row: any) => row.isRunning).length,
    achieved: productRows.filter((row: any) => row.signal === 'Tercapai').length,
    attention: productRows.filter((row: any) => row.signalTone === 'bad').length,
  };
  const gmsSummary = gmsItemRows.reduce((summary, row) => ({
    impressions: summary.impressions + row.impressions,
    clicks: summary.clicks + row.clicks,
    expense: summary.expense + row.expense,
    broadGmv: summary.broadGmv + row.broadGmv,
    broadOrders: summary.broadOrders + row.broadOrders,
    directOrders: summary.directOrders + row.directOrders,
  }), { impressions: 0, clicks: 0, expense: 0, broadGmv: 0, broadOrders: 0, directOrders: 0 });
  const gmsPlatformRoas = gmsSummary.expense > 0
    ? gmsSummary.broadGmv / gmsSummary.expense
    : null;
  const gmsAdjustedRoas = adjustedPreviewRoas(
    gmsSummary.expense,
    gmsSummary.broadGmv,
    previewFeeRate,
  );
  const gmsCampaign = {
    status: 'ongoing',
    dailyBudget: 2_500_000,
    targetRoas: 9,
  };
  const cpcDailyRows = data.shopeeAdsMetrics.length > 0
    ? data.shopeeAdsMetrics.map((row: any) => ({
        metric_date: row.metric_date,
        impressions: Number(row.impressions || 0),
        clicks: Number(row.clicks || 0),
        ctr: Number(row.ctr || 0),
        direct_order: Number(row.direct_order || 0),
        broad_order: Number(row.broad_order || 0),
        direct_item_sold: Number(row.direct_item_sold || 0),
        broad_item_sold: Number(row.broad_item_sold || 0),
        direct_gmv: Number(row.direct_gmv || 0),
        broad_gmv: Number(row.broad_gmv || 0),
        expense: Math.abs(Number(row.expense || 0)),
        cost_per_conversion: Number(row.cost_per_conversion || 0),
        direct_roas: Number(row.direct_roas || 0),
        broad_roas: Number(row.broad_roas || 0),
        isPreview: false,
      }))
    : previewCpcDailyRows;
  const cpcIsPreview = data.shopeeAdsMetrics.length === 0;
  const cpcSummary = cpcDailyRows.reduce((summary: any, row: any) => ({
    impressions: summary.impressions + Number(row.impressions || 0),
    clicks: summary.clicks + Number(row.clicks || 0),
    expense: summary.expense + Math.abs(Number(row.expense || 0)),
    broadGmv: summary.broadGmv + Number(row.broad_gmv || 0),
    directGmv: summary.directGmv + Number(row.direct_gmv || 0),
    broadOrders: summary.broadOrders + Number(row.broad_order || 0),
    directOrders: summary.directOrders + Number(row.direct_order || 0),
    broadItems: summary.broadItems + Number(row.broad_item_sold || 0),
    directItems: summary.directItems + Number(row.direct_item_sold || 0),
  }), { impressions: 0, clicks: 0, expense: 0, broadGmv: 0, directGmv: 0, broadOrders: 0, directOrders: 0, broadItems: 0, directItems: 0 });
  const cpcBroadRoas = cpcSummary.expense > 0 ? cpcSummary.broadGmv / cpcSummary.expense : null;
  const cpasSummary = cpasRows.reduce((summary, row: any) => {
    const derivedRevenue = row.attributedRevenue != null
      ? Number(row.attributedRevenue)
      : row.reportedRoas != null
        ? Number(row.spend || 0) * Number(row.reportedRoas)
        : null;
    return {
      expense: summary.expense + Number(row.spend || 0),
      impressions: summary.impressions + Number(row.impressions || 0),
      revenue: summary.revenue + Number(derivedRevenue || 0),
      complete: summary.complete && derivedRevenue != null,
    };
  }, { expense: 0, impressions: 0, revenue: 0, complete: true });
  const previewCpasSummary = previewCpasRows.reduce((summary, row) => ({
    expense: summary.expense + row.spend,
    revenue: summary.revenue + row.attributedRevenue,
  }), { expense: 0, revenue: 0 });
  const previewCpasRoas = previewCpasSummary.expense > 0
    ? previewCpasSummary.revenue / previewCpasSummary.expense
    : 0;
  const cpasRevenueIsPreview = !cpasSummary.complete;
  const cpasRevenue = cpasRevenueIsPreview
    ? cpasSummary.expense * previewCpasRoas
    : cpasSummary.revenue;
  const productChannelSummary = productRows.reduce((summary, row: any) => ({
    expense: summary.expense + Number(row.expense || 0),
    impressions: summary.impressions + Number(row.impressions || 0),
    broadGmv: summary.broadGmv + Number(row.broadGmv || 0),
    directGmv: summary.directGmv + Number(row.directGmv || 0),
  }), { expense: 0, impressions: 0, broadGmv: 0, directGmv: 0 });
  const channelRevenueRows = [
    {
      label: 'CPAS',
      sub: 'Meta',
      color: '#1877f2',
      revenueLabel: 'Meta',
      revenue: cpasRevenue,
      secondaryRevenueLabel: null,
      secondaryRevenue: null,
      expense: cpasSummary.expense,
      impressions: cpasSummary.impressions,
      isPreview: cpasIsPreview || cpasRevenueIsPreview,
      isUnavailable: false,
    },
    {
      label: 'Iklan Produk',
      sub: 'Individual & grup',
      color: '#ee4d2d',
      revenueLabel: 'Broad',
      revenue: productChannelSummary.broadGmv,
      secondaryRevenueLabel: 'Direct',
      secondaryRevenue: productChannelSummary.directGmv,
      expense: productChannelSummary.expense,
      impressions: productChannelSummary.impressions,
      isPreview: productIsPreview,
      isUnavailable: false,
    },
    {
      label: 'Iklan Produk Otomatis',
      sub: 'Shop GMV Max',
      color: '#8b5cf6',
      revenueLabel: 'Broad',
      revenue: gmsSummary.broadGmv,
      secondaryRevenueLabel: null,
      secondaryRevenue: null,
      expense: gmsSummary.expense,
      impressions: gmsSummary.impressions,
      isPreview: true,
      isUnavailable: false,
    },
    {
      label: 'Iklan Toko+',
      sub: 'API publik belum tersedia',
      color: '#f59e0b',
      revenueLabel: null,
      revenue: null,
      secondaryRevenueLabel: null,
      secondaryRevenue: null,
      expense: null,
      impressions: null,
      isPreview: false,
      isUnavailable: true,
    },
    {
      label: 'Iklan Live',
      sub: 'API publik belum tersedia',
      color: '#ec4899',
      revenueLabel: null,
      revenue: null,
      secondaryRevenueLabel: null,
      secondaryRevenue: null,
      expense: null,
      impressions: null,
      isPreview: false,
      isUnavailable: true,
    },
    {
      label: 'Iklan Video',
      sub: 'API publik belum tersedia',
      color: '#06b6d4',
      revenueLabel: null,
      revenue: null,
      secondaryRevenueLabel: null,
      secondaryRevenue: null,
      expense: null,
      impressions: null,
      isPreview: false,
      isUnavailable: true,
    },
    {
      label: 'Iklan Banner',
      sub: 'Brand Max & Search Brand',
      color: '#64748b',
      revenueLabel: null,
      revenue: null,
      secondaryRevenueLabel: null,
      secondaryRevenue: null,
      expense: null,
      impressions: null,
      isPreview: false,
      isUnavailable: true,
    },
  ].map((row) => ({
    ...row,
    roas: row.revenue != null && row.expense != null && row.expense > 0
      ? row.revenue / row.expense
      : null,
    secondaryRoas: row.secondaryRevenue != null && row.expense != null && row.expense > 0
      ? row.secondaryRevenue / row.expense
      : null,
  }));
  const connectedChannelRows = channelRevenueRows.filter((row) => !row.isUnavailable);
  const connectedTotalExpense = connectedChannelRows
    .reduce((sum, row) => sum + Number(row.expense || 0), 0);
  const connectedTotalImpressions = connectedChannelRows
    .reduce((sum, row) => sum + Number(row.impressions || 0), 0);
  const connectedShopeeGmv = productChannelSummary.broadGmv + gmsSummary.broadGmv;
  const connectedShopeeDirectGmv = productChannelSummary.directGmv;
  const hasPreviewChannelRevenue = connectedChannelRows.some((row) => row.isPreview);
  const blendedRoas = connectedTotalExpense > 0
    ? overview.actualShopeeSales / connectedTotalExpense
    : null;
  const adsDistributionTableRows = [
    ...channelRevenueRows,
    {
      label: 'Biaya iklan terhubung',
      sub: `${connectedChannelRows.length} dari ${channelRevenueRows.length} tipe · blended ROAS`,
      revenueLabel: null,
      revenue: null,
      secondaryRevenueLabel: null,
      secondaryRevenue: null,
      expense: connectedTotalExpense,
      impressions: connectedTotalImpressions,
      roas: blendedRoas,
      secondaryRoas: null,
      isPreview: hasPreviewChannelRevenue,
      isUnavailable: false,
      isTotal: true,
      hideRevenue: true,
      title: 'Blended ROAS memakai penjualan aktual Shopee dibagi biaya dari sumber yang sudah terhubung.',
    },
  ];
  const globalCm3AdsSpend = Number(data.globalCm3AdsSpend || 0);
  const shopeeShareOfGlobal = globalCm3AdsSpend > 0
    ? connectedTotalExpense / globalCm3AdsSpend * 100
    : null;

  const cpasPage = paginateRows(cpasRows, currentPage);
  const productPage = paginateRows(productRows, currentPage);
  const gmsPage = paginateRows(gmsItemRows, currentPage);

  if (loading || dateLoading) {
    return (
      <div className="fade-in" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 320 }}>
        <div style={{ color: C.dim, fontSize: 13 }}>Memuat Shopee Details...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fade-in" style={{ background: C.card, border: '1px solid var(--red)', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>Shopee Details gagal dimuat</div>
        <div style={{ color: C.dim, marginTop: 6, fontSize: 12 }}>{error}</div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Shopee Details</h2>
        </div>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ border: `1px solid ${C.bdr}`, borderRadius: 999, padding: '5px 9px', color: C.dim, fontSize: 10 }}>
            {formatDate(dateRange.from)} — {formatDate(dateRange.to)}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(205px, 1fr))', gap: 10, marginBottom: 16 }}>
        <MetricCard
          label="Penjualan aktual Shopee"
          value={fmtRupiah(overview.actualShopeeSales)}
          sub="Pesanan dikirim + selesai"
          title="Net sales dari order Shopee berstatus shipped/completed, berdasarkan tanggal pengiriman."
        />
        <MetricCard
          label="GMV atribusi terhubung"
          value={fmtRupiah(connectedShopeeGmv)}
          sub={`Direct ${fmtRupiah(connectedShopeeDirectGmv)}`}
          color="#ee4d2d"
          title="GMV atribusi dari Iklan Produk dan Iklan Produk Otomatis yang sudah memiliki kontrak API."
          preview
        />
        <MetricCard
          label="Biaya iklan terhubung"
          value={fmtRupiah(connectedTotalExpense)}
          sub={`${connectedChannelRows.length} dari ${channelRevenueRows.length} tipe memiliki sumber data`}
          color="var(--yellow)"
          title="CPAS, Iklan Produk, dan Iklan Produk Otomatis. Tipe tanpa endpoint publik tidak diasumsikan nol."
          preview={hasPreviewChannelRevenue}
        />
        <MetricCard
          label="Blended ROAS terhubung"
          value={blendedRoas == null ? '—' : `${blendedRoas.toFixed(2)}x`}
          sub="Penjualan aktual ÷ biaya terhubung"
          color={blendedRoas == null ? C.dim : blendedRoas >= 3 ? 'var(--green)' : blendedRoas >= 1.5 ? 'var(--yellow)' : 'var(--red)'}
          title="Belum mewakili tipe iklan yang tidak tersedia melalui API publik."
          preview={hasPreviewChannelRevenue}
        />
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '12px 15px', borderBottom: `1px solid ${C.bdr}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Ads Distribution</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ color: C.dim, fontSize: 9 }}>
              CM3 workspace <span style={{ marginLeft: 4, color: C.txt, fontFamily: 'monospace', fontWeight: 800 }}>{globalCm3AdsSpend > 0 ? fmtRupiah(globalCm3AdsSpend) : '—'}</span>
            </div>
            <div style={{ color: C.dim, fontSize: 9 }}>
              Porsi terhubung <span style={{ marginLeft: 4, color: '#ee4d2d', fontFamily: 'monospace', fontWeight: 800 }}>{shopeeShareOfGlobal == null ? '—' : `${shopeeShareOfGlobal.toFixed(1)}%`}</span>
            </div>
            {hasPreviewChannelRevenue && (
              <span style={{ borderRadius: 999, padding: '4px 8px', background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 9, fontWeight: 800 }}>
                Preview API
              </span>
            )}
          </div>
        </div>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', minWidth: 610, borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                  {['Channel', 'Impressions', 'GMV / revenue', 'Biaya', 'ROAS'].map((heading, index) => (
                    <th
                      key={heading}
                      title={heading === 'Impressions' ? 'Jumlah tayangan yang dilaporkan platform; bukan reach unik.' : undefined}
                      style={{ padding: '9px 12px', textAlign: index === 0 ? 'left' : 'right', color: C.dim, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {adsDistributionTableRows.map((row: any, index) => {
                  const startsTotal = index === channelRevenueRows.length;
                  return (
                    <tr
                      key={row.label}
                      title={row.title}
                      style={{
                        borderTop: startsTotal ? `2px solid ${C.bdr}` : undefined,
                        borderBottom: `1px solid ${C.bdr}`,
                        background: row.isTotal ? 'rgba(238, 77, 45, 0.025)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '11px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: row.isTotal ? 800 : 700 }}>{row.label}</span>
                          {row.isPreview && (
                            <span style={{ borderRadius: 999, padding: '2px 6px', background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 8, fontWeight: 800 }}>Preview API</span>
                          )}
                          {row.isUnavailable && (
                            <span style={{ borderRadius: 999, padding: '2px 6px', background: 'rgba(100, 116, 139, 0.12)', color: C.dim, fontSize: 8, fontWeight: 800 }}>Tanpa endpoint</span>
                          )}
                        </div>
                        <div style={{ color: C.dim, fontSize: 9, marginTop: 3 }}>{row.sub}</div>
                      </td>
                      <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', color: row.impressions == null ? C.dim : C.txt, fontWeight: row.isTotal ? 800 : 700 }}>
                        {row.impressions == null ? '—' : formatCount(row.impressions)}
                      </td>
                      <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: row.isTotal ? 800 : 700 }}>
                        {!row.hideRevenue && (
                          <>
                            <div>{row.revenue == null ? '—' : `${row.revenueLabel} ${fmtRupiah(row.revenue)}`}</div>
                            {row.secondaryRevenueLabel && (
                              <div style={{ color: C.dim, fontSize: 9, marginTop: 3, fontWeight: 500 }}>
                                {row.secondaryRevenueLabel} {fmtRupiah(row.secondaryRevenue)}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', color: C.dim, fontWeight: row.isTotal ? 800 : 500 }}>
                        {row.expense == null ? '—' : fmtRupiah(row.expense)}
                      </td>
                      <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: row.roas == null ? C.dim : row.roas >= 3 ? 'var(--green)' : row.roas >= 1.5 ? 'var(--yellow)' : 'var(--red)' }}>
                        <div>{row.roas == null ? '—' : `${row.roas.toFixed(2)}x`}</div>
                        {row.secondaryRoas != null && (
                          <div style={{ color: C.dim, fontSize: 9, marginTop: 3, fontWeight: 500 }}>
                            {row.secondaryRevenueLabel} {row.secondaryRoas.toFixed(2)}x
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      </div>

      <div role="tablist" aria-label="Tipe iklan Shopee" style={{ display: 'flex', alignItems: 'stretch', overflowX: 'auto', borderBottom: `1px solid ${C.bdr}`, marginBottom: 12, scrollbarWidth: 'none' }}>
        {SHOPEE_DETAIL_TABS.map((tab, index) => {
          const count = tab.id === 'cpas'
            ? cpasRows.length
            : tab.id === 'product'
              ? productRows.length
              : tab.id === 'automatic'
                ? (gmsItemRows.length > 0 ? 1 : 0)
                : 0;
          const selected = activeTab === tab.id;
          const startsGroup = index === 0 || SHOPEE_DETAIL_TABS[index - 1].group !== tab.group;
          return (
            <div key={tab.id} style={{ display: 'flex', alignItems: 'stretch' }}>
              {startsGroup && (
                <span style={{ display: 'flex', alignItems: 'center', padding: index === 0 ? '0 9px 0 2px' : '0 9px 0 16px', borderLeft: index === 0 ? 0 : `1px solid ${C.bdr}`, color: C.dim, fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                  {tab.group}
                </span>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => navigateDetail(tab.id)}
                style={{ border: 0, borderBottom: `2px solid ${selected ? '#ee4d2d' : 'transparent'}`, background: 'transparent', color: selected ? C.txt : C.dim, padding: '10px 12px', fontSize: 11, fontWeight: selected ? 800 : 600, whiteSpace: 'nowrap', cursor: 'pointer', marginBottom: -1 }}
              >
                {tab.label}
                {count > 0 && (
                  <span style={{ marginLeft: 6, color: selected ? '#ee4d2d' : C.dim, fontSize: 9 }}>{count}</span>
                )}
                {!tab.apiAvailable && (
                  <span title="Endpoint publik belum tersedia" style={{ marginLeft: 6, color: C.dim, fontSize: 9 }}>○</span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      <div role="tabpanel" style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, overflow: 'hidden' }}>
        {activeTab === 'cpas' && (
          <>
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.bdr}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>CPAS</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {cpasIsPreview && (
                  <span style={{ borderRadius: 999, padding: '4px 8px', background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 9, fontWeight: 800 }}>Preview API</span>
                )}
                <span style={{ borderRadius: 999, padding: '4px 8px', background: 'var(--badge-green-bg)', color: 'var(--green)', fontSize: 9, fontWeight: 800 }}>
                  {cpasRows.length} ad account
                </span>
              </div>
            </div>

            {cpasPage.rows.length > 0 ? (
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', minWidth: 650, borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                      {['Ad account', 'Biaya', 'Revenue atribusi Meta', 'ROAS Meta'].map((heading, index) => (
                        <th key={heading} style={{ padding: '9px 12px', textAlign: index === 0 ? 'left' : 'right', color: C.dim, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cpasPage.rows.map((row: any) => (
                      <tr key={row.account} style={{ borderBottom: `1px solid ${C.bdr}` }}>
                        <td style={{ padding: '13px 12px' }}>
                          <div style={{ fontWeight: 800 }}>{row.account}</div>
                          <div style={{ color: C.dim, fontSize: 9, marginTop: 3 }}>{row.sourceLabel}</div>
                        </td>
                        <td style={{ padding: '13px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmtRupiah(row.spend)}</td>
                        <td style={{ padding: '13px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                          {row.attributedRevenue == null ? '—' : fmtRupiah(row.attributedRevenue)}
                        </td>
                        <td style={{ padding: '13px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: '#1877f2' }}>
                          {row.reportedRoas == null ? '—' : `${row.reportedRoas.toFixed(2)}x`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <DetailEmptyState>Belum ada data CPAS.</DetailEmptyState>
            )}

            {overview.hasCpasRows && !overview.hasMetaRevenue && (
              <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.bdr}`, background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 10 }}>
                Purchase value Meta belum tersimpan. Sync ulang Meta.
              </div>
            )}
            <Pagination page={cpasPage.page} totalPages={cpasPage.totalPages} onChange={(page) => navigateDetail('cpas', page)} />
          </>
        )}

        {activeTab === 'product' && (
          <>
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.bdr}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800 }}>Iklan Produk</div>
                <div style={{ color: C.dim, fontSize: 9, marginTop: 4 }}>Iklan Individual & Grup Iklan</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {productIsPreview && (
                  <span style={{ borderRadius: 999, padding: '4px 8px', background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 9, fontWeight: 800 }}>
                    Preview API
                  </span>
                )}
                <span style={{ borderRadius: 999, padding: '4px 8px', background: 'var(--badge-green-bg)', color: 'var(--green)', fontSize: 9, fontWeight: 800 }}>
                  {productSummary.active} berjalan
                </span>
                <span style={{ borderRadius: 999, padding: '4px 8px', background: 'rgba(238, 77, 45, 0.10)', color: '#ee4d2d', fontSize: 9, fontWeight: 800 }}>
                  {productSummary.achieved} tercapai
                </span>
                <span style={{ borderRadius: 999, padding: '4px 8px', background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 9, fontWeight: 800 }}>
                  {productSummary.attention} perlu perhatian
                </span>
              </div>
            </div>

            {productPage.rows.length > 0 ? (
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', minWidth: 870, borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                      {['Campaign', 'Produk', 'Budget / target Shopee', 'Biaya', 'Broad / direct GMV', 'ROAS setelah admin'].map((heading, index) => (
                        <th
                          key={heading}
                          title={heading === 'ROAS setelah admin'
                            ? campaignResume.feeRateLabel
                              ? `Asumsi biaya admin: ${campaignResume.feeRateLabel} (Data Reference)`
                              : 'Asumsi biaya admin belum diatur di Data Reference.'
                            : undefined}
                          style={{ padding: '9px 12px', textAlign: index < 3 ? 'left' : 'right', color: C.dim, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {productPage.rows.map((campaign: any) => {
                      const productNames = campaign.products
                        .map((product: any) => String(product?.product_name || '').trim())
                        .filter(Boolean);
                      const itemCount = Math.max(productNames.length, campaign.itemIds.length);
                      const strategyLabel = campaign.targetRoas != null
                        ? 'GMV Max ROAS'
                        : String(campaign.bidding_method || '').toLowerCase() === 'auto'
                          ? 'Auto bidding'
                          : 'Manual bidding';

                      return (
                        <tr key={campaign.key} style={{ borderBottom: `1px solid ${C.bdr}` }}>
                          <td style={{ padding: '12px', maxWidth: 285 }}>
                            <div title={`${campaign.ad_name || 'Campaign'} · ID ${campaign.campaign_id}`} style={{ fontWeight: 800, lineHeight: 1.35 }}>{campaign.ad_name || `Campaign ${campaign.campaign_id}`}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' }}>
                              <span style={{ color: campaign.isRunning ? 'var(--green)' : C.dim, fontSize: 9, fontWeight: 700 }}>
                                ● {campaignStatusLabel(campaign.campaign_status)}
                              </span>
                              <span style={{ color: C.dim, fontSize: 9 }}>{strategyLabel}</span>
                            </div>
                          </td>
                          <td style={{ padding: '12px', maxWidth: 260 }}>
                            <div style={{ lineHeight: 1.4 }}>
                              {productNames[0] || (itemCount > 0 ? `${itemCount} produk` : 'Produk dari campaign')}
                            </div>
                            {itemCount > 1 && (
                              <div style={{ color: C.dim, fontSize: 9, marginTop: 3, lineHeight: 1.4 }}>
                                {productNames.length > 0 ? `+${itemCount - 1} produk` : `${itemCount} produk`}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '12px', lineHeight: 1.45 }}>
                            <div>{Number(campaign.campaign_budget || 0) > 0 ? fmtRupiah(Number(campaign.campaign_budget)) : 'Tak terbatas'}</div>
                            <div style={{ color: campaign.targetRoas != null ? '#ee4d2d' : C.dim, fontSize: 9, marginTop: 3 }}>
                              {campaign.targetRoas != null ? `Target ${campaign.targetRoas.toFixed(2)}x` : 'Target —'}
                            </div>
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                            <div>{fmtRupiah(campaign.expense)}</div>
                            <div style={{ color: C.dim, fontSize: 9, marginTop: 3 }}>{formatCount(campaign.clicks)} klik</div>
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                            <div>{fmtRupiah(campaign.broadGmv)}</div>
                            <div style={{ color: C.dim, fontSize: 9, marginTop: 3 }}>{formatCount(campaign.broadOrder)} order · direct {fmtRupiah(campaign.directGmv)}</div>
                          </td>
                          <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, color: C.txt }}>
                            {campaign.adjustedRoas == null ? '—' : `${campaign.adjustedRoas.toFixed(2)}x`}
                            <div style={{ color: C.dim, fontSize: 9, marginTop: 3, fontWeight: 500 }}>
                              {campaign.actualRoas == null ? 'Platform —' : `Platform ${campaign.actualRoas.toFixed(2)}x`}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <DetailEmptyState>
                {data.campaignSchemaReady ? 'Belum ada data Iklan Produk.' : 'Migrasi campaign belum diterapkan.'}
              </DetailEmptyState>
            )}
            <Pagination page={productPage.page} totalPages={productPage.totalPages} onChange={(page) => navigateDetail('product', page)} />
          </>
        )}

        {activeTab === 'automatic' && (
          <>
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.bdr}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800 }}>Iklan Produk Otomatis</div>
                <div style={{ color: C.dim, fontSize: 9, marginTop: 4 }}>Shop GMV Max · satu campaign tingkat toko</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ borderRadius: 999, padding: '4px 8px', background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 9, fontWeight: 800 }}>Preview API</span>
                <span style={{ color: 'var(--green)', fontSize: 9, fontWeight: 800 }}>● {campaignStatusLabel(gmsCampaign.status)}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', borderBottom: `1px solid ${C.bdr}` }}>
              {[
                ['Iklan dilihat', formatCount(gmsSummary.impressions)],
                ['Biaya', fmtRupiah(gmsSummary.expense)],
                ['Broad GMV', fmtRupiah(gmsSummary.broadGmv)],
                ['ROAS setelah admin', gmsAdjustedRoas == null ? '—' : `${gmsAdjustedRoas.toFixed(2)}x`],
                ['Target ROAS', `${gmsCampaign.targetRoas.toFixed(2)}x`],
                ['Modal harian', fmtRupiah(gmsCampaign.dailyBudget)],
                ['Produk', formatCount(gmsItemRows.length)],
              ].map(([label, value], index) => (
                <div key={label} title={label === 'ROAS setelah admin'
                  ? campaignResume.feeRateLabel
                    ? `Asumsi biaya admin: ${campaignResume.feeRateLabel} (Data Reference)`
                    : 'Asumsi biaya admin belum diatur di Data Reference.'
                  : undefined} style={{ padding: '13px 15px', borderRight: index < 6 ? `1px solid ${C.bdr}` : 0 }}>
                  <div style={{ color: C.dim, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800 }}>{label}</div>
                  <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 15, fontWeight: 800 }}>{value}</div>
                  {label === 'ROAS setelah admin' && (
                    <div style={{ color: C.dim, fontSize: 9, marginTop: 3 }}>Platform {gmsPlatformRoas == null ? '—' : `${gmsPlatformRoas.toFixed(2)}x`}</div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: 820, borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                    {['Produk', 'Dilihat / klik', 'Biaya', 'Broad GMV', 'Order', 'ROAS setelah admin'].map((heading, index) => (
                      <th
                        key={heading}
                        title={heading === 'ROAS setelah admin'
                          ? campaignResume.feeRateLabel
                            ? `Asumsi biaya admin: ${campaignResume.feeRateLabel} (Data Reference)`
                            : 'Asumsi biaya admin belum diatur di Data Reference.'
                          : undefined}
                        style={{ padding: '9px 12px', textAlign: index === 0 ? 'left' : 'right', color: C.dim, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {gmsPage.rows.map((row) => (
                    <tr key={row.itemId} style={{ borderBottom: `1px solid ${C.bdr}` }}>
                      <td style={{ padding: '12px', maxWidth: 300 }}>
                        <div style={{ fontWeight: 800, lineHeight: 1.35 }}>{row.name}</div>
                        <div style={{ color: C.dim, fontSize: 9, marginTop: 3 }}>Item ID {row.itemId}</div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                        <div>{formatCount(row.impressions)}</div>
                        <div style={{ color: C.dim, fontSize: 9, marginTop: 3 }}>{formatCount(row.clicks)} klik · {row.impressions > 0 ? `${((row.clicks / row.impressions) * 100).toFixed(2)}%` : '—'}</div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{fmtRupiah(row.expense)}</td>
                      <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                        {fmtRupiah(row.broadGmv)}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                        <div>Broad {formatCount(row.broadOrders)}</div>
                        <div style={{ color: C.dim, fontSize: 9, marginTop: 3, fontWeight: 500 }}>Direct {formatCount(row.directOrders)}</div>
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800 }}>
                        {row.adjustedRoas == null ? '—' : `${row.adjustedRoas.toFixed(2)}x`}
                        <div style={{ color: C.dim, fontSize: 9, marginTop: 3, fontWeight: 500 }}>Platform {row.platformRoas.toFixed(2)}x · Direct {row.directRoas.toFixed(2)}x</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={gmsPage.page} totalPages={gmsPage.totalPages} onChange={(page) => navigateDetail('automatic', page)} />
          </>
        )}

        {activeTab === 'shop' && <UnsupportedAdTypePanel type="shop" />}
        {activeTab === 'live' && <UnsupportedAdTypePanel type="live" />}
        {activeTab === 'video' && <UnsupportedAdTypePanel type="video" />}
        {activeTab === 'banner' && <UnsupportedAdTypePanel type="banner" />}
      </div>

      <div style={{ marginTop: 12, background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 190 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800 }}>Agregat CPC tingkat toko</span>
            {cpcIsPreview && (
              <span style={{ borderRadius: 999, padding: '2px 6px', background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 8, fontWeight: 800 }}>Preview API</span>
            )}
          </div>
          <div style={{ color: C.dim, fontSize: 9, marginTop: 3 }}>Rekonsiliasi · komposisi tipe tidak dirinci Shopee</div>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          {[
            ['Biaya', fmtRupiah(cpcSummary.expense)],
            ['Broad GMV', fmtRupiah(cpcSummary.broadGmv)],
            ['Direct GMV', fmtRupiah(cpcSummary.directGmv)],
            ['ROAS', cpcBroadRoas == null ? '—' : `${cpcBroadRoas.toFixed(2)}x`],
          ].map(([label, value]) => (
            <div key={label} style={{ textAlign: 'right' }}>
              <div style={{ color: C.dim, fontSize: 8, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              <div style={{ marginTop: 3, fontFamily: 'monospace', fontSize: 11, fontWeight: 800 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
