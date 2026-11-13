import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BPNR_BULK_SCHEMA_VERSION,
  BPNR_DOCUMENT_TYPES,
  bpnrFileNamePrefix,
  bpnrTaxCertificate,
  buildBpnrBulkXml,
  isBpnrCountry,
  isBpnrObjectCode,
  isBpnrReferenceRate,
  resolveBpnrRate,
  validateSlipForBpnr,
  type BpnrSlip,
} from '../lib/tax-withholding-bpnr';
import { BPNR_COUNTRIES, BPNR_OBJECT_CODES } from '../lib/tax-withholding-bpnr-ref';
import { validateSlipForXml } from '../lib/tax-withholding-xml';

// Synthetic entity and slips; identities are placeholders, not real taxpayers.
const entity = { legal_name: 'PT. CONTOH SINTETIS INDONESIA', npwp: '0123456789012345', tku_id: '0123456789012345000000', is_active: true };
const period = { year: 2026, month: 9 };
const codes = new Set(['24-104-24', '27-104-01', '27-100-05', '27-100-06']);

const slip = (overrides: Partial<BpnrSlip> = {}): BpnrSlip => ({
  id: 1,
  status: 'ready',
  pph_article: 'pph26',
  period_month: 9,
  period_year: 2026,
  counterparty_name: 'CONTOH PLATFORMS LIMITED',
  counterparty_identity_type: 'npwp',
  counterparty_identity_number: '0098765432109000',
  counterparty_country_code: 'IRL',
  counterparty_address: 'SAMPLE ROAD, DUBLIN 4, IRELAND',
  object_code: '27-104-01',
  facility_code: 'N/A',
  facility_document_number: null,
  gross_amount: '570709445',
  rate_percent: '20',
  withholding_amount: '114141889',
  document_type: 'CommercialInvoice',
  invoice_number: '255001216',
  tax_invoice_number: null,
  document_date: '2026-09-01',
  withholding_date: '2026-09-01',
  ...overrides,
});

test('buildBpnrBulkXml writes the BPNRBulk elements in the template order with nil personal fields and the TKU last', () => {
  const xml = buildBpnrBulkXml(entity, [
    slip(),
    slip({ id: 2, counterparty_identity_type: 'foreign_tin', counterparty_identity_number: 'ABC-123-456', counterparty_country_code: 'SGP', counterparty_address: 'ONE RAFFLES & CO', facility_code: 'SKD', facility_document_number: 'SKD-WPLN/002/233-001', rate_percent: '0', withholding_amount: '0', gross_amount: '1234.5', invoice_number: 'INV<2>', document_type: 'Announchment', document_date: '2026-09-15', withholding_date: '2026-09-15' }),
  ]);
  assert.equal(BPNR_BULK_SCHEMA_VERSION, 'BPNRBulk-v1');
  assert.equal(xml, [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<BPNRBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <TIN>0123456789012345</TIN>',
    '  <ListOfBPNR>',
    '    <BPNR>',
    '      <TaxPeriodMonth>9</TaxPeriodMonth>',
    '      <TaxPeriodYear>2026</TaxPeriodYear>',
    '      <CounterpartTin>0098765432109000</CounterpartTin>',
    '      <CounterpartReceiptNumber>N/A</CounterpartReceiptNumber>',
    '      <CounterpartName>CONTOH PLATFORMS LIMITED</CounterpartName>',
    '      <CounterpartCountry>IRL</CounterpartCountry>',
    '      <CounterpartAddress>SAMPLE ROAD, DUBLIN 4, IRELAND</CounterpartAddress>',
    '      <CounterpartDob xsi:nil="true"/>',
    '      <CounterpartBirthCity xsi:nil="true"/>',
    '      <CounterpartPassport xsi:nil="true"/>',
    '      <CounterpartKitas xsi:nil="true"/>',
    '      <TaxCertificate>N/A</TaxCertificate>',
    '      <TaxObjectCode>27-104-01</TaxObjectCode>',
    '      <GrossIncome>570709445</GrossIncome>',
    '      <Deemed>100</Deemed>',
    '      <Rate>20</Rate>',
    '      <Document>CommercialInvoice</Document>',
    '      <DocumentNumber>255001216</DocumentNumber>',
    '      <DocumentDate>2026-09-01</DocumentDate>',
    '      <GovTreasurerOpt>N/A</GovTreasurerOpt>',
    '      <SP2DNumber xsi:nil="true"/>',
    '      <WithholdingDate>2026-09-01</WithholdingDate>',
    '      <IDPlaceOfBusinessActivity>0123456789012345000000</IDPlaceOfBusinessActivity>',
    '    </BPNR>',
    '    <BPNR>',
    '      <TaxPeriodMonth>9</TaxPeriodMonth>',
    '      <TaxPeriodYear>2026</TaxPeriodYear>',
    '      <CounterpartTin>ABC-123-456</CounterpartTin>',
    '      <CounterpartReceiptNumber>SKD-WPLN/002/233-001</CounterpartReceiptNumber>',
    '      <CounterpartName>CONTOH PLATFORMS LIMITED</CounterpartName>',
    '      <CounterpartCountry>SGP</CounterpartCountry>',
    '      <CounterpartAddress>ONE RAFFLES &amp; CO</CounterpartAddress>',
    '      <CounterpartDob xsi:nil="true"/>',
    '      <CounterpartBirthCity xsi:nil="true"/>',
    '      <CounterpartPassport xsi:nil="true"/>',
    '      <CounterpartKitas xsi:nil="true"/>',
    '      <TaxCertificate>COD</TaxCertificate>',
    '      <TaxObjectCode>27-104-01</TaxObjectCode>',
    '      <GrossIncome>1234.5</GrossIncome>',
    '      <Deemed>100</Deemed>',
    '      <Rate>0</Rate>',
    '      <Document>Announcement</Document>',
    '      <DocumentNumber>INV&lt;2&gt;</DocumentNumber>',
    '      <DocumentDate>2026-09-15</DocumentDate>',
    '      <GovTreasurerOpt>N/A</GovTreasurerOpt>',
    '      <SP2DNumber xsi:nil="true"/>',
    '      <WithholdingDate>2026-09-15</WithholdingDate>',
    '      <IDPlaceOfBusinessActivity>0123456789012345000000</IDPlaceOfBusinessActivity>',
    '    </BPNR>',
    '  </ListOfBPNR>',
    '</BPNRBulk>',
    '',
  ].join('\n'));
});

test('the BPNR reference carries the template object codes and countries, and maps facilities and documents', () => {
  assert.equal(BPNR_OBJECT_CODES.length, 40);
  assert.equal(BPNR_COUNTRIES.length, 249);
  assert.ok(isBpnrObjectCode('27-104-01') && isBpnrObjectCode('28-403-02') && !isBpnrObjectCode('24-104-24'));
  assert.ok(isBpnrCountry('IDN') && isBpnrCountry('USA') && !isBpnrCountry('XXX') && !isBpnrCountry(''));
  assert.equal(bpnrTaxCertificate('N/A'), 'N/A');
  assert.equal(bpnrTaxCertificate('SKD'), 'COD');
  assert.equal(bpnrTaxCertificate('ETC'), 'ETC');
  assert.equal(bpnrTaxCertificate('TaxExAr23'), null);
  assert.equal(BPNR_DOCUMENT_TYPES.DeedofGeneralMeetingStakeholder, 'DeedOfGeneral');
  assert.equal(BPNR_DOCUMENT_TYPES.BankAccountNumber, null);
  assert.equal(bpnrFileNamePrefix(entity, period), 'BPNR - EBUPOT - CSI - 09 2026 - ');
});

test('resolveBpnrRate turns the effective slip rate into Deemed × Rate per object code', () => {
  assert.deepEqual(resolveBpnrRate('27-104-01', '20'), { deemed: 100, rate: '20', error: null });
  assert.deepEqual(resolveBpnrRate('27-104-01', '0'), { deemed: 100, rate: '0', error: null }, 'treaty rate 0 with SKD');
  assert.deepEqual(resolveBpnrRate('27-104-01', '7.5'), { deemed: 100, rate: '7.5', error: null });
  assert.deepEqual(resolveBpnrRate('27-100-05', '5'), { deemed: 25, rate: '20', error: null }, 'norma 25%: effective 5% is nominal 20%');
  assert.deepEqual(resolveBpnrRate('27-100-06', '2'), { deemed: 10, rate: '20', error: null }, 'several normas: the one reproducing the effective rate');
  assert.match(resolveBpnrRate('27-100-06', '3').error ?? '', /Norma kode 27-100-06 tidak dapat ditentukan dari tarif 3%/);
  assert.match(resolveBpnrRate('24-104-24', '2').error ?? '', /tidak ada di referensi BPNR/);
  assert.match(resolveBpnrRate('27-104-01', '-1').error ?? '', /negatif/);
});

test('validateSlipForBpnr accepts a ready PPh 26 slip of a foreign recipient and names every blocking problem', () => {
  assert.deepEqual(validateSlipForBpnr(slip(), period, codes), []);
  assert.deepEqual(validateSlipForBpnr(slip({ counterparty_identity_type: 'foreign_tin', counterparty_identity_number: 'ABC-123', facility_code: 'SKD', facility_document_number: 'SKD-1', rate_percent: '0' }), period, codes), []);
  const bad = validateSlipForBpnr(slip({
    status: 'draft', period_month: 8, pph_article: 'pph23', counterparty_identity_type: 'nik', counterparty_name: ' ', counterparty_country_code: 'IDN',
    counterparty_address: '', object_code: '24-104-24', facility_code: 'TaxExAr23', document_type: 'BankAccountNumber', gross_amount: '0', invoice_number: '',
    document_date: '01/09/2026', withholding_date: '2026-08-31',
  }), period, codes);
  for (const pattern of [
    /Status draft/, /Masa pajak/, /Bukan PPh 26/, /ber-NIK/, /Nama lawan transaksi kosong/, /Negara lawan transaksi IDN/, /Alamat lawan transaksi wajib/,
    /tidak dikenal skema BPNR/, /Fasilitas TaxExAr23/, /Jenis dokumen BankAccountNumber/, /DPP harus lebih dari 0/, /Nomor dokumen kosong/, /Tanggal dokumen tidak valid/, /Tanggal pemotongan lebih awal/,
  ]) assert.ok(bad.some((error) => pattern.test(error)), `expected ${pattern} in ${bad.join(' | ')}`);
  assert.match(validateSlipForBpnr(slip({ counterparty_country_code: 'XX' }), period, codes).join(' '), /Kode negara XX tidak ada di referensi/);
  assert.match(validateSlipForBpnr(slip({ counterparty_identity_type: 'unknown' }), period, codes).join(' '), /belum punya NPWP\/TIN/);
  assert.match(validateSlipForBpnr(slip({ facility_code: 'SKD', facility_document_number: ' ' }), period, codes).join(' '), /memerlukan nomor SKD WPLN/);
  assert.match(validateSlipForBpnr(slip({ object_code: '27-100-06', rate_percent: '3' }), period, codes).join(' '), /Norma kode 27-100-06/);
  // Without a facility the pair must be a reference pair: the seeded 20% on a norma-25% code resolves to 25 × 80 and is blocked;
  // the same slip with SKD or another facility may deviate (treaty rates), and 5% (= 25 × 20) passes on its own.
  assert.match(validateSlipForBpnr(slip({ object_code: '27-100-05', rate_percent: '20' }), period, codes).join(' '), /Tarif 20% \(norma 25% × tarif 80%\) menyimpang dari referensi kode 27-100-05 \(25% × 20%\)/);
  assert.deepEqual(validateSlipForBpnr(slip({ object_code: '27-100-05', rate_percent: '5' }), period, codes), []);
  assert.deepEqual(validateSlipForBpnr(slip({ object_code: '27-100-05', rate_percent: '20', facility_code: 'SKD', facility_document_number: 'SKD-1' }), period, codes), []);
  assert.deepEqual(validateSlipForBpnr(slip({ rate_percent: '10', facility_code: 'ETC' }), period, codes), []);
  assert.match(validateSlipForBpnr(slip({ rate_percent: '10' }), period, codes).join(' '), /Tarif 10% \(norma 100% × tarif 10%\) menyimpang dari referensi kode 27-104-01 \(100% × 20%\)/);
  assert.match(validateSlipForBpnr(slip({ rate_percent: '0' }), period, codes).join(' '), /menyimpang dari referensi/, 'a 0% rate needs the SKD that justifies it');
  assert.ok(isBpnrReferenceRate('27-100-06', 10, '20') && !isBpnrReferenceRate('27-100-06', 10, '2') && !isBpnrReferenceRate('24-104-24', 100, '2'));
  assert.match(validateSlipForBpnr(slip({ document_type: 'TaxInvoice', tax_invoice_number: '123' }), period, codes).join(' '), /faktur pajak 16 digit/);
  assert.match(validateSlipForBpnr(slip({ object_code: '27-103-01' }), period, codes).join(' '), /27-103-01 tidak aktif di referensi/);
});

test('validateSlipForXml keeps PPh 26 out of BPPU even when the recipient has an NPWP', () => {
  const { counterparty_country_code: _country, counterparty_address: _address, facility_document_number: _doc, ...bppu } = slip();
  assert.deepEqual(validateSlipForXml(bppu, period, codes), ['PPh 26 dilaporkan lewat BPNR (bukti potong non-residen), bukan BPPU.']);
  assert.deepEqual(validateSlipForXml({ ...bppu, pph_article: 'pph23', object_code: '24-104-24' }, period, codes), []);
});
