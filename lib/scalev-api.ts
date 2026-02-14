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
  pageSize: number = 1
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

// ── Derive sales_channel from order data ──
// Logic validated against spreadsheet data:
// - is_purchase_fb=true + platform=scalev → "Facebook Ads"
// - platform=shopee or store contains shopee → "Shopee"
// - platform=tiktok or store contains tiktok → "TikTok Shop"
// - platform=lazada or store contains lazada → "Lazada"
// - platform=tokopedia → "Tokopedia"
// - is_reseller → "Reseller"
// - platform=scalev + no ads → "Organik"
// - else → "Organik"
export function deriveSalesChannel(order: any): string {
  const platform = (order.platform || '').toLowerCase();
  const storeName = (order.store?.name || '').toLowerCase();
  const isPurchaseFb = order.is_purchase_fb || false;
  const isPurchaseTiktok = order.is_purchase_tiktok || false;

  // Marketplace detection (from platform or store name)
  if (platform === 'shopee' || storeName.includes('shopee')) {
    return 'Shopee';
  }
  if (platform === 'tiktok' || storeName.includes('tiktok')) {
    return 'TikTok Shop';
  }
  if (platform === 'lazada' || storeName.includes('lazada')) {
    return 'Lazada';
  }
  if (platform === 'tokopedia' || storeName.includes('tokopedia')) {
    return 'Tokopedia';
  }

  // Reseller detection
  if (order.is_reseller_product || order.reseller_transfer_status === 'pending') {
    return 'Reseller';
  }

  // Scalev platform orders: check if from paid ads
  if (platform === 'scalev' || platform === '') {
    if (isPurchaseFb) {
      return 'Facebook Ads';
    }
    if (isPurchaseTiktok) {
      return 'TikTok Ads';
    }
    return 'Organik';
  }

  return 'Organik';
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

// ── Parse order data into DB-ready format ──
export async function parseOrderForDb(order: any) {
  const salesChannel = deriveSalesChannel(order);
  const shippedTime = order.shipped_time || order.completed_time || null;

  // Parse order header
  const orderHeader = {
    scalev_id: order.id,
    order_id: order.order_id,
    status: order.status || 'unknown',
    shipped_time: shippedTime,
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
      shipped_time: shippedTime,
      sales_channel: salesChannel,
      is_purchase_fb: order.is_purchase_fb || false,
      is_purchase_tiktok: order.is_purchase_tiktok || false,
      is_purchase_kwai: order.is_purchase_kwai || false,
      synced_at: new Date().toISOString(),
    });
  }

  return { orderHeader, orderLines, salesChannel };
}
