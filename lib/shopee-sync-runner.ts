import { randomUUID } from 'crypto';
import { createServiceSupabase } from './service-supabase';
import {
  fetchShopeeAdsPerformanceRange,
  fetchShopeeGmsPerformanceRange,
  fetchShopeeProductCampaignPerformanceRange,
  getShopeeProductCampaignRefs,
  getShopeeProductCampaignSettings,
  refreshShopeeAccessToken,
  type ShopeeAdsPerformancePoint,
  type ShopeeGmsPeriodPerformance,
  type ShopeeGmsReport,
  type ShopeeProductCampaignPerformancePoint,
  type ShopeeProductCampaignSetting,
} from './shopee-open-platform';
import {
  getShopeeApiDataSourceForStream,
  getShopeeSpendStreamDefinition,
  isShopeeSpendStreamKey,
  type ShopeeSpendStreamKey,
  type ShopeeSpendSyncMode,
} from './shopee-streams';
import { requireExplicitWorkspaceId } from './workspace-scope';

type ShopeeShopRow = {
  id: number;
  shop_id: number;
  shop_name: string;
  region: string | null;
  marketplace_source_key: string | null;
  account_business_code: string | null;
  viewer_business_code: string | null;
  revenue_business_code: string | null;
  default_owner_business_code: string | null;
  default_processor_business_code: string | null;
  is_active: boolean;
};

type ShopeeSpendStreamRow = {
  id: number;
  shop_config_id: number;
  stream_key: ShopeeSpendStreamKey;
  default_source: string;
  default_advertiser: string;
  sync_mode: ShopeeSpendSyncMode;
  is_enabled: boolean;
};

type ShopeeTokenRow = {
  shop_config_id: number;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
};

export type ShopeeSyncResult = {
  success: boolean;
  status: 'success' | 'partial' | 'failed';
  shops_synced: number;
  shops_total: number;
  rows_inserted: number;
  spend_total: number;
  direct_gmv_total: number;
  broad_gmv_total: number;
  date_range: { start: string; end: string };
  duration_ms: number;
  errors?: string[];
  notices?: string[];
  message?: string;
};

type RunShopeeSyncOptions = {
  workspaceId: string;
  dateStart?: string | null;
  dateEnd?: string | null;
};

function getYesterdayWib() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  wib.setUTCDate(wib.getUTCDate() - 1);
  return wib.toISOString().slice(0, 10);
}

function toStableAdAccount(shopId: number, streamKey: ShopeeSpendStreamKey) {
  const definition = getShopeeSpendStreamDefinition(streamKey);
  return `Shopee Shop ${shopId} • ${definition.label}`;
}

function normalizeAdvertiser(shop: ShopeeShopRow, stream: ShopeeSpendStreamRow) {
  return String(stream.default_advertiser || '').trim() || shop.shop_name || 'Shopee Shop';
}

function resolveCommerceBusinessCode(shop: ShopeeShopRow) {
  return (
    String(shop.revenue_business_code || '').trim()
    || String(shop.viewer_business_code || '').trim()
    || String(shop.account_business_code || '').trim()
    || null
  );
}

function getMissingShopeeConfigLabels(shop: ShopeeShopRow) {
  const missing: string[] = [];
  if (!String(shop.marketplace_source_key || '').trim()) missing.push('commerce source');
  return missing;
}

function shouldRefreshToken(tokenExpiresAt: string | null | undefined) {
  if (!tokenExpiresAt) return true;
  const expiresAt = Date.parse(tokenExpiresAt);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= Date.now() + 15 * 60 * 1000;
}

async function ensureUsableToken(
  token: ShopeeTokenRow,
  shop: ShopeeShopRow,
  workspaceId: string,
) {
  if (!shouldRefreshToken(token.token_expires_at)) {
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenExpiresAt: token.token_expires_at,
    };
  }

  const refreshed = await refreshShopeeAccessToken({
    refreshToken: token.refresh_token,
    shopId: shop.shop_id,
  });

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('shopee_shop_tokens')
    .update({
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      token_expires_at: refreshed.tokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('shop_config_id', shop.id)
    .eq('workspace_id', workspaceId);

  if (error) {
    throw new Error(`Gagal menyimpan refresh token Shopee untuk ${shop.shop_name}: ${error.message}`);
  }

  return {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    tokenExpiresAt: refreshed.tokenExpiresAt,
  };
}

function buildMetricsRows(shop: ShopeeShopRow, stream: ShopeeSpendStreamRow, points: ShopeeAdsPerformancePoint[]) {
  const advertiser = normalizeAdvertiser(shop, stream);
  const source = getShopeeSpendStreamDefinition(stream.stream_key).defaultSource;
  const businessCode = resolveCommerceBusinessCode(shop);

  return points.map((point) => ({
    shop_config_id: shop.id,
    spend_stream_key: stream.stream_key,
    metric_date: point.date,
    shop_id: shop.shop_id,
    shop_name: shop.shop_name,
    region: shop.region,
    marketplace_source_key: shop.marketplace_source_key,
    account_business_code: String(shop.account_business_code || '').trim() || businessCode,
    viewer_business_code: String(shop.viewer_business_code || '').trim() || businessCode,
    revenue_business_code: String(shop.revenue_business_code || '').trim() || businessCode,
    default_owner_business_code: String(shop.default_owner_business_code || '').trim() || null,
    default_processor_business_code: String(shop.default_processor_business_code || '').trim() || null,
    store: null,
    source,
    advertiser,
    impressions: point.impression,
    clicks: point.clicks,
    ctr: point.ctr,
    direct_order: point.direct_order,
    broad_order: point.broad_order,
    direct_item_sold: point.direct_item_sold,
    broad_item_sold: point.broad_item_sold,
    direct_gmv: point.direct_gmv,
    broad_gmv: point.broad_gmv,
    expense: point.expense,
    cost_per_conversion: point.cost_per_conversion,
    direct_roas: point.direct_roas,
    broad_roas: point.broad_roas,
    raw_payload: point,
    updated_at: new Date().toISOString(),
  }));
}

function buildSpendRows(shop: ShopeeShopRow, stream: ShopeeSpendStreamRow, points: ShopeeAdsPerformancePoint[]) {
  const advertiser = normalizeAdvertiser(shop, stream);
  const streamDefinition = getShopeeSpendStreamDefinition(stream.stream_key);
  const source = streamDefinition.defaultSource;
  const dataSource = getShopeeApiDataSourceForStream(stream.stream_key);
  const objective = 'Shopee CPC Ads';
  const businessCode = resolveCommerceBusinessCode(shop);

  return points
    .filter((point) => point.expense > 0 || point.impression > 0)
    .map((point) => ({
      date: point.date,
      ad_account: toStableAdAccount(shop.shop_id, stream.stream_key),
      spent: point.expense,
      impressions: point.impression,
      cpm: point.impression > 0 ? (point.expense / point.impression) * 1000 : 0,
      objective,
      source,
      store: null,
      advertiser,
      business_code: businessCode,
      data_source: dataSource,
    }));
}

function toIsoTimestamp(value: number | null | undefined) {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function buildProductCampaignRows(
  shop: ShopeeShopRow,
  settings: ShopeeProductCampaignSetting[],
  workspaceId: string,
) {
  const now = new Date().toISOString();

  return settings.map((setting) => {
    const common = setting.common_info || {};
    const target = Number(setting.auto_bidding_info?.roas_target || 0);

    return {
      workspace_id: workspaceId,
      shop_config_id: shop.id,
      shop_id: shop.shop_id,
      shop_name: shop.shop_name,
      campaign_id: setting.campaign_id,
      campaign_type: 'product',
      ad_type: common.ad_type || null,
      ad_name: common.ad_name || '',
      campaign_status: common.campaign_status || null,
      bidding_method: common.bidding_method || null,
      campaign_placement: common.campaign_placement || null,
      campaign_budget: Number(common.campaign_budget || 0),
      roas_target: target > 0 ? target : null,
      start_at: toIsoTimestamp(common.campaign_duration?.start_time),
      end_at: toIsoTimestamp(common.campaign_duration?.end_time),
      item_ids: common.item_id_list || [],
      products: setting.auto_product_ads_info || [],
      selected_keywords: setting.manual_bidding_info?.selected_keywords || [],
      raw_setting: setting,
      last_seen_at: now,
      updated_at: now,
    };
  });
}

function buildProductCampaignMetricRows(
  shop: ShopeeShopRow,
  points: ShopeeProductCampaignPerformancePoint[],
  workspaceId: string,
) {
  const now = new Date().toISOString();

  return points.map((point) => ({
    workspace_id: workspaceId,
    shop_config_id: shop.id,
    shop_id: shop.shop_id,
    campaign_id: point.campaign_id,
    campaign_type: 'product',
    metric_date: point.date,
    ad_type: point.ad_type || null,
    ad_name: point.ad_name || '',
    campaign_placement: point.campaign_placement || null,
    impressions: point.impression,
    clicks: point.clicks,
    ctr: point.ctr,
    expense: point.expense,
    broad_gmv: point.broad_gmv,
    broad_order: point.broad_order,
    broad_order_amount: point.broad_order_amount,
    broad_roas: point.broad_roi,
    broad_acos: point.broad_cir,
    conversion_rate: point.cr,
    cost_per_conversion: point.cpc,
    direct_gmv: point.direct_gmv,
    direct_order: point.direct_order,
    direct_order_amount: point.direct_order_amount,
    direct_roas: point.direct_roi,
    direct_acos: point.direct_cir,
    direct_conversion_rate: point.direct_cr,
    cost_per_direct_conversion: point.cpdc,
    raw_payload: point,
    updated_at: now,
  }));
}

function mapGmsReport(report: ShopeeGmsReport) {
  return {
    impressions: report.impression,
    clicks: report.clicks,
    expense: report.expense,
    broad_gmv: report.broad_gmv,
    broad_order: report.broad_order,
    broad_order_amount: report.broad_order_amount,
    broad_roas: report.broad_roi,
    broad_acos: report.broad_cir,
    conversion_rate: report.cr,
    cost_per_conversion: report.cpc,
    direct_order: report.direct_order,
    direct_order_amount: report.direct_order_amount,
    direct_roas: report.direct_roi,
    direct_acos: report.direct_cir,
    direct_conversion_rate: report.direct_cr,
    cost_per_direct_conversion: report.cpdc,
  };
}

const MAX_GMS_SNAPSHOT_RPC_BYTES = 5_500_000;

export function buildGmsSnapshotRpcPayload(
  campaignRows: Array<Record<string, any>>,
  itemRows: Array<Record<string, any>>,
) {
  const compactRow = (row: Record<string, any>) => ({
    campaign_id: row.campaign_id,
    ...('item_id' in row ? { item_id: row.item_id } : {}),
    impressions: row.impressions,
    clicks: row.clicks,
    expense: row.expense,
    broad_gmv: row.broad_gmv,
    broad_order: row.broad_order,
    broad_order_amount: row.broad_order_amount,
    broad_roas: row.broad_roas,
    broad_acos: row.broad_acos,
    conversion_rate: row.conversion_rate,
    cost_per_conversion: row.cost_per_conversion,
    direct_order: row.direct_order,
    direct_order_amount: row.direct_order_amount,
    direct_roas: row.direct_roas,
    direct_acos: row.direct_acos,
    direct_conversion_rate: row.direct_conversion_rate,
    cost_per_direct_conversion: row.cost_per_direct_conversion,
    raw_payload: {
      source_api: row.raw_payload?.source_api,
      chunk_count: row.raw_payload?.chunk_count,
    },
  });
  const payload = {
    campaignRows: campaignRows.map(compactRow),
    itemRows: itemRows.map(compactRow),
  };
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (bytes > MAX_GMS_SNAPSHOT_RPC_BYTES) {
    throw new Error(
      `Snapshot Shop GMV Max terlalu besar untuk dipublikasikan dengan aman (${bytes} bytes).`,
    );
  }
  return payload;
}

export function buildGmsCampaignPeriodRows(input: {
  shop: Pick<ShopeeShopRow, 'id' | 'shop_id'>;
  workspaceId: string;
  snapshots: ShopeeGmsPeriodPerformance[];
  syncBatchId: string;
}) {
  const now = new Date().toISOString();
  return input.snapshots.map((snapshot) => ({
    workspace_id: input.workspaceId,
    shop_config_id: input.shop.id,
    shop_id: input.shop.shop_id,
    campaign_id: snapshot.campaign_id,
    period_start: snapshot.period_start,
    period_end: snapshot.period_end,
    ...mapGmsReport(snapshot.report),
    raw_payload: {
      source_api: 'v2.ads.get_gms_campaign_performance',
      report: snapshot.report,
      chunk_count: snapshot.report_chunks.length,
    },
    sync_batch_id: input.syncBatchId,
    updated_at: now,
  }));
}

export function buildGmsItemPeriodRows(input: {
  shop: Pick<ShopeeShopRow, 'id' | 'shop_id'>;
  workspaceId: string;
  snapshots: ShopeeGmsPeriodPerformance[];
  syncBatchId: string;
}) {
  const now = new Date().toISOString();
  return input.snapshots.flatMap((snapshot) => snapshot.items.map((item) => ({
    workspace_id: input.workspaceId,
    shop_config_id: input.shop.id,
    shop_id: input.shop.shop_id,
    campaign_id: snapshot.campaign_id,
    item_id: item.item_id,
    period_start: snapshot.period_start,
    period_end: snapshot.period_end,
    ...mapGmsReport(item.report),
    raw_payload: {
      source_api: 'v2.ads.get_gms_item_performance',
      report: item.report,
      chunk_count: item.report_chunks.length,
    },
    sync_batch_id: input.syncBatchId,
    updated_at: now,
  })));
}

async function syncGmsPeriodDetails(input: {
  accessToken: string;
  shop: ShopeeShopRow;
  workspaceId: string;
  dateStart: string;
  dateEnd: string;
}) {
  const result = await fetchShopeeGmsPerformanceRange({
    accessToken: input.accessToken,
    shopId: input.shop.shop_id,
    dateStart: input.dateStart,
    dateEnd: input.dateEnd,
  });
  if (result.status === 'range_unavailable' || result.status === 'not_whitelisted') {
    return { rowsInserted: 0, status: result.status };
  }

  if (result.status === 'no_campaign') {
    const svc = createServiceSupabase();
    const { error } = await svc.rpc('clear_shopee_gms_period_snapshot', {
      p_workspace_id: input.workspaceId,
      p_shop_config_id: input.shop.id,
      p_shop_id: input.shop.shop_id,
      p_period_start: input.dateStart,
      p_period_end: input.dateEnd,
    });
    if (error) {
      throw new Error(`Clear Shop GMV Max snapshot: ${error.message}`);
    }
    return { rowsInserted: 0, status: result.status };
  }

  const snapshots = result.snapshots;
  const syncBatchId = randomUUID();
  const campaignRows = buildGmsCampaignPeriodRows({
    shop: input.shop,
    workspaceId: input.workspaceId,
    snapshots,
    syncBatchId,
  });
  const itemRows = buildGmsItemPeriodRows({
    shop: input.shop,
    workspaceId: input.workspaceId,
    snapshots,
    syncBatchId,
  });
  const rpcPayload = buildGmsSnapshotRpcPayload(campaignRows, itemRows);

  // Replace the exact-period campaign and item snapshot in one database
  // transaction. A failed request leaves the previously published snapshot
  // intact instead of exposing a partial set of item rows.
  const svc = createServiceSupabase();
  const { data: replacedRows, error } = await svc.rpc(
    'replace_shopee_gms_period_snapshot',
    {
      p_workspace_id: input.workspaceId,
      p_shop_config_id: input.shop.id,
      p_shop_id: input.shop.shop_id,
      p_period_start: input.dateStart,
      p_period_end: input.dateEnd,
      p_sync_batch_id: syncBatchId,
      p_campaign_rows: rpcPayload.campaignRows,
      p_item_rows: rpcPayload.itemRows,
    },
  );
  if (error) {
    throw new Error(`Replace Shop GMV Max snapshot: ${error.message}`);
  }

  return { rowsInserted: Number(replacedRows || 0), status: result.status };
}

async function syncProductCampaignDetails(input: {
  accessToken: string;
  shop: ShopeeShopRow;
  workspaceId: string;
  dateStart: string;
  dateEnd: string;
}) {
  const svc = createServiceSupabase();
  const campaignRefs = await getShopeeProductCampaignRefs({
    accessToken: input.accessToken,
    shopId: input.shop.shop_id,
  });
  const campaignIds = campaignRefs.map((campaign) => campaign.campaign_id);

  const [settings, performance] = await Promise.all([
    getShopeeProductCampaignSettings({
      accessToken: input.accessToken,
      shopId: input.shop.shop_id,
      campaignIds,
    }),
    fetchShopeeProductCampaignPerformanceRange({
      accessToken: input.accessToken,
      shopId: input.shop.shop_id,
      campaignIds,
      dateStart: input.dateStart,
      dateEnd: input.dateEnd,
    }),
  ]);

  const campaignRows = buildProductCampaignRows(input.shop, settings, input.workspaceId);
  const metricRows = buildProductCampaignMetricRows(input.shop, performance, input.workspaceId);

  if (campaignRows.length > 0) {
    const { error: upsertError } = await svc
      .from('shopee_ad_campaigns')
      .upsert(campaignRows, {
        onConflict: 'workspace_id,shop_config_id,campaign_type,campaign_id',
      });
    if (upsertError) {
      throw new Error(`Upsert shopee_ad_campaigns: ${upsertError.message}`);
    }
  }

  const { error: deleteMetricsError } = await svc
    .from('shopee_ad_campaign_daily_metrics')
    .delete()
    .eq('workspace_id', input.workspaceId)
    .eq('shop_config_id', input.shop.id)
    .eq('campaign_type', 'product')
    .gte('metric_date', input.dateStart)
    .lte('metric_date', input.dateEnd);
  if (deleteMetricsError) {
    throw new Error(`Delete shopee_ad_campaign_daily_metrics: ${deleteMetricsError.message}`);
  }

  await insertInBatches('shopee_ad_campaign_daily_metrics', metricRows);
  return campaignRows.length + metricRows.length;
}

async function insertInBatches(
  table: string,
  rows: Record<string, unknown>[],
  batchSize = 500,
) {
  if (rows.length === 0) return;
  const svc = createServiceSupabase();

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await svc.from(table).insert(batch);
    if (error) {
      throw new Error(`Insert ${table} batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
    }
  }
}

export async function runShopeeSync(options: RunShopeeSyncOptions): Promise<ShopeeSyncResult> {
  const startTime = Date.now();
  const svc = createServiceSupabase();
  const workspaceId = requireExplicitWorkspaceId(options.workspaceId, 'Shopee sync');
  const dateStart = options.dateStart || getYesterdayWib();
  const dateEnd = options.dateEnd || dateStart;

  const [shopsRes, tokensRes] = await Promise.all([
    svc.from('shopee_shops').select('*').eq('workspace_id', workspaceId).eq('is_active', true).order('shop_name'),
    svc.from('shopee_shop_tokens').select('shop_config_id, access_token, refresh_token, token_expires_at').eq('workspace_id', workspaceId),
  ]);

  if (shopsRes.error) throw shopsRes.error;
  if (tokensRes.error) throw tokensRes.error;

  const shops = (shopsRes.data || []) as ShopeeShopRow[];
  const tokenMap = new Map<number, ShopeeTokenRow>(
    ((tokensRes.data || []) as ShopeeTokenRow[]).map((row) => [row.shop_config_id, row]),
  );
  const { data: rawStreamRows, error: streamError } = await svc
    .from('shopee_shop_spend_streams')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('sync_mode', 'api')
    .eq('is_enabled', true)
    .order('shop_config_id')
    .order('stream_key');

  if (streamError) throw streamError;

  const streamsByShopId = new Map<number, ShopeeSpendStreamRow[]>();
  for (const row of ((rawStreamRows || []) as Array<ShopeeSpendStreamRow & { stream_key: string }>).filter((item) => isShopeeSpendStreamKey(item.stream_key))) {
    if (!streamsByShopId.has(row.shop_config_id)) {
      streamsByShopId.set(row.shop_config_id, []);
    }
    streamsByShopId.get(row.shop_config_id)!.push(row);
  }

  if (shops.length === 0) {
    return {
      success: true,
      status: 'success',
      shops_synced: 0,
      shops_total: 0,
      rows_inserted: 0,
      spend_total: 0,
      direct_gmv_total: 0,
      broad_gmv_total: 0,
      date_range: { start: dateStart, end: dateEnd },
      duration_ms: Date.now() - startTime,
      message: 'Belum ada shop Shopee aktif yang terhubung.',
    };
  }

  let logId: number | null = null;
  const { data: logEntry, error: logError } = await svc
    .from('shopee_sync_log')
    .insert({
      workspace_id: workspaceId,
      sync_date: new Date().toISOString().slice(0, 10),
      date_range_start: dateStart,
      date_range_end: dateEnd,
      status: 'running',
    })
    .select('id')
    .single();

  if (logError) {
    console.error('[shopee-sync] Failed to create log entry:', logError);
  }
  logId = logEntry?.id ?? null;

  try {
    const errors: string[] = [];
    let shopsSynced = 0;
    let rowsInserted = 0;
    let spendTotal = 0;
    let directGmvTotal = 0;
    let broadGmvTotal = 0;
    const notices: string[] = [];

    for (const shop of shops) {
      const missingConfig = getMissingShopeeConfigLabels(shop);
      if (missingConfig.length > 0) {
        errors.push(`${shop.shop_name}: konfigurasi Shopee belum lengkap (${missingConfig.join(', ')}).`);
        continue;
      }

      const apiStreams = streamsByShopId.get(shop.id) || [];
      if (apiStreams.length === 0) {
        errors.push(`${shop.shop_name}: belum ada spend stream mode API yang aktif.`);
        continue;
      }

      const token = tokenMap.get(shop.id);
      if (!token?.access_token || !token?.refresh_token) {
        errors.push(`${shop.shop_name}: token Shopee belum lengkap. Reconnect shop diperlukan.`);
        continue;
      }

      try {
        const usableToken = await ensureUsableToken(token, shop, workspaceId);
        let shopHadSuccess = false;

        for (const stream of apiStreams) {
          const points = await fetchShopeeAdsPerformanceRange({
            accessToken: usableToken.accessToken,
            shopId: shop.shop_id,
            dateStart,
            dateEnd,
          });

          const metricsRows = buildMetricsRows(shop, stream, points)
            .map((row) => ({ ...row, workspace_id: workspaceId }));
          const spendRows = buildSpendRows(shop, stream, points)
            .map((row) => ({ ...row, workspace_id: workspaceId }));
          const advertiser = normalizeAdvertiser(shop, stream);
          const source = getShopeeSpendStreamDefinition(stream.stream_key).defaultSource;
          const apiDataSource = getShopeeApiDataSourceForStream(stream.stream_key);

          const { error: deleteMetricsError } = await svc
            .from('shopee_ads_daily_metrics')
            .delete()
            .eq('workspace_id', workspaceId)
            .eq('shop_config_id', shop.id)
            .eq('spend_stream_key', stream.stream_key)
            .gte('metric_date', dateStart)
            .lte('metric_date', dateEnd);

          if (deleteMetricsError) {
            throw new Error(`Delete shopee_ads_daily_metrics: ${deleteMetricsError.message}`);
          }

          const { error: deleteSpendError } = await svc
            .from('daily_ads_spend')
            .delete()
            .eq('workspace_id', workspaceId)
            .in('data_source', ['google_sheets', 'xlsx_upload', apiDataSource])
            .eq('source', source)
            .eq('advertiser', advertiser)
            .gte('date', dateStart)
            .lte('date', dateEnd);

          if (deleteSpendError) {
            throw new Error(`Delete daily_ads_spend Shopee: ${deleteSpendError.message}`);
          }

          await insertInBatches('shopee_ads_daily_metrics', metricsRows);
          await insertInBatches('daily_ads_spend', spendRows);

          rowsInserted += metricsRows.length;
          spendTotal += metricsRows.reduce((sum, row) => sum + Number(row.expense || 0), 0);
          directGmvTotal += metricsRows.reduce((sum, row) => sum + Number(row.direct_gmv || 0), 0);
          broadGmvTotal += metricsRows.reduce((sum, row) => sum + Number(row.broad_gmv || 0), 0);
          shopHadSuccess = true;
        }

        if (shopHadSuccess) {
          try {
            rowsInserted += await syncProductCampaignDetails({
              accessToken: usableToken.accessToken,
              shop,
              workspaceId,
              dateStart,
              dateEnd,
            });
          } catch (campaignError: any) {
            errors.push(`${shop.shop_name}: detail campaign Shopee tidak tersinkron (${campaignError.message || 'request gagal'}).`);
          }
        }

        if (shopHadSuccess) {
          try {
            const gmsResult = await syncGmsPeriodDetails({
              accessToken: usableToken.accessToken,
              shop,
              workspaceId,
              dateStart,
              dateEnd,
            });
            rowsInserted += gmsResult.rowsInserted;
            if (gmsResult.status === 'range_unavailable') {
              notices.push(`${shop.shop_name}: Shop GMV Max memerlukan rentang minimal dua hari.`);
            } else if (gmsResult.status === 'not_whitelisted') {
              notices.push(`${shop.shop_name}: Shop GMV Max belum tersedia untuk shop ini di Shopee API.`);
            } else if (gmsResult.status === 'no_campaign') {
              notices.push(`${shop.shop_name}: tidak ada campaign Shop GMV Max pada rentang ini.`);
            }
          } catch (gmsError: any) {
            errors.push(`${shop.shop_name}: Shop GMV Max tidak tersinkron (${gmsError.message || 'request gagal'}).`);
          }
        }

        if (shopHadSuccess) {
          shopsSynced += 1;
        }
      } catch (error: any) {
        errors.push(`${shop.shop_name}: ${error.message || 'Sync Shopee gagal.'}`);
      }
    }

    const duration = Date.now() - startTime;
    const status: ShopeeSyncResult['status'] = errors.length === 0
      ? 'success'
      : shopsSynced > 0
        ? 'partial'
        : 'failed';

    if (logId) {
      await svc
        .from('shopee_sync_log')
        .update({
          shops_synced: shopsSynced,
          rows_inserted: rowsInserted,
          spend_total: spendTotal,
          direct_gmv_total: directGmvTotal,
          broad_gmv_total: broadGmvTotal,
          status,
          error_message: errors.length > 0 ? errors.join('; ') : null,
          duration_ms: duration,
        })
        .eq('id', logId)
        .eq('workspace_id', workspaceId);
    }

    return {
      success: status !== 'failed',
      status,
      shops_synced: shopsSynced,
      shops_total: shops.length,
      rows_inserted: rowsInserted,
      spend_total: spendTotal,
      direct_gmv_total: directGmvTotal,
      broad_gmv_total: broadGmvTotal,
      date_range: { start: dateStart, end: dateEnd },
      duration_ms: duration,
      errors: errors.length > 0 ? errors : undefined,
      notices: notices.length > 0 ? notices : undefined,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const payload = {
      workspace_id: workspaceId,
      sync_date: new Date().toISOString().slice(0, 10),
      date_range_start: dateStart,
      date_range_end: dateEnd,
      status: 'failed',
      error_message: error.message,
      duration_ms: duration,
    };

    try {
      if (logId) {
        await svc
          .from('shopee_sync_log')
          .update(payload)
          .eq('id', logId)
          .eq('workspace_id', workspaceId);
      } else {
        await svc.from('shopee_sync_log').insert(payload);
      }
    } catch {}

    throw error;
  }
}
