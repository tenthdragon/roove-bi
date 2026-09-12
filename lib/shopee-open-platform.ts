import crypto from 'crypto';
import { buildPublicSiteUrl } from './site-config';

const DEFAULT_SHOPEE_AUTH_BASE_URL = 'https://open.shopee.com';
const DEFAULT_SHOPEE_API_BASE_URL = 'https://partner.shopeemobile.com';
const SHOPEE_CALLBACK_PATH = '/api/shopee/callback';
export const SHOPEE_OAUTH_STATE_COOKIE = 'shopee_oauth_state';

type ShopeeAuthContext =
  | { accessToken: string; shopId: number | string; merchantId?: never }
  | { accessToken: string; merchantId: number | string; shopId?: never }
  | undefined;

type ShopeeEnvelope<T> = {
  error?: string;
  message?: string;
  warning?: string;
  request_id?: string;
  response?: T;
};

type ShopeeApiResponse<TResponse, TExtra extends object = Record<string, never>> =
  ShopeeEnvelope<TResponse> & TExtra;

export class ShopeeApiError extends Error {
  readonly code: string;
  readonly requestId: string | null;

  constructor(input: {
    label: string;
    code: string;
    message: string;
    requestId?: string | null;
  }) {
    super(`${input.label}: ${input.message || input.code || 'request gagal'}`);
    this.name = 'ShopeeApiError';
    this.code = input.code.trim();
    this.requestId = input.requestId || null;
  }
}

const GMS_NOT_WHITELISTED_ERROR = 'ads_error_not_whitelisted_for_product_gms';
const GMS_CAMPAIGN_NOT_FOUND_ERROR = 'ads_error_product_gms_campaign_not_found';

export function getShopeeApiErrorCode(error: unknown) {
  return error instanceof ShopeeApiError
    ? error.code.trim()
    : String((error as { code?: unknown } | null)?.code || '').trim();
}

export function isShopeeGmsUnavailableError(error: unknown) {
  const code = getShopeeApiErrorCode(error);
  return code === GMS_NOT_WHITELISTED_ERROR || code === GMS_CAMPAIGN_NOT_FOUND_ERROR;
}

export type ShopeeSetupInfo = {
  configured: boolean;
  missingEnv: string[];
};

export type ShopeeTokenPayload = {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  request_id?: string;
};

export type ShopeeShopInfo = {
  shop_name: string;
  region?: string | null;
  status?: string | null;
  merchant_id?: number | null;
  is_cb?: boolean;
  auth_time?: number | null;
  expire_time?: number | null;
};

export type ShopeeAdsPerformancePoint = {
  date: string;
  impression: number;
  clicks: number;
  ctr: number;
  direct_order: number;
  broad_order: number;
  direct_item_sold: number;
  broad_item_sold: number;
  direct_gmv: number;
  broad_gmv: number;
  expense: number;
  cost_per_conversion: number;
  direct_roas: number;
  broad_roas: number;
};

export type ShopeeProductCampaignRef = {
  campaign_id: number;
  ad_type: string;
};

export type ShopeeProductCampaignKeyword = {
  keyword: string;
  status: string;
  match_type: string;
  bid_price_per_click: number;
};

export type ShopeeProductCampaignProduct = {
  item_id: number;
  product_name: string;
  status: string;
};

export type ShopeeProductCampaignSetting = {
  campaign_id: number;
  common_info: {
    ad_type?: string;
    ad_name?: string;
    campaign_status?: string;
    bidding_method?: string;
    campaign_placement?: string;
    campaign_budget?: number;
    campaign_duration?: {
      start_time?: number;
      end_time?: number;
    };
    item_id_list?: number[];
  };
  manual_bidding_info?: {
    enhanced_cpc?: boolean;
    selected_keywords?: ShopeeProductCampaignKeyword[];
    discovery_ads_locations?: unknown[];
  };
  auto_bidding_info?: {
    roas_target?: number;
  };
  auto_product_ads_info?: ShopeeProductCampaignProduct[];
};

export type ShopeeProductCampaignPerformancePoint = {
  campaign_id: number;
  ad_type: string;
  campaign_placement: string;
  ad_name: string;
  date: string;
  impression: number;
  clicks: number;
  ctr: number;
  expense: number;
  broad_gmv: number;
  broad_order: number;
  broad_order_amount: number;
  broad_roi: number;
  broad_cir: number;
  cr: number;
  cpc: number;
  direct_gmv: number;
  direct_order: number;
  direct_order_amount: number;
  direct_roi: number;
  direct_cir: number;
  direct_cr: number;
  cpdc: number;
};

export type ShopeeGmsReport = {
  impression: number;
  clicks: number;
  expense: number;
  broad_gmv: number;
  broad_order: number;
  broad_order_amount: number;
  broad_roi: number;
  broad_cir: number;
  cr: number;
  cpc: number;
  direct_order: number;
  direct_order_amount: number;
  direct_roi: number;
  direct_cir: number;
  direct_cr: number;
  cpdc: number;
};

export type ShopeeGmsCampaignPerformance = {
  campaign_id: number;
  report: ShopeeGmsReport;
};

export type ShopeeGmsItemPerformance = {
  item_id: number;
  report: ShopeeGmsReport;
};

export type ShopeeGmsPeriodPerformance = {
  campaign_id: number;
  period_start: string;
  period_end: string;
  report: ShopeeGmsReport;
  report_chunks: Array<{
    period_start: string;
    period_end: string;
    report: ShopeeGmsReport;
  }>;
  items: Array<ShopeeGmsItemPerformance & {
    report_chunks: Array<{
      period_start: string;
      period_end: string;
      report: ShopeeGmsReport;
    }>;
  }>;
};

export type ShopeeGmsFetchResult = {
  status: 'ok' | 'range_unavailable' | 'not_whitelisted' | 'no_campaign' | 'sandbox_unavailable';
  snapshots: ShopeeGmsPeriodPerformance[];
};

const SHOPEE_GMS_REPORT_FIELDS = [
  'impression',
  'clicks',
  'expense',
  'broad_gmv',
  'broad_order',
  'broad_order_amount',
  'broad_roi',
  'broad_cir',
  'cr',
  'cpc',
  'direct_order',
  'direct_order_amount',
  'direct_roi',
  'direct_cir',
  'direct_cr',
  'cpdc',
] as const;

const SHOPEE_GMS_COUNT_FIELDS = new Set<string>([
  'clicks',
  'broad_order',
  'broad_order_amount',
  'direct_order',
  'direct_order_amount',
]);

type ShopeeAdsHourlyPoint = ShopeeAdsPerformancePoint & {
  hour?: number;
};

type ShopeeConfig = {
  partnerId: string;
  partnerKey: string;
  redirectUrl: string;
  authBaseUrl: string;
  apiBaseUrl: string;
};

function cleanUrl(value: string) {
  return value.replace(/\/$/, '');
}

function stripWrappingQuotes(value: string) {
  if (value.length >= 2) {
    const startsWithDouble = value.startsWith('"') && value.endsWith('"');
    const startsWithSingle = value.startsWith("'") && value.endsWith("'");
    if (startsWithDouble || startsWithSingle) {
      return value.slice(1, -1).trim();
    }
  }

  return value;
}

function readEnvText(name: string) {
  const raw = String(process.env[name] || '').trim();
  const wrapped =
    raw.length >= 2 &&
    ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")));

  return {
    raw,
    wrapped,
    value: stripWrappingQuotes(raw),
  };
}

function getRedirectUrl() {
  return readEnvText('SHOPEE_REDIRECT_URL').value || buildPublicSiteUrl(SHOPEE_CALLBACK_PATH);
}

function getAuthBaseUrl() {
  return cleanUrl(readEnvText('SHOPEE_AUTH_BASE_URL').value || DEFAULT_SHOPEE_AUTH_BASE_URL);
}

function getApiBaseUrl() {
  return cleanUrl(readEnvText('SHOPEE_API_BASE_URL').value || DEFAULT_SHOPEE_API_BASE_URL);
}

function usesShopeeSandboxApi() {
  try {
    return new URL(getApiBaseUrl()).hostname === 'partner.test-stable.shopeemobile.com';
  } catch {
    return false;
  }
}

export function getShopeeSetupInfo(): ShopeeSetupInfo {
  const partnerId = readEnvText('SHOPEE_PARTNER_ID');
  const partnerKey = readEnvText('SHOPEE_PARTNER_KEY');
  const missingEnv: string[] = [];
  if (!partnerId.value) missingEnv.push('SHOPEE_PARTNER_ID');
  if (!partnerKey.value) missingEnv.push('SHOPEE_PARTNER_KEY');

  return {
    configured: missingEnv.length === 0,
    missingEnv,
  };
}

function requireShopeeConfig(): ShopeeConfig {
  const setup = getShopeeSetupInfo();
  if (!setup.configured) {
    throw new Error(`Shopee belum dikonfigurasi. Missing env: ${setup.missingEnv.join(', ')}`);
  }

  return {
    partnerId: readEnvText('SHOPEE_PARTNER_ID').value,
    partnerKey: readEnvText('SHOPEE_PARTNER_KEY').value,
    redirectUrl: getRedirectUrl(),
    authBaseUrl: getAuthBaseUrl(),
    apiBaseUrl: getApiBaseUrl(),
  };
}

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function toUnixTimestamp(date: string | Date | null | undefined) {
  if (!date) return null;
  const value = typeof date === 'string' ? Date.parse(date) : date.getTime();
  if (!Number.isFinite(value)) return null;
  return Math.floor(value / 1000);
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseIsoDate(input: string) {
  const [year, month, day] = String(input || '').split('-').map((part) => Number(part));
  if (!year || !month || !day) {
    throw new Error(`Tanggal Shopee tidak valid: ${input}`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatShopeeDate(input: string | Date) {
  const date = typeof input === 'string' ? parseIsoDate(input) : input;
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = String(date.getUTCFullYear());
  return `${day}-${month}-${year}`;
}

function parseShopeeDate(value: string) {
  const [day, month, year] = String(value || '').split('-').map((part) => Number(part));
  if (!day || !month || !year) {
    throw new Error(`Tanggal Shopee tidak valid: ${value}`);
  }
  return formatIsoDate(new Date(Date.UTC(year, month - 1, day)));
}

function buildSignature(
  config: ShopeeConfig,
  path: string,
  timestamp: number,
  auth?: ShopeeAuthContext,
) {
  let base = `${config.partnerId}${path}${timestamp}`;
  if (auth?.accessToken) {
    base += auth.accessToken;
    if ('shopId' in auth && auth.shopId != null) base += String(auth.shopId);
    if ('merchantId' in auth && auth.merchantId != null) base += String(auth.merchantId);
  }

  return crypto
    .createHmac('sha256', config.partnerKey)
    .update(base)
    .digest('hex');
}

function buildSignedUrl(
  path: string,
  extraParams: Record<string, string | number | null | undefined>,
  auth?: ShopeeAuthContext,
  baseUrlOverride?: string,
) {
  const config = requireShopeeConfig();
  const timestamp = nowUnix();
  const params = new URLSearchParams();

  params.set('partner_id', config.partnerId);
  params.set('timestamp', String(timestamp));
  if (auth?.accessToken) params.set('access_token', auth.accessToken);
  if (auth && 'shopId' in auth && auth.shopId != null) params.set('shop_id', String(auth.shopId));
  if (auth && 'merchantId' in auth && auth.merchantId != null) params.set('merchant_id', String(auth.merchantId));

  Object.entries(extraParams).forEach(([key, value]) => {
    if (value == null || value === '') return;
    params.set(key, String(value));
  });

  params.set('sign', buildSignature(config, path, timestamp, auth));

  return `${cleanUrl(baseUrlOverride || config.apiBaseUrl)}${path}?${params.toString()}`;
}

async function parseShopeeResponse<TResponse, TExtra extends object = Record<string, never>>(
  response: Response,
  label: string,
): Promise<ShopeeApiResponse<TResponse, TExtra>> {
  const text = await response.text();
  let json: ShopeeApiResponse<TResponse, TExtra>;

  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label}: respons Shopee tidak bisa diparse`);
  }

  if (!response.ok || json.error) {
    throw new ShopeeApiError({
      label,
      code: String(json.error || `http_${response.status}`),
      message: String(json.message || json.error || `HTTP ${response.status}`),
      requestId: json.request_id || null,
    });
  }

  if (json.warning) {
    console.warn(`[shopee] ${label} warning: ${json.warning}`);
  }

  return json;
}

function aggregateHourlyToDaily(points: ShopeeAdsHourlyPoint[]): ShopeeAdsPerformancePoint[] {
  const byDate = new Map<string, ShopeeAdsPerformancePoint>();

  for (const point of points) {
    const date = point.date;
    const current = byDate.get(date) || {
      date,
      impression: 0,
      clicks: 0,
      ctr: 0,
      direct_order: 0,
      broad_order: 0,
      direct_item_sold: 0,
      broad_item_sold: 0,
      direct_gmv: 0,
      broad_gmv: 0,
      expense: 0,
      cost_per_conversion: 0,
      direct_roas: 0,
      broad_roas: 0,
    };

    current.impression += num(point.impression);
    current.clicks += num(point.clicks);
    current.direct_order += num(point.direct_order);
    current.broad_order += num(point.broad_order);
    current.direct_item_sold += num(point.direct_item_sold);
    current.broad_item_sold += num(point.broad_item_sold);
    current.direct_gmv += num(point.direct_gmv);
    current.broad_gmv += num(point.broad_gmv);
    current.expense += num(point.expense);

    byDate.set(date, current);
  }

  return Array.from(byDate.values())
    .map((point) => ({
      ...point,
      ctr: point.impression > 0 ? (point.clicks / point.impression) * 100 : 0,
      cost_per_conversion: point.direct_order > 0 ? point.expense / point.direct_order : 0,
      direct_roas: point.expense > 0 ? point.direct_gmv / point.expense : 0,
      broad_roas: point.expense > 0 ? point.broad_gmv / point.expense : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function getJson<TResponse, TExtra extends object = Record<string, never>>(url: string, label: string) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  return parseShopeeResponse<TResponse, TExtra>(response, label);
}

async function postJson<TResponse, TExtra extends object = Record<string, never>>(
  url: string,
  payload: Record<string, unknown>,
  label: string,
) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  return parseShopeeResponse<TResponse, TExtra>(response, label);
}

export function buildShopeeShopAuthUrl(input?: { state?: string }) {
  const config = requireShopeeConfig();
  const path = '/auth';
  const params = new URLSearchParams({
    partner_id: config.partnerId,
    auth_type: 'seller',
    redirect_uri: config.redirectUrl,
    response_type: 'code',
  });
  if (input?.state) params.set('state', input.state);

  return `${config.authBaseUrl}${path}?${params.toString()}`;
}

export async function exchangeShopeeAuthCode(input: { code: string; shopId: number | string }) {
  const config = requireShopeeConfig();
  const path = '/api/v2/auth/token/get';
  const url = buildSignedUrl(path, {}, undefined, config.apiBaseUrl);

  const json = await postJson<never, ShopeeTokenPayload>(url, {
    code: input.code,
    partner_id: num(config.partnerId),
    shop_id: num(input.shopId),
  }, 'Shopee get_access_token');

  if (!json.access_token || !json.refresh_token) {
    throw new Error('Shopee tidak mengembalikan access_token/refresh_token');
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expireInSeconds: num(json.expire_in),
    tokenExpiresAt: new Date(Date.now() + Math.max(num(json.expire_in), 0) * 1000).toISOString(),
  };
}

export async function refreshShopeeAccessToken(input: { refreshToken: string; shopId: number | string }) {
  const config = requireShopeeConfig();
  const path = '/api/v2/auth/access_token/get';
  const url = buildSignedUrl(path, {}, undefined, config.apiBaseUrl);

  const json = await postJson<never, ShopeeTokenPayload>(url, {
    refresh_token: input.refreshToken,
    partner_id: num(config.partnerId),
    shop_id: num(input.shopId),
  }, 'Shopee refresh_access_token');

  if (!json.access_token || !json.refresh_token) {
    throw new Error('Shopee tidak mengembalikan token baru');
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expireInSeconds: num(json.expire_in),
    tokenExpiresAt: new Date(Date.now() + Math.max(num(json.expire_in), 0) * 1000).toISOString(),
  };
}

export async function getShopeeShopInfo(input: { accessToken: string; shopId: number | string }) {
  const path = '/api/v2/shop/get_shop_info';
  const url = buildSignedUrl(path, {}, {
    accessToken: input.accessToken,
    shopId: input.shopId,
  });

  return getJson<never, ShopeeShopInfo>(url, 'Shopee get_shop_info');
}

export async function getShopeeAdsDailyPerformance(input: {
  accessToken: string;
  shopId: number | string;
  startDate: string;
  endDate: string;
}) {
  const path = '/api/v2/ads/get_all_cpc_ads_daily_performance';
  const url = buildSignedUrl(path, {
    start_date: formatShopeeDate(input.startDate),
    end_date: formatShopeeDate(input.endDate),
  }, {
    accessToken: input.accessToken,
    shopId: input.shopId,
  });

  const json = await getJson<ShopeeAdsPerformancePoint[]>(url, 'Shopee ads daily performance');
  const rows = Array.isArray(json.response) ? json.response : [];

  return rows
    .map((point) => ({
      ...point,
      date: parseShopeeDate(point.date),
      impression: num(point.impression),
      clicks: num(point.clicks),
      ctr: num(point.ctr),
      direct_order: num(point.direct_order),
      broad_order: num(point.broad_order),
      direct_item_sold: num(point.direct_item_sold),
      broad_item_sold: num(point.broad_item_sold),
      direct_gmv: num(point.direct_gmv),
      broad_gmv: num(point.broad_gmv),
      expense: num(point.expense),
      cost_per_conversion: num(point.cost_per_conversion),
      direct_roas: num(point.direct_roas),
      broad_roas: num(point.broad_roas),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getShopeeAdsHourlyPerformance(input: {
  accessToken: string;
  shopId: number | string;
  performanceDate: string;
}) {
  const path = '/api/v2/ads/get_all_cpc_ads_hourly_performance';
  const url = buildSignedUrl(path, {
    performance_date: formatShopeeDate(input.performanceDate),
  }, {
    accessToken: input.accessToken,
    shopId: input.shopId,
  });

  const json = await getJson<ShopeeAdsHourlyPoint[]>(url, 'Shopee ads hourly performance');
  const rows = Array.isArray(json.response) ? json.response : [];

  return rows.map((point) => ({
    ...point,
    date: parseShopeeDate(point.date),
    impression: num(point.impression),
    clicks: num(point.clicks),
    ctr: num(point.ctr),
    direct_order: num(point.direct_order),
    broad_order: num(point.broad_order),
    direct_item_sold: num(point.direct_item_sold),
    broad_item_sold: num(point.broad_item_sold),
    direct_gmv: num(point.direct_gmv),
    broad_gmv: num(point.broad_gmv),
    expense: num(point.expense),
    cost_per_conversion: num(point.cost_per_conversion),
    direct_roas: num(point.direct_roas),
    broad_roas: num(point.broad_roas),
    hour: num(point.hour),
  }));
}

export async function fetchShopeeAdsPerformanceRange(input: {
  accessToken: string;
  shopId: number | string;
  dateStart: string;
  dateEnd: string;
}) {
  const start = parseIsoDate(input.dateStart);
  const end = parseIsoDate(input.dateEnd);
  if (start.getTime() > end.getTime()) {
    throw new Error('Tanggal mulai Shopee tidak boleh lebih besar dari tanggal akhir.');
  }

  const output: ShopeeAdsPerformancePoint[] = [];
  let cursor = start;

  while (cursor.getTime() <= end.getTime()) {
    const chunkEnd = new Date(Math.min(addUtcDays(cursor, 29).getTime(), end.getTime()));
    const sameDay = formatIsoDate(cursor) === formatIsoDate(chunkEnd);

    if (sameDay) {
      const hourly = await getShopeeAdsHourlyPerformance({
        accessToken: input.accessToken,
        shopId: input.shopId,
        performanceDate: formatIsoDate(cursor),
      });
      output.push(...aggregateHourlyToDaily(hourly));
    } else {
      const daily = await getShopeeAdsDailyPerformance({
        accessToken: input.accessToken,
        shopId: input.shopId,
        startDate: formatIsoDate(cursor),
        endDate: formatIsoDate(chunkEnd),
      });
      output.push(...daily);
    }

    cursor = addUtcDays(chunkEnd, 1);
  }

  return output.sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeShopeeApiDate(value: string) {
  const input = String(value || '').trim();
  if (!input) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  return parseShopeeDate(input);
}

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function extractProductCampaigns(response: unknown) {
  const containers = Array.isArray(response) ? response : [response];
  return containers.flatMap((container: any) => (
    Array.isArray(container?.campaign_list) ? container.campaign_list : []
  ));
}

export function normalizeShopeeProductCampaignSetting(raw: any): ShopeeProductCampaignSetting {
  const common = raw?.common_info || {};
  const manual = raw?.manual_bidding_info || {};
  const auto = raw?.auto_bidding_info || {};

  return {
    campaign_id: num(raw?.campaign_id),
    common_info: {
      ad_type: String(common.ad_type || ''),
      ad_name: String(common.ad_name || ''),
      campaign_status: String(common.campaign_status || ''),
      bidding_method: String(common.bidding_method || ''),
      campaign_placement: String(common.campaign_placement || ''),
      campaign_budget: num(common.campaign_budget),
      campaign_duration: {
        start_time: num(common.campaign_duration?.start_time),
        end_time: num(common.campaign_duration?.end_time),
      },
      item_id_list: Array.isArray(common.item_id_list)
        ? common.item_id_list.map((itemId: unknown) => num(itemId)).filter(Boolean)
        : [],
    },
    manual_bidding_info: {
      enhanced_cpc: Boolean(manual.enhanced_cpc),
      selected_keywords: Array.isArray(manual.selected_keywords)
        ? manual.selected_keywords.map((keyword: any) => ({
          keyword: String(keyword?.keyword || ''),
          status: String(keyword?.status || ''),
          match_type: String(keyword?.match_type || ''),
          bid_price_per_click: num(keyword?.bid_price_per_click),
        }))
        : [],
      discovery_ads_locations: Array.isArray(manual.discovery_ads_locations)
        ? manual.discovery_ads_locations
        : [],
    },
    auto_bidding_info: {
      roas_target: num(auto.roas_target),
    },
    auto_product_ads_info: Array.isArray(raw?.auto_product_ads_info)
      ? raw.auto_product_ads_info.map((product: any) => ({
        item_id: num(product?.item_id),
        product_name: String(product?.product_name || ''),
        status: String(product?.status || ''),
      }))
      : [],
  };
}

export function normalizeShopeeProductCampaignPerformance(response: unknown) {
  return extractProductCampaigns(response).flatMap((campaign: any) => {
    const metrics = Array.isArray(campaign?.metrics_list) ? campaign.metrics_list : [];
    return metrics.map((metric: any): ShopeeProductCampaignPerformancePoint => ({
      campaign_id: num(campaign?.campaign_id),
      ad_type: String(campaign?.ad_type || ''),
      campaign_placement: String(campaign?.campaign_placement || ''),
      ad_name: String(campaign?.ad_name || ''),
      date: normalizeShopeeApiDate(metric?.date),
      impression: num(metric?.impression),
      clicks: num(metric?.clicks),
      ctr: num(metric?.ctr),
      expense: num(metric?.expense),
      broad_gmv: num(metric?.broad_gmv),
      broad_order: num(metric?.broad_order),
      broad_order_amount: num(metric?.broad_order_amount),
      broad_roi: num(metric?.broad_roi),
      broad_cir: num(metric?.broad_cir),
      cr: num(metric?.cr),
      cpc: num(metric?.cpc),
      direct_gmv: num(metric?.direct_gmv),
      direct_order: num(metric?.direct_order),
      direct_order_amount: num(metric?.direct_order_amount),
      direct_roi: num(metric?.direct_roi),
      direct_cir: num(metric?.direct_cir),
      direct_cr: num(metric?.direct_cr),
      cpdc: num(metric?.cpdc),
    }));
  }).filter((point) => point.campaign_id > 0 && Boolean(point.date));
}

function aggregateProductCampaignHourlyPoints(points: ShopeeProductCampaignPerformancePoint[]) {
  const byCampaignDate = new Map<string, ShopeeProductCampaignPerformancePoint>();

  for (const point of points) {
    const key = `${point.campaign_id}:${point.date}`;
    const current = byCampaignDate.get(key) || {
      ...point,
      impression: 0,
      clicks: 0,
      ctr: 0,
      expense: 0,
      broad_gmv: 0,
      broad_order: 0,
      broad_order_amount: 0,
      broad_roi: 0,
      broad_cir: 0,
      cr: 0,
      cpc: 0,
      direct_gmv: 0,
      direct_order: 0,
      direct_order_amount: 0,
      direct_roi: 0,
      direct_cir: 0,
      direct_cr: 0,
      cpdc: 0,
    };

    current.impression += point.impression;
    current.clicks += point.clicks;
    current.expense += point.expense;
    current.broad_gmv += point.broad_gmv;
    current.broad_order += point.broad_order;
    current.broad_order_amount += point.broad_order_amount;
    current.direct_gmv += point.direct_gmv;
    current.direct_order += point.direct_order;
    current.direct_order_amount += point.direct_order_amount;
    byCampaignDate.set(key, current);
  }

  return Array.from(byCampaignDate.values()).map((point) => ({
    ...point,
    ctr: point.impression > 0 ? (point.clicks / point.impression) * 100 : 0,
    broad_roi: point.expense > 0 ? point.broad_gmv / point.expense : 0,
    broad_cir: point.broad_gmv > 0 ? (point.expense / point.broad_gmv) * 100 : 0,
    cr: point.clicks > 0 ? (point.broad_order / point.clicks) * 100 : 0,
    cpc: point.broad_order > 0 ? point.expense / point.broad_order : 0,
    direct_roi: point.expense > 0 ? point.direct_gmv / point.expense : 0,
    direct_cir: point.direct_gmv > 0 ? (point.expense / point.direct_gmv) * 100 : 0,
    direct_cr: point.clicks > 0 ? (point.direct_order / point.clicks) * 100 : 0,
    cpdc: point.direct_order > 0 ? point.expense / point.direct_order : 0,
  }));
}

export async function getShopeeProductCampaignRefs(input: {
  accessToken: string;
  shopId: number | string;
}) {
  const path = '/api/v2/ads/get_product_level_campaign_id_list';
  const limit = 100;
  let offset = 0;
  const campaigns: ShopeeProductCampaignRef[] = [];

  for (let page = 0; page < 100; page += 1) {
    const url = buildSignedUrl(path, {
      ad_type: 'all',
      offset,
      limit,
    }, {
      accessToken: input.accessToken,
      shopId: input.shopId,
    });
    const json = await getJson<any>(url, 'Shopee product campaign list');
    const response = json.response || {};
    const pageRows = Array.isArray(response.campaign_list) ? response.campaign_list : [];

    campaigns.push(...pageRows.map((campaign: any) => ({
      campaign_id: num(campaign?.campaign_id),
      ad_type: String(campaign?.ad_type || ''),
    })).filter((campaign: ShopeeProductCampaignRef) => campaign.campaign_id > 0));

    if (!response.has_next_page || pageRows.length === 0) break;
    offset += pageRows.length;
  }

  return Array.from(new Map(
    campaigns.map((campaign) => [campaign.campaign_id, campaign]),
  ).values());
}

export async function getShopeeProductCampaignSettings(input: {
  accessToken: string;
  shopId: number | string;
  campaignIds: number[];
}) {
  if (input.campaignIds.length === 0) return [];

  const path = '/api/v2/ads/get_product_level_campaign_setting_info';
  const settings: ShopeeProductCampaignSetting[] = [];

  for (const campaignIds of chunkValues(input.campaignIds, 100)) {
    const url = buildSignedUrl(path, {
      info_type_list: '1,2,3,4',
      campaign_id_list: campaignIds.join(','),
    }, {
      accessToken: input.accessToken,
      shopId: input.shopId,
    });
    const json = await getJson<any>(url, 'Shopee product campaign settings');
    settings.push(...extractProductCampaigns(json.response)
      .map(normalizeShopeeProductCampaignSetting)
      .filter((campaign) => campaign.campaign_id > 0));
  }

  return settings;
}

async function getShopeeProductCampaignDailyPerformance(input: {
  accessToken: string;
  shopId: number | string;
  campaignIds: number[];
  startDate: string;
  endDate: string;
}) {
  const path = '/api/v2/ads/get_product_campaign_daily_performance';
  const url = buildSignedUrl(path, {
    campaign_id_list: input.campaignIds.join(','),
    start_date: formatShopeeDate(input.startDate),
    end_date: formatShopeeDate(input.endDate),
  }, {
    accessToken: input.accessToken,
    shopId: input.shopId,
  });
  const json = await getJson<any>(url, 'Shopee product campaign daily performance');
  return normalizeShopeeProductCampaignPerformance(json.response);
}

async function getShopeeProductCampaignHourlyPerformance(input: {
  accessToken: string;
  shopId: number | string;
  campaignIds: number[];
  performanceDate: string;
}) {
  const path = '/api/v2/ads/get_product_campaign_hourly_performance';
  const url = buildSignedUrl(path, {
    campaign_id_list: input.campaignIds.join(','),
    performance_date: formatShopeeDate(input.performanceDate),
  }, {
    accessToken: input.accessToken,
    shopId: input.shopId,
  });
  const json = await getJson<any>(url, 'Shopee product campaign hourly performance');
  return aggregateProductCampaignHourlyPoints(
    normalizeShopeeProductCampaignPerformance(json.response),
  );
}

export async function fetchShopeeProductCampaignPerformanceRange(input: {
  accessToken: string;
  shopId: number | string;
  campaignIds: number[];
  dateStart: string;
  dateEnd: string;
}) {
  if (input.campaignIds.length === 0) return [];

  const start = parseIsoDate(input.dateStart);
  const end = parseIsoDate(input.dateEnd);
  if (start.getTime() > end.getTime()) {
    throw new Error('Tanggal mulai campaign Shopee tidak boleh lebih besar dari tanggal akhir.');
  }

  const output: ShopeeProductCampaignPerformancePoint[] = [];
  for (const campaignIds of chunkValues(input.campaignIds, 100)) {
    let cursor = start;
    while (cursor.getTime() <= end.getTime()) {
      const chunkEnd = new Date(Math.min(addUtcDays(cursor, 29).getTime(), end.getTime()));
      const cursorDate = formatIsoDate(cursor);
      const chunkEndDate = formatIsoDate(chunkEnd);

      if (cursorDate === chunkEndDate) {
        output.push(...await getShopeeProductCampaignHourlyPerformance({
          accessToken: input.accessToken,
          shopId: input.shopId,
          campaignIds,
          performanceDate: cursorDate,
        }));
      } else {
        output.push(...await getShopeeProductCampaignDailyPerformance({
          accessToken: input.accessToken,
          shopId: input.shopId,
          campaignIds,
          startDate: cursorDate,
          endDate: chunkEndDate,
        }));
      }

      cursor = addUtcDays(chunkEnd, 1);
    }
  }

  return output.sort((a, b) => (
    a.date.localeCompare(b.date) || a.campaign_id - b.campaign_id
  ));
}

export function normalizeShopeeGmsReport(raw: any): ShopeeGmsReport {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Shopee GMS performance: report tidak valid.');
  }
  for (const field of SHOPEE_GMS_REPORT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field)) {
      throw new Error(`Shopee GMS performance: field report ${field} tidak tersedia.`);
    }
    const rawValue = raw[field];
    const isNumericPrimitive = typeof rawValue === 'number'
      || (typeof rawValue === 'string' && rawValue.trim().length > 0);
    const value = isNumericPrimitive ? Number(rawValue) : Number.NaN;
    if (
      !Number.isFinite(value)
      || value < 0
      || (SHOPEE_GMS_COUNT_FIELDS.has(field) && !Number.isSafeInteger(value))
    ) {
      throw new Error(`Shopee GMS performance: field report ${field} tidak valid.`);
    }
  }

  return {
    impression: num(raw?.impression),
    clicks: num(raw?.clicks),
    expense: num(raw?.expense),
    broad_gmv: num(raw?.broad_gmv),
    broad_order: num(raw?.broad_order),
    broad_order_amount: num(raw?.broad_order_amount),
    broad_roi: num(raw?.broad_roi),
    broad_cir: num(raw?.broad_cir),
    cr: num(raw?.cr),
    cpc: num(raw?.cpc),
    direct_order: num(raw?.direct_order),
    direct_order_amount: num(raw?.direct_order_amount),
    direct_roi: num(raw?.direct_roi),
    direct_cir: num(raw?.direct_cir),
    direct_cr: num(raw?.direct_cr),
    cpdc: num(raw?.cpdc),
  };
}

export function normalizeShopeeGmsCampaignPerformance(
  response: unknown,
): ShopeeGmsCampaignPerformance {
  const raw = response as any;
  const campaignId = Number(raw?.campaign_id);
  if (
    !raw
    || typeof raw !== 'object'
    || !Number.isSafeInteger(campaignId)
    || campaignId <= 0
    || !raw.report
    || typeof raw.report !== 'object'
    || Array.isArray(raw.report)
  ) {
    throw new Error('Shopee GMS campaign performance: response tidak valid.');
  }

  return {
    campaign_id: campaignId,
    report: normalizeShopeeGmsReport(raw.report),
  };
}

export function normalizeShopeeGmsItemPerformance(
  response: unknown,
  fallbackCampaignId = 0,
): {
  campaign_id: number;
  items: ShopeeGmsItemPerformance[];
  total: number;
  has_next_page: boolean;
  page_size: number;
} {
  const raw = response as any;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Shopee GMS item performance: response tidak valid.');
  }

  const fallbackId = Number(fallbackCampaignId);
  const rawCampaignId = raw.campaign_id;
  const campaignIdIsNumericPrimitive = typeof rawCampaignId === 'number'
    || (typeof rawCampaignId === 'string' && rawCampaignId.trim().length > 0);
  const responseCampaignId = campaignIdIsNumericPrimitive
    ? Number(rawCampaignId)
    : Number.NaN;
  const campaignId = rawCampaignId == null || responseCampaignId === 0
    ? fallbackId
    : responseCampaignId;
  const resultList = raw.result_list;
  const rawTotal = raw.total;
  const totalIsNumericPrimitive = typeof rawTotal === 'number'
    || (typeof rawTotal === 'string' && rawTotal.trim().length > 0);
  const total = totalIsNumericPrimitive ? Number(rawTotal) : Number.NaN;

  if (
    !Number.isSafeInteger(campaignId)
    || campaignId <= 0
    || !Array.isArray(resultList)
    || !Number.isSafeInteger(total)
    || total < 0
    || typeof raw.has_next_page !== 'boolean'
  ) {
    throw new Error('Shopee GMS item performance: envelope response tidak valid.');
  }

  if (resultList.some((item: any) => (
    !item
    || typeof item !== 'object'
    || !Number.isSafeInteger(Number(item.item_id))
    || Number(item.item_id) <= 0
    || !item.report
    || typeof item.report !== 'object'
    || Array.isArray(item.report)
  ))) {
    throw new Error('Shopee GMS item performance: report item tidak valid.');
  }

  const items = resultList.map((item: any): ShopeeGmsItemPerformance => ({
    item_id: Number(item.item_id),
    report: normalizeShopeeGmsReport(item.report),
  }));
  if (items.some((item) => !Number.isSafeInteger(item.report.impression))) {
    throw new Error('Shopee GMS item performance: field report impression tidak valid.');
  }

  return {
    campaign_id: campaignId,
    items,
    total,
    has_next_page: raw.has_next_page,
    page_size: resultList.length,
  };
}

export function aggregateShopeeGmsReports(reports: ShopeeGmsReport[]): ShopeeGmsReport {
  if (reports.length === 1) return { ...reports[0] };

  const totals = reports.reduce((result, report) => {
    result.impression += report.impression;
    result.clicks += report.clicks;
    result.expense += report.expense;
    result.broad_gmv += report.broad_gmv;
    result.broad_order += report.broad_order;
    result.broad_order_amount += report.broad_order_amount;
    result.direct_order += report.direct_order;
    result.direct_order_amount += report.direct_order_amount;
    result.implied_direct_gmv += report.expense * report.direct_roi;
    return result;
  }, {
    impression: 0,
    clicks: 0,
    expense: 0,
    broad_gmv: 0,
    broad_order: 0,
    broad_order_amount: 0,
    direct_order: 0,
    direct_order_amount: 0,
    implied_direct_gmv: 0,
  });

  return {
    impression: totals.impression,
    clicks: totals.clicks,
    expense: totals.expense,
    broad_gmv: totals.broad_gmv,
    broad_order: totals.broad_order,
    broad_order_amount: totals.broad_order_amount,
    broad_roi: totals.expense > 0 ? totals.broad_gmv / totals.expense : 0,
    broad_cir: totals.broad_gmv > 0 ? (totals.expense / totals.broad_gmv) * 100 : 0,
    cr: totals.clicks > 0 ? (totals.broad_order / totals.clicks) * 100 : 0,
    cpc: totals.broad_order > 0 ? totals.expense / totals.broad_order : 0,
    direct_order: totals.direct_order,
    direct_order_amount: totals.direct_order_amount,
    direct_roi: totals.expense > 0 ? totals.implied_direct_gmv / totals.expense : 0,
    direct_cir: totals.implied_direct_gmv > 0
      ? (totals.expense / totals.implied_direct_gmv) * 100
      : 0,
    direct_cr: totals.clicks > 0 ? (totals.direct_order / totals.clicks) * 100 : 0,
    cpdc: totals.direct_order > 0 ? totals.expense / totals.direct_order : 0,
  };
}

export async function getShopeeGmsCampaignPerformance(input: {
  accessToken: string;
  shopId: number | string;
  startDate: string;
  endDate: string;
  campaignId?: number;
}) {
  const path = '/api/v2/ads/get_gms_campaign_performance';
  const url = buildSignedUrl(path, {}, {
    accessToken: input.accessToken,
    shopId: input.shopId,
  });
  const payload: Record<string, unknown> = {
    start_date: formatShopeeDate(input.startDate),
    end_date: formatShopeeDate(input.endDate),
  };
  if (Number(input.campaignId || 0) > 0) payload.campaign_id = input.campaignId;

  const json = await postJson<any>(url, payload, 'Shopee GMS campaign performance');
  return normalizeShopeeGmsCampaignPerformance(json.response);
}

export async function getShopeeGmsItemPerformance(input: {
  accessToken: string;
  shopId: number | string;
  startDate: string;
  endDate: string;
  campaignId: number;
}) {
  const path = '/api/v2/ads/get_gms_item_performance';
  const limit = 100;
  let offset = 0;
  let total = 0;
  let hasNextPage = false;
  const items = new Map<number, ShopeeGmsItemPerformance>();

  for (let page = 0; page < 100; page += 1) {
    const url = buildSignedUrl(path, {}, {
      accessToken: input.accessToken,
      shopId: input.shopId,
    });
    const json = await postJson<any>(url, {
      campaign_id: input.campaignId,
      start_date: formatShopeeDate(input.startDate),
      end_date: formatShopeeDate(input.endDate),
      offset,
      limit,
    }, 'Shopee GMS item performance');
    const normalized = normalizeShopeeGmsItemPerformance(json.response, input.campaignId);

    if (normalized.campaign_id !== input.campaignId) {
      throw new Error(
        `Shopee GMS item performance: campaign ${normalized.campaign_id} tidak cocok dengan ${input.campaignId}.`,
      );
    }

    normalized.items.forEach((item) => items.set(item.item_id, item));
    total = Math.max(total, normalized.total);
    hasNextPage = normalized.has_next_page;
    if (hasNextPage && normalized.page_size === 0) {
      throw new Error('Shopee GMS item performance: halaman kosong masih memiliki next page.');
    }
    if (!hasNextPage) {
      break;
    }
    offset += normalized.page_size;
  }

  if (hasNextPage) {
    throw new Error('Shopee GMS item performance: pagination melebihi batas aman 10.000 baris.');
  }
  if (items.size !== total) {
    throw new Error(
      `Shopee GMS item performance: respons tidak lengkap (${items.size} dari ${total} item).`,
    );
  }

  return {
    campaign_id: input.campaignId,
    items: Array.from(items.values()).sort((a, b) => a.item_id - b.item_id),
    total,
  };
}

export function buildShopeeGmsDateChunks(dateStart: string, dateEnd: string) {
  const start = parseIsoDate(dateStart);
  const end = parseIsoDate(dateEnd);
  if (start.getTime() > end.getTime()) {
    throw new Error('Tanggal mulai Shop GMV Max tidak boleh lebih besar dari tanggal akhir.');
  }

  const totalDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (totalDays < 2) return [];

  const chunks: Array<{ period_start: string; period_end: string }> = [];
  let cursor = start;
  let remainingDays = totalDays;

  while (remainingDays > 0) {
    // Shopee's error catalogue caps GMS ranges at one month and rejects a
    // one-day range. If a final singleton would remain, shorten this chunk.
    const chunkDays = remainingDays <= 28
      ? remainingDays
      : remainingDays % 28 === 1 ? 27 : 28;
    const chunkEnd = addUtcDays(cursor, chunkDays - 1);
    chunks.push({
      period_start: formatIsoDate(cursor),
      period_end: formatIsoDate(chunkEnd),
    });
    cursor = addUtcDays(chunkEnd, 1);
    remainingDays -= chunkDays;
  }

  return chunks;
}

export async function fetchShopeeGmsPerformanceRange(input: {
  accessToken: string;
  shopId: number | string;
  dateStart: string;
  dateEnd: string;
}): Promise<ShopeeGmsFetchResult> {
  const chunks = buildShopeeGmsDateChunks(input.dateStart, input.dateEnd);
  // GMS has no hourly endpoint. A one-day request is therefore unavailable
  // rather than an API failure, because the official API rejects equal dates.
  if (chunks.length === 0) return { status: 'range_unavailable', snapshots: [] };

  type GmsBucket = {
    campaignReports: ShopeeGmsPeriodPerformance['report_chunks'];
    itemReports: Map<number, ShopeeGmsPeriodPerformance['items'][number]['report_chunks']>;
  };

  const byCampaign = new Map<number, GmsBucket>();
  let campaignFound = false;

  for (const chunk of chunks) {
    const periodStart = chunk.period_start;
    const periodEnd = chunk.period_end;

    let campaign: ShopeeGmsCampaignPerformance;
    try {
      campaign = await getShopeeGmsCampaignPerformance({
        accessToken: input.accessToken,
        shopId: input.shopId,
        startDate: periodStart,
        endDate: periodEnd,
      });
    } catch (error) {
      const code = getShopeeApiErrorCode(error);
      if (code === GMS_NOT_WHITELISTED_ERROR) {
        return { status: 'not_whitelisted', snapshots: [] };
      }
      if (code === GMS_CAMPAIGN_NOT_FOUND_ERROR) continue;
      // The official sandbox URL currently returns the undocumented generic
      // `error_not_found` when no GMS fixture is available. Keep this fallback
      // sandbox-only so the same response from the live API remains visible.
      if (code === 'error_not_found' && usesShopeeSandboxApi()) {
        return { status: 'sandbox_unavailable', snapshots: [] };
      }
      throw error;
    }

    campaignFound = true;
    const itemPerformance = await getShopeeGmsItemPerformance({
      accessToken: input.accessToken,
      shopId: input.shopId,
      startDate: periodStart,
      endDate: periodEnd,
      campaignId: campaign.campaign_id,
    });
    const bucket: GmsBucket = byCampaign.get(campaign.campaign_id) || {
      campaignReports: [],
      itemReports: new Map<number, ShopeeGmsPeriodPerformance['items'][number]['report_chunks']>(),
    };

    bucket.campaignReports.push({
      period_start: periodStart,
      period_end: periodEnd,
      report: campaign.report,
    });
    itemPerformance.items.forEach((item) => {
      const itemChunks = bucket.itemReports.get(item.item_id) || [];
      itemChunks.push({
        period_start: periodStart,
        period_end: periodEnd,
        report: item.report,
      });
      bucket.itemReports.set(item.item_id, itemChunks);
    });
    byCampaign.set(campaign.campaign_id, bucket);
  }

  if (!campaignFound) return { status: 'no_campaign', snapshots: [] };

  const snapshots = Array.from(byCampaign.entries())
    .map(([campaignId, bucket]): ShopeeGmsPeriodPerformance => ({
      campaign_id: campaignId,
      period_start: input.dateStart,
      period_end: input.dateEnd,
      report: aggregateShopeeGmsReports(bucket.campaignReports.map((chunk) => chunk.report)),
      report_chunks: bucket.campaignReports,
      items: Array.from(bucket.itemReports.entries())
        .map(([itemId, chunks]) => ({
          item_id: itemId,
          report: aggregateShopeeGmsReports(chunks.map((chunk) => chunk.report)),
          report_chunks: chunks,
        }))
        .sort((a, b) => a.item_id - b.item_id),
    }))
    .sort((a, b) => a.campaign_id - b.campaign_id);

  return { status: 'ok', snapshots };
}

export function toShopeeTimestamp(date: string | Date | null | undefined) {
  return toUnixTimestamp(date);
}
