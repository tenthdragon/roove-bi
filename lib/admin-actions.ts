'use server';

import { createServerSupabase, createServiceSupabase } from './supabase-server';
import { requireDashboardPermissionAccess, requireDashboardRoles } from './dashboard-access';
import { MATRIX_ROLES, PERMISSION_GROUPS } from './utils';
import { getShopeeSetupInfo } from './shopee-open-platform';
import { listMarketplaceIntakeSourceConfigs } from './marketplace-intake-sources';
import {
  buildDefaultShopeeSpendStreams,
  isShopeeSpendStreamKey,
  listShopeeSpendStreamDefinitions,
  normalizeShopeeSpendStreamConfig,
  type ShopeeSpendStreamKey,
  type ShopeeSpendSyncMode,
} from './shopee-streams';
import { ROOVE_WORKSPACE_ID } from './workspaces';

const MATRIX_ROLE_IDS = new Set(MATRIX_ROLES.map((role) => role.id));
const KNOWN_PERMISSION_KEYS = new Set(
  PERMISSION_GROUPS.flatMap((group) => group.keys.map((permission) => permission.key))
);

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function findShopeeMarketplaceSourceConfig(sourceKey: string | null | undefined) {
  const normalizedKey = String(sourceKey || '').trim().toLowerCase();
  if (!normalizedKey) return null;
  return (
    listMarketplaceIntakeSourceConfigs().find(
      (config) => config.platform === 'shopee' && config.sourceKey === normalizedKey,
    ) || null
  );
}

async function requireOwnerAccess(label: string) {
  return requireDashboardRoles(['owner'], `Hanya owner yang bisa mengakses ${label}.`);
}

async function requireAdminAccess(permissionKey: string, label: string) {
  return requireDashboardPermissionAccess(permissionKey, label);
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

  let access;
  try {
    access = await requireOwnerAccess('Admin Users');
  } catch {
    return { profile, users: [] };
  }

  const svc = createServiceSupabase();
  const { data: memberships, error: membershipsError } = await svc
    .from('workspace_memberships')
    .select('user_id, role, status, created_at')
    .eq('workspace_id', access.workspaceId)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (membershipsError) throw membershipsError;

  const memberIds = (memberships || []).map((membership) => membership.user_id);
  if (memberIds.length === 0) {
    return { profile: { ...profile, role: 'owner' }, users: [] };
  }

  const { data: profiles, error: usersError } = await svc
    .from('profiles')
    .select('*')
    .in('id', memberIds);

  if (usersError) throw usersError;

  const roleByUser = new Map(
    (memberships || []).map((membership) => [
      membership.user_id,
      membership.role === 'workspace_owner' ? 'owner' : membership.role,
    ]),
  );
  const users = (profiles || [])
    .map((memberProfile) => ({
      ...memberProfile,
      role: roleByUser.get(memberProfile.id) || memberProfile.role,
    }))
    .sort(
      (a, b) =>
        memberIds.indexOf(a.id) - memberIds.indexOf(b.id),
    );

  return { profile: { ...profile, role: 'owner' }, users };
}

export async function getAdminLogsSnapshot() {
  const { workspaceId } = await requireAdminAccess('admin:logs', 'Admin Logs');

  const svc = createServiceSupabase();
  const [syncLogsRes, importsRes] = await Promise.all([
    svc.from('scalev_sync_log').select('*').eq('workspace_id', workspaceId).order('started_at', { ascending: false }).limit(100),
    svc.from('data_imports').select('*').eq('workspace_id', workspaceId).order('imported_at', { ascending: false }).limit(100),
  ]);

  if (syncLogsRes.error) throw syncLogsRes.error;
  if (importsRes.error) throw importsRes.error;

  return {
    syncLogs: syncLogsRes.data || [],
    imports: importsRes.data || [],
  };
}

export async function getAdminDataReferenceSnapshot() {
  const { workspaceId } = await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const [mpFeeRes, taxRes, overheadRes] = await Promise.all([
    svc.from('marketplace_fee_estimate_rates').select('*').eq('workspace_id', workspaceId).order('setting_key').order('effective_from', { ascending: false }),
    svc.from('tax_rates').select('*').eq('workspace_id', workspaceId).order('name').order('effective_from', { ascending: false }),
    svc.from('monthly_overhead').select('*').eq('workspace_id', workspaceId).order('year_month', { ascending: false }),
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
  const { workspaceId } = await requireOwnerAccess('Admin Data Reference');

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
      workspace_id: workspaceId,
    },
    { onConflict: 'workspace_id,setting_key,effective_from' }
  );

  if (error) throw error;
  return { success: true };
}

export async function deleteMarketplaceFeeEstimateRate(id: number) {
  const { workspaceId } = await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('marketplace_fee_estimate_rates').delete().eq('id', id).eq('workspace_id', workspaceId);
  if (error) throw error;
  return { success: true };
}

export async function saveCommissionRate(row: { channel: string; rate: number; effective_from: string }) {
  const { workspaceId } = await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('marketplace_commission_rates').upsert(
    {
      channel: row.channel.trim(),
      rate: row.rate,
      effective_from: row.effective_from,
      workspace_id: workspaceId,
    },
    { onConflict: 'workspace_id,channel,effective_from' }
  );

  if (error) throw error;
  return { success: true };
}

export async function deleteCommissionRate(id: number) {
  const { workspaceId } = await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('marketplace_commission_rates').delete().eq('id', id).eq('workspace_id', workspaceId);
  if (error) throw error;
  return { success: true };
}

export async function saveTaxRate(row: { name: string; rate: number; effective_from: string }) {
  const { workspaceId } = await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('tax_rates').upsert(
    {
      name: row.name.trim(),
      rate: row.rate,
      effective_from: row.effective_from,
      workspace_id: workspaceId,
    },
    { onConflict: 'workspace_id,name,effective_from' }
  );

  if (error) throw error;
  return { success: true };
}

export async function deleteTaxRate(id: number) {
  const { workspaceId } = await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('tax_rates').delete().eq('id', id).eq('workspace_id', workspaceId);
  if (error) throw error;
  return { success: true };
}

export async function saveMonthlyOverhead(row: { year_month: string; amount: number }) {
  const { workspaceId } = await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('monthly_overhead').upsert(
    {
      year_month: row.year_month,
      amount: row.amount,
      workspace_id: workspaceId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,year_month' }
  );

  if (error) throw error;
  return { success: true };
}

export async function deleteMonthlyOverhead(id: number) {
  const { workspaceId } = await requireOwnerAccess('Admin Data Reference');

  const svc = createServiceSupabase();
  const { error } = await svc.from('monthly_overhead').delete().eq('id', id).eq('workspace_id', workspaceId);
  if (error) throw error;
  return { success: true };
}

export async function updateTelegramChatId(userId: string, telegramChatId: string | null) {
  const { workspaceId } = await requireOwnerAccess('Admin Users');

  const svc = createServiceSupabase();
  const { data: membership } = await svc
    .from('workspace_memberships')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();
  if (!membership) {
    throw new Error('User tidak terdaftar di workspace aktif.');
  }

  const { error } = await svc
    .from('profiles')
    .update({ telegram_chat_id: normalizeOptionalText(telegramChatId) })
    .eq('id', userId);

  if (error) throw error;
  return { success: true };
}

export async function getRolePermissionsMatrix() {
  const { workspaceId } = await requireOwnerAccess('Permission Matrix');

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('workspace_role_permissions')
    .select('role, permission_key')
    .eq('workspace_id', workspaceId);

  if (error) throw error;
  return data || [];
}

export async function saveRolePermissionsMatrix(matrix: Record<string, string[]>) {
  const { workspaceId } = await requireOwnerAccess('Permission Matrix');

  const rows = sanitizePermissionMatrix(matrix);
  const svc = createServiceSupabase();

  const { error: deleteError } = await svc
    .from('workspace_role_permissions')
    .delete()
    .eq('workspace_id', workspaceId);

  if (deleteError) throw deleteError;

  if (rows.length > 0) {
    const { error: insertError } = await svc
      .from('workspace_role_permissions')
      .insert(rows.map((row) => ({ ...row, workspace_id: workspaceId })));

    if (insertError) throw insertError;
  }

  // Legacy warehouse SQL still reads the global matrix. Keep it synchronized
  // only for Roove; Apurva permissions must never alter Roove behavior.
  if (workspaceId === ROOVE_WORKSPACE_ID) {
    const { error: legacyDeleteError } = await svc
      .from('role_permissions')
      .delete()
      .neq('role', 'owner');
    if (legacyDeleteError) throw legacyDeleteError;

    if (rows.length > 0) {
      const { error: legacyInsertError } = await svc
        .from('role_permissions')
        .insert(rows);
      if (legacyInsertError) throw legacyInsertError;
    }
  }

  return { success: true, count: rows.length };
}

export async function getMetaAdminSnapshot() {
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const [accountsRes, logsRes, mappingsRes, wabaRes, wabaLogsRes] = await Promise.all([
    svc.from('meta_ad_accounts').select('*').eq('workspace_id', workspaceId).order('account_name'),
    svc.from('meta_sync_log').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(5),
    svc.from('ads_store_brand_mapping').select('store_pattern, brand').eq('workspace_id', workspaceId).order('brand').order('store_pattern'),
    svc.from('waba_accounts').select('*').eq('workspace_id', workspaceId).order('waba_name'),
    svc.from('waba_sync_log').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(5),
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
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

  const sanitizedRows = (rows || [])
    .map((row) => ({
      workspace_id: workspaceId,
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
    .upsert(sanitizedRows, { onConflict: 'workspace_id,account_id' });

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
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

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
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) throw error;
  return { success: true };
}

export async function setMetaAccountActive(id: number, isActive: boolean) {
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('meta_ad_accounts')
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('workspace_id', workspaceId);

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
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('waba_accounts')
    .upsert(
      {
        waba_id: payload.waba_id.trim(),
        workspace_id: workspaceId,
        waba_name: payload.waba_name.trim(),
        store: payload.store.trim(),
        default_source: payload.default_source.trim() || 'WhatsApp Marketing',
        default_advertiser: payload.default_advertiser.trim() || 'WhatsApp Team',
      },
      { onConflict: 'workspace_id,waba_id' }
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
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

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
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) throw error;
  return { success: true };
}

export async function setWabaAccountActive(id: number, isActive: boolean) {
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('waba_accounts')
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) throw error;
  return { success: true };
}

export async function getShopeeAdminSnapshot() {
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const [shopsRes, tokensRes, logsRes, streamsRes] = await Promise.all([
    svc.from('shopee_shops').select('*').eq('workspace_id', workspaceId).order('shop_name'),
    svc.from('shopee_shop_tokens').select('shop_config_id, token_expires_at').eq('workspace_id', workspaceId),
    svc.from('shopee_sync_log').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(5),
    svc.from('shopee_shop_spend_streams').select('*').eq('workspace_id', workspaceId).order('shop_config_id').order('stream_key'),
  ]);

  if (shopsRes.error) throw shopsRes.error;
  if (tokensRes.error) throw tokensRes.error;
  if (logsRes.error) throw logsRes.error;
  if (streamsRes.error) throw streamsRes.error;

  const tokenMap = new Map(
    (tokensRes.data || []).map((row: any) => [row.shop_config_id, row.token_expires_at || null])
  );
  const defaultStreamMap = new Map(
    listShopeeSpendStreamDefinitions().map((definition) => [definition.key, definition]),
  );
  const streamRows = ((streamsRes.data || []) as Array<{
    id: number;
    shop_config_id: number;
    stream_key: string;
    default_source: string;
    default_advertiser: string;
    sync_mode: ShopeeSpendSyncMode;
    is_enabled: boolean;
  }>).filter((row) => isShopeeSpendStreamKey(row.stream_key));
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
      stream_key: string;
      default_source: string;
      default_advertiser: string;
      sync_mode: ShopeeSpendSyncMode;
      is_enabled: boolean;
    },
  ) => {
    const normalizedStream = normalizeShopeeSpendStreamConfig(stream);
    const definition = defaultStreamMap.get(normalizedStream.stream_key);
    return {
      id: stream.id ?? null,
      shop_config_id: stream.shop_config_id ?? shopId,
      stream_key: normalizedStream.stream_key,
      default_source: normalizedStream.default_source,
      default_advertiser: normalizedStream.default_advertiser,
      sync_mode: normalizedStream.sync_mode,
      is_enabled: normalizedStream.is_enabled,
      label: definition?.label || normalizedStream.default_source,
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
  };
}

export async function updateShopeeShop(
  id: number,
  payload: {
    marketplace_source_key: string | null;
    spend_streams: Array<{
      stream_key: ShopeeSpendStreamKey;
      default_source: string;
      default_advertiser: string;
      sync_mode: ShopeeSpendSyncMode;
      is_enabled: boolean;
    }>;
  }
) {
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

  const sourceKey = normalizeOptionalText(payload.marketplace_source_key)?.toLowerCase() || null;
  const sourceConfig = findShopeeMarketplaceSourceConfig(sourceKey);
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
      account_business_code: sourceConfig?.businessCode || null,
      viewer_business_code: sourceConfig?.businessCode || null,
      revenue_business_code: sourceConfig?.businessCode || null,
      default_owner_business_code: null,
      default_processor_business_code: null,
      store: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) throw error;

  const { data: shopRow, error: shopError } = await svc
    .from('shopee_shops')
    .select('shop_name')
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single();

  if (shopError) throw shopError;

  const shopName = String(shopRow.shop_name || '').trim() || 'Shopee Shop';
  const rows = normalizedStreams.map((stream) => ({
    workspace_id: workspaceId,
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
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const { error } = await svc
    .from('shopee_shops')
    .update({
      is_active: isActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('workspace_id', workspaceId);

  if (error) throw error;
  return { success: true };
}

export async function getCsvUploadHistory() {
  const { workspaceId } = await requireAdminAccess('admin:daily', 'Admin Daily Data');

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('scalev_sync_log')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('sync_type', ['csv_upload', 'ops_upload', 'marketplace_api_upload'])
    .order('started_at', { ascending: false })
    .limit(5);

  if (error) throw error;
  return data || [];
}
