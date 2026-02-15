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
    if (val.match(/^\d{4}-\d{2}-\d{2}/)) return val.split('T')[0];
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

// Sales channels in order as they appear in sheet (rows 31-41 net sales, rows 57-67 gross profit)
const SHEET_CHANNELS = [
  'Facebook Ads', 'Google Ads', 'Organik', 'Reseller', 'Shopee',
  'TikTok Ads', 'TikTok Shop', 'Tokopedia', 'BliBli', 'Lazada', 'SnackVideo Ads',
];

// Merge map: sheet channel name → database channel name
// Channels not listed here keep their original name
const CHANNEL_MERGE: Record<string, string> = {
  'TikTok Ads': 'TikTok',
  'TikTok Shop': 'TikTok',
};

function resolveChannel(sheetChannel: string): string {
  return CHANNEL_MERGE[sheetChannel] || sheetChannel;
}

// Admin marketplace channels (only present in newer format, Feb 2026+)
// Mapping: sheet channel name → offset from admin MP header row
const MP_ADMIN_CHANNEL_OFFSETS: Record<string, number> = {
  'Shopee': 1,
  'TikTok Shop': 2,
  'BliBli': 3,
  'Lazada': 4,
};

// Net after mkt channels - order in sheet (same for both formats)
// WhatsApp is included in sheet but not in SHEET_CHANNELS array
const NET_AFTER_MKT_ORDER = [
  'Facebook Ads', 'WhatsApp', 'Google Ads', 'Organik', 'Reseller', 'Shopee',
  'TikTok Ads', 'TikTok Shop', 'Tokopedia', 'BliBli', 'Lazada', 'SnackVideo Ads',
];

// Detect format: check if row 83 (array index 80) col B contains "Biaya Adm Marketplace"
// Returns: { hasMpAdmin, mpAdminBaseIdx, netAfterMktBaseIdx }
function detectSheetFormat(rows: any[][]) {
  // Array index 80 = sheet row 83 (fetched from row 3, so 83 - 3 = 80)
  const row80ColB = rows[80]?.[1]; // col B
  const hasMpAdmin = typeof row80ColB === 'string' &&
    row80ColB.toLowerCase().includes('adm marketplace');

  if (hasMpAdmin) {
    // Feb 2026+ format: admin MP at row 83 (idx 80), net_after_mkt header at row 89 (idx 86), data starts row 90 (idx 87)
    return { hasMpAdmin: true, mpAdminBaseIdx: 80, netAfterMktDataIdx: 87 };
  } else {
    // Nov 2025 format: no admin MP, net_after_mkt header at row 83 (idx 80), data starts row 84 (idx 81)
    return { hasMpAdmin: false, mpAdminBaseIdx: -1, netAfterMktDataIdx: 81 };
  }
}

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
    mp_admin_cost: number;
    net_after_mkt: number;
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
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0] || !row[1]) continue;
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

    // Fetch rows 3 to 120 (expanded to include admin MP and net after mkt sections)
    // Row 3 = dates
    // Rows 31-41 = Penjualan Bersih (net sales per channel)
    // Rows 57-67 = Laba Kotor (gross profit per channel)
    // Rows 70-81 = Biaya Marketing
    // Rows 83-87 = Biaya Adm Marketplace (Shopee, TikTok Shop, BliBli, Lazada)
    // Rows 89-101 = Laba/(Rugi) Kotor Setelah Biaya Marketing & Admin Marketplace
    const rows = await fetchRange(spreadsheetId, `'${sheetName}'!A3:AI120`);
    if (!rows || rows.length === 0) continue;

    // Detect format (with or without admin marketplace section)
    const format = detectSheetFormat(rows);

    // Row 0 (sheet row 3) has dates starting from col D (index 3) onwards
    const dateRow = rows[0];
    const dates: Array<{ col: number; date: string }> = [];
    for (let c = 3; c < (dateRow?.length || 0); c++) {
      const d = serialDateToISO(dateRow[c]);
      if (d) {
        dates.push({ col: c, date: d });
        if (periodMonth === 0) {
          const parts = d.split('-');
          periodYear = parseInt(parts[0]);
          periodMonth = parseInt(parts[1]);
        }
      }
    }

    if (dates.length === 0) continue;

    // Build net_after_mkt channel index map
    const netAfterMktMap: Record<string, number> = {};
    NET_AFTER_MKT_ORDER.forEach((ch, i) => {
      netAfterMktMap[ch] = format.netAfterMktDataIdx + i;
    });

    for (const { col, date } of dates) {
      let totalNetSales = 0;
      let totalGP = 0;
      let totalMktCost = 0;
      let totalMpAdmin = 0;
      let totalNetAfterMkt = 0;

      // ── Read all sheet channels, then merge before pushing ──
      // Net sales: sheet rows 31-41 → array index 28-38
      // Gross profit: sheet rows 57-67 → array index 54-64
      const channelBucket: Record<string, { ns: number; gp: number; mpAdmin: number; nam: number }> = {};

      for (let ch = 0; ch < SHEET_CHANNELS.length; ch++) {
        const nsRowIdx = 28 + ch;
        const gpRowIdx = 54 + ch;

        const netSales = toNum(rows[nsRowIdx]?.[col]);
        const gp = toNum(rows[gpRowIdx]?.[col]);

        totalNetSales += netSales;
        totalGP += gp;

        // Get admin marketplace cost for this channel (if format has it)
        let mpAdmin = 0;
        if (format.hasMpAdmin) {
          const offset = MP_ADMIN_CHANNEL_OFFSETS[SHEET_CHANNELS[ch]];
          if (offset !== undefined) {
            mpAdmin = Math.abs(toNum(rows[format.mpAdminBaseIdx + offset]?.[col]));
          }
        }
        totalMpAdmin += mpAdmin;

        // Get net after mkt for this channel from the sheet directly
        const namRowIdx = netAfterMktMap[SHEET_CHANNELS[ch]];
        const netAfterMktChannel = namRowIdx !== undefined && namRowIdx < rows.length
          ? toNum(rows[namRowIdx]?.[col]) : 0;

        // Merge into resolved channel name (e.g. TikTok Ads + TikTok Shop → TikTok)
        const resolved = resolveChannel(SHEET_CHANNELS[ch]);
        if (!channelBucket[resolved]) channelBucket[resolved] = { ns: 0, gp: 0, mpAdmin: 0, nam: 0 };
        channelBucket[resolved].ns += netSales;
        channelBucket[resolved].gp += gp;
        channelBucket[resolved].mpAdmin += mpAdmin;
        channelBucket[resolved].nam += netAfterMktChannel;
      }

      // Push merged channels to dailyChannel
      for (const [channel, v] of Object.entries(channelBucket)) {
        if (v.ns !== 0 || v.gp !== 0) {
          dailyChannel.push({
            date,
            product: productName,
            channel,
            net_sales: v.ns,
            gross_profit: v.gp,
            mp_admin_cost: v.mpAdmin,
            net_after_mkt: v.nam,
          });
        }
      }

      // ── Marketing cost: sheet rows 70-81 → array index 67-78 ──
      for (let mktRow = 67; mktRow <= 78 && mktRow < rows.length; mktRow++) {
        totalMktCost += Math.abs(toNum(rows[mktRow]?.[col]));
      }

      // ── Net after mkt: sum all channels from sheet ──
      for (const ch of NET_AFTER_MKT_ORDER) {
        const rowIdx = netAfterMktMap[ch];
        if (rowIdx !== undefined && rowIdx < rows.length) {
          totalNetAfterMkt += toNum(rows[rowIdx]?.[col]);
        }
      }

      if (totalNetSales !== 0 || totalGP !== 0 || totalMktCost !== 0) {
        dailyProduct.push({
          date,
          product: productName,
          net_sales: Math.round(totalNetSales),
          gross_profit: Math.round(totalGP),
          net_after_mkt: Math.round(totalNetAfterMkt),
          mkt_cost: Math.round(totalMktCost + totalMpAdmin), // mkt_cost now includes admin MP
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
