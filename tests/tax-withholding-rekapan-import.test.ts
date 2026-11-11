import assert from 'node:assert/strict';
import test from 'node:test';
import { compareRekapanRow, parseRekapan } from '../lib/tax-withholding-rekapan-import';

// Synthetic fixture in the legacy REKAPAN layout (header on sheet row 5).
const header = [
  ' ', 'PERIODE INVOICE ', 'MASA ', 'NO INVOICE ', 'FAKTUR PAJAK', 'KETERANGAN TRANSAKSI ', 'KODE & NAMA OBJEK', '       ',
  'NPWP / NIK', 'PPH PASAL', 'PENGHASILAN  BRUTO ', 'TARIF ', 'PAJAK YANG DI POTONG ', 'BIAYA TAMBAHAN', 'PPN', 'TOTAL BIAYA',
  'BUPOT', 'ID BILLING', 'NTPN', 'TGL. BAYAR PAJAK', 'TGL LAPOR PAJAK', 'LINK ID BLLING ', 'LINK TRELLO - INVOICE', 'SKB',
];
const softwareObject = 'Jasa Sehubungan Dengan Software Atau Hardware Atau Sistem Komputer, Termasuk Perawatan, Pemeliharaan dan Perbaikan.  -  24-104-24  -  PPH23';
const rentObject = 'Persewaan Tanah dan/atau Bangunan  -  28-403-02  -  PPH4-2';
const talentObject = 'Bukan Pegawai Tidak Berkesinambungan  -  21-100-09  -  PPH21';
const serial20260105 = 46027; // Excel serial for 2026-01-05 (1900 system)

const rows = [
  ['x'], ['y'], ['z'], ['w'],
  header,
  [1, serial20260105, '01', 'INV/2026/01/0001', '#N/A', 'Token listrik kantor', softwareObject, 'PT CONTOH MARKETPLACE', '01.234.567.8-901.000', 'PPH23', 6846.846846846846, 0.02, 137, null, 753.1531531531531, 7599.999999999999, '26000AAAA', 0, 0, '05/01/2026', null, null, 'https://trello.example/c/abc', null],
  [2, serial20260105 + 24, '01', 'SEWA-01', null, 'Sewa gudang', rentObject, 'BUDI CONTOH', '3273010101010001', 'PPH4-2', 4444444, 0.1, 444444, null, 0, 4444444, null, null, null, null, null, null, null, null],
  [3, serial20260105 + 1, '01', 'INV-21', null, 'Talent', talentObject, 'ANI CONTOH', '3273020202020002', 'PPH21', 1288660, 0.03, 38659],
  [4, null, null, null, null, null, null, null],
  [5, 'bukan tanggal', '01', 'INV-X', null, null, softwareObject, 'VENDOR CONTOH', null, 'PPH23', 100, 0.02, 2],
  [6, serial20260105, '01', 'INV-Y', null, null, 'Tanpa kode', 'VENDOR CONTOH', null, 'PPH23', 100, 0.02, 2],
  [7, serial20260105, '01', 'INV-Z', null, null, softwareObject, 'VENDOR CONTOH', null, 'PPH23', 0, 0.02, 0],
];

test('REKAPAN parser maps legacy columns, codes, periods and amounts', () => {
  const parsed = parseRekapan(rows);
  assert.equal(parsed.headerRowNumber, 5);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.skipped, 1);

  const marketplace = parsed.rows[0];
  assert.equal(marketplace.rowNumber, 6);
  assert.equal(marketplace.invoiceDate, '2026-01-05');
  assert.equal(marketplace.periodMonth, 1);
  assert.equal(marketplace.periodYear, 2026);
  assert.equal(marketplace.invoiceNumber, 'INV/2026/01/0001');
  assert.equal(marketplace.taxInvoiceNumber, null, '#N/A is not a tax invoice number');
  assert.equal(marketplace.objectCode, '24-104-24');
  assert.equal(marketplace.pphArticle, 'pph23');
  assert.equal(marketplace.counterpartyName, 'PT CONTOH MARKETPLACE');
  assert.equal(marketplace.counterpartyIdentityDigits, '0012345678901000');
  assert.equal(marketplace.grossAmount, '6846.846847');
  assert.equal(marketplace.workbookRatePercent, '2');
  assert.equal(marketplace.workbookWithholdingAmount, '137');
  assert.equal(marketplace.workbookVatAmount, '753.153153');
  assert.equal(marketplace.coretaxSlipNumber, '26000AAAA');
  assert.equal(marketplace.billingId, null, 'a 0 placeholder is not an ID Billing');
  assert.equal(marketplace.paidAt, '2026-01-05');
  assert.equal(marketplace.trelloUrl, 'https://trello.example/c/abc');

  const rent = parsed.rows[1];
  assert.equal(rent.objectCode, '28-403-02');
  assert.equal(rent.pphArticle, 'pph4_2');
  assert.equal(rent.counterpartyIdentityDigits, '3273010101010001');
  assert.equal(rent.workbookRatePercent, '10');
  assert.equal(rent.coretaxSlipNumber, null);

  const errors = parsed.issues.filter((issue) => issue.level === 'error');
  assert.deepEqual(errors.map((issue) => issue.rowNumber), [8, 10, 11, 12]);
  assert.match(errors[0].message, /PPh 21/);
  assert.match(errors[1].message, /Tanggal invoice/);
  assert.match(errors[2].message, /Kode objek/);
  assert.match(errors[3].message, /bruto/);
});

test('REKAPAN parser reports a missing header', () => {
  const parsed = parseRekapan([['a'], ['b']]);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.issues[0].level, 'error');
});

test('compareRekapanRow recomputes the workbook amount with the rule engine', () => {
  const parsed = parseRekapan(rows);
  const software = { code: '24-104-24', pph_article: 'pph23' as const, rate_percent: 2 };
  const marketplace = compareRekapanRow(parsed.rows[0], software, { identity_type: 'npwp', is_pkp: true }, []);
  assert.equal(marketplace.engineWithholding, '137');
  assert.equal(marketplace.difference, '0');

  const withSkb = compareRekapanRow(parsed.rows[0], software, { identity_type: 'npwp', is_pkp: true }, [
    { facility_code: 'TaxExAr23', document_number: 'KET-1', applies_to: ['pph23'], rate_override: null, valid_from: '2025-01-01', valid_to: null },
  ]);
  assert.equal(withSkb.engineWithholding, '0');
  assert.equal(withSkb.difference, '-137');
  assert.equal(withSkb.rateSource, 'facility');

  const rent = compareRekapanRow(parsed.rows[1], { code: '28-403-02', pph_article: 'pph4_2', rate_percent: 10 }, { identity_type: 'nik', is_pkp: false }, []);
  assert.equal(rent.engineWithholding, '444444');
  assert.equal(rent.difference, '0');
});
