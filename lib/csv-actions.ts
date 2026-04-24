// lib/csv-actions.ts
'use server';
import { createServiceSupabase } from '@/lib/supabase-server';
import {
  cleanWarehouseDomainText,
  fetchWarehouseBusinessDirectoryRows,
  fetchWarehouseOriginRegistryRows,
  resolveWarehouseBusinessCode,
  resolveWarehouseOrigin,
} from '@/lib/warehouse-domain-helpers';

// ── Brand keyword type ──
type BrandKeyword = { name: string; keywords: string[] };

// ── Fetch brand keywords from DB (called once per upload) ──
async function fetchBrandKeywords(): Promise<BrandKeyword[]> {
  try {
    const svc = createServiceSupabase();
    const { data } = await svc
      .from('brands')
      .select('name, keywords')
      .eq('is_active', true);
    return (data || []).map((b: any) => ({
      name: b.name,
      keywords: b.keywords
        ? b.keywords.split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean)
        : [b.name.toLowerCase()],
    }));
  } catch {
    return [];
  }
}

// ── Fetch bonus item names from product_mapping ──
async function fetchBonusItemNames(): Promise<Set<string>> {
  try {
    const svc = createServiceSupabase();
    const { data } = await svc
      .from('product_mapping')
      .select('product_name')
      .eq('is_bonus', true);
    return new Set((data || []).map((r: any) => r.product_name.toLowerCase()));
  } catch {
    return new Set();
  }
}

// ── Brand detection from item_name or item_owner (dynamic) ──
function deriveBrandFromItem(itemName: string, itemOwner: string, brands: BrandKeyword[]): string {
  const n = (itemName || '').toLowerCase();
  const o = (itemOwner || '').toLowerCase();
  for (const brand of brands) {
    if (brand.keywords.some(kw => n.includes(kw) || o.includes(kw))) {
      return brand.name;
    }
  }
  return 'Other';
}

function deriveBrandFromStore(storeName: string, brands: BrandKeyword[]): string {
  const s = (storeName || '').toLowerCase();
  if (s.includes('free store')) return 'Other';
  for (const brand of brands) {
    if (brand.keywords.some(kw => s.includes(kw))) {
      return brand.name;
    }
  }
  return 'Unknown';
}

import { guessStoreType, deriveChannelFromStoreType } from '@/lib/scalev-api';

function deriveSalesChannel(row: Record<string, string>): string {
  const storeType = guessStoreType(row.store || '');
  const isPurchaseFb = row.is_purchase_fb === 'true';
  return deriveChannelFromStoreType(storeType, isPurchaseFb, {
    platform: row.platform,
    external_id: row.external_id,
  });
}

export async function uploadCsvOrders(formData: FormData) {
  const file = formData.get('file') as File;
  if (!file) throw new Error('No file provided');

  const csvText = await file.text();
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV is empty');

  const headers = lines[0].split(';').map(h => h.trim());
  const requiredCols = ['order_id', 'store', 'order_status', 'name'];
  const missing = requiredCols.filter(c => !headers.includes(c));
  if (missing.length > 0) {
    throw new Error(`Missing columns: ${missing.join(', ')}. Pastikan CSV semicolon-delimited dari Scalev.`);
  }

  const isProductBased = headers.includes('item_name');
  const svc = createServiceSupabase();
  const [businessDirectoryRows, originRegistryRows] = await Promise.all([
    fetchWarehouseBusinessDirectoryRows(svc),
    fetchWarehouseOriginRegistryRows(svc),
  ]);

  // Fetch brand keywords from DB for dynamic detection
  const brandKeywords = await fetchBrandKeywords();
  const bonusNames = await fetchBonusItemNames();

  // ── Collect CSV order IDs ──
  const csvOrderIdSet = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const orderId = line.split(';')[0]?.trim();
    if (orderId) csvOrderIdSet.add(orderId);
  }
  const csvOrderIds = Array.from(csvOrderIdSet);

  // ── Fetch existing orders ──
  const existingOrders: any[] = [];
  const CHUNK = 200;
  for (let i = 0; i < csvOrderIds.length; i += CHUNK) {
    const chunk = csvOrderIds.slice(i, i + CHUNK);
    const { data, error } = await svc
      .from('scalev_orders')
      .select('id, order_id, customer_name, customer_phone, customer_email')
      .in('order_id', chunk);
    if (error) throw error;
    if (data) existingOrders.push(...data);
  }
  const existingMap = new Map(existingOrders.map(o => [o.order_id, o]));

  const stats = {
    totalRows: 0, newInserted: 0, updated: 0,
    errors: [] as string[], format: isProductBased ? 'product-based' : 'order-based',
    totalLineItems: 0,
  };

  // ── Parse rows — group by order_id ──
  const orderRows: Record<string, Record<string, string>[]> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    stats.totalRows++;
    const values = line.split(';');
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] || '').trim();
    }
    if (!row.order_id) continue;
    if (!orderRows[row.order_id]) orderRows[row.order_id] = [];
    orderRows[row.order_id].push(row);
  }

  const num = (v: string) => parseFloat(v || '0') || 0;
  // Normalize timestamp strings: Scalev CSV exports use DD/MM/YYYY format
  // (Indonesian locale). PostgreSQL defaults to MDY, so 03/02/2026 would be
  // misread as March 2 instead of February 3. Convert to ISO format here.
  const ts = (v: string): string | null => {
    if (!v || !v.trim()) return null;
    const s = v.trim();
    // Already ISO format (2026-02-03 or 2026-02-03T...)
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
    // DD/MM/YYYY HH:mm[:ss] or DD/MM/YYYY
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(.*))?$/);
    if (m) {
      const day = m[1].padStart(2, '0');
      const mon = m[2].padStart(2, '0');
      const year = m[3];
      const time = m[4] ? `T${m[4]}` : '';
      return `${year}-${mon}-${day}${time}`;
    }
    return s;
  };

  const toInsert: any[] = [];
  const toUpdate: { id: number; data: any; orderId: string }[] = [];
  const orderLinesMap: Record<string, any[]> = {};
  const isNewOrder: Record<string, boolean> = {};

  for (const [orderId, rows] of Object.entries(orderRows)) {
    const firstRow = rows[0];
    const salesChannel = deriveSalesChannel(firstRow);
    const shippedTime = ts(firstRow.shipped_time) || ts(firstRow.completed_time) || null;
    const completedTime = ts(firstRow.completed_time) || null;
    const businessNameRaw = cleanWarehouseDomainText(firstRow.business_name || null);
    const originBusinessNameRaw = cleanWarehouseDomainText(firstRow.origin_business_name || null);
    const originRaw = cleanWarehouseDomainText(firstRow.origin || null);
    const sellerResolution = resolveWarehouseBusinessCode({
      rawValue: businessNameRaw,
      fallbackBusinessCode: null,
      directoryRows: businessDirectoryRows,
    });
    const originOperatorResolution = resolveWarehouseBusinessCode({
      rawValue: originBusinessNameRaw,
      fallbackBusinessCode: null,
      directoryRows: businessDirectoryRows,
    });
    const originRegistryResolution = resolveWarehouseOrigin({
      rawOriginBusinessName: originBusinessNameRaw,
      rawOriginName: originRaw,
      registryRows: originRegistryRows,
    });

    // ── Build line items ──
    const lineItems: any[] = [];
    if (isProductBased) {
      for (const row of rows) {
        const itemName = row.item_name || '';
        const itemOwnerRaw = cleanWarehouseDomainText(row.item_owner || null);
        if (!itemName) continue;
        const brand = deriveBrandFromItem(itemName, row.item_owner || '', brandKeywords);
        const ownerResolution = resolveWarehouseBusinessCode({
          rawValue: itemOwnerRaw,
          fallbackBusinessCode: null,
          directoryRows: businessDirectoryRows,
        });
        lineItems.push({
          order_id: orderId, product_name: itemName, product_type: brand,
          variant_sku: null, quantity: parseInt(row.item_quantity || '0') || 0,
          item_name_raw: itemName,
          item_owner_raw: itemOwnerRaw,
          stock_owner_business_code: ownerResolution.business_code || null,
          product_price_bt: num(row.item_product_price_bt),
          discount_bt: num(row.item_product_discount_bt),
          cogs_bt: num(row.item_cogs_bt),
          tax_rate: num(firstRow.tax_rate) || 11.0,
          sales_channel: salesChannel,
          is_purchase_fb: firstRow.is_purchase_fb === 'true',
          is_purchase_tiktok: firstRow.is_purchase_tiktok === 'true',
          is_purchase_kwai: firstRow.is_purchase_kwai === 'true',
          synced_at: new Date().toISOString(),
        });
      }
    } else {
      const brand = deriveBrandFromStore(firstRow.store || '', brandKeywords);
      lineItems.push({
        order_id: orderId, product_name: brand, product_type: brand,
        variant_sku: null, quantity: parseInt(firstRow.quantity || '0') || 0,
        item_name_raw: brand,
        item_owner_raw: null,
        stock_owner_business_code: null,
        product_price_bt: num(firstRow.product_price_bt),
        discount_bt: num(firstRow.product_discount_bt),
        cogs_bt: num(firstRow.cogs_bt),
        tax_rate: num(firstRow.tax_rate) || 11.0,
        sales_channel: salesChannel,
        is_purchase_fb: firstRow.is_purchase_fb === 'true',
        is_purchase_tiktok: firstRow.is_purchase_tiktok === 'true',
        is_purchase_kwai: firstRow.is_purchase_kwai === 'true',
        synced_at: new Date().toISOString(),
      });
    }

    // Reassign bonus items to the dominant non-bonus brand in this order
    if (isProductBased && bonusNames.size > 0) {
      const bonusIdx: number[] = [];
      for (let i = 0; i < lineItems.length; i++) {
        if (bonusNames.has(lineItems[i].product_name.toLowerCase())) bonusIdx.push(i);
      }
      if (bonusIdx.length > 0 && bonusIdx.length < lineItems.length) {
        const brandRev: Record<string, number> = {};
        for (let i = 0; i < lineItems.length; i++) {
          if (bonusIdx.includes(i)) continue;
          const b = lineItems[i].product_type;
          if (b && b !== 'Unknown' && b !== 'Other') {
            brandRev[b] = (brandRev[b] || 0) + (lineItems[i].product_price_bt - lineItems[i].discount_bt);
          }
        }
        const dominant = Object.entries(brandRev).sort((a, b) => b[1] - a[1])[0]?.[0];
        if (dominant) {
          for (const i of bonusIdx) lineItems[i].product_type = dominant;
        }
      }
    }

    stats.totalLineItems += lineItems.length;
    orderLinesMap[orderId] = lineItems;

    const existing = existingMap.get(orderId);
    if (existing) {
      const d: any = {};
      // Purchase flags & platform — CSV is source of truth, always update
      d.is_purchase_fb = firstRow.is_purchase_fb === 'true';
      d.is_purchase_tiktok = firstRow.is_purchase_tiktok === 'true';
      d.is_purchase_kwai = firstRow.is_purchase_kwai === 'true';
      if (firstRow.platform) d.platform = firstRow.platform;
      if (firstRow.store) d.store_name = firstRow.store;
      d.business_name_raw = businessNameRaw;
      d.origin_business_name_raw = originBusinessNameRaw;
      d.origin_raw = originRaw;
      d.seller_business_code = sellerResolution.business_code || null;
      d.origin_operator_business_code = originRegistryResolution.operator_business_code || originOperatorResolution.business_code || null;
      d.origin_registry_id = originRegistryResolution.id || null;
      if (firstRow.utm_source) d.utm_source = firstRow.utm_source;
      if (firstRow.customer_type) d.customer_type = firstRow.customer_type;
      if (firstRow.province) d.province = firstRow.province;
      if (firstRow.city) d.city = firstRow.city;
      if (firstRow.subdistrict) d.subdistrict = firstRow.subdistrict;
      if (firstRow.handler) d.handler = firstRow.handler;
      if (firstRow.name && !existing.customer_name) d.customer_name = firstRow.name;
      if (firstRow.phone && !existing.customer_phone) d.customer_phone = firstRow.phone;
      if (firstRow.email && !existing.customer_email) d.customer_email = firstRow.email;
      if (firstRow.order_status) d.status = firstRow.order_status;
      if (shippedTime) d.shipped_time = shippedTime;
      if (ts(firstRow.paid_time)) d.paid_time = ts(firstRow.paid_time);
      if (ts(firstRow.canceled_time)) d.canceled_time = ts(firstRow.canceled_time);
      if (ts(firstRow.confirmed_time)) d.confirmed_time = ts(firstRow.confirmed_time);
      if (ts(firstRow.draft_time)) d.draft_time = ts(firstRow.draft_time);
      if (ts(firstRow.pending_time)) d.pending_time = ts(firstRow.pending_time);
      if (completedTime) d.completed_time = completedTime;
      if (num(firstRow.gross_revenue) > 0) d.gross_revenue = num(firstRow.gross_revenue);
      if (num(firstRow.net_revenue) > 0) d.net_revenue = num(firstRow.net_revenue);
      if (num(firstRow.shipping_cost) > 0) d.shipping_cost = num(firstRow.shipping_cost);
      if (Object.keys(d).length > 0) {
        d.synced_at = new Date().toISOString();
        toUpdate.push({ id: existing.id, data: d, orderId });
      }
      isNewOrder[orderId] = false;
    } else {
      toInsert.push({
        scalev_id: null, order_id: orderId,
        customer_type: firstRow.customer_type || null,
        status: firstRow.order_status || 'unknown', shipped_time: shippedTime,
        platform: firstRow.platform || null, store_name: firstRow.store || null,
        business_name_raw: businessNameRaw,
        origin_business_name_raw: originBusinessNameRaw,
        origin_raw: originRaw,
        seller_business_code: sellerResolution.business_code || null,
        origin_operator_business_code: originRegistryResolution.operator_business_code || originOperatorResolution.business_code || null,
        origin_registry_id: originRegistryResolution.id || null,
        utm_source: firstRow.utm_source || null, financial_entity: firstRow.financial_entity || null,
        payment_method: firstRow.payment_method || null,
        unique_code_discount: num(firstRow.unique_code_discount),
        is_purchase_fb: firstRow.is_purchase_fb === 'true',
        is_purchase_tiktok: firstRow.is_purchase_tiktok === 'true',
        is_purchase_kwai: firstRow.is_purchase_kwai === 'true',
        gross_revenue: num(firstRow.gross_revenue), net_revenue: num(firstRow.net_revenue),
        shipping_cost: num(firstRow.shipping_cost),
        total_quantity: parseInt(firstRow.quantity || '0') || 0,
        customer_name: firstRow.name || null, customer_phone: firstRow.phone || null,
        customer_email: firstRow.email || null, province: firstRow.province || null,
        city: firstRow.city || null, subdistrict: firstRow.subdistrict || null,
        handler: firstRow.handler || null,
        draft_time: ts(firstRow.draft_time), pending_time: ts(firstRow.pending_time),
        confirmed_time: ts(firstRow.confirmed_time), paid_time: ts(firstRow.paid_time),
        completed_time: completedTime,
        canceled_time: ts(firstRow.canceled_time),
        source: 'csv_upload', raw_data: firstRow, synced_at: new Date().toISOString(),
      });
      isNewOrder[orderId] = true;
    }
  }

  // ── Phase 2: Batch INSERT ──
  const BATCH = 200;
  const insertedIdMap: Record<string, number> = {};
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { data: inserted, error: err } = await svc
      .from('scalev_orders')
      .upsert(batch, { onConflict: 'order_id', ignoreDuplicates: true })
      .select('id, order_id');
    if (err) { stats.errors.push(`Insert batch ${Math.floor(i / BATCH) + 1}: ${err.message}`); continue; }
    if (inserted) {
      for (const o of inserted) insertedIdMap[o.order_id] = o.id;
      stats.newInserted += inserted.length;
    }
  }

  // ── Phase 3: Batch UPDATE ──
  const UPDATE_BATCH = 200;
  for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
    const batch = toUpdate.slice(i, i + UPDATE_BATCH);
    const upsertRows = batch.map(upd => ({ id: upd.id, order_id: upd.orderId, ...upd.data }));
    const { error } = await svc.from('scalev_orders').upsert(upsertRows, { onConflict: 'id' });
    if (error) stats.errors.push(`Update batch ${Math.floor(i / UPDATE_BATCH) + 1}: ${error.message}`);
    else stats.updated += batch.length;
  }

  // ── Phase 4: Line items ──
  if (isProductBased) {
    const existingIdMap: Record<string, number> = {};
    for (const o of existingOrders) existingIdMap[o.order_id] = o.id;
    const allIdMap = { ...existingIdMap, ...insertedIdMap };

    const allOrderIds = Object.keys(orderLinesMap);
    for (let i = 0; i < allOrderIds.length; i += UPDATE_BATCH) {
      const batchOrderIds = allOrderIds.slice(i, i + UPDATE_BATCH);
      const dbIds = batchOrderIds.map(oid => allIdMap[oid]).filter(Boolean);
      if (dbIds.length > 0) {
        await svc.from('scalev_order_lines').delete().in('scalev_order_id', dbIds);
        const lineBatch: any[] = [];
        for (const oid of batchOrderIds) {
          const dbId = allIdMap[oid];
          if (!dbId) continue;
          for (const line of orderLinesMap[oid]) lineBatch.push({ ...line, scalev_order_id: dbId });
        }
        for (let j = 0; j < lineBatch.length; j += 500) {
          const subBatch = lineBatch.slice(j, j + 500);
          const { error: lineErr } = await svc.from('scalev_order_lines').upsert(subBatch, { onConflict: 'scalev_order_id,product_name' });
          if (lineErr) stats.errors.push(`Lines batch: ${lineErr.message}`);
        }
      }
    }
  } else {
    const existingIdMap: Record<string, number> = {};
    for (const o of existingOrders) existingIdMap[o.order_id] = o.id;

    for (const [orderId, lines] of Object.entries(orderLinesMap)) {
      if (isNewOrder[orderId]) {
        // New order — insert line items
        const dbId = insertedIdMap[orderId];
        if (!dbId) continue;
        const lineBatch = lines.map(line => ({ ...line, scalev_order_id: dbId }));
        const { error: lineErr } = await svc.from('scalev_order_lines').upsert(lineBatch, { onConflict: 'scalev_order_id,product_name' });
        if (lineErr) stats.errors.push(`Lines ${orderId}: ${lineErr.message}`);
      } else {
        // Existing order — update sales_channel & purchase flags on existing line items
        const dbId = existingIdMap[orderId];
        if (!dbId || !lines[0]) continue;
        const { error: updErr } = await svc.from('scalev_order_lines')
          .update({
            sales_channel: lines[0].sales_channel,
            is_purchase_fb: lines[0].is_purchase_fb,
            is_purchase_tiktok: lines[0].is_purchase_tiktok,
            is_purchase_kwai: lines[0].is_purchase_kwai,
            synced_at: new Date().toISOString(),
          })
          .eq('scalev_order_id', dbId);
        if (updErr) stats.errors.push(`Lines update ${orderId}: ${updErr.message}`);
      }
    }
  }

  // ── Log ──
  const uploadedBy = formData.get('uploaded_by') as string || null;
  const filename = formData.get('filename') as string || file.name;
  await svc.from('scalev_sync_log').insert({
    status: stats.errors.length > 0 ? 'partial' : 'success',
    sync_type: 'csv_upload',
    orders_fetched: stats.totalRows,
    orders_inserted: stats.newInserted,
    orders_updated: stats.updated,
    uploaded_by: uploadedBy, filename,
    error_message: stats.errors.length > 0
      ? `${stats.errors.length} errors: ${stats.errors.slice(0, 5).join('; ')}` : null,
    completed_at: new Date().toISOString(),
  });

  return {
    success: true, filename: file.name,
    stats: {
      totalRows: stats.totalRows, newInserted: stats.newInserted,
      updated: stats.updated, errors: stats.errors.length,
      errorDetails: stats.errors.slice(0, 10),
      format: stats.format, lineItems: stats.totalLineItems,
    },
    message: `Upload selesai (${stats.format})! ${stats.newInserted} order baru, ${stats.updated} order diperkaya, ${stats.totalLineItems} line items, ${stats.errors.length} error.`,
  };
}
