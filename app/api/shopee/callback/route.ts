import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardPermissionAccess } from '@/lib/dashboard-access';
import { createServiceSupabase } from '@/lib/service-supabase';
import {
  exchangeShopeeAuthCode,
  getShopeeShopInfo,
  getShopeeSetupInfo,
} from '@/lib/shopee-open-platform';
import { buildDefaultShopeeSpendStreams } from '@/lib/shopee-streams';

export const dynamic = 'force-dynamic';

function buildAdminRedirect(req: NextRequest, status: 'connected' | 'error', message: string, shopId?: string) {
  const url = new URL('/dashboard/admin', req.url);
  url.searchParams.set('tab', 'meta');
  url.searchParams.set('shopee_status', status);
  url.searchParams.set('shopee_message', message);
  if (shopId) url.searchParams.set('shopee_shop_id', shopId);
  return url;
}

function unixToIso(value: number | null | undefined) {
  if (!value) return null;
  return new Date(Number(value) * 1000).toISOString();
}

export async function GET(req: NextRequest) {
  try {
    await requireDashboardPermissionAccess('admin:meta', 'Admin Meta');
  } catch (error: any) {
    return NextResponse.redirect(
      buildAdminRedirect(req, 'error', error.message || 'Login admin diperlukan untuk menyelesaikan koneksi Shopee.'),
    );
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const shopId = searchParams.get('shop_id');
  const mainAccountId = searchParams.get('main_account_id');

  if (mainAccountId && !shopId) {
    return NextResponse.redirect(
      buildAdminRedirect(
        req,
        'error',
        'Callback Shopee mengembalikan main_account_id. Flow ini saat ini hanya mendukung shop authorization.',
      ),
    );
  }

  if (!code || !shopId) {
    return NextResponse.redirect(
      buildAdminRedirect(req, 'error', 'Callback Shopee tidak lengkap. code/shop_id tidak ditemukan.'),
    );
  }

  try {
    const setup = getShopeeSetupInfo();
    let tokens;
    try {
      tokens = await exchangeShopeeAuthCode({ code, shopId });
    } catch (error: any) {
      console.error('[shopee-callback] Token exchange failed', {
        shop_id: shopId,
        environment: setup.environment,
        auth_base_url: setup.authBaseUrl,
        api_base_url: setup.apiBaseUrl,
        request_base_url: setup.requestBaseUrl,
        base_url_mode_mismatch: setup.baseUrlModeMismatch,
        partner_id_suffix: setup.partnerIdSuffix,
        partner_key_length: setup.partnerKeyLength,
        partner_key_wrapped: setup.partnerKeyWrapped,
        error: error.message,
      });
      throw new Error(`Token exchange gagal: ${error.message}`);
    }

    let shopInfo;
    try {
      shopInfo = await getShopeeShopInfo({
        accessToken: tokens.accessToken,
        shopId,
      });
    } catch (error: any) {
      console.error('[shopee-callback] get_shop_info failed', {
        shop_id: shopId,
        environment: setup.environment,
        auth_base_url: setup.authBaseUrl,
        api_base_url: setup.apiBaseUrl,
        request_base_url: setup.requestBaseUrl,
        base_url_mode_mismatch: setup.baseUrlModeMismatch,
        partner_id_suffix: setup.partnerIdSuffix,
        partner_key_length: setup.partnerKeyLength,
        partner_key_wrapped: setup.partnerKeyWrapped,
        error: error.message,
      });
      throw new Error(`Get shop info gagal: ${error.message}`);
    }

    const svc = createServiceSupabase();
    const numericShopId = Number(shopId);

    const { data: existingShop, error: existingError } = await svc
      .from('shopee_shops')
      .select('*')
      .eq('shop_id', numericShopId)
      .maybeSingle();

    if (existingError) throw existingError;

    const basePayload = {
      shop_id: numericShopId,
      shop_name: String(shopInfo.shop_name || '').trim() || `Shopee Shop ${shopId}`,
      region: shopInfo.region || null,
      merchant_id: shopInfo.merchant_id == null ? null : Number(shopInfo.merchant_id),
      shop_status: shopInfo.status || null,
      is_cb: Boolean(shopInfo.is_cb),
      auth_time: unixToIso(shopInfo.auth_time),
      auth_expire_at: unixToIso(shopInfo.expire_time),
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    let shopConfigId = existingShop?.id as number | undefined;

    if (shopConfigId) {
      const { error } = await svc
        .from('shopee_shops')
        .update({
          ...basePayload,
          default_source: String(existingShop.default_source || '').trim() || 'Shopee Ads',
          default_advertiser: String(existingShop.default_advertiser || '').trim() || basePayload.shop_name,
        })
        .eq('id', shopConfigId);

      if (error) throw error;
    } else {
      const { data: inserted, error } = await svc
        .from('shopee_shops')
        .insert({
          ...basePayload,
          store: null,
          default_source: 'Shopee Ads',
          default_advertiser: basePayload.shop_name,
        })
        .select('id')
        .single();

      if (error) throw error;
      shopConfigId = inserted?.id;
    }

    if (!shopConfigId) {
      throw new Error('Gagal menentukan shop config id Shopee.');
    }

    const defaultStreams = buildDefaultShopeeSpendStreams(
      basePayload.shop_name,
      existingShop?.default_source,
      existingShop?.default_advertiser,
    ).map((stream) => ({
      shop_config_id: shopConfigId,
      ...stream,
      updated_at: new Date().toISOString(),
    }));

    const { error: streamError } = await svc
      .from('shopee_shop_spend_streams')
      .upsert(defaultStreams, { onConflict: 'shop_config_id,stream_key' });

    if (streamError) throw streamError;

    const { error: tokenError } = await svc
      .from('shopee_shop_tokens')
      .upsert(
        {
          shop_config_id: shopConfigId,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          token_expires_at: tokens.tokenExpiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'shop_config_id' },
      );

    if (tokenError) throw tokenError;

    return NextResponse.redirect(
      buildAdminRedirect(req, 'connected', `Shop ${basePayload.shop_name} berhasil terhubung.`, shopId),
    );
  } catch (error: any) {
    console.error('[shopee-callback] Error:', error);
    return NextResponse.redirect(
      buildAdminRedirect(req, 'error', error.message || 'Gagal menyelesaikan koneksi Shopee.', shopId),
    );
  }
}
