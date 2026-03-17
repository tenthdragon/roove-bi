/**
 * Shared constants, types, and utilities for excel-parser.ts and google-sheets.ts.
 * Single source of truth — update here, both parsers pick it up.
 */

// ── Sales channels in order as they appear in brand sheets ──
export const SALES_CHANNELS = [
  'Scalev Ads', 'Google Ads', 'CS Manual', 'Reseller',
  'Shopee', 'CS Manual', 'TikTok Shop', 'Tokopedia',
  'BliBli', 'Lazada', 'SnackVideo Ads',
] as const;

// ── Shared number parser ──
export function toNum(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ── Unified date parser (handles Excel serial dates, ISO strings, M/D/Y strings) ──
export function parseDateValue(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().split('T')[0];
  }
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400000);
    return d.toISOString().split('T')[0];
  }
  if (typeof val === 'string') {
    if (val.match(/^\d{4}-\d{2}-\d{2}/)) return val.split('T')[0];
    // Handle slash-separated dates: Google Sheets returns M/D/Y (US locale),
    // but Scalev CSVs use DD/MM/YYYY (Indonesian locale).
    // We assume M/D/Y here since this parser is used for Google Sheets only.
    // CSV uploads use csv-actions.ts which has its own DD/MM/YYYY parser.
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

// ── Build brand sheet mapping from registered brands ──
export function buildBrandSheetMap(
  brandList: Array<{ name: string; sheet_name: string }>,
  sheetNames: string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const brand of brandList) {
    const match = sheetNames.find(
      s => s.toLowerCase() === brand.sheet_name.toLowerCase()
    );
    if (match) {
      result[match] = brand.name;
    }
  }
  return result;
}

// ── Shared parsed data types ──
export interface ParsedDailyProduct {
  date: string;
  product: string;
  net_sales: number;
  gross_profit: number;
  net_after_mkt: number;
  mkt_cost: number;
  mp_admin_cost?: number;
}

export interface ParsedDailyChannel {
  date: string;
  product: string;
  channel: string;
  net_sales: number;
  gross_profit: number;
  mp_admin_cost?: number;
  net_after_mkt?: number;
}

export interface ParsedAd {
  date: string;
  ad_account: string;
  spent: number;
  objective?: string;
  source: string;
  store: string;
  advertiser?: string;
}

export interface ParsedMonthlySummary {
  product: string;
  sales_after_disc: number;
  sales_pct: number;
  gross_profit: number;
  gross_profit_pct: number;
  gross_after_mkt: number;
  gmp_real: number;
  mkt_pct: number;
  mkt_share_pct: number;
}

export interface ParsedData {
  dailyProduct: ParsedDailyProduct[];
  dailyChannel: ParsedDailyChannel[];
  ads: ParsedAd[];
  monthlySummary: ParsedMonthlySummary[];
  period: { month: number; year: number };
}
