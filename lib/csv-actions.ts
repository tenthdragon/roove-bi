// lib/csv-actions.ts
'use server';
import { createServiceSupabase } from '@/lib/supabase-server';

// ── Brand detection from item_name or item_owner ──
function deriveBrandFromItem(itemName: string, itemOwner: string): string {
  const n = (itemName || '').toLowerCase();
  const o = (itemOwner || '').toLowerCase();
  if (n.includes('osgard') || o.includes('osgard')) return 'Osgard';
  if (n.includes('purvu') || n.includes('secret') || o.includes('purvu') || o.includes('secret')) return 'Purvu';
  if (n.includes('pluve') || o.includes('pluve')) return 'Pluve';
  if (n.includes('globite') || o.includes('globite')) return 'Globite';
  if (n.includes('drhyun') || n.includes('dr hyun') || o.includes('drhyun') || o.includes('dr hyun')) return 'DrHyun';
  if (n.includes('calmara') || o.includes('calmara')) return 'Calmara';
  if (n.includes('almona') || o.includes('almona')) return 'Almona';
  if (n.includes('yuv') || o.includes('yuv')) return 'YUV';
  if (n.includes('veminine') || o.includes('veminine')) return 'Veminine';
  if (n.includes('orelif') || o.includes('orelif')) return 'Orelif';
  if (n.includes('roove') || n.includes('shaker') || n.includes('jam tangan') || o.includes('roove')) return 'Roove';
  return 'Other';
}

function deriveBrandFromStore(storeName: string): string {
  const s = (storeName || '').toLowerCase();
  if (s.includes('osgard')) return 'Osgard';
  if (s.includes('purvu') || s.includes('secret')) return 'Purvu';
  if (s.includes('pluve')) return 'Pluve';
  if (s.includes('globite')) return 'Globite';
  if (s.includes('drhyun') || s.includes('dr hyun')) return 'DrHyun';
  if (s.includes('calmara')) return 'Calmara';
  if (s.includes('almona')) return 'Almona';
  if (s.includes('yuv')) return 'YUV';
  if (s.includes('veminine')) return 'Veminine';
  if (s.includes('orelif')) return 'Orelif';
  if (s.includes('free store')) return 'Other';
  if (s.includes('roove')) return 'Roove';
  return 'Unknown';
}

function deriveSalesChannel(row: Record<string, string>): string {
  const platform = (row.platform || '').toLowerCase();
  const storeName = (row.store || '').toLowerCase();
  const isPurchaseFb = row.is_purchase_fb === 'true';
  const isPurchaseTiktok = row.is_purchase_tiktok === 'true';
  const resellerPrice = parseFloat(row.reseller_product_price || '0');

  if (platform === 'shopee' || storeName.includes('shopee')) return 'Shopee';
  if (platform === 'tiktokshop' || platform === 'tiktok' || storeName.includes('tiktok')) return 'TikTok Shop';
  if (platform === 'lazada' || storeName.includes('lazada')) return 'Lazada';
  if (platform === 'tokopedia' || storeName.includes('tokopedia')) return 'Tokopedia';
  if (platform === 'blibli' || storeName.includes('blibli')) return 'BliBli';
  if (resellerPrice > 0 && storeName.includes('mitra')) return 'Reseller';

  if (platform === 'scalev' || platform === '') {
    if (isPurchaseFb) return 'Facebook Ads';
    if (isPurchaseTiktok) return 'TikTok Ads';
    return 'Organik';
  }
  return 'Organik';
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
  const ts = (v: string) => (v && v.trim()) ? v.trim() : null;

  const toInsert: any[] = [];
  const toUpdate: { id: number; data: any; orderId: string }[] = [];
  const orderLinesMap: Record<string, any[]> = {};
  const isNewOrder: Record<string, boolean> = {};

  for (const [orderId, rows] of Object.entries(orderRows)) {
    const firstRow = rows[0];
    const salesChannel = deriveSalesChannel(firstRow);
    const shippedTime = ts(firstRow.shipped_time) || ts(firstRow.completed_time) || null;

    // ── Build line items ──
    const lineItems: any[] = [];
    if (isProductBased) {
      for (const row of rows) {
        const itemName = row.item_name || '';
        if (!itemName) continue;
        const brand = deriveBrandFromItem(itemName, row.item_owner || '');
        lineItems.push({
          order_id: orderId, product_name: itemName, product_type: brand,
          variant_sku: null, quantity: parseInt(row.item_quantity || '0') || 0,
          product_price_bt: num(row.item_product_price_bt),
          discount_bt: num(row.item_product_discount_bt),
          cogs_bt: num(row.item_cogs_bt),
          tax_rate: num(firstRow.tax_rate) || 11.0, shipped_time: shippedTime,
          sales_channel: salesChannel,
          is_purchase_fb: firstRow.is_purchase_fb === 'true',
          is_purchase_tiktok: firstRow.is_purchase_tiktok === 'true',
          is_purchase_kwai: firstRow.is_purchase_kwai === 'true',
          synced_at: new Date().toISOString(),
        });
      }
    } else {
      const brand = deriveBrandFromStore(firstRow.store || '');
      lineItems.push({
        order_id: orderId, product_name: brand, product_type: brand,
        variant_sku: null, quantity: parseInt(firstRow.quantity || '0') || 0,
        product_price_bt: num(firstRow.product_price_bt),
        discount_bt: num(firstRow.product_discount_bt),
        cogs_bt: num(firstRow.cogs_bt),
        tax_rate: num(firstRow.tax_rate) || 11.0, shipped_time: shippedTime,
        sales_channel: salesChannel,
        is_purchase_fb: firstRow.is_purchase_fb === 'true',
        is_purchase_tiktok: firstRow.is_purchase_tiktok === 'true',
        is_purchase_kwai: firstRow.is_purchase_kwai === 'true',
        synced_at: new Date().toISOString(),
      });
    }

    stats.totalLineItems += lineItems.length;
    orderLinesMap[orderId] = lineItems;

    const existing = existingMap.get(orderId);
    if (existing) {
      const d: any = {};
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
          const { error: lineErr } = await svc.from('scalev_order_lines').insert(subBatch);
          if (lineErr) stats.errors.push(`Lines batch: ${lineErr.message}`);
        }
      }
    }
  } else {
    for (const [orderId, lines] of Object.entries(orderLinesMap)) {
      if (!isNewOrder[orderId]) continue;
      const dbId = insertedIdMap[orderId];
      if (!dbId) continue;
      const lineBatch = lines.map(line => ({ ...line, scalev_order_id: dbId }));
      const { error: lineErr } = await svc.from('scalev_order_lines').insert(lineBatch);
      if (lineErr) stats.errors.push(`Lines ${orderId}: ${lineErr.message}`);
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
