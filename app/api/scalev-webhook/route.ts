// app/api/scalev-webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

import { deriveChannelFromStoreType, guessStoreType, type StoreType } from '@/lib/scalev-api';
import { buildScalevSourceClassFields } from '@/lib/scalev-source-class';
import {
  extractMarketplaceTrackingFromScalevOrderRawData,
  extractMarketplaceTrackingFromWebhookData,
} from '@/lib/marketplace-tracking';
import { reconcileScalevOrderWarehouse } from '@/lib/warehouse-ledger-actions';
import {
  extractScalevLineItemNameRaw,
  extractScalevLineItemOwnerRaw,
  extractScalevOrderBusinessNameRaw,
  extractScalevOrderOriginBusinessNameRaw,
  extractScalevOrderOriginRaw,
  fetchWarehouseBusinessDirectoryRows,
  fetchWarehouseOriginRegistryRows,
  resolveWarehouseBusinessCode,
  resolveWarehouseOrigin,
} from '@/lib/warehouse-domain-helpers';

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

type BusinessSecret = { id: number; code: string; name: string; secret: string; taxRateName: string };

let cachedSecrets: BusinessSecret[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

// ── Store type + channel override cache (DB-based lookup) ──
// Keyed by "businessId:storeName" to avoid collisions across businesses
let cachedStoreTypes: Map<string, StoreType> | null = null;
let cachedChannelOverrides: Map<string, string> | null = null;
let storeTypeCacheExpiry = 0;

async function getStoreTypeMap(): Promise<Map<string, StoreType>> {
  if (cachedStoreTypes && cachedChannelOverrides && Date.now() < storeTypeCacheExpiry) {
    return cachedStoreTypes;
  }
  try {
    const svc = getServiceSupabase();
    const { data } = await svc
      .from('scalev_store_channels')
      .select('store_name, store_type, business_id, channel_override')
      .eq('is_active', true);

    cachedStoreTypes = new Map();
    cachedChannelOverrides = new Map();
    for (const row of data || []) {
      const key = `${row.business_id}:${row.store_name.toLowerCase()}`;
      cachedStoreTypes.set(key, row.store_type as StoreType);
      if (row.channel_override) {
        cachedChannelOverrides.set(key, row.channel_override);
      }
    }
    storeTypeCacheExpiry = Date.now() + CACHE_TTL_MS;
    return cachedStoreTypes;
  } catch {
    return new Map();
  }
}

// Lookup store type by business_id + store_name
function lookupStoreType(storeTypes: Map<string, StoreType>, businessId: number, storeName: string): StoreType | undefined {
  return storeTypes.get(`${businessId}:${storeName.toLowerCase()}`);
}

// Lookup channel override by business_id + store_name
function lookupChannelOverride(businessId: number, storeName: string): string | undefined {
  return cachedChannelOverrides?.get(`${businessId}:${storeName.toLowerCase()}`);
}

async function buildOrderSourceClassFields(args: {
  data?: any;
  existing?: {
    source?: string | null;
    platform?: string | null;
    external_id?: string | null;
    financial_entity?: string | null;
    store_name?: string | null;
    raw_data?: any;
  } | null;
  businessId: number;
  source?: string | null;
}) {
  const storeTypes = await getStoreTypeMap();
  const storeName = args.data?.store?.name || args.data?.store_name || args.existing?.store_name || null;
  const storeType = storeName
    ? lookupStoreType(storeTypes, args.businessId, storeName) ?? null
    : null;

  return buildScalevSourceClassFields({
    source: args.source ?? args.existing?.source ?? null,
    platform: args.data?.platform ?? args.existing?.platform ?? null,
    externalId: args.data?.external_id ?? args.existing?.external_id ?? null,
    financialEntity: args.data?.financial_entity ?? args.existing?.financial_entity ?? null,
    rawData: args.data || args.existing?.raw_data || null,
    courierService: args.data?.courier_service ?? args.existing?.raw_data?.courier_service ?? null,
    courier: args.data?.courier ?? args.existing?.raw_data?.courier ?? null,
    storeName,
    storeType,
  });
}

// ── Derive channel using store_type from DB, fallback to guessed store_type ──
async function deriveChannelWithDbLookup(data: any, businessId: number): Promise<string> {
  const storeName = (data.store?.name || '').toLowerCase();

  const storeTypes = await getStoreTypeMap();

  // Check for store-specific channel override (e.g. WABA for Roove Mitra Store)
  const override = lookupChannelOverride(businessId, storeName);
  if (override) return override;

  const isPurchaseFb = data.is_purchase_fb === true || data.is_purchase_fb === 'true'
    || !!(data.message_variables?.advertiser || '').trim();

  const storeType = lookupStoreType(storeTypes, businessId, storeName) ?? guessStoreType(data.store?.name || '');

  return deriveChannelFromStoreType(storeType, isPurchaseFb, {
    external_id: data.external_id,
    financial_entity: data.financial_entity,
    raw_data: data,
    courier_service: data.courier_service,
    platform: data.platform,
  });
}

// ── Auto-register unknown store in scalev_store_channels ──
async function autoRegisterStore(storeName: string, businessCode: string, businessId: number) {
  if (!storeName) return;
  const storeTypes = await getStoreTypeMap();
  if (lookupStoreType(storeTypes, businessId, storeName) !== undefined) return;

  try {
    const svc = getServiceSupabase();
    const { data: biz } = await svc
      .from('scalev_webhook_businesses')
      .select('id')
      .eq('business_code', businessCode)
      .single();
    if (!biz) return;

    const storeType = guessStoreType(storeName);

    await svc.from('scalev_store_channels').upsert(
      { business_id: biz.id, store_name: storeName, store_type: storeType },
      { onConflict: 'business_id,store_name', ignoreDuplicates: true }
    );
    cachedStoreTypes = null;
    cachedChannelOverrides = null;
    console.log(`[scalev-webhook] Auto-registered store "${storeName}" for ${businessCode} → ${storeType}`);
  } catch (err: any) {
    console.warn(`[scalev-webhook] Failed to auto-register store "${storeName}":`, err.message);
  }
}

async function getBusinessSecretsFromDB(): Promise<BusinessSecret[]> {
  try {
    const svc = getServiceSupabase();
    const { data, error } = await svc
      .from('scalev_webhook_businesses')
      .select('id, business_code, business_name, webhook_secret, tax_rate_name')
      .eq('is_active', true);

    if (error || !data || data.length === 0) return [];

    return data.map((row: any) => ({
      id: row.id,
      code: row.business_code,
      name: row.business_name,
      secret: row.webhook_secret,
      taxRateName: row.tax_rate_name || 'PPN',
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
  const envBizIds: Record<string, number> = { RTI: 4, RLB: 5, RLT: 1 };
  for (const [code, name] of Object.entries({
    RTI: 'Roove Tijara Internasional',
    RLB: 'Roove Lautan Barat',
    RLT: 'Roove Lautan Timur',
  })) {
    const secret = process.env[`SCALEV_WEBHOOK_SECRET_${code}`];
    if (secret) envSecrets.push({ id: envBizIds[code] || 0, code, name, secret, taxRateName: 'PPN' });
  }

  if (envSecrets.length > 0) {
    cachedSecrets = envSecrets;
    cacheExpiry = Date.now() + CACHE_TTL_MS;
    return envSecrets;
  }

  // Legacy fallback: single secret
  if (process.env.SCALEV_WEBHOOK_SECRET) {
    const legacy = [{ id: 4, code: 'RTI', name: 'Legacy', secret: process.env.SCALEV_WEBHOOK_SECRET, taxRateName: 'PPN' }];
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
 * Returns the business code and id if a match is found, null otherwise.
 */
async function resolveBusinessFromSignature(rawBody: string, signature: string | null): Promise<{ code: string; id: number; taxRateName: string } | null> {
  if (!signature) return null;

  const secrets = await getBusinessSecrets();
  if (secrets.length === 0) return null;

  for (const { id, code, secret, taxRateName } of secrets) {
    if (verifyHmac(rawBody, signature, secret)) {
      return { code, id, taxRateName };
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

async function resolveWarehouseOrderContext(svc: ReturnType<typeof getServiceSupabase>, data: any, businessCode: string) {
  const [businessDirectoryRows, originRegistryRows] = await Promise.all([
    fetchWarehouseBusinessDirectoryRows(svc as any),
    fetchWarehouseOriginRegistryRows(svc as any),
  ]);

  const businessNameRaw = extractScalevOrderBusinessNameRaw(data, businessCode);
  const originBusinessNameRaw = extractScalevOrderOriginBusinessNameRaw(data);
  const originRaw = extractScalevOrderOriginRaw(data);

  const seller = resolveWarehouseBusinessCode({
    rawValue: businessNameRaw,
    fallbackBusinessCode: businessCode,
    directoryRows: businessDirectoryRows,
  });
  const originOperator = resolveWarehouseBusinessCode({
    rawValue: originBusinessNameRaw,
    fallbackBusinessCode: null,
    directoryRows: businessDirectoryRows,
  });
  const originRegistry = resolveWarehouseOrigin({
    rawOriginBusinessName: originBusinessNameRaw,
    rawOriginName: originRaw,
    registryRows: originRegistryRows,
  });

  return {
    businessDirectoryRows,
    businessNameRaw,
    originBusinessNameRaw,
    originRaw,
    sellerBusinessCode: seller.business_code || businessCode || null,
    originOperatorBusinessCode: originRegistry.operator_business_code || originOperator.business_code || null,
    originRegistryId: originRegistry.id || null,
  };
}

type ExistingScalevWebhookOrder = {
  id: number;
  order_id?: string | null;
  external_id?: string | null;
  status?: string | null;
  source?: string | null;
  scalev_id?: string | null;
  store_name?: string | null;
  platform?: string | null;
  financial_entity?: string | null;
  raw_data?: any;
};

// ── Helpers ──
const ts = (v: any): string | null =>
  v && typeof v === 'string' && v.trim() ? v.trim() : null;

const txt = (v: any): string => String(v ?? '').trim();

const num = (v: any): number => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
};

function isMarketplaceSourceClass(sourceClassFields: {
  source_class?: string | null;
}) {
  return sourceClassFields.source_class === 'marketplace';
}

function isMarketplaceAuthoritativeSource(source: string | null | undefined) {
  return txt(source) === 'marketplace_api_upload';
}

function extractWebhookScalevId(data: any): string | null {
  return ts(
    data?.id
    ?? data?.scalev_id
    ?? data?.raw_data?.id
    ?? null,
  );
}

async function recordMarketplaceWebhookQuarantine(args: {
  svc: ReturnType<typeof getServiceSupabase>;
  eventType: string;
  businessId: number;
  businessCode: string;
  data: any;
  sourceClassFields: {
    source_class?: string | null;
    source_class_reason?: string | null;
  };
  existing?: ExistingScalevWebhookOrder | null;
  reason: string;
}) {
  const payload = {
    event: args.eventType,
    data: args.data,
  };

  const { error } = await args.svc
    .from('scalev_marketplace_webhook_quarantine')
    .insert({
      business_id: args.businessId,
      business_code: args.businessCode,
      event_type: args.eventType,
      order_id: txt(args.data?.order_id) || null,
      external_id: txt(args.data?.external_id) || null,
      scalev_id: extractWebhookScalevId(args.data),
      source_class: args.sourceClassFields.source_class ?? null,
      source_class_reason: args.sourceClassFields.source_class_reason ?? null,
      matched_scalev_order_id: args.existing?.id ?? null,
      reason: args.reason,
      payload,
    });

  if (error) {
    const message = txt(error.message).toLowerCase();
    if (message.includes('schema cache') || message.includes('does not exist') || txt(error.code) === '42P01') {
      console.warn(`[scalev-webhook][${args.businessCode}] quarantine table unavailable for ${args.eventType}/${args.data?.order_id || '-'}: ${error.message}`);
      return;
    }
    throw error;
  }
}

async function maybeQuarantineMarketplaceWebhook(args: {
  svc: ReturnType<typeof getServiceSupabase>;
  eventType: string;
  businessId: number;
  businessCode: string;
  data: any;
  trackingNumber?: string | null;
  lookupError?: { message?: string | null } | null;
  sourceClassFields: {
    source_class?: string | null;
    source_class_reason?: string | null;
  };
  existing?: ExistingScalevWebhookOrder | null;
}) {
  if (!isMarketplaceSourceClass(args.sourceClassFields)) return null;

  const trackingNumber = extractMarketplaceTrackingFromWebhookData({
    tracking_number: args.trackingNumber,
  }) || extractMarketplaceTrackingFromWebhookData(args.data);

  const lookupMessage = txt(args.lookupError?.message).toLowerCase();
  if (lookupMessage.includes('matched tracking') || lookupMessage.includes('multiple marketplace')) {
    const reason = 'marketplace_webhook_ambiguous_tracking';
    await recordMarketplaceWebhookQuarantine({
      ...args,
      reason,
    });

    console.log(
      `[scalev-webhook][${args.businessCode}] ${args.eventType}: quarantined marketplace webhook for ${args.data?.order_id || '-'} (${reason})`,
    );

    return NextResponse.json({
      ok: true,
      quarantined: true,
      business_code: args.businessCode,
      event: args.eventType,
      order_id: txt(args.data?.order_id) || null,
      external_id: txt(args.data?.external_id) || null,
      source_class: args.sourceClassFields.source_class ?? null,
      source_class_reason: args.sourceClassFields.source_class_reason ?? null,
      matched_scalev_order_id: args.existing?.id ?? null,
      matched_source: args.existing?.source ?? null,
      reason,
    });
  }

  if (args.lookupError) return null;

  if (!trackingNumber) {
    const reason = 'marketplace_webhook_missing_tracking';
    await recordMarketplaceWebhookQuarantine({
      ...args,
      reason,
    });

    console.log(
      `[scalev-webhook][${args.businessCode}] ${args.eventType}: quarantined marketplace webhook for ${args.data?.order_id || '-'} (${reason})`,
    );

    return NextResponse.json({
      ok: true,
      quarantined: true,
      business_code: args.businessCode,
      event: args.eventType,
      order_id: txt(args.data?.order_id) || null,
      external_id: txt(args.data?.external_id) || null,
      source_class: args.sourceClassFields.source_class ?? null,
      source_class_reason: args.sourceClassFields.source_class_reason ?? null,
      matched_scalev_order_id: args.existing?.id ?? null,
      matched_source: args.existing?.source ?? null,
      reason,
    });
  }

  if (args.existing) {
    const existingSource = txt(args.existing.source);
    if (
      existingSource === 'webhook'
      || existingSource === 'marketplace_api_upload'
      || existingSource === 'ops_upload'
    ) {
      return null;
    }
  } else {
    return null;
  }

  const reason = args.existing
    ? 'marketplace_webhook_non_authoritative_match'
    : 'marketplace_webhook_unmatched';

  await recordMarketplaceWebhookQuarantine({
    ...args,
    reason,
  });

  console.log(
    `[scalev-webhook][${args.businessCode}] ${args.eventType}: quarantined marketplace webhook for ${args.data?.order_id || '-'} (${reason})`,
  );

  return NextResponse.json({
    ok: true,
    quarantined: true,
    business_code: args.businessCode,
    event: args.eventType,
    order_id: txt(args.data?.order_id) || null,
    external_id: txt(args.data?.external_id) || null,
    source_class: args.sourceClassFields.source_class ?? null,
    source_class_reason: args.sourceClassFields.source_class_reason ?? null,
    matched_scalev_order_id: args.existing?.id ?? null,
    matched_source: args.existing?.source ?? null,
    reason,
  });
}

function buildMarketplaceAuthoritativeUpdateBase(args: {
  existing: ExistingScalevWebhookOrder;
  orderId: string;
  data: any;
  businessCode: string;
  sourceClassFields: {
    source_class?: string | null;
    source_class_reason?: string | null;
  };
}) {
  const updateData: Record<string, any> = {
    business_code: args.businessCode,
    ...args.sourceClassFields,
    synced_at: new Date().toISOString(),
  };

  if (txt(args.existing.order_id) !== txt(args.orderId)) {
    updateData.order_id = args.orderId;
  }

  const webhookScalevId = extractWebhookScalevId(args.data);
  if (webhookScalevId && webhookScalevId !== txt(args.existing.scalev_id)) {
    updateData.scalev_id = webhookScalevId;
  }

  const externalId = txt(args.data?.external_id);
  if (externalId && !txt(args.existing.external_id)) {
    updateData.external_id = externalId;
  }

  return updateData;
}

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

function calcBeforeTax(price: number, tax: { rate: number; divisor: number }): number {
  return price / tax.divisor;
}

async function lookupOrderForBusiness(svc: any, orderId: string, businessCode: string, columns: string) {
  const scoped = await svc
    .from('scalev_orders')
    .select(columns)
    .eq('order_id', orderId)
    .eq('business_code', businessCode)
    .maybeSingle();

  if (scoped.error || scoped.data) return scoped;

  return svc
    .from('scalev_orders')
    .select(columns)
    .eq('order_id', orderId)
    .is('business_code', null)
    .maybeSingle();
}

async function lookupOrderForBusinessOrExternal(
  svc: any,
  orderId: string,
  businessCode: string,
  externalId: string | null | undefined,
  columns: string,
) {
  const byOrderId = await lookupOrderForBusiness(svc, orderId, businessCode, columns);
  if (byOrderId.error || byOrderId.data || !externalId) return byOrderId;

  const scoped = await svc
    .from('scalev_orders')
    .select(columns)
    .eq('external_id', externalId)
    .eq('business_code', businessCode)
    .maybeSingle();

  if (scoped.error || scoped.data) return scoped;

  return svc
    .from('scalev_orders')
    .select(columns)
    .eq('external_id', externalId)
    .is('business_code', null)
    .maybeSingle();
}

async function lookupMarketplaceOrderForBusinessTracking(
  svc: any,
  businessCode: string,
  storeName: string | null | undefined,
  trackingNumber: string | null | undefined,
  columns: string,
) {
  const normalizedTracking = extractMarketplaceTrackingFromWebhookData({
    tracking_number: trackingNumber,
  });
  if (!normalizedTracking) return { data: null, error: null };

  const selectColumns = columns.includes('raw_data')
    ? columns
    : `${columns}, raw_data`;

  let query = svc
    .from('scalev_orders')
    .select(selectColumns)
    .eq('business_code', businessCode)
    .in('source', ['marketplace_api_upload', 'webhook', 'ops_upload'])
    .limit(1000);

  const storeNameText = txt(storeName);
  if (storeNameText) {
    query = query.eq('store_name', storeNameText);
  }

  const { data, error } = await query;
  if (error) return { data: null, error };

  const matches = (data || []).filter((row: any) =>
    extractMarketplaceTrackingFromScalevOrderRawData(row.raw_data) === normalizedTracking);

  if (matches.length > 1) {
    return {
      data: null,
      error: { message: `multiple marketplace rows matched tracking ${normalizedTracking}` },
    };
  }

  return {
    data: (matches[0] as ExistingScalevWebhookOrder | undefined) || null,
    error: null,
  };
}

async function lookupOrderForBusinessConnector(
  svc: any,
  args: {
    orderId: string;
    businessCode: string;
    externalId: string | null | undefined;
    trackingNumber: string | null | undefined;
    storeName: string | null | undefined;
    columns: string;
    sourceClassFields: {
      source_class?: string | null;
    };
  },
) {
  const byOrderId = await lookupOrderForBusiness(svc, args.orderId, args.businessCode, args.columns);
  if (byOrderId.error || byOrderId.data) return byOrderId;

  if (isMarketplaceSourceClass(args.sourceClassFields)) {
    return lookupMarketplaceOrderForBusinessTracking(
      svc,
      args.businessCode,
      args.storeName,
      args.trackingNumber,
      args.columns,
    );
  }

  return lookupOrderForBusinessOrExternal(
    svc,
    args.orderId,
    args.businessCode,
    args.externalId,
    args.columns,
  );
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

function derivePlatformFromCourier(data?: any): string | null {
  if (!data) return null;
  // courier_service may be an object with nested courier info
  const courierCode = (
    data.courier_service?.courier?.code ||
    data.courier_service?.courier?.name ||
    data.courier ||
    ''
  ).toLowerCase();
  if (courierCode.includes('shopee')) return 'shopee';
  if (courierCode.includes('tiktok')) return 'tiktokshop';
  if (courierCode.includes('lazada')) return 'lazada';
  if (courierCode.includes('blibli')) return 'blibli';
  if (courierCode.includes('tokopedia')) return 'tokopedia';
  return null;
}

function derivePlatformFromStore(storeName: string, externalId?: string, webhookData?: any): string | null {
  const s = (storeName || '').toLowerCase();
  // Explicit marketplace name in store
  if (s.includes('shopee')) return 'shopee';
  if (s.includes('tiktok')) return 'tiktokshop';
  if (s.includes('lazada')) return 'lazada';
  if (s.includes('blibli')) return 'blibli';
  if (s.includes('tokopedia')) return 'tokopedia';
  // Generic marketplace — detect from financial_entity (most reliable), then external_id, then courier
  if (s.includes('marketplace') || s.includes('markerplace')) {
    // 1. financial_entity from webhook raw_data — definitive source
    // financial_entity can be an object {code: "shopee"} or a plain string "Shopee"
    const fe = webhookData?.financial_entity;
    const rawFe = webhookData?.raw_data?.financial_entity;
    const feCode = (
      (typeof fe === 'string' ? fe : fe?.code) ||
      (typeof rawFe === 'string' ? rawFe : rawFe?.code) ||
      ''
    ).toLowerCase();
    if (feCode === 'shopee') return 'shopee';
    if (feCode === 'tiktokshop') return 'tiktokshop';
    if (feCode === 'lazada') return 'lazada';
    if (feCode === 'blibli') return 'blibli';
    if (feCode === 'tokopedia') return 'tokopedia';
    // 2. external_id digit length
    const detected = deriveMarketplaceFromExternalId(externalId || '');
    if (detected) return detected;
    // 3. courier code fallback
    const fromCourier = derivePlatformFromCourier(webhookData);
    if (fromCourier) return fromCourier;
    return 'marketplace';
  }
  // Store name doesn't contain marketplace keyword — but could still be a
  // marketplace order (e.g. "Osgard Oil Store", "Purvu The Secret Store").
  // Check financial_entity, external_id, courier before defaulting to scalev.
  if (webhookData) {
    const fe2 = webhookData?.financial_entity;
    const rawFe2 = webhookData?.raw_data?.financial_entity;
    const feCode = (
      (typeof fe2 === 'string' ? fe2 : fe2?.code) ||
      (typeof rawFe2 === 'string' ? rawFe2 : rawFe2?.code) ||
      ''
    ).toLowerCase();
    if (feCode === 'shopee') return 'shopee';
    if (feCode === 'tiktokshop') return 'tiktokshop';
    if (feCode === 'lazada') return 'lazada';
    if (feCode === 'blibli') return 'blibli';
    if (feCode === 'tokopedia') return 'tokopedia';
    const detected = deriveMarketplaceFromExternalId(externalId || '');
    if (detected) return detected;
    const fromCourier = derivePlatformFromCourier(webhookData);
    if (fromCourier) return fromCourier;
  }
  return 'scalev';
}

// ── Build enriched order lines from webhook orderlines payload ──
async function buildEnrichedLines(
  orderId: string,
  dbOrderId: number,
  data: any,
  businessId: number,
  taxRateName = 'PPN',
  businessDirectoryRows?: Awaited<ReturnType<typeof fetchWarehouseBusinessDirectoryRows>>,
): Promise<any[]> {
  if (!data.orderlines || !Array.isArray(data.orderlines) || data.orderlines.length === 0) {
    return [];
  }

  const salesChannel = await deriveChannelWithDbLookup(data, businessId);
  const shippedTime = ts(data.shipped_time) || ts(data.completed_time) || null;
  const tax = taxRateName === 'NONE'
    ? { rate: 0, divisor: 1.0 }
    : await getTaxRate(taxRateName || 'PPN');

  const lines: any[] = [];
  const directoryRows = businessDirectoryRows || [];
  for (const line of data.orderlines) {
    const qty = line.quantity || 1;
    const productPrice = num(line.product_price);
    const discount = num(line.discount);
    const cogs = num(line.cogs || line.variant_cogs);
    const itemNameRaw = extractScalevLineItemNameRaw(line);
    const itemOwnerRaw = extractScalevLineItemOwnerRaw(line);
    const brand = await deriveBrandFromProduct(line.product_name || itemNameRaw || '');
    const ownerResolution = resolveWarehouseBusinessCode({
      rawValue: itemOwnerRaw,
      fallbackBusinessCode: null,
      directoryRows,
    });

    lines.push({
      scalev_order_id: dbOrderId,
      order_id: orderId,
      product_name: line.product_name || itemNameRaw || null,
      product_type: brand,
      variant_sku: line.variant_unique_id || null,
      quantity: qty,
      item_name_raw: itemNameRaw || line.product_name || null,
      item_owner_raw: itemOwnerRaw,
      stock_owner_business_code: ownerResolution.business_code || null,
      // Financial fields: all values from webhook are line totals incl. tax
      product_price_bt: calcBeforeTax(productPrice, tax),
      discount_bt: calcBeforeTax(discount, tax),
      cogs_bt: calcBeforeTax(cogs, tax),
      tax_rate: tax.rate,
      sales_channel: salesChannel,
      is_purchase_fb: data.is_purchase_fb === true || data.is_purchase_fb === 'true' || !!(data.message_variables?.advertiser || '').trim(),
      is_purchase_tiktok: data.is_purchase_tiktok === true || data.is_purchase_tiktok === 'true',
      is_purchase_kwai: data.is_purchase_kwai === true || data.is_purchase_kwai === 'true',
      synced_at: new Date().toISOString(),
    });
  }
  return lines;
}

// ── Handle order.created: insert new order into scalev_orders ──
async function handleOrderCreated(data: any, businessCode: string, businessId: number, taxRateName = 'PPN'): Promise<NextResponse> {
  const svc = getServiceSupabase();

  const orderId = data.order_id;
  if (!orderId) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no_order_id' });
  }

  const sourceClassFields = await buildOrderSourceClassFields({
    data,
    businessId,
    source: 'webhook',
  });
  const trackingNumber = extractMarketplaceTrackingFromWebhookData(data);

  // Check if order already exists
  const { data: existing, error: lookupErr } = await lookupOrderForBusinessConnector(svc, {
    orderId,
    businessCode,
    externalId: data.external_id,
    trackingNumber,
    storeName: data.store?.name || data.store_name || null,
    columns: 'id, business_code, order_id, external_id, source, scalev_id',
    sourceClassFields,
  });

  const quarantineResponse = await maybeQuarantineMarketplaceWebhook({
    svc,
    eventType: 'order.created',
    businessId,
    businessCode,
    data,
    trackingNumber,
    lookupError: lookupErr,
    sourceClassFields,
    existing,
  });

  if (quarantineResponse) {
    return quarantineResponse;
  }

  if (lookupErr) {
    console.error(`[scalev-webhook][${businessCode}] order.created lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (existing) {
    console.log(`[scalev-webhook][${businessCode}] order.created: ${orderId} already exists, treating as upsert`);
    return handleOrderUpdated(data, businessCode, businessId, taxRateName);
  }

  // Extract customer info from destination_address
  const dest = data.destination_address || {};
  const storeName = data.store?.name || null;
  const financialEntity = data.financial_entity?.name || data.financial_entity?.code || null;
  const warehouseOrderContext = await resolveWarehouseOrderContext(svc, data, businessCode);

  // Build order row
  const derivedPlatform = derivePlatformFromStore(storeName || '', data.external_id, data);
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
    is_purchase_fb: data.is_purchase_fb === true || data.is_purchase_fb === 'true' || !!(data.message_variables?.advertiser || '').trim(),
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
    business_name_raw: warehouseOrderContext.businessNameRaw,
    origin_business_name_raw: warehouseOrderContext.originBusinessNameRaw,
    origin_raw: warehouseOrderContext.originRaw,
    seller_business_code: warehouseOrderContext.sellerBusinessCode,
    origin_operator_business_code: warehouseOrderContext.originOperatorBusinessCode,
    origin_registry_id: warehouseOrderContext.originRegistryId,
    ...sourceClassFields,
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

  // Auto-register unknown store
  await autoRegisterStore(storeName || '', businessCode, businessId);

  // Insert enriched order lines (with financial data) if present
  if (inserted) {
    const lines = await buildEnrichedLines(
      orderId,
      inserted.id,
      data,
      businessId,
      taxRateName,
      warehouseOrderContext.businessDirectoryRows,
    );
    if (lines.length > 0) {
      const { error: lineErr } = await svc.from('scalev_order_lines').upsert(lines, { onConflict: 'scalev_order_id,product_name' });
      if (lineErr) {
        console.warn(`[scalev-webhook][${businessCode}] order.created lines insert error for ${orderId}:`, lineErr.message);
      }
    }
  }

  const warehouseResult = inserted
    ? await reconcileScalevOrderWarehouse(orderId, inserted.id)
    : null;

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
    ...(warehouseResult ? { warehouse_action: warehouseResult.action } : {}),
  });
}

// ── Handle order.status_changed: update existing order ──
async function handleStatusChanged(data: any, businessCode: string, businessId: number, taxRateName = 'PPN'): Promise<NextResponse> {
  const svc = getServiceSupabase();

  const orderId = data.order_id;
  const newStatus = data.status;

  if (!orderId || !newStatus) {
    return NextResponse.json({ error: 'Missing order_id or status' }, { status: 400 });
  }

  const preliminarySourceClassFields = await buildOrderSourceClassFields({
    data,
    businessId,
    source: 'webhook',
  });
  const trackingNumber = extractMarketplaceTrackingFromWebhookData(data);

  // Lookup order
  const { data: existing, error: lookupErr } = await lookupOrderForBusinessConnector(svc, {
    orderId,
    businessCode,
    externalId: data.external_id,
    trackingNumber,
    storeName: data.store?.name || data.store_name || null,
    columns: 'id, order_id, status, source, scalev_id, store_name, platform, external_id, financial_entity, raw_data',
    sourceClassFields: preliminarySourceClassFields,
  });

  const sourceClassFields = await buildOrderSourceClassFields({
    data,
    existing,
    businessId,
  });
  const quarantineResponse = await maybeQuarantineMarketplaceWebhook({
    svc,
    eventType: 'order.status_changed',
    businessId,
    businessCode,
    data,
    trackingNumber,
    lookupError: lookupErr,
    sourceClassFields,
    existing,
  });

  if (quarantineResponse) {
    return quarantineResponse;
  }

  if (lookupErr) {
    console.error(`[scalev-webhook][${businessCode}] status_changed lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    console.log(`[scalev-webhook][${businessCode}] status_changed: ${orderId} not found in DB, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'order_not_found' });
  }

  if (isMarketplaceAuthoritativeSource(existing.source)) {
    const updateData = buildMarketplaceAuthoritativeUpdateBase({
      existing,
      orderId,
      data,
      businessCode,
      sourceClassFields,
    });
    updateData.status = newStatus;

    const timestampFields = [
      'draft_time', 'pending_time', 'confirmed_time',
      'paid_time', 'shipped_time', 'completed_time', 'canceled_time',
    ];

    for (const field of timestampFields) {
      if (field in data) {
        updateData[field] = ts(data[field]);
      }
    }

    const { error: updateErr } = await svc
      .from('scalev_orders')
      .update(updateData)
      .eq('id', existing.id);

    if (updateErr) {
      console.error(`[scalev-webhook][${businessCode}] status_changed marketplace update error for ${orderId}:`, updateErr.message);
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
    }

    const warehouseResult = await reconcileScalevOrderWarehouse(orderId, existing.id);

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

    console.log(`[scalev-webhook][${businessCode}] status_changed: ${orderId} applied as marketplace authoritative update`);

    return NextResponse.json({
      ok: true,
      order_id: orderId,
      business_code: businessCode,
      action: 'status_changed_marketplace_authoritative',
      old_status: existing.status,
      new_status: newStatus,
      warehouse_action: warehouseResult.action,
      ...(warehouseResult.reversed > 0 && { warehouse_reversed: warehouseResult.reversed }),
      ...(warehouseResult.deducted > 0 && { warehouse_deducted: warehouseResult.deducted }),
    });
  }

  // Skip if status hasn't actually changed
  if (existing.status === newStatus) {
    const warehouseResult = await reconcileScalevOrderWarehouse(orderId, existing.id);
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'status_unchanged',
      ...(warehouseResult ? { warehouse_action: warehouseResult.action } : {}),
    });
  }

  // Build update
  const warehouseOrderContext = await resolveWarehouseOrderContext(svc, data, businessCode);
  const updateData: Record<string, any> = {
    status: newStatus,
    business_code: businessCode,
    business_name_raw: warehouseOrderContext.businessNameRaw,
    origin_business_name_raw: warehouseOrderContext.originBusinessNameRaw,
    origin_raw: warehouseOrderContext.originRaw,
    seller_business_code: warehouseOrderContext.sellerBusinessCode,
    origin_operator_business_code: warehouseOrderContext.originOperatorBusinessCode,
    origin_registry_id: warehouseOrderContext.originRegistryId,
    ...sourceClassFields,
    synced_at: new Date().toISOString(),
  };

  if (existing.order_id !== orderId) {
    updateData.order_id = orderId;
  }

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

  console.log(`[scalev-webhook][${businessCode}] status_changed: ${orderId} updated ${existing.status} → ${newStatus}`);

  // When order becomes shipped/completed, re-enrich lines that still have generic 'Marketplace' sales_channel
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

        if (genericLines && genericLines.length > 0) {
          const platform = derivePlatformFromStore(orderData.store_name || '', orderData.external_id, orderData.raw_data);
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

        // Re-derive sales_channel for lines that don't match current purchase flags
        // (handles misclassification from prior order.updated that changed flags without updating lines)
        const correctChannel = await deriveChannelWithDbLookup({
          store: { name: orderData.store_name },
          external_id: orderData.external_id,
          is_purchase_fb: orderData.is_purchase_fb,
          is_purchase_tiktok: orderData.is_purchase_tiktok,
          is_purchase_kwai: orderData.is_purchase_kwai,
          financial_entity: orderData.raw_data?.financial_entity,
          reseller_product_price: orderData.raw_data?.reseller_product_price,
          message_variables: orderData.raw_data?.message_variables,
        }, businessId);

        const { data: mismatchedLines } = await svc
          .from('scalev_order_lines')
          .select('id')
          .eq('scalev_order_id', existing.id)
          .neq('sales_channel', correctChannel);

        if (mismatchedLines && mismatchedLines.length > 0) {
          await svc
            .from('scalev_order_lines')
            .update({
              sales_channel: correctChannel,
              is_purchase_fb: orderData.is_purchase_fb,
              is_purchase_tiktok: orderData.is_purchase_tiktok,
              is_purchase_kwai: orderData.is_purchase_kwai,
            })
            .eq('scalev_order_id', existing.id);

          console.log(`[scalev-webhook][${businessCode}] status_changed: ${orderId} re-classified ${mismatchedLines.length} lines → ${correctChannel}`);
        }

        // Also check if lines are missing financial data (product_price_bt = 0 or null)
        // and raw_data has orderlines — re-enrich them
        const { data: emptyLines } = await svc
          .from('scalev_order_lines')
          .select('id')
          .eq('scalev_order_id', existing.id)
          .or('product_price_bt.is.null,product_price_bt.eq.0');

        if (emptyLines && emptyLines.length > 0 && orderData.raw_data?.orderlines?.length > 0) {
          // Delete old lines and re-insert enriched ones
          await svc.from('scalev_order_lines').delete().eq('scalev_order_id', existing.id);
          const enrichedLines = await buildEnrichedLines(orderId, existing.id, {
            ...orderData.raw_data,
            external_id: orderData.external_id,
            store: { name: orderData.store_name },
            is_purchase_fb: orderData.is_purchase_fb,
            is_purchase_tiktok: orderData.is_purchase_tiktok,
            is_purchase_kwai: orderData.is_purchase_kwai,
          }, businessId, taxRateName, warehouseOrderContext.businessDirectoryRows);
          if (enrichedLines.length > 0) {
            const { error: reInsertErr } = await svc.from('scalev_order_lines').upsert(enrichedLines, { onConflict: 'scalev_order_id,product_name' });
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
          }, businessId, taxRateName, warehouseOrderContext.businessDirectoryRows);
          if (newLines.length > 0) {
            const { error: insertErr } = await svc.from('scalev_order_lines').upsert(newLines, { onConflict: 'scalev_order_id,product_name' });
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

  }

  const warehouseResult = await reconcileScalevOrderWarehouse(orderId, existing.id);

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

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    business_code: businessCode,
    old_status: existing.status,
    new_status: newStatus,
    warehouse_action: warehouseResult.action,
    ...(warehouseResult.reversed > 0 && { warehouse_reversed: warehouseResult.reversed }),
    ...(warehouseResult.deducted > 0 && { warehouse_deducted: warehouseResult.deducted }),
  });
}

// ── Handle order.updated: full update of order data ──
async function handleOrderUpdated(data: any, businessCode: string, businessId: number, taxRateName = 'PPN'): Promise<NextResponse> {
  const svc = getServiceSupabase();

  const orderId = data.order_id;
  if (!orderId) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no_order_id' });
  }

  // Lookup existing order
  const preliminarySourceClassFields = await buildOrderSourceClassFields({
    data,
    businessId,
    source: 'webhook',
  });
  const trackingNumber = extractMarketplaceTrackingFromWebhookData(data);

  const { data: existing, error: lookupErr } = await lookupOrderForBusinessConnector(svc, {
    orderId,
    businessCode,
    externalId: data.external_id,
    trackingNumber,
    storeName: data.store?.name || data.store_name || null,
    columns: 'id, order_id, status, source, scalev_id, store_name, platform, external_id, financial_entity, raw_data',
    sourceClassFields: preliminarySourceClassFields,
  });

  if (!existing) {
    const sourceClassFields = await buildOrderSourceClassFields({
      data,
      existing,
      businessId,
    });
    const quarantineResponse = await maybeQuarantineMarketplaceWebhook({
      svc,
      eventType: 'order.updated',
      businessId,
      businessCode,
      data,
      trackingNumber,
      lookupError: lookupErr,
      sourceClassFields,
      existing,
    });

    if (quarantineResponse) {
      return quarantineResponse;
    }

    if (lookupErr) {
      console.error(`[scalev-webhook][${businessCode}] order.updated lookup error for ${orderId}:`, lookupErr.message);
      return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
    }

    // Order not in DB yet — treat as create
    console.log(`[scalev-webhook][${businessCode}] order.updated: ${orderId} not found, treating as create`);
    return handleOrderCreated(data, businessCode, businessId, taxRateName);
  }

  // Build update with all available fields
  const dest = data.destination_address || {};
  const storeName = data.store?.name || null;
  const financialEntity = data.financial_entity?.name || data.financial_entity?.code || null;
  const warehouseOrderContext = await resolveWarehouseOrderContext(svc, data, businessCode);
  const sourceClassFields = await buildOrderSourceClassFields({
    data,
    existing,
    businessId,
  });
  const quarantineResponse = await maybeQuarantineMarketplaceWebhook({
    svc,
    eventType: 'order.updated',
    businessId,
    businessCode,
    data,
    trackingNumber,
    lookupError: lookupErr,
    sourceClassFields,
    existing,
  });

  if (quarantineResponse) {
    return quarantineResponse;
  }

  if (lookupErr) {
    console.error(`[scalev-webhook][${businessCode}] order.updated lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (isMarketplaceAuthoritativeSource(existing.source)) {
    const updateData = buildMarketplaceAuthoritativeUpdateBase({
      existing,
      orderId,
      data,
      businessCode,
      sourceClassFields,
    });

    if (data.status) updateData.status = data.status;
    if (data.payment_method) updateData.payment_method = data.payment_method;
    if (financialEntity) updateData.financial_entity = financialEntity;
    if (data.gross_revenue != null) updateData.gross_revenue = num(data.gross_revenue);
    if (data.net_revenue != null) updateData.net_revenue = num(data.net_revenue);
    if (data.shipping_cost != null) updateData.shipping_cost = num(data.shipping_cost);
    if (data.total_quantity != null) updateData.total_quantity = data.total_quantity;
    if (data.unique_code_discount != null) updateData.unique_code_discount = num(data.unique_code_discount);

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
      console.error(`[scalev-webhook][${businessCode}] order.updated marketplace update error for ${orderId}:`, updateErr.message);
      return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
    }

    const warehouseResult = await reconcileScalevOrderWarehouse(orderId, existing.id);

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

    console.log(`[scalev-webhook][${businessCode}] order.updated: ${orderId} applied as marketplace authoritative update`);

    return NextResponse.json({
      ok: true,
      order_id: orderId,
      business_code: businessCode,
      action: 'updated_marketplace_authoritative',
      warehouse_action: warehouseResult.action,
      ...(warehouseResult.reversed > 0 && { warehouse_reversed: warehouseResult.reversed }),
      ...(warehouseResult.deducted > 0 && { warehouse_deducted: warehouseResult.deducted }),
    });
  }

  const updateData: Record<string, any> = {
    synced_at: new Date().toISOString(),
    business_code: businessCode,
    business_name_raw: warehouseOrderContext.businessNameRaw,
    origin_business_name_raw: warehouseOrderContext.originBusinessNameRaw,
    origin_raw: warehouseOrderContext.originRaw,
    seller_business_code: warehouseOrderContext.sellerBusinessCode,
    origin_operator_business_code: warehouseOrderContext.originOperatorBusinessCode,
    origin_registry_id: warehouseOrderContext.originRegistryId,
    ...sourceClassFields,
    raw_data: data,
  };

  if (existing.order_id !== orderId) updateData.order_id = orderId;
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
  if (storeName) updateData.platform = derivePlatformFromStore(storeName, data.external_id, data);
  // Update purchase flags from webhook data (only if explicitly sent).
  // Don't use advertiser fallback here — CSV may have already set is_purchase_fb.
  // Advertiser-based derivation only happens in handleOrderCreated (new orders).
  if (data.is_purchase_fb != null) {
    updateData.is_purchase_fb = data.is_purchase_fb === true || data.is_purchase_fb === 'true';
  }
  if (data.is_purchase_tiktok != null) updateData.is_purchase_tiktok = data.is_purchase_tiktok === true || data.is_purchase_tiktok === 'true';
  if (data.is_purchase_kwai != null) updateData.is_purchase_kwai = data.is_purchase_kwai === true || data.is_purchase_kwai === 'true';

  // Customer info (don't overwrite if source is ops_upload — ops is source of truth for customer)
  if (existing.source !== 'ops_upload' && existing.source !== 'marketplace_api_upload') {
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

    const lines = await buildEnrichedLines(
      orderId,
      existing.id,
      data,
      businessId,
      taxRateName,
      warehouseOrderContext.businessDirectoryRows,
    );
    if (lines.length > 0) {
      const { error: lineErr } = await svc.from('scalev_order_lines').upsert(lines, { onConflict: 'scalev_order_id,product_name' });
      if (lineErr) {
        console.warn(`[scalev-webhook][${businessCode}] order.updated lines replace error for ${orderId}:`, lineErr.message);
      }
    }
  } else if (data.is_purchase_fb != null || data.is_purchase_tiktok != null) {
    // Orderlines weren't replaced but purchase flags may have changed.
    // Re-derive sales_channel on existing lines to prevent misclassification
    // (e.g. is_purchase_fb changed from true→false but lines still say 'Scalev Ads').
    const { data: updatedOrder } = await svc
      .from('scalev_orders')
      .select('id, store_name, external_id, is_purchase_fb, is_purchase_tiktok, is_purchase_kwai, raw_data')
      .eq('id', existing.id)
      .single();

    if (updatedOrder) {
      const correctChannel = await deriveChannelWithDbLookup({
        store: { name: updatedOrder.store_name },
        external_id: updatedOrder.external_id,
        is_purchase_fb: updatedOrder.is_purchase_fb,
        is_purchase_tiktok: updatedOrder.is_purchase_tiktok,
        is_purchase_kwai: updatedOrder.is_purchase_kwai,
        financial_entity: updatedOrder.raw_data?.financial_entity,
        reseller_product_price: updatedOrder.raw_data?.reseller_product_price,
        message_variables: updatedOrder.raw_data?.message_variables,
      }, businessId);

      const { error: channelErr } = await svc
        .from('scalev_order_lines')
        .update({
          sales_channel: correctChannel,
          is_purchase_fb: updatedOrder.is_purchase_fb,
          is_purchase_tiktok: updatedOrder.is_purchase_tiktok,
          is_purchase_kwai: updatedOrder.is_purchase_kwai,
        })
        .eq('scalev_order_id', existing.id);

      if (channelErr) {
        console.warn(`[scalev-webhook][${businessCode}] order.updated: channel re-derive failed for ${orderId}:`, channelErr.message);
      } else {
        console.log(`[scalev-webhook][${businessCode}] order.updated: ${orderId} lines sales_channel re-derived → ${correctChannel}`);
      }
    }
  }

  const warehouseResult = await reconcileScalevOrderWarehouse(orderId, existing.id);

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

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    business_code: businessCode,
    action: 'updated',
    warehouse_action: warehouseResult.action,
    ...(warehouseResult.reversed > 0 && { warehouse_reversed: warehouseResult.reversed }),
    ...(warehouseResult.deducted > 0 && { warehouse_deducted: warehouseResult.deducted }),
  });
}

// ── Handle order.deleted: soft-delete by marking as canceled ──
async function handleOrderDeleted(data: any, businessCode: string, businessId: number) {
  const svc = getServiceSupabase();

  const orderId = data.order_id;
  if (!orderId) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no_order_id' });
  }

  const preliminarySourceClassFields = await buildOrderSourceClassFields({
    data,
    businessId,
    source: 'webhook',
  });
  const trackingNumber = extractMarketplaceTrackingFromWebhookData(data);

  const { data: existing, error: lookupErr } = await lookupOrderForBusinessConnector(svc, {
    orderId,
    businessCode,
    externalId: data.external_id,
    trackingNumber,
    storeName: data.store?.name || data.store_name || null,
    columns: 'id, order_id, status, source, scalev_id, store_name, platform, external_id, financial_entity, raw_data',
    sourceClassFields: preliminarySourceClassFields,
  });

  const sourceClassFields = await buildOrderSourceClassFields({
    data,
    existing,
    businessId,
  });
  const quarantineResponse = await maybeQuarantineMarketplaceWebhook({
    svc,
    eventType: 'order.deleted',
    businessId,
    businessCode,
    data,
    trackingNumber,
    lookupError: lookupErr,
    sourceClassFields,
    existing,
  });

  if (quarantineResponse) {
    return quarantineResponse;
  }

  if (lookupErr) {
    console.error(`[scalev-webhook][${businessCode}] order.deleted lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    console.log(`[scalev-webhook][${businessCode}] order.deleted: ${orderId} not found in DB, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'order_not_found' });
  }

  const updateData = isMarketplaceAuthoritativeSource(existing.source)
    ? buildMarketplaceAuthoritativeUpdateBase({
        existing,
        orderId,
        data,
        businessCode,
        sourceClassFields,
      })
    : {
        status: 'deleted',
        business_code: businessCode,
        ...sourceClassFields,
        canceled_time: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      };

  updateData.status = 'deleted';
  updateData.canceled_time = new Date().toISOString();

  // Soft-delete: mark status as 'deleted' and record the timestamp
  const { error: updateErr } = await svc
    .from('scalev_orders')
    .update(updateData)
    .eq('id', existing.id);

  if (updateErr) {
    console.error(`[scalev-webhook][${businessCode}] order.deleted update error for ${orderId}:`, updateErr.message);
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 });
  }
  const warehouseResult = await reconcileScalevOrderWarehouse(orderId, existing.id);

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

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    business_code: businessCode,
    action: 'deleted',
    old_status: existing.status,
    warehouse_action: warehouseResult.action,
    ...(warehouseResult.reversed > 0 && { warehouse_reversed: warehouseResult.reversed }),
  });
}

// ── Handle order.payment_status_changed: update payment-related fields ──
async function handlePaymentStatusChanged(data: any, businessCode: string, businessId: number) {
  const svc = getServiceSupabase();

  const orderId = data.order_id;
  if (!orderId) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no_order_id' });
  }

  const preliminarySourceClassFields = await buildOrderSourceClassFields({
    data,
    businessId,
    source: 'webhook',
  });
  const trackingNumber = extractMarketplaceTrackingFromWebhookData(data);

  const { data: existing, error: lookupErr } = await lookupOrderForBusinessConnector(svc, {
    orderId,
    businessCode,
    externalId: data.external_id,
    trackingNumber,
    storeName: data.store?.name || data.store_name || null,
    columns: 'id, order_id, status, source, scalev_id, store_name, platform, external_id, financial_entity, raw_data',
    sourceClassFields: preliminarySourceClassFields,
  });

  const sourceClassFields = await buildOrderSourceClassFields({
    data,
    existing,
    businessId,
  });
  const quarantineResponse = await maybeQuarantineMarketplaceWebhook({
    svc,
    eventType: 'order.payment_status_changed',
    businessId,
    businessCode,
    data,
    trackingNumber,
    lookupError: lookupErr,
    sourceClassFields,
    existing,
  });

  if (quarantineResponse) {
    return quarantineResponse;
  }

  if (lookupErr) {
    console.error(`[scalev-webhook][${businessCode}] payment_status_changed lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    console.log(`[scalev-webhook][${businessCode}] payment_status_changed: ${orderId} not found, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'order_not_found' });
  }

  const updateData: Record<string, any> = isMarketplaceAuthoritativeSource(existing.source)
    ? buildMarketplaceAuthoritativeUpdateBase({
        existing,
        orderId,
        data,
        businessCode,
        sourceClassFields,
      })
    : {
        business_code: businessCode,
        ...sourceClassFields,
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

  const warehouseResult = data.status
    ? await reconcileScalevOrderWarehouse(orderId, existing.id)
    : null;

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

  return NextResponse.json({
    ok: true,
    order_id: orderId,
    business_code: businessCode,
    action: 'payment_status_changed',
    ...(warehouseResult ? { warehouse_action: warehouseResult.action } : {}),
  });
}

// ── Handle order.e_payment_created: record e-payment info on order ──
async function handleEPaymentCreated(data: any, businessCode: string, businessId: number) {
  const svc = getServiceSupabase();

  const orderId = data.order_id;
  if (!orderId) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no_order_id' });
  }

  const preliminarySourceClassFields = await buildOrderSourceClassFields({
    data,
    businessId,
    source: 'webhook',
  });
  const trackingNumber = extractMarketplaceTrackingFromWebhookData(data);

  const { data: existing, error: lookupErr } = await lookupOrderForBusinessConnector(svc, {
    orderId,
    businessCode,
    externalId: data.external_id,
    trackingNumber,
    storeName: data.store?.name || data.store_name || null,
    columns: 'id, order_id, source, scalev_id, store_name, platform, external_id, financial_entity, raw_data',
    sourceClassFields: preliminarySourceClassFields,
  });

  const sourceClassFields = await buildOrderSourceClassFields({
    data,
    existing,
    businessId,
  });
  const quarantineResponse = await maybeQuarantineMarketplaceWebhook({
    svc,
    eventType: 'order.e_payment_created',
    businessId,
    businessCode,
    data,
    trackingNumber,
    lookupError: lookupErr,
    sourceClassFields,
    existing,
  });

  if (quarantineResponse) {
    return quarantineResponse;
  }

  if (lookupErr) {
    console.error(`[scalev-webhook][${businessCode}] e_payment_created lookup error for ${orderId}:`, lookupErr.message);
    return NextResponse.json({ error: 'DB lookup failed' }, { status: 500 });
  }

  if (!existing) {
    console.log(`[scalev-webhook][${businessCode}] e_payment_created: ${orderId} not found, skipping`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'order_not_found' });
  }

  const updateData: Record<string, any> = isMarketplaceAuthoritativeSource(existing.source)
    ? buildMarketplaceAuthoritativeUpdateBase({
        existing,
        orderId,
        data,
        businessCode,
        sourceClassFields,
      })
    : {
        business_code: businessCode,
        ...sourceClassFields,
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
    const matched = await resolveBusinessFromSignature(rawBody, signature);
    if (!matched) {
      console.error('[scalev-webhook] invalid signature — no matching business secret');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const { code: businessCode, id: businessId, taxRateName } = matched;
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

    // Route to appropriate handler — all handlers now receive businessCode + businessId
    switch (event) {
      case 'order.created':
        return handleOrderCreated(data, businessCode, businessId, taxRateName);

      case 'order.updated':
        return handleOrderUpdated(data, businessCode, businessId, taxRateName);

      case 'order.deleted':
        return handleOrderDeleted(data, businessCode, businessId);

      case 'order.status_changed':
        return handleStatusChanged(data, businessCode, businessId, taxRateName);

      case 'order.payment_status_changed':
        return handlePaymentStatusChanged(data, businessCode, businessId);

      case 'order.e_payment_created':
        return handleEPaymentCreated(data, businessCode, businessId);

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
