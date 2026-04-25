'use server';

import { createServiceSupabase } from './supabase-server';

export type MarketplaceWebhookQuarantineListItem = {
  id: number;
  createdAt: string | null;
  businessCode: string | null;
  eventType: string | null;
  orderId: string | null;
  externalId: string | null;
  scalevId: string | null;
  sourceClass: string | null;
  sourceClassReason: string | null;
  matchedScalevOrderId: number | null;
  reason: string;
  storeName: string | null;
  platform: string | null;
  financialEntity: string | null;
  status: string | null;
  payload: any;
};

export type MarketplaceWebhookQuarantineListResult = {
  items: MarketplaceWebhookQuarantineListItem[];
  summary: {
    total: number;
    unmatched: number;
    nonAuthoritativeMatch: number;
  };
};

function cleanText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function extractPayloadField(payload: any, key: string) {
  return payload?.data?.[key] ?? null;
}

function extractFinancialEntity(payload: any) {
  const value = extractPayloadField(payload, 'financial_entity');
  if (typeof value === 'string') return cleanText(value);
  if (value && typeof value === 'object') {
    return cleanText(value.name || value.code || null);
  }
  return null;
}

function extractStoreName(payload: any) {
  return cleanText(
    extractPayloadField(payload, 'store_name')
    ?? extractPayloadField(payload, 'store')?.name
    ?? null,
  );
}

export async function listMarketplaceWebhookQuarantine(params?: {
  limit?: number;
}) : Promise<MarketplaceWebhookQuarantineListResult> {
  const svc = createServiceSupabase();
  const limit = Math.min(Math.max(Number(params?.limit || 100), 1), 500);

  const { data, error } = await svc
    .from('scalev_marketplace_webhook_quarantine')
    .select('id, created_at, business_code, event_type, order_id, external_id, scalev_id, source_class, source_class_reason, matched_scalev_order_id, reason, payload')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message || 'Gagal memuat webhook quarantine marketplace.');
  }

  const items = (data || []).map((row: any) => ({
    id: Number(row.id),
    createdAt: row.created_at || null,
    businessCode: row.business_code || null,
    eventType: row.event_type || null,
    orderId: row.order_id || null,
    externalId: row.external_id || null,
    scalevId: row.scalev_id || null,
    sourceClass: row.source_class || null,
    sourceClassReason: row.source_class_reason || null,
    matchedScalevOrderId: row.matched_scalev_order_id ? Number(row.matched_scalev_order_id) : null,
    reason: row.reason || 'unknown',
    storeName: extractStoreName(row.payload),
    platform: cleanText(extractPayloadField(row.payload, 'platform')),
    financialEntity: extractFinancialEntity(row.payload),
    status: cleanText(extractPayloadField(row.payload, 'status')),
    payload: row.payload || null,
  }));

  const summary = {
    total: items.length,
    unmatched: items.filter((item) => item.reason === 'marketplace_webhook_unmatched').length,
    nonAuthoritativeMatch: items.filter((item) => item.reason === 'marketplace_webhook_non_authoritative_match').length,
  };

  return { items, summary };
}
