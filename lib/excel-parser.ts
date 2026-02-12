import * as XLSX from 'xlsx';

interface ParsedData {
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

function toNum(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim().replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function excelDateToISO(val: any): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().split('T')[0];
  }
  if (typeof val === 'number') {
    // Excel serial date
    const d = new Date((val - 25569) * 86400000);
    return d.toISOString().split('T')[0];
  }
  if (typeof val === 'string' && val.match(/^\d{4}-\d{2}-\d{2}/)) {
    return val.split('T')[0];
  }
  return null;
}

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

export function parseRooveExcel(buffer: ArrayBuffer): ParsedData {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });

  // ── Detect period from SKU sheet dates ──
  let periodMonth = 0;
  let periodYear = 0;

  // Try to get dates from first SKU sheet that exists
  for (const sheetName of Object.keys(SKU_SHEETS)) {
    if (!wb.SheetNames.includes(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    // Row 3 has dates starting from column E (index 4)
    for (let c = 4; c < 35; c++) {
      const addr = XLSX.utils.encode_cell({ r: 2, c }); // row 3 = index 2
      const cell = ws[addr];
      if (cell) {
        const dateStr = excelDateToISO(cell.v);
        if (dateStr) {
          const parts = dateStr.split('-');
          periodYear = parseInt(parts[0]);
          periodMonth = parseInt(parts[1]);
          break;
        }
      }
    }
    if (periodMonth > 0) break;
  }

  // ── Parse General sheet (monthly summary) ──
  const monthlySummary: ParsedData['monthlySummary'] = [];
  if (wb.SheetNames.includes('General')) {
    const ws = wb.Sheets['General'];
    for (let r = 2; r <= 15; r++) { // rows 3-14 in 1-indexed = 2-13 in 0-indexed
      const noCell = ws[XLSX.utils.encode_cell({ r, c: 1 })]; // col B
      const skuCell = ws[XLSX.utils.encode_cell({ r, c: 2 })]; // col C
      if (!noCell?.v || !skuCell?.v) continue;

      monthlySummary.push({
        product: String(skuCell.v),
        sales_after_disc: toNum(ws[XLSX.utils.encode_cell({ r, c: 3 })]?.v),
        sales_pct: toNum(ws[XLSX.utils.encode_cell({ r, c: 4 })]?.v) * 100,
        gross_profit: toNum(ws[XLSX.utils.encode_cell({ r, c: 5 })]?.v),
        gross_profit_pct: toNum(ws[XLSX.utils.encode_cell({ r, c: 6 })]?.v) * 100,
        gross_after_mkt: toNum(ws[XLSX.utils.encode_cell({ r, c: 7 })]?.v),
        gmp_real: toNum(ws[XLSX.utils.encode_cell({ r, c: 8 })]?.v) * 100,
        mkt_pct: toNum(ws[XLSX.utils.encode_cell({ r, c: 9 })]?.v) * 100,
        mkt_share_pct: toNum(ws[XLSX.utils.encode_cell({ r, c: 10 })]?.v) * 100,
      });
    }
  }

  // ── Parse SKU sheets (daily product + channel data) ──
  const dailyProduct: ParsedData['dailyProduct'] = [];
  const dailyChannel: ParsedData['dailyChannel'] = [];

  for (const [sheetName, productName] of Object.entries(SKU_SHEETS)) {
    if (!wb.SheetNames.includes(sheetName)) continue;
    const ws = wb.Sheets[sheetName];

    // Get dates from row 3 (0-indexed: row 2), starting col E (index 4)
    const dates: Array<{ col: number; date: string }> = [];
    for (let c = 4; c < 36; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: 2, c })];
      if (cell) {
        const d = excelDateToISO(cell.v);
        if (d) dates.push({ col: c, date: d });
      }
    }

    if (dates.length === 0) continue;

    // For each date, aggregate product-level totals
    for (const { col, date } of dates) {
      let totalNetSales = 0;
      let totalGP = 0;
      let totalMktCost = 0;
      let totalNetAfterMkt = 0;

      // Net sales by channel: rows 31-41 (0-indexed: 30-40), col C has channel name
      const salesChannels: string[] = [
        'Facebook Ads', 'Google Ads', 'Organik', 'Reseller', 'Shopee',
        'TikTok Ads', 'TikTok Shop', 'Tokopedia', 'BliBli', 'Lazada', 'SnackVideo Ads'
      ];

      for (let i = 0; i < salesChannels.length; i++) {
        const nsRow = 30 + i; // net sales rows 31-41 (0-indexed 30-40)
        const gpRow = 56 + i; // gross profit rows 57-67 (0-indexed 56-66)

        const nsVal = toNum(ws[XLSX.utils.encode_cell({ r: nsRow, c: col })]?.v);
        const gpVal = toNum(ws[XLSX.utils.encode_cell({ r: gpRow, c: col })]?.v);

        totalNetSales += nsVal;
        totalGP += gpVal;

        if (nsVal !== 0 || gpVal !== 0) {
          dailyChannel.push({
            date,
            product: productName,
            channel: salesChannels[i],
            net_sales: Math.round(nsVal),
            gross_profit: Math.round(gpVal),
          });
        }
      }

      // Marketing costs: rows 70-81 (0-indexed 69-80)
      for (let r = 69; r <= 80; r++) {
        totalMktCost += toNum(ws[XLSX.utils.encode_cell({ r, c: col })]?.v);
      }

      // Net after mkt: rows 90-101 (0-indexed 89-100)
      for (let r = 89; r <= 100; r++) {
        totalNetAfterMkt += toNum(ws[XLSX.utils.encode_cell({ r, c: col })]?.v);
      }

      if (totalNetSales !== 0 || totalMktCost !== 0 || totalNetAfterMkt !== 0) {
        dailyProduct.push({
          date,
          product: productName,
          net_sales: Math.round(totalNetSales),
          gross_profit: Math.round(totalGP),
          net_after_mkt: Math.round(totalNetAfterMkt),
          mkt_cost: Math.round(totalMktCost),
        });
      }
    }
  }

  // ── Parse Ads sheet ──
  const ads: ParsedData['ads'] = [];
  if (wb.SheetNames.includes('Ads')) {
    const ws = wb.Sheets['Ads'];
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');

    for (let r = 3; r <= range.e.r; r++) { // data starts row 4 (0-indexed: 3)
      const dateCell = ws[XLSX.utils.encode_cell({ r, c: 1 })]; // col B
      const dateStr = excelDateToISO(dateCell?.v);
      if (!dateStr) continue;

      ads.push({
        date: dateStr,
        ad_account: String(ws[XLSX.utils.encode_cell({ r, c: 2 })]?.v || ''),
        spent: toNum(ws[XLSX.utils.encode_cell({ r, c: 3 })]?.v),
        objective: String(ws[XLSX.utils.encode_cell({ r, c: 4 })]?.v || ''),
        source: String(ws[XLSX.utils.encode_cell({ r, c: 5 })]?.v || ''),
        store: String(ws[XLSX.utils.encode_cell({ r, c: 7 })]?.v || ''),
        advertiser: String(ws[XLSX.utils.encode_cell({ r, c: 8 })]?.v || ''),
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
