// lib/warehouse-parser.ts
// Parser for warehouse stock card (Kartu Stock) Google Sheets
// Handles Summary, Daily, and Mingguan (Stock Opname) sheets

import { google } from 'googleapis';

// ── Auth (same pattern as financial-parser.ts) ──

function getAuth() {
  const envKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!envKey || envKey.trim() === '') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set or empty');
  }
  let raw = envKey.trim();
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    raw = raw.slice(1, -1);
  }
  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY: ${e.message}`);
  }
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

async function getSheetData(spreadsheetId: string, range: string): Promise<any[][]> {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  return res.data.values || [];
}

async function getSpreadsheetInfo(spreadsheetId: string) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties.title,sheets.properties.title',
  });
  return {
    title: res.data.properties?.title || '',
    sheetNames: res.data.sheets?.map(s => s.properties?.title || '') || [],
  };
}

// ── Types ──

export interface WarehouseSummaryRow {
  product_name: string;
  category: string;
  first_day_stock: number;
  total_in: number;
  total_out: number;
  last_day_stock: number;
  expired_date: string | null;
  price_list: number;
  sub_total_value: number;
}

export interface WarehouseDailyRow {
  date: string;
  product_name: string;
  category: string;
  stock_in: number;
  stock_out: number;
}

export interface WarehouseSORow {
  opname_date: string;
  opname_label: string;
  product_name: string;
  category: string;
  sebelum_so: number;
  sesudah_so: number;
  selisih: number;
}

export interface WarehouseParseResult {
  warehouse: string;
  summary: WarehouseSummaryRow[];
  daily: WarehouseDailyRow[];
  stockOpname: WarehouseSORow[];
  period: { month: number; year: number };
  errors: string[];
}

// ── Helpers ──

function safeNum(val: any): number {
  if (val === null || val === undefined || val === '' || val === '-') return 0;
  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function excelDateToISO(serial: number): string | null {
  if (!serial || serial < 1000) return null;
  const d = new Date((serial - 25569) * 86400000);
  return d.toISOString().split('T')[0];
}

const ID_MONTHS: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

function detectPeriodFromTitle(title: string): { month: number; year: number } | null {
  // "KARTU STOCK RLB BTN - Februari 2026"
  const match = title.match(/(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+(\d{4})/i);
  if (match) {
    const m = ID_MONTHS[match[1].toLowerCase()];
    if (m) return { month: m, year: parseInt(match[2]) };
  }
  return null;
}

function detectWarehouseFromTitle(title: string): string {
  // "KARTU STOCK RLB BTN - Februari 2026" → "RLB BTN"
  const match = title.match(/KARTU\s+STOCK\s+(.+?)\s*-\s*/i);
  if (match) return match[1].trim();
  return 'Gudang';
}

function isCategoryHeader(row: any[]): boolean {
  // Category headers have text in some col but all numeric cols are empty or zero
  if (!row || row.length < 3) return false;
  const hasName = row[1] && typeof row[1] === 'string' && row[1].trim();
  if (!hasName) return false;
  // Check if row[0] is empty or non-numeric (categories don't have a row number)
  const noNumber = row[0] === '' || row[0] === undefined || row[0] === null;
  // Numeric columns (2-8) should all be empty
  const numericEmpty = [2, 3, 4, 5, 6, 7, 8].every(i =>
    row[i] === '' || row[i] === undefined || row[i] === null
  );
  return noNumber && numericEmpty;
}

function isEmptyRow(row: any[]): boolean {
  if (!row) return true;
  return row.every(c => c === '' || c === undefined || c === null);
}

// Known category names found in the Excel structure
const KNOWN_CATEGORIES = [
  'ROOVE BOX', 'ROOVE SACHET', 'PLUVE', 'YUV', 'OSGARD', 'GLOBITE',
  'CALMARA', 'SHAKER', 'DOMPET', 'AKSESORIS', 'MERCHANDISE', 'BONUS',
];

function detectCategory(name: string): string {
  const upper = name.toUpperCase().trim();
  for (const cat of KNOWN_CATEGORIES) {
    if (upper.includes(cat)) return cat;
  }
  return upper;
}

// ── Summary Sheet Parser ──

function parseSummaryData(
  data: any[][],
  period: { month: number; year: number },
): { summary: WarehouseSummaryRow[]; daily: WarehouseDailyRow[] } {
  if (!data || data.length < 2) return { summary: [], daily: [] };

  const headerRow = data[0] || [];
  const summary: WarehouseSummaryRow[] = [];
  const dailyMap = new Map<string, WarehouseDailyRow>();

  // Identify the daily column positions
  // After col 8 (SUB-TOTAL VALUE), we have day columns for IN, then day columns for OUT
  // Count how many day columns exist for IN (up to first repeated "1")
  const dayColStart = 9; // First daily column
  let inCols: { day: number; col: number }[] = [];
  let outCols: { day: number; col: number }[] = [];

  let seenFirstSet = false;
  let inSection = true;

  for (let i = dayColStart; i < headerRow.length; i++) {
    const h = headerRow[i];
    if (h === '' || h === undefined || h === null) continue;
    const dayNum = typeof h === 'number' ? h : parseInt(String(h));
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) continue;

    if (dayNum === 1 && seenFirstSet) {
      // We've hit the start of the OUT section
      inSection = false;
    }
    seenFirstSet = true;

    if (inSection) {
      inCols.push({ day: dayNum, col: i });
    } else {
      outCols.push({ day: dayNum, col: i });
    }
  }

  let currentCategory = '';

  for (let r = 1; r < data.length; r++) {
    const row = data[r] || [];

    // Skip empty rows
    if (isEmptyRow(row)) {
      continue;
    }

    // Check for category header row (text-only, appears before a group of products)
    // Category rows typically have text in col A or col B but no numeric data
    if (isCategoryHeader(row)) {
      currentCategory = detectCategory(String(row[1] || row[0] || ''));
      continue;
    }

    // Data row - must have a number in col 0 and product name in col 1
    const rowNum = row[0];
    const productName = String(row[1] || '').trim();
    if (!productName || (typeof rowNum !== 'number' && !String(rowNum).match(/^\d+$/))) continue;

    const firstDay = safeNum(row[2]);
    const totalIn = safeNum(row[3]);
    const totalOut = safeNum(row[4]);
    const lastDay = safeNum(row[5]);
    const expDate = typeof row[6] === 'number' ? excelDateToISO(row[6]) : null;
    const priceList = safeNum(row[7]);
    const subTotalValue = safeNum(row[8]);

    summary.push({
      product_name: productName,
      category: currentCategory,
      first_day_stock: firstDay,
      total_in: totalIn,
      total_out: totalOut,
      last_day_stock: lastDay,
      expired_date: expDate,
      price_list: priceList,
      sub_total_value: subTotalValue,
    });

    // Extract daily IN/OUT data
    for (const ic of inCols) {
      const inVal = safeNum(row[ic.col]);
      if (inVal === 0) {
        // Check if there's a corresponding OUT value
        const oc = outCols.find(o => o.day === ic.day);
        const outVal = oc ? safeNum(row[oc.col]) : 0;
        if (outVal === 0) continue; // Skip if both zero
      }
      const dateStr = `${period.year}-${String(period.month).padStart(2, '0')}-${String(ic.day).padStart(2, '0')}`;
      const oc = outCols.find(o => o.day === ic.day);
      const outVal = oc ? safeNum(row[oc.col]) : 0;
      const key = `${dateStr}|${productName}`;

      dailyMap.set(key, {
        date: dateStr,
        product_name: productName,
        category: currentCategory,
        stock_in: inVal,
        stock_out: outVal,
      });
    }

    // Also capture OUT-only days (days that have OUT but no IN column matched)
    for (const oc of outCols) {
      const dateStr = `${period.year}-${String(period.month).padStart(2, '0')}-${String(oc.day).padStart(2, '0')}`;
      const key = `${dateStr}|${productName}`;
      if (!dailyMap.has(key)) {
        const outVal = safeNum(row[oc.col]);
        if (outVal === 0) continue;
        dailyMap.set(key, {
          date: dateStr,
          product_name: productName,
          category: currentCategory,
          stock_in: 0,
          stock_out: outVal,
        });
      }
    }
  }

  return { summary, daily: Array.from(dailyMap.values()) };
}

// ── Mingguan (Stock Opname) Sheet Parser ──

function parseMingguanData(data: any[][], warehouse: string): WarehouseSORow[] {
  if (!data || data.length < 2) return [];

  const results: WarehouseSORow[] = [];
  let currentLabel = '';
  let currentDate = '';
  let currentCategory = '';

  for (let r = 0; r < data.length; r++) {
    const row = data[r] || [];
    if (isEmptyRow(row)) continue;

    // Detect SO event header: "RLB BTN - SO 311225 (RABU)" or similar
    const firstCell = String(row[0] || '').trim();
    const soMatch = firstCell.match(/SO\s+(\d{6})/i) ||
                    String(row[0] || row[1] || '').trim().match(/SO\s+(\d{6})/i);

    if (soMatch) {
      currentLabel = firstCell || String(row[0] || row[1] || '').trim();
      // Parse DDMMYY from "311225"
      const digits = soMatch[1];
      const dd = parseInt(digits.substring(0, 2));
      const mm = parseInt(digits.substring(2, 4));
      const yy = parseInt(digits.substring(4, 6));
      const yyyy = yy > 50 ? 1900 + yy : 2000 + yy;
      currentDate = `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
      currentCategory = '';
      continue;
    }

    // Skip header rows (NO, NAMA BARANG, SEBELUM SO, ...)
    if (String(row[0]).toUpperCase() === 'NO' || String(row[1]).toUpperCase().includes('NAMA BARANG')) {
      continue;
    }

    if (!currentDate) continue;

    // Detect category (text-only rows without numeric data)
    const nameVal = String(row[1] || '').trim();
    if (nameVal && (row[0] === '' || row[0] === undefined || row[0] === null)) {
      // Check if cols 2-4 are all empty/zero
      const isEmpty = [2, 3, 4].every(i =>
        row[i] === '' || row[i] === undefined || row[i] === null || row[i] === 0
      );
      if (isEmpty) {
        currentCategory = detectCategory(nameVal);
        continue;
      }
    }

    // Data row
    const rowNum = row[0];
    const productName = nameVal;
    if (!productName || (typeof rowNum !== 'number' && !String(rowNum).match(/^\d+$/))) continue;

    const sebelum = safeNum(row[2]);
    const sesudah = safeNum(row[3]);
    const selisih = safeNum(row[4]);

    results.push({
      opname_date: currentDate,
      opname_label: currentLabel,
      product_name: productName,
      category: currentCategory,
      sebelum_so: sebelum,
      sesudah_so: sesudah,
      selisih: selisih,
    });
  }

  return results;
}

// ── Find the Summary sheet name ──

function findSummarySheet(sheetNames: string[]): string | null {
  // Look for sheet matching "Summary *" pattern
  for (const name of sheetNames) {
    if (name.toLowerCase().startsWith('summary')) return name;
  }
  return null;
}

function findMingguanSheet(sheetNames: string[]): string | null {
  for (const name of sheetNames) {
    if (name.toLowerCase() === 'mingguan') return name;
  }
  return null;
}

// ── Main orchestrator ──

export async function parseWarehouseSheet(spreadsheetId: string): Promise<WarehouseParseResult> {
  const errors: string[] = [];

  // Get spreadsheet metadata
  const info = await getSpreadsheetInfo(spreadsheetId);
  const warehouse = detectWarehouseFromTitle(info.title);
  const period = detectPeriodFromTitle(info.title);

  if (!period) {
    throw new Error(
      `Tidak dapat mendeteksi periode dari judul spreadsheet: "${info.title}". ` +
      `Format yang diharapkan: "KARTU STOCK [GUDANG] - [Bulan] [Tahun]"`
    );
  }

  let summary: WarehouseSummaryRow[] = [];
  let daily: WarehouseDailyRow[] = [];
  let stockOpname: WarehouseSORow[] = [];

  // Parse Summary sheet
  const summarySheet = findSummarySheet(info.sheetNames);
  if (summarySheet) {
    try {
      const data = await getSheetData(spreadsheetId, `'${summarySheet}'!A1:BM200`);
      const result = parseSummaryData(data, period);
      summary = result.summary;
      daily = result.daily;
    } catch (e: any) {
      errors.push(`Summary: ${e.message}`);
    }
  } else {
    errors.push('Summary sheet not found');
  }

  // Parse Mingguan sheet
  const mingguanSheet = findMingguanSheet(info.sheetNames);
  if (mingguanSheet) {
    try {
      const data = await getSheetData(spreadsheetId, `'${mingguanSheet}'!A1:E1200`);
      stockOpname = parseMingguanData(data, warehouse);
    } catch (e: any) {
      errors.push(`Mingguan: ${e.message}`);
    }
  } else {
    errors.push('Mingguan sheet not found');
  }

  return { warehouse, summary, daily, stockOpname, period, errors };
}
