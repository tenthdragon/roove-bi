// lib/warehouse-ledger-actions.ts
'use server';

import { createServiceSupabase, createServerSupabase } from './supabase-server';
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

// ============================================================
// TELEGRAM NOTIFICATION (fire-and-forget)
// ============================================================

async function notifyDirekturs(message: string) {
  try {
    const svc = createServiceSupabase();
    const { data: direkturs } = await svc
      .from('profiles')
      .select('telegram_chat_id')
      .eq('role', 'direktur_operasional')
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

// ============================================================
// STOCK IN — vendor delivery, RTS, production received
// ============================================================

export async function recordStockIn(
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
  if (quantity <= 0) throw new Error('Stock OUT quantity must be positive');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  // Update batch qty
  if (batchId) {
    const { data: batch } = await svc
      .from('warehouse_batches')
      .select('current_qty')
      .eq('id', batchId)
      .single();
    if (batch) {
      await svc
        .from('warehouse_batches')
        .update({ current_qty: Math.max(0, Number(batch.current_qty) - quantity) })
        .eq('id', batchId);
    }
  }

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
// STOCK ADJUST — stock opname correction
// ============================================================

export async function recordStockAdjust(
  productId: number,
  batchId: number | null,
  adjustmentQty: number, // positive = surplus, negative = deficit
  notes?: string,
) {
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  if (batchId) {
    const { data: batch } = await svc
      .from('warehouse_batches')
      .select('current_qty')
      .eq('id', batchId)
      .single();
    if (batch) {
      await svc
        .from('warehouse_batches')
        .update({ current_qty: Math.max(0, Number(batch.current_qty) + adjustmentQty) })
        .eq('id', batchId);
    }
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
  if (quantity <= 0) throw new Error('Transfer quantity must be positive');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

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

  // Update batch qty (deduct from source)
  if (batchId) {
    const { data: batch } = await svc
      .from('warehouse_batches')
      .select('current_qty')
      .eq('id', batchId)
      .single();
    if (batch) {
      await svc
        .from('warehouse_batches')
        .update({ current_qty: Math.max(0, Number(batch.current_qty) - quantity) })
        .eq('id', batchId);
    }
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

  const { data: prod } = await svc.from('warehouse_products').select('name, warehouse, entity').eq('id', productId).single();
  if (prod) {
    const userName = await getCurrentUserName();
    notifyDirekturs(formatNotification('Transfer', prod.name, quantity, `${fromEntity} → ${toEntity}`, userName, `Dari: ${fromWarehouse} - ${fromEntity}\nKe: ${toWarehouse} - ${toEntity}`));
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
      const { data: batch } = await svc
        .from('warehouse_batches')
        .select('current_qty')
        .eq('id', src.batchId)
        .single();
      if (batch) {
        await svc
          .from('warehouse_batches')
          .update({ current_qty: Math.max(0, Number(batch.current_qty) - src.quantity) })
          .eq('id', src.batchId);
      }
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
    const { data: newBatch } = await svc
      .from('warehouse_batches')
      .upsert({
        warehouse_product_id: targetProductId,
        batch_code: targetBatchCode,
        expired_date: targetExpiredDate || null,
        initial_qty: targetQty,
        current_qty: targetQty,
      }, { onConflict: 'warehouse_product_id,batch_code' })
      .select()
      .single();
    if (newBatch) {
      targetBatchId = newBatch.id;
      if (newBatch.initial_qty !== targetQty) {
        await svc
          .from('warehouse_batches')
          .update({ current_qty: Number(newBatch.current_qty) + targetQty })
          .eq('id', newBatch.id);
      }
    }
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
  if (quantity <= 0) throw new Error('Dispose quantity must be positive');
  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  if (batchId) {
    const { data: batch } = await svc
      .from('warehouse_batches')
      .select('current_qty')
      .eq('id', batchId)
      .single();
    if (batch) {
      await svc
        .from('warehouse_batches')
        .update({ current_qty: Math.max(0, Number(batch.current_qty) - quantity) })
        .eq('id', batchId);
    }
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

export async function createBatch(
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

// ============================================================
// QUERIES
// ============================================================

export async function getProducts(filters?: {
  category?: string;
  entity?: string;
  warehouse?: string;
  activeOnly?: boolean;
}) {
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
  const svc = createServiceSupabase();
  let query = svc.from('v_warehouse_stock_balance').select('*');
  if (productId) query = query.eq('product_id', productId);
  const { data, error } = await query.order('category').order('product_name');
  if (error) throw error;
  return data || [];
}

export async function getStockByBatch(productId?: number) {
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

export async function getBatches(productId: number) {
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

export async function updateScalevMapping(
  id: number,
  warehouseProductId: number | null,
  multiplier?: number,
  isIgnored?: boolean,
  notes?: string,
) {
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
  const svc = createServiceSupabase();
  // Insert any new product_names not yet in mapping table
  const { error } = await svc.rpc('warehouse_sync_scalev_names');
  if (error) throw error;
}
