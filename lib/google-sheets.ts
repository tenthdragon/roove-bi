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
// FIXED: Use consistent names that match ads store names and product_mapping types
const SKU_SHEETS: Record<string, string> = {
  'Roove': 'Roove',
  'Almona': 'Almona',
  'Pluve': 'Pluve',
  'YUV': 'Yuv',
  'Osgard': 'Osgard',
  'Purvu': 'Purvu',
  'DRHyun': 'DrHyun',     // FIXED: was 'Dr Hyun' — now matches ads store name
  'Globite': 'Globite',
  'Orelif': 'Orelif',
  'Veminine': 'Veminine',
  'Calmara': 'Calmara',
  'Other': 'Other',         // FIXED: was 'Others' — now matches product_mapping
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

// Admin marketplace channels — offset from admin MP header row
const MP_ADMIN_CHANNEL_OFFSETS: Record<string, number> = {
  'Shopee': 1,
  'TikTok Shop': 2,
  'BliBli': 3,
  'Lazada': 4,
};

// FIXED: Detect format DYNAMICALLY by scanning rows for section headers.
// Different brand sheets have different numbers of marketing cost rows
// (Roove has 12 rows including WhatsApp & Shopee Live; others have 10),
// which shifts the position of "Biaya Adm Marketplace" and "Net After Mkt" sections.
// Old code hardcoded row 83, which only worked for Roove.
function detectSheetFormat(rows: any[][]) {
  // Scan rows 75-95 (array indices 72-92) for "Biaya Adm Marketplace"
  let mpAdminIdx = -1;
  for (let idx = 72; idx <= 92 && idx < rows.length; idx++) {
    const colB = rows[idx]?.[1];
    if (typeof colB === 'string' && colB.toLowerCase().includes('adm marketplace')) {
      mpAdminIdx = idx;
      break;
    }
  }

  if (mpAdminIdx >= 0) {
    // Found admin MP section — net_after_mkt header is typically 6 rows after admin header
    // (4 admin channels + 1 blank row + header row), then data starts next row
    // But let's also scan for the net_after_mkt header dynamically
    let namHeaderIdx = -1;
    for (let idx = mpAdminIdx + 4; idx <= mpAdminIdx + 10 && idx < rows.length; idx++) {
      const colB = rows[idx]?.[1];
      if (typeof colB === 'string' && colB.toLowerCase().includes('setelah biaya marketing')) {
        namHeaderIdx = idx;
        break;
      }
    }

    // Data starts right after the header, at the first channel row
    const netAfterMktDataIdx = namHeaderIdx >= 0 ? namHeaderIdx + 1 : mpAdminIdx + 6;

    return { hasMpAdmin: true, mpAdminBaseIdx: mpAdminIdx, netAfterMktDataIdx };
  } else {
    // No admin MP section (older format)
    // Scan for "Laba/(Rugi) Kotor Setelah" as fallback
    let namHeaderIdx = -1;
    for (let idx = 72; idx <= 92 && idx < rows.length; idx++) {
      const colB = rows[idx]?.[1];
      if (typeof colB === 'string' && colB.toLowerCase().includes('setelah biaya marketing')) {
        namHeaderIdx = idx;
        break;
      }
    }
    const netAfterMktDataIdx = namHeaderIdx >= 0 ? namHeaderIdx + 1 : 81;

    return { hasMpAdmin: false, mpAdminBaseIdx: -1, netAfterMktDataIdx };
  }
}

// Detect the net_after_mkt channel order dynamically for each sheet.
// Roove includes WhatsApp; other brands may not.
function detectNetAfterMktOrder(rows: any[][], startIdx: number): string[] {
  const channels: string[] = [];
  for (let idx = startIdx; idx < startIdx + 14 && idx < rows.length; idx++) {
    const colC = rows[idx]?.[2];
    if (!colC) break; // Empty row = end of section
    const ch = String(colC).trim();
    if (ch.toLowerCase() === 'total') break;
    channels.push(ch);
  }
  return channels.length > 0 ? channels : [
    // Fallback to default order
    'Facebook Ads', 'Google Ads', 'Organik', 'Reseller', 'Shopee',
    'TikTok Ads', 'TikTok Shop', 'Tokopedia', 'BliBli', 'Lazada', 'SnackVideo Ads',
  ];
}

export interface ParsedSheetData {
  dailyProduct: Array<{
    date: string; product: string; net_sales: number;
    gross_profit: number; net_after_mkt: number; mkt_cost: number;
  }>;
  dailyChannel: Array<{
    date: string; product: string; channel: string;
    net_sales: number; gross_profit: number;
    mp_admin_cost: number; net_after_mkt: number;
  }>;
  ads: Array<{
    date: string; ad_account: string; spent: number;
    objective: string; source: string; store: string; advertiser: string;
  }>;
  monthlySummary: Array<{
    product: string; sales_after_disc: number; sales_pct: number;
    gross_profit: number; gross_profit_pct: number;
    gross_after_mkt: number; gmp_real: number;
    mkt_pct: number; mkt_share_pct: number;
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

    const rows = await fetchRange(spreadsheetId, `'${sheetName}'!A3:AI120`);
    if (!rows || rows.length === 0) continue;

    // FIXED: Detect format dynamically per sheet (different brands have different layouts)
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

    // FIXED: Detect net_after_mkt channel order dynamically per sheet
    // (Roove has WhatsApp row; other brands don't — shifts all indices)
    const netAfterMktChannels = detectNetAfterMktOrder(rows, format.netAfterMktDataIdx);
    const netAfterMktMap: Record<string, number> = {};
    netAfterMktChannels.forEach((ch, i) => {
      netAfterMktMap[ch] = format.netAfterMktDataIdx + i;
    });

    for (const { col, date } of dates) {
      let totalNetSales = 0;
      let totalGP = 0;
      let totalMktCost = 0;
      let totalMpAdmin = 0;
      let totalNetAfterMkt = 0;

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

        // Get net after mkt for this channel
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

      // Marketing cost: starts at row 70 (index 67), scan until empty or next section
      for (let mktRow = 67; mktRow <= 78 && mktRow < rows.length; mktRow++) {
        totalMktCost += Math.abs(toNum(rows[mktRow]?.[col]));
      }

      // Net after mkt: sum all channels from sheet
      for (const ch of netAfterMktChannels) {
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
          mkt_cost: Math.round(totalMktCost + totalMpAdmin),
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
