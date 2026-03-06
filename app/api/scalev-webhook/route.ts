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

// ── Multi-business secret configuration ──
// Primary: read from DB table `scalev_webhook_businesses`
// Fallback: env vars SCALEV_WEBHOOK_SECRET_<CODE> or legacy SCALEV_WEBHOOK_SECRET
// DB secrets are cached in memory for 60 seconds to avoid DB hits on every webhook

type BusinessSecret = { code: string; name: string; secret: string };

let cachedSecrets: BusinessSecret[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

async function getBusinessSecretsFromDB(): Promise<BusinessSecret[]> {
  try {
    const svc = getServiceSupabase();
    const { data, error } = await svc
      .from('scalev_webhook_businesses')
      .select('business_code, business_name, webhook_secret')
      .eq('is_active', true);

    if (error || !data || data.length === 0) return [];

    return data.map((row: any) => ({
      code: row.business_code,
      name: row.business_name,
      secret: row.webhook_secret,
    }));
  } catch {
    return [];
  }
}

async function getBusinessSecrets(): Promise<BusinessSecret[]> {
  // Return cached if still valid
  if (cachedSecrets && Date.now() < cacheExpiry) {
    return cachedSecrets;
  }

  // Try DB first
  const dbSecrets = await getBusinessSecretsFromDB();
  if (dbSecrets.length > 0) {
    cachedSecrets = dbSecrets;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return dbSecrets;
  }

  // Fallback: env vars (backward compatible)
  const envSecrets: BusinessSecret[] = [];
  for (const [code, name] of Object.entries({
    RTI: 'Roove Tijara Internasional',
    RLB: 'Roove Lautan Barat',
    RLT: 'Roove Lautan Timur',
  })) {
    const secret = process.env[`SCALEV_WEBHOOK_SECRET_${code}`];
    if (secret) envSecrets.push({ code, name, secret });
  }

  if (envSecrets.length > 0) {
    cachedSecrets = envSecrets;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return envSecrets;
  }

  // Legacy fallback: single secret
  if (process.env.SCALEV_WEBHOOK_SECRET) {
    const legacy = [{ code: 'RTI', name: 'Legacy', secret: process.env.SCALEV_WEBHOOK_SECRET }];
    cachedSecrets = legacy;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return legacy;
  }

  return [];
}

// ── Verify HMAC-SHA256 signature and resolve business ──
function verifyHmac(rawBody: string, signature: string, secret: string): boolean {
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

/**
 * Try each business secret to verify the signature.
 * Returns the business code if a match is found, null otherwise.
 */
async function resolveBusinessFromSignature(rawBody: string, signature: string | null): Promise<string | null> {
  if (!signature) return null;

  const secrets = await getBusinessSecrets();
  if (secrets.length === 0) return null;

  for (const { code, secret } of secrets) {
    if (verifyHmac(rawBody, signature, secret)) {
      return code;
    }
  }

  return null;
}

/** Get business display name from cached secrets */
function getBusinessName(code: string): string {
  if (!cachedSecrets) return code;
  const found = cachedSecrets.find((s) => s.code === code);
  return found?.name || code;
}

// ── Helpers ──
const ts = (v: any): string | null =>
  v && typeof v === 'string' && v.trim() ? v.trim() : null;

const num = (v: any): number => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
};

// ── PPN Tax Rate (dynamic from DB, cached) ──
const DEFAULT_TAX_RATE = 11;
const DEFAULT_TAX_DIVISOR = 1 + DEFAULT_TAX_RATE / 100; // 1.11

type TaxRateEntry = { name: string; rate: number; effective_from: string };
let cachedTaxRates: TaxRateEntry[] | null = null;
let taxRateCacheExpiry = 0;

async function getTaxRate(taxName = 'PPN'): Promise<{ rate: number; divisor: number }> {
  // Return cached if still valid
  if (!cachedTaxRates || Date.now() >= taxRateCacheExpiry) {
    try {
      const svc = getServiceSupabase();
      const { data } = await svc
        .from('tax_rates')
        .select('name, rate, effective_from')
        .order('effective_from', { ascending: false });
      cachedTaxRates = (data || []) as TaxRateEntry[];
      taxRateCacheExpiry = Date.now() + CACHE_TTL_MS;
    } catch {
      cachedTaxRates = [];
      taxRateCacheExpiry = Date.now() + CACHE_TTL_MS;
    }
  }

  // Find the most recent rate for the given tax name (already sorted desc by effective_from)
  const entry = cachedTaxRates.find(r => r.name === taxName);
  if (entry) {
    const rate = Number(entry.rate);
    return { rate, divisor: 1 + rate / 100 };
  }
  return { rate: DEFAULT_TAX_RATE, divisor: DEFAULT_TAX_DIVISOR };
}

// ── Brand detection from product name (dynamic from DB, cached) ──
type BrandKeyword = { name: string; keywords: string[] };
let cachedBrandKeywords: BrandKeyword[] | null = null;
let brandCacheExpiry = 0;

async function getBrandKeywords(): Promise<BrandKeyword[]> {
  if (cachedBrandKeywords && Date.now() < brandCacheExpiry) {
    return cachedBrandKeywords;
  }
  try {
    const svc = getServiceSupabase();
    const { data } = await svc
      .from('brands')
      .select('name, keywords')
      .eq('is_active', true);
    cachedBrandKeywords = (data || []).map((b: any) => ({
      name: b.name,
      keywords: b.keywords
        ? b.keywords.split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean)
        : [b.name.toLowerCase()],
    }));
    brandCacheExpiry = Date.now() + CACHE_TTL_MS;
  } catch {
    cachedBrandKeywords = [];
    brandCacheExpiry = Date.now() + CACHE_TTL_MS;
  }
  return cachedBrandKeywords;
}

async function deriveBrandFromProduct(productName: string): Promise<string> {
  const n = (productName || '').toLowerCase();
  const brands = await getBrandKeywords();
  for (const brand of brands) {
    if (brand.keywords.some(kw => n.includes(kw))) {
      return brand.name;
    }
  }
  return 'Other';
}

// ── Platform detection from store name + external_id digit pattern ──
// Marketplace external_id patterns (purely numeric):
//   Shopee:     10-14 digits  (e.g. 12190861252)
//   Lazada:     15-16 digits  (e.g. 2681417797192678)
//   TikTok Shop: 17-19 digits (e.g. 582900390905349354)
//   BliBli:     10-13 digits  — overlap with Shopee, but BliBli stores have explicit name
function deriveMarketplaceFromExternalId(externalId: string): string | null {
  const eid = (externalId || '').trim();
  // Only apply to purely numeric external IDs (marketplace orders)
  if (!/^\d+$/.test(eid)) return null;
  const len = eid.length;
  if (len >= 17) return 'tiktokshop';
  if (len >= 15) return 'lazada';
  if (len >= 10) return 'shopee';
  return null;
}

function derivePlatformFromStore(storeName: string, externalId?: string): string | null {
  const s = (storeName || '').toLowerCase();
  // Explicit marketplace name in store
  if (s.includes('shopee')) return 'shopee';
  if (s.includes('tiktok')) return 'tiktokshop';
  if (s.includes('lazada')) return 'lazada';
  if (s.includes('blibli')) return 'blibli';
  if (s.includes('tokopedia')) return 'tokopedia';
  // Generic marketplace — detect from external_id digit length
  if (s.includes('marketplace') || s.includes('markerplace')) {
    const detected = deriveMarketplaceFromExternalId(externalId || '');
    return detected || 'marketplace';
  }
  return 'scalev';
}

// ── Sales channel derivation from webhook data (mirrors csv-actions.ts) ──
function deriveSalesChannelFromWebhook(data: any): string {
  const storeName = (data.store?.name || '').toLowerCase();
  const platform = derivePlatformFromStore(data.store?.name || '', data.external_id);
  const resellerPrice = num(data.reseller_product_price);

  if (platform === 'shopee') return 'Shopee';
  if (platform === 'tiktokshop') return 'TikTok Shop';
  if (platform === 'lazada') return 'Lazada';
  if (platform === 'tokopedia') return 'Tokopedia';
  if (platform === 'blibli') return 'BliBli';
  if (platform === 'marketplace') return 'Marketplace';

  if (resellerPrice > 0 && (storeName.includes('mitra') || storeName.includes('reseller'))) return 'Reseller';
  if (storeName.includes('mitra') || storeName.includes('reseller')) return 'Reseller';

  if (data.is_purchase_fb === true || data.is_purchase_fb === 'true') return 'Facebook Ads';
  if (data.is_purchase_tiktok === true || data.is_purchase_tiktok === 'true') return 'TikTok Ads';

  return 'Organik';
}

// ── Build enriched order lines from webhook orderlines payload ──
async function buildEnrichedLines(orderId: string, dbOrderId: number, data: any): Promise<any[]> {
  if (!data.orderlines || !Array.isArray(data.orderlines) || data.orderlines.length === 0) {
    return [];
  }

  const salesChannel = deriveSalesChannelFromWebhook(data);
  const shippedTime = ts(data.shipped_time) || ts(data.completed_time) || null;
  const tax = await getTaxRate('PPN');

  const lines: any[] = [];
  for (const line of data.orderlines) {
    const qty = line.quantity || 1;
    const productPrice = num(line.product_price);
    const discount = num(line.discount);
    const cogs = num(line.cogs || line.variant_cogs);
    const brand = await deriveBrandFromProduct(line.product_name || '');

    lines.push({
      scalev_order_id: dbOrderId,
      order_id: orderId,
      product_name: line.product_name || null,
      product_type: brand,
      variant_sku: line.variant_unique_id || null,
      quantity: qty,
      // Financial fields: convert from per-unit incl. tax → before-tax line totals
      product_price_bt: (productPrice * qty) / tax.divisor,
      discount_bt: (discount * qty) / tax.divisor,
      cogs_bt: (cogs * qty) / tax.divisor,
      tax_rate: tax.rate,
      sales_channel: salesChannel,
      shipped_time: shippedTime,
      is_purchase_fb: data.is_purchase_fb === true || data.is_purchase_fb === 'true',
      is_purchase_tiktok: data.is_purchase_tiktok === true || data.is_purchase_tiktok === 'true',
      is_purchase_kwai: data.is_purchase_kwai === true || data.is_purchase_kwai === 'true',
      synced_at: new Date().toISOString(),
    });
  }
  return lines;
}

// ── Handle order.created: insert new order into scalev_orders ──
async function handleOrderCreated(data: any, businessCode: string) {
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
    console.log(`[scalev-webhook][${businessCode}] order.created: ${orderId} already exists, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'already_exists' });
  }

  // Extract customer info from destination_address
  const dest = data.destination_address || {};
  const storeName = data.store?.name || null;
  const financialEntity = data.financial_entity?.name || data.financial_entity?.code || null;

  // Build order row
  const derivedPlatform = derivePlatformFromStore(storeName || '', data.external_id);
  const orderRow: Record<string, any> = {
    scalev_id: null,
    order_id: orderId,
    external_id: data.external_id || null,
    customer_type: null,
    status: data.status || 'pending',
    platform: derivedPlatform,
    store_name: storeName,
    utm_source: null,
    financial_entity: financialEntity,
    payment_method: data.payment_method || null,
    unique_code_discount: num(data.unique_code_discount),
    is_purchase_fb: data.is_purchase_fb === true || data.is_purchase_fb === 'true',
    is_purchase_tiktok: data.is_purchase_tiktok === true || data.is_purchase_tiktok === 'true',
    is_purchase_kwai: data.is_purchase_kwai === true || data.is_purchase_kwai === 'true',
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
    completed_time: ts(data.completed_time),
    canceled_time: ts(data.canceled_time),
    source: 'webhook',
    business_code: businessCode,
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
    console.error(`[scalev-webhook][${businessCode}] order.created insert error for ${orderId}:`, insertErr.message);
    return NextResponse.json({ error: 'DB insert failed' }, { status: 500 });
  }

  // Insert enriched order lines (with financial data) if present
  if (inserted) {
    const lines = await buildEnrichedLines(orderId, inserted.id, data);
    if (lines.length > 0) {
      const { error: lineErr } = await svc.from('scalev_order_lines').insert(lines);
      if (lineErr) {
        console.warn(`[scalev-webhook][${businessCode}] order.created lines insert error for ${orderId}:`, lineErr.message);
      }
    }
  }

  // Log
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: 'webhook_created',
    business_code: businessCode,
    orders_fetched: 1,
    orders_updated: 0,
    orders_inserted: 1,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  console.log(`[scalev-webhook][${businessCode}] order.created: ${orderId} inserted successfully`);

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    business_code: businessCode,
    action: 'created',
  });
}

// ── Handle order.status_changed: update existing order ──
async function handleStatusChanged(data: any, businessCode: string) {
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
    console.error(`[scalev-webhook][${businessCode}] status_changed lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    console.log(`[scalev-webhook][${businessCode}] status_changed: ${orderId} not found in DB, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'order_not_found' });
  }

  // Skip if status hasn't actually changed
  if (existing.status === newStatus) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'status_unchanged' });
  }

  // Build update
  const updateData: Record<string, any> = {
    status: newStatus,
    business_code: businessCode,
    synced_at: new Date().toISOString(),
  };

  const timestampFields = [
    'draft_time', 'pending_time', 'confirmed_time',
    'paid_time', 'shipped_time', 'completed_time', 'canceled_time',
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
    console.error(`[scalev-webhook][${businessCode}] status_changed update error for ${orderId}:`, updateErr.message);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  // Log
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: 'webhook_status_changed',
    business_code: businessCode,
    orders_fetched: 1,
    orders_updated: 1,
    orders_inserted: 0,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  console.log(`[scalev-webhook][${businessCode}] status_changed: ${orderId} updated ${existing.status} → ${newStatus}`);

  // When order becomes shipped/completed, re-enrich lines that still have
  // generic 'Marketplace' sales_channel — by now external_id should be available
  if (newStatus === 'shipped' || newStatus === 'completed') {
    try {
      // Fetch current order data (with external_id and store_name)
      const { data: orderData } = await svc
        .from('scalev_orders')
        .select('id, external_id, store_name, is_purchase_fb, is_purchase_tiktok, is_purchase_kwai, raw_data')
        .eq('id', existing.id)
        .single();

      if (orderData) {
        // Check if any lines have generic 'Marketplace' channel
        const { data: genericLines } = await svc
          .from('scalev_order_lines')
          .select('id')
          .eq('scalev_order_id', existing.id)
          .eq('sales_channel', 'Marketplace');

        if (genericLines && genericLines.length > 0 && orderData.external_id) {
          const platform = derivePlatformFromStore(orderData.store_name || '', orderData.external_id);
          let resolvedChannel = 'Marketplace';
          if (platform === 'shopee') resolvedChannel = 'Shopee';
          else if (platform === 'tiktokshop') resolvedChannel = 'TikTok Shop';
          else if (platform === 'lazada') resolvedChannel = 'Lazada';
          else if (platform === 'tokopedia') resolvedChannel = 'Tokopedia';
          else if (platform === 'blibli') resolvedChannel = 'BliBli';

          if (resolvedChannel !== 'Marketplace') {
            await svc
              .from('scalev_order_lines')
              .update({ sales_channel: resolvedChannel })
              .eq('scalev_order_id', existing.id)
              .eq('sales_channel', 'Marketplace');

            // Also update the platform on the order itself
            await svc
              .from('scalev_orders')
              .update({ platform })
              .eq('id', existing.id);

            console.log(`[scalev-webhook][${businessCode}] status_changed: ${orderId} re-derived channel → ${resolvedChannel} (from external_id)`);
          }
        }

        // Also check if lines are missing financial data (product_price_bt = 0 or null)
        // and raw_data has orderlines — re-enrich them
        const { data: emptyLines } = await svc
          .from('scalev_order_lines')
          .select('id')
          .eq('scalev_order_id', existing.id)
          .or('product_price_bt.is.null,product_price_bt.eq.0');

        if (emptyLines && emptyLines.length > 0 && orderData.raw_data?.orderlines) {
          // Delete old lines and re-insert enriched ones
          await svc.from('scalev_order_lines').delete().eq('scalev_order_id', existing.id);
          const enrichedLines = await buildEnrichedLines(orderId, existing.id, {
            ...orderData.raw_data,
            external_id: orderData.external_id,
            store: { name: orderData.store_name },
            is_purchase_fb: orderData.is_purchase_fb,
            is_purchase_tiktok: orderData.is_purchase_tiktok,
            is_purchase_kwai: orderData.is_purchase_kwai,
          });
          if (enrichedLines.length > 0) {
            const { error: reInsertErr } = await svc.from('scalev_order_lines').insert(enrichedLines);
            if (reInsertErr) {
              console.warn(`[scalev-webhook][${businessCode}] status_changed: re-enrich lines error for ${orderId}:`, reInsertErr.message);
            } else {
              console.log(`[scalev-webhook][${businessCode}] status_changed: ${orderId} re-enriched ${enrichedLines.length} lines with financial data`);
            }
          }
        }

        // Safety net: if NO lines exist at all but raw_data has orderlines, insert them
        const { count: lineCount } = await svc
          .from('scalev_order_lines')
          .select('id', { count: 'exact', head: true })
          .eq('scalev_order_id', existing.id);

        if ((lineCount === 0 || lineCount === null) && orderData.raw_data?.orderlines?.length > 0) {
          const newLines = await buildEnrichedLines(orderId, existing.id, {
            ...orderData.raw_data,
            external_id: orderData.external_id,
            store: { name: orderData.store_name },
            is_purchase_fb: orderData.is_purchase_fb,
            is_purchase_tiktok: orderData.is_purchase_tiktok,
            is_purchase_kwai: orderData.is_purchase_kwai,
          });
          if (newLines.length > 0) {
            const { error: insertErr } = await svc.from('scalev_order_lines').insert(newLines);
            if (insertErr) {
              console.warn(`[scalev-webhook][${businessCode}] status_changed: insert missing lines error for ${orderId}:`, insertErr.message);
            } else {
              console.log(`[scalev-webhook][${businessCode}] status_changed: ${orderId} inserted ${newLines.length} missing lines from raw_data`);
            }
          }
        }
      }
    } catch (enrichErr: any) {
      // Non-fatal: log but don't fail the status change
      console.warn(`[scalev-webhook][${businessCode}] status_changed: re-enrich failed for ${orderId}:`, enrichErr.message);
    }

    triggerViewRefresh();
  }

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    business_code: businessCode,
    old_status: existing.status,
    new_status: newStatus,
  });
}

// ── Handle order.updated: full update of order data ──
async function handleOrderUpdated(data: any, businessCode: string) {
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
    console.error(`[scalev-webhook][${businessCode}] order.updated lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    // Order not in DB yet — treat as create
    console.log(`[scalev-webhook][${businessCode}] order.updated: ${orderId} not found, treating as create`);
    return handleOrderCreated(data, businessCode);
  }

  // Build update with all available fields
  const dest = data.destination_address || {};
  const storeName = data.store?.name || null;
  const financialEntity = data.financial_entity?.name || data.financial_entity?.code || null;

  const updateData: Record<string, any> = {
    synced_at: new Date().toISOString(),
    business_code: businessCode,
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
  // Derive platform from store name if not already set
  if (storeName) updateData.platform = derivePlatformFromStore(storeName, data.external_id);
  // Update purchase flags from webhook data
  if (data.is_purchase_fb != null) updateData.is_purchase_fb = data.is_purchase_fb === true || data.is_purchase_fb === 'true';
  if (data.is_purchase_tiktok != null) updateData.is_purchase_tiktok = data.is_purchase_tiktok === true || data.is_purchase_tiktok === 'true';
  if (data.is_purchase_kwai != null) updateData.is_purchase_kwai = data.is_purchase_kwai === true || data.is_purchase_kwai === 'true';

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
    'paid_time', 'shipped_time', 'completed_time', 'canceled_time',
  ];
  for (const field of timestampFields) {
    if (field in data) updateData[field] = ts(data[field]);
  }

  const { error: updateErr } = await svc
    .from('scalev_orders')
    .update(updateData)
    .eq('id', existing.id);

  if (updateErr) {
    console.error(`[scalev-webhook][${businessCode}] order.updated update error for ${orderId}:`, updateErr.message);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  // Replace order lines with enriched data (including financial fields)
  if (data.orderlines && Array.isArray(data.orderlines) && data.orderlines.length > 0) {
    // Delete old lines
    await svc.from('scalev_order_lines').delete().eq('scalev_order_id', existing.id);

    const lines = await buildEnrichedLines(orderId, existing.id, data);
    if (lines.length > 0) {
      const { error: lineErr } = await svc.from('scalev_order_lines').insert(lines);
      if (lineErr) {
        console.warn(`[scalev-webhook][${businessCode}] order.updated lines replace error for ${orderId}:`, lineErr.message);
      }
    }
  }

  // Log
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: 'webhook_updated',
    business_code: businessCode,
    orders_fetched: 1,
    orders_updated: 1,
    orders_inserted: 0,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  console.log(`[scalev-webhook][${businessCode}] order.updated: ${orderId} updated successfully`);

  // Refresh views if relevant status
  if (data.status === 'shipped' || data.status === 'completed') {
    triggerViewRefresh();
  }

  return NextResponse.json({ ok: true, order_id: orderId, business_code: businessCode, action: 'updated' });
}

// ── Handle order.deleted: soft-delete by marking as canceled ──
async function handleOrderDeleted(data: any, businessCode: string) {
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
    console.error(`[scalev-webhook][${businessCode}] order.deleted lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    console.log(`[scalev-webhook][${businessCode}] order.deleted: ${orderId} not found in DB, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'order_not_found' });
  }

  // Soft-delete: mark status as 'deleted' and record the timestamp
  const { error: updateErr } = await svc
    .from('scalev_orders')
    .update({
      status: 'deleted',
      business_code: businessCode,
      canceled_time: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    })
    .eq('id', existing.id);

  if (updateErr) {
    console.error(`[scalev-webhook][${businessCode}] order.deleted update error for ${orderId}:`, updateErr.message);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  // Log
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: 'webhook_deleted',
    business_code: businessCode,
    orders_fetched: 1,
    orders_updated: 1,
    orders_inserted: 0,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  console.log(`[scalev-webhook][${businessCode}] order.deleted: ${orderId} marked as deleted (was ${existing.status})`);
  triggerViewRefresh();

  return NextResponse.json({ ok: true, order_id: orderId, business_code: businessCode, action: 'deleted', old_status: existing.status });
}

// ── Handle order.payment_status_changed: update payment-related fields ──
async function handlePaymentStatusChanged(data: any, businessCode: string) {
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
    console.error(`[scalev-webhook][${businessCode}] payment_status_changed lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    console.log(`[scalev-webhook][${businessCode}] payment_status_changed: ${orderId} not found, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'order_not_found' });
  }

  const updateData: Record<string, any> = {
    business_code: businessCode,
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
    console.error(`[scalev-webhook][${businessCode}] payment_status_changed update error for ${orderId}:`, updateErr.message);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  // Log
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: 'webhook_payment_changed',
    business_code: businessCode,
    orders_fetched: 1,
    orders_updated: 1,
    orders_inserted: 0,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  console.log(`[scalev-webhook][${businessCode}] payment_status_changed: ${orderId} payment updated`);

  return NextResponse.json({ ok: true, order_id: orderId, business_code: businessCode, action: 'payment_status_changed' });
}

// ── Handle order.e_payment_created: record e-payment info on order ──
async function handleEPaymentCreated(data: any, businessCode: string) {
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
    console.error(`[scalev-webhook][${businessCode}] e_payment_created lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    console.log(`[scalev-webhook][${businessCode}] e_payment_created: ${orderId} not found, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'order_not_found' });
  }

  const updateData: Record<string, any> = {
    business_code: businessCode,
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
    console.error(`[scalev-webhook][${businessCode}] e_payment_created update error for ${orderId}:`, updateErr.message);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }

  // Log
  await svc.from('scalev_sync_log').insert({
    status: 'success',
    sync_type: 'webhook_epayment',
    business_code: businessCode,
    orders_fetched: 1,
    orders_updated: 1,
    orders_inserted: 0,
    error_message: null,
    completed_at: new Date().toISOString(),
  });

  console.log(`[scalev-webhook][${businessCode}] e_payment_created: ${orderId} e-payment recorded`);

  return NextResponse.json({ ok: true, order_id: orderId, business_code: businessCode, action: 'e_payment_created' });
}

// ── POST handler ──
export async function POST(req: NextRequest) {
  try {
    // Validate required env vars early
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[scalev-webhook] Missing SUPABASE env vars');
      return NextResponse.json({ error: 'Server misconfigured: missing Supabase env vars' }, { status: 500 });
    }

    const rawBody = await req.text();
    const signature = req.headers.get('x-scalev-hmac-sha256');

    // Verify signature and resolve which business sent this webhook
    // (reads from DB with in-memory cache, falls back to env vars)
    const businessCode = await resolveBusinessFromSignature(rawBody, signature);
    if (!businessCode) {
      console.error('[scalev-webhook] invalid signature — no matching business secret');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const businessName = getBusinessName(businessCode);
    console.log(`[scalev-webhook] Verified request from ${businessName} (${businessCode})`);

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { event, data } = body;

    // Handle test event
    if (event === 'business.test_event') {
      console.log(`[scalev-webhook][${businessCode}] test event received`);
      return NextResponse.json({ ok: true, business_code: businessCode, message: 'Test event received' });
    }

    // Route to appropriate handler — all handlers now receive businessCode
    switch (event) {
      case 'order.created':
        return handleOrderCreated(data, businessCode);

      case 'order.updated':
        return handleOrderUpdated(data, businessCode);

      case 'order.deleted':
        return handleOrderDeleted(data, businessCode);

      case 'order.status_changed':
        return handleStatusChanged(data, businessCode);

      case 'order.payment_status_changed':
        return handlePaymentStatusChanged(data, businessCode);

      case 'order.e_payment_created':
        return handleEPaymentCreated(data, businessCode);

      default:
        console.log(`[scalev-webhook][${businessCode}] unhandled event: ${event}`);
        return NextResponse.json({ ok: true, skipped: true, business_code: businessCode, event });
    }
  } catch (err: any) {
    console.error('[scalev-webhook] Unhandled error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
