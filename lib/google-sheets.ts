import { google } from 'googleapis';

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

// Sales channels in order as they appear in sheet
const SHEET_CHANNELS = [
  'Facebook Ads', 'Google Ads', 'Organik', 'Reseller',
  'Shopee', 'TikTok Ads', 'TikTok Shop', 'Tokopedia',
  'BliBli', 'Lazada', 'SnackVideo Ads',
];

const CHANNEL_MERGE: Record<string, string> = {
  'TikTok Ads': 'TikTok',
  'TikTok Shop': 'TikTok',
};

function resolveChannel(sheetChannel: string): string {
  return CHANNEL_MERGE[sheetChannel] || sheetChannel;
}

const MP_ADMIN_CHANNEL_OFFSETS: Record<string, number> = {
  'Shopee': 1,
  'TikTok Shop': 2,
  'BliBli': 3,
  'Lazada': 4,
};

function detectSheetFormat(rows: any[][]) {
  let mpAdminIdx = -1;
  for (let idx = 72; idx <= 92 && idx < rows.length; idx++) {
    const colB = rows[idx]?.[1];
    if (typeof colB === 'string' && colB.toLowerCase().includes('adm marketplace')) {
      mpAdminIdx = idx;
      break;
    }
  }

  if (mpAdminIdx >= 0) {
    let namHeaderIdx = -1;
    for (let idx = mpAdminIdx + 4; idx <= mpAdminIdx + 10 && idx < rows.length; idx++) {
      const colB = rows[idx]?.[1];
      if (typeof colB === 'string' && colB.toLowerCase().includes('setelah biaya marketing')) {
        namHeaderIdx = idx;
        break;
      }
    }
    const netAfterMktDataIdx = namHeaderIdx >= 0 ? namHeaderIdx + 1 : mpAdminIdx + 6;
    return { hasMpAdmin: true, mpAdminBaseIdx: mpAdminIdx, netAfterMktDataIdx };
  } else {
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

function detectNetAfterMktOrder(rows: any[][], startIdx: number): string[] {
  const channels: string[] = [];
  for (let idx = startIdx; idx < startIdx + 14 && idx < rows.length; idx++) {
    const colC = rows[idx]?.[2];
    if (!colC) break;
    const ch = String(colC).trim();
    if (ch.toLowerCase() === 'total') break;
    channels.push(ch);
  }
  return channels.length > 0 ? channels : [
    'Facebook Ads', 'Google Ads', 'Organik', 'Reseller',
    'Shopee', 'TikTok Ads', 'TikTok Shop', 'Tokopedia',
    'BliBli', 'Lazada', 'SnackVideo Ads',
  ];
}

export interface ParsedSheetData {
  dailyProduct: Array<{
    date: string; product: string; net_sales: number; gross_profit: number;
    net_after_mkt: number; mkt_cost: number; mp_admin_cost: number;
  }>;
  dailyChannel: Array<{
    date: string; product: string; channel: string; net_sales: number;
    gross_profit: number; mp_admin_cost: number; net_after_mkt: number;
  }>;
  ads: Array<{
    date: string; ad_account: string; spent: number; objective: string;
    source: string; store: string; advertiser: string;
  }>;
  monthlySummary: Array<{
    product: string; sales_after_disc: number; sales_pct: number;
    gross_profit: number; gross_profit_pct: number; gross_after_mkt: number;
    gmp_real: number; mkt_pct: number; mkt_share_pct: number;
  }>;
  period: { month: number; year: number };
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

// ── Build brand sheet mapping from registered brands ──
function buildBrandSheetMap(
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

// ── Main parser — now takes brandList parameter ──
export async function parseGoogleSheet(
  spreadsheetId: string,
  brandList: Array<{ name: string; sheet_name: string }>,
): Promise<ParsedSheetData> {
  // Defensive guard — prevents cryptic "e is not iterable" in production
  if (!brandList || !Array.isArray(brandList)) {
    throw new Error('brandList is required — pass the active brands array from the database');
  }
  const sheetNames = await getSheetNames(spreadsheetId);

  let periodMonth = 0;
  let periodYear = 0;

  const dailyProduct: ParsedSheetData['dailyProduct'] = [];
  const dailyChannel: ParsedSheetData['dailyChannel'] = [];
  const ads: ParsedSheetData['ads'] = [];
  const monthlySummary: ParsedSheetData['monthlySummary'] = [];

  // ── Build brand sheets from registered brands ──
  const brandSheets = buildBrandSheetMap(brandList, sheetNames);

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

  // ── Parse brand sheets ──
  for (const [sheetName, productName] of Object.entries(brandSheets)) {
    const rows = await fetchRange(spreadsheetId, `'${sheetName}'!A3:AI120`);
    if (!rows || rows.length === 0) continue;

    const format = detectSheetFormat(rows);

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

      const channelBucket: Record<string, { ns: number; gp: number; mpAdmin: number; nam: number }> = {};

      for (let ch = 0; ch < SHEET_CHANNELS.length; ch++) {
        const nsRowIdx = 28 + ch;
        const gpRowIdx = 54 + ch;
        const netSales = toNum(rows[nsRowIdx]?.[col]);
        const gp = toNum(rows[gpRowIdx]?.[col]);

        totalNetSales += netSales;
        totalGP += gp;

        let mpAdmin = 0;
        if (format.hasMpAdmin) {
          const offset = MP_ADMIN_CHANNEL_OFFSETS[SHEET_CHANNELS[ch]];
          if (offset !== undefined) {
            mpAdmin = Math.abs(toNum(rows[format.mpAdminBaseIdx + offset]?.[col]));
          }
        }
        totalMpAdmin += mpAdmin;

        const namRowIdx = netAfterMktMap[SHEET_CHANNELS[ch]];
        const netAfterMktChannel = namRowIdx !== undefined && namRowIdx < rows.length
          ? toNum(rows[namRowIdx]?.[col]) : 0;

        const resolved = resolveChannel(SHEET_CHANNELS[ch]);
        if (!channelBucket[resolved]) channelBucket[resolved] = { ns: 0, gp: 0, mpAdmin: 0, nam: 0 };
        channelBucket[resolved].ns += netSales;
        channelBucket[resolved].gp += gp;
        channelBucket[resolved].mpAdmin += mpAdmin;
        channelBucket[resolved].nam += netAfterMktChannel;
      }

      for (const [channel, v] of Object.entries(channelBucket)) {
        if (v.ns !== 0 || v.gp !== 0) {
          dailyChannel.push({
            date, product: productName, channel,
            net_sales: v.ns, gross_profit: v.gp,
            mp_admin_cost: v.mpAdmin, net_after_mkt: v.nam,
          });
        }
      }

      for (let mktRow = 67; mktRow <= 78 && mktRow < rows.length; mktRow++) {
        totalMktCost += Math.abs(toNum(rows[mktRow]?.[col]));
      }

      for (const ch of netAfterMktChannels) {
        const rowIdx = netAfterMktMap[ch];
        if (rowIdx !== undefined && rowIdx < rows.length) {
          totalNetAfterMkt += toNum(rows[rowIdx]?.[col]);
        }
      }

      if (totalNetSales !== 0 || totalGP !== 0 || totalMktCost !== 0) {
        dailyProduct.push({
          date, product: productName,
          net_sales: Math.round(totalNetSales),
          gross_profit: Math.round(totalGP),
          net_after_mkt: Math.round(totalNetAfterMkt),
          mkt_cost: Math.round(totalMktCost + totalMpAdmin),
          mp_admin_cost: Math.round(totalMpAdmin),
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
    dailyProduct, dailyChannel, ads, monthlySummary,
    period: { month: periodMonth, year: periodYear },
  };
}

export async function testSheetConnection(spreadsheetId: string): Promise<{
  success: boolean; sheetNames?: string[]; error?: string;
}> {
  try {
    const sheetNames = await getSheetNames(spreadsheetId);
    return { success: true, sheetNames };
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to connect' };
  }
}
