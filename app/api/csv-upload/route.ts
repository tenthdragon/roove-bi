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

    // Read CSV text
    const csvText = await file.text();
    const lines = csvText.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV is empty' }, { status: 400 });
    }

    // Parse headers
    const headers = lines[0].split(';').map(h => h.trim());
    const requiredCols = ['order_id', 'store', 'order_status', 'name'];
    const missing = requiredCols.filter(c => !headers.includes(c));
    if (missing.length > 0) {
      return NextResponse.json({
        error: `Missing columns: ${missing.join(', ')}. Pastikan CSV semicolon-delimited dari Scalev.`
      }, { status: 400 });
    }

    const svc = getServiceSupabase();

    // Get existing order_ids to skip duplicates
    const { data: existingOrders } = await svc
      .from('scalev_orders')
      .select('order_id');
    const existingIds = new Set((existingOrders || []).map(o => o.order_id));

    const stats = {
      totalRows: 0,
      newInserted: 0,
      skippedDuplicate: 0,
      skippedNoOrderId: 0,
      errors: [] as string[],
    };

    const ordersToInsert: any[] = [];
    const orderLinesMap: Record<string, any> = {}; // order_id -> line data

    // Parse each row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      stats.totalRows++;

      const values = line.split(';');
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = (values[j] || '').trim();
      }

      if (!row.order_id) {
        stats.skippedNoOrderId++;
        continue;
      }

      // Skip if already exists
      if (existingIds.has(row.order_id)) {
        stats.skippedDuplicate++;
        continue;
      }

      // Prevent duplicate within this upload batch
      if (orderLinesMap[row.order_id]) {
        stats.skippedDuplicate++;
        continue;
      }

      try {
        const num = (v: string) => parseFloat(v || '0') || 0;
        const ts = (v: string) => (v && v.trim()) ? v.trim() : null;

        const salesChannel = deriveSalesChannel(row);
        const productType = deriveProductType(row.store || '');
        const shippedTime = ts(row.shipped_time) || ts(row.completed_time) || null;

        // Build order header matching scalev_orders schema
        const orderHeader: any = {
          scalev_id: null,
          order_id: row.order_id,
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
          raw_data: row, // Store full CSV row as JSON
          synced_at: new Date().toISOString(),
        };

        // Build order line
        const orderLine = {
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

        ordersToInsert.push(orderHeader);
        orderLinesMap[row.order_id] = orderLine;
        existingIds.add(row.order_id); // Mark as seen
      } catch (err: any) {
        stats.errors.push(`Row ${i + 1} (${row.order_id}): ${err.message}`);
      }
    }

    // Batch insert orders (in chunks of 100)
    const BATCH_SIZE = 100;
    for (let i = 0; i < ordersToInsert.length; i += BATCH_SIZE) {
      const batch = ordersToInsert.slice(i, i + BATCH_SIZE);

      const { data: insertedOrders, error: orderErr } = await svc
        .from('scalev_orders')
        .upsert(batch, { onConflict: 'order_id' })
        .select('id, order_id');

      if (orderErr) {
        stats.errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1} orders error: ${orderErr.message}`);
        continue;
      }

      // Insert corresponding order lines
      if (insertedOrders && insertedOrders.length > 0) {
        const linesToInsert = insertedOrders
          .map(o => {
            const line = orderLinesMap[o.order_id];
            if (!line) return null;
            return { ...line, scalev_order_id: o.id };
          })
          .filter(Boolean);

        if (linesToInsert.length > 0) {
          // Delete existing lines first (for upsert behavior)
          const lineOrderIds = linesToInsert.map(l => l!.order_id);
          await svc.from('scalev_order_lines').delete().in('order_id', lineOrderIds);

          const { error: lineErr } = await svc
            .from('scalev_order_lines')
            .insert(linesToInsert);

          if (lineErr) {
            stats.errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1} lines error: ${lineErr.message}`);
          }
        }

        stats.newInserted += insertedOrders.length;
      }
    }

    // Log the upload
    await svc.from('scalev_sync_log').insert({
      status: stats.errors.length > 0 ? 'partial' : 'success',
      sync_type: 'csv_upload',
      orders_fetched: stats.totalRows,
      orders_inserted: stats.newInserted,
      orders_updated: 0,
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
        skippedDuplicate: stats.skippedDuplicate,
        errors: stats.errors.length,
        errorDetails: stats.errors.slice(0, 10), // Show first 10
      },
      message: `Upload selesai! ${stats.newInserted} order baru ditambahkan, ${stats.skippedDuplicate} duplikat di-skip.`,
    });

  } catch (err: any) {
    console.error('CSV upload error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── Helper: Derive sales channel from CSV row ──
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

// ── Helper: Derive product type from store name ──
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
