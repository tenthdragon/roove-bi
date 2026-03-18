// app/api/csv-upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { triggerViewRefresh } from '@/lib/refresh-views';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export const maxDuration = 250;
const MAX_CSV_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_CSV_LOGICAL_LINES = 200_000;

// ── Types ──
type FileFormat = 'scalev' | 'ops';

// ── Brand detection from item_name or store_name ──
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

function deriveBrandFromSku(sku: string): string {
  const s = (sku || '').toUpperCase();
  if (s.includes('OSG')) return 'Osgard';
  if (s.includes('PRV') || s.includes('PUR') || s.includes('SEC')) return 'Purvu';
  if (s.includes('PLV') || s.includes('PLU')) return 'Pluve';
  if (s.includes('GLB') || s.includes('GLO')) return 'Globite';
  if (s.includes('DRH') || s.includes('HYU')) return 'DrHyun';
  if (s.includes('CLM') || s.includes('CAL')) return 'Calmara';
  if (s.includes('ALM')) return 'Almona';
  if (s.includes('YUV')) return 'YUV';
  if (s.includes('VEM')) return 'Veminine';
  if (s.includes('ORL') || s.includes('ORE')) return 'Orelif';
  if (s.includes('ROV') || s.includes('ROO')) return 'Roove';
  return 'Other';
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
  if (resellerPrice > 0 && storeName.includes('reseller')) return 'Reseller';
  if (storeName.includes('reseller')) return 'Reseller';

  if (platform === 'scalev' || platform === '') {
    if (isPurchaseFb) return 'Scalev Ads';
    if (isPurchaseTiktok) return 'CS Manual';
    return 'CS Manual';
  }
  return 'CS Manual';
}

// ── Sales channel for ops file (simpler, uses platform field directly) ──
function deriveSalesChannelFromOps(platform: string): string {
  const p = (platform || '').toLowerCase();
  if (p === 'shopee') return 'Shopee';
  if (p === 'tiktokshop' || p === 'tiktok') return 'TikTok Shop';
  if (p === 'lazada') return 'Lazada';
  if (p === 'tokopedia') return 'Tokopedia';
  if (p === 'blibli') return 'BliBli';
  return 'CS Manual';
}

// ── Detect file format ──
function detectFormat(firstLine: string): { format: FileFormat; delimiter: string; headers: string[] } {
  const normalized = firstLine.replace(/^\uFEFF/, '').toLowerCase();

  // Ops file: comma-delimited, has 'username' column
  // Scalev file: semicolon-delimited, has 'order_id' column

  if (normalized.includes(';') && normalized.includes('order_id')) {
    const headers = firstLine.replace(/^\uFEFF/, '').split(';').map(h => sanitizeCsvCell(h));
    return { format: 'scalev', delimiter: ';', headers };
  }

  if (normalized.includes(',') && normalized.includes('username')) {
    const headers = firstLine.replace(/^\uFEFF/, '').split(',').map(h => sanitizeCsvCell(h));
    return { format: 'ops', delimiter: ',', headers };
  }

  // Fallback: try semicolon first (Scalev)
  if (normalized.includes(';')) {
    const headers = firstLine.replace(/^\uFEFF/, '').split(';').map(h => sanitizeCsvCell(h));
    return { format: 'scalev', delimiter: ';', headers };
  }

  throw new Error('Format CSV tidak dikenali. File harus berupa export Scalev (semicolon) atau file tim ops (comma, dengan kolom username).');
}

function sanitizeCsvCell(value: string): string {
  return (value || '')
    .replace(/\0/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

// ── Parse CSV line respecting quotes ──
function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(sanitizeCsvCell(current));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(sanitizeCsvCell(current));
  return result;
}

const num = (v: string) => parseFloat(v || '0') || 0;
const ts = (v: string) => (v && v.trim()) ? v.trim() : null;

// ── Split CSV text into logical lines (respects quoted newlines) ──
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        current += char;
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // End of logical line
      if (char === '\r' && text[i + 1] === '\n') i++; // skip \r\n
      if (current.trim()) lines.push(current.replace(/\0/g, ''));
      current = '';
    } else {
      current += char;
    }

    if (lines.length > MAX_CSV_LOGICAL_LINES) {
      throw new Error(`CSV terlalu besar. Maksimal ${MAX_CSV_LOGICAL_LINES.toLocaleString('en-US')} baris.`);
    }
  }
  if (current.trim()) lines.push(current.replace(/\0/g, ''));
  return lines;
}

function isLikelyCsv(file: File): boolean {
  const lowerName = (file.name || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();
  return lowerName.endsWith('.csv') || mime === 'text/csv' || mime === 'application/vnd.ms-excel';
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!isLikelyCsv(file)) {
      return NextResponse.json({ error: 'File harus berformat CSV' }, { status: 400 });
    }

    if (file.size > MAX_CSV_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: `File terlalu besar. Maksimal ${Math.round(MAX_CSV_FILE_SIZE_BYTES / (1024 * 1024))}MB` }, { status: 413 });
    }

    const csvText = (await file.text()).replace(/^\uFEFF/, '');
    const lines = splitCsvLines(csvText);
    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV is empty' }, { status: 400 });
    }

    // ── Detect format ──
    const { format, delimiter, headers } = detectFormat(lines[0]);

    if (format === 'ops') {
      return handleOpsUpload(lines, headers, delimiter, formData, file);
    } else {
      return handleScalevUpload(lines, headers, delimiter, formData, file);
    }
  } catch (err: any) {
    console.error('CSV upload error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════
// ── OPS FILE HANDLER ──
// ══════════════════════════════════════════════════════════════
async function handleOpsUpload(
  lines: string[],
  headers: string[],
  delimiter: string,
  formData: FormData,
  file: File
) {
  const svc = getServiceSupabase();

  const stats = {
    totalRows: 0,
    newInserted: 0,
    updated: 0,
    errors: [] as string[],
    format: 'ops-marketplace' as string,
    lineItems: 0,
    cogsLookedUp: 0,
  };

  // ── Fetch per-business tax config to determine which brands have no PPN ──
  // Brand → business mapping: JHN = Purvu, Pluve, DrHyun, Calmara
  const brandToBusinessCode: Record<string, string> = {
    Purvu: 'JHN', Pluve: 'JHN', DrHyun: 'JHN', Calmara: 'JHN',
    Roove: 'RTI', Osgard: 'RTI', Globite: 'RTI',
    Almona: 'RLB', YUV: 'RLB', Veminine: 'RLB', Orelif: 'RLB',
  };
  const noTaxBrands = new Set<string>();
  try {
    const { data: bizData } = await svc
      .from('scalev_webhook_businesses')
      .select('business_code, tax_rate_name');
    if (bizData) {
      const noTaxCodes = new Set(bizData.filter((b: any) => b.tax_rate_name === 'NONE').map((b: any) => b.business_code));
      for (const [brand, code] of Object.entries(brandToBusinessCode)) {
        if (noTaxCodes.has(code)) noTaxBrands.add(brand);
      }
    }
  } catch { /* non-fatal — default to PPN for all */ }

  // ── Parse all rows ──
  const parsedRows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    stats.totalRows++;

    const values = parseCsvLine(line, delimiter);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] || '').trim();
    }
    parsedRows.push(row);
  }

  // ── Group by external_id (each external_id = one order, possibly multi-line for bundles) ──
  const orderGroups: Record<string, Record<string, string>[]> = {};
  for (const row of parsedRows) {
    const extId = row.external_id?.trim();
    if (!extId) continue; // skip rows without external_id (bundle continuation rows use empty)
    if (!orderGroups[extId]) orderGroups[extId] = [];
    orderGroups[extId].push(row);
  }

  // Also collect continuation rows (empty external_id) — attach to previous order
  let lastExtId = '';
  for (const row of parsedRows) {
    const extId = row.external_id?.trim();
    if (extId) {
      lastExtId = extId;
    } else if (lastExtId && row.sku?.trim()) {
      // Continuation row with SKU but no external_id — belongs to last order
      if (!orderGroups[lastExtId]) orderGroups[lastExtId] = [];
      orderGroups[lastExtId].push(row);
    }
  }

  const orderIds = Object.keys(orderGroups);

  // ── Lookup existing orders by external_id column ──
  // Database has dedicated `external_id` column (populated from raw_data, # stripped)
  // Ops file external_id matches this directly
  const existingOrders: any[] = [];
  const CHUNK = 200;

  for (let i = 0; i < orderIds.length; i += CHUNK) {
    const chunk = orderIds.slice(i, i + CHUNK);
    const { data, error } = await svc
      .from('scalev_orders')
      .select('id, order_id, external_id, customer_name, customer_phone, customer_email, source')
      .in('external_id', chunk);
    if (error) {
      stats.errors.push(`Lookup batch: ${error.message}`);
    } else if (data) {
      existingOrders.push(...data);
    }
  }

  // Build map: external_id -> existing record
  const existingByExtId = new Map<string, any>();
  for (const o of existingOrders) {
    if (o.external_id) existingByExtId.set(o.external_id, o);
  }

  // ── Load product_mapping for COGS lookup ──
  // Try with sku column first, fallback to product_name only
  let productMappings: any[] = [];
  const { data: pmData, error: pmError } = await svc
    .from('product_mapping')
    .select('*');
  
  if (!pmError && pmData) productMappings = pmData;

  const cogsMap = new Map<string, { cogs: number; product_name: string; brand: string }>();
  const nameMap = new Map<string, { cogs: number; brand: string }>();
  
  for (const pm of productMappings) {
    const entry = { cogs: pm.cogs || 0, product_name: pm.product_name || '', brand: pm.brand || pm.product_type || '' };
    // Index by SKU if available
    if (pm.sku) cogsMap.set(pm.sku.toUpperCase(), entry);
    // Also index by product_name for fallback
    if (pm.product_name) nameMap.set(pm.product_name.toLowerCase(), { cogs: pm.cogs || 0, brand: pm.brand || pm.product_type || '' });
  }

  // ── Process each order ──
  const toInsert: any[] = [];
  const toUpdate: { id: number; data: any; orderId: string }[] = [];
  const orderLinesMap: Record<string, any[]> = {};
  const isNewOrder: Record<string, boolean> = {};

  for (const [extId, rows] of Object.entries(orderGroups)) {
    // Pick the row with the most data as "main row" (defensive: handles split/corrupt rows)
    const firstRow = rows.reduce((best, r) => {
      const score = (r.username || r.name ? 1 : 0) + (r.phone ? 1 : 0) + (r.platform ? 1 : 0) + (r.store ? 1 : 0);
      const bestScore = (best.username || best.name ? 1 : 0) + (best.phone ? 1 : 0) + (best.platform ? 1 : 0) + (best.store ? 1 : 0);
      return score > bestScore ? r : best;
    }, rows[0]);
    const platform = (firstRow.platform || '').toLowerCase();
    const salesChannel = deriveSalesChannelFromOps(platform);
    const shippedTime = ts(firstRow.timestamp) || null;

    // ── Build line items from SKUs ──
    const lineItems: any[] = [];
    let totalPrice = 0;
    let totalCogs = 0;
    let totalQty = 0;

    for (const row of rows) {
      const sku = (row.sku || '').trim();
      if (!sku) continue;

      const qty = parseInt(row.quantity || '1') || 1;
      const price = num(row.price);
      
      // COGS lookup from product_mapping
      let cogs = 0;
      let productName = sku;
      let brand = deriveBrandFromSku(sku);
      
      // Try exact SKU match first, then partial
      const skuUpper = sku.toUpperCase();
      if (cogsMap.has(skuUpper)) {
        const pm = cogsMap.get(skuUpper)!;
        cogs = pm.cogs;
        if (pm.product_name) productName = pm.product_name;
        if (pm.brand) brand = pm.brand;
        stats.cogsLookedUp++;
      } else {
        // Try matching individual SKUs in bundle (e.g., "ROV20+ROV01-590")
        const skuParts = sku.split(/[+,]/);
        for (const part of skuParts) {
          const partUpper = part.trim().toUpperCase().replace(/-\d+$/, ''); // strip price suffix like -590
          if (cogsMap.has(partUpper)) {
            cogs += cogsMap.get(partUpper)!.cogs;
            stats.cogsLookedUp++;
          }
        }
      }

      // Tax rate: 0% for no-tax brands (e.g. JHN), 11% PPN for others
      const taxRate = noTaxBrands.has(brand) ? 0 : 11.0;
      const taxDivisor = 1 + taxRate / 100;
      const priceBt = Math.round(price / taxDivisor);
      const cogsBt = Math.round(cogs / taxDivisor);

      lineItems.push({
        order_id: extId,
        product_name: productName,
        product_type: brand,
        variant_sku: sku,
        quantity: qty,
        product_price_bt: priceBt,
        discount_bt: 0,
        cogs_bt: cogsBt,
        tax_rate: taxRate,
        sales_channel: salesChannel,
        is_purchase_fb: false,
        is_purchase_tiktok: false,
        is_purchase_kwai: false,
        synced_at: new Date().toISOString(),
      });

      totalPrice += price;
      totalCogs += cogs;
      totalQty += qty;
    }

    stats.lineItems += lineItems.length;
    orderLinesMap[extId] = lineItems;

    // ── Check if order already exists (by external_id) ──
    const existing = existingByExtId.get(extId);

    if (existing) {
      // UPDATE: ops file ALWAYS overwrites customer_name (source of truth)
      const d: any = {
        customer_name: firstRow.username || firstRow.name || null,
        source: 'ops_upload', // mark as ops-uploaded so Scalev won't overwrite customer
        synced_at: new Date().toISOString(),
      };
      
      // Always include phone & email to prevent batch upsert column normalization from nulling them
      d.customer_phone = firstRow.phone || (existing.customer_phone || null);
      d.customer_email = firstRow.email || (existing.customer_email || null);
      if (firstRow.city) d.city = firstRow.city;
      if (firstRow.subdistrict) d.subdistrict = firstRow.subdistrict;
      if (shippedTime) d.shipped_time = shippedTime;
      if (num(firstRow.shipping_cost) > 0) d.shipping_cost = num(firstRow.shipping_cost);

      toUpdate.push({ id: existing.id, data: d, orderId: existing.order_id });
      isNewOrder[extId] = false;
    } else {
      // INSERT: new order from ops file
      toInsert.push({
        scalev_id: null,
        order_id: extId, // use external_id as order_id for ops-only orders
        external_id: extId, // dedicated external_id column
        customer_type: null,
        status: 'completed',
        shipped_time: shippedTime,
        platform: platform || null,
        store_name: firstRow.store || null,
        utm_source: null,
        financial_entity: null,
        payment_method: firstRow.payment_method || null,
        unique_code_discount: 0,
        is_purchase_fb: false,
        is_purchase_tiktok: false,
        is_purchase_kwai: false,
        gross_revenue: totalPrice,
        net_revenue: totalPrice,
        shipping_cost: num(firstRow.shipping_cost),
        total_quantity: totalQty,
        customer_name: firstRow.username || firstRow.name || null,
        customer_phone: firstRow.phone || null,
        customer_email: firstRow.email || null,
        province: null,
        city: firstRow.city || null,
        subdistrict: firstRow.subdistrict || null,
        handler: null,
        draft_time: null,
        pending_time: null,
        confirmed_time: null,
        paid_time: shippedTime,
        canceled_time: null,
        source: 'ops_upload',
        raw_data: firstRow,
        synced_at: new Date().toISOString(),
      });
      isNewOrder[extId] = true;
    }
  }

  // ── Batch INSERT new orders ──
  const BATCH = 200;
  const insertedIdMap: Record<string, number> = {};

  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { data: inserted, error: err } = await svc
      .from('scalev_orders')
      .upsert(batch, { onConflict: 'order_id', ignoreDuplicates: false })
      .select('id, order_id');

    if (err) {
      stats.errors.push(`Insert batch ${Math.floor(i / BATCH) + 1}: ${err.message}`);
      continue;
    }
    if (inserted) {
      for (const o of inserted) insertedIdMap[o.order_id] = o.id;
      stats.newInserted += inserted.length;
    }
  }

  // ── Batch UPDATE existing orders (upsert by id, same pattern as Scalev handler) ──
  const UPDATE_BATCH = 200;
  for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
    const batch = toUpdate.slice(i, i + UPDATE_BATCH);
    const upsertRows = batch.map(upd => ({ id: upd.id, order_id: upd.orderId, ...upd.data }));
    const { error } = await svc.from('scalev_orders').upsert(upsertRows, { onConflict: 'id' });
    if (error) {
      stats.errors.push(`Update batch ${Math.floor(i / UPDATE_BATCH) + 1}: ${error.message}`);
    } else {
      stats.updated += batch.length;
    }
  }

  // ── Replace line items for all ops orders ──
  // Bridge: for existing orders, map external_id -> db id
  const existingIdMap: Record<string, number> = {};
  for (const o of existingOrders) {
    if (o.external_id) existingIdMap[o.external_id] = o.id;
  }
  // For newly inserted orders, insertedIdMap already maps order_id (= extId) -> db id
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
        for (const line of orderLinesMap[oid]) {
          lineBatch.push({ ...line, scalev_order_id: dbId });
        }
      }

      if (lineBatch.length > 0) {
        for (let j = 0; j < lineBatch.length; j += 500) {
          const subBatch = lineBatch.slice(j, j + 500);
          const { error: lineErr } = await svc.from('scalev_order_lines').upsert(subBatch, { onConflict: 'scalev_order_id,product_name' });
          if (lineErr) stats.errors.push(`Lines batch: ${lineErr.message}`);
        }
      }
    }
  }

  // ── Log ──
  const uploadedBy = formData.get('uploaded_by') as string || null;
  const filename = formData.get('filename') as string || file.name;
  await svc.from('scalev_sync_log').insert({
    status: stats.errors.length > 0 ? 'partial' : 'success',
    sync_type: 'ops_upload',
    orders_fetched: stats.totalRows,
    orders_inserted: stats.newInserted,
    orders_updated: stats.updated,
    uploaded_by: uploadedBy,
    filename: filename,
    error_message: stats.errors.length > 0 ? `${stats.errors.length} errors: ${stats.errors.slice(0, 5).join('; ')}` : null,
    completed_at: new Date().toISOString(),
  });

  // Refresh materialized views so dashboard reflects new data
  triggerViewRefresh();

  return NextResponse.json({
    success: true,
    filename: file.name,
    stats: {
      totalRows: stats.totalRows,
      newInserted: stats.newInserted,
      updated: stats.updated,
      errors: stats.errors.length,
      errorDetails: stats.errors.slice(0, 10),
      format: stats.format,
      lineItems: stats.lineItems,
      cogsLookedUp: stats.cogsLookedUp,
    },
    message: `Upload selesai (${stats.format})! ${stats.newInserted} order baru, ${stats.updated} customer diperbaiki, ${stats.lineItems} line items, ${stats.cogsLookedUp} COGS ditemukan.`,
  });
}

// ══════════════════════════════════════════════════════════════
// ── SCALEV FILE HANDLER (existing logic, preserved) ──
// ══════════════════════════════════════════════════════════════
async function handleScalevUpload(
  lines: string[],
  headers: string[],
  delimiter: string,
  formData: FormData,
  file: File
) {
  const svc = getServiceSupabase();

  const requiredCols = ['order_id', 'store', 'order_status', 'name'];
  const missing = requiredCols.filter(c => !headers.includes(c));
  if (missing.length > 0) {
    return NextResponse.json({
      error: `Missing columns: ${missing.join(', ')}. Pastikan CSV semicolon-delimited dari Scalev.`
    }, { status: 400 });
  }

  const isProductBased = headers.includes('item_name');

  // ── Collect all CSV order IDs and external_ids ──
  const csvOrderIds: string[] = [];
  const csvExternalIds: string[] = [];
  const extIdIdx = headers.indexOf('external_id');
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line, delimiter);
    const orderId = values[0]?.trim();
    if (orderId && !csvOrderIds.includes(orderId)) csvOrderIds.push(orderId);

    // Also collect external_ids (strip #)
    if (extIdIdx >= 0) {
      const extId = (values[extIdIdx] || '').trim().replace('#', '');
      if (extId && !csvExternalIds.includes(extId)) csvExternalIds.push(extId);
    }
  }

  // ── Fetch existing orders by order_id AND by external_id ──
  const existingOrders: any[] = [];
  const seenIds = new Set<number>();
  const CHUNK = 200;
  
  // Lookup by order_id (finds previously uploaded Scalev orders)
  for (let i = 0; i < csvOrderIds.length; i += CHUNK) {
    const chunk = csvOrderIds.slice(i, i + CHUNK);
    const { data, error } = await svc
      .from('scalev_orders')
      .select('id, order_id, external_id, customer_name, customer_phone, customer_email, source')
      .in('order_id', chunk);
    if (error) throw error;
    if (data) {
      for (const o of data) {
        if (!seenIds.has(o.id)) { seenIds.add(o.id); existingOrders.push(o); }
      }
    }
  }
  
  // Lookup by external_id (finds ops-uploaded orders)
  for (let i = 0; i < csvExternalIds.length; i += CHUNK) {
    const chunk = csvExternalIds.slice(i, i + CHUNK);
    const { data, error } = await svc
      .from('scalev_orders')
      .select('id, order_id, external_id, customer_name, customer_phone, customer_email, source')
      .in('external_id', chunk);
    if (error) throw error;
    if (data) {
      for (const o of data) {
        if (!seenIds.has(o.id)) { seenIds.add(o.id); existingOrders.push(o); }
      }
    }
  }

  // Build maps: by order_id AND by external_id
  const existingByOrderId = new Map(existingOrders.map(o => [o.order_id, o]));
  const existingByExtId = new Map<string, any>();
  for (const o of existingOrders) {
    if (o.external_id) existingByExtId.set(o.external_id, o);
  }

  const stats = {
    totalRows: 0,
    newInserted: 0,
    updated: 0,
    errors: [] as string[],
    format: isProductBased ? 'product-based' : 'order-based',
    existingMapSize: existingByOrderId.size + existingByExtId.size,
    csvUniqueIds: csvOrderIds.length,
    classifiedAsNew: 0,
    classifiedAsUpdate: 0,
    totalLineItems: 0,
  };

  // ── Parse rows ──
  const orderRows: Record<string, Record<string, string>[]> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    stats.totalRows++;
    const values = parseCsvLine(line, delimiter);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] || '').trim();
    }
    if (!row.order_id) continue;
    if (!orderRows[row.order_id]) orderRows[row.order_id] = [];
    orderRows[row.order_id].push(row);
  }

  const toInsert: any[] = [];
  const toUpdate: { id: number; data: any; orderId: string }[] = [];
  const orderLinesMap: Record<string, any[]> = {};
  const isNewOrder: Record<string, boolean> = {};

  for (const [orderId, rows] of Object.entries(orderRows)) {
    // Pick the row with the most data as "main row" (defensive: handles split/corrupt rows)
    const firstRow = rows.reduce((best, r) => {
      const score = (r.name ? 1 : 0) + (r.phone ? 1 : 0) + (r.store ? 1 : 0) + (r.order_status ? 1 : 0);
      const bestScore = (best.name ? 1 : 0) + (best.phone ? 1 : 0) + (best.store ? 1 : 0) + (best.order_status ? 1 : 0);
      return score > bestScore ? r : best;
    }, rows[0]);
    const salesChannel = deriveSalesChannel(firstRow);
    const shippedTime = ts(firstRow.shipped_time) || ts(firstRow.completed_time) || null;
    const completedTime = ts(firstRow.completed_time) || null;

    // ── Build line items ──
    const lineItems: any[] = [];
    if (isProductBased) {
      for (const row of rows) {
        const itemName = row.item_name || '';
        const itemOwner = row.item_owner || '';
        if (!itemName) continue;
        const brand = deriveBrandFromItem(itemName, itemOwner);
        lineItems.push({
          order_id: orderId,
          product_name: itemName,
          product_type: brand,
          variant_sku: null,
          quantity: parseInt(row.item_quantity || '0') || 0,
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
      const brand = deriveBrandFromStore(firstRow.store || '');
      lineItems.push({
        order_id: orderId,
        product_name: brand,
        product_type: brand,
        variant_sku: null,
        quantity: parseInt(firstRow.quantity || '0') || 0,
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

    stats.totalLineItems += lineItems.length;
    orderLinesMap[orderId] = lineItems;

    // Check by order_id first, then by external_id (catches ops-uploaded orders)
    const csvExtId = (firstRow.external_id || '').replace('#', '');
    const existing = existingByOrderId.get(orderId) || (csvExtId ? existingByExtId.get(csvExtId) : null);

    if (existing) {
      const d: any = {};
      if (firstRow.customer_type) d.customer_type = firstRow.customer_type;
      if (firstRow.province) d.province = firstRow.province;
      if (firstRow.city) d.city = firstRow.city;
      if (firstRow.subdistrict) d.subdistrict = firstRow.subdistrict;
      if (firstRow.handler) d.handler = firstRow.handler;
      
      // If found via external_id (ops-uploaded), update order_id to Scalev internal + set external_id
      if (!existing.external_id && csvExtId) d.external_id = csvExtId;
      if (existing.source === 'ops_upload' && existing.order_id !== orderId) {
        // Ops created this with external_id as order_id. Now Scalev provides the real order_id.
        // We can't change order_id (unique constraint), so just set external_id and enrich.
        if (csvExtId) d.external_id = csvExtId;
      }
      
    // Customer: Scalev is source of truth. Auto-null for FBS orders (Shopee Hemat).
        const courierService = (firstRow.courier_service || '').toLowerCase();
        const isFbs = (firstRow.platform || '').toLowerCase() === 'shopee' && courierService.includes('hemat');
        d.customer_name = isFbs ? null : (firstRow.name || null);
      
      // Always include phone & email to prevent batch upsert column normalization from nulling them
      d.customer_phone = (firstRow.phone && (!existing.customer_phone || existing.customer_phone.startsWith('temp:')))
        ? firstRow.phone : (existing.customer_phone || null);
      d.customer_email = (firstRow.email && !existing.customer_email)
        ? firstRow.email : (existing.customer_email || null);

      if (firstRow.order_status) d.status = firstRow.order_status;
      if (shippedTime) d.shipped_time = shippedTime;
      if (ts(firstRow.paid_time)) d.paid_time = ts(firstRow.paid_time);
      if (ts(firstRow.canceled_time)) d.canceled_time = ts(firstRow.canceled_time);
      if (ts(firstRow.confirmed_time)) d.confirmed_time = ts(firstRow.confirmed_time);
      if (ts(firstRow.draft_time)) d.draft_time = ts(firstRow.draft_time);
      if (ts(firstRow.pending_time)) d.pending_time = ts(firstRow.pending_time);
      if (completedTime) d.completed_time = completedTime;

      // Platform info (ops might not have this)
      if (firstRow.platform) d.platform = firstRow.platform;
      if (firstRow.store) d.store_name = firstRow.store;
      if (firstRow.utm_source) d.utm_source = firstRow.utm_source;

      // Purchase flags — CSV is source of truth, always update
      d.is_purchase_fb = firstRow.is_purchase_fb === 'true';
      d.is_purchase_tiktok = firstRow.is_purchase_tiktok === 'true';
      d.is_purchase_kwai = firstRow.is_purchase_kwai === 'true';

      // Financial data: Scalev is source of truth, always update
      if (num(firstRow.gross_revenue) > 0) d.gross_revenue = num(firstRow.gross_revenue);
      if (num(firstRow.net_revenue) > 0) d.net_revenue = num(firstRow.net_revenue);
      if (num(firstRow.shipping_cost) > 0) d.shipping_cost = num(firstRow.shipping_cost);

      if (Object.keys(d).length > 0) {
        d.synced_at = new Date().toISOString();
        toUpdate.push({ id: existing.id, data: d, orderId });
      }
      isNewOrder[orderId] = false;
      stats.classifiedAsUpdate++;
    } else {
      toInsert.push({
        scalev_id: null,
        order_id: orderId,
        external_id: (firstRow.external_id || '').replace('#', '') || null,
        customer_type: firstRow.customer_type || null,
        status: firstRow.order_status || 'unknown',
        shipped_time: shippedTime,
        platform: firstRow.platform || null,
        store_name: firstRow.store || null,
        utm_source: firstRow.utm_source || null,
        financial_entity: firstRow.financial_entity || null,
        payment_method: firstRow.payment_method || null,
        unique_code_discount: num(firstRow.unique_code_discount),
        is_purchase_fb: firstRow.is_purchase_fb === 'true',
        is_purchase_tiktok: firstRow.is_purchase_tiktok === 'true',
        is_purchase_kwai: firstRow.is_purchase_kwai === 'true',
        gross_revenue: num(firstRow.gross_revenue),
        net_revenue: num(firstRow.net_revenue),
        shipping_cost: num(firstRow.shipping_cost),
        total_quantity: parseInt(firstRow.quantity || '0') || 0,
        customer_name: (() => {
                const cs = (firstRow.courier_service || '').toLowerCase();
                const fbs = (firstRow.platform || '').toLowerCase() === 'shopee' && cs.includes('hemat');
                return fbs ? null : (firstRow.name || null);
              })(),
        customer_phone: firstRow.phone || null,
        customer_email: firstRow.email || null,
        province: firstRow.province || null,
        city: firstRow.city || null,
        subdistrict: firstRow.subdistrict || null,
        handler: firstRow.handler || null,
        draft_time: ts(firstRow.draft_time),
        pending_time: ts(firstRow.pending_time),
        confirmed_time: ts(firstRow.confirmed_time),
        paid_time: ts(firstRow.paid_time),
        completed_time: completedTime,
        canceled_time: ts(firstRow.canceled_time),
        source: 'csv_upload',
        raw_data: firstRow,
        synced_at: new Date().toISOString(),
      });
      isNewOrder[orderId] = true;
      stats.classifiedAsNew++;
    }
  }

  // ── Batch INSERT ──
  const BATCH = 200;
  const insertedIdMap: Record<string, number> = {};
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { data: inserted, error: err } = await svc
      .from('scalev_orders')
      .upsert(batch, { onConflict: 'order_id', ignoreDuplicates: true })
      .select('id, order_id');
    if (err) {
      stats.errors.push(`Insert batch ${Math.floor(i / BATCH) + 1}: ${err.message}`);
      continue;
    }
    if (inserted) {
      for (const o of inserted) insertedIdMap[o.order_id] = o.id;
      stats.newInserted += inserted.length;
    }
  }

  // ── Batch UPDATE ──
  const UPDATE_BATCH = 200;
  for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
    const batch = toUpdate.slice(i, i + UPDATE_BATCH);
    const upsertRows = batch.map(upd => ({ id: upd.id, order_id: upd.orderId, ...upd.data }));
    const { error } = await svc.from('scalev_orders').upsert(upsertRows, { onConflict: 'id' });
    if (error) {
      stats.errors.push(`Update batch ${Math.floor(i / UPDATE_BATCH) + 1}: ${error.message}`);
    } else {
      stats.updated += batch.length;
    }
  }

  // ── Replace line items ──
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
          for (const line of orderLinesMap[oid]) {
            lineBatch.push({ ...line, scalev_order_id: dbId });
          }
        }
        if (lineBatch.length > 0) {
          for (let j = 0; j < lineBatch.length; j += 500) {
            const subBatch = lineBatch.slice(j, j + 500);
            const { error: lineErr } = await svc.from('scalev_order_lines').upsert(subBatch, { onConflict: 'scalev_order_id,product_name' });
            if (lineErr) stats.errors.push(`Lines batch: ${lineErr.message}`);
          }
        }
      }
    }
  } else {
    for (const [orderId, lines] of Object.entries(orderLinesMap)) {
      if (!isNewOrder[orderId]) continue;
      const dbId = insertedIdMap[orderId];
      if (!dbId) continue;
      const lineBatch = lines.map(line => ({ ...line, scalev_order_id: dbId }));
      const { error: lineErr } = await svc.from('scalev_order_lines').upsert(lineBatch, { onConflict: 'scalev_order_id,product_name' });
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
    uploaded_by: uploadedBy,
    filename: filename,
    error_message: stats.errors.length > 0 ? `${stats.errors.length} errors: ${stats.errors.slice(0, 5).join('; ')}` : null,
    completed_at: new Date().toISOString(),
  });

  // Refresh materialized views so dashboard reflects new data
  triggerViewRefresh();

  return NextResponse.json({
    success: true,
    filename: file.name,
    stats: {
      totalRows: stats.totalRows,
      newInserted: stats.newInserted,
      updated: stats.updated,
      errors: stats.errors.length,
      errorDetails: stats.errors.slice(0, 10),
      format: stats.format,
      lineItems: stats.totalLineItems,
    },
    debug: {
      existingMapSize: stats.existingMapSize,
      csvUniqueIds: stats.csvUniqueIds,
      classifiedAsNew: stats.classifiedAsNew,
      classifiedAsUpdate: stats.classifiedAsUpdate,
    },
    message: `Upload selesai (${stats.format})! ${stats.newInserted} order baru, ${stats.updated} order diperkaya, ${stats.totalLineItems} line items, ${stats.errors.length} error.`,
  });
}
