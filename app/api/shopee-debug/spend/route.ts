import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { limitByIp, rejectMissingDashboardSession } from '@/lib/request-hardening';
import { getRequestId, logRouteEvent } from '@/lib/structured-logger';
import { createServiceSupabase } from '@/lib/service-supabase';
import {
  fetchShopeeAdsPerformanceRange,
  refreshShopeeAccessToken,
  type ShopeeAdsPerformancePoint,
} from '@/lib/shopee-open-platform';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

type ShopeeShopRow = {
  id: number;
  shop_id: number;
  shop_name: string;
  region: string | null;
  is_active: boolean;
  marketplace_source_key: string | null;
};

type ShopeeTokenRow = {
  shop_config_id: number;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null;
};

function resolveDate(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return String(searchParams.get('date') || '').trim() || new Date().toISOString().slice(0, 10);
}

function resolveRequestedShopId(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = String(searchParams.get('shop_id') || '').trim();
  if (!raw) return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error('shop_id Shopee tidak valid.');
  }
  return numeric;
}

function shouldRefreshToken(tokenExpiresAt: string | null | undefined) {
  if (!tokenExpiresAt) return true;
  const expiresAt = Date.parse(tokenExpiresAt);
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt <= Date.now() + 15 * 60 * 1000;
}

async function ensureUsableToken(token: ShopeeTokenRow, shop: ShopeeShopRow) {
  if (!shouldRefreshToken(token.token_expires_at)) {
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenExpiresAt: token.token_expires_at,
      refreshed: false,
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
    refreshed: true,
  };
}

function summarizePoints(points: ShopeeAdsPerformancePoint[]) {
  return points.reduce(
    (acc, point) => ({
      spend: acc.spend + Number(point.expense || 0),
      impressions: acc.impressions + Number(point.impression || 0),
      clicks: acc.clicks + Number(point.clicks || 0),
      direct_gmv: acc.direct_gmv + Number(point.direct_gmv || 0),
      broad_gmv: acc.broad_gmv + Number(point.broad_gmv || 0),
      direct_order: acc.direct_order + Number(point.direct_order || 0),
      broad_order: acc.broad_order + Number(point.broad_order || 0),
    }),
    {
      spend: 0,
      impressions: 0,
      clicks: 0,
      direct_gmv: 0,
      broad_gmv: 0,
      direct_order: 0,
      broad_order: 0,
    },
  );
}

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const requestId = getRequestId(req);
  const mode = 'dashboard_get';

  logRouteEvent({
    route: '/api/shopee-debug/spend',
    job: 'shopee_debug_spend',
    mode,
    status: 'start',
    request_id: requestId,
  });

  try {
    const sessionError = rejectMissingDashboardSession(req);
    if (sessionError) return sessionError;

    const rateLimitError = limitByIp(
      req,
      'shopee-debug-spend',
      20,
      10 * 60 * 1000,
      'Terlalu banyak permintaan debug Shopee spend. Coba lagi beberapa menit lagi.',
    );
    if (rateLimitError) return rateLimitError;

    const { profile } = await requireDashboardPermissionAccess('admin:meta', 'Admin Meta');
    const date = resolveDate(req);
    const requestedShopId = resolveRequestedShopId(req);

    const svc = createServiceSupabase();
    let shopQuery = svc
      .from('shopee_shops')
      .select('id, shop_id, shop_name, region, is_active, marketplace_source_key')
      .eq('is_active', true)
      .order('shop_name');

    if (requestedShopId) {
      shopQuery = shopQuery.eq('shop_id', requestedShopId);
    }

    const [shopsRes, tokensRes] = await Promise.all([
      shopQuery,
      svc.from('shopee_shop_tokens').select('shop_config_id, access_token, refresh_token, token_expires_at'),
    ]);

    if (shopsRes.error) throw shopsRes.error;
    if (tokensRes.error) throw tokensRes.error;

    const shops = (shopsRes.data || []) as ShopeeShopRow[];
    if (shops.length === 0) {
      return NextResponse.json(
        { error: requestedShopId ? 'Shop Shopee aktif tidak ditemukan.' : 'Belum ada shop Shopee aktif.' },
        { status: 404 },
      );
    }

    const tokenMap = new Map<number, ShopeeTokenRow>(
      ((tokensRes.data || []) as ShopeeTokenRow[]).map((row) => [row.shop_config_id, row]),
    );

    const results: Array<Record<string, unknown>> = [];

    for (const shop of shops) {
      const token = tokenMap.get(shop.id);
      if (!token?.access_token || !token?.refresh_token) {
        results.push({
          shop_config_id: shop.id,
          shop_id: shop.shop_id,
          shop_name: shop.shop_name,
          marketplace_source_key: shop.marketplace_source_key,
          error: 'Token Shopee belum lengkap.',
        });
        continue;
      }

      try {
        const usableToken = await ensureUsableToken(token, shop);
        const points = await fetchShopeeAdsPerformanceRange({
          accessToken: usableToken.accessToken,
          shopId: shop.shop_id,
          dateStart: date,
          dateEnd: date,
        });

        results.push({
          shop_config_id: shop.id,
          shop_id: shop.shop_id,
          shop_name: shop.shop_name,
          region: shop.region,
          marketplace_source_key: shop.marketplace_source_key,
          token_refreshed: usableToken.refreshed,
          summary: summarizePoints(points),
          points,
        });
      } catch (error: any) {
        results.push({
          shop_config_id: shop.id,
          shop_id: shop.shop_id,
          shop_name: shop.shop_name,
          marketplace_source_key: shop.marketplace_source_key,
          error: error.message || 'Gagal mengambil Shopee Ads spend.',
        });
      }
    }

    logRouteEvent({
      route: '/api/shopee-debug/spend',
      job: 'shopee_debug_spend',
      mode,
      status: 'success',
      request_id: requestId,
      duration_ms: Date.now() - startTime,
      rows_processed: results.length,
      extra: {
        requested_by: profile.id,
        date,
        requested_shop_id: requestedShopId,
      },
    });

    return NextResponse.json({
      date,
      requested_shop_id: requestedShopId,
      note: 'Endpoint ini membaca Shopee Ads API dari env server + token shop yang tersimpan. Ini belum membuktikan split new_cpc vs live_stream; hasilnya adalah angka yang dikembalikan endpoint Ads resmi.',
      results,
    });
  } catch (error: any) {
    logRouteEvent({
      route: '/api/shopee-debug/spend',
      job: 'shopee_debug_spend',
      mode,
      status: 'failed',
      request_id: requestId,
      duration_ms: Date.now() - startTime,
      extra: {
        error: error.message,
      },
    });

    return NextResponse.json(
      { error: error.message || 'Gagal menjalankan debug Shopee spend.' },
      { status: 500 },
    );
  }
}
