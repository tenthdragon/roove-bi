// lib/warehouse-ledger-actions.ts
'use server';

import { createServiceSupabase, createServerSupabase } from './supabase-server';
import {
  requireAnyDashboardPermissionAccess,
  requireAnyDashboardTabAccess,
  requireDashboardPermissionAccess,
  requireDashboardTabAccess,
} from './dashboard-access';
import { sendTelegramToChat } from './telegram';

// ============================================================
// AUTH HELPER
// ============================================================

async function getCurrentUserId(): Promise<string | null> {
  try {
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
  } catch {
    return null;
  }
}

async function getCurrentUserName(): Promise<string> {
  try {
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 'System';
    const svc = createServiceSupabase();
    const { data } = await svc.from('profiles').select('full_name, email').eq('id', user.id).single();
    return data?.full_name || data?.email || 'Unknown';
  } catch {
    return 'System';
  }
}

async function requireWarehouseAccess(label: string = 'Warehouse') {
  await requireDashboardTabAccess('warehouse', label);
}

async function requireWarehousePermission(permissionKey: string, label: string) {
  await requireWarehouseAccess(label);
  await requireDashboardPermissionAccess(permissionKey, label);
}

async function requireWarehouseSettingsPermission(permissionKey: string, label: string) {
  await requireDashboardTabAccess('warehouse-settings', label);
  await requireDashboardPermissionAccess(permissionKey, label);
}

async function requireAnyWarehouseSettingsPermission(permissionKeys: string[], label: string) {
  await requireDashboardTabAccess('warehouse-settings', label);
  await requireAnyDashboardPermissionAccess(permissionKeys, label);
}

async function requireWarehouseReadForSharedProducts(label: string) {
  try {
    await requireAnyDashboardTabAccess(['warehouse', 'ppic'], label);
    return;
  } catch {}

  await requireAnyWarehouseSettingsPermission(['whs:products', 'whs:mapping', 'whs:warehouses'], label);
}

async function requireVendorReadAccess(label: string) {
  try {
    await requireDashboardTabAccess('ppic', label);
    return;
  } catch {}

  await requireAnyWarehouseSettingsPermission(['whs:vendors', 'whs:products'], label);
}

// ============================================================
// TELEGRAM NOTIFICATION (fire-and-forget)
// ============================================================

async function notifyDirekturs(message: string) {
  try {
    const svc = createServiceSupabase();
    const { data: direkturs } = await svc
      .from('profiles')
      .select('telegram_chat_id')
      .in('role', ['direktur_ops', 'direktur_operasional'])
      .not('telegram_chat_id', 'is', null);

    if (direkturs && direkturs.length > 0) {
      await Promise.allSettled(
        direkturs.map(d => sendTelegramToChat(d.telegram_chat_id, message))
      );
    }
  } catch (e) {
    console.warn('[warehouse] telegram notify failed:', e);
  }
}

function formatNotification(type: string, productName: string, qty: number, gudang: string, userName: string, extra?: string): string {
  const icon = type === 'Stock Masuk' ? '\u{1F4E6}' : type === 'Transfer' ? '\u{1F500}' : type === 'Dispose' ? '\u{1F5D1}' : '\u{1F4E4}';
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  let msg = `${icon} <b>${type}</b>\nProduk: ${productName}\nQty: ${qty > 0 ? '+' : ''}${qty.toLocaleString('id-ID')}\n`;
  if (extra) msg += `${extra}\n`;
  msg += `Oleh: ${userName}\nWaktu: ${time}`;
  return msg;
}

// ============================================================
// TYPES
// ============================================================

export type MovementType = 'IN' | 'OUT' | 'ADJUST' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'DISPOSE';
export type ReferenceType = 'scalev_order' | 'manual' | 'purchase_order' | 'transfer' | 'dispose' | 'opname' | 'rts';

export interface LedgerEntry {
  warehouse_product_id: number;
  batch_id?: number | null;
  movement_type: MovementType;
  quantity: number;
  reference_type: ReferenceType;
  reference_id?: string | null;
  notes?: string | null;
  created_by?: string | null;
}

// ============================================================
// HELPERS
// ============================================================

async function getCurrentBalance(svc: ReturnType<typeof createServiceSupabase>, productId: number): Promise<number> {
  const { data, error } = await svc
    .from('warehouse_stock_ledger')
    .select('quantity')
    .eq('warehouse_product_id', productId);
  if (error) throw error;
  return (data || []).reduce((sum, r) => sum + Number(r.quantity), 0);
}

async function insertLedgerEntry(svc: ReturnType<typeof createServiceSupabase>, entry: LedgerEntry) {
  const runningBalance = await getCurrentBalance(svc, entry.warehouse_product_id) + entry.quantity;

  const { data, error } = await svc
    .from('warehouse_stock_ledger')
    .insert({
      ...entry,
      running_balance: runningBalance,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getBatchOrThrow(
  svc: ReturnType<typeof createServiceSupabase>,
  batchId: number,
  productId?: number
) {
  const { data: batch, error } = await svc
    .from('warehouse_batches')
    .select('id, warehouse_product_id, batch_code, expired_date, cost_per_unit, current_qty')
    .eq('id', batchId)
    .single();
  if (error || !batch) throw new Error('Batch tidak ditemukan');
  if (productId && Number(batch.warehouse_product_id) !== Number(productId)) {
    throw new Error('Batch tidak cocok dengan produk yang dipilih');
  }
  return batch;
}

async function deductBatchQuantityOrThrow(
  svc: ReturnType<typeof createServiceSupabase>,
  batchId: number,
  productId: number,
  quantity: number
) {
  const batch = await getBatchOrThrow(svc, batchId, productId);
  const currentQty = Number(batch.current_qty || 0);
  if (quantity > currentQty) {
    throw new Error(`Qty melebihi stok batch ${batch.batch_code} (${currentQty})`);
  }

  const { error } = await svc
    .from('warehouse_batches')
    .update({ current_qty: currentQty - quantity })
    .eq('id', batchId);
  if (error) throw error;

  return batch;
}

async function findOrCreateTargetBatch(
  svc: ReturnType<typeof createServiceSupabase>,
  productId: number,
  batchCode: string,
  expiredDate: string | null,
  costPerUnit?: number | null
) {
  const { data: existing, error: existingErr } = await svc
    .from('warehouse_batches')
    .select('id, current_qty, cost_per_unit')
    .eq('warehouse_product_id', productId)
    .eq('batch_code', batchCode)
    .maybeSingle();
  if (existingErr) throw existingErr;

  if (existing) {
    const update: Record<string, any> = {};
    if (expiredDate !== undefined) update.expired_date = expiredDate;
    if (costPerUnit != null && Number(existing.cost_per_unit || 0) <= 0) {
      update.cost_per_unit = costPerUnit;
    }
    if (Object.keys(update).length > 0) {
      const { error } = await svc.from('warehouse_batches').update(update).eq('id', existing.id);
      if (error) throw error;
    }
    return existing;
  }

  const insertRow: Record<string, any> = {
    warehouse_product_id: productId,
    batch_code: batchCode,
    expired_date: expiredDate,
    initial_qty: 0,
    current_qty: 0,
  };
  if (costPerUnit != null) {
    insertRow.cost_per_unit = costPerUnit;
  }

  const { data: created, error: createdErr } = await svc
    .from('warehouse_batches')
    .insert(insertRow)
    .select('id, current_qty')
    .single();
  if (createdErr) throw createdErr;

  return created;
}

// ============================================================
// STOCK IN — vendor delivery, RTS, production received
// ============================================================

export async function recordStockInInternal(
  productId: number,
  batchId: number | null,
  quantity: number,
  referenceType: ReferenceType = 'manual',
  referenceId?: string,
  notes?: string,
) {
  if (quantity <= 0) throw new Error('Stock IN quantity must be positive');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  // Update batch qty if batch specified
  if (batchId) {
    const { data: batch } = await svc
      .from('warehouse_batches')
      .select('current_qty')
      .eq('id', batchId)
      .single();
    if (batch) {
      await svc
        .from('warehouse_batches')
        .update({ current_qty: Number(batch.current_qty) + quantity })
        .eq('id', batchId);
    }
  }

  const result = await insertLedgerEntry(svc, {
    warehouse_product_id: productId,
    batch_id: batchId,
    movement_type: 'IN',
    quantity: quantity,
    reference_type: referenceType,
    reference_id: referenceId,
    notes,
    created_by: userId,
  });

  // Notify direktur (fire-and-forget)
  const { data: prod } = await svc.from('warehouse_products').select('name, warehouse, entity').eq('id', productId).single();
  if (prod) {
    const userName = await getCurrentUserName();
    notifyDirekturs(formatNotification('Stock Masuk', prod.name, quantity, `${prod.warehouse} - ${prod.entity}`, userName));
  }

  return result;
}

export async function recordStockIn(
  productId: number,
  batchId: number | null,
  quantity: number,
  referenceType: ReferenceType = 'manual',
  referenceId?: string,
  notes?: string,
) {
  await requireWarehousePermission('wh:stock_masuk', 'Stock Masuk');
  return recordStockInInternal(productId, batchId, quantity, referenceType, referenceId, notes);
}

// ============================================================
// STOCK OUT — manual outbound (non-ScaleV)
// ============================================================

export async function recordStockOut(
  productId: number,
  batchId: number | null,
  quantity: number,
  referenceType: ReferenceType = 'manual',
  referenceId?: string,
  notes?: string,
) {
  await requireWarehousePermission('wh:stock_keluar', 'Stock Keluar');
  if (quantity <= 0) throw new Error('Stock OUT quantity must be positive');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  // If no batch specified, use FIFO deduction
  if (!batchId) {
    const { data, error } = await svc
      .rpc('warehouse_deduct_fifo', {
        p_product_id: productId,
        p_quantity: quantity,
        p_reference_type: referenceType || 'manual',
        p_reference_id: referenceId || null,
        p_notes: notes || 'Manual stock out (FIFO)',
      });
    if (error) throw error;

    const { data: prod } = await svc.from('warehouse_products').select('name, warehouse, entity').eq('id', productId).single();
    if (prod) {
      const userName = await getCurrentUserName();
      notifyDirekturs(formatNotification('Stock Keluar', prod.name, -quantity, `${prod.warehouse} - ${prod.entity}`, userName));
    }
    return data;
  }

  // Specific batch deduction
  await deductBatchQuantityOrThrow(svc, batchId, productId, quantity);

  const result = await insertLedgerEntry(svc, {
    warehouse_product_id: productId,
    batch_id: batchId,
    movement_type: 'OUT',
    quantity: -quantity,
    reference_type: referenceType,
    reference_id: referenceId,
    notes,
    created_by: userId,
  });

  const { data: prod } = await svc.from('warehouse_products').select('name, warehouse, entity').eq('id', productId).single();
  if (prod) {
    const userName = await getCurrentUserName();
    notifyDirekturs(formatNotification('Stock Keluar', prod.name, -quantity, `${prod.warehouse} - ${prod.entity}`, userName));
  }

  return result;
}

// ============================================================
// STOCK IN RTS — returned items back to inventory
// ============================================================

export async function recordStockRTS(
  productId: number,
  batchId: number,
  quantity: number,
  resiNumber: string,
  notes?: string,
) {
  await requireWarehousePermission('wh:stock_masuk', 'Stock RTS');
  if (quantity <= 0) throw new Error('RTS quantity must be positive');
  if (!resiNumber?.trim()) throw new Error('Nomor resi wajib diisi untuk RTS');
  if (!batchId) throw new Error('Batch wajib dipilih untuk RTS');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  // Add back to batch qty
  const { data: batch } = await svc
    .from('warehouse_batches')
    .select('current_qty')
    .eq('id', batchId)
    .single();
  if (batch) {
    await svc
      .from('warehouse_batches')
      .update({ current_qty: Number(batch.current_qty) + quantity })
      .eq('id', batchId);
  }

  const result = await insertLedgerEntry(svc, {
    warehouse_product_id: productId,
    batch_id: batchId,
    movement_type: 'IN',
    quantity: quantity,
    reference_type: 'rts',
    reference_id: resiNumber.trim(),
    notes: notes ? `RTS: ${notes}` : `RTS resi: ${resiNumber.trim()}`,
    created_by: userId,
  });

  const { data: prod } = await svc.from('warehouse_products').select('name, warehouse, entity').eq('id', productId).single();
  if (prod) {
    const userName = await getCurrentUserName();
    notifyDirekturs(formatNotification('Stock Masuk (RTS)', prod.name, quantity, `${prod.warehouse} - ${prod.entity}`, userName, `Resi: ${resiNumber.trim()}`));
  }

  return result;
}

// ============================================================
// STOCK ADJUST — stock opname correction
// ============================================================

async function recordStockAdjustInternal(
  productId: number,
  batchId: number | null,
  adjustmentQty: number, // positive = surplus, negative = deficit
  notes?: string,
) {
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  if (batchId) {
    const batch = await getBatchOrThrow(svc, batchId, productId);
    const nextQty = Number(batch.current_qty || 0) + adjustmentQty;
    if (nextQty < 0) {
      throw new Error(`Adjust menyebabkan stok batch ${batch.batch_code} menjadi negatif`);
    }

    const { error } = await svc
      .from('warehouse_batches')
      .update({ current_qty: nextQty })
      .eq('id', batchId);
    if (error) throw error;
  }

  return insertLedgerEntry(svc, {
    warehouse_product_id: productId,
    batch_id: batchId,
    movement_type: 'ADJUST',
    quantity: adjustmentQty,
    created_by: userId,
    reference_type: 'opname',
    notes,
  });
}

export async function recordStockAdjust(
  productId: number,
  batchId: number | null,
  adjustmentQty: number,
  notes?: string,
) {
  await requireWarehouseAccess('Adjust Stock');
  return recordStockAdjustInternal(productId, batchId, adjustmentQty, notes);
}

// ============================================================
// TRANSFER — inter-company/warehouse
// ============================================================

export async function recordTransfer(
  productId: number,
  batchId: number | null,
  quantity: number,
  fromEntity: string,
  toEntity: string,
  fromWarehouse: string = 'BTN',
  toWarehouse: string = 'BTN',
  notes?: string,
) {
  await requireWarehousePermission('wh:transfer', 'Transfer Stock');
  if (quantity <= 0) throw new Error('Transfer quantity must be positive');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  const { data: sourceProduct, error: sourceErr } = await svc
    .from('warehouse_products')
    .select('id, name, warehouse, entity')
    .eq('id', productId)
    .single();
  if (sourceErr || !sourceProduct) throw new Error('Produk sumber tidak ditemukan');

  const { data: targetProduct, error: targetErr } = await svc
    .from('warehouse_products')
    .select('id, name')
    .eq('name', sourceProduct.name)
    .eq('entity', toEntity)
    .eq('warehouse', toWarehouse)
    .maybeSingle();
  if (targetErr) throw targetErr;
  if (!targetProduct) {
    throw new Error(`Produk ${sourceProduct.name} belum tersedia di ${toWarehouse} - ${toEntity}`);
  }

  // Create transfer record
  const { data: transfer, error: tErr } = await svc
    .from('warehouse_transfers')
    .insert({
      from_entity: fromEntity,
      to_entity: toEntity,
      from_warehouse: fromWarehouse,
      to_warehouse: toWarehouse,
      warehouse_product_id: productId,
      batch_id: batchId,
      quantity,
      notes,
    })
    .select()
    .single();
  if (tErr) throw tErr;

  let targetBatchId: number | null = null;
  let sourceBatchLabel = '';

  // Update batch qty (deduct from source) and mirror batch to target when available
  if (batchId) {
    const sourceBatch = await deductBatchQuantityOrThrow(svc, batchId, productId, quantity);
    sourceBatchLabel = sourceBatch.batch_code || '';

    const targetBatch = await findOrCreateTargetBatch(
      svc,
      targetProduct.id,
      sourceBatch.batch_code,
      sourceBatch.expired_date || null,
      sourceBatch.cost_per_unit ?? null,
    );
    targetBatchId = targetBatch.id;

    const { error: targetBatchErr } = await svc
      .from('warehouse_batches')
      .update({ current_qty: Number(targetBatch.current_qty || 0) + quantity })
      .eq('id', targetBatch.id);
    if (targetBatchErr) throw targetBatchErr;
  }

  // Ledger: OUT from source
  await insertLedgerEntry(svc, {
    warehouse_product_id: productId,
    batch_id: batchId,
    movement_type: 'TRANSFER_OUT',
    quantity: -quantity,
    reference_type: 'transfer',
    reference_id: String(transfer.id),
    notes: `Transfer to ${toEntity} (${toWarehouse})`,
    created_by: userId,
  });

  // Ledger: IN to target
  await insertLedgerEntry(svc, {
    warehouse_product_id: targetProduct.id,
    batch_id: targetBatchId,
    movement_type: 'TRANSFER_IN',
    quantity,
    reference_type: 'transfer',
    reference_id: String(transfer.id),
    notes: `Transfer from ${fromEntity} (${fromWarehouse})${sourceBatchLabel ? ` — batch ${sourceBatchLabel}` : ''}`,
    created_by: userId,
  });

  if (sourceProduct) {
    const userName = await getCurrentUserName();
    notifyDirekturs(formatNotification('Transfer', sourceProduct.name, quantity, `${fromEntity} → ${toEntity}`, userName, `Dari: ${fromWarehouse} - ${fromEntity}\nKe: ${toWarehouse} - ${toEntity}`));
  }

  return transfer;
}

// ============================================================
// CONVERT — sachet → FG (or any product → product conversion)
// ============================================================

export interface ConversionSource {
  productId: number;
  batchId?: number | null;
  quantity: number;
}

export async function recordConversion(
  sources: ConversionSource[],
  targetProductId: number,
  targetQty: number,
  targetBatchCode?: string,
  targetExpiredDate?: string | null,
  notes?: string,
) {
  await requireWarehousePermission('wh:konversi', 'Konversi Produk');
  if (sources.length === 0) throw new Error('At least one source required');
  if (targetQty <= 0) throw new Error('Target quantity must be positive');
  for (const s of sources) {
    if (s.quantity <= 0) throw new Error('Source quantities must be positive');
  }

  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();
  const refId = `conv-${Date.now()}`;

  // Deduct each source
  for (const src of sources) {
    if (src.batchId) {
      await deductBatchQuantityOrThrow(svc, src.batchId, src.productId, src.quantity);
    }

    await insertLedgerEntry(svc, {
      warehouse_product_id: src.productId,
      batch_id: src.batchId || null,
      movement_type: 'OUT',
      quantity: -src.quantity,
      reference_type: 'manual',
      reference_id: refId,
      notes: `Konversi keluar: ${src.quantity} unit`,
      created_by: userId,
    });
  }

  // Create or find target batch
  let targetBatchId: number | null = null;
  if (targetBatchCode) {
    const targetBatch = await findOrCreateTargetBatch(
      svc,
      targetProductId,
      targetBatchCode,
      targetExpiredDate || null,
    );
    targetBatchId = targetBatch.id;

    const { error: targetBatchErr } = await svc
      .from('warehouse_batches')
      .update({ current_qty: Number(targetBatch.current_qty || 0) + targetQty })
      .eq('id', targetBatch.id);
    if (targetBatchErr) throw targetBatchErr;
  }

  // Ledger IN for target
  await insertLedgerEntry(svc, {
    warehouse_product_id: targetProductId,
    batch_id: targetBatchId,
    movement_type: 'IN',
    quantity: targetQty,
    reference_type: 'manual',
    reference_id: refId,
    notes: notes || `Konversi masuk: ${targetQty} unit dari produk lain`,
    created_by: userId,
  });

  return { reference_id: refId };
}

// ============================================================
// DISPOSE — expired/damaged items
// ============================================================

export async function recordDispose(
  productId: number,
  batchId: number | null,
  quantity: number,
  reason?: string,
) {
  await requireWarehousePermission('wh:dispose', 'Dispose Stock');
  if (quantity <= 0) throw new Error('Dispose quantity must be positive');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  if (batchId) {
    await deductBatchQuantityOrThrow(svc, batchId, productId, quantity);
  }

  const result = await insertLedgerEntry(svc, {
    warehouse_product_id: productId,
    batch_id: batchId,
    movement_type: 'DISPOSE',
    quantity: -quantity,
    reference_type: 'dispose',
    notes: reason,
    created_by: userId,
  });

  const { data: prod } = await svc.from('warehouse_products').select('name, warehouse, entity').eq('id', productId).single();
  if (prod) {
    const userName = await getCurrentUserName();
    notifyDirekturs(formatNotification('Dispose', prod.name, -quantity, `${prod.warehouse} - ${prod.entity}`, userName, reason ? `Alasan: ${reason}` : undefined));
  }

  return result;
}

// ============================================================
// BATCH MANAGEMENT
// ============================================================

export async function createBatchInternal(
  productId: number,
  batchCode: string,
  expiredDate: string | null,
  initialQty: number = 0,
) {
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();
  const { data, error } = await svc
    .from('warehouse_batches')
    .insert({
      warehouse_product_id: productId,
      batch_code: batchCode,
      expired_date: expiredDate,
      initial_qty: initialQty,
      current_qty: initialQty,
    })
    .select()
    .single();
  if (error) throw error;

  // If initial qty > 0, create ledger entry
  if (initialQty > 0) {
    await insertLedgerEntry(svc, {
      warehouse_product_id: productId,
      batch_id: data.id,
      movement_type: 'IN',
      quantity: initialQty,
      reference_type: 'manual',
      created_by: userId,
      notes: `Initial stock for batch ${batchCode}`,
    });
  }

  return data;
}

export async function createBatch(
  productId: number,
  batchCode: string,
  expiredDate: string | null,
  initialQty: number = 0,
) {
  await requireWarehousePermission('wh:stock_masuk', 'Batch Stock');
  return createBatchInternal(productId, batchCode, expiredDate, initialQty);
}

// ============================================================
// QUERIES
// ============================================================

export async function getProductsFull(filters?: {
  category?: string;
  entity?: string;
  warehouse?: string;
  brand_id?: number;
  includeInactive?: boolean;
}) {
  await requireAnyWarehouseSettingsPermission(['whs:products', 'whs:warehouses'], 'Master Produk Gudang');
  const svc = createServiceSupabase();
  let query = svc.from('warehouse_products').select('*, brands(id, name), warehouse_vendors(id, name)');

  if (filters?.category) query = query.eq('category', filters.category);
  if (filters?.entity) query = query.eq('entity', filters.entity);
  if (filters?.warehouse) query = query.eq('warehouse', filters.warehouse);
  if (filters?.brand_id) query = query.eq('brand_id', filters.brand_id);
  if (!filters?.includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query.order('entity').order('category').order('name');
  if (error) throw error;
  return data || [];
}

export async function createProduct(product: {
  name: string; category: string; unit: string; entity: string; warehouse: string;
  price_list?: number; hpp?: number; vendor_id?: number | null; brand_id?: number;
  reorder_threshold?: number; scalev_product_names?: string[];
}) {
  await requireWarehouseSettingsPermission('whs:products', 'Master Produk Gudang');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_products')
    .insert({ ...product, is_active: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProduct(id: number, updates: Record<string, any>) {
  await requireWarehouseSettingsPermission('whs:products', 'Master Produk Gudang');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_products')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

export async function deactivateProduct(id: number) {
  await requireWarehouseSettingsPermission('whs:products', 'Master Produk Gudang');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_products')
    .update({ is_active: false })
    .eq('id', id);
  if (error) throw error;
}

export async function getProducts(filters?: {
  category?: string;
  entity?: string;
  warehouse?: string;
  activeOnly?: boolean;
}) {
  await requireWarehouseReadForSharedProducts('Produk Gudang');
  const svc = createServiceSupabase();
  let query = svc.from('warehouse_products').select('*');

  if (filters?.category) query = query.eq('category', filters.category);
  if (filters?.entity) query = query.eq('entity', filters.entity);
  if (filters?.warehouse) query = query.eq('warehouse', filters.warehouse);
  if (filters?.activeOnly !== false) query = query.eq('is_active', true);

  const { data, error } = await query.order('category').order('name');
  if (error) throw error;
  return data || [];
}

export async function getStockBalance(productId?: number) {
  await requireWarehouseAccess('Saldo Stock');
  const svc = createServiceSupabase();
  let query = svc.from('v_warehouse_stock_balance').select('*');
  if (productId) query = query.eq('product_id', productId);
  const { data, error } = await query.order('category').order('product_name');
  if (error) throw error;
  return data || [];
}

export async function getStockByBatch(productId?: number) {
  await requireWarehouseAccess('Batch & Expiry');
  const svc = createServiceSupabase();
  let query = svc.from('v_warehouse_batch_stock').select('*');
  if (productId) query = query.eq('product_id', productId);
  const { data, error } = await query.order('expired_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

export async function getLedgerHistory(filters?: {
  productId?: number;
  movementType?: MovementType;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}) {
  await requireWarehouseAccess('Movement Log');
  const svc = createServiceSupabase();
  let query = svc
    .from('warehouse_stock_ledger')
    .select(`
      *,
      warehouse_products!inner(name, category, entity),
      warehouse_batches(batch_code, expired_date),
      profiles:created_by(full_name, email)
    `);

  if (filters?.productId) query = query.eq('warehouse_product_id', filters.productId);
  if (filters?.movementType) query = query.eq('movement_type', filters.movementType);
  if (filters?.dateFrom) query = query.gte('created_at', filters.dateFrom);
  if (filters?.dateTo) query = query.lte('created_at', filters.dateTo);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(filters?.limit || 100);
  if (error) throw error;
  return data || [];
}

export async function getDailyMovementSummary(date: string) {
  await requireWarehouseAccess('Daily Summary');
  const svc = createServiceSupabase();
  const dayStart = `${date}T00:00:00+07:00`;
  const dayEnd = `${date}T23:59:59.999+07:00`;

  const { data, error } = await svc
    .from('warehouse_stock_ledger')
    .select(`
      warehouse_product_id,
      movement_type,
      quantity,
      warehouse_products!inner(name, category, entity)
    `)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);

  if (error) throw error;
  if (!data || data.length === 0) return [];

  // Aggregate by product
  const byProduct = new Map<number, {
    product_name: string; category: string; entity: string;
    total_in: number; total_out: number; total_adjust: number;
  }>();

  for (const r of data) {
    const pid = r.warehouse_product_id;
    if (!byProduct.has(pid)) {
      const wp = r.warehouse_products as any;
      byProduct.set(pid, {
        product_name: wp?.name || '-',
        category: wp?.category || '-',
        entity: wp?.entity || '-',
        total_in: 0, total_out: 0, total_adjust: 0,
      });
    }
    const row = byProduct.get(pid)!;
    const qty = Number(r.quantity);
    if (r.movement_type === 'IN' || r.movement_type === 'TRANSFER_IN') {
      row.total_in += qty;
    } else if (r.movement_type === 'OUT' || r.movement_type === 'TRANSFER_OUT' || r.movement_type === 'DISPOSE') {
      row.total_out += qty;
    } else if (r.movement_type === 'ADJUST') {
      row.total_adjust += qty;
    }
  }

  return Array.from(byProduct.entries()).map(([id, v]) => ({
    product_id: id,
    ...v,
    net_change: v.total_in + v.total_out + v.total_adjust,
  })).sort((a, b) => a.entity.localeCompare(b.entity) || a.product_name.localeCompare(b.product_name));
}

export async function getBatches(productId: number) {
  await requireWarehouseAccess('Batch Stock');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_batches')
    .select('*')
    .eq('warehouse_product_id', productId)
    .eq('is_active', true)
    .order('expired_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

// ============================================================
// SCALEV FIFO DEDUCTION (called from webhook)
// ============================================================

export async function deductStockFifo(
  scalevProductName: string,
  quantity: number,
  scalevOrderId: string,
) {
  const svc = createServiceSupabase();

  // Lookup warehouse product by ScaleV name
  const { data: products, error: lookupErr } = await svc
    .rpc('warehouse_find_product_by_scalev_name', { p_scalev_name: scalevProductName });
  if (lookupErr) throw lookupErr;
  if (!products || products.length === 0) return null; // unmapped product, skip

  const product = products[0];

  // Call FIFO deduction function
  const { data, error } = await svc
    .rpc('warehouse_deduct_fifo', {
      p_product_id: product.id,
      p_quantity: quantity,
      p_reference_type: 'scalev_order',
      p_reference_id: scalevOrderId,
      p_notes: `Auto-deduct: ${scalevProductName} x${quantity}`,
    });
  if (error) throw error;
  return { product: product.name, deductions: data };
}

// ============================================================
// ORDER REVERSAL (for deleted/canceled orders)
// ============================================================

export async function reverseWarehouseDeductions(orderId: string): Promise<number> {
  const svc = createServiceSupabase();

  // Check if there are any OUT entries to reverse
  const { data: existing } = await svc
    .from('warehouse_stock_ledger')
    .select('id')
    .eq('reference_type', 'scalev_order')
    .eq('reference_id', orderId)
    .eq('movement_type', 'OUT')
    .limit(1);

  if (!existing || existing.length === 0) return 0;

  // Check if already reversed (avoid double reversal)
  const { data: reversals } = await svc
    .from('warehouse_stock_ledger')
    .select('id')
    .eq('reference_type', 'scalev_order')
    .eq('reference_id', orderId)
    .eq('movement_type', 'IN')
    .like('notes', 'Reversal:%')
    .limit(1);

  if (reversals && reversals.length > 0) return 0;

  const { data, error } = await svc.rpc('warehouse_reverse_order', { p_order_id: orderId });
  if (error) throw error;
  return data as number;
}

// ============================================================
// PURCHASE ORDERS
// ============================================================

export async function createPurchaseOrder(
  productId: number,
  quantityRequested: number,
  vendor?: string,
  poDate?: string,
  expectedDate?: string,
  notes?: string,
) {
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_purchase_orders')
    .insert({
      warehouse_product_id: productId,
      quantity_requested: quantityRequested,
      vendor,
      po_date: poDate || new Date().toISOString().slice(0, 10),
      expected_date: expectedDate,
      notes,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function receivePurchaseOrder(
  poId: number,
  quantityReceived: number,
  batchId?: number,
  notes?: string,
) {
  const svc = createServiceSupabase();

  // Get PO details
  const { data: po, error: poErr } = await svc
    .from('warehouse_purchase_orders')
    .select('*')
    .eq('id', poId)
    .single();
  if (poErr) throw poErr;

  const newReceived = Number(po.quantity_received) + quantityReceived;
  const isComplete = newReceived >= Number(po.quantity_requested);

  // Update PO
  await svc
    .from('warehouse_purchase_orders')
    .update({
      quantity_received: newReceived,
      received_date: new Date().toISOString().slice(0, 10),
      status: isComplete ? 'completed' : 'partial',
      notes: notes ? `${po.notes || ''}\n${notes}`.trim() : po.notes,
    })
    .eq('id', poId);

  // Record stock IN
  await recordStockIn(
    po.warehouse_product_id,
    batchId || null,
    quantityReceived,
    'purchase_order',
    String(poId),
    `PO #${poId} received: ${quantityReceived} units`,
  );

  return { po_id: poId, quantity_received: newReceived, status: isComplete ? 'completed' : 'partial' };
}

export async function getPurchaseOrders(filters?: {
  productId?: number;
  status?: string;
  limit?: number;
}) {
  const svc = createServiceSupabase();
  let query = svc
    .from('warehouse_purchase_orders')
    .select(`
      *,
      warehouse_products!inner(name, category, entity)
    `);

  if (filters?.productId) query = query.eq('warehouse_product_id', filters.productId);
  if (filters?.status) query = query.eq('status', filters.status);

  const { data, error } = await query
    .order('po_date', { ascending: false })
    .limit(filters?.limit || 50);
  if (error) throw error;
  return data || [];
}

// ============================================================
// SCALEV PRODUCT MAPPING
// ============================================================

export async function getScalevMappings(filter?: 'all' | 'mapped' | 'unmapped' | 'ignored') {
  await requireWarehouseSettingsPermission('whs:mapping', 'Mapping Scalev');
  const svc = createServiceSupabase();
  let query = svc
    .from('warehouse_scalev_mapping')
    .select(`
      *,
      warehouse_products(id, name, category, entity, warehouse)
    `);

  if (filter === 'mapped') query = query.not('warehouse_product_id', 'is', null).eq('is_ignored', false);
  if (filter === 'unmapped') query = query.is('warehouse_product_id', null).eq('is_ignored', false);
  if (filter === 'ignored') query = query.eq('is_ignored', true);

  const { data, error } = await query.order('scalev_product_name');
  if (error) throw error;

  return (data || []).map(r => ({
    ...r,
    frequency: 0, // Frequency loaded separately via getScalevFrequencies()
  }));
}

export async function getScalevFrequencies(): Promise<Record<string, number>> {
  await requireWarehouseSettingsPermission('whs:mapping', 'Mapping Scalev');
  const svc = createServiceSupabase();
  try {
    const { data } = await svc.rpc('warehouse_scalev_mapping_frequencies');
    const map: Record<string, number> = {};
    if (data) for (const r of data) map[r.product_name] = r.cnt;
    return map;
  } catch {
    return {};
  }
}

export async function getScalevPriceTiers(): Promise<Record<string, { price: number; count: number }[]>> {
  await requireWarehouseSettingsPermission('whs:mapping', 'Mapping Scalev');
  const svc = createServiceSupabase();
  try {
    const { data } = await svc.rpc('warehouse_scalev_price_tiers');
    const map: Record<string, { price: number; count: number }[]> = {};
    if (data) {
      for (const r of data) {
        if (!map[r.product_name]) map[r.product_name] = [];
        map[r.product_name].push({ price: r.price_tier, count: r.cnt });
      }
    }
    return map;
  } catch {
    return {};
  }
}

export async function updateScalevMapping(
  id: number,
  warehouseProductId: number | null,
  multiplier?: number,
  isIgnored?: boolean,
  notes?: string,
) {
  await requireWarehouseSettingsPermission('whs:mapping', 'Mapping Scalev');
  const svc = createServiceSupabase();
  const update: Record<string, any> = {};
  if (warehouseProductId !== undefined) update.warehouse_product_id = warehouseProductId;
  if (multiplier !== undefined) update.deduct_qty_multiplier = multiplier;
  if (isIgnored !== undefined) update.is_ignored = isIgnored;
  if (notes !== undefined) update.notes = notes;

  const { error } = await svc
    .from('warehouse_scalev_mapping')
    .update(update)
    .eq('id', id);
  if (error) throw error;
}

export async function syncScalevProductNames() {
  await requireWarehouseSettingsPermission('whs:mapping', 'Mapping Scalev');
  const svc = createServiceSupabase();
  // Insert any new product_names not yet in mapping table
  const { error } = await svc.rpc('warehouse_sync_scalev_names');
  if (error) throw error;
}

// ============================================================
// WAREHOUSE BUSINESS MAPPING
// ============================================================

export async function getWarehouseBusinessMappings() {
  await requireDashboardTabAccess('business-settings', 'Mapping Business Warehouse');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_business_mapping')
    .select('*, scalev_webhook_businesses!inner(business_name)')
    .order('business_code');
  if (error) throw error;
  return data || [];
}

export async function updateWarehouseBusinessMapping(id: number, field: string, value: any) {
  await requireDashboardTabAccess('business-settings', 'Mapping Business Warehouse');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_business_mapping')
    .update({ [field]: value })
    .eq('id', id);
  if (error) throw error;
}

export async function createWarehouseBusinessMapping(businessCode: string, deductEntity: string, deductWarehouse = 'BTN') {
  await requireDashboardTabAccess('business-settings', 'Mapping Business Warehouse');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_business_mapping')
    .upsert({
      business_code: businessCode,
      deduct_entity: deductEntity,
      deduct_warehouse: deductWarehouse,
      is_active: true,
    }, { onConflict: 'business_code', ignoreDuplicates: true });
  if (error) throw error;
}

// ── Backfill warehouse deductions for shipped orders missing deductions ──
export async function backfillWarehouseDeductions(date: string) {
  const svc = createServiceSupabase();
  const dayStart = `${date}T00:00:00+07:00`;
  const dayEnd = `${date}T23:59:59.999+07:00`;

  // Find shipped/completed orders for the date
  const { data: orders, error: ordErr } = await svc
    .from('scalev_orders')
    .select('id, order_id, business_code, shipped_time')
    .in('status', ['shipped', 'completed'])
    .gte('shipped_time', dayStart)
    .lt('shipped_time', dayEnd)
    .limit(5000);
  if (ordErr) throw ordErr;
  if (!orders || orders.length === 0) return { checked: 0, deducted: 0, skipped: 0 };

  let totalDeducted = 0;
  let totalSkipped = 0;
  let checked = 0;

  for (const order of orders) {
    // Check if already deducted (idempotency)
    const { data: existing } = await svc
      .from('warehouse_stock_ledger')
      .select('id')
      .eq('reference_type', 'scalev_order')
      .eq('reference_id', order.order_id)
      .limit(1);
    if (existing && existing.length > 0) continue;
    checked++;

    // Get warehouse mapping for this business
    const { data: mapping } = await svc
      .from('warehouse_business_mapping')
      .select('deduct_entity, deduct_warehouse')
      .eq('business_code', order.business_code)
      .eq('is_active', true)
      .maybeSingle();
    if (!mapping) continue;

    // Get order lines
    const { data: lines } = await svc
      .from('scalev_order_lines')
      .select('product_name, quantity')
      .eq('scalev_order_id', order.id);
    if (!lines || lines.length === 0) continue;

    for (const line of lines) {
      if (!line.product_name || !line.quantity || line.quantity <= 0) continue;

      // 1. Check warehouse_scalev_mapping
      const { data: scalevMapping } = await svc
        .from('warehouse_scalev_mapping')
        .select('warehouse_product_id, deduct_qty_multiplier, is_ignored')
        .eq('scalev_product_name', line.product_name)
        .maybeSingle();

      if (scalevMapping?.is_ignored) { totalSkipped++; continue; }

      let targetProductId: number | null = null;
      let deductQty = line.quantity;

      if (scalevMapping?.warehouse_product_id) {
        targetProductId = scalevMapping.warehouse_product_id;
        deductQty = line.quantity * (scalevMapping.deduct_qty_multiplier || 1);
      } else {
        // Fallback: lookup by scalev_product_names
        const { data: whProducts } = await svc
          .rpc('warehouse_find_product_for_deduction', {
            p_scalev_name: line.product_name,
            p_entity: mapping.deduct_entity,
            p_warehouse: mapping.deduct_warehouse,
          });
        if (whProducts && whProducts.length > 0) {
          targetProductId = whProducts[0].id;
        }
      }

      if (targetProductId) {
        const { error: deductErr } = await svc
          .rpc('warehouse_deduct_fifo', {
            p_product_id: targetProductId,
            p_quantity: deductQty,
            p_reference_type: 'scalev_order',
            p_reference_id: order.order_id,
            p_notes: `Backfill: ${line.product_name} x${deductQty} [${order.business_code}→${mapping.deduct_entity}]`,
            p_created_at: order.shipped_time || new Date().toISOString(),
          });
        if (!deductErr) totalDeducted++;
      } else {
        totalSkipped++;
      }
    }
  }

  return { checked, deducted: totalDeducted, skipped: totalSkipped };
}

// ── Get shipped orders that have NO warehouse deduction for a date ──
export async function getUndeductedOrders(date: string) {
  await requireWarehouseAccess('Daily Summary');
  const svc = createServiceSupabase();
  const dayStart = `${date}T00:00:00+07:00`;
  const dayEnd = `${date}T23:59:59.999+07:00`;

  // All shipped orders for the date (paginated)
  const orders: any[] = [];
  let ordOffset = 0;
  while (true) {
    const { data: page, error: pgErr } = await svc
      .from('scalev_orders')
      .select('id, order_id, business_code')
      .in('status', ['shipped', 'completed'])
      .gte('shipped_time', dayStart)
      .lt('shipped_time', dayEnd)
      .range(ordOffset, ordOffset + 999);
    if (pgErr) throw pgErr;
    if (!page || page.length === 0) break;
    orders.push(...page);
    if (page.length < 1000) break;
    ordOffset += 1000;
  }
  if (orders.length === 0) return [];

  // Get all existing deductions for these order IDs in one query
  const orderIds = orders.map(o => o.order_id);
  const deductedSet = new Set<string>();
  const chunkSize = 200;
  for (let i = 0; i < orderIds.length; i += chunkSize) {
    const chunk = orderIds.slice(i, i + chunkSize);
    const { data: ledgerRows } = await svc
      .from('warehouse_stock_ledger')
      .select('reference_id')
      .eq('reference_type', 'scalev_order')
      .in('reference_id', chunk);
    (ledgerRows || []).forEach(r => deductedSet.add(r.reference_id));
  }

  // Filter to undeducted orders only
  const undeducted = orders.filter(o => !deductedSet.has(o.order_id));
  if (undeducted.length === 0) return [];

  // Load all business mappings + scalev mappings for diagnosis
  const { data: bizMappings } = await svc
    .from('warehouse_business_mapping')
    .select('business_code, deduct_entity, deduct_warehouse, is_active');
  const bizMap = new Map((bizMappings || []).map(m => [m.business_code, m]));

  const results: any[] = [];

  for (const order of undeducted) {
    // Get order lines
    const { data: lines } = await svc
      .from('scalev_order_lines')
      .select('product_name, quantity')
      .eq('scalev_order_id', order.id);

    const productLines = (lines || []).filter(l => l.product_name && l.quantity > 0)
      .map(l => ({ product_name: l.product_name, quantity: l.quantity }));

    // Diagnose problem
    const mapping = bizMap.get(order.business_code);
    if (!mapping || !mapping.is_active) {
      results.push({
        order_id: order.order_id,
        business_code: order.business_code,
        product_lines: productLines,
        problem: 'no_business_mapping',
        problem_detail: `Business ${order.business_code} tidak punya warehouse mapping`,
      });
      continue;
    }

    // Check each product line for mapping
    const unmappedProducts: string[] = [];
    for (const line of productLines) {
      const { data: scalevMapping } = await svc
        .from('warehouse_scalev_mapping')
        .select('warehouse_product_id, is_ignored')
        .eq('scalev_product_name', line.product_name)
        .maybeSingle();
      if (scalevMapping?.is_ignored) continue;
      if (scalevMapping?.warehouse_product_id) continue;

      // Fallback lookup
      const { data: whProducts } = await svc
        .rpc('warehouse_find_product_for_deduction', {
          p_scalev_name: line.product_name,
          p_entity: mapping.deduct_entity,
          p_warehouse: mapping.deduct_warehouse,
        });
      if (!whProducts || whProducts.length === 0) {
        unmappedProducts.push(line.product_name);
      }
    }

    if (unmappedProducts.length > 0) {
      results.push({
        order_id: order.order_id,
        business_code: order.business_code,
        product_lines: productLines,
        problem: 'no_product_mapping',
        problem_detail: `Produk tidak ditemukan di gudang ${mapping.deduct_entity}: ${unmappedProducts.join(', ')}`,
      });
    } else {
      results.push({
        order_id: order.order_id,
        business_code: order.business_code,
        product_lines: productLines,
        problem: 'unknown',
        problem_detail: 'Mapping tersedia tapi deduction belum berjalan',
      });
    }
  }

  return results;
}

// ── Backfill a single order's warehouse deduction ──
export async function backfillSingleOrder(orderId: string) {
  await requireWarehousePermission('wh:mapping_sync', 'Sync Deduction Gudang');
  const svc = createServiceSupabase();

  // Get order
  const { data: order, error: ordErr } = await svc
    .from('scalev_orders')
    .select('id, order_id, business_code, shipped_time')
    .eq('order_id', orderId)
    .single();
  if (ordErr || !order) throw new Error(`Order ${orderId} tidak ditemukan`);

  // Idempotency check
  const { data: existing } = await svc
    .from('warehouse_stock_ledger')
    .select('id')
    .eq('reference_type', 'scalev_order')
    .eq('reference_id', orderId)
    .limit(1);
  if (existing && existing.length > 0) return { deducted: 0, skipped: 0, message: 'Sudah pernah dideduct' };

  // Get mapping
  const { data: mapping } = await svc
    .from('warehouse_business_mapping')
    .select('deduct_entity, deduct_warehouse')
    .eq('business_code', order.business_code)
    .eq('is_active', true)
    .maybeSingle();
  if (!mapping) throw new Error(`Warehouse mapping untuk ${order.business_code} belum ada atau inactive`);

  // Get order lines
  const { data: lines } = await svc
    .from('scalev_order_lines')
    .select('product_name, quantity')
    .eq('scalev_order_id', order.id);
  if (!lines || lines.length === 0) return { deducted: 0, skipped: 0, message: 'Tidak ada order lines' };

  let deducted = 0;
  let skipped = 0;

  for (const line of lines) {
    if (!line.product_name || !line.quantity || line.quantity <= 0) continue;

    const { data: scalevMapping } = await svc
      .from('warehouse_scalev_mapping')
      .select('warehouse_product_id, deduct_qty_multiplier, is_ignored')
      .eq('scalev_product_name', line.product_name)
      .maybeSingle();

    if (scalevMapping?.is_ignored) { skipped++; continue; }

    let targetProductId: number | null = null;
    let deductQty = line.quantity;

    if (scalevMapping?.warehouse_product_id) {
      targetProductId = scalevMapping.warehouse_product_id;
      deductQty = line.quantity * (scalevMapping.deduct_qty_multiplier || 1);
    } else {
      const { data: whProducts } = await svc
        .rpc('warehouse_find_product_for_deduction', {
          p_scalev_name: line.product_name,
          p_entity: mapping.deduct_entity,
          p_warehouse: mapping.deduct_warehouse,
        });
      if (whProducts && whProducts.length > 0) {
        targetProductId = whProducts[0].id;
      }
    }

    if (targetProductId) {
      const { error: deductErr } = await svc
        .rpc('warehouse_deduct_fifo', {
          p_product_id: targetProductId,
          p_quantity: deductQty,
          p_reference_type: 'scalev_order',
          p_reference_id: orderId,
          p_notes: `Backfill: ${line.product_name} x${deductQty} [${order.business_code}→${mapping.deduct_entity}]`,
          p_created_at: order.shipped_time || new Date().toISOString(),
        });
      if (!deductErr) deducted++;
    } else {
      skipped++;
    }
  }

  return { deducted, skipped };
}

// ── Get deduction log for a date (side-by-side scalev vs warehouse product) ──
export async function getDeductionLog(date: string) {
  await requireWarehouseAccess('Daily Summary');
  const svc = createServiceSupabase();
  const dayStart = `${date}T00:00:00+07:00`;
  const dayEnd = `${date}T23:59:59.999+07:00`;

  // Paginate to avoid Supabase max_rows limit (default 1000)
  const allData: any[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  while (true) {
    const { data: page, error: pgErr } = await svc
      .from('warehouse_stock_ledger')
      .select(`
        reference_id,
        quantity,
        notes,
        created_at,
        warehouse_products!inner(name, entity)
      `)
      .eq('reference_type', 'scalev_order')
      .eq('movement_type', 'OUT')
      .gte('created_at', dayStart)
      .lt('created_at', dayEnd)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (pgErr) throw pgErr;
    if (!page || page.length === 0) break;
    allData.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  const data = allData;

  if (data.length === 0) return { rows: [], totalUniqueOrders: 0 };

  // Get business_code for each order_id
  const orderIds = [...new Set(data.map(d => d.reference_id))];
  const bizMap = new Map<string, string>();
  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200);
    const { data: orders } = await svc
      .from('scalev_orders')
      .select('order_id, business_code')
      .in('order_id', chunk);
    (orders || []).forEach(o => bizMap.set(o.order_id, o.business_code));
  }

  // Aggregate by scalev_product + warehouse_product + entity
  const grouped = new Map<string, {
    scalev_product: string; warehouse_product: string; entity: string;
    total_qty: number; order_count: number;
    order_ids: Set<string>; business_codes: Set<string>;
  }>();
  const allOrderIds = new Set<string>();

  for (const d of data) {
    const notesMatch = (d.notes || '').match(/(?:Auto|Backfill): (.+?) x[\d.]+/);
    const wp = d.warehouse_products as any;
    const scalevProduct = notesMatch ? notesMatch[1] : d.notes || '-';
    const warehouseProduct = wp?.name || '-';
    const entity = wp?.entity || '-';
    const key = `${scalevProduct}||${warehouseProduct}||${entity}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        scalev_product: scalevProduct,
        warehouse_product: warehouseProduct,
        entity,
        total_qty: 0,
        order_count: 0,
        order_ids: new Set(),
        business_codes: new Set(),
      });
    }
    const row = grouped.get(key)!;
    row.total_qty += Math.abs(Number(d.quantity));
    row.order_ids.add(d.reference_id);
    allOrderIds.add(d.reference_id);
    const biz = bizMap.get(d.reference_id);
    if (biz) row.business_codes.add(biz);
  }

  const rows = Array.from(grouped.values())
    .map(g => ({
      scalev_product: g.scalev_product,
      warehouse_product: g.warehouse_product,
      entity: g.entity,
      total_qty: g.total_qty,
      order_count: g.order_ids.size,
      business_codes: Array.from(g.business_codes).join(', '),
    }))
    .sort((a, b) => b.total_qty - a.total_qty);

  return { rows, totalUniqueOrders: allOrderIds.size };
}

// ============================================================
// VENDORS
// ============================================================

export async function getVendors() {
  await requireVendorReadAccess('Vendor Gudang');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_vendors')
    .select('*')
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function createVendor(vendor: { name: string; address?: string; phone?: string; pic_name?: string; notes?: string; is_pkp?: boolean }) {
  await requireWarehouseSettingsPermission('whs:vendors', 'Vendor Gudang');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_vendors')
    .insert(vendor)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateVendor(id: number, updates: Record<string, any>) {
  await requireWarehouseSettingsPermission('whs:vendors', 'Vendor Gudang');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_vendors')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

export async function deleteVendor(id: number) {
  await requireWarehouseSettingsPermission('whs:vendors', 'Vendor Gudang');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_vendors')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ============================================================
// STOCK OPNAME — session-based workflow
// ============================================================

export async function getActiveSOSession() {
  await requireWarehouseAccess('Stock Opname');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_stock_opname_sessions')
    .select('*')
    .in('status', ['counting', 'reviewing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getSOSessionItems(sessionId: number) {
  await requireWarehouseAccess('Stock Opname');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_stock_opname')
    .select('*')
    .eq('session_id', sessionId)
    .order('product_name');
  if (error) throw error;
  return data || [];
}

export async function createStockOpnameSession(
  entity: string,
  warehouse: string,
  label: string,
  date: string,
) {
  await requireWarehousePermission('wh:opname_manage', 'Stock Opname');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  const { data: existingSession, error: existingErr } = await svc
    .from('warehouse_stock_opname_sessions')
    .select('id, opname_label, entity, opname_date')
    .in('status', ['counting', 'reviewing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingErr) throw existingErr;
  if (existingSession) {
    throw new Error(`Masih ada stock opname aktif (${existingSession.opname_label} - ${existingSession.entity} ${existingSession.opname_date})`);
  }

  // Create session
  const { data: session, error: sessErr } = await svc
    .from('warehouse_stock_opname_sessions')
    .insert({ entity, warehouse, opname_date: date, opname_label: label, created_by: userId })
    .select()
    .single();
  if (sessErr) throw sessErr;

  // Get all active products for this entity + warehouse
  const { data: products, error: prodErr } = await svc
    .from('warehouse_products')
    .select('id, name, category')
    .eq('entity', entity)
    .eq('warehouse', warehouse)
    .eq('is_active', true)
    .order('category')
    .order('name');
  if (prodErr) throw prodErr;

  // Get current stock balances
  const { data: balances, error: balErr } = await svc
    .from('v_warehouse_stock_balance')
    .select('product_id, current_stock')
    .eq('entity', entity)
    .eq('warehouse', warehouse);
  if (balErr) throw balErr;

  const balMap: Record<number, number> = {};
  (balances || []).forEach((b: any) => { balMap[b.product_id] = Number(b.current_stock) || 0; });

  // Pre-populate opname rows (blind count — sesudah_so starts null)
  const rows = (products || []).map(p => ({
    session_id: session.id,
    warehouse: warehouse,
    opname_date: date,
    opname_label: label,
    product_name: p.name,
    category: p.category,
    warehouse_product_id: p.id,
    sebelum_so: balMap[p.id] || 0,
    sesudah_so: null,
    selisih: 0,
  }));

  if (rows.length > 0) {
    const { error: insErr } = await svc.from('warehouse_stock_opname').insert(rows);
    if (insErr) throw insErr;
  }

  return session;
}

export async function saveStockOpnameCounts(
  sessionId: number,
  counts: { id: number; sesudah_so: number | null; sebelum_so: number }[],
) {
  await requireWarehousePermission('wh:opname_manage', 'Stock Opname');
  const svc = createServiceSupabase();

  const { data: session, error: sessionErr } = await svc
    .from('warehouse_stock_opname_sessions')
    .select('status')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionErr) throw sessionErr;
  if (!session || session.status !== 'counting') {
    throw new Error('Stock opname ini tidak sedang dalam fase hitung');
  }

  for (const c of counts) {
    const selisih = c.sesudah_so != null ? c.sesudah_so - c.sebelum_so : 0;
    const { error } = await svc
      .from('warehouse_stock_opname')
      .update({ sesudah_so: c.sesudah_so, selisih })
      .eq('id', c.id)
      .eq('session_id', sessionId);
    if (error) throw error;
  }
}

export async function submitSOForReview(sessionId: number) {
  await requireWarehousePermission('wh:opname_manage', 'Stock Opname');
  const svc = createServiceSupabase();

  const { data: session, error: sessionErr } = await svc
    .from('warehouse_stock_opname_sessions')
    .select('status')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionErr) throw sessionErr;
  if (!session || session.status !== 'counting') {
    throw new Error('Stock opname ini tidak sedang dalam fase hitung');
  }

  const { count: incompleteCount, error: incompleteErr } = await svc
    .from('warehouse_stock_opname')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .is('sesudah_so', null);
  if (incompleteErr) throw incompleteErr;
  if ((incompleteCount || 0) > 0) {
    throw new Error('Masih ada item yang belum diisi stok fisiknya');
  }

  const { error } = await svc
    .from('warehouse_stock_opname_sessions')
    .update({ status: 'reviewing' })
    .eq('id', sessionId)
    .eq('status', 'counting');
  if (error) throw error;
}

export async function revertSOToCounting(sessionId: number) {
  await requireWarehousePermission('wh:opname_manage', 'Stock Opname');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_stock_opname_sessions')
    .update({ status: 'counting' })
    .eq('id', sessionId)
    .eq('status', 'reviewing');
  if (error) throw error;
}

export async function approveStockOpname(sessionId: number) {
  await requireWarehousePermission('wh:opname_approve', 'Approve Stock Opname');
  const svc = createServiceSupabase();

  const { data: session, error: sessionErr } = await svc
    .from('warehouse_stock_opname_sessions')
    .select('status')
    .eq('id', sessionId)
    .maybeSingle();
  if (sessionErr) throw sessionErr;
  if (!session || session.status !== 'reviewing') {
    throw new Error('Stock opname ini tidak siap di-approve');
  }

  const { count: incompleteCount, error: incompleteErr } = await svc
    .from('warehouse_stock_opname')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .is('sesudah_so', null);
  if (incompleteErr) throw incompleteErr;
  if ((incompleteCount || 0) > 0) {
    throw new Error('Masih ada item stock opname yang belum dihitung');
  }

  const { data: existingAdjustments, error: adjustmentErr } = await svc
    .from('warehouse_stock_ledger')
    .select('id')
    .eq('reference_type', 'opname')
    .like('notes', `[SO#${sessionId}]%`)
    .limit(1);
  if (adjustmentErr) throw adjustmentErr;
  if (existingAdjustments && existingAdjustments.length > 0) {
    throw new Error('Stock opname ini sudah pernah di-adjust');
  }

  // Get all items with variance
  const { data: items, error: itemErr } = await svc
    .from('warehouse_stock_opname')
    .select('*')
    .eq('session_id', sessionId)
    .neq('selisih', 0);
  if (itemErr) throw itemErr;

  // Create ADJUST entries for each variance
  for (const item of (items || [])) {
    if (!item.warehouse_product_id || item.selisih === 0) continue;
    await recordStockAdjustInternal(
      item.warehouse_product_id,
      null,
      item.selisih,
      `[SO#${sessionId}] Stock Opname: ${item.opname_label} — ${item.product_name} (${item.sebelum_so} → ${item.sesudah_so})`,
    );
  }

  // Mark session completed
  const { error } = await svc
    .from('warehouse_stock_opname_sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('status', 'reviewing');
  if (error) throw error;

  return (items || []).length;
}

export async function cancelSOSession(sessionId: number) {
  await requireWarehousePermission('wh:opname_manage', 'Stock Opname');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_stock_opname_sessions')
    .update({ status: 'canceled' })
    .eq('id', sessionId)
    .eq('status', 'counting');
  if (error) throw error;
}
