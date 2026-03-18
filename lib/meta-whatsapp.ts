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

// ── Template Analytics ──

export interface TemplateAnalyticsMetrics {
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  replied: number;
  cost: number;
}

export interface TemplateAnalyticsResult {
  [templateId: string]: TemplateAnalyticsMetrics;
}

export interface TemplateAnalyticsDailyPoint {
  date: string; // YYYY-MM-DD
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  replied: number;
}

/**
 * Fetch per-template analytics (sent/delivered/read/clicked/replied) from Graph API.
 * Batches in groups of 10 (API limit).
 * Returns aggregated totals per template + daily breakdown.
 */
export async function fetchTemplateAnalytics(
  wabaId: string,
  accessToken: string,
  templateIds: string[],
  startDate: string,
  endDate: string
): Promise<{ byTemplate: TemplateAnalyticsResult; daily: TemplateAnalyticsDailyPoint[] }> {
  const startUnix = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000);
  const endUnix = Math.floor(new Date(endDate + 'T00:00:00Z').getTime() / 1000);

  const byTemplate: TemplateAnalyticsResult = {};
  const dailyMap: Record<string, TemplateAnalyticsDailyPoint> = {};

  // Batch in groups of 10 (API limit)
  for (let i = 0; i < templateIds.length; i += 10) {
    const batch = templateIds.slice(i, i + 10);

    // Use dot-notation field syntax (same pattern as fetchWabaAnalytics)
    const templateAnalyticsField = [
      `template_analytics`,
      `.start(${startUnix})`,
      `.end(${endUnix})`,
      `.granularity(DAILY)`,
      `.template_ids([${batch.join(',')}])`,
    ].join('');

    const params = new URLSearchParams({
      access_token: accessToken,
      fields: templateAnalyticsField,
    });

    const url = `${GRAPH_API_BASE}/${wabaId}?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMsg = errorBody?.error?.message || response.statusText;
      console.error(`[template_analytics] API error: ${errorMsg}`);
      if (i + 10 < templateIds.length) {
        await sleep(300);
      }
      continue;
    }

    const json = await response.json();
    const buckets = json?.template_analytics?.data || [];
    for (const bucket of buckets) {
      const dpList = bucket.data_points || [];
      for (const dp of dpList) {
        const tplId = String(dp.template_id);
        if (!tplId) continue;

        if (!byTemplate[tplId]) {
          byTemplate[tplId] = { sent: 0, delivered: 0, read: 0, clicked: 0, replied: 0, cost: 0 };
        }

        const metrics = byTemplate[tplId];
        metrics.sent += dp.sent || 0;
        metrics.delivered += dp.delivered || 0;
        metrics.read += dp.read || 0;
        metrics.replied += dp.replied || 0;

        // clicked is an array of button click objects with .total
        const totalClicked = Array.isArray(dp.clicked)
          ? dp.clicked.reduce((sum: number, c: any) => sum + (c.total || 0), 0)
          : (dp.clicked || 0);
        metrics.clicked += totalClicked;

        // Cost is an array of objects like [{type:"amount_spent", value:...}, ...]
        if (Array.isArray(dp.cost)) {
          const amountSpent = dp.cost.find((c: any) => c.type === 'amount_spent');
          if (amountSpent?.value) {
            metrics.cost += Number(amountSpent.value) || 0;
          }
        } else if (typeof dp.cost === 'number') {
          metrics.cost += dp.cost;
        }

        // Aggregate daily
        const date = new Date(dp.start * 1000).toISOString().split('T')[0];
        if (!dailyMap[date]) {
          dailyMap[date] = { date, sent: 0, delivered: 0, read: 0, clicked: 0, replied: 0 };
        }
        dailyMap[date].sent += dp.sent || 0;
        dailyMap[date].delivered += dp.delivered || 0;
        dailyMap[date].read += dp.read || 0;
        dailyMap[date].clicked += totalClicked;
        dailyMap[date].replied += dp.replied || 0;
      }
    }

    // Rate limit between batches
    if (i + 10 < templateIds.length) {
      await sleep(300);
    }
  }

  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
  return { byTemplate, daily };
}

// ── Template Analytics (Raw for DB Storage) ──

export interface TemplateAnalyticsDailyRow {
  template_id: string;
  date: string; // YYYY-MM-DD
  sent: number;
  delivered: number;
  read: number;
  clicked: number;
  replied: number;
  cost: number;
}

/**
 * Fetch per-template daily analytics and return flat rows ready for DB upsert.
 * One row per (template_id, date) combination.
 * Batches in groups of 10 (API limit), 300ms delay between batches.
 */
export async function fetchTemplateAnalyticsRaw(
  wabaId: string,
  accessToken: string,
  templateIds: string[],
  startDate: string,
  endDate: string
): Promise<TemplateAnalyticsDailyRow[]> {
  const startUnix = Math.floor(new Date(startDate + 'T00:00:00Z').getTime() / 1000);
  const endUnix = Math.floor(new Date(endDate + 'T00:00:00Z').getTime() / 1000);

  // Map keyed by "templateId|date" for dedup/aggregation
  const rowMap = new Map<string, TemplateAnalyticsDailyRow>();

  for (let i = 0; i < templateIds.length; i += 10) {
    const batch = templateIds.slice(i, i + 10);

    const templateAnalyticsField = [
      `template_analytics`,
      `.start(${startUnix})`,
      `.end(${endUnix})`,
      `.granularity(DAILY)`,
      `.template_ids([${batch.join(',')}])`,
    ].join('');

    const params = new URLSearchParams({
      access_token: accessToken,
      fields: templateAnalyticsField,
    });

    const url = `${GRAPH_API_BASE}/${wabaId}?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMsg = errorBody?.error?.message || response.statusText;
      console.error(`[template_analytics_raw] API error: ${errorMsg}`);
      if (i + 10 < templateIds.length) await sleep(300);
      continue;
    }

    const json = await response.json();
    const buckets = json?.template_analytics?.data || [];

    for (const bucket of buckets) {
      for (const dp of bucket.data_points || []) {
        const tplId = String(dp.template_id);
        if (!tplId) continue;

        const date = new Date(dp.start * 1000).toISOString().split('T')[0];
        const key = `${tplId}|${date}`;

        const existing = rowMap.get(key);
        const totalClicked = Array.isArray(dp.clicked)
          ? dp.clicked.reduce((sum: number, c: any) => sum + (c.total || 0), 0)
          : (dp.clicked || 0);

        let costAmount = 0;
        if (Array.isArray(dp.cost)) {
          const amountSpent = dp.cost.find((c: any) => c.type === 'amount_spent');
          if (amountSpent?.value) costAmount = Number(amountSpent.value) || 0;
        } else if (typeof dp.cost === 'number') {
          costAmount = dp.cost;
        }

        if (existing) {
          existing.sent += dp.sent || 0;
          existing.delivered += dp.delivered || 0;
          existing.read += dp.read || 0;
          existing.clicked += totalClicked;
          existing.replied += dp.replied || 0;
          existing.cost += costAmount;
        } else {
          rowMap.set(key, {
            template_id: tplId,
            date,
            sent: dp.sent || 0,
            delivered: dp.delivered || 0,
            read: dp.read || 0,
            clicked: totalClicked,
            replied: dp.replied || 0,
            cost: costAmount,
          });
        }
      }
    }

    if (i + 10 < templateIds.length) await sleep(300);
  }

  return Array.from(rowMap.values());
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
