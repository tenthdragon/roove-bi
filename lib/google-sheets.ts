import { google } from 'googleapis';
import {
  type ParsedData,
  SKU_SHEETS,
  CHANNELS,
  GSHEET_LAYOUT,
  toNum,
  excelDateToISO,
  extractPeriod,
  parseGeneralRow,
} from './parser-shared';

// Re-export as ParsedSheetData for backward compatibility
export type ParsedSheetData = ParsedData;

// ── Google API helpers ──

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

async function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

async function getSheetNames(spreadsheetId: string): Promise<string[]> {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  return meta.data.sheets?.map(s => s.properties?.title || '') || [];
}

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
export async function parseGoogleSheet(spreadsheetId: string): Promise<ParsedData> {
  const sheetNames = await getSheetNames(spreadsheetId);

  let periodMonth = 0;
  let periodYear = 0;

  const dailyProduct: ParsedData['dailyProduct'] = [];
  const dailyChannel: ParsedData['dailyChannel'] = [];
  const ads: ParsedData['ads'] = [];
  const monthlySummary: ParsedData['monthlySummary'] = [];

  // ── Parse General sheet (monthly summary) ──
  if (sheetNames.includes('General')) {
    const rows = await fetchRange(spreadsheetId, 'General!B2:K15');
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0] || !row[1]) continue;
      if (row[1] === 'Total') break;

      const parsed = parseGeneralRow({
        sku: row[1],
        salesAfterDisc: row[2],
        salesPct: row[3],
        grossProfit: row[4],
        grossProfitPct: row[5],
        grossAfterMkt: row[6],
        gmpReal: row[7],
        mktPct: row[8],
        mktSharePct: row[9],
      });
      if (parsed) monthlySummary.push(parsed);
    }
  }

  // ── Parse SKU sheets ──
  for (const [sheetName, productName] of Object.entries(SKU_SHEETS)) {
    if (!sheetNames.includes(sheetName)) continue;

    const rows = await fetchRange(spreadsheetId, `'${sheetName}'!A3:AI90`);
    if (!rows || rows.length === 0) continue;

    // Row 0 (sheet row 3) has dates starting from col D (index 3)
    const dateRow = rows[GSHEET_LAYOUT.DATE_ROW];
    const dates: Array<{ col: number; date: string }> = [];
    for (let c = GSHEET_LAYOUT.DATE_COL_START; c < (dateRow?.length || 0); c++) {
      const d = excelDateToISO(dateRow[c]);
      if (d) {
        dates.push({ col: c, date: d });
        if (periodMonth === 0) {
          const period = extractPeriod(d);
          periodYear = period.year;
          periodMonth = period.month;
        }
      }
    }

    if (dates.length === 0) continue;

    for (const { col, date } of dates) {
      let totalNetSales = 0;
      let totalGP = 0;
      let totalMktCost = 0;

      // Net sales + gross profit by channel
      for (let ch = 0; ch < CHANNELS.length; ch++) {
        const rowIdx = GSHEET_LAYOUT.NET_SALES_START + ch;
        const gpRowIdx = GSHEET_LAYOUT.GROSS_PROFIT_START + ch;

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

      // Marketing cost
      for (let mktRow = GSHEET_LAYOUT.MKT_COST_START; mktRow <= GSHEET_LAYOUT.MKT_COST_END && mktRow < rows.length; mktRow++) {
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
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;

      const dateStr = excelDateToISO(row[0]);
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
