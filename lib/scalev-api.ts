// lib/scalev-api.ts
// Scalev API client for fetching order data

import { createClient } from '@supabase/supabase-js';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export interface ScalevConfig {
  id: number;
  api_key: string;
  base_url: string;
  last_sync_id: number;
}

// ── Get Scalev config from DB ──
export async function getScalevConfig(): Promise<ScalevConfig | null> {
  const svc = getServiceSupabase();
  const { data, error } = await svc
    .from('scalev_config')
    .select('id, api_key, base_url, last_sync_id')
    .eq('is_active', true)
    .single();

  if (error || !data) return null;
  return data as ScalevConfig;
}

// ── Fetch order list with pagination ──
// NOTE: Scalev uses singular /order endpoint, NOT /orders
// NOTE: page_size=1 is most reliable; larger values may 404
export async function fetchOrderList(
  apiKey: string,
  baseUrl: string,
  lastId: number = 0,
  pageSize: number = 25
): Promise<{ results: any[]; hasNext: boolean; lastId: number }> {
  let url = `${baseUrl}/order?page_size=${pageSize}`;
  if (lastId > 0) {
    url += `&last_id=${lastId}`;
  }

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Scalev API error ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(`Scalev API returned code ${json.code}: ${json.status}`);
  }

  return {
    results: json.data?.results || [],
    hasNext: json.data?.has_next || false,
    lastId: json.data?.last_id || 0,
  };
}

// ── Fetch single order detail ──
export async function fetchOrderDetail(
  apiKey: string,
  baseUrl: string,
  orderId: string
): Promise<any> {
  const res = await fetch(`${baseUrl}/order/${orderId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Scalev API error ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(`Scalev API returned code ${json.code}: ${json.status}`);
  }

  return json.data;
}

// ── Store type system ──
export type StoreType = 'marketplace' | 'scalev' | 'reseller';

// Guess store_type from store name (for auto-register & API fetch)
export function guessStoreType(storeName: string): StoreType {
  const lower = (storeName || '').toLowerCase();
  if (lower.includes('marketplace') || lower.includes('markerplace')
    || lower.includes('shopee') || lower.includes('tiktok')
    || lower.includes('lazada') || lower.includes('tokopedia')
    || lower.includes('blibli')) {
    return 'marketplace';
  }
  if (lower.includes('reseller') || lower.includes('dropship') || lower.includes('mitra')) {
    return 'reseller';
  }
  return 'scalev';
}

// Detect specific marketplace from order data (for marketplace store_type)
export function detectMarketplace(orderData: {
  external_id?: string;
  financial_entity?: { code?: string };
  raw_data?: { financial_entity?: { code?: string } };
  courier_service?: any;
  courier?: string;
  platform?: string;
}): string {
  // 1. financial_entity.code (most reliable)
  // financial_entity can be an object {code: "shopee"} or a plain string "Shopee"
  const fe = orderData.financial_entity;
  const rawFe = orderData.raw_data?.financial_entity;
  const feCode = (
    (typeof fe === 'string' ? fe : fe?.code)
    || (typeof rawFe === 'string' ? rawFe : rawFe?.code)
    || ''
  ).toLowerCase();
  if (feCode === 'shopee') return 'Shopee';
  if (feCode === 'tiktokshop') return 'TikTok Shop';
  if (feCode === 'lazada') return 'Lazada';
  if (feCode === 'blibli') return 'BliBli';
  if (feCode === 'tokopedia') return 'Tokopedia';

  // 2. platform field (CSV/API)
  const platform = (orderData.platform || '').toLowerCase();
  if (platform === 'shopee') return 'Shopee';
  if (platform === 'tiktokshop' || platform === 'tiktok') return 'TikTok Shop';
  if (platform === 'lazada') return 'Lazada';
  if (platform === 'tokopedia') return 'Tokopedia';
  if (platform === 'blibli') return 'BliBli';

  // 3. external_id digit patterns
  const eid = (orderData.external_id || '').trim();
  if (/^\d+$/.test(eid)) {
    const len = eid.length;
    if (len >= 17) return 'TikTok Shop';
    if (len >= 15) return 'Lazada';
    if (len >= 10) return 'Shopee';
  }

  // 4. courier code
  const courierCode = (
    orderData.courier_service?.courier?.code
    || orderData.courier_service?.courier?.name
    || orderData.courier
    || ''
  ).toLowerCase();
  if (courierCode.includes('shopee')) return 'Shopee';
  if (courierCode.includes('tiktok')) return 'TikTok Shop';
  if (courierCode.includes('lazada')) return 'Lazada';
  if (courierCode.includes('blibli')) return 'BliBli';
  if (courierCode.includes('tokopedia')) return 'Tokopedia';

  // 5. Fallback
  return 'Marketplace';
}

// Derive channel from store_type + order data
export function deriveChannelFromStoreType(
  storeType: StoreType,
  isPurchaseFb: boolean,
  orderData: {
    external_id?: string;
    financial_entity?: { code?: string };
    raw_data?: { financial_entity?: { code?: string } };
    courier_service?: any;
    courier?: string;
    platform?: string;
  }
): string {
  switch (storeType) {
    case 'marketplace':
      return detectMarketplace(orderData);
    case 'reseller':
      return 'Reseller';
    case 'scalev': {
      // Before defaulting to Scalev Ads / CS Manual, check if this order
      // is actually a marketplace order (store name doesn't contain
      // marketplace keywords but platform/financial_entity/external_id does)
      const mpDetected = detectMarketplace(orderData);
      if (mpDetected !== 'Marketplace') {
        // Specific marketplace detected (Shopee, TikTok Shop, etc.)
        return mpDetected;
      }
      return isPurchaseFb ? 'Scalev Ads' : 'CS Manual';
    }
  }
}

// ── Derive sales_channel from order data (no DB lookup) ──
export function deriveSalesChannel(order: any): string {
  const storeType = guessStoreType(order.store?.name || '');
  const isPurchaseFb = order.is_purchase_fb || false;
  return deriveChannelFromStoreType(storeType, isPurchaseFb, {
    external_id: order.external_id,
    financial_entity: order.financial_entity,
    raw_data: order.raw_data,
    courier_service: order.courier_service,
    platform: order.platform,
  });
}

// ── Product type lookup with fallback chain ──
// 1. Exact match from product_mapping table
// 2. Fuzzy match (case-insensitive contains)
// 3. Keyword-based fallback
let productMappingCache: Map<string, string> | null = null;

export async function loadProductMappings(): Promise<Map<string, string>> {
  if (productMappingCache) return productMappingCache;

  const svc = getServiceSupabase();
  const { data, error } = await svc
    .from('product_mapping')
    .select('product_name, product_type');

  if (error) throw error;

  productMappingCache = new Map();
  for (const row of data || []) {
    productMappingCache.set(row.product_name.toLowerCase(), row.product_type);
  }
  return productMappingCache;
}

export function clearProductMappingCache() {
  productMappingCache = null;
}

export async function lookupProductType(productName: string): Promise<string> {
  const mappings = await loadProductMappings();
  const nameLower = productName.toLowerCase().trim();

  // 1. Exact match
  if (mappings.has(nameLower)) {
    return mappings.get(nameLower)!;
  }

  // 2. Fuzzy match — check if any mapping key is contained in product name or vice versa
  for (const [key, type] of mappings) {
    if (nameLower.includes(key) || key.includes(nameLower)) {
      return type;
    }
  }

  // 3. Keyword fallback
  const keywordMap: Record<string, string> = {
    'roove': 'Roove',
    'almona': 'Almona',
    'pluve': 'Pluve',
    'purvu': 'Purvu',
    'the secret': 'Purvu',
    'arabian': 'Purvu',
    'mediterranean': 'Purvu',
    'discovery set': 'Purvu',
    'drhyun': 'DrHyun',
    'dr hyun': 'DrHyun',
    'calmara': 'Calmara',
    'osgard': 'Osgard',
    'globite': 'Globite',
    'orelif': 'Orelif',
    'verazui': 'Verazui',
    'clola': 'YUV',
    'veminine': 'Veminine',
    'prime serum': 'Veminine',
    'shaker': 'Other',
    'brosur': 'Other',
    'jam tangan': 'Other',
    'baby gold': 'Other',
  };

  for (const [keyword, type] of Object.entries(keywordMap)) {
    if (nameLower.includes(keyword)) {
      return type;
    }
  }

  return 'Unknown';
}

// ── Fetch store list from Scalev API ──
export async function fetchStoreList(
  apiKey: string,
  baseUrl: string
): Promise<{ id: number; name: string; uuid: string }[]> {
  const allStores: { id: number; name: string; uuid: string }[] = [];
  let lastId = 0;
  let hasNext = true;

  while (hasNext) {
    let url = `${baseUrl}/stores?page_size=25`;
    if (lastId > 0) url += `&last_id=${lastId}`;

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      throw new Error(`Scalev API error ${res.status}: ${await res.text()}`);
    }

    const json = await res.json();
    if (json.code !== 200) {
      throw new Error(`Scalev API returned code ${json.code}: ${json.status}`);
    }

    const results = json.data?.results || [];
    for (const store of results) {
      allStores.push({
        id: store.id,
        name: store.name,
        uuid: store.uuid || '',
      });
    }

    hasNext = json.data?.has_next || false;
    lastId = json.data?.last_id || 0;
  }

  return allStores;
}

// ── Get all active businesses with API keys ──
export async function getBusinessConfigs(): Promise<{
  id: number;
  business_code: string;
  api_key: string;
  base_url: string;
}[]> {
  const svc = getServiceSupabase();
  const { data, error } = await svc
    .from('scalev_webhook_businesses')
    .select('id, business_code, api_key')
    .eq('is_active', true)
    .not('api_key', 'is', null);

  if (error) throw error;
  return (data || [])
    .filter(b => b.api_key)
    .map(b => ({
      id: b.id,
      business_code: b.business_code,
      api_key: b.api_key,
      base_url: 'https://api.scalev.id/v2',
    }));
}

// ── Parse order data into DB-ready format ──
export async function parseOrderForDb(order: any) {
  const salesChannel = deriveSalesChannel(order);
  const shippedTime = order.shipped_time || order.completed_time || null;
  const completedTime = order.completed_time || null;

  // Parse order header
  const orderHeader = {
    scalev_id: order.id,
    order_id: order.order_id,
    status: order.status || 'unknown',
    shipped_time: shippedTime,
    completed_time: completedTime,
    platform: order.platform || null,
    store_name: order.store?.name || null,
    utm_source: order.utm_source || null,
    financial_entity: order.financial_entity || null,
    payment_method: order.payment_method || null,
    unique_code_discount: order.unique_code_discount || 0,
    is_purchase_fb: order.is_purchase_fb || false,
    is_purchase_tiktok: order.is_purchase_tiktok || false,
    is_purchase_kwai: order.is_purchase_kwai || false,
    gross_revenue: order.gross_revenue || 0,
    net_revenue: order.net_revenue || 0,
    shipping_cost: order.shipping_cost || 0,
    total_quantity: order.total_quantity || 0,
    customer_name: order.customer_name || order.address?.name || null,
    customer_phone: order.customer_phone || order.address?.phone || null,
    customer_email: order.customer_email || null,
    raw_data: order,
    synced_at: new Date().toISOString(),
  };

  // Parse order lines (products in this order)
  const orderLines = [];
  const items = order.order_line || order.items || [];
  for (const item of items) {
    const productName = item.product?.name || item.product_name || 'Unknown';
    const productType = await lookupProductType(productName);

    orderLines.push({
      order_id: order.order_id,
      product_name: productName,
      product_type: productType,
      variant_sku: item.variant?.sku || item.sku || null,
      quantity: item.quantity || 1,
      product_price_bt: item.product_price_bt || item.price || 0,
      discount_bt: item.discount_bt || item.discount || 0,
      cogs_bt: item.cogs_bt || item.cogs || 0,
      tax_rate: 11.00,
      sales_channel: salesChannel,
      is_purchase_fb: order.is_purchase_fb || false,
      is_purchase_tiktok: order.is_purchase_tiktok || false,
      is_purchase_kwai: order.is_purchase_kwai || false,
      synced_at: new Date().toISOString(),
    });
  }

  return { orderHeader, orderLines, salesChannel };
}
