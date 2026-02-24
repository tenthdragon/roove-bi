// app/api/csv-upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export const maxDuration = 250;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const csvText = await file.text();
    const lines = csvText.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV is empty' }, { status: 400 });
    }

    const headers = lines[0].split(';').map(h => h.trim());
    const requiredCols = ['order_id', 'store', 'order_status', 'name'];
    const missing = requiredCols.filter(c => !headers.includes(c));
    if (missing.length > 0) {
      return NextResponse.json({
        error: `Missing columns: ${missing.join(', ')}. Pastikan CSV semicolon-delimited dari Scalev.`
      }, { status: 400 });
    }

    const svc = getServiceSupabase();

    // Only fetch orders that exist in the CSV (much faster than fetching all 23K+)
const csvOrderIds = [];
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const orderId = line.split(';')[0]?.trim();
  if (orderId) csvOrderIds.push(orderId);
}

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
      totalRows: 0,
      newInserted: 0,
      updated: 0,
      errors: [] as string[],
      // Debug info
      existingMapSize: existingMap.size,
      csvUniqueIds: 0,
      classifiedAsNew: 0,
      classifiedAsUpdate: 0,
    };

    // ── Phase 1: Parse all rows ──
    const toInsert: any[] = [];
    const toUpdate: { id: number; data: any; orderId: string }[] = [];
    const orderLinesNew: Record<string, any> = {};
    const orderLinesUpdate: Record<string, any> = {};
    const seenOrderIds = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      stats.totalRows++;

      const values = line.split(';');
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = (values[j] || '').trim();
      }

      if (!row.order_id || seenOrderIds.has(row.order_id)) continue;
      seenOrderIds.add(row.order_id);

      try {
        const num = (v: string) => parseFloat(v || '0') || 0;
        const ts = (v: string) => (v && v.trim()) ? v.trim() : null;
        const salesChannel = deriveSalesChannel(row);
        const productType = deriveProductType(row.store || '');
        const shippedTime = ts(row.shipped_time) || ts(row.completed_time) || null;
        const orderLine = buildOrderLine(row, salesChannel, productType, shippedTime);

        const existing = existingMap.get(row.order_id);

        if (existing) {
          const d: any = {};
          if (row.customer_type) d.customer_type = row.customer_type;
          if (row.province) d.province = row.province;
          if (row.city) d.city = row.city;
          if (row.subdistrict) d.subdistrict = row.subdistrict;
          if (row.handler) d.handler = row.handler;
          if (row.name && !existing.customer_name) d.customer_name = row.name;
          if (row.phone && !existing.customer_phone) d.customer_phone = row.phone;
          if (row.email && !existing.customer_email) d.customer_email = row.email;
          if (row.order_status) d.status = row.order_status;
          if (shippedTime) d.shipped_time = shippedTime;
          if (ts(row.paid_time)) d.paid_time = ts(row.paid_time);
          if (ts(row.canceled_time)) d.canceled_time = ts(row.canceled_time);
          if (ts(row.confirmed_time)) d.confirmed_time = ts(row.confirmed_time);
          if (ts(row.draft_time)) d.draft_time = ts(row.draft_time);
          if (ts(row.pending_time)) d.pending_time = ts(row.pending_time);
          if (num(row.gross_revenue) > 0) d.gross_revenue = num(row.gross_revenue);
          if (num(row.net_revenue) > 0) d.net_revenue = num(row.net_revenue);
          if (num(row.shipping_cost) > 0) d.shipping_cost = num(row.shipping_cost);

          if (Object.keys(d).length > 0) {
            d.synced_at = new Date().toISOString();
            toUpdate.push({ id: existing.id, data: d, orderId: row.order_id });
          }
          orderLinesUpdate[row.order_id] = { dbId: existing.id, line: orderLine };
          stats.classifiedAsUpdate++;
        } else {
          toInsert.push({
            scalev_id: null,
            order_id: row.order_id,
            customer_type: row.customer_type || null,
            status: row.order_status || 'unknown',
            shipped_time: shippedTime,
            platform: row.platform || null,
            store_name: row.store || null,
            utm_source: row.utm_source || null,
            financial_entity: row.financial_entity || null,
            payment_method: row.payment_method || null,
            unique_code_discount: num(row.unique_code_discount),
            is_purchase_fb: row.is_purchase_fb === 'true',
            is_purchase_tiktok: row.is_purchase_tiktok === 'true',
            is_purchase_kwai: row.is_purchase_kwai === 'true',
            gross_revenue: num(row.gross_revenue),
            net_revenue: num(row.net_revenue),
            shipping_cost: num(row.shipping_cost),
            total_quantity: parseInt(row.quantity || '0') || 0,
            customer_name: row.name || null,
            customer_phone: row.phone || null,
            customer_email: row.email || null,
            province: row.province || null,
            city: row.city || null,
            subdistrict: row.subdistrict || null,
            handler: row.handler || null,
            draft_time: ts(row.draft_time),
            pending_time: ts(row.pending_time),
            confirmed_time: ts(row.confirmed_time),
            paid_time: ts(row.paid_time),
            canceled_time: ts(row.canceled_time),
            source: 'csv_upload',
            raw_data: row,
            synced_at: new Date().toISOString(),
          });
          orderLinesNew[row.order_id] = orderLine;
          stats.classifiedAsNew++;
        }
      } catch (err: any) {
        stats.errors.push(`Row ${i + 1} (${row.order_id}): ${err.message}`);
      }
    }

    stats.csvUniqueIds = seenOrderIds.size;

    // ── Phase 2: Batch INSERT new orders (use upsert as safety net) ──
    const BATCH = 200;
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

      if (inserted && inserted.length > 0) {
        const lineBatch = inserted.map(o => {
          const line = orderLinesNew[o.order_id];
          return line ? { ...line, scalev_order_id: o.id } : null;
        }).filter(Boolean);

        if (lineBatch.length > 0) {
          // Also upsert lines to avoid conflicts
          for (const ln of lineBatch) {
            await svc.from('scalev_order_lines').delete().eq('scalev_order_id', ln.scalev_order_id);
          }
          const { error: lineErr } = await svc.from('scalev_order_lines').insert(lineBatch);
          if (lineErr) stats.errors.push(`Lines batch ${Math.floor(i / BATCH) + 1}: ${lineErr.message}`);
        }
        stats.newInserted += inserted.length;
      }
    }

   // ── Phase 3: Batch UPDATE existing orders via upsert ──
    const UPDATE_BATCH = 200;
    for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
      const batch = toUpdate.slice(i, i + UPDATE_BATCH);
      const upsertRows = batch.map(upd => ({ id: upd.id, ...upd.data }));
      const { error } = await svc.from('scalev_orders').upsert(upsertRows, { onConflict: 'id' });
      if (error) {
        stats.errors.push(`Update batch ${Math.floor(i / UPDATE_BATCH) + 1}: ${error.message}`);
      } else {
        stats.updated += batch.length;
      }
    }

   // ── Phase 4: Replace order lines for NEW orders only (skip existing to avoid timeout) ──
    // Order lines for existing orders are already in DB — only update if critical fields changed

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
      error_message: stats.errors.length > 0
        ? `${stats.errors.length} errors: ${stats.errors.slice(0, 5).join('; ')}`
        : null,
      completed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      filename: file.name,
      stats: {
        totalRows: stats.totalRows,
        newInserted: stats.newInserted,
        updated: stats.updated,
        errors: stats.errors.length,
        errorDetails: stats.errors.slice(0, 10),
      },
      debug: {
        existingMapSize: stats.existingMapSize,
        csvUniqueIds: stats.csvUniqueIds,
        classifiedAsNew: stats.classifiedAsNew,
        classifiedAsUpdate: stats.classifiedAsUpdate,
      },
      message: `Upload selesai! ${stats.newInserted} order baru, ${stats.updated} order diperkaya, ${stats.errors.length} error.`,
    });

  } catch (err: any) {
    console.error('CSV upload error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function buildOrderLine(row: Record<string, string>, salesChannel: string, productType: string, shippedTime: string | null) {
  const num = (v: string) => parseFloat(v || '0') || 0;
  return {
    order_id: row.order_id,
    product_name: productType,
    product_type: productType,
    variant_sku: null,
    quantity: parseInt(row.quantity || '0') || 0,
    product_price_bt: num(row.product_price_bt),
    discount_bt: num(row.product_discount_bt),
    cogs_bt: num(row.cogs_bt),
    tax_rate: num(row.tax_rate) || 11.0,
    shipped_time: shippedTime,
    sales_channel: salesChannel,
    is_purchase_fb: row.is_purchase_fb === 'true',
    is_purchase_tiktok: row.is_purchase_tiktok === 'true',
    is_purchase_kwai: row.is_purchase_kwai === 'true',
    synced_at: new Date().toISOString(),
  };
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

function deriveProductType(storeName: string): string {
  const s = storeName.toLowerCase();
  if (s.includes('osgard')) return 'Osgard';
  if (s.includes('purvu') || s.includes('secret')) return 'Purvu';
  if (s.includes('pluve')) return 'Pluve';
  if (s.includes('globite')) return 'Globite';
  if (s.includes('drhyun') || s.includes('dr hyun')) return 'DrHyun';
  if (s.includes('calmara')) return 'Calmara';
  if (s.includes('free store')) return 'Other';
  if (s.includes('roove')) return 'Roove';
  return 'Unknown';
}
