import { google } from 'googleapis';

// Initialize Google Sheets API with service account credentials
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return auth;
}

async function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

// ── Helper: Convert Google Sheets serial date to ISO string ──
function serialDateToISO(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400000);
    return d.toISOString().split('T')[0];
  }
  if (typeof val === 'string') {
    // Try parsing various date formats
    if (val.match(/^\d{4}-\d{2}-\d{2}/)) return val.split('T')[0];
    // Google Sheets sometimes returns "2/1/2026" format
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

function toNum(val: any): number {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ── Sheet name to product name mapping ──
const SKU_SHEETS: Record<string, string> = {
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

// Channel rows in SKU sheets (0-indexed from row 5 = index 4 in sheet, but 0 in array after we fetch from row 3)
const CHANNELS = [
  'Facebook Ads', 'Google Ads', 'Organik', 'Reseller', 'Shopee',
  'TikTok Ads', 'TikTok Shop', 'Tokopedia', 'BliBli', 'Lazada', 'SnackVideo Ads',
];

export interface ParsedSheetData {
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

// ── Fetch all sheet names from a spreadsheet ──
async function getSheetNames(spreadsheetId: string): Promise<string[]> {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return meta.data.sheets?.map(s => s.properties?.title || '') || [];
}

// ── Fetch a range from a sheet ──
async function fetchRange(spreadsheetId: string, range: string): Promise<any[][]> {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  return res.data.values || [];
}

// ── Main: Parse entire Google Sheet into database-ready format ──
export async function parseGoogleSheet(spreadsheetId: string): Promise<ParsedSheetData> {
  const sheetNames = await getSheetNames(spreadsheetId);

  let periodMonth = 0;
  let periodYear = 0;

  const dailyProduct: ParsedSheetData['dailyProduct'] = [];
  const dailyChannel: ParsedSheetData['dailyChannel'] = [];
  const ads: ParsedSheetData['ads'] = [];
  const monthlySummary: ParsedSheetData['monthlySummary'] = [];

  // ── Parse General sheet (monthly summary) ──
  if (sheetNames.includes('General')) {
    const rows = await fetchRange(spreadsheetId, 'General!B2:K15');
    // Row 0 = headers, rows 1-12 = SKU data, row 13 = Total
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0] || !row[1]) continue; // need No and SKU
      if (row[1] === 'Total') break;

      monthlySummary.push({
        product: String(row[1]),
        sales_after_disc: toNum(row[2]),
        sales_pct: toNum(row[3]) * 100,
        gross_profit: toNum(row[4]),
        gross_profit_pct: toNum(row[5]) * 100,
        gross_after_mkt: toNum(row[6]),
        gmp_real: toNum(row[7]) * 100,
        mkt_pct: toNum(row[8]) * 100,
        mkt_share_pct: toNum(row[9]) * 100,
      });
    }
  }

  // ── Parse SKU sheets ──
  for (const [sheetName, productName] of Object.entries(SKU_SHEETS)) {
    if (!sheetNames.includes(sheetName)) continue;

    // Fetch rows 3 to ~85 (dates in row 3, data below)
    // Row 3 = dates, Row 5-15 = Penjualan, Row 18-28 = Diskon, Row 31-41 = Penjualan Bersih
    // Row 44-54 = HPP, Row 57-67 = Laba Kotor, Row 70-85 = Biaya Marketing
    const rows = await fetchRange(spreadsheetId, `'${sheetName}'!A3:AI90`);
    if (!rows || rows.length === 0) continue;

    // Row 0 (sheet row 3) has dates starting from col D (index 3) onwards
    const dateRow = rows[0];
    const dates: Array<{ col: number; date: string }> = [];
    for (let c = 3; c < (dateRow?.length || 0); c++) {
      const d = serialDateToISO(dateRow[c]);
      if (d) {
        dates.push({ col: c, date: d });
        // Detect period from first date
        if (periodMonth === 0) {
          const parts = d.split('-');
          periodYear = parseInt(parts[0]);
          periodMonth = parseInt(parts[1]);
        }
      }
    }

    if (dates.length === 0) continue;

    // Parse channel-level data for each date
    // Net sales rows: row index 28-38 (sheet rows 31-41, 0-indexed from row 3 = 28-38)
    // Gross profit rows: row index 54-64 (sheet rows 57-67)
    // Marketing cost section starts at row index 67 (sheet row 70)

    for (const { col, date } of dates) {
      let totalNetSales = 0;
      let totalGP = 0;
      let totalMktCost = 0;

      // Net sales by channel: rows 31-41 in sheet = index 28-38 in our array
      for (let ch = 0; ch < CHANNELS.length; ch++) {
        const rowIdx = 28 + ch; // net sales section
        const gpRowIdx = 54 + ch; // gross profit section

        const netSales = toNum(rows[rowIdx]?.[col]);
        const gp = toNum(rows[gpRowIdx]?.[col]);

        totalNetSales += netSales;
        totalGP += gp;

        if (netSales !== 0 || gp !== 0) {
          dailyChannel.push({
            date,
            product: productName,
            channel: CHANNELS[ch],
            net_sales: netSales,
            gross_profit: gp,
          });
        }
      }

      // Marketing cost: rows 70-85 in sheet = index 67-82 in array
      // Sum all marketing rows for this product
      for (let mktRow = 67; mktRow <= 82 && mktRow < rows.length; mktRow++) {
        totalMktCost += toNum(rows[mktRow]?.[col]);
      }

      const netAfterMkt = totalGP - totalMktCost;

      if (totalNetSales !== 0 || totalGP !== 0) {
        dailyProduct.push({
          date,
          product: productName,
          net_sales: totalNetSales,
          gross_profit: totalGP,
          net_after_mkt: netAfterMkt,
          mkt_cost: totalMktCost,
        });
      }
    }
  }

  // ── Parse Ads sheet ──
  if (sheetNames.includes('Ads')) {
    const rows = await fetchRange(spreadsheetId, 'Ads!B3:I2000');
    // Row 0 = headers, data from row 1 onwards
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;

      const dateStr = serialDateToISO(row[0]);
      if (!dateStr) continue;

      ads.push({
        date: dateStr,
        ad_account: String(row[1] || ''),
        spent: toNum(row[2]),
        objective: String(row[3] || ''),
        source: String(row[4] || ''),
        store: String(row[6] || ''),
        advertiser: String(row[7] || ''),
      });
    }
  }

  return {
    dailyProduct,
    dailyChannel,
    ads,
    monthlySummary,
    period: { month: periodMonth, year: periodYear },
  };
}

// ── Test connection to a spreadsheet ──
export async function testSheetConnection(spreadsheetId: string): Promise<{
  success: boolean;
  sheetNames?: string[];
  error?: string;
}> {
  try {
    const sheetNames = await getSheetNames(spreadsheetId);
    return { success: true, sheetNames };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to connect' };
  }
}
