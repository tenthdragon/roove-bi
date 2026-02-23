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

export const maxDuration = 120;

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

    // Get existing orders to determine insert vs update
    const { data: existingOrders } = await svc
      .from('scalev_orders')
      .select('id, order_id, scalev_id, source');
    const existingMap = new Map((existingOrders || []).map(o => [o.order_id, o]));

    const stats = {
      totalRows: 0,
      newInserted: 0,
      updated: 0,
      skippedNoOrderId: 0,
      errors: [] as string[],
    };

    const toInsert: any[] = [];
    const toUpdate: { id: number; data: any }[] = [];
    const orderLinesMap: Record<string, any> = {};
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

      if (!row.order_id) { stats.skippedNoOrderId++; continue; }
      if (seenOrderIds.has(row.order_id)) continue;
      seenOrderIds.add(row.order_id);

      try {
        const num = (v: string) => parseFloat(v || '0') || 0;
        const ts = (v: string) => (v && v.trim()) ? v.trim() : null;
        const salesChannel = deriveSalesChannel(row);
        const productType = deriveProductType(row.store || '');
        const shippedTime = ts(row.shipped_time) || ts(row.completed_time) || null;

        const existing = existingMap.get(row.order_id);

        if (existing) {
          // ── UPDATE: only enrich fields that CSV has but API might not ──
          const enrichData: any = {};

          // Always update these from CSV (CSV is authoritative for these)
          if (row.customer_type) enrichData.customer_type = row.customer_type;
          if (row.province) enrichData.province = row.province;
          if (row.city) enrichData.city = row.city;
          if (row.subdistrict) enrichData.subdistrict = row.subdistrict;
          if (row.handler) enrichData.handler = row.handler;

          // Only fill if currently empty in DB (don't overwrite API data)
          if (row.name && !existing.customer_name) enrichData.customer_name = row.name;
          if (row.phone && !existing.customer_phone) enrichData.customer_phone = row.phone;
          if (row.email && !existing.customer_email) enrichData.customer_email = row.email;

          // Update status if CSV has more advanced status
          if (row.order_status) enrichData.status = row.order_status;
          if (shippedTime) enrichData.shipped_time = shippedTime;
          if (ts(row.paid_time)) enrichData.paid_time = ts(row.paid_time);
          if (ts(row.canceled_time)) enrichData.canceled_time = ts(row.canceled_time);
          if (ts(row.confirmed_time)) enrichData.confirmed_time = ts(row.confirmed_time);
          if (ts(row.draft_time)) enrichData.draft_time = ts(row.draft_time);
          if (ts(row.pending_time)) enrichData.pending_time = ts(row.pending_time);

          // Financial data — update if CSV has non-zero values
          if (num(row.gross_revenue) > 0) enrichData.gross_revenue = num(row.gross_revenue);
          if (num(row.net_revenue) > 0) enrichData.net_revenue = num(row.net_revenue);
          if (num(row.shipping_cost) > 0) enrichData.shipping_cost = num(row.shipping_cost);

          if (Object.keys(enrichData).length > 0) {
            enrichData.synced_at = new Date().toISOString();
            toUpdate.push({ id: existing.id, data: enrichData });
          }

          // Also update order line with CSV data
          orderLinesMap[row.order_id] = {
            existingOrderDbId: existing.id,
            line: buildOrderLine(row, salesChannel, productType, shippedTime),
            isUpdate: true,
          };

        } else {
          // ── INSERT: new order not in DB ──
          const orderHeader: any = {
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
          };

          toInsert.push(orderHeader);
          orderLinesMap[row.order_id] = {
            line: buildOrderLine(row, salesChannel, productType, shippedTime),
            isUpdate: false,
          };
        }
      } catch (err: any) {
        stats.errors.push(`Row ${i + 1} (${row.order_id}): ${err.message}`);
      }
    }

    // ── Execute batch inserts ──
    const BATCH = 100;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const batch = toInsert.slice(i, i + BATCH);
      const { data: inserted, error: err } = await svc
        .from('scalev_orders')
        .insert(batch)
        .select('id, order_id');

      if (err) {
        stats.errors.push(`Insert batch ${Math.floor(i / BATCH) + 1}: ${err.message}`);
        continue;
      }

      // Insert order lines for new orders
      if (inserted) {
        const linesToInsert = inserted.map(o => {
          const entry = orderLinesMap[o.order_id];
          if (!entry) return null;
          return { ...entry.line, scalev_order_id: o.id };
        }).filter(Boolean);

        if (linesToInsert.length > 0) {
          const { error: lineErr } = await svc.from('scalev_order_lines').insert(linesToInsert);
          if (lineErr) stats.errors.push(`Lines insert: ${lineErr.message}`);
        }
        stats.newInserted += inserted.length;
      }
    }

    // ── Execute batch updates ──
    for (const upd of toUpdate) {
      const { error: err } = await svc
        .from('scalev_orders')
        .update(upd.data)
        .eq('id', upd.id);

      if (err) {
        stats.errors.push(`Update order id ${upd.id}: ${err.message}`);
      } else {
        stats.updated++;

        // Update order line too (replace with CSV data which has customer_type info)
        const entry = orderLinesMap[Object.keys(orderLinesMap).find(
          k => orderLinesMap[k].existingOrderDbId === upd.id
        ) || ''];
        if (entry) {
          await svc.from('scalev_order_lines').delete().eq('scalev_order_id', upd.id);
          const { error: lineErr } = await svc.from('scalev_order_lines').insert({
            ...entry.line,
            scalev_order_id: upd.id,
          });
          if (lineErr) stats.errors.push(`Lines update for ${upd.id}: ${lineErr.message}`);
        }
      }
    }

    // Log
    await svc.from('scalev_sync_log').insert({
      status: stats.errors.length > 0 ? 'partial' : 'success',
      sync_type: 'csv_upload',
      orders_fetched: stats.totalRows,
      orders_inserted: stats.newInserted,
      orders_updated: stats.updated,
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
      message: `Upload selesai! ${stats.newInserted} order baru, ${stats.updated} order diperkaya, ${stats.errors.length} error.`,
    });

  } catch (err: any) {
    console.error('CSV upload error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── Build order line object ──
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

// ── Derive sales channel ──
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

// ── Derive product type ──
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
