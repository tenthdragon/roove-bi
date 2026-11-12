import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coretaxNumberProblem,
  coretaxNumberWarning,
  matchCoretaxNumbers,
  normalizeCoretaxNumber,
  parseAmount,
  parseCoretaxPaste,
  parseCoretaxSheetRows,
  type CoretaxMatchSlip,
} from '../lib/tax-withholding-coretax';

// Synthetic slips; identities are placeholders, not real taxpayers.
const slip = (id: number, overrides: Partial<CoretaxMatchSlip> = {}): CoretaxMatchSlip => ({
  id,
  invoice_number: `INV-${id}`,
  tax_invoice_number: null,
  document_type: 'CommercialInvoice',
  counterparty_identity_number: '0012345678901000',
  gross_amount: '1000000',
  coretax_slip_number: null,
  ...overrides,
});

test('Coretax numbers are upper-cased, validated loosely and flagged when not nine characters', () => {
  assert.equal(normalizeCoretaxNumber('  26000uk7l '), '26000UK7L');
  assert.equal(coretaxNumberProblem('26000UK7L'), null);
  assert.match(coretaxNumberProblem('') ?? '', /kosong/);
  assert.match(coretaxNumberProblem('SUDAH DIUPLOAD') ?? '', /tanpa spasi/);
  assert.match(coretaxNumberProblem('2602NI1PN, 2602VYKE1') ?? '', /tanpa spasi/);
  assert.match(coretaxNumberProblem('ABC12') ?? '', /6-20/);
  assert.match(coretaxNumberProblem('KOSONG') ?? '', /memuat angka/);
  assert.equal(coretaxNumberWarning('26000UK7L'), null);
  assert.match(coretaxNumberWarning('26000UK7LX') ?? '', /10 karakter/);
});

test('parseCoretaxPaste reads two columns in either order with tab, semicolon or comma separators', () => {
  const tab = parseCoretaxPaste('INV-1\t26000UK7L\nINV-2\t26000UK7M\n');
  assert.deepEqual(tab.issues, []);
  assert.deepEqual(tab.rows.map((row) => [row.line, row.documentNumber, row.coretaxNumber]), [[1, 'INV-1', '26000UK7L'], [2, 'INV-2', '26000UK7M']]);

  const reversed = parseCoretaxPaste('26000UK7L;INV/2026/X/1\n26000UK7M;INV/2026/X/2');
  assert.deepEqual(reversed.rows.map((row) => [row.documentNumber, row.coretaxNumber]), [['INV/2026/X/1', '26000UK7L'], ['INV/2026/X/2', '26000UK7M']]);

  const comma = parseCoretaxPaste('INV-1,26000uk7l');
  assert.deepEqual(comma.rows.map((row) => [row.documentNumber, row.coretaxNumber]), [['INV-1', '26000UK7L']]);

  const header = parseCoretaxPaste('Nomor Dokumen\tNPWP\tDPP\tNomor Bukti Potong\nINV-1\t12.345.678.9-012.000\t1.000.000,00\t26000UK7L');
  assert.equal(header.rows.length, 1);
  assert.equal(header.rows[0].line, 2);
  assert.equal(header.rows[0].identity, '0123456789012000', 'a 15-digit NPWP gains the leading zero');
  assert.equal(header.rows[0].grossMicro, 1_000_000_000_000n);
  assert.equal(header.rows[0].coretaxNumber, '26000UK7L');
});

test('parseCoretaxPaste explains a single-column or empty paste instead of guessing', () => {
  assert.match(parseCoretaxPaste('26000UK7L\n26000UK7M').issues[0], /dua kolom/);
  assert.match(parseCoretaxPaste('   \n').issues[0], /Tidak ada baris/);
  assert.match(parseCoretaxPaste('INV-1\tkosong\nINV-2\tbelum').issues[0], /tidak dikenali/);
});

test('parseAmount keeps numeric cells as decimals and reads Indonesian or English text separators', () => {
  assert.equal(parseAmount(1.234), 1_234_000n, 'a numeric cell is never a thousands group');
  assert.equal(parseAmount(1234), 1_234_000_000n);
  assert.equal(parseAmount(1801.8018), 1_801_801_800n);
  assert.equal(parseAmount('1000,50'), 1_000_500_000n, 'decimal comma without thousands separator');
  assert.equal(parseAmount('1.234'), 1_234_000_000n, 'Indonesian thousands text');
  assert.equal(parseAmount('1.234.567,89'), 1_234_567_890_000n);
  assert.equal(parseAmount('1,234,567.89'), 1_234_567_890_000n);
  assert.equal(parseAmount('Rp 2.500.000'), 2_500_000_000_000n);
  assert.equal(parseAmount('12.5'), 12_500_000n);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
});

test('parseCoretaxSheetRows finds the header row of a Coretax download and skips rows above it', () => {
  const rows = [
    ['Daftar Bukti Potong', null, null],
    [],
    ['No', 'Nomor Bukti Potong', 'NPWP/NIK', 'Nama', 'Nomor Dokumen', 'Jumlah Penghasilan Bruto'],
    [1, '26000UK7L', '0012345678901000', 'PT CONTOH', 'INV-1', 1801.8018],
    [2, '26000UK7M', '3273010101010001', 'BUDI', 'INV-2', 4444444],
    [null, null, null, null, null, null],
  ];
  const parsed = parseCoretaxSheetRows(rows);
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.rows.map((row) => [row.line, row.documentNumber, row.coretaxNumber, row.identity, row.grossMicro]), [
    [4, 'INV-1', '26000UK7L', '0012345678901000', 1_801_801_800n],
    [5, 'INV-2', '26000UK7M', '3273010101010001', 4_444_444_000_000n],
  ]);
  // A three-decimal numeric cell survives untouched; the same digits as text are a thousands group.
  const decimals = parseCoretaxSheetRows([['Nomor Dokumen', 'DPP', 'Nomor Bukti Potong'], ['INV-A', 1.234, '26000UK7N'], ['INV-B', '1.234', '26000UK7P']]);
  assert.deepEqual(decimals.rows.map((row) => row.grossMicro), [1_234_000n, 1_234_000_000n]);
  assert.match(parseCoretaxSheetRows([['a', 'b'], ['c', 'd']]).issues[0], /tidak ditemukan/);
});

test('matchCoretaxNumbers ties rows to slips by the XML document number, then NPWP and DPP', () => {
  const slips = [
    slip(1),
    slip(2, { document_type: 'TaxInvoice', tax_invoice_number: '010.000-26.12345678', invoice_number: 'INV-FP' }),
    slip(3, { invoice_number: 'SAME' }),
    slip(4, { invoice_number: 'SAME', counterparty_identity_number: '3273010101010001' }),
    slip(5, { invoice_number: 'TWIN', gross_amount: '500000' }),
    slip(6, { invoice_number: 'TWIN', gross_amount: '750000' }),
  ];
  const result = matchCoretaxNumbers(slips, [
    { line: 1, documentNumber: 'inv-1', coretaxNumber: 'A0000001', identity: null, grossMicro: null },
    // Coretax echoes the faktur number for TaxInvoice documents; the invoice number also works.
    { line: 2, documentNumber: '010.000-26.12345678', coretaxNumber: 'A0000002', identity: null, grossMicro: null },
    { line: 3, documentNumber: 'SAME', coretaxNumber: 'A0000003', identity: '3273010101010001', grossMicro: null },
    { line: 4, documentNumber: 'TWIN', coretaxNumber: 'A0000004', identity: null, grossMicro: 750_000_000_000n },
    { line: 5, documentNumber: null, coretaxNumber: 'A0000005', identity: '0012345678901000', grossMicro: 500_000_000_000n },
    { line: 6, documentNumber: 'SAME', coretaxNumber: 'A0000006', identity: null, grossMicro: null },
    { line: 7, documentNumber: 'MISSING', coretaxNumber: 'A0000007', identity: null, grossMicro: null },
    { line: 8, documentNumber: 'INV-1', coretaxNumber: null, identity: null, grossMicro: null },
    // A document number from another masa with the same NPWP and DPP as slip 5 must not be matched by amount.
    { line: 9, documentNumber: 'INV-DEC', coretaxNumber: 'A0000009', identity: '0012345678901000', grossMicro: 500_000_000_000n },
  ]);
  assert.deepEqual(result.assignments.map((row) => [row.slipId, row.coretaxNumber, row.matchedBy]), [
    [1, 'A0000001', 'document'],
    [2, 'A0000002', 'document'],
    [4, 'A0000003', 'document+identity'],
    [6, 'A0000004', 'document+amount'],
    [5, 'A0000005', 'identity+amount'],
  ]);
  assert.deepEqual(result.ambiguous.map((row) => [row.row.line, row.slipIds]), [[6, [3, 4]]]);
  assert.deepEqual(result.unmatched.map((row) => row.row.line), [7, 8, 9]);
  assert.match(result.unmatched[0].reason, /MISSING/);
  assert.match(result.unmatched[2].reason, /INV-DEC tidak ada .* NPWP \+ DPP sama dengan TWIN; ketik/);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.conflictedSlipIds, []);
});

test('matchCoretaxNumbers reports a slip given two numbers and a number given to two slips', () => {
  const result = matchCoretaxNumbers([slip(1), slip(2), slip(3)], [
    { line: 1, documentNumber: 'INV-1', coretaxNumber: 'A0000001', identity: null, grossMicro: null },
    { line: 2, documentNumber: 'INV-1', coretaxNumber: 'A0000009', identity: null, grossMicro: null },
    { line: 3, documentNumber: 'INV-1', coretaxNumber: 'A0000001', identity: null, grossMicro: null },
    { line: 4, documentNumber: 'INV-2', coretaxNumber: 'B0000002', identity: null, grossMicro: null },
    { line: 5, documentNumber: 'INV-3', coretaxNumber: 'B0000002', identity: null, grossMicro: null },
    // A later row repeating the first number must not bring the conflicted slip back.
    { line: 6, documentNumber: 'INV-1', coretaxNumber: 'A0000001', identity: null, grossMicro: null },
  ]);
  assert.deepEqual(result.assignments, [], 'a conflicted slip gets no proposal at all');
  assert.deepEqual([...result.conflictedSlipIds].sort(), [1, 2, 3]);
  assert.equal(result.conflicts.length, 2);
  assert.match(result.conflicts[0], /INV-1 mendapat 2 nomor berbeda .* tidak ada yang diusulkan/);
  assert.match(result.conflicts[1], /B0000002 dipakai 2 bukti potong/);
});

test('matchCoretaxNumbers holds back every slip touched by combined conflicts, whatever the row order', () => {
  const rows = [
    { line: 1, documentNumber: 'INV-1', coretaxNumber: '26000AAA1', identity: null, grossMicro: null },
    { line: 2, documentNumber: 'INV-1', coretaxNumber: '26000AAA2', identity: null, grossMicro: null },
    { line: 3, documentNumber: 'INV-2', coretaxNumber: '26000AAA1', identity: null, grossMicro: null },
    { line: 4, documentNumber: 'INV-3', coretaxNumber: '26000AAA3', identity: null, grossMicro: null },
  ];
  for (const order of [rows, [...rows].reverse(), [rows[2], rows[0], rows[1], rows[3]]]) {
    const result = matchCoretaxNumbers([slip(1), slip(2), slip(3)], order);
    // INV-2's claim on 26000AAA1 collides with INV-1's first claim even though INV-1 is itself conflicted.
    assert.deepEqual(result.assignments.map((row) => [row.slipId, row.coretaxNumber]), [[3, '26000AAA3']], `order ${order.map((row) => row.line).join(',')}`);
    assert.deepEqual([...result.conflictedSlipIds].sort(), [1, 2]);
    assert.equal(result.conflicts.length, 2);
    assert.ok(result.conflicts.some((text) => /INV-1 mendapat 2 nomor berbeda/.test(text)));
    assert.ok(result.conflicts.some((text) => /26000AAA1 dipakai 2 bukti potong sekaligus \((INV-1, INV-2|INV-2, INV-1)\)/.test(text)));
  }
});
