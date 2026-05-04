import { createServiceSupabase } from './service-supabase';
import {
  fetchShopeeAdsPerformanceRange,
  refreshShopeeAccessToken,
  type ShopeeAdsPerformancePoint,
} from './shopee-open-platform';

type ShopeeShopRow = {
  id: number;
  shop_id: number;
  shop_name: string;
  region: string | null;
  store: string | null;
  default_source: string;
  default_advertiser: string;
  is_active: boolean;
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
  message?: string;
};

type RunShopeeSyncOptions = {
  dateStart?: string | null;
  dateEnd?: string | null;
};

function getYesterdayWib() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  wib.setUTCDate(wib.getUTCDate() - 1);
  return wib.toISOString().slice(0, 10);
}

function toStableAdAccount(shopId: number) {
  return `Shopee Shop ${shopId}`;
}

function normalizeAdvertiser(shop: ShopeeShopRow) {
  return String(shop.default_advertiser || '').trim() || shop.shop_name || 'Shopee Shop';
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
    .eq('shop_config_id', shop.id);

  if (error) {
    throw new Error(`Gagal menyimpan refresh token Shopee untuk ${shop.shop_name}: ${error.message}`);
  }

  return {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    tokenExpiresAt: refreshed.tokenExpiresAt,
  };
}

function buildMetricsRows(shop: ShopeeShopRow, points: ShopeeAdsPerformancePoint[]) {
  const advertiser = normalizeAdvertiser(shop);
  const source = String(shop.default_source || '').trim() || 'Shopee Ads';

  return points.map((point) => ({
    shop_config_id: shop.id,
    metric_date: point.date,
    shop_id: shop.shop_id,
    shop_name: shop.shop_name,
    region: shop.region,
    store: shop.store,
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

function buildSpendRows(shop: ShopeeShopRow, points: ShopeeAdsPerformancePoint[]) {
  const advertiser = normalizeAdvertiser(shop);
  const source = String(shop.default_source || '').trim() || 'Shopee Ads';

  return points
    .filter((point) => point.expense > 0 || point.impression > 0)
    .map((point) => ({
      date: point.date,
      ad_account: toStableAdAccount(shop.shop_id),
      spent: point.expense,
      impressions: point.impression,
      cpm: point.impression > 0 ? (point.expense / point.impression) * 1000 : 0,
      objective: 'Shopee CPC Ads',
      source,
      store: shop.store,
      advertiser,
      data_source: 'shopee_ads_api',
    }));
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

export async function runShopeeSync(options: RunShopeeSyncOptions = {}): Promise<ShopeeSyncResult> {
  const startTime = Date.now();
  const svc = createServiceSupabase();
  const dateStart = options.dateStart || getYesterdayWib();
  const dateEnd = options.dateEnd || dateStart;

  const [shopsRes, tokensRes] = await Promise.all([
    svc.from('shopee_shops').select('*').eq('is_active', true).order('shop_name'),
    svc.from('shopee_shop_tokens').select('shop_config_id, access_token, refresh_token, token_expires_at'),
  ]);

  if (shopsRes.error) throw shopsRes.error;
  if (tokensRes.error) throw tokensRes.error;

  const shops = (shopsRes.data || []) as ShopeeShopRow[];
  const tokenMap = new Map<number, ShopeeTokenRow>(
    ((tokensRes.data || []) as ShopeeTokenRow[]).map((row) => [row.shop_config_id, row]),
  );

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

    for (const shop of shops) {
      if (!String(shop.store || '').trim()) {
        errors.push(`${shop.shop_name}: brand mapping Shopee belum diisi.`);
        continue;
      }

      const token = tokenMap.get(shop.id);
      if (!token?.access_token || !token?.refresh_token) {
        errors.push(`${shop.shop_name}: token Shopee belum lengkap. Reconnect shop diperlukan.`);
        continue;
      }

      try {
        const usableToken = await ensureUsableToken(token, shop);
        const points = await fetchShopeeAdsPerformanceRange({
          accessToken: usableToken.accessToken,
          shopId: shop.shop_id,
          dateStart,
          dateEnd,
        });

        const metricsRows = buildMetricsRows(shop, points);
        const spendRows = buildSpendRows(shop, points);

        const { error: deleteMetricsError } = await svc
          .from('shopee_ads_daily_metrics')
          .delete()
          .eq('shop_config_id', shop.id)
          .gte('metric_date', dateStart)
          .lte('metric_date', dateEnd);

        if (deleteMetricsError) {
          throw new Error(`Delete shopee_ads_daily_metrics: ${deleteMetricsError.message}`);
        }

        const { error: deleteSpendError } = await svc
          .from('daily_ads_spend')
          .delete()
          .eq('data_source', 'shopee_ads_api')
          .eq('ad_account', toStableAdAccount(shop.shop_id))
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
        shopsSynced += 1;
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
        .eq('id', logId);
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
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const payload = {
      sync_date: new Date().toISOString().slice(0, 10),
      date_range_start: dateStart,
      date_range_end: dateEnd,
      status: 'failed',
      error_message: error.message,
      duration_ms: duration,
    };

    try {
      if (logId) {
        await svc.from('shopee_sync_log').update(payload).eq('id', logId);
      } else {
        await svc.from('shopee_sync_log').insert(payload);
      }
    } catch {}

    throw error;
  }
}
