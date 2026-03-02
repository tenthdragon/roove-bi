// lib/meta-marketing.ts
// Meta Marketing API client for pulling ad spend data.
// Uses Graph API v21.0 to fetch account-level insights with daily breakdown.

const META_API_VERSION = 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// ── Types ──

export interface MetaAdAccount {
  id: number;
  account_id: string;       // act_xxx
  account_name: string;
  store: string;
  default_source: string;
  default_advertiser: string;
  is_active: boolean;
}

export interface MetaInsight {
  date_start: string;       // YYYY-MM-DD
  date_stop: string;
  spend: string;            // string from Meta API, needs parseFloat
  impressions?: string;     // string from Meta API
  cpm?: string;             // string from Meta API (cost per 1000 impressions)
  objective?: string;
  campaign_name?: string;
  account_name?: string;
}

export interface DailyAdSpendRow {
  date: string;
  ad_account: string;
  spent: number;
  impressions: number;
  cpm: number;
  objective: string;
  source: string;
  store: string;
  advertiser: string;
  data_source: string;
}

export interface MetaSyncResult {
  account_id: string;
  account_name: string;
  rows: DailyAdSpendRow[];
  error?: string;
}

// ── API Functions ──

/**
 * Fetch daily insights for a single Meta Ad Account.
 * Uses level=account with time_increment=1 for daily breakdown.
 */
export async function fetchAccountInsights(
  accountId: string,
  dateStart: string,
  dateEnd: string,
  accessToken: string
): Promise<MetaInsight[]> {
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'spend,impressions,cpm,objective,campaign_name,account_name',
    level: 'account',
    time_increment: '1',
    time_range: JSON.stringify({
      since: dateStart,
      until: dateEnd,
    }),
  });

  const url = `${META_API_BASE}/${accountId}/insights?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMsg = errorBody?.error?.message || response.statusText;
    throw new Error(`Meta API error for ${accountId}: ${errorMsg}`);
  }

  const json = await response.json();
  const insights: MetaInsight[] = [];

  // Handle pagination
  let data = json;
  while (data?.data) {
    insights.push(...data.data);
    if (data.paging?.next) {
      const nextResponse = await fetch(data.paging.next);
      if (!nextResponse.ok) break;
      data = await nextResponse.json();
    } else {
      break;
    }
  }

  return insights;
}

/**
 * Map Meta API insights to daily_ads_spend row format.
 */
function mapInsightsToRows(
  insights: MetaInsight[],
  account: MetaAdAccount
): DailyAdSpendRow[] {
  return insights
    .filter((insight) => {
      const spend = parseFloat(insight.spend || '0');
      return spend > 0;
    })
    .map((insight) => ({
      date: insight.date_start,
      ad_account: account.account_name,
      spent: parseFloat(insight.spend),
      impressions: parseInt(insight.impressions || '0', 10),
      cpm: parseFloat(insight.cpm || '0'),
      objective: insight.objective || 'Unknown',
      source: account.default_source,
      store: account.store,
      advertiser: account.default_advertiser,
      data_source: 'meta_api',
    }));
}

/**
 * Fetch insights for all active Meta Ad Accounts with rate limiting.
 * Meta API allows ~200 calls/hour per ad account, so we add small delays.
 */
export async function fetchAllAccountsInsights(
  accounts: MetaAdAccount[],
  dateStart: string,
  dateEnd: string,
  accessToken: string
): Promise<MetaSyncResult[]> {
  const results: MetaSyncResult[] = [];

  for (const account of accounts) {
    try {
      const insights = await fetchAccountInsights(
        account.account_id,
        dateStart,
        dateEnd,
        accessToken
      );

      const rows = mapInsightsToRows(insights, account);
      results.push({
        account_id: account.account_id,
        account_name: account.account_name,
        rows,
      });

      // Small delay between accounts to respect rate limits
      if (accounts.indexOf(account) < accounts.length - 1) {
        await sleep(500);
      }
    } catch (error: any) {
      console.error(`[meta-marketing] Failed for ${account.account_id}:`, error.message);
      results.push({
        account_id: account.account_id,
        account_name: account.account_name,
        rows: [],
        error: error.message,
      });
    }
  }

  return results;
}

// ── Token Management ──

/**
 * Check if a Meta access token is still valid and get its expiry info.
 * Returns null if token is invalid.
 */
export async function debugToken(
  accessToken: string,
  appId: string,
  appSecret: string
): Promise<{ is_valid: boolean; expires_at: number; scopes: string[] } | null> {
  try {
    const params = new URLSearchParams({
      input_token: accessToken,
      access_token: `${appId}|${appSecret}`,
    });
    const url = `${META_API_BASE}/debug_token?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    const json = await response.json();
    return json.data || null;
  } catch {
    return null;
  }
}

/**
 * Exchange a long-lived token for a new long-lived token.
 * Long-lived tokens last ~60 days. Call this before expiry to refresh.
 */
export async function refreshLongLivedToken(
  currentToken: string,
  appId: string,
  appSecret: string
): Promise<{ access_token: string; expires_in: number } | null> {
  try {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: currentToken,
    });
    const url = `${META_API_BASE}/oauth/access_token?${params.toString()}`;
    const response = await fetch(url);
    if (!response.ok) return null;

    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Check token health and return a warning if it's expiring soon.
 * Returns null if token is healthy (>7 days until expiry).
 */
export async function checkTokenHealth(
  accessToken: string,
  appId: string,
  appSecret: string
): Promise<{ warning: string; expires_at: Date } | null> {
  const info = await debugToken(accessToken, appId, appSecret);
  if (!info) {
    return { warning: 'Token is invalid or expired', expires_at: new Date() };
  }
  if (!info.is_valid) {
    return { warning: 'Token is no longer valid', expires_at: new Date(info.expires_at * 1000) };
  }

  const expiresAt = new Date(info.expires_at * 1000);
  const daysUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);

  if (daysUntilExpiry < 7) {
    return {
      warning: `Token expires in ${Math.ceil(daysUntilExpiry)} day(s). Please refresh it.`,
      expires_at: expiresAt,
    };
  }

  return null;
}

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get yesterday's date in YYYY-MM-DD format (WIB timezone).
 * Used as default date range for daily sync.
 */
export function getYesterdayWIB(): string {
  const now = new Date();
  // WIB = UTC+7
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  wib.setDate(wib.getDate() - 1);
  return wib.toISOString().split('T')[0];
}
