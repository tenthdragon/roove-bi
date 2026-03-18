// lib/meta-whatsapp.ts
// WhatsApp Business API (WABA) analytics client for pulling message spend data.
// Uses Graph API to fetch WABA-level analytics with daily breakdown.

import { DailyAdSpendRow } from './meta-marketing';
import { getYesterdayWIB } from './meta-marketing';

const GRAPH_API_VERSION = 'v21.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// ── Types ──

export interface WabaAccount {
  id: number;
  waba_id: string;
  waba_name: string;
  store: string;
  default_source: string;
  default_advertiser: string;
  is_active: boolean;
}

export interface WabaAnalyticsDataPoint {
  start: number;   // Unix timestamp
  end: number;      // Unix timestamp
  sent: number;
  delivered: number;
  cost: number;     // Cost in the WABA's currency
}

export interface WabaSyncResult {
  waba_id: string;
  waba_name: string;
  rows: DailyAdSpendRow[];
  error?: string;
}

// ── API Functions ──

/**
 * Fetch daily analytics for a single WABA.
 * Uses TWO separate API calls:
 *   1. `analytics` — for sent/delivered counts (granularity=DAY)
 *   2. `pricing_analytics` — for cost data (granularity=DAILY)
 * Then merges the results by day.
 */
export async function fetchWabaAnalytics(
  wabaId: string,
  dateStart: string,
  dateEnd: string,
  accessToken: string
): Promise<WabaAnalyticsDataPoint[]> {
  const startUnix = Math.floor(new Date(dateStart + 'T00:00:00Z').getTime() / 1000);
  const endDate = new Date(dateEnd + 'T00:00:00Z');
  endDate.setDate(endDate.getDate() + 1);
  const endUnix = Math.floor(endDate.getTime() / 1000);

  // ── Fetch message counts via analytics ──
  const analyticsField = [
    `analytics`,
    `.start(${startUnix})`,
    `.end(${endUnix})`,
    `.granularity(DAY)`,
    `.phone_numbers([])`,
    `.country_codes([])`,
    `.metric_types(["sent","delivered"])`,
  ].join('');

  // ── Fetch cost via pricing_analytics ──
  const pricingField = [
    `pricing_analytics`,
    `.start(${startUnix})`,
    `.end(${endUnix})`,
    `.granularity(DAILY)`,
    `.phone_numbers([])`,
    `.country_codes([])`,
    `.metric_types(["cost"])`,
  ].join('');

  const params = new URLSearchParams({
    access_token: accessToken,
    fields: `${analyticsField},${pricingField}`,
  });

  const url = `${GRAPH_API_BASE}/${wabaId}?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMsg = errorBody?.error?.message || response.statusText;
    throw new Error(`WABA API error for ${wabaId}: ${errorMsg}`);
  }

  const json = await response.json();

  // ── Parse message counts ──
  const countsByStart = new Map<number, { sent: number; delivered: number }>();
  const analyticsPoints = json?.analytics?.data_points || [];
  for (const p of analyticsPoints) {
    countsByStart.set(p.start, { sent: p.sent || 0, delivered: p.delivered || 0 });
  }

  // ── Parse cost (pricing_analytics.data[0].data_points) ──
  const costByStart = new Map<number, number>();
  const pricingData = json?.pricing_analytics?.data || [];
  for (const bucket of pricingData) {
    for (const p of bucket.data_points || []) {
      const prev = costByStart.get(p.start) || 0;
      costByStart.set(p.start, prev + (p.cost || 0));
    }
  }

  // ── Merge by start timestamp ──
  const allStarts = new Set([...countsByStart.keys(), ...costByStart.keys()]);
  const dataPoints: WabaAnalyticsDataPoint[] = [];

  for (const start of allStarts) {
    const counts = countsByStart.get(start) || { sent: 0, delivered: 0 };
    const cost = costByStart.get(start) || 0;
    dataPoints.push({
      start,
      end: start + 86400,
      sent: counts.sent,
      delivered: counts.delivered,
      cost,
    });
  }

  // Sort by date ascending
  dataPoints.sort((a, b) => a.start - b.start);
  return dataPoints;
}

/**
 * Map WABA analytics data points to daily_ads_spend row format.
 */
export function mapWabaToSpendRows(
  dataPoints: WabaAnalyticsDataPoint[],
  account: WabaAccount
): DailyAdSpendRow[] {
  return dataPoints
    .filter((dp) => dp.cost > 0 || dp.sent > 0)
    .map((dp) => {
      // Convert Unix timestamp to YYYY-MM-DD
      const date = new Date(dp.start * 1000).toISOString().split('T')[0];

      return {
        date,
        ad_account: account.waba_name,
        spent: dp.cost,
        impressions: dp.sent,
        cpm: dp.delivered,
        objective: 'Marketing Message',
        source: account.default_source,
        store: account.store,
        advertiser: account.default_advertiser,
        data_source: 'whatsapp_api',
      };
    });
}

/**
 * Fetch analytics for all active WABA accounts with rate limiting.
 */
export async function fetchAllWabaInsights(
  accounts: WabaAccount[],
  dateStart: string,
  dateEnd: string,
  accessToken: string
): Promise<WabaSyncResult[]> {
  const results: WabaSyncResult[] = [];

  for (const account of accounts) {
    try {
      const dataPoints = await fetchWabaAnalytics(
        account.waba_id,
        dateStart,
        dateEnd,
        accessToken
      );

      const rows = mapWabaToSpendRows(dataPoints, account);
      results.push({
        waba_id: account.waba_id,
        waba_name: account.waba_name,
        rows,
      });

      // Small delay between accounts to respect rate limits
      if (accounts.indexOf(account) < accounts.length - 1) {
        await sleep(500);
      }
    } catch (error: any) {
      console.error(`[meta-whatsapp] Failed for ${account.waba_id}:`, error.message);
      results.push({
        waba_id: account.waba_id,
        waba_name: account.waba_name,
        rows: [],
        error: error.message,
      });
    }
  }

  return results;
}

// ── Template CRUD ──

export interface MessageTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components: any[];
}

export interface CreateTemplatePayload {
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  components: any[];
}

export async function listMessageTemplates(
  wabaId: string,
  accessToken: string,
  after?: string
): Promise<{ data: MessageTemplate[]; paging: { after?: string } }> {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'name,status,category,language,components,id',
    limit: '50',
  });
  if (after) params.set('after', after);

  const url = `${GRAPH_API_BASE}/${wabaId}/message_templates?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody?.error?.message || response.statusText);
  }

  const json = await response.json();
  return {
    data: json.data || [],
    paging: { after: json.paging?.cursors?.after },
  };
}

export async function createMessageTemplate(
  wabaId: string,
  accessToken: string,
  payload: CreateTemplatePayload
): Promise<{ id: string; status: string; category: string }> {
  const url = `${GRAPH_API_BASE}/${wabaId}/message_templates`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      access_token: accessToken,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody?.error?.message || response.statusText);
  }

  return response.json();
}

export async function deleteMessageTemplate(
  wabaId: string,
  accessToken: string,
  hsmId: string,
  name: string
): Promise<{ success: boolean }> {
  const params = new URLSearchParams({
    access_token: accessToken,
    hsm_id: hsmId,
    name,
  });

  const url = `${GRAPH_API_BASE}/${wabaId}/message_templates?${params.toString()}`;
  const response = await fetch(url, { method: 'DELETE' });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody?.error?.message || response.statusText);
  }

  return response.json();
}

// Re-export for convenience
export { getYesterdayWIB };

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
