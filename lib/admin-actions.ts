'use server';

import { createServerSupabase, createServiceSupabase } from './supabase-server';
import { requireDashboardPermissionAccess, requireDashboardRoles } from './dashboard-access';
import { MATRIX_ROLES, PERMISSION_GROUPS } from './utils';
import { getShopeeSetupInfo } from './shopee-open-platform';
import { resolveWorkspaceMarketplaceIntakeSourceConfig } from './marketplace-intake-workspace-sources';
import {
  resolveWorkspaceCredential,
  resolveWorkspaceIntegrationValue,
} from './workspace-integration-server';
import {
  buildDefaultShopeeSpendStreams,
  isShopeeSpendStreamKey,
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

  return { success: true, count: rows.length };
}

export async function getMetaAdminSnapshot() {
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const [accountsRes, logsRes, brandsRes, wabaRes, wabaLogsRes] = await Promise.all([
    svc.from('meta_ad_accounts').select('*').eq('workspace_id', workspaceId).order('account_name'),
    svc.from('meta_sync_log').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(5),
    svc.from('brands').select('id, name, is_active').eq('workspace_id', workspaceId).order('name'),
    svc.from('waba_accounts').select('*').eq('workspace_id', workspaceId).order('waba_name'),
    svc.from('waba_sync_log').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(5),
  ]);

  if (accountsRes.error) throw accountsRes.error;
  if (logsRes.error) throw logsRes.error;
  if (brandsRes.error) throw brandsRes.error;
  if (wabaRes.error) throw wabaRes.error;
  if (wabaLogsRes.error) throw wabaLogsRes.error;

  const brandNameById = new Map(
    (brandsRes.data || []).map(brand => [Number(brand.id), String(brand.name)]),
  );

  return {
    accounts: (accountsRes.data || []).map(account => ({
      ...account,
      brand_name: account.default_brand_id
        ? brandNameById.get(Number(account.default_brand_id)) || null
        : null,
    })),
    recentLogs: logsRes.data || [],
    brands: brandsRes.data || [],
    wabaAccounts: (wabaRes.data || []).map(account => ({
      ...account,
      brand_name: account.default_brand_id
        ? brandNameById.get(Number(account.default_brand_id)) || null
        : null,
    })),
    wabaLogs: wabaLogsRes.data || [],
  };
}

export type MetaCredentialStatus = {
  configured: boolean;
  available: boolean;
  storage: 'vault' | 'runtime' | 'none';
  businessId: string | null;
  canManage: boolean;
  displayName: string | null;
  validatedActorName: string | null;
  validatedAt: string | null;
  updatedAt: string | null;
};

export async function getMetaCredentialStatus(): Promise<MetaCredentialStatus> {
  const access = await requireAdminAccess('admin:meta', 'Admin Meta');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('workspace_integrations')
    .select('display_name, credential_reference, config, updated_at')
    .eq('workspace_id', access.workspaceId)
    .eq('provider', 'meta')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  const reference = String(data?.credential_reference || '').trim();
  let available = false;
  if (reference) {
    try {
      await resolveWorkspaceCredential({
        supabase: svc,
        workspaceId: access.workspaceId,
        provider: 'meta',
        fallbackEnvKeys: ['META_ACCESS_TOKEN'],
      });
      available = true;
    } catch {
      available = false;
    }
  }

  const businessId = await resolveWorkspaceIntegrationValue({
    supabase: svc,
    workspaceId: access.workspaceId,
    provider: 'meta',
    configKey: 'business_id',
    referenceConfigKey: 'business_id_reference',
    fallbackEnvKeys: ['META_BUSINESS_ID'],
  });
  const config = data?.config && typeof data.config === 'object'
    ? data.config as Record<string, unknown>
    : {};

  return {
    configured: Boolean(reference),
    available,
    storage: reference.startsWith('vault:')
      ? 'vault'
      : reference
        ? 'runtime'
        : 'none',
    businessId,
    canManage: access.profile.role === 'owner',
    displayName: String(data?.display_name || '').trim() || null,
    validatedActorName: String(config.validated_actor_name || '').trim() || null,
    validatedAt: String(config.validated_at || '').trim() || null,
    updatedAt: data?.updated_at || null,
  };
}

async function fetchMetaCredentialIdentity(accessToken: string, businessId: string | null) {
  const requestMetaObject = async (objectId: string, label: string) => {
    const params = new URLSearchParams({ fields: 'id,name' });
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(objectId)}?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.error) {
      throw new Error(
        body?.error?.message
          ? `${label}: ${body.error.message}`
          : `${label} tidak dapat diverifikasi ke Meta.`,
      );
    }
    return body as { id?: string; name?: string };
  };

  const actor = await requestMetaObject('me', 'Access token Meta tidak valid');
  const business = businessId
    ? await requestMetaObject(businessId, 'Business Manager ID tidak dapat diakses oleh token ini')
    : null;

  return {
    actorId: String(actor.id || '').trim() || null,
    actorName: String(actor.name || '').trim() || null,
    businessName: String(business?.name || '').trim() || null,
  };
}

export async function saveMetaCredential(payload: {
  accessToken?: string;
  businessId?: string;
}) {
  const { workspaceId } = await requireOwnerAccess('Meta API Credential');
  const svc = createServiceSupabase();
  const accessToken = String(payload?.accessToken || '').trim();
  const businessId = String(payload?.businessId || '').trim() || null;

  if (businessId && !/^\d{5,30}$/.test(businessId)) {
    throw new Error('Business Manager ID harus berupa angka.');
  }

  const { data: existing, error: existingError } = await svc
    .from('workspace_integrations')
    .select('id, external_account_id, display_name, credential_reference, config')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'meta')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;

  let tokenToValidate = accessToken;
  if (!tokenToValidate && existing?.credential_reference) {
    try {
      tokenToValidate = await resolveWorkspaceCredential({
        supabase: svc,
        workspaceId,
        provider: 'meta',
        fallbackEnvKeys: ['META_ACCESS_TOKEN'],
      });
    } catch {
      tokenToValidate = '';
    }
  }

  if (!tokenToValidate) {
    throw new Error('Masukkan Meta Access Token karena credential aktif belum tersedia.');
  }
  if (tokenToValidate.length < 20 || tokenToValidate.length > 10000) {
    throw new Error('Format Meta Access Token tidak valid.');
  }

  const identity = await fetchMetaCredentialIdentity(tokenToValidate, businessId);
  const validatedAt = new Date().toISOString();
  const currentConfig = existing?.config && typeof existing.config === 'object'
    ? existing.config as Record<string, unknown>
    : {};
  const config = {
    ...currentConfig,
    business_id: businessId,
    business_id_reference: null,
    validated_actor_id: identity.actorId,
    validated_actor_name: identity.actorName,
    validated_business_name: identity.businessName,
    validated_at: validatedAt,
  };

  if (accessToken) {
    const { error } = await svc.rpc('upsert_workspace_integration_vault_secret', {
      p_workspace_id: workspaceId,
      p_provider: 'meta',
      p_secret: accessToken,
      p_external_account_id: existing?.external_account_id || 'default',
      p_display_name: existing?.display_name || 'Meta Marketing API',
      p_config: config,
    });
    if (error) throw new Error(`Gagal menyimpan credential Meta: ${error.message}`);
  } else {
    if (!existing) {
      throw new Error('Konfigurasi Meta belum tersedia. Masukkan Meta Access Token.');
    }
    const { error } = await svc
      .from('workspace_integrations')
      .update({
        config,
        updated_at: validatedAt,
      })
      .eq('id', existing.id)
      .eq('workspace_id', workspaceId);
    if (error) throw error;
  }

  return {
    success: true,
    actorName: identity.actorName,
    businessName: identity.businessName,
    validatedAt,
  };
}

export async function saveMetaAccounts(
  rows: Array<{
    account_id: string;
    account_name: string;
    brand_id: number;
    default_source: string;
    default_advertiser: string;
  }>
) {
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

  const requestedRows = (rows || [])
    .map(row => ({
      account_id: String(row.account_id || '').trim(),
      account_name: String(row.account_name || '').trim(),
      brand_id: Number(row.brand_id),
      default_source: String(row.default_source || '').trim() || 'Facebook Ads',
      default_advertiser: String(row.default_advertiser || '').trim() || 'Meta Team',
    }))
    .filter(row => row.account_id && row.account_name && Number.isInteger(row.brand_id));

  if (requestedRows.length === 0) {
    throw new Error('Tidak ada akun Meta dengan brand canonical yang valid untuk disimpan.');
  }

  const svc = createServiceSupabase();
  const brandIds = Array.from(new Set(requestedRows.map(row => row.brand_id)));
  const { data: brands, error: brandsError } = await svc
    .from('brands')
    .select('id, name, is_active')
    .eq('workspace_id', workspaceId)
    .in('id', brandIds);
  if (brandsError) throw brandsError;

  const brandById = new Map((brands || []).map(brand => [Number(brand.id), brand]));
  const missingBrand = brandIds.find(brandId => !brandById.get(brandId)?.is_active);
  if (missingBrand !== undefined) {
    throw new Error(`Brand ${missingBrand} tidak tersedia atau tidak aktif di workspace ini.`);
  }

  const sanitizedRows = requestedRows.map(row => {
    const brand = brandById.get(row.brand_id)!;
    return {
      workspace_id: workspaceId,
      account_id: row.account_id,
      account_name: row.account_name,
      default_brand_id: row.brand_id,
      store: String(brand.name),
      default_source: row.default_source,
      default_advertiser: row.default_advertiser,
    };
  });

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
    brand_id: number;
    default_source: string;
    default_advertiser: string;
  }
) {
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const { data: brand, error: brandError } = await svc
    .from('brands')
    .select('id, name, is_active')
    .eq('workspace_id', workspaceId)
    .eq('id', Number(payload.brand_id))
    .maybeSingle();
  if (brandError) throw brandError;
  if (!brand?.is_active) throw new Error('Brand canonical tidak tersedia atau tidak aktif.');

  const { error } = await svc
    .from('meta_ad_accounts')
    .update({
      account_name: payload.account_name.trim(),
      default_brand_id: Number(brand.id),
      store: String(brand.name),
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
  brand_id: number;
  default_source: string;
  default_advertiser: string;
}) {
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const { data: brand, error: brandError } = await svc
    .from('brands')
    .select('id, name, is_active')
    .eq('workspace_id', workspaceId)
    .eq('id', Number(payload.brand_id))
    .maybeSingle();
  if (brandError) throw brandError;
  if (!brand?.is_active) throw new Error('Brand canonical tidak tersedia atau tidak aktif.');

  const { error } = await svc
    .from('waba_accounts')
    .upsert(
      {
        waba_id: payload.waba_id.trim(),
        workspace_id: workspaceId,
        waba_name: payload.waba_name.trim(),
        default_brand_id: Number(brand.id),
        store: String(brand.name),
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
    brand_id: number;
    default_source: string;
    default_advertiser: string;
  }
) {
  const { workspaceId } = await requireAdminAccess('admin:meta', 'Admin Meta');

  const svc = createServiceSupabase();
  const { data: brand, error: brandError } = await svc
    .from('brands')
    .select('id, name, is_active')
    .eq('workspace_id', workspaceId)
    .eq('id', Number(payload.brand_id))
    .maybeSingle();
  if (brandError) throw brandError;
  if (!brand?.is_active) throw new Error('Brand canonical tidak tersedia atau tidak aktif.');

  const { error } = await svc
    .from('waba_accounts')
    .update({
      waba_name: payload.waba_name.trim(),
      default_brand_id: Number(brand.id),
      store: String(brand.name),
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
  const sourceConfig = sourceKey
    ? await resolveWorkspaceMarketplaceIntakeSourceConfig(workspaceId, sourceKey)
    : null;
  if (sourceConfig && sourceConfig.platform !== 'shopee') {
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
