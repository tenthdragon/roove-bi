// @ts-nocheck
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDateRange } from '@/lib/DateRangeContext';
import { getShopeeDetailsData } from '@/lib/marketing-actions';
import { useWorkspace } from '@/lib/WorkspaceContext';
import { usePermissions } from '@/lib/PermissionsContext';
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

// Keep simulated rows available for local UI development only. Staging and
// production must show the actual API state, including honest empty states.
const SHOW_PREVIEW_DATA = process.env.NODE_ENV === 'development';

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

function productCampaignSubtype(campaign: any) {
  const adType = String(campaign.ad_type || '').toLowerCase();
  const biddingMethod = String(campaign.bidding_method || '').toLowerCase();
  if (adType === 'auto' || biddingMethod === 'auto') return 'automatic';

  const productCount = Math.max(
    asArray(campaign.products).length,
    asArray(campaign.itemIds).length,
    asArray(campaign.item_ids).length,
  );
  if (adType === 'manual' || biddingMethod === 'manual') {
    if (productCount > 1) return 'group';
    if (productCount === 1) return 'individual';
  }
  return 'unclassified';
}

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
      key: `preview-cpas:${index + 1}`,
      account: name,
      store: 'Roove Official Store',
      sourceLabel: 'Ad account · Meta CPAS',
      spend,
      impressions,
      attributedRevenue: Math.round(spend * reportedRoas),
      attributionRoas: reportedRoas,
      attributionComplete: true,
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
      shop_id: 227_509_446,
      shop_name: 'Roove Official Store',
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
      metricRowCount: 1,
      last_seen_at: new Date().toISOString(),
      isRunning,
      signal: apiTargetRoas == null
        ? 'Tanpa target'
        : platformRoas >= apiTargetRoas ? 'Tercapai' : 'Di bawah target',
      signalTone: apiTargetRoas == null || platformRoas >= apiTargetRoas ? 'good' : 'bad',
      isPreview: true,
    };
  });
}

function buildPreviewGmsData(dateFrom: string, dateTo: string) {
  const items = Array.from({ length: 14 }, (_, index) => {
    const impressions = Math.max(260, 10_300 - index * 670);
    const clicks = Math.max(4, Math.round(impressions * (0.012 + (index % 4) * 0.003)));
    const expense = Math.max(18_500, 603_711 - index * 41_600);
    const platformRoas = 2.7 + ((index * 37) % 73) / 10;
    const broadGmv = Math.round(expense * platformRoas);
    const directRoas = platformRoas * (0.68 + (index % 4) * 0.05);
    const broadOrders = Math.max(1, Math.round(clicks * (0.045 + (index % 3) * 0.012)));
    return {
      campaign_id: 256_815_290,
      item_id: 256_815_290_000 + index,
      period_start: dateFrom,
      period_end: dateTo,
      impressions,
      clicks,
      expense,
      broad_gmv: broadGmv,
      broad_order: broadOrders,
      broad_order_amount: broadOrders + (index % 3),
      broad_roas: platformRoas,
      direct_order: Math.max(1, Math.round(broadOrders * (0.68 + (index % 3) * 0.08))),
      direct_order_amount: Math.max(1, Math.round(broadOrders * (0.78 + (index % 2) * 0.08))),
      direct_roas: directRoas,
      isPreview: true,
    };
  });

  const expense = items.reduce((sum, item) => sum + item.expense, 0);
  const broadGmv = Math.round(expense * 5.33);
  return {
    campaigns: [{
      campaign_id: 256_815_290,
      period_start: dateFrom,
      period_end: dateTo,
      impressions: 32_200,
      clicks: 449,
      expense,
      broad_gmv: broadGmv,
      broad_order: 22,
      broad_order_amount: 22,
      broad_roas: broadGmv / expense,
      direct_order: 16,
      direct_order_amount: 17,
      direct_roas: 3.84,
      isPreview: true,
    }],
    items,
  };
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
  sub?: string;
  color?: string;
  title?: string;
  preview?: boolean;
}) {
  return (
    <div title={title} style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, padding: '14px 15px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 10, color: C.dim, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        {preview && (
          <span style={{ borderRadius: 999, padding: '2px 6px', background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 7, fontWeight: 800, whiteSpace: 'nowrap' }}>Preview</span>
        )}
      </div>
      <div style={{ marginTop: 7, color, fontFamily: 'monospace', fontSize: 20, fontWeight: 800, overflowWrap: 'anywhere' }}>{value}</div>
      {sub && (
        <div style={{ marginTop: 5, color: C.dim, fontSize: 10, lineHeight: 1.5 }}>{sub}</div>
      )}
    </div>
  );
}

export default function ShopeeDetailsPage() {
  const { activeWorkspace } = useWorkspace();
  const { can } = usePermissions();
  const { dateRange, loading: dateLoading } = useDateRange();
  const canManageShopee = can('admin:shopee');
  const [data, setData] = useState({
    ads: [],
    channel: [],
    shopeeAdsMetrics: [],
    shopeeFeeRates: [],
    campaigns: [],
    campaignMetrics: [],
    campaignSchemaReady: true,
    gmsCampaignMetrics: [],
    gmsItemMetrics: [],
    gmsSchemaReady: true,
    globalCm3AdsSpend: null,
    canViewWorkspaceCm3: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectionNotice, setConnectionNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    const syncNavigationState = () => {
      const params = new URLSearchParams(window.location.search);
      const requestedPage = Number(params.get('page') || 1);
      setCurrentPage(Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);

      const shopeeStatus = params.get('shopee_status');
      const shopeeMessage = params.get('shopee_message');
      if (shopeeStatus && shopeeMessage) {
        setConnectionNotice({
          type: shopeeStatus === 'error' ? 'error' : 'success',
          message: shopeeMessage,
        });
        params.delete('shopee_status');
        params.delete('shopee_message');
        params.delete('shopee_shop_id');
      }

      // The old tabbed UI has been replaced by one verified inventory table.
      // Remove legacy tab aliases so saved URLs keep working without a blank panel.
      params.delete('tab');

      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    };

    syncNavigationState();
    window.addEventListener('popstate', syncNavigationState);
    return () => window.removeEventListener('popstate', syncNavigationState);
  }, []);

  const navigateCampaignPage = (page = 1) => {
    setCurrentPage(page);
    const params = new URLSearchParams(window.location.search);
    params.delete('tab');
    if (page > 1) params.set('page', String(page));
    else params.delete('page');
    const query = params.toString();
    window.history.pushState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  };

  const syncSelectedRange = async () => {
    setSyncing(true);
    setConnectionNotice(null);
    try {
      const params = new URLSearchParams({
        date_start: dateRange.from,
        date_end: dateRange.to,
      });
      const response = await fetch(`/api/shopee-sync?${params.toString()}`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const result = await response.json().catch(() => ({}));
      const firstError = asArray(result.errors)[0];
      if (!response.ok || result.status === 'failed') {
        throw new Error(firstError || result.error || result.message || 'Sync Shopee gagal.');
      }

      const notice = asArray(result.notices)[0];
      setConnectionNotice({
        type: result.status === 'partial' ? 'error' : 'success',
        message: firstError || notice || result.message || 'Sync Shopee selesai.',
      });
      setRefreshKey((value) => value + 1);
    } catch (syncError: any) {
      setConnectionNotice({
        type: 'error',
        message: syncError?.message || 'Sync Shopee gagal.',
      });
    } finally {
      setSyncing(false);
    }
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
          gmsCampaignMetrics: result.gmsCampaignMetrics || [],
          gmsItemMetrics: result.gmsItemMetrics || [],
          gmsSchemaReady: result.gmsSchemaReady !== false,
          globalCm3AdsSpend: result.globalCm3AdsSpend == null
            ? null
            : Number(result.globalCm3AdsSpend),
          canViewWorkspaceCm3: result.canViewWorkspaceCm3 === true,
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
  }, [activeWorkspace.id, dateLoading, dateRange.from, dateRange.to, refreshKey]);

  const overview = useMemo(() => {
    const actualShopeeSales = data.channel
      .reduce((sum, row: any) => sum + Number(row.net_sales || 0), 0);

    return {
      actualShopeeSales,
      hasActualShopeeSales: data.channel.length > 0,
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
        const store = String(row.store || '').trim() || 'Toko belum dipetakan';
        const key = `${store}:${account}`;
        const current = byAccount.get(key) || {
          key,
          account,
          store,
          sources: new Set<string>(),
          spend: 0,
          impressions: 0,
          attributedRevenue: 0,
          rowCount: 0,
          revenueRows: 0,
        };
        const spend = Math.abs(Number(row.spent || 0));
        const source = String(row.source || '').trim();
        const attributedRevenue = Number(row.platform_attributed_revenue);

        if (source) current.sources.add(source);
        current.spend += spend;
        current.impressions += Number(row.impressions || 0);
        current.rowCount += 1;
        if (row.platform_attributed_revenue != null && Number.isFinite(attributedRevenue)) {
          current.attributedRevenue += attributedRevenue;
          current.revenueRows += 1;
        }
        byAccount.set(key, current);
      });

    const rows = Array.from(byAccount.values())
      .map((row) => ({
        ...row,
        sourceLabel: Array.from(row.sources as Set<string>).join(', ') || 'Meta CPAS',
        attributionComplete: row.rowCount > 0 && row.revenueRows === row.rowCount,
        attributedRevenue: row.rowCount > 0 && row.revenueRows === row.rowCount
          ? row.attributedRevenue
          : null,
        attributionRoas: row.rowCount > 0
          && row.revenueRows === row.rowCount
          && row.spend > 0
          ? row.attributedRevenue / row.spend
          : null,
      }))
      .sort((a, b) => b.spend - a.spend || a.account.localeCompare(b.account));

    return { rows };
  }, [data.ads]);

  const gmsStartFeeRate = resolveShopeeAdminFeeRate(data.shopeeFeeRates, dateRange.from);
  const gmsFeeRates = gmsStartFeeRate == null
    ? []
    : Array.from(new Set([
        gmsStartFeeRate,
        ...data.shopeeFeeRates
          .filter((row: any) => {
            const effectiveFrom = String(row.effective_from || '').slice(0, 10);
            return effectiveFrom > dateRange.from && effectiveFrom <= dateRange.to;
          })
          .map((row: any) => Number(row.rate))
          .filter((rate: number) => Number.isFinite(rate)),
      ]));
  const gmsFeeRate = gmsFeeRates.length === 1 ? gmsFeeRates[0] : null;
  const gmsFeeRateLabel = gmsFeeRate == null ? null : `${(gmsFeeRate * 100).toFixed(2)}%`;
  const previewCpasRows = useMemo(
    () => SHOW_PREVIEW_DATA ? buildPreviewCpasRows() : [],
    [],
  );
  const previewProductRows = useMemo(
    () => SHOW_PREVIEW_DATA ? buildPreviewProductRows(gmsFeeRate) : [],
    [gmsFeeRate],
  );
  const previewGmsData = useMemo(
    () => SHOW_PREVIEW_DATA && dateRange.from !== dateRange.to
      ? buildPreviewGmsData(dateRange.from, dateRange.to)
      : { campaigns: [], items: [] },
    [dateRange.from, dateRange.to],
  );
  const previewCpcDailyRows = useMemo(
    () => SHOW_PREVIEW_DATA ? buildPreviewCpcDailyRows(dateRange.from, dateRange.to) : [],
    [dateRange.from, dateRange.to],
  );

  const cpasRows = cpasResume.rows.length > 0 ? cpasResume.rows : previewCpasRows;
  const cpasIsPreview = cpasResume.rows.length === 0 && previewCpasRows.length > 0;
  const productSourceRows = campaignResume.rows.length > 0 ? campaignResume.rows : previewProductRows;
  const productRows = productSourceRows.filter((row: any) => (
    row.isRunning || Number(row.metricRowCount || 0) > 0
  ));
  const rawGmsCampaignRows = data.gmsCampaignMetrics.length > 0
    ? data.gmsCampaignMetrics
    : previewGmsData.campaigns;
  const rawGmsItemRows = data.gmsItemMetrics.length > 0
    ? data.gmsItemMetrics
    : previewGmsData.items;
  const gmsCampaignRows = rawGmsCampaignRows.map((row: any) => ({
    key: `${row.shop_config_id || 'preview'}:${row.campaign_id}`,
    shopConfigId: row.shop_config_id || null,
    shopId: Number(row.shop_id || 0) || null,
    campaignId: Number(row.campaign_id || 0),
    periodStart: String(row.period_start || dateRange.from),
    periodEnd: String(row.period_end || dateRange.to),
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    expense: Math.abs(Number(row.expense || 0)),
    broadGmv: Number(row.broad_gmv || 0),
    broadOrders: Number(row.broad_order || 0),
    broadOrderAmount: Number(row.broad_order_amount || 0),
    platformRoas: Number(row.broad_roas || 0),
    directOrders: Number(row.direct_order || 0),
    directOrderAmount: Number(row.direct_order_amount || 0),
    directRoas: Number(row.direct_roas || 0),
    adjustedRoas: adjustedPreviewRoas(
      Math.abs(Number(row.expense || 0)),
      Number(row.broad_gmv || 0),
      gmsFeeRate,
    ),
    isPreview: Boolean(row.isPreview),
  }));
  const gmsItemRows = rawGmsItemRows.map((row: any) => {
    const expense = Math.abs(Number(row.expense || 0));
    const broadGmv = Number(row.broad_gmv || 0);
    return {
      key: `${row.shop_config_id || 'preview'}:${row.campaign_id}:${row.item_id}`,
      shopConfigId: row.shop_config_id || null,
      shopId: Number(row.shop_id || 0) || null,
      campaignId: Number(row.campaign_id || 0),
      itemId: Number(row.item_id || 0),
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
      expense,
      broadGmv,
      broadOrders: Number(row.broad_order || 0),
      broadOrderAmount: Number(row.broad_order_amount || 0),
      platformRoas: Number(row.broad_roas || 0),
      directOrders: Number(row.direct_order || 0),
      directOrderAmount: Number(row.direct_order_amount || 0),
      directRoas: Number(row.direct_roas || 0),
      adjustedRoas: adjustedPreviewRoas(expense, broadGmv, gmsFeeRate),
      isPreview: Boolean(row.isPreview),
    };
  });
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
  const cpcIsPreview = data.shopeeAdsMetrics.length === 0 && previewCpcDailyRows.length > 0;
  const cpcHasData = data.shopeeAdsMetrics.length > 0 || cpcIsPreview;
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
    return {
      expense: summary.expense + Number(row.spend || 0),
      impressions: summary.impressions + Number(row.impressions || 0),
      attributedRevenue: summary.attributedRevenue + Number(row.attributedRevenue || 0),
    };
  }, { expense: 0, impressions: 0, attributedRevenue: 0 });
  const cpasHasData = cpasRows.length > 0;
  const cpasAttributionIncomplete = cpasRows.some((row: any) => (
    !row.isPreview && row.attributionComplete !== true
  ));
  const cpasAttributedRevenue = cpasHasData && !cpasAttributionIncomplete
    ? cpasSummary.attributedRevenue
    : null;
  const cpasPlatformRoas = cpasAttributedRevenue != null && cpasSummary.expense > 0
    ? cpasAttributedRevenue / cpasSummary.expense
    : null;

  const productMetricRows = productRows.filter((row: any) => (
    Number(row.metricRowCount || 0) > 0 || Boolean(row.isPreview)
  ));
  const productSummary = [...productMetricRows, ...gmsCampaignRows]
    .reduce((summary: any, row: any) => ({
      impressions: summary.impressions + Number(row.impressions || 0),
      clicks: summary.clicks + Number(row.clicks || 0),
      expense: summary.expense + Math.abs(Number(row.expense || 0)),
      broadGmv: summary.broadGmv + Number(row.broadGmv || 0),
    }), { impressions: 0, clicks: 0, expense: 0, broadGmv: 0 });
  const productHasData = productMetricRows.length > 0 || gmsCampaignRows.length > 0;
  const productPlatformRoas = productHasData && productSummary.expense > 0
    ? productSummary.broadGmv / productSummary.expense
    : null;
  const productSubtypeCounts = productRows.reduce((counts: Record<string, number>, campaign: any) => {
    const subtype = productCampaignSubtype(campaign);
    counts[subtype] = (counts[subtype] || 0) + 1;
    return counts;
  }, { individual: 0, group: 0, automatic: 0, unclassified: 0 });
  const productSubtypeLabel = [
    productSubtypeCounts.individual > 0 ? `Individual ${productSubtypeCounts.individual}` : null,
    productSubtypeCounts.group > 0 ? `Grup ${productSubtypeCounts.group}` : null,
    productSubtypeCounts.automatic > 0 ? `Otomatis ${productSubtypeCounts.automatic}` : null,
    gmsCampaignRows.length > 0 ? `Shop GMV Max ${gmsCampaignRows.length}` : null,
    productSubtypeCounts.unclassified > 0 ? `Belum terklasifikasi ${productSubtypeCounts.unclassified}` : null,
  ].filter(Boolean).join(' · ');
  const productIsPreview = productMetricRows.some((row: any) => row.isPreview)
    || gmsCampaignRows.some((row: any) => row.isPreview);

  const hasAvailableSpend = cpasHasData || productHasData || cpcHasData;
  const connectedTotalExpense = hasAvailableSpend
    ? (cpasHasData ? cpasSummary.expense : 0)
      + (productHasData ? productSummary.expense : 0)
      + (cpcHasData ? cpcSummary.expense : 0)
    : null;
  const connectedShopeeGmv = cpcHasData ? cpcSummary.broadGmv : null;
  const connectedShopeeDirectGmv = cpcHasData ? cpcSummary.directGmv : null;
  const hasPreviewSpend = cpasIsPreview || productIsPreview || cpcIsPreview;
  const hasAllSpendSources = cpasHasData && productHasData && cpcHasData;
  const summarySourceCount = Number(cpasHasData) + Number(productHasData) + Number(cpcHasData);
  const blendedRoas = overview.hasActualShopeeSales
    && hasAllSpendSources
    && connectedTotalExpense != null
    && connectedTotalExpense > 0
    ? overview.actualShopeeSales / connectedTotalExpense
    : null;
  const globalCm3AdsSpend = Number(data.globalCm3AdsSpend || 0);
  const shopeeShareOfGlobal = connectedTotalExpense != null && globalCm3AdsSpend > 0
    ? connectedTotalExpense / globalCm3AdsSpend * 100
    : null;
  const totalSummaryImpressions = hasAvailableSpend
    ? (cpasHasData ? cpasSummary.impressions : 0)
      + (productHasData ? productSummary.impressions : 0)
      + (cpcHasData ? cpcSummary.impressions : 0)
    : null;
  const totalSummaryGmv = hasAllSpendSources && cpasAttributedRevenue != null
    ? cpasAttributedRevenue + productSummary.broadGmv + cpcSummary.broadGmv
    : null;
  const totalSummaryRoas = totalSummaryGmv != null
    && connectedTotalExpense != null
    && connectedTotalExpense > 0
    ? totalSummaryGmv / connectedTotalExpense
    : null;
  const sourceSummaryRows = [
    {
      key: 'cpas',
      name: 'CPAS',
      sub: 'Meta Ads',
      color: '#1877f2',
      hasData: cpasHasData,
      impressions: cpasHasData ? cpasSummary.impressions : null,
      expense: cpasHasData ? cpasSummary.expense : null,
      gmv: cpasAttributedRevenue,
      roas: cpasPlatformRoas,
      preview: cpasIsPreview,
    },
    {
      key: 'product',
      name: 'Iklan Produk',
      sub: productSubtypeLabel,
      color: '#ee4d2d',
      hasData: productHasData,
      impressions: productHasData ? productSummary.impressions : null,
      expense: productHasData ? productSummary.expense : null,
      gmv: productHasData ? productSummary.broadGmv : null,
      roas: productPlatformRoas,
      preview: productIsPreview,
    },
    {
      key: 'cpc',
      name: 'Agregat CPC Shopee',
      sub: '',
      color: 'var(--green)',
      hasData: cpcHasData,
      impressions: cpcHasData ? cpcSummary.impressions : null,
      expense: cpcHasData ? cpcSummary.expense : null,
      gmv: cpcHasData ? cpcSummary.broadGmv : null,
      roas: cpcBroadRoas,
      preview: cpcIsPreview,
    },
  ];

  const gmsItemCountByCampaign = gmsItemRows.reduce((counts: Map<string, number>, row: any) => {
    const owner = row.shopConfigId || `shop:${row.shopId || 'preview'}`;
    const key = `${owner}:${row.campaignId}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map<string, number>());

  const identifiedCampaignRows = [
    ...cpasRows.map((row: any) => {
      const hasDelivery = Number(row.spend || 0) > 0 || Number(row.impressions || 0) > 0;
      return {
        key: `cpas:${row.key || `${row.store}:${row.account}`}`,
        type: 'CPAS',
        typeColor: '#1877f2',
        name: row.account,
        idLabel: '',
        targetPrimary: row.store,
        targetSecondary: '',
        status: hasDelivery ? 'Tayang' : 'Tidak tayang',
        statusColor: hasDelivery ? 'var(--green)' : C.dim,
        statusTitle: 'Aktivitas pada rentang terpilih; bukan status campaign.',
        impressions: Number(row.impressions || 0),
        clicks: null,
        expense: Number(row.spend || 0),
        gmv: row.attributedRevenue == null ? null : Number(row.attributedRevenue),
        gmvLabel: null,
        secondaryGmv: null,
        primaryRoas: row.attributionRoas == null ? null : Number(row.attributionRoas),
        platformRoas: null,
        roasLabel: null,
        isPreview: Boolean(row.isPreview),
        priority: hasDelivery ? 2 : 0,
      };
    }),
    ...productRows.map((campaign: any) => {
      const productNames = campaign.products
        .map((product: any) => String(product?.product_name || '').trim())
        .filter(Boolean);
      const itemCount = Math.max(productNames.length, campaign.itemIds.length);
      const isRunning = String(campaign.campaign_status || '').toLowerCase() === 'ongoing';
      const hasPerformance = Number(campaign.metricRowCount || 0) > 0 || Boolean(campaign.isPreview);
      const hasDelivery = hasPerformance
        && (Number(campaign.expense || 0) > 0 || Number(campaign.impressions || 0) > 0);
      return {
        key: `product:${campaign.key}`,
        type: 'Iklan Produk',
        typeColor: '#ee4d2d',
        name: campaign.ad_name || `Campaign ${campaign.campaign_id}`,
        idLabel: [
          campaign.shop_name || (campaign.shop_id ? `Shop ${campaign.shop_id}` : null),
          `ID ${campaign.campaign_id}`,
        ].filter(Boolean).join(' · '),
        targetPrimary: productNames[0] || (itemCount > 0 ? `${itemCount} produk` : '—'),
        targetSecondary: [
          itemCount > 1 ? `+${itemCount - 1} produk` : null,
          campaign.targetRoas != null ? `Target ${campaign.targetRoas.toFixed(2)}x` : null,
        ].filter(Boolean).join(' · '),
        status: campaignStatusLabel(campaign.campaign_status),
        statusColor: isRunning ? 'var(--green)' : C.dim,
        statusTitle: 'Status campaign pada sinkronisasi terakhir.',
        impressions: hasPerformance ? Number(campaign.impressions || 0) : null,
        clicks: hasPerformance ? Number(campaign.clicks || 0) : null,
        expense: hasPerformance ? Number(campaign.expense || 0) : null,
        gmv: hasPerformance ? Number(campaign.broadGmv || 0) : null,
        gmvLabel: 'Broad',
        secondaryGmv: hasPerformance ? Number(campaign.directGmv || 0) : null,
        primaryRoas: hasPerformance ? campaign.adjustedRoas : null,
        platformRoas: hasPerformance ? campaign.actualRoas : null,
        roasLabel: null,
        isPreview: Boolean(campaign.isPreview),
        priority: hasDelivery ? 2 : isRunning ? 1 : 0,
      };
    }),
    ...gmsCampaignRows.map((campaign: any) => {
      const owner = campaign.shopConfigId || `shop:${campaign.shopId || 'preview'}`;
      const itemCount = gmsItemCountByCampaign.get(`${owner}:${campaign.campaignId}`) || 0;
      const hasDelivery = Number(campaign.expense || 0) > 0 || Number(campaign.impressions || 0) > 0;
      return {
        key: `gms:${campaign.key}`,
        type: 'GMV Max',
        typeColor: '#8b5cf6',
        name: `Campaign ${campaign.campaignId}`,
        idLabel: campaign.shopId ? `Shop ${campaign.shopId}` : '',
        targetPrimary: itemCount > 0 ? `${itemCount} produk` : '—',
        targetSecondary: '',
        status: hasDelivery ? 'Tayang' : 'Tidak tayang',
        statusColor: hasDelivery ? 'var(--green)' : C.dim,
        statusTitle: 'Aktivitas pada rentang terpilih; API tidak menyediakan status campaign.',
        impressions: Number(campaign.impressions || 0),
        clicks: Number(campaign.clicks || 0),
        expense: Number(campaign.expense || 0),
        gmv: Number(campaign.broadGmv || 0),
        gmvLabel: 'Broad',
        secondaryGmv: null,
        primaryRoas: campaign.adjustedRoas,
        platformRoas: campaign.expense > 0 ? Number(campaign.platformRoas) : null,
        roasLabel: null,
        isPreview: Boolean(campaign.isPreview),
        priority: hasDelivery ? 2 : 0,
      };
    }),
  ].sort((a, b) => (
    b.priority - a.priority
    || b.expense - a.expense
    || a.name.localeCompare(b.name)
  ));
  const campaignPage = paginateRows(identifiedCampaignRows, currentPage);
  const hasPreviewCampaignRows = identifiedCampaignRows.some((row) => row.isPreview);
  const roasColumnTitle = [
    campaignResume.feeRateLabel
      ? `Iklan Produk: setelah biaya admin ${campaignResume.feeRateLabel}.`
      : 'Iklan Produk: asumsi biaya admin belum tersedia.',
    gmsFeeRateLabel
      ? `Shop GMV Max: setelah biaya admin ${gmsFeeRateLabel}.`
      : 'Shop GMV Max: asumsi biaya admin tidak tersedia atau berubah dalam rentang.',
    'CPAS: ROAS Meta.',
  ].join(' ');

  if (loading || dateLoading) {
    return (
      <div className="fade-in" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 320 }}>
        <div style={{ color: C.dim, fontSize: 13 }}>Memuat…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fade-in" style={{ background: C.card, border: '1px solid var(--red)', borderRadius: 12, padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>Gagal memuat data</div>
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
          {canManageShopee && (
            <button
              type="button"
              disabled={syncing}
              onClick={syncSelectedRange}
              style={{
                border: `1px solid ${C.bdr}`,
                borderRadius: 7,
                padding: '7px 11px',
                background: C.card,
                color: syncing ? C.dim : C.txt,
                fontSize: 10,
                fontWeight: 800,
                cursor: syncing ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {syncing ? 'Menyinkronkan…' : 'Sync'}
            </button>
          )}
          <span style={{ border: `1px solid ${C.bdr}`, borderRadius: 999, padding: '5px 9px', color: C.dim, fontSize: 10 }}>
            {formatDate(dateRange.from)} — {formatDate(dateRange.to)}
          </span>
        </div>
      </div>

      {connectionNotice && (
        <div
          role={connectionNotice.type === 'error' ? 'alert' : 'status'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 12,
            padding: '9px 11px',
            border: `1px solid ${connectionNotice.type === 'error' ? 'var(--red)' : 'var(--green)'}`,
            borderRadius: 8,
            color: connectionNotice.type === 'error' ? 'var(--red)' : 'var(--green)',
            fontSize: 10,
          }}
        >
          <span>{connectionNotice.message}</span>
          <button
            type="button"
            aria-label="Tutup"
            onClick={() => setConnectionNotice(null)}
            style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 14 }}
          >
            ×
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(205px, 1fr))', gap: 10, marginBottom: 16 }}>
        <MetricCard
          label="Penjualan aktual"
          value={overview.hasActualShopeeSales ? fmtRupiah(overview.actualShopeeSales) : '—'}
          title="Pesanan dikirim dan selesai."
        />
        <MetricCard
          label="GMV CPC"
          value={connectedShopeeGmv == null ? '—' : fmtRupiah(connectedShopeeGmv)}
          sub={connectedShopeeDirectGmv == null ? undefined : `Direct ${fmtRupiah(connectedShopeeDirectGmv)}`}
          color="#ee4d2d"
          title="GMV agregat CPC."
          preview={cpcIsPreview}
        />
        <MetricCard
          label="Total biaya"
          value={connectedTotalExpense == null ? '—' : fmtRupiah(connectedTotalExpense)}
          sub={data.canViewWorkspaceCm3 && shopeeShareOfGlobal != null
            ? `${shopeeShareOfGlobal.toFixed(1)}% dari biaya marketing`
            : summarySourceCount < 3 ? `${summarySourceCount}/3 sumber` : undefined}
          color="var(--yellow)"
          title="CPAS, Iklan Produk, dan Agregat CPC."
          preview={hasPreviewSpend}
        />
        <MetricCard
          label="MER"
          value={blendedRoas == null ? '—' : `${blendedRoas.toFixed(2)}x`}
          color={blendedRoas == null ? C.dim : blendedRoas >= 3 ? 'var(--green)' : blendedRoas >= 1.5 ? 'var(--yellow)' : 'var(--red)'}
          title="Penjualan aktual dibagi total biaya."
          preview={hasPreviewSpend}
        />
      </div>

      <section style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '12px 15px', borderBottom: `1px solid ${C.bdr}`, fontSize: 13, fontWeight: 800 }}>
          Ringkasan
        </div>
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                {['Sumber', 'Impressions', 'Biaya', 'GMV', 'ROAS'].map((heading, index) => (
                  <th
                    key={heading}
                    title={heading === 'Impressions'
                      ? 'Impressions platform; bukan reach unik.'
                      : heading === 'GMV'
                        ? 'GMV yang dilaporkan masing-masing platform.'
                        : undefined}
                    style={{ padding: '9px 12px', textAlign: index === 0 ? 'left' : 'right', color: C.dim, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sourceSummaryRows.map((row) => (
                <tr key={row.key} style={{ borderBottom: `1px solid ${C.bdr}` }}>
                  <td style={{ padding: '11px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: row.color, flex: '0 0 auto' }} />
                      <span style={{ fontWeight: 800 }}>{row.name}</span>
                      {row.preview && (
                        <span style={{ borderRadius: 999, padding: '2px 6px', background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 7, fontWeight: 800 }}>Preview</span>
                      )}
                    </div>
                    {row.sub && (
                      <div style={{ color: C.dim, fontSize: 9, marginTop: 3, paddingLeft: 14 }}>{row.sub}</div>
                    )}
                  </td>
                  <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                    {row.impressions == null ? '—' : formatCount(row.impressions)}
                  </td>
                  <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                    {row.expense == null ? '—' : fmtRupiah(row.expense)}
                  </td>
                  <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                    {row.gmv == null ? '—' : fmtRupiah(row.gmv)}
                  </td>
                  <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800 }}>
                    {row.roas == null ? '—' : `${row.roas.toFixed(2)}x`}
                  </td>
                </tr>
              ))}
              <tr title="Sumber dapat tumpang tindih." style={{ background: 'rgba(255, 255, 255, 0.018)' }}>
                <td style={{ padding: '11px 12px' }}>
                  <div style={{ fontWeight: 800 }}>Total</div>
                </td>
                <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800 }}>
                  {totalSummaryImpressions == null ? '—' : formatCount(totalSummaryImpressions)}
                </td>
                <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800 }}>
                  {connectedTotalExpense == null ? '—' : fmtRupiah(connectedTotalExpense)}
                </td>
                <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800 }}>
                  {totalSummaryGmv == null ? '—' : fmtRupiah(totalSummaryGmv)}
                </td>
                <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800 }}>
                  {totalSummaryRoas == null ? '—' : `${totalSummaryRoas.toFixed(2)}x`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ background: C.card, border: `1px solid ${C.bdr}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '12px 15px', borderBottom: `1px solid ${C.bdr}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Detail iklan</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {hasPreviewCampaignRows && (
              <span style={{ borderRadius: 999, padding: '3px 7px', background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 8, fontWeight: 800 }}>Preview</span>
            )}
          </div>
        </div>

        {campaignPage.rows.length > 0 ? (
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.bdr}` }}>
                  {['Iklan', 'Target', 'Impressions', 'Biaya', 'GMV', 'ROAS'].map((heading, index) => (
                    <th
                      key={heading}
                      title={heading === 'ROAS'
                        ? roasColumnTitle
                        : heading === 'Impressions'
                          ? 'Impressions dilaporkan platform dan bukan reach unik.'
                          : undefined}
                      style={{ padding: '9px 12px', textAlign: index < 2 ? 'left' : 'right', color: C.dim, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campaignPage.rows.map((row: any) => (
                  <tr key={row.key} style={{ borderBottom: `1px solid ${C.bdr}` }}>
                    <td style={{ padding: '11px 12px', maxWidth: 300 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 5 }}>
                        <span style={{ borderRadius: 999, padding: '2px 6px', background: `${row.typeColor}18`, color: row.typeColor, fontSize: 8, fontWeight: 800 }}>{row.type}</span>
                        <span title={row.statusTitle} style={{ color: row.statusColor, fontSize: 8, fontWeight: 700 }}>● {row.status}</span>
                        {row.isPreview && (
                          <span style={{ color: 'var(--yellow)', fontSize: 8, fontWeight: 800 }}>Preview</span>
                        )}
                      </div>
                      <div style={{ fontWeight: 800, lineHeight: 1.35 }}>{row.name}</div>
                      {row.idLabel && (
                        <div style={{ color: C.dim, fontSize: 9, marginTop: 3 }}>{row.idLabel}</div>
                      )}
                    </td>
                    <td style={{ padding: '11px 12px', maxWidth: 250 }}>
                      <div style={{ lineHeight: 1.35 }}>{row.targetPrimary}</div>
                      {row.targetSecondary && (
                        <div style={{ color: C.dim, fontSize: 9, marginTop: 3 }}>{row.targetSecondary}</div>
                      )}
                    </td>
                    <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                      <div>{row.impressions == null ? '—' : formatCount(row.impressions)}</div>
                      {row.clicks != null && (
                        <div style={{ color: C.dim, fontSize: 9, marginTop: 3, fontWeight: 500 }}>{formatCount(row.clicks)} klik</div>
                      )}
                    </td>
                    <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{row.expense == null ? '—' : fmtRupiah(row.expense)}</td>
                    <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>
                      <div>{row.gmv == null ? '—' : fmtRupiah(row.gmv)}</div>
                      {(row.secondaryGmv != null || row.gmvLabel) && (
                        <div style={{ color: C.dim, fontSize: 9, marginTop: 3, fontWeight: 500 }}>
                          {row.secondaryGmv == null ? row.gmvLabel : `Direct ${fmtRupiah(row.secondaryGmv)}`}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '11px 12px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 800 }}>
                      <div>{row.primaryRoas == null ? '—' : `${Number(row.primaryRoas).toFixed(2)}x`}</div>
                      {(row.platformRoas != null || row.roasLabel) && (
                        <div style={{ color: C.dim, fontSize: 9, marginTop: 3, fontWeight: 500 }}>
                          {row.platformRoas == null ? row.roasLabel : `Platform ${Number(row.platformRoas).toFixed(2)}x`}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <DetailEmptyState>Tidak ada data.</DetailEmptyState>
        )}

        {cpasAttributionIncomplete && (
          <div style={{ padding: '9px 12px', borderTop: `1px solid ${C.bdr}`, background: 'var(--badge-yellow-bg)', color: 'var(--yellow)', fontSize: 9 }}>
            Atribusi Meta belum lengkap.
          </div>
        )}
        {(!data.campaignSchemaReady || !data.gmsSchemaReady) && (
          <div style={{ padding: '9px 12px', borderTop: `1px solid ${C.bdr}`, color: C.dim, fontSize: 9 }}>
            {!data.campaignSchemaReady ? 'Data Iklan Produk belum siap.' : ''}
            {!data.campaignSchemaReady && !data.gmsSchemaReady ? ' ' : ''}
            {!data.gmsSchemaReady ? 'Data Shop GMV Max belum siap.' : ''}
          </div>
        )}
        {data.gmsSchemaReady && dateRange.from === dateRange.to && gmsCampaignRows.length === 0 && (
          <div style={{ padding: '9px 12px', borderTop: `1px solid ${C.bdr}`, color: C.dim, fontSize: 9 }}>
            Pilih rentang minimal 2 hari untuk GMV Max.
          </div>
        )}
        <Pagination page={campaignPage.page} totalPages={campaignPage.totalPages} onChange={navigateCampaignPage} />
      </section>

    </div>
  );
}
