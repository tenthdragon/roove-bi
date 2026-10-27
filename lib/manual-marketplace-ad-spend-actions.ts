'use server';

import { requireDashboardRoles } from './dashboard-access';
import { createServiceSupabase } from './service-supabase';
import { createServerSupabase } from './supabase-server';
import { isWorkspaceModuleEnabled } from './workspaces';
import {
  isManualMarketplacePlatform,
  MANUAL_MARKETPLACE_PLATFORMS,
  type ManualMarketplacePlatform,
} from './manual-marketplace-ad-spend';

function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Bulan tidak valid.');
  const [year, monthNumber] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  return { start: `${month}-01`, end };
}

async function getSheetFallbackRows(
  workspaceId: string,
  platforms: ManualMarketplacePlatform[],
  start: string,
  end: string,
) {
  const svc = createServiceSupabase();
  const rows: Array<{ date: string; platform: ManualMarketplacePlatform; brand_id: number; spent: number }> = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await svc.from('manual_marketplace_sheet_fallback')
      .select('date,platform,brand_id,spent')
      .eq('workspace_id', workspaceId).in('platform', platforms)
      .gte('date', start).lte('date', end)
      .order('date').order('brand_id').range(offset, offset + 999);
    if (page.error) throw new Error('Gagal memuat fallback spreadsheet.');
    rows.push(...((page.data || []) as typeof rows));
    if ((page.data || []).length < 1000) break;
  }
  const grouped = new Map<string, { date: string; platform: ManualMarketplacePlatform; brand_id: number; amount: number }>();
  for (const row of rows) {
    const key = `${row.date}|${row.platform}|${row.brand_id}`;
    const current = grouped.get(key) || { date: row.date, platform: row.platform, brand_id: row.brand_id, amount: 0 };
    current.amount += Math.abs(Number(row.spent || 0));
    grouped.set(key, current);
  }
  return [...grouped.values()];
}

export async function getAdvertiserSpendAccess(userId: string) {
  const { workspaceId } = await requireDashboardRoles(['owner'], 'Hanya owner workspace yang dapat mengatur akses input iklan.');
  const svc = createServiceSupabase();
  const [member, grants, cutover] = await Promise.all([
    svc.from('workspace_memberships').select('role,status').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle(),
    svc.from('workspace_advertiser_spend_access').select('platform').eq('workspace_id', workspaceId).eq('user_id', userId),
    svc.from('manual_marketplace_ad_spend_cutovers').select('starts_on').eq('workspace_id', workspaceId).maybeSingle(),
  ]);
  if (member.error || member.data?.role !== 'advertiser' || member.data.status !== 'active') {
    throw new Error('Advertiser tidak aktif di workspace ini.');
  }
  if (grants.error || cutover.error) throw new Error('Fitur input iklan belum tersedia di database.');
  return {
    workspaceId,
    enabled: Boolean(cutover.data),
    platforms: (grants.data || []).map((row) => row.platform).filter(isManualMarketplacePlatform),
  };
}

export async function saveAdvertiserSpendAccess(
  userId: string,
  platforms: ManualMarketplacePlatform[],
  expectedWorkspaceId: string,
) {
  const { workspaceId } = await requireDashboardRoles(['owner'], 'Hanya owner workspace yang dapat mengatur akses input iklan.');
  if (workspaceId !== expectedWorkspaceId) throw new Error('Workspace berubah. Muat ulang sebelum menyimpan.');
  if (!Array.isArray(platforms) || platforms.length > MANUAL_MARKETPLACE_PLATFORMS.length
    || platforms.some((platform) => !isManualMarketplacePlatform(platform))) {
    throw new Error('Pilihan platform tidak valid.');
  }
  const { data, error } = await createServerSupabase().rpc('set_workspace_advertiser_spend_access', {
    p_workspace_id: workspaceId,
    p_user_id: userId,
    p_platforms: [...new Set(platforms)].sort(),
  });
  if (error) throw new Error(error.message);
  return { platforms: data as ManualMarketplacePlatform[] };
}

export async function getManualMarketplaceSpendPage(month: string) {
  const ctx = await requireDashboardRoles(['owner', 'advertiser'], 'Halaman input iklan hanya tersedia untuk advertiser.');
  if (!isWorkspaceModuleEnabled(ctx.workspace, 'marketing') || !isWorkspaceModuleEnabled(ctx.workspace, 'manual-ad-spend')) {
    throw new Error('Input iklan tidak diaktifkan untuk workspace ini.');
  }
  const { start, end } = monthRange(month);
  const svc = createServiceSupabase();
  const policy = await svc.from('manual_marketplace_ad_spend_cutovers')
    .select('starts_on').eq('workspace_id', ctx.workspaceId).maybeSingle();
  if (policy.error) throw new Error('Fitur input iklan belum tersedia di database.');
  if (!policy.data) throw new Error('Input iklan belum aktif untuk workspace ini.');

  let platforms = MANUAL_MARKETPLACE_PLATFORMS;
  if (ctx.profile.role === 'advertiser') {
    const grants = await svc.from('workspace_advertiser_spend_access')
      .select('platform').eq('workspace_id', ctx.workspaceId).eq('user_id', ctx.profile.id);
    if (grants.error) throw new Error('Gagal memverifikasi akses input iklan.');
    platforms = (grants.data || []).map((row) => row.platform).filter(isManualMarketplacePlatform);
    if (platforms.length === 0) throw new Error('Akun ini belum diberi akses input Shopee Ads atau TikTok Ads.');
  }

  let historyQuery = svc.from('manual_marketplace_ad_spend_audit')
    .select('id,entry_id,platform,action,before_value,after_value,changed_by,changed_at')
    .eq('workspace_id', ctx.workspaceId).in('platform', platforms);
  if (ctx.profile.role === 'advertiser') historyQuery = historyQuery.eq('changed_by', ctx.profile.id);

  const [brands, entries, history, fallbackRows] = await Promise.all([
    svc.from('brands').select('id,name,is_active').eq('workspace_id', ctx.workspaceId).order('name'),
    svc.from('manual_marketplace_ad_spend')
      .select('id,platform,brand_id,spend_date,amount,note,created_by,updated_by,created_at,updated_at,version')
      .eq('workspace_id', ctx.workspaceId).in('platform', platforms)
      .gte('spend_date', start).lte('spend_date', end)
      .order('spend_date', { ascending: false }).order('brand_id'),
    historyQuery.order('changed_at', { ascending: false }).limit(50),
    getSheetFallbackRows(ctx.workspaceId, platforms, start, end),
  ]);
  if (brands.error || entries.error || history.error) throw new Error('Gagal memuat catatan biaya iklan.');
  const actorNames: Record<string, string> = {};
  if (ctx.profile.role === 'owner') {
    const actorIds = [...new Set([
      ...(entries.data || []).map((row) => row.created_by),
      ...(history.data || []).map((row) => row.changed_by),
    ])];
    if (actorIds.length > 0) {
      const actors = await svc.from('profiles').select('id,full_name,email').in('id', actorIds);
      if (actors.error) throw new Error('Gagal memuat identitas pengisi log.');
      for (const actor of actors.data || []) actorNames[actor.id] = actor.full_name || actor.email;
    }
  }

  return {
    workspaceId: ctx.workspaceId,
    viewerId: ctx.profile.id,
    actorNames,
    canInput: ctx.profile.role === 'advertiser',
    startsOn: policy.data.starts_on as string,
    platforms,
    brands: (brands.data || []) as { id: number; name: string; is_active: boolean }[],
    entries: (entries.data || []) as Array<{
      id: number; platform: ManualMarketplacePlatform; brand_id: number; spend_date: string;
      amount: number; note: string; created_by: string; updated_by: string;
      created_at: string; updated_at: string; version: number;
    }>,
    fallbackRows,
    history: history.data || [],
  };
}

export async function saveManualMarketplaceSpend(input: {
  workspaceId: string;
  id: number | null;
  platform: ManualMarketplacePlatform;
  brandId: number;
  date: string;
  amount: number;
  note: string;
  version: number | null;
}) {
  const ctx = await requireDashboardRoles(['advertiser'], 'Hanya advertiser yang dapat mengisi biaya iklan.');
  if (ctx.workspaceId !== input.workspaceId) throw new Error('Workspace berubah. Muat ulang sebelum menyimpan.');
  if (!isManualMarketplacePlatform(input.platform) || !Number.isSafeInteger(input.brandId) || input.brandId <= 0
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(input.amount)
    || input.amount < 0 || input.amount > 1_000_000_000_000 || !Number.isInteger(input.amount * 100)
    || typeof input.note !== 'string' || input.note.length > 500
    || (input.id !== null && (!Number.isSafeInteger(input.id) || input.id <= 0 || !Number.isSafeInteger(input.version)))) {
    throw new Error('Input biaya iklan tidak valid.');
  }
  const { data, error } = await createServerSupabase().rpc('save_manual_marketplace_ad_spend', {
    p_workspace_id: ctx.workspaceId,
    p_entry_id: input.id,
    p_platform: input.platform,
    p_brand_id: input.brandId,
    p_spend_date: input.date,
    p_amount: input.amount,
    p_note: input.note.trim(),
    p_expected_version: input.version,
  });
  if (error) throw new Error(error.message);
  return { id: Number(data) };
}

export async function deleteManualMarketplaceSpend(input: {
  workspaceId: string; id: number; version: number;
}) {
  const ctx = await requireDashboardRoles(['advertiser'], 'Hanya advertiser yang dapat mengoreksi biaya iklan.');
  if (ctx.workspaceId !== input.workspaceId) throw new Error('Workspace berubah. Muat ulang sebelum menghapus.');
  if (!Number.isSafeInteger(input.id) || input.id <= 0 || !Number.isSafeInteger(input.version) || input.version <= 0) {
    throw new Error('Input biaya iklan tidak valid.');
  }
  const { error } = await createServerSupabase().rpc('delete_manual_marketplace_ad_spend', {
    p_workspace_id: ctx.workspaceId,
    p_entry_id: input.id,
    p_expected_version: input.version,
  });
  if (error) throw new Error(error.message);
  return { deleted: true };
}
