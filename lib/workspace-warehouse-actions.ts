'use server';

import { createServiceSupabase } from './supabase-server';
import {
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from './dashboard-access';

export async function getWorkspaceWarehouseInventory() {
  const { workspaceId } = await requireDashboardTabAccess('warehouse', 'Warehouse');
  const svc = createServiceSupabase();

  const { data, error } = await svc
    .from('v_warehouse_stock_balance')
    .select('product_id, product_name, sku, category, entity, warehouse, unit, current_stock, weighted_hpp, stock_value, needs_reorder')
    .eq('workspace_id', workspaceId)
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
  };
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
  const { workspaceId } = await requireDashboardPermissionAccess('admin:warehouse', 'Kelola Produk Gudang');
  const name = String(input.name || '').trim();
  const category = String(input.category || '').trim().toLowerCase();
  const unit = String(input.unit || '').trim();
  if (!name) throw new Error('Nama produk wajib diisi.');
  if (!unit) throw new Error('Satuan produk wajib diisi.');
  if (!['fg', 'sachet', 'bonus', 'packaging', 'other', 'wip', 'wip_material'].includes(category)) {
    throw new Error('Kategori produk tidak valid.');
  }

  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_products')
    .insert({
      owner_workspace_id: workspaceId,
      name,
      sku: String(input.sku || '').trim() || null,
      category,
      unit,
      entity: 'APV',
      warehouse: 'BTN',
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
  const { workspaceId, profile } = await requireDashboardPermissionAccess(permission, label);
  const svc = createServiceSupabase();

  const { data: product, error: productError } = await svc
    .from('warehouse_products')
    .select('id')
    .eq('id', Number(input.productId))
    .eq('owner_workspace_id', workspaceId)
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

  const { error } = await svc
    .from('warehouse_stock_ledger')
    .insert({
      workspace_id: workspaceId,
      warehouse_product_id: product.id,
      batch_id: null,
      movement_type: quantity > 0 ? 'IN' : 'OUT',
      quantity,
      running_balance: nextBalance,
      reference_type: 'manual',
      notes: String(input.notes || '').trim() || `${label} ${quantity}`,
      created_by: profile.id,
    });
  if (error) throw error;

  return { success: true, currentBalance: nextBalance };
}
