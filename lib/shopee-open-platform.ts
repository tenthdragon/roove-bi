import crypto from 'crypto';
import { buildPublicSiteUrl } from './site-config';

const DEFAULT_SHOPEE_AUTH_BASE_URL = 'https://partner.shopeemobile.com';
const DEFAULT_SHOPEE_API_BASE_URL = 'https://partner.shopeemobile.com';
const SHOPEE_CALLBACK_PATH = '/api/shopee/callback';

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

export type ShopeeSetupInfo = {
  configured: boolean;
  redirectUrl: string;
  authBaseUrl: string;
  apiBaseUrl: string;
  missingEnv: string[];
  environment: 'sandbox' | 'production' | 'custom';
  authLooksSandbox: boolean;
  apiLooksSandbox: boolean;
  baseUrlModeMismatch: boolean;
  partnerIdSuffix: string | null;
  partnerIdWrapped: boolean;
  partnerKeyLength: number;
  partnerKeyWrapped: boolean;
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

export function getShopeeSetupInfo(): ShopeeSetupInfo {
  const partnerId = readEnvText('SHOPEE_PARTNER_ID');
  const partnerKey = readEnvText('SHOPEE_PARTNER_KEY');
  const authBaseUrl = getAuthBaseUrl();
  const apiBaseUrl = getApiBaseUrl();
  const authLooksSandbox = /sandbox|test-stable/i.test(authBaseUrl);
  const apiLooksSandbox = /sandbox|test-stable/i.test(apiBaseUrl);
  const environment =
    authLooksSandbox && apiLooksSandbox
      ? 'sandbox'
      : !authLooksSandbox && !apiLooksSandbox
        ? 'production'
        : 'custom';
  const missingEnv: string[] = [];
  if (!partnerId.value) missingEnv.push('SHOPEE_PARTNER_ID');
  if (!partnerKey.value) missingEnv.push('SHOPEE_PARTNER_KEY');

  return {
    configured: missingEnv.length === 0,
    redirectUrl: getRedirectUrl(),
    authBaseUrl,
    apiBaseUrl,
    missingEnv,
    environment,
    authLooksSandbox,
    apiLooksSandbox,
    baseUrlModeMismatch: authLooksSandbox !== apiLooksSandbox,
    partnerIdSuffix: partnerId.value ? partnerId.value.slice(-4) : null,
    partnerIdWrapped: partnerId.wrapped,
    partnerKeyLength: partnerKey.value.length,
    partnerKeyWrapped: partnerKey.wrapped,
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
    redirectUrl: setup.redirectUrl,
    authBaseUrl: setup.authBaseUrl,
    apiBaseUrl: setup.apiBaseUrl,
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

  if (!response.ok) {
    throw new Error(json.message || json.error || `${label}: HTTP ${response.status}`);
  }

  if (json.error) {
    throw new Error(json.message || json.error || `${label}: request gagal`);
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

export function buildShopeeShopAuthUrl() {
  const config = requireShopeeConfig();
  const path = '/api/v2/shop/auth_partner';
  const timestamp = nowUnix();
  const params = new URLSearchParams({
    partner_id: config.partnerId,
    timestamp: String(timestamp),
    redirect: config.redirectUrl,
    sign: buildSignature(config, path, timestamp),
  });

  return `${config.authBaseUrl}${path}?${params.toString()}`;
}

export async function exchangeShopeeAuthCode(input: { code: string; shopId: number | string }) {
  const config = requireShopeeConfig();
  const path = '/api/v2/auth/token/get';
  const url = buildSignedUrl(path, {}, undefined, config.authBaseUrl);

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
  const url = buildSignedUrl(path, {}, undefined, config.authBaseUrl);

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

export function toShopeeTimestamp(date: string | Date | null | undefined) {
  return toUnixTimestamp(date);
}
