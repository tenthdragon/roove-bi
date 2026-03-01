import * as XLSX from 'xlsx';
import {
  type ParsedData,
  SKU_SHEETS,
  CHANNELS,
  SHEET_LAYOUT,
  toNum,
  excelDateToISO,
  extractPeriod,
  parseGeneralRow,
} from './parser-shared';

// Re-export ParsedData type for consumers
export type { ParsedData };

export function parseRooveExcel(buffer: ArrayBuffer): ParsedData {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });

  // ── Detect period from SKU sheet dates ──
  let periodMonth = 0;
  let periodYear = 0;

  for (const sheetName of Object.keys(SKU_SHEETS)) {
    if (!wb.SheetNames.includes(sheetName)) continue;
    const ws = wb.Sheets[sheetName];
    for (let c = SHEET_LAYOUT.DATE_COL_START; c < SHEET_LAYOUT.DATE_COL_END; c++) {
      const addr = XLSX.utils.encode_cell({ r: SHEET_LAYOUT.DATE_ROW, c });
      const cell = ws[addr];
      if (cell) {
        const dateStr = excelDateToISO(cell.v);
        if (dateStr) {
          const period = extractPeriod(dateStr);
          periodYear = period.year;
          periodMonth = period.month;
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
    for (let r = 2; r <= 15; r++) {
      const noCell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
      const skuCell = ws[XLSX.utils.encode_cell({ r, c: 2 })];
      if (!noCell?.v || !skuCell?.v) continue;

      const row = parseGeneralRow({
        sku: skuCell.v,
        salesAfterDisc: ws[XLSX.utils.encode_cell({ r, c: 3 })]?.v,
        salesPct: ws[XLSX.utils.encode_cell({ r, c: 4 })]?.v,
        grossProfit: ws[XLSX.utils.encode_cell({ r, c: 5 })]?.v,
        grossProfitPct: ws[XLSX.utils.encode_cell({ r, c: 6 })]?.v,
        grossAfterMkt: ws[XLSX.utils.encode_cell({ r, c: 7 })]?.v,
        gmpReal: ws[XLSX.utils.encode_cell({ r, c: 8 })]?.v,
        mktPct: ws[XLSX.utils.encode_cell({ r, c: 9 })]?.v,
        mktSharePct: ws[XLSX.utils.encode_cell({ r, c: 10 })]?.v,
      });
      if (row) monthlySummary.push(row);
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
    for (let c = SHEET_LAYOUT.DATE_COL_START; c < SHEET_LAYOUT.DATE_COL_END + 1; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: SHEET_LAYOUT.DATE_ROW, c })];
      if (cell) {
        const d = excelDateToISO(cell.v);
        if (d) dates.push({ col: c, date: d });
      }
    }

    if (dates.length === 0) continue;

    for (const { col, date } of dates) {
      let totalNetSales = 0;
      let totalGP = 0;
      let totalMktCost = 0;
      let totalNetAfterMkt = 0;

      // Net sales + gross profit by channel
      for (let i = 0; i < CHANNELS.length; i++) {
        const nsRow = SHEET_LAYOUT.NET_SALES_START + i;
        const gpRow = SHEET_LAYOUT.GROSS_PROFIT_START + i;

        const nsVal = toNum(ws[XLSX.utils.encode_cell({ r: nsRow, c: col })]?.v);
        const gpVal = toNum(ws[XLSX.utils.encode_cell({ r: gpRow, c: col })]?.v);

        totalNetSales += nsVal;
        totalGP += gpVal;

        if (nsVal !== 0 || gpVal !== 0) {
          dailyChannel.push({
            date,
            product: productName,
            channel: CHANNELS[i],
            net_sales: Math.round(nsVal),
            gross_profit: Math.round(gpVal),
          });
        }
      }

      // Marketing costs
      for (let r = SHEET_LAYOUT.MKT_COST_START; r <= SHEET_LAYOUT.MKT_COST_END; r++) {
        totalMktCost += toNum(ws[XLSX.utils.encode_cell({ r, c: col })]?.v);
      }

      // Net after marketing
      for (let r = SHEET_LAYOUT.NET_AFTER_MKT_START; r <= SHEET_LAYOUT.NET_AFTER_MKT_END; r++) {
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

    for (let r = 3; r <= range.e.r; r++) {
      const dateCell = ws[XLSX.utils.encode_cell({ r, c: 1 })];
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
