/**
 * Shared constants and types for both Excel and Google Sheets parsers.
 * Single source of truth for SKU mappings, channel names, and row layouts.
 */

// ── SKU sheet name → product name mapping ──
export const SKU_SHEETS: Record<string, string> = {
  'Roove': 'Roove',
  'Almona': 'Almona',
  'Pluve': 'Pluve',
  'YUV': 'Yuv',
  'Osgard': 'Osgard',
  'Purvu': 'Purvu',
  'DRHyun': 'Dr Hyun',
  'Globite': 'Globite',
  'Orelif': 'Orelif',
  'Veminine': 'Veminine',
  'Calmara': 'Calmara',
  'Other': 'Others',
};

// ── Channel names (order matters — maps to row indices) ──
export const CHANNELS = [
  'Facebook Ads', 'Google Ads', 'Organik', 'Reseller', 'Shopee',
  'TikTok Ads', 'TikTok Shop', 'Tokopedia', 'BliBli', 'Lazada', 'SnackVideo Ads',
] as const;

// ── Row layout offsets for SKU sheets ──
// These are 0-indexed row numbers within the sheet
export const SHEET_LAYOUT = {
  // Row containing dates (0-indexed)
  DATE_ROW: 2, // Sheet row 3

  // Net sales by channel section
  NET_SALES_START: 30, // Sheet row 31
  NET_SALES_END: 40,   // Sheet row 41

  // Gross profit by channel section
  GROSS_PROFIT_START: 56, // Sheet row 57
  GROSS_PROFIT_END: 66,   // Sheet row 67

  // Marketing cost section
  MKT_COST_START: 69, // Sheet row 70
  MKT_COST_END: 80,   // Sheet row 81

  // Net after marketing section
  NET_AFTER_MKT_START: 89, // Sheet row 90
  NET_AFTER_MKT_END: 100,  // Sheet row 101

  // Date columns range
  DATE_COL_START: 4,  // Column E
  DATE_COL_END: 35,   // Column AJ
} as const;

// ── Google Sheets uses different offsets since data is fetched from row 3 ──
// When fetching 'SheetName!A3:AI90', row 3 becomes index 0, so:
export const GSHEET_LAYOUT = {
  DATE_ROW: 0,          // Row 3 in sheet = index 0 in fetched array
  DATE_COL_START: 3,    // Column D (0-indexed from A)

  // Net sales section: sheet rows 31-41 → array index 28-38
  NET_SALES_START: 28,
  // Gross profit section: sheet rows 57-67 → array index 54-64
  GROSS_PROFIT_START: 54,
  // Marketing cost section: sheet rows 70-85 → array index 67-82
  MKT_COST_START: 67,
  MKT_COST_END: 82,
} as const;

// ── Shared parsed data interface ──
export interface ParsedData {
  dailyProduct: Array<{
    date: string;
    product: string;
    net_sales: number;
    gross_profit: number;
    net_after_mkt: number;
    mkt_cost: number;
  }>;
  dailyChannel: Array<{
    date: string;
    product: string;
    channel: string;
    net_sales: number;
    gross_profit: number;
  }>;
  ads: Array<{
    date: string;
    ad_account: string;
    spent: number;
    objective: string;
    source: string;
    store: string;
    advertiser: string;
  }>;
  monthlySummary: Array<{
    product: string;
    sales_after_disc: number;
    sales_pct: number;
    gross_profit: number;
    gross_profit_pct: number;
    gross_after_mkt: number;
    gmp_real: number;
    mkt_pct: number;
    mkt_share_pct: number;
  }>;
  period: { month: number; year: number };
}

// ── Shared utility functions ──

/**
 * Convert any value to a number, handling Indonesian formatting (dot as thousands separator).
 */
export function toNum(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/**
 * Convert Excel serial date number or Date object to ISO string (YYYY-MM-DD).
 */
export function excelDateToISO(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().split('T')[0];
  }
  if (typeof val === 'number') {
    // Excel serial date
    const d = new Date((val - 25569) * 86400000);
    return d.toISOString().split('T')[0];
  }
  if (typeof val === 'string') {
    if (val.match(/^\d{4}-\d{2}-\d{2}/)) return val.split('T')[0];
    // Google Sheets sometimes returns "M/D/YYYY" format
    const parts = val.split('/');
    if (parts.length === 3) {
      const m = parts[0].padStart(2, '0');
      const d = parts[1].padStart(2, '0');
      const y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
      return `${y}-${m}-${d}`;
    }
  }
  return null;
}

/**
 * Extract month and year from a date string (YYYY-MM-DD).
 */
export function extractPeriod(dateStr: string): { month: number; year: number } {
  const parts = dateStr.split('-');
  return { year: parseInt(parts[0]), month: parseInt(parts[1]) };
}

/**
 * Parse monthly summary rows (General sheet).
 * Works for both Excel cell access and Google Sheets array access.
 */
export function parseGeneralRow(values: {
  sku: any;
  salesAfterDisc: any;
  salesPct: any;
  grossProfit: any;
  grossProfitPct: any;
  grossAfterMkt: any;
  gmpReal: any;
  mktPct: any;
  mktSharePct: any;
}): ParsedData['monthlySummary'][0] | null {
  if (!values.sku) return null;
  return {
    product: String(values.sku),
    sales_after_disc: toNum(values.salesAfterDisc),
    sales_pct: toNum(values.salesPct) * 100,
    gross_profit: toNum(values.grossProfit),
    gross_profit_pct: toNum(values.grossProfitPct) * 100,
    gross_after_mkt: toNum(values.grossAfterMkt),
    gmp_real: toNum(values.gmpReal) * 100,
    mkt_pct: toNum(values.mktPct) * 100,
    mkt_share_pct: toNum(values.mktSharePct) * 100,
  };
}
