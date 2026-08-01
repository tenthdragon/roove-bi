'use server';

import {
  requireAnyDashboardPermissionAccess,
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from './dashboard-access';
import { createServerSupabase, createServiceSupabase } from './supabase-server';

export interface Brand {
  id: number;
  workspace_id: string;
  name: string;
  sheet_name: string;
  keywords: string | null;
  is_active: boolean;
  created_at: string;
}

export interface BrandBusinessRole {
  id: number;
  workspace_id: string;
  brand_id: number;
  business_id: number;
  role: 'owner' | 'seller' | 'operator';
  is_active: boolean;
}

export interface BrandAlias {
  id: number;
  workspace_id: string;
  brand_id: number;
  provider: string;
  alias_type: 'brand' | 'store' | 'product' | 'campaign' | 'other';
  alias: string;
  alias_normalized: string;
  is_active: boolean;
  notes: string | null;
}

export interface BrandBusiness {
  id: number;
  business_code: string;
  business_name: string;
  is_active: boolean;
}

export interface BrandUsage {
  products: number;
  metaAccounts: number;
  wabaAccounts: number;
}

export interface BrandConsolidationAuditRow {
  metric: string;
  total: number;
  resolved: number;
  unresolved: number;
}

export interface BrandCatalogSnapshot {
  brands: Brand[];
  businesses: BrandBusiness[];
  roles: BrandBusinessRole[];
  aliases: BrandAlias[];
  usage: Record<number, BrandUsage>;
  audit: BrandConsolidationAuditRow[];
}

async function requireBrandManageAccess(label: string = 'Brand') {
  const access = await requireDashboardTabAccess('warehouse-settings', label);
  await requireDashboardPermissionAccess('whs:brands', label);
  return access;
}

async function requireBrandReadAccess(label: string = 'Brand') {
  const access = await requireDashboardTabAccess('warehouse-settings', label);
  await requireAnyDashboardPermissionAccess(['whs:brands', 'whs:products'], label);
  return access;
}

// ── Fetch all brands (active + inactive) ──
export async function fetchAllBrands(): Promise<Brand[]> {
  const { workspaceId } = await requireBrandManageAccess('Daftar Brand');
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('brands')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('name', { ascending: true });
  if (error) throw error;
  return data as Brand[];
}

export async function getBrandCatalogSnapshot(): Promise<BrandCatalogSnapshot> {
  const { workspaceId } = await requireBrandManageAccess('Catalog Brand');
  const svc = createServiceSupabase();
  const [
    brandsRes,
    businessesRes,
    rolesRes,
    aliasesRes,
    productsRes,
    metaAccountsRes,
    wabaAccountsRes,
    auditRes,
  ] = await Promise.all([
    svc.from('brands').select('*').eq('workspace_id', workspaceId).order('name'),
    svc.from('scalev_webhook_businesses')
      .select('id, business_code, business_name, is_active')
      .eq('workspace_id', workspaceId)
      .order('business_code'),
    svc.from('business_brand_roles')
      .select('id, workspace_id, brand_id, business_id, role, is_active')
      .eq('workspace_id', workspaceId)
      .order('role'),
    svc.from('brand_aliases')
      .select('id, workspace_id, brand_id, provider, alias_type, alias, alias_normalized, is_active, notes')
      .eq('workspace_id', workspaceId)
      .order('provider')
      .order('alias'),
    svc.from('warehouse_products')
      .select('id, brand_id')
      .eq('owner_workspace_id', workspaceId)
      .not('brand_id', 'is', null),
    svc.from('meta_ad_accounts')
      .select('id, default_brand_id')
      .eq('workspace_id', workspaceId)
      .not('default_brand_id', 'is', null),
    svc.from('waba_accounts')
      .select('id, default_brand_id')
      .eq('workspace_id', workspaceId)
      .not('default_brand_id', 'is', null),
    svc.rpc('get_brand_consolidation_audit', { p_workspace_id: workspaceId }),
  ]);

  const results = [
    brandsRes,
    businessesRes,
    rolesRes,
    aliasesRes,
    productsRes,
    metaAccountsRes,
    wabaAccountsRes,
    auditRes,
  ];
  const failed = results.find(result => result.error);
  if (failed?.error) throw failed.error;

  const brands = (brandsRes.data || []) as Brand[];
  const usage = Object.fromEntries(
    brands.map(brand => [
      brand.id,
      { products: 0, metaAccounts: 0, wabaAccounts: 0 } satisfies BrandUsage,
    ]),
  ) as Record<number, BrandUsage>;

  for (const product of productsRes.data || []) {
    const brandId = Number(product.brand_id);
    if (usage[brandId]) usage[brandId].products += 1;
  }
  for (const account of metaAccountsRes.data || []) {
    const brandId = Number(account.default_brand_id);
    if (usage[brandId]) usage[brandId].metaAccounts += 1;
  }
  for (const account of wabaAccountsRes.data || []) {
    const brandId = Number(account.default_brand_id);
    if (usage[brandId]) usage[brandId].wabaAccounts += 1;
  }

  return {
    brands,
    businesses: (businessesRes.data || []) as BrandBusiness[],
    roles: (rolesRes.data || []) as BrandBusinessRole[],
    aliases: (aliasesRes.data || []) as BrandAlias[],
    usage,
    audit: ((auditRes.data || []) as Array<Record<string, unknown>>).map(row => ({
      metric: String(row.metric || ''),
      total: Number(row.total || 0),
      resolved: Number(row.resolved || 0),
      unresolved: Number(row.unresolved || 0),
    })),
  };
}

// ── Fetch only active brands ──
export async function fetchActiveBrands(): Promise<Brand[]> {
  const { workspaceId } = await requireBrandReadAccess('Brand Aktif');
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from('brands')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw error;
  return data as Brand[];
}

// ── Fetch active brand names (lightweight, for dashboard filtering) ──
export async function fetchActiveBrandNames(): Promise<string[]> {
  const brands = await fetchActiveBrands();
  return brands.map(b => b.name);
}

// ── Add a new brand ──
export async function addBrand(name: string, sheetName: string): Promise<{ success: boolean; error?: string }> {
  const { workspaceId } = await requireBrandManageAccess('Brand');
  const svc = createServiceSupabase();

  // Check for case-insensitive duplicate
  const { data: existing } = await svc
    .from('brands')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .ilike('name', name);

  if (existing && existing.length > 0) {
    return { success: false, error: `Brand "${existing[0].name}" sudah ada` };
  }

  // Check for sheet_name duplicate
  const { data: existingSheet } = await svc
    .from('brands')
    .select('id, name, sheet_name')
    .eq('workspace_id', workspaceId)
    .ilike('sheet_name', sheetName);

  if (existingSheet && existingSheet.length > 0) {
    return { success: false, error: `Sheet "${sheetName}" sudah digunakan oleh brand "${existingSheet[0].name}"` };
  }

  const { error } = await svc
    .from('brands')
    .insert({
      workspace_id: workspaceId,
      name: name.trim(),
      sheet_name: sheetName.trim(),
    });

  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      return { success: false, error: 'Brand dengan nama ini sudah ada' };
    }
    throw error;
  }

  return { success: true };
}

export async function saveBrandBusinessRoles(payload: {
  brandId: number;
  ownerBusinessId: number | null;
  sellerBusinessIds: number[];
}): Promise<void> {
  const { workspaceId } = await requireBrandManageAccess('Relasi Business Brand');
  const svc = createServiceSupabase();
  const brandId = Number(payload.brandId);
  const ownerBusinessId = payload.ownerBusinessId == null
    ? null
    : Number(payload.ownerBusinessId);
  const sellerBusinessIds = Array.from(
    new Set((payload.sellerBusinessIds || []).map(Number).filter(Number.isInteger)),
  );

  if (!Number.isInteger(brandId)) throw new Error('Brand tidak valid.');
  if (ownerBusinessId !== null && !Number.isInteger(ownerBusinessId)) {
    throw new Error('Owner business tidak valid.');
  }

  const { error } = await svc.rpc('replace_workspace_brand_business_roles', {
    p_workspace_id: workspaceId,
    p_brand_id: brandId,
    p_owner_business_id: ownerBusinessId,
    p_seller_business_ids: sellerBusinessIds,
  });
  if (error) throw error;
}

export async function addBrandAlias(payload: {
  brandId: number;
  provider: string;
  aliasType: BrandAlias['alias_type'];
  alias: string;
  notes?: string | null;
}): Promise<void> {
  const { workspaceId } = await requireBrandManageAccess('Alias Brand');
  const svc = createServiceSupabase();
  const alias = String(payload.alias || '').trim();
  if (!alias) throw new Error('Alias wajib diisi.');

  const { error } = await svc.rpc('upsert_workspace_brand_alias', {
    p_workspace_id: workspaceId,
    p_brand_id: Number(payload.brandId),
    p_provider: String(payload.provider || 'generic').trim().toLowerCase(),
    p_alias_type: payload.aliasType,
    p_alias: alias,
    p_notes: String(payload.notes || '').trim() || null,
  });
  if (error) throw error;
}

export async function setBrandAliasActive(aliasId: number, isActive: boolean): Promise<void> {
  const { workspaceId } = await requireBrandManageAccess('Alias Brand');
  const svc = createServiceSupabase();
  const { error } = await svc.rpc('set_workspace_brand_alias_active', {
    p_workspace_id: workspaceId,
    p_alias_id: Number(aliasId),
    p_is_active: Boolean(isActive),
  });
  if (error) throw error;
}

// ── Update brand keywords ──
export async function updateBrandKeywords(brandId: number, keywords: string): Promise<void> {
  const { workspaceId } = await requireBrandManageAccess('Brand');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('brands')
    .update({ keywords: keywords.trim() || null })
    .eq('id', brandId)
    .eq('workspace_id', workspaceId);

  if (error) throw error;
}

// ── Toggle brand active/inactive ──
export async function toggleBrand(brandId: number, isActive: boolean): Promise<void> {
  const { workspaceId } = await requireBrandManageAccess('Brand');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('brands')
    .update({ is_active: isActive })
    .eq('id', brandId)
    .eq('workspace_id', workspaceId);

  if (error) throw error;
}

// ── Legacy destructive API retained only to fail safely for old clients. ──
export async function deleteBrandPermanently(brandId: number): Promise<{ success: boolean; deleted: Record<string, number> }> {
  await requireBrandManageAccess('Brand');
  void brandId;
  throw new Error('Brand canonical tidak dapat dihapus permanen. Nonaktifkan brand agar data historis tetap utuh.');
}
