'use server';

import { createServerSupabase, createServiceSupabase } from './supabase-server';
import { requireDashboardPermissionAccess, requireDashboardRoles } from './dashboard-access';
import { MATRIX_ROLES, PERMISSION_GROUPS } from './utils';
import { getShopeeSetupInfo } from './shopee-open-platform';
import { listMarketplaceIntakeSourceConfigs } from './marketplace-intake-sources';
import {
  buildDefaultShopeeSpendStreams,
  listShopeeSpendStreamDefinitions,
  normalizeShopeeSpendStreamConfig,
  type ShopeeSpendStreamKey,
  type ShopeeSpendSyncMode,
} from './shopee-streams';

const MATRIX_ROLE_IDS = new Set(MATRIX_ROLES.map((role) => role.id));
const KNOWN_PERMISSION_KEYS = new Set(
  PERMISSION_GROUPS.flatMap((group) => group.keys.map((permission) => permission.key))
);

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

async function requireOwnerAccess(label: string) {
  await requireDashboardRoles(['owner'], `Hanya owner yang bisa mengakses ${label}.`);
}

async function requireAdminAccess(permissionKey: string, label: string) {
  await requireDashboardPermissionAccess(permissionKey, label);
}

function sanitizePermissionMatrix(matrix: Record<string, string[]>) {
  const rows: { role: string; permission_key: string }[] = [];

  for (const [role, permissions] of Object.entries(matrix || {})) {
    if (!MATRIX_ROLE_IDS.has(role) || !Array.isArray(permissions)) continue;

    const uniqueKeys = Array.from(
      new Set(
        permissions
          .map((permission) => String(permission || '').trim())
          .filter((permission) => KNOWN_PERMISSION_KEYS.has(permission))
      )
    );

    uniqueKeys.forEach((permission_key) => {
      rows.push({ role, permission_key });
    });
  }

  return rows;
}

export async function getAdminBootstrap() {
  const supabase = createServerSupabase();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { profile: null, users: [] };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return { profile: null, users: [] };
  }

  if (profile.role !== 'owner') {
    return { profile, users: [] };
  }

  const svc = createServiceSupabase();
  const { data: users, error: usersError } = await svc
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });

  if (usersError) throw usersError;

  return { profile, users: users || [] };
}

export async function getAdminLogsSnapshot() {
  await requireAdminAccess('admin:logs', 'Admin Logs');

  const svc = createServiceSupabase();
  const [syncLogsRes, importsRes] = await Promise.all([
    svc.from('scalev_sync_log').select('*').order('started_at', { ascending: false }).limit(100),
    svc.from('data_imports').select('*').order('imported_at', { ascending: false }).limit(100),
  ]);

  if (syncLogsRes.error) throw syncLogsRes.error;
  if (importsRes.error) throw importsRes.error;

  return {
    syncLogs: syncLogsRes.data || [],
    imports: importsRes.data || [],
  };
}

export async function getAdminDataReferenceSnapshot() {
  await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const [mpFeeRes, taxRes, overheadRes] = await Promise.all([
    svc.from('marketplace_fee_estimate_rates').select('*').order('setting_key').order('effective_from', { ascending: false }),
    svc.from('tax_rates').select('*').order('name').order('effective_from', { ascending: false }),
    svc.from('monthly_overhead').select('*').order('year_month', { ascending: false }),
  ]);

  if (mpFeeRes.error) throw mpFeeRes.error;
  if (taxRes.error) throw taxRes.error;
  if (overheadRes.error) throw overheadRes.error;

  return {
    marketplaceFeeEstimateRates: mpFeeRes.data || [],
    taxRates: taxRes.data || [],
    overheadData: overheadRes.data || [],
  };
}

const MARKETPLACE_FEE_SETTING_KEYS = new Set([
  'tiktok_estimated',
  'others_estimated',
  'shopee_fallback',
]);

export async function saveMarketplaceFeeEstimateRate(row: {
  setting_key: string;
  rate: number;
  effective_from: string;
}) {
  await requireOwnerAccess('Admin Data Reference');

  const settingKey = String(row.setting_key || '').trim();
  if (!MARKETPLACE_FEE_SETTING_KEYS.has(settingKey)) {
    throw new Error('Setting marketplace fee tidak dikenali.');
  }

  const svc = createServiceSupabase();
  const { error } = await svc.from('marketplace_fee_estimate_rates').upsert(
    {
      setting_key: settingKey,
      rate: row.rate,
      effective_from: row.effective_from,
    },
    { onConflict: 'setting_key,effective_from' }
  );

  if (error) throw error;
  return { success: true };
}

export async function deleteMarketplaceFeeEstimateRate(id: number) {
  await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('marketplace_fee_estimate_rates').delete().eq('id', id);
  if (error) throw error;
  return { success: true };
}

export async function saveCommissionRate(row: { channel: string; rate: number; effective_from: string }) {
  await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('marketplace_commission_rates').upsert(
    {
      channel: row.channel.trim(),
      rate: row.rate,
      effective_from: row.effective_from,
    },
    { onConflict: 'channel,effective_from' }
  );

  if (error) throw error;
  return { success: true };
}

export async function deleteCommissionRate(id: number) {
  await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('marketplace_commission_rates').delete().eq('id', id);
  if (error) throw error;
  return { success: true };
}

export async function saveTaxRate(row: { name: string; rate: number; effective_from: string }) {
  await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('tax_rates').upsert(
    {
      name: row.name.trim(),
      rate: row.rate,
      effective_from: row.effective_from,
    },
    { onConflict: 'name,effective_from' }
  );

  if (error) throw error;
  return { success: true };
}

export async function deleteTaxRate(id: number) {
  await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('tax_rates').delete().eq('id', id);
  if (error) throw error;
  return { success: true };
}

export async function saveMonthlyOverhead(row: { year_month: string; amount: number }) {
  await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('monthly_overhead').upsert(
    {
      year_month: row.year_month,
      amount: row.amount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'year_month' }
  );

  if (error) throw error;
  return { success: true };
}

export async function deleteMonthlyOverhead(id: number) {
  await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('monthly_overhead').delete().eq('id', id);
  if (error) throw error;
  return { success: true };
}

export async function updateTelegramChatId(userId: string, telegramChatId: string | null) {
  await requireOwnerAccess('Admin Users');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('profiles')
    .update({ telegram_chat_id: normalizeOptionalText(telegramChatId) })
    .eq('id', userId);

  if (error) throw error;
  return { success: true };
}

export async function getRolePermissionsMatrix() {
  await requireOwnerAccess('Permission Matrix');

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('role_permissions')
    .select('role, permission_key');

  if (error) throw error;
  return data || [];
}

export async function saveRolePermissionsMatrix(matrix: Record<string, string[]>) {
  await requireOwnerAccess('Permission Matrix');

  const rows = sanitizePermissionMatrix(matrix);
  const svc = createServiceSupabase();

  const { error: deleteError } = await svc
    .from('role_permissions')
    .delete()
    .neq('role', 'owner');

  if (deleteError) throw deleteError;

  if (rows.length > 0) {
    const { error: insertError } = await svc
      .from('role_permissions')
      .insert(rows);

    if (insertError) throw insertError;
  }

  return { success: true, count: rows.length };
}

export async function getMetaAdminSnapshot() {
  await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const [accountsRes, logsRes, mappingsRes, wabaRes, wabaLogsRes] = await Promise.all([
    svc.from('meta_ad_accounts').select('*').order('account_name'),
    svc.from('meta_sync_log').select('*').order('created_at', { ascending: false }).limit(5),
    svc.from('ads_store_brand_mapping').select('store_pattern, brand').order('brand').order('store_pattern'),
    svc.from('waba_accounts').select('*').order('waba_name'),
    svc.from('waba_sync_log').select('*').order('created_at', { ascending: false }).limit(5),
  ]);

  if (accountsRes.error) throw accountsRes.error;
  if (logsRes.error) throw logsRes.error;
  if (mappingsRes.error) throw mappingsRes.error;
  if (wabaRes.error) throw wabaRes.error;
  if (wabaLogsRes.error) throw wabaLogsRes.error;

  return {
    accounts: accountsRes.data || [],
    recentLogs: logsRes.data || [],
    brandMappings: mappingsRes.data || [],
    wabaAccounts: wabaRes.data || [],
    wabaLogs: wabaLogsRes.data || [],
  };
}

export async function saveMetaAccounts(
  rows: Array<{
    account_id: string;
    account_name: string;
    store: string;
    default_source: string;
    default_advertiser: string;
  }>
) {
  await requireAdminAccess('admin:meta', 'Admin Meta');

  const sanitizedRows = (rows || [])
    .map((row) => ({
      account_id: String(row.account_id || '').trim(),
      account_name: String(row.account_name || '').trim(),
      store: String(row.store || '').trim(),
      default_source: String(row.default_source || '').trim() || 'Facebook Ads',
      default_advertiser: String(row.default_advertiser || '').trim() || 'Meta Team',
    }))
    .filter((row) => row.account_id && row.account_name && row.store);

  if (sanitizedRows.length === 0) {
    throw new Error('Tidak ada akun Meta yang valid untuk disimpan.');
  }

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('meta_ad_accounts')
    .upsert(sanitizedRows, { onConflict: 'account_id' });

  if (error) throw error;
  return { success: true, saved: sanitizedRows.length };
}

export async function updateMetaAccount(
  id: number,
  payload: {
    account_name: string;
    store: string;
    default_source: string;
    default_advertiser: string;
  }
) {
  await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('meta_ad_accounts')
    .update({
      account_name: payload.account_name.trim(),
      store: payload.store.trim(),
      default_source: payload.default_source.trim(),
      default_advertiser: payload.default_advertiser.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
  return { success: true };
}

export async function setMetaAccountActive(id: number, isActive: boolean) {
  await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('meta_ad_accounts')
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
  return { success: true };
}

export async function saveWabaAccount(payload: {
  waba_id: string;
  waba_name: string;
  store: string;
  default_source: string;
  default_advertiser: string;
}) {
  await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('waba_accounts')
    .upsert(
      {
        waba_id: payload.waba_id.trim(),
        waba_name: payload.waba_name.trim(),
        store: payload.store.trim(),
        default_source: payload.default_source.trim() || 'WhatsApp Marketing',
        default_advertiser: payload.default_advertiser.trim() || 'WhatsApp Team',
      },
      { onConflict: 'waba_id' }
    );

  if (error) throw error;
  return { success: true };
}

export async function updateWabaAccount(
  id: number,
  payload: {
    waba_name: string;
    store: string;
    default_source: string;
    default_advertiser: string;
  }
) {
  await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('waba_accounts')
    .update({
      waba_name: payload.waba_name.trim(),
      store: payload.store.trim(),
      default_source: payload.default_source.trim(),
      default_advertiser: payload.default_advertiser.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
  return { success: true };
}

export async function setWabaAccountActive(id: number, isActive: boolean) {
  await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('waba_accounts')
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
  return { success: true };
}

export async function getShopeeAdminSnapshot() {
  await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const [shopsRes, tokensRes, logsRes, mappingsRes, streamsRes] = await Promise.all([
    svc.from('shopee_shops').select('*').order('shop_name'),
    svc.from('shopee_shop_tokens').select('shop_config_id, token_expires_at'),
    svc.from('shopee_sync_log').select('*').order('created_at', { ascending: false }).limit(5),
    svc.from('ads_store_brand_mapping').select('store_pattern, brand').order('brand').order('store_pattern'),
    svc.from('shopee_shop_spend_streams').select('*').order('shop_config_id').order('stream_key'),
  ]);

  if (shopsRes.error) throw shopsRes.error;
  if (tokensRes.error) throw tokensRes.error;
  if (logsRes.error) throw logsRes.error;
  if (mappingsRes.error) throw mappingsRes.error;
  if (streamsRes.error) throw streamsRes.error;

  const tokenMap = new Map(
    (tokensRes.data || []).map((row: any) => [row.shop_config_id, row.token_expires_at || null])
  );
  const defaultStreamMap = new Map(
    listShopeeSpendStreamDefinitions().map((definition) => [definition.key, definition]),
  );
  const streamRows = (streamsRes.data || []) as Array<{
    id: number;
    shop_config_id: number;
    stream_key: ShopeeSpendStreamKey;
    default_source: string;
    default_advertiser: string;
    sync_mode: ShopeeSpendSyncMode;
    is_enabled: boolean;
  }>;
  const streamsByShopId = new Map<number, typeof streamRows>();

  for (const row of streamRows) {
    if (!streamsByShopId.has(row.shop_config_id)) {
      streamsByShopId.set(row.shop_config_id, []);
    }
    streamsByShopId.get(row.shop_config_id)!.push(row);
  }

  const decorateSpendStream = (
    shopId: number,
    stream: {
      id?: number | null;
      shop_config_id?: number;
      stream_key: ShopeeSpendStreamKey;
      default_source: string;
      default_advertiser: string;
      sync_mode: ShopeeSpendSyncMode;
      is_enabled: boolean;
    },
  ) => {
    const definition = defaultStreamMap.get(stream.stream_key);
    return {
      id: stream.id ?? null,
      shop_config_id: stream.shop_config_id ?? shopId,
      stream_key: stream.stream_key,
      default_source: stream.default_source,
      default_advertiser: stream.default_advertiser,
      sync_mode: stream.sync_mode,
      is_enabled: stream.is_enabled,
      label: definition?.label || stream.default_source,
      api_supported: definition?.apiSupported || false,
      description: definition?.description || '',
    };
  };

  return {
    setup: getShopeeSetupInfo(),
    shops: (shopsRes.data || []).map((shop: any) => ({
      ...shop,
      has_tokens: tokenMap.has(shop.id),
      token_expires_at: tokenMap.get(shop.id) || null,
      spend_streams: (
        streamsByShopId.get(shop.id)
          || buildDefaultShopeeSpendStreams(
            String(shop.shop_name || '').trim() || 'Shopee Shop',
            shop.default_source,
            shop.default_advertiser,
          ).map((stream) => ({
            id: null,
            shop_config_id: shop.id,
            ...stream,
          }))
      ).map((stream) => decorateSpendStream(shop.id, stream)),
    })),
    recentLogs: logsRes.data || [],
    brandMappings: mappingsRes.data || [],
  };
}

export async function updateShopeeShop(
  id: number,
  payload: {
    marketplace_source_key: string | null;
    store: string | null;
    spend_streams: Array<{
      stream_key: ShopeeSpendStreamKey;
      default_source: string;
      default_advertiser: string;
      sync_mode: ShopeeSpendSyncMode;
      is_enabled: boolean;
    }>;
  }
) {
  await requireAdminAccess('admin:meta', 'Admin Meta');

  const sourceKey = normalizeOptionalText(payload.marketplace_source_key)?.toLowerCase() || null;
  const sourceConfig = sourceKey
    ? listMarketplaceIntakeSourceConfigs().find(
        (config) => config.platform === 'shopee' && config.sourceKey === sourceKey,
      ) || null
    : null;
  if (sourceKey && !sourceConfig) {
    throw new Error('Source marketplace Shopee tidak dikenali.');
  }

  const svc = createServiceSupabase();
  const normalizedStreams = (payload.spend_streams || []).map((stream) => normalizeShopeeSpendStreamConfig(stream));
  const streamKeys = new Set(normalizedStreams.map((stream) => stream.stream_key));
  for (const definition of listShopeeSpendStreamDefinitions()) {
    if (!streamKeys.has(definition.key)) {
      normalizedStreams.push(
        normalizeShopeeSpendStreamConfig({
          stream_key: definition.key,
          default_source: definition.defaultSource,
          default_advertiser: 'Shopee Shop',
          sync_mode: definition.defaultSyncMode,
          is_enabled: definition.defaultEnabled,
        }),
      );
    }
  }

  const { error } = await svc
    .from('shopee_shops')
    .update({
      marketplace_source_key: sourceKey,
      store: normalizeOptionalText(payload.store),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;

  const { data: shopRow, error: shopError } = await svc
    .from('shopee_shops')
    .select('shop_name')
    .eq('id', id)
    .single();

  if (shopError) throw shopError;

  const shopName = String(shopRow.shop_name || '').trim() || 'Shopee Shop';
  const rows = normalizedStreams.map((stream) => ({
    shop_config_id: id,
    stream_key: stream.stream_key,
    default_source: stream.default_source,
    default_advertiser: String(stream.default_advertiser || '').trim() || shopName,
    sync_mode: stream.sync_mode,
    is_enabled: stream.is_enabled,
    updated_at: new Date().toISOString(),
  }));

  const { error: streamError } = await svc
    .from('shopee_shop_spend_streams')
    .upsert(rows, { onConflict: 'shop_config_id,stream_key' });

  if (streamError) throw streamError;

  return { success: true };
}

export async function setShopeeShopActive(id: number, isActive: boolean) {
  await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('shopee_shops')
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) throw error;
  return { success: true };
}

export async function getCsvUploadHistory() {
  await requireAdminAccess('admin:daily', 'Admin Daily Data');

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_sync_log')
    .select('*')
    .in('sync_type', ['csv_upload', 'ops_upload', 'marketplace_api_upload'])
    .order('started_at', { ascending: false })
    .limit(5);

  if (error) throw error;
  return data || [];
}
