import { google } from 'googleapis';
import {
  type ParsedData,
  toNum,
  parseDateValue,
  buildBrandSheetMap,
  SALES_CHANNELS,
} from './parser-shared';

function getAuth() {
  const envKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!envKey || envKey.trim() === '') {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set or empty');
  }

  // Strip wrapping quotes if accidentally added in env config
  let raw = envKey.trim();
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    raw = raw.slice(1, -1);
  }

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (e: any) {
    const preview = raw.substring(0, 50);
    throw new Error(
      `Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY: ${e.message}. ` +
      `Value starts with: "${preview}..." — ensure the env var contains valid JSON without outer quotes.`
    );
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

async function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

// Legacy sheet names → canonical DB names
const CHANNEL_RENAME: Record<string, string> = {
  'Facebook Ads': 'Scalev Ads',
  'Organik': 'CS Manual',
  'TikTok Ads': 'CS Manual',
};

function resolveChannel(sheetChannel: string): string {
  return CHANNEL_RENAME[sheetChannel] || sheetChannel;
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
    'Scalev Ads', 'Google Ads', 'CS Manual', 'Reseller',
    'Shopee', 'CS Manual', 'TikTok Shop', 'Tokopedia',
    'BliBli', 'Lazada', 'SnackVideo Ads',
  ];
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

// ── Main parser — now takes brandList parameter ──
export async function parseGoogleSheet(
  spreadsheetId: string,
  brandList: Array<{ name: string; sheet_name: string }>,
  options?: { adsOnly?: boolean },
): Promise<ParsedData> {
  // Defensive guard — prevents cryptic "e is not iterable" in production
  if (!brandList || !Array.isArray(brandList)) {
    throw new Error('brandList is required — pass the active brands array from the database');
  }
  const adsOnly = options?.adsOnly === true;
  const sheetNames = await getSheetNames(spreadsheetId);

  let periodMonth = 0;
  let periodYear = 0;

  const dailyProduct: ParsedData['dailyProduct'] = [];
  const dailyChannel: ParsedData['dailyChannel'] = [];
  const ads: ParsedData['ads'] = [];
  const monthlySummary: ParsedData['monthlySummary'] = [];

  // ── Build brand sheets from registered brands ──
  const brandSheets = adsOnly ? {} : buildBrandSheetMap(brandList, sheetNames);

  // ── Parse General sheet (monthly summary) ──
  if (!adsOnly && sheetNames.includes('General')) {
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

  // ── Parse brand sheets (skipped in adsOnly mode) ──
  for (const [sheetName, productName] of Object.entries(brandSheets)) {
    const rows = await fetchRange(spreadsheetId, `'${sheetName}'!A3:AI120`);
    if (!rows || rows.length === 0) continue;

    const format = detectSheetFormat(rows);

    const dateRow = rows[0];
    const dates: Array<{ col: number; date: string }> = [];
    for (let c = 3; c < (dateRow?.length || 0); c++) {
      const d = parseDateValue(dateRow[c]);
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

      for (let ch = 0; ch < SALES_CHANNELS.length; ch++) {
        const nsRowIdx = 28 + ch;
        const gpRowIdx = 54 + ch;
        const netSales = toNum(rows[nsRowIdx]?.[col]);
        const gp = toNum(rows[gpRowIdx]?.[col]);

        totalNetSales += netSales;
        totalGP += gp;

        let mpAdmin = 0;
        if (format.hasMpAdmin) {
          const offset = MP_ADMIN_CHANNEL_OFFSETS[SALES_CHANNELS[ch]];
          if (offset !== undefined) {
            mpAdmin = Math.abs(toNum(rows[format.mpAdminBaseIdx + offset]?.[col]));
          }
        }
        totalMpAdmin += mpAdmin;

        const namRowIdx = netAfterMktMap[SALES_CHANNELS[ch]];
        const netAfterMktChannel = namRowIdx !== undefined && namRowIdx < rows.length
          ? toNum(rows[namRowIdx]?.[col]) : 0;

        const resolved = resolveChannel(SALES_CHANNELS[ch]);
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
  // New format (5 cols): Date, Ad Account, Spent, Source, Store
  // Source = traffic source (e.g. "TikTok Ads", "Facebook Ads", "Shopee - Roove")
  // Store  = brand/store name (e.g. "Roove", "Purvu Store", "Osgard")
  const KNOWN_TRAFFIC_SOURCES = ['tiktok', 'shopee', 'facebook', 'cpas', 'google', 'snack', 'waba', 'whatsapp'];
  if (sheetNames.includes('Ads')) {
    const rows = await fetchRange(spreadsheetId, 'Ads!B3:F2000');
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[0]) continue;
      const dateStr = parseDateValue(row[0]);
      if (!dateStr) continue;

      let source = String(row[3] || '');
      let store = String(row[4] || '');

      // Auto-fix swapped source/store: if store looks like a traffic source
      // and source does NOT, they were likely entered in the wrong columns
      const storeLower = store.toLowerCase();
      const sourceLower = source.toLowerCase();
      const storeIsTrafficSource = KNOWN_TRAFFIC_SOURCES.some(ts => storeLower.includes(ts));
      const sourceIsTrafficSource = KNOWN_TRAFFIC_SOURCES.some(ts => sourceLower.includes(ts));
      if (storeIsTrafficSource && !sourceIsTrafficSource) {
        [source, store] = [store, source];
      }

      ads.push({
        date: dateStr,
        ad_account: String(row[1] || ''),
        spent: toNum(row[2]),
        source,
        store,
      });
    }
  }

  // Fallback period detection from Ads data if brand sheets not available
  if (periodMonth === 0 && ads.length > 0) {
    const parts = ads[0].date.split('-');
    periodYear = parseInt(parts[0]);
    periodMonth = parseInt(parts[1]);
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
