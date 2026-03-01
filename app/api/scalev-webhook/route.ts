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

  // Timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(calculated),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}

// ── Timestamp helper: return ISO string or null ──
const ts = (v: any): string | null =>
  v && typeof v === 'string' && v.trim() ? v.trim() : null;

export async function POST(req: NextRequest) {
  // Read raw body for signature verification
  const rawBody = await req.text();
  const signature = req.headers.get('x-scalev-hmac-sha256');

  // ── Verify signature ──
  if (!verifySignature(rawBody, signature)) {
    console.error('Scalev webhook: invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { event, unique_id, data } = body;

  // ── Handle test event (sent when webhook is first enabled) ──
  if (event === 'business.test_event') {
    console.log('Scalev webhook: test event received');
    return NextResponse.json({ ok: true, message: 'Test event received' });
  }

  // ── Only process order.status_changed for now ──
  if (event !== 'order.status_changed') {
    // Acknowledge but skip — Scalev expects 200 for all events
    return NextResponse.json({ ok: true, skipped: true, event });
  }

  // ── Process status change ──
  const orderId = data?.order_id;
  const newStatus = data?.status;

  if (!orderId || !newStatus) {
    return NextResponse.json({ error: 'Missing order_id or status' }, { status: 400 });
  }

  const svc = getServiceSupabase();

  try {
    // Lookup order by order_id
    const { data: existing, error: lookupErr } = await svc
      .from('scalev_orders')
      .select('id, order_id, status')
      .eq('order_id', orderId)
      .maybeSingle();

    if (lookupErr) {
      console.error(`Scalev webhook: lookup error for ${orderId}:`, lookupErr.message);
      return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
    }

    if (!existing) {
      // Order not in our database — acknowledge but skip
      console.log(`Scalev webhook: order ${orderId} not found in DB, skipping`);
      return NextResponse.json({ ok: true, skipped: true, reason: 'order_not_found' });
    }

    // Skip if status hasn't actually changed
    if (existing.status === newStatus) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'status_unchanged' });
    }

    // Build update object with status + all timestamp fields from webhook
    const updateData: Record<string, any> = {
      status: newStatus,
      synced_at: new Date().toISOString(),
    };

    // Map all timestamp fields from the webhook payload
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

    // Update the order
    const { error: updateErr } = await svc
      .from('scalev_orders')
      .update(updateData)
      .eq('id', existing.id);

    if (updateErr) {
      console.error(`Scalev webhook: update error for ${orderId}:`, updateErr.message);
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
    }

    // Log the webhook event
    await svc.from('scalev_sync_log').insert({
      status: 'success',
      sync_type: 'webhook',
      orders_fetched: 1,
      orders_updated: 1,
      orders_inserted: 0,
      error_message: null,
      completed_at: new Date().toISOString(),
    });

    console.log(`Scalev webhook: ${orderId} status updated ${existing.status} → ${newStatus}`);

    return NextResponse.json({
      ok: true,
      order_id: orderId,
      old_status: existing.status,
      new_status: newStatus,
    });
  } catch (err: any) {
    console.error('Scalev webhook error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
