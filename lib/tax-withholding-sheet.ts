// Turns an xlsx worksheet into the row arrays the tax import parsers consume,
// keeping Excel row numbers aligned (leading empty rows are kept as []).
//
// Excel may declare the whole grid as used (the REKAP workbook's REKAPAN sheet
// says A1:AAA1048576). Reading that range with blankrows would materialise a
// million rows and exhaust memory, so the range is trimmed to cells that hold
// a value before converting.

import * as XLSX from 'xlsx';
import type { SheetRow } from './tax-withholding-import';

export const MAX_SHEET_ROWS = 50_000;

export function sheetToRows(sheet: XLSX.WorkSheet): SheetRow[] {
  let firstRow = Number.POSITIVE_INFINITY;
  let lastRow = -1;
  let lastCol = -1;
  for (const address of Object.keys(sheet)) {
    if (address[0] === '!') continue;
    const value = (sheet[address] as XLSX.CellObject | undefined)?.v;
    if (value === null || value === undefined || value === '') continue;
    const cell = XLSX.utils.decode_cell(address);
    firstRow = Math.min(firstRow, cell.r);
    lastRow = Math.max(lastRow, cell.r);
    lastCol = Math.max(lastCol, cell.c);
  }
  if (lastRow < 0) return [];
  if (lastRow + 1 > MAX_SHEET_ROWS) throw new Error(`Sheet berisi lebih dari ${MAX_SHEET_ROWS.toLocaleString('id-ID')} baris; pangkas workbook terlebih dulu.`);
  const range: XLSX.Range = { s: { r: firstRow, c: 0 }, e: { r: lastRow, c: lastCol } };
  return [
    ...Array.from({ length: firstRow }, () => [] as SheetRow),
    ...XLSX.utils.sheet_to_json<SheetRow>(sheet, { header: 1, defval: null, raw: true, blankrows: true, range }),
  ];
}
