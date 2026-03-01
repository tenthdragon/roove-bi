// app/api/scalev-webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ── Verify HMAC-SHA256 signature from Scalev ──
function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.SCALEV_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const calculated = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculated),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

// ── Helpers ──
const ts = (v: any): string | null =>
  v && typeof v === 'string' && v.trim() ? v.trim() : null;

const num = (v: any): number => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
};

// ── Handle order.created: insert new order into scalev_orders ──
async function handleOrderCreated(data: any) {
  const svc = getServiceSupabase();

  const orderId = data.order_id;
  if (!orderId) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no_order_id' });
  }

  // Check if order already exists
  const { data: existing } = await svc
    .from('scalev_orders')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();

  if (existing) {
    console.log(`[scalev-webhook] order.created: ${orderId} already exists, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'already_exists' });
  }

  // Extract customer info from destination_address
  const dest = data.destination_address || {};
  const storeName = data.store?.name || null;
  const financialEntity = data.financial_entity?.name || data.financial_entity?.code || null;

  // Build order row
  const orderRow: Record<string, any> = {
    scalev_id: null,
    order_id: orderId,
    external_id: data.external_id || null,
    customer_type: null,
    status: data.status || 'pending',
    platform: null,
    store_name: storeName,
    utm_source: null,
    financial_entity: financialEntity,
    payment_method: data.payment_method || null,
    unique_code_discount: num(data.unique_code_discount),
    is_purchase_fb: false,
    is_purchase_tiktok: false,
    is_purchase_kwai: false,
    gross_revenue: num(data.gross_revenue),
    net_revenue: num(data.net_revenue),
    shipping_cost: num(data.shipping_cost),
    total_quantity: data.total_quantity || 0,
    customer_name: dest.name || null,
    customer_phone: dest.phone || null,
    customer_email: dest.email || null,
    province: dest.province || null,
    city: dest.city || null,
    subdistrict: dest.subdistrict || null,
    handler: null,
    draft_time: ts(data.draft_time),
    pending_time: ts(data.pending_time),
    confirmed_time: ts(data.confirmed_time),
    paid_time: ts(data.paid_time),
    shipped_time: ts(data.shipped_time),
    canceled_time: ts(data.canceled_time),
    source: 'webhook',
    raw_data: data,
    synced_at: new Date().toISOString(),
  };

  // Insert order
  const { data: inserted, error: insertErr } = await svc
    .from('scalev_orders')
    .insert(orderRow)
    .select('id, order_id')
    .single();

  if (insertErr) {
    console.error(`[scalev-webhook] order.created insert error for ${orderId}:`, insertErr.message);
    return NextResponse.json({ error: 'DB insert failed' }, { status: 500 });
  }

  // Insert order lines if present
  if (data.orderlines && Array.isArray(data.orderlines) && data.orderlines.length > 0 && inserted) {
    const lines = data.orderlines.map((line: any) => ({
      order_id: inserted.id,
      scalev_order_id: orderId,
      product_name: line.product_name || null,
      variant_name: line.variant_unique_id || null,
      quantity: line.quantity || 0,
      weight: line.weight || 0,
      is_inventory: line.is_inventory ?? true,
    }));

    const { error: lineErr } = await svc.from('scalev_order_lines').insert(lines);
    if (lineErr) {
      console.warn(`[scalev-webhook] order.created lines insert error for ${orderId}:`, lineErr.message);
    }
  }

  // Log
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: 'webhook',
    orders_fetched: 1,
    orders_updated: 0,
    orders_inserted: 1,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  console.log(`[scalev-webhook] order.created: ${orderId} inserted successfully`);

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    action: 'created',
  });
}

// ── Handle order.status_changed: update existing order ──
async function handleStatusChanged(data: any) {
  const svc = getServiceSupabase();

  const orderId = data.order_id;
  const newStatus = data.status;

  if (!orderId || !newStatus) {
    return NextResponse.json({ error: 'Missing order_id or status' }, { status: 400 });
  }

  // Lookup order
  const { data: existing, error: lookupErr } = await svc
    .from('scalev_orders')
    .select('id, order_id, status')
    .eq('order_id', orderId)
    .maybeSingle();

  if (lookupErr) {
    console.error(`[scalev-webhook] status_changed lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    console.log(`[scalev-webhook] status_changed: ${orderId} not found in DB, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'order_not_found' });
  }

  // Skip if status hasn't actually changed
  if (existing.status === newStatus) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'status_unchanged' });
  }

  // Build update
  const updateData: Record<string, any> = {
    status: newStatus,
    synced_at: new Date().toISOString(),
  };

  const timestampFields = [
    'draft_time', 'pending_time', 'confirmed_time', 'in_process_time',
    'ready_time', 'shipped_time', 'completed_time', 'rts_time',
    'canceled_time', 'closed_time',
  ];

  for (const field of timestampFields) {
    if (field in data) {
      updateData[field] = ts(data[field]);
    }
  }

  // Update order
  const { error: updateErr } = await svc
    .from('scalev_orders')
    .update(updateData)
    .eq('id', existing.id);

  if (updateErr) {
    console.error(`[scalev-webhook] status_changed update error for ${orderId}:`, updateErr.message);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  // Log
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: 'webhook',
    orders_fetched: 1,
    orders_updated: 1,
    orders_inserted: 0,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  console.log(`[scalev-webhook] status_changed: ${orderId} updated ${existing.status} → ${newStatus}`);

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    old_status: existing.status,
    new_status: newStatus,
  });
}

// ── POST handler ──
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-scalev-hmac-sha256');

  // Verify signature
  if (!verifySignature(rawBody, signature)) {
    console.error('[scalev-webhook] invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { event, data } = body;

  // Handle test event
  if (event === 'business.test_event') {
    console.log('[scalev-webhook] test event received');
    return NextResponse.json({ ok: true, message: 'Test event received' });
  }

  // Route to appropriate handler
  switch (event) {
    case 'order.created':
      return handleOrderCreated(data);

    case 'order.status_changed':
      return handleStatusChanged(data);

    default:
      return NextResponse.json({ ok: true, skipped: true, event });
  }
}
