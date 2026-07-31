'use server';

import { createServiceSupabase } from './supabase-server';
import {
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from './dashboard-access';

type WorkspaceWarehouseConfig = {
  entity: string;
  warehouse: string;
  baselineDate: string | null;
  goLiveAt: string | null;
};

async function loadIndependentWarehouseConfig(
  svc: ReturnType<typeof createServiceSupabase>,
  workspaceId: string,
): Promise<WorkspaceWarehouseConfig> {
  const [{ data: workspace, error: workspaceError }, { data: access, error: accessError }] = await Promise.all([
    svc.from('workspaces').select('settings').eq('id', workspaceId).maybeSingle(),
    svc
      .from('workspace_warehouse_access')
      .select('warehouse_code, access_level')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .eq('access_level', 'owner')
      .limit(1)
      .maybeSingle(),
  ]);
  if (workspaceError) throw workspaceError;
  if (accessError) throw accessError;

  const settings = (workspace?.settings || {}) as Record<string, unknown>;
  if (settings.warehouse_mode !== 'independent' || !access) {
    throw new Error('Warehouse independen belum dikonfigurasi. Jalankan migration 173 terlebih dahulu.');
  }

  const entity = String(settings.inventory_entity || '').trim();
  const warehouse = String(settings.warehouse_code || access.warehouse_code || '').trim();
  if (!entity || !warehouse) {
    throw new Error('Entity dan kode warehouse workspace belum lengkap.');
  }

  return {
    entity,
    warehouse,
    baselineDate: String(settings.warehouse_baseline_date || '').trim() || null,
    goLiveAt: String(settings.warehouse_go_live_at || '').trim() || null,
  };
}

async function requireIndependentWarehousePermission(permissionKey: string, label: string) {
  const tabAccess = await requireDashboardTabAccess('warehouse', label);
  const permissionAccess = await requireDashboardPermissionAccess(permissionKey, label);
  if (tabAccess.workspaceId !== permissionAccess.workspaceId) {
    throw new Error('Workspace aktif berubah. Muat ulang halaman dan coba lagi.');
  }
  return permissionAccess;
}

export async function getWorkspaceWarehouseState() {
  const { workspaceId } = await requireDashboardTabAccess('warehouse', 'Warehouse');
  const svc = createServiceSupabase();
  const config = await loadIndependentWarehouseConfig(svc, workspaceId);
  return {
    ...config,
    isGoLive: Boolean(config.goLiveAt && new Date(config.goLiveAt).getTime() <= Date.now()),
  };
}

export async function getWorkspaceWarehouseInventory() {
  const { workspaceId } = await requireDashboardTabAccess('warehouse', 'Warehouse');
  const svc = createServiceSupabase();
  const config = await loadIndependentWarehouseConfig(svc, workspaceId);

  const { data, error } = await svc
    .from('v_warehouse_stock_balance')
    .select('product_id, product_name, sku, category, entity, warehouse, unit, current_stock, weighted_hpp, stock_value, needs_reorder')
    .eq('workspace_id', workspaceId)
    .eq('entity', config.entity)
    .eq('warehouse', config.warehouse)
    .order('category')
    .order('product_name');

  if (error) throw error;
  const rows = data || [];
  return {
    rows,
    summary: {
      products: rows.length,
      totalUnits: rows.reduce((sum: number, row: any) => sum + Number(row.current_stock || 0), 0),
      stockValue: rows.reduce((sum: number, row: any) => sum + Number(row.stock_value || 0), 0),
      reorderCount: rows.filter((row: any) => row.needs_reorder).length,
    },
    config,
  };
}

export async function getWorkspaceWarehouseMovements(limit: number = 100) {
  const { workspaceId } = await requireDashboardTabAccess('warehouse', 'Movement Log');
  const svc = createServiceSupabase();
  const config = await loadIndependentWarehouseConfig(svc, workspaceId);
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const { data, error } = await svc
    .from('warehouse_stock_ledger')
    .select(`
      id,
      movement_type,
      quantity,
      running_balance,
      reference_type,
      reference_id,
      notes,
      created_at,
      warehouse_products!inner(id, name, unit, entity, warehouse, owner_workspace_id)
    `)
    .eq('workspace_id', workspaceId)
    .eq('warehouse_products.owner_workspace_id', workspaceId)
    .eq('warehouse_products.entity', config.entity)
    .eq('warehouse_products.warehouse', config.warehouse)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return data || [];
}

export async function getWorkspaceWarehouseMappings() {
  const { workspaceId } = await requireDashboardTabAccess('warehouse', 'Mapping Scalev');
  const svc = createServiceSupabase();
  await loadIndependentWarehouseConfig(svc, workspaceId);
  const { data, error } = await svc
    .from('warehouse_scalev_mapping')
    .select(`
      id,
      scalev_product_name,
      warehouse_product_id,
      deduct_qty_multiplier,
      is_ignored,
      notes,
      warehouse_products(id, name, entity, warehouse, owner_workspace_id)
    `)
    .eq('workspace_id', workspaceId)
    .order('scalev_product_name');
  if (error) throw error;

  return (data || []).map((row: any) => {
    const product = Array.isArray(row.warehouse_products)
      ? row.warehouse_products[0] || null
      : row.warehouse_products || null;
    return {
      ...row,
      warehouse_products: product?.owner_workspace_id === workspaceId ? product : null,
    };
  });
}

export async function syncWorkspaceWarehouseMappingNames() {
  const { workspaceId } = await requireIndependentWarehousePermission('wh:mapping_sync', 'Sync Mapping Scalev');
  const svc = createServiceSupabase();
  await loadIndependentWarehouseConfig(svc, workspaceId);
  const { data: lines, error: lineError } = await svc
    .from('scalev_order_lines')
    .select('product_name')
    .eq('workspace_id', workspaceId)
    .not('product_name', 'is', null)
    .limit(10000);
  if (lineError) throw lineError;

  const names = Array.from(new Set(
    (lines || []).map((line: any) => String(line.product_name || '').trim()).filter(Boolean),
  ));
  if (names.length === 0) return { success: true, names: 0 };

  const { error } = await svc
    .from('warehouse_scalev_mapping')
    .upsert(
      names.map((scalevProductName) => ({
        workspace_id: workspaceId,
        scalev_product_name: scalevProductName,
      })),
      { onConflict: 'workspace_id,scalev_product_name', ignoreDuplicates: true },
    );
  if (error) throw error;
  return { success: true, names: names.length };
}

export async function updateWorkspaceWarehouseMapping(input: {
  id: number;
  warehouseProductId: number | null;
  multiplier?: number;
  isIgnored?: boolean;
}) {
  const { workspaceId } = await requireIndependentWarehousePermission('wh:mapping_sync', 'Kelola Mapping Scalev');
  const svc = createServiceSupabase();
  const config = await loadIndependentWarehouseConfig(svc, workspaceId);
  const mappingId = Number(input.id);
  if (!Number.isInteger(mappingId) || mappingId <= 0) throw new Error('Mapping tidak valid.');

  const { data: mapping, error: mappingError } = await svc
    .from('warehouse_scalev_mapping')
    .select('id')
    .eq('id', mappingId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (mappingError) throw mappingError;
  if (!mapping) throw new Error('Mapping tidak ditemukan di workspace aktif.');

  const productId = input.warehouseProductId == null ? null : Number(input.warehouseProductId);
  if (productId != null) {
    const { data: product, error: productError } = await svc
      .from('warehouse_products')
      .select('id')
      .eq('id', productId)
      .eq('owner_workspace_id', workspaceId)
      .eq('entity', config.entity)
      .eq('warehouse', config.warehouse)
      .eq('is_active', true)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) throw new Error('Produk tujuan tidak dimiliki warehouse workspace ini.');
  }

  const multiplier = input.multiplier == null ? 1 : Number(input.multiplier);
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error('Multiplier harus lebih besar dari nol.');
  }
  const { error } = await svc
    .from('warehouse_scalev_mapping')
    .update({
      warehouse_product_id: productId,
      deduct_qty_multiplier: multiplier,
      is_ignored: Boolean(input.isIgnored),
    })
    .eq('id', mappingId)
    .eq('workspace_id', workspaceId);
  if (error) throw error;
  return { success: true };
}

export async function createWorkspaceWarehouseProduct(input: {
  name: string;
  sku?: string | null;
  category: string;
  unit: string;
  reorderThreshold?: number;
  hpp?: number;
  priceList?: number;
}) {
  const { workspaceId } = await requireIndependentWarehousePermission('admin:warehouse', 'Kelola Produk Gudang');
  const name = String(input.name || '').trim();
  const category = String(input.category || '').trim().toLowerCase();
  const unit = String(input.unit || '').trim();
  if (!name) throw new Error('Nama produk wajib diisi.');
  if (!unit) throw new Error('Satuan produk wajib diisi.');
  if (!['fg', 'sachet', 'bonus', 'packaging', 'other', 'wip', 'wip_material'].includes(category)) {
    throw new Error('Kategori produk tidak valid.');
  }

  const svc = createServiceSupabase();
  const config = await loadIndependentWarehouseConfig(svc, workspaceId);
  const { data, error } = await svc
    .from('warehouse_products')
    .insert({
      owner_workspace_id: workspaceId,
      name,
      sku: String(input.sku || '').trim() || null,
      category,
      unit,
      entity: config.entity,
      warehouse: config.warehouse,
      reorder_threshold: Number(input.reorderThreshold || 0),
      hpp: Number(input.hpp || 0),
      price_list: Number(input.priceList || 0),
      is_active: true,
    })
    .select('id')
    .single();

  if (error) throw error;
  return { success: true, id: data.id };
}

export async function adjustWorkspaceWarehouseStock(input: {
  productId: number;
  quantity: number;
  notes?: string | null;
}) {
  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity === 0) {
    throw new Error('Perubahan stok harus lebih besar atau lebih kecil dari nol.');
  }

  const permission = quantity > 0 ? 'wh:stock_masuk' : 'wh:stock_keluar';
  const label = quantity > 0 ? 'Stock Masuk' : 'Stock Keluar';
  const { workspaceId, profile } = await requireIndependentWarehousePermission(permission, label);
  const svc = createServiceSupabase();
  const config = await loadIndependentWarehouseConfig(svc, workspaceId);

  const { data: product, error: productError } = await svc
    .from('warehouse_products')
    .select('id')
    .eq('id', Number(input.productId))
    .eq('owner_workspace_id', workspaceId)
    .eq('entity', config.entity)
    .eq('warehouse', config.warehouse)
    .eq('is_active', true)
    .maybeSingle();
  if (productError) throw productError;
  if (!product) throw new Error('Produk tidak ditemukan di workspace aktif.');

  const { data: movements, error: movementError } = await svc
    .from('warehouse_stock_ledger')
    .select('quantity')
    .eq('workspace_id', workspaceId)
    .eq('warehouse_product_id', product.id);
  if (movementError) throw movementError;

  const currentBalance = (movements || []).reduce(
    (sum: number, row: any) => sum + Number(row.quantity || 0),
    0,
  );
  const nextBalance = currentBalance + quantity;
  if (nextBalance < 0) {
    throw new Error(`Stok tidak cukup. Saldo saat ini ${currentBalance}.`);
  }

  const referenceId = `${config.entity}-MANUAL-${quantity > 0 ? 'IN' : 'OUT'}-${Date.now()}-${product.id}`;
  const { data: adjustedBalance, error } = await svc.rpc('warehouse_adjust_stock_workspace', {
    p_workspace_id: workspaceId,
    p_product_id: product.id,
    p_quantity: quantity,
    p_reference_id: referenceId,
    p_notes: String(input.notes || '').trim() || `${label} ${quantity}`,
    p_created_by: profile.id,
  });
  if (error) {
    if (/warehouse_adjust_stock_workspace|schema cache|does not exist/i.test(String(error.message || ''))) {
      throw new Error('Migration warehouse segregation belum diterapkan. Jalankan migration 173 terlebih dahulu.');
    }
    throw error;
  }

  return { success: true, currentBalance: Number(adjustedBalance ?? nextBalance) };
}
