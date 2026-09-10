'use server';

import { createServiceSupabase } from './supabase-server';
import { getShippingFeeRange } from './shipping-fee-data';
import { requireDashboardTabAccess } from './dashboard-access';

interface MarketingPageDataParams {
  from: string;
  to: string;
  prevRangeFrom: string;
  prevRangeTo: string;
  historyFrom: string;
  historyTo: string;
}

interface ShopeeDetailsDataParams {
  from: string;
  to: string;
}

const HISTORY_PAGE_SIZE = 1000;

async function fetchHistoricalRows(
  buildQuery: (fromIndex: number, toIndex: number) => PromiseLike<any>,
  label: string,
) {
  const rows: any[] = [];

  for (let fromIndex = 0; ; fromIndex += HISTORY_PAGE_SIZE) {
    const result = await buildQuery(fromIndex, fromIndex + HISTORY_PAGE_SIZE - 1);
    if (result.error) throw new Error(`${label}: ${result.error.message}`);

    const page = result.data || [];
    rows.push(...page);
    if (page.length < HISTORY_PAGE_SIZE) break;
  }

  return rows;
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return (result.data ?? ([] as unknown as T));
}

function unwrapOptional<T>(result: { data: T | null; error: { message: string } | null }, label: string) {
  if (result.error) {
    console.error(`[Marketing] optional load error: ${label}`, result.error.message);
    return {
      data: [] as unknown as T,
      error: `${label}: ${result.error.message}`,
    };
  }
  return {
    data: (result.data ?? ([] as unknown as T)),
    error: null as string | null,
  };
}

async function fetchAdsRowsWithPlatformAttribution(
  svc: any,
  workspaceId: string,
  from: string,
  to: string,
) {
  const enriched = await svc.from('daily_ads_spend')
    .select('date, source, spent, impressions, store, brand_id, ad_account, data_source, platform_attributed_revenue, platform_reported_roas')
    .eq('workspace_id', workspaceId)
    .gte('date', from)
    .lte('date', to);

  if (!enriched.error) return enriched;

  const migrationPending = /platform_attributed_revenue|platform_reported_roas/i
    .test(String(enriched.error.message || ''));
  if (!migrationPending) return enriched;

  // Keep the dashboard readable during a rolling deploy before migration 189 lands.
  return svc.from('daily_ads_spend')
    .select('date, source, spent, impressions, store, brand_id, ad_account, data_source')
    .eq('workspace_id', workspaceId)
    .gte('date', from)
    .lte('date', to);
}

function isMissingShopeeCampaignSchema(error: { code?: string; message?: string } | null | undefined) {
  const detail = `${error?.code || ''} ${error?.message || ''}`;
  return /PGRST205|42P01/i.test(detail)
    || /(relation|table).*(shopee_ad_campaigns|shopee_ad_campaign_daily_metrics).*(does not exist|schema cache|not found)/i.test(detail);
}

async function fetchShopeeCampaignDetails(
  svc: any,
  workspaceId: string,
  from: string,
  to: string,
) {
  const [campaignsRes, metricsRes] = await Promise.all([
    svc.from('shopee_ad_campaigns')
      .select('shop_config_id, shop_id, shop_name, campaign_id, campaign_type, ad_type, ad_name, campaign_status, bidding_method, campaign_placement, campaign_budget, roas_target, start_at, end_at, item_ids, products, selected_keywords, last_seen_at')
      .eq('workspace_id', workspaceId)
      .eq('campaign_type', 'product')
      .order('last_seen_at', { ascending: false }),
    svc.from('shopee_ad_campaign_daily_metrics')
      .select('shop_config_id, shop_id, campaign_id, campaign_type, metric_date, ad_type, ad_name, campaign_placement, impressions, clicks, ctr, expense, broad_gmv, broad_order, broad_order_amount, broad_roas, direct_gmv, direct_order, direct_order_amount, direct_roas')
      .eq('workspace_id', workspaceId)
      .eq('campaign_type', 'product')
      .gte('metric_date', from)
      .lte('metric_date', to),
  ]);

  if (isMissingShopeeCampaignSchema(campaignsRes.error) || isMissingShopeeCampaignSchema(metricsRes.error)) {
    return {
      campaigns: [],
      campaignMetrics: [],
      campaignSchemaReady: false,
    };
  }
  if (campaignsRes.error) {
    throw new Error(`Gagal memuat setting campaign Shopee: ${campaignsRes.error.message}`);
  }
  if (metricsRes.error) {
    throw new Error(`Gagal memuat performa campaign Shopee: ${metricsRes.error.message}`);
  }

  return {
    campaigns: campaignsRes.data || [],
    campaignMetrics: metricsRes.data || [],
    campaignSchemaReady: true,
  };
}

async function fetchGlobalCm3AdsSpend(
  svc: ReturnType<typeof createServiceSupabase>,
  workspaceId: string,
  from: string,
  to: string,
) {
  const rows = await fetchHistoricalRows(
    (fromIndex, toIndex) => svc.from('daily_ads_spend')
      .select('date, spent')
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .range(fromIndex, toIndex),
    'Gagal memuat total biaya iklan CM3 workspace aktif',
  );

  return rows.reduce((sum, row) => sum + Math.abs(Number(row.spent || 0)), 0);
}

export async function getShopeeDetailsData({
  from,
  to,
}: ShopeeDetailsDataParams) {
  const { workspaceId } = await requireDashboardTabAccess(
    'marketing',
    'Marketing Channel',
  );

  const svc = createServiceSupabase();
  const [adsRes, channelRes, shopeeAdsRes, campaignDetails, shopeeFeeRatesRes, globalCm3AdsSpend] = await Promise.all([
    fetchAdsRowsWithPlatformAttribution(svc, workspaceId, from, to),
    svc.from('daily_channel_data')
      .select('date, channel, net_sales')
      .eq('workspace_id', workspaceId)
      .ilike('channel', 'shopee')
      .gte('date', from)
      .lte('date', to),
    svc.from('shopee_ads_daily_metrics')
      .select('metric_date, shop_id, shop_name, impressions, clicks, ctr, direct_order, broad_order, direct_item_sold, broad_item_sold, direct_gmv, broad_gmv, expense, cost_per_conversion, direct_roas, broad_roas')
      .eq('workspace_id', workspaceId)
      .eq('spend_stream_key', 'shopee_ads')
      .gte('metric_date', from)
      .lte('metric_date', to),
    fetchShopeeCampaignDetails(svc, workspaceId, from, to),
    svc.from('marketplace_fee_estimate_rates')
      .select('rate, effective_from')
      .eq('workspace_id', workspaceId)
      .eq('setting_key', 'shopee_fallback')
      .lte('effective_from', to)
      .order('effective_from', { ascending: true }),
    fetchGlobalCm3AdsSpend(svc, workspaceId, from, to),
  ]);

  return {
    ads: unwrap(adsRes, 'Gagal memuat spend Meta CPAS'),
    channel: unwrap(channelRes, 'Gagal memuat penjualan aktual Shopee'),
    shopeeAdsMetrics: unwrap(shopeeAdsRes, 'Gagal memuat atribusi Shopee Ads'),
    shopeeFeeRates: unwrap(shopeeFeeRatesRes, 'Gagal memuat asumsi biaya admin Shopee'),
    globalCm3AdsSpend,
    ...campaignDetails,
  };
}

export async function getMarketingPageData({
  from,
  to,
  prevRangeFrom,
  prevRangeTo,
  historyFrom,
  historyTo,
}: MarketingPageDataParams) {
  const { workspaceId } = await requireDashboardTabAccess(
    'marketing',
    'Marketing Channel',
  );

  const svc = createServiceSupabase();

  const [
    prodRes,
    adsRes,
    chRes,
    mappingRes,
    shippingRes,
    prevRangeProdRes,
    prevRangeAdsRes,
    prevRangeChRes,
    prevRangeShippingRes,
    historyProd,
    historyAds,
  ] = await Promise.all([
    svc.from('daily_product_summary')
      .select('date, product, net_sales, gross_profit, mkt_cost')
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to),
    fetchAdsRowsWithPlatformAttribution(svc, workspaceId, from, to),
    svc.from('daily_channel_data')
      .select('date, channel, product, net_sales, gross_profit, mp_admin_cost')
      .eq('workspace_id', workspaceId)
      .gte('date', from)
      .lte('date', to),
    svc.from('ads_store_brand_mapping')
      .select('store_pattern, brand, brand_id')
      .eq('workspace_id', workspaceId),
    getShippingFeeRange(workspaceId, from, to)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: { message: error.message } })),
    svc.from('daily_product_summary')
      .select('date, product, net_sales, gross_profit, mkt_cost')
      .eq('workspace_id', workspaceId)
      .gte('date', prevRangeFrom)
      .lte('date', prevRangeTo),
    svc.from('daily_ads_spend')
      .select('date, source, spent, store, brand_id')
      .eq('workspace_id', workspaceId)
      .gte('date', prevRangeFrom)
      .lte('date', prevRangeTo),
    svc.from('daily_channel_data')
      .select('date, channel, product, net_sales, gross_profit, mp_admin_cost')
      .eq('workspace_id', workspaceId)
      .gte('date', prevRangeFrom)
      .lte('date', prevRangeTo),
    getShippingFeeRange(workspaceId, prevRangeFrom, prevRangeTo)
      .then((data) => ({ data, error: null }))
      .catch((error: Error) => ({ data: [], error: { message: error.message } })),
    fetchHistoricalRows(
      (fromIndex, toIndex) => svc.from('daily_product_summary')
        .select('date, product, net_sales')
        .eq('workspace_id', workspaceId)
        .gte('date', historyFrom)
        .lte('date', historyTo)
        .order('date', { ascending: true })
        .order('product', { ascending: true })
        .range(fromIndex, toIndex),
      'Gagal memuat histori revenue marketing',
    ),
    fetchHistoricalRows(
      (fromIndex, toIndex) => svc.from('daily_ads_spend')
        .select('date, source, spent, store, brand_id')
        .eq('workspace_id', workspaceId)
        .gte('date', historyFrom)
        .lte('date', historyTo)
        .order('date', { ascending: true })
        .order('source', { ascending: true })
        .order('store', { ascending: true })
        .order('brand_id', { ascending: true })
        .range(fromIndex, toIndex),
      'Gagal memuat histori marketing fee',
    ),
  ]);

  const shipping = unwrapOptional(shippingRes, 'Gagal memuat shipping fee Marketing');
  const prevShipping = unwrapOptional(prevRangeShippingRes, 'Gagal memuat shipping fee Marketing bulan sebelumnya');

  return {
    prod: unwrap(prodRes, 'Gagal memuat revenue marketing'),
    ads: unwrap(adsRes, 'Gagal memuat marketing fee'),
    channel: unwrap(chRes, 'Gagal memuat breakdown channel'),
    brandMapping: unwrap(mappingRes, 'Gagal memuat mapping brand iklan'),
    shipping: shipping.data,
    shippingError: shipping.error,
    prevRangeProd: unwrap(prevRangeProdRes, 'Gagal memuat gross profit bulan sebelumnya'),
    prevRangeAds: unwrap(prevRangeAdsRes, 'Gagal memuat perbandingan ad spend'),
    prevRangeChannel: unwrap(prevRangeChRes, 'Gagal memuat perbandingan channel'),
    prevRangeShipping: prevShipping.data,
    prevRangeShippingError: prevShipping.error,
    historyProd,
    historyAds,
  };
}
