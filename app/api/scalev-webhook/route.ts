// app/api/scalev-webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { triggerViewRefresh } from '@/lib/refresh-views';

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
    }));

    const { error: lineErr } = await svc.from('scalev_order_lines').insert(lines);
    if (lineErr) {
      console.warn(`[scalev-webhook] order.created lines insert error for ${orderId}:`, lineErr.message);
    }
  }

  // Log
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: 'webhook_created',
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
    'draft_time', 'pending_time', 'confirmed_time',
    'paid_time', 'shipped_time', 'canceled_time',
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
    sync_type: 'webhook_status_changed',
    orders_fetched: 1,
    orders_updated: 1,
    orders_inserted: 0,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  console.log(`[scalev-webhook] status_changed: ${orderId} updated ${existing.status} → ${newStatus}`);

  // Refresh materialized views if order became shipped/completed
  if (newStatus === 'shipped' || newStatus === 'completed') {
    triggerViewRefresh();
  }

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    old_status: existing.status,
    new_status: newStatus,
  });
}

// ── Handle order.updated: full update of order data ──
async function handleOrderUpdated(data: any) {
  const svc = getServiceSupabase();

  const orderId = data.order_id;
  if (!orderId) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no_order_id' });
  }

  // Lookup existing order
  const { data: existing, error: lookupErr } = await svc
    .from('scalev_orders')
    .select('id, order_id, status, source')
    .eq('order_id', orderId)
    .maybeSingle();

  if (lookupErr) {
    console.error(`[scalev-webhook] order.updated lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    // Order not in DB yet — treat as create
    console.log(`[scalev-webhook] order.updated: ${orderId} not found, treating as create`);
    return handleOrderCreated(data);
  }

  // Build update with all available fields
  const dest = data.destination_address || {};
  const storeName = data.store?.name || null;
  const financialEntity = data.financial_entity?.name || data.financial_entity?.code || null;

  const updateData: Record<string, any> = {
    synced_at: new Date().toISOString(),
    raw_data: data,
  };

  if (data.status) updateData.status = data.status;
  if (data.external_id) updateData.external_id = data.external_id;
  if (storeName) updateData.store_name = storeName;
  if (financialEntity) updateData.financial_entity = financialEntity;
  if (data.payment_method) updateData.payment_method = data.payment_method;
  if (data.gross_revenue != null) updateData.gross_revenue = num(data.gross_revenue);
  if (data.net_revenue != null) updateData.net_revenue = num(data.net_revenue);
  if (data.shipping_cost != null) updateData.shipping_cost = num(data.shipping_cost);
  if (data.total_quantity != null) updateData.total_quantity = data.total_quantity;
  if (data.unique_code_discount != null) updateData.unique_code_discount = num(data.unique_code_discount);

  // Customer info (don't overwrite if source is ops_upload — ops is source of truth for customer)
  if (existing.source !== 'ops_upload') {
    if (dest.name) updateData.customer_name = dest.name;
    if (dest.phone) updateData.customer_phone = dest.phone;
    if (dest.email) updateData.customer_email = dest.email;
  }
  if (dest.province) updateData.province = dest.province;
  if (dest.city) updateData.city = dest.city;
  if (dest.subdistrict) updateData.subdistrict = dest.subdistrict;

  // Timestamps
  const timestampFields = [
    'draft_time', 'pending_time', 'confirmed_time',
    'paid_time', 'shipped_time', 'canceled_time',
  ];
  for (const field of timestampFields) {
    if (field in data) updateData[field] = ts(data[field]);
  }

  const { error: updateErr } = await svc
    .from('scalev_orders')
    .update(updateData)
    .eq('id', existing.id);

  if (updateErr) {
    console.error(`[scalev-webhook] order.updated update error for ${orderId}:`, updateErr.message);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  // Replace order lines if present
  if (data.orderlines && Array.isArray(data.orderlines) && data.orderlines.length > 0) {
    // Delete old lines
    await svc.from('scalev_order_lines').delete().eq('scalev_order_id', orderId);

    const lines = data.orderlines.map((line: any) => ({
      order_id: existing.id,
      scalev_order_id: orderId,
      product_name: line.product_name || null,
      variant_name: line.variant_unique_id || null,
      quantity: line.quantity || 0,
      weight: line.weight || 0,
    }));

    const { error: lineErr } = await svc.from('scalev_order_lines').insert(lines);
    if (lineErr) {
      console.warn(`[scalev-webhook] order.updated lines replace error for ${orderId}:`, lineErr.message);
    }
  }

  // Log
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: 'webhook_updated',
    orders_fetched: 1,
    orders_updated: 1,
    orders_inserted: 0,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  console.log(`[scalev-webhook] order.updated: ${orderId} updated successfully`);

  // Refresh views if relevant status
  if (data.status === 'shipped' || data.status === 'completed') {
    triggerViewRefresh();
  }

  return NextResponse.json({ ok: true, order_id: orderId, action: 'updated' });
}

// ── Handle order.deleted: soft-delete by marking as canceled ──
async function handleOrderDeleted(data: any) {
  const svc = getServiceSupabase();

  const orderId = data.order_id;
  if (!orderId) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no_order_id' });
  }

  const { data: existing, error: lookupErr } = await svc
    .from('scalev_orders')
    .select('id, order_id, status')
    .eq('order_id', orderId)
    .maybeSingle();

  if (lookupErr) {
    console.error(`[scalev-webhook] order.deleted lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    console.log(`[scalev-webhook] order.deleted: ${orderId} not found in DB, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'order_not_found' });
  }

  // Soft-delete: mark status as 'deleted' and record the timestamp
  const { error: updateErr } = await svc
    .from('scalev_orders')
    .update({
      status: 'deleted',
      canceled_time: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    })
    .eq('id', existing.id);

  if (updateErr) {
    console.error(`[scalev-webhook] order.deleted update error for ${orderId}:`, updateErr.message);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  // Log
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: 'webhook_deleted',
    orders_fetched: 1,
    orders_updated: 1,
    orders_inserted: 0,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  console.log(`[scalev-webhook] order.deleted: ${orderId} marked as deleted (was ${existing.status})`);
  triggerViewRefresh();

  return NextResponse.json({ ok: true, order_id: orderId, action: 'deleted', old_status: existing.status });
}

// ── Handle order.payment_status_changed: update payment-related fields ──
async function handlePaymentStatusChanged(data: any) {
  const svc = getServiceSupabase();

  const orderId = data.order_id;
  if (!orderId) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no_order_id' });
  }

  const { data: existing, error: lookupErr } = await svc
    .from('scalev_orders')
    .select('id, order_id, status')
    .eq('order_id', orderId)
    .maybeSingle();

  if (lookupErr) {
    console.error(`[scalev-webhook] payment_status_changed lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    console.log(`[scalev-webhook] payment_status_changed: ${orderId} not found, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'order_not_found' });
  }

  const updateData: Record<string, any> = {
    synced_at: new Date().toISOString(),
  };

  if (data.payment_method) updateData.payment_method = data.payment_method;
  if (data.status) updateData.status = data.status;
  if (data.paid_time) updateData.paid_time = ts(data.paid_time);
  if (data.gross_revenue != null) updateData.gross_revenue = num(data.gross_revenue);
  if (data.net_revenue != null) updateData.net_revenue = num(data.net_revenue);

  const { error: updateErr } = await svc
    .from('scalev_orders')
    .update(updateData)
    .eq('id', existing.id);

  if (updateErr) {
    console.error(`[scalev-webhook] payment_status_changed update error for ${orderId}:`, updateErr.message);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  // Log
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: 'webhook_payment_changed',
    orders_fetched: 1,
    orders_updated: 1,
    orders_inserted: 0,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  console.log(`[scalev-webhook] payment_status_changed: ${orderId} payment updated`);

  return NextResponse.json({ ok: true, order_id: orderId, action: 'payment_status_changed' });
}

// ── Handle order.e_payment_created: record e-payment info on order ──
async function handleEPaymentCreated(data: any) {
  const svc = getServiceSupabase();

  const orderId = data.order_id;
  if (!orderId) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no_order_id' });
  }

  const { data: existing, error: lookupErr } = await svc
    .from('scalev_orders')
    .select('id, order_id')
    .eq('order_id', orderId)
    .maybeSingle();

  if (lookupErr) {
    console.error(`[scalev-webhook] e_payment_created lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    console.log(`[scalev-webhook] e_payment_created: ${orderId} not found, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'order_not_found' });
  }

  const updateData: Record<string, any> = {
    synced_at: new Date().toISOString(),
  };

  if (data.payment_method) updateData.payment_method = data.payment_method;
  if (data.financial_entity) {
    updateData.financial_entity = data.financial_entity?.name || data.financial_entity?.code || data.financial_entity;
  }
  if (data.gross_revenue != null) updateData.gross_revenue = num(data.gross_revenue);
  if (data.net_revenue != null) updateData.net_revenue = num(data.net_revenue);
  if (data.unique_code_discount != null) updateData.unique_code_discount = num(data.unique_code_discount);

  const { error: updateErr } = await svc
    .from('scalev_orders')
    .update(updateData)
    .eq('id', existing.id);

  if (updateErr) {
    console.error(`[scalev-webhook] e_payment_created update error for ${orderId}:`, updateErr.message);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  // Log
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: 'webhook_epayment',
    orders_fetched: 1,
    orders_updated: 1,
    orders_inserted: 0,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  console.log(`[scalev-webhook] e_payment_created: ${orderId} e-payment recorded`);

  return NextResponse.json({ ok: true, order_id: orderId, action: 'e_payment_created' });
}

// ── POST handler ──
export async function POST(req: NextRequest) {
  try {
    // Validate required env vars early
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[scalev-webhook] Missing SUPABASE env vars');
      return NextResponse.json({ error: 'Server misconfigured: missing Supabase env vars' }, { status: 500 });
    }
    if (!process.env.SCALEV_WEBHOOK_SECRET) {
      console.error('[scalev-webhook] Missing SCALEV_WEBHOOK_SECRET');
      return NextResponse.json({ error: 'Server misconfigured: missing webhook secret' }, { status: 500 });
    }

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

      case 'order.updated':
        return handleOrderUpdated(data);

      case 'order.deleted':
        return handleOrderDeleted(data);

      case 'order.status_changed':
        return handleStatusChanged(data);

      case 'order.payment_status_changed':
        return handlePaymentStatusChanged(data);

      case 'order.e_payment_created':
        return handleEPaymentCreated(data);

      default:
        console.log(`[scalev-webhook] unhandled event: ${event}`);
        return NextResponse.json({ ok: true, skipped: true, event });
    }
  } catch (err: any) {
    console.error('[scalev-webhook] Unhandled error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
