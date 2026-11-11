import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { MAX_SHEET_ROWS, sheetToRows } from '../lib/tax-withholding-sheet';

test('sheetToRows keeps Excel row numbers and ignores an oversized declared range', () => {
  const sheet = XLSX.utils.aoa_to_sheet([[], [], ['PERIODE INVOICE', 'NO INVOICE'], [46027, 'INV-1'], [], [46028, 'INV-2']]);
  // Excel often declares the whole grid as used; that must not be materialised.
  sheet['!ref'] = 'A1:AAA1048576';
  sheet.ZZ9 = { t: 's', v: '' };

  const rows = sheetToRows(sheet);
  assert.equal(rows.length, 6);
  assert.deepEqual(rows[0], []);
  assert.deepEqual(rows[2], ['PERIODE INVOICE', 'NO INVOICE']);
  assert.deepEqual(rows[3], [46027, 'INV-1']);
  assert.deepEqual(rows[4], [null, null]);
  assert.deepEqual(rows[5], [46028, 'INV-2']);
});

test('sheetToRows returns no rows for an empty sheet and refuses absurdly long ones', () => {
  assert.deepEqual(sheetToRows({ '!ref': 'A1:Z1048576' }), []);
  const tall: XLSX.WorkSheet = { '!ref': 'A1:A1048576' };
  tall[XLSX.utils.encode_cell({ r: MAX_SHEET_ROWS, c: 0 })] = { t: 'n', v: 1 };
  assert.throws(() => sheetToRows(tall), /baris/);
});

test('sheetToRows with maxRows sniffs the header window of an oversized sheet without throwing', () => {
  const tall: XLSX.WorkSheet = { '!ref': 'A1:A1048576', A1: { t: 's', v: 'Raw export' } };
  tall[XLSX.utils.encode_cell({ r: MAX_SHEET_ROWS, c: 0 })] = { t: 'n', v: 1 };
  assert.deepEqual(sheetToRows(tall, { maxRows: 20 }), [['Raw export']]);

  const padded = XLSX.utils.aoa_to_sheet([[], [], [], ['x']]);
  assert.deepEqual(sheetToRows(padded, { maxRows: 3 }), [], 'window ends before the first value');
  assert.deepEqual(sheetToRows(padded, { maxRows: 4 }), [[], [], [], ['x']]);
});
