import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBpuBulkXml,
  entityShortCode,
  exportFileNamePrefix,
  formatXmlDecimal,
  validateEntityForXml,
  validateSlipForXml,
  type ExportSlip,
} from '../lib/tax-withholding-xml';

// Synthetic entity and slips; identities are placeholders, not real taxpayers.
const entity = { legal_name: 'PT. CONTOH SINTETIS INDONESIA', npwp: '0123456789012345', tku_id: '0123456789012345000000', is_active: true };
const period = { year: 2026, month: 10 };
const codes = new Set(['24-104-24', '28-403-02', '27-104-01']);

const slip = (overrides: Partial<ExportSlip> = {}): ExportSlip => ({
  id: 1,
  status: 'ready',
  period_month: 10,
  period_year: 2026,
  counterparty_name: 'PT CONTOH MARKETPLACE',
  counterparty_identity_type: 'npwp',
  counterparty_identity_number: '0012345678901000',
  object_code: '24-104-24',
  facility_code: 'TaxExAr23',
  gross_amount: '1801.8018',
  rate_percent: '0',
  withholding_amount: '0',
  document_type: 'CommercialInvoice',
  invoice_number: 'IVR/20261005/XXVI/X/3214199800',
  document_date: '2026-10-05',
  withholding_date: '2026-10-05',
  ...overrides,
});

test('buildBpuBulkXml writes the BpuBulk elements in schema order with nil SP2D and recipient TKU', () => {
  const xml = buildBpuBulkXml(entity, [
    slip(),
    slip({ id: 2, counterparty_identity_type: 'nik', counterparty_identity_number: '3273010101010001', object_code: '28-403-02', facility_code: 'N/A', gross_amount: '4444444', rate_percent: '10', withholding_amount: '444444', invoice_number: 'SEWA & "PDM" <68>', document_date: '2026-10-29', withholding_date: '2026-10-29' }),
  ]);
  assert.equal(xml, [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<BpuBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <TIN>0123456789012345</TIN>',
    '  <ListOfBpu>',
    '    <Bpu>',
    '      <TaxPeriodMonth>10</TaxPeriodMonth>',
    '      <TaxPeriodYear>2026</TaxPeriodYear>',
    '      <CounterpartTin>0012345678901000</CounterpartTin>',
    '      <IDPlaceOfBusinessActivityOfIncomeRecipient>0012345678901000000000</IDPlaceOfBusinessActivityOfIncomeRecipient>',
    '      <TaxCertificate>TaxExAr23</TaxCertificate>',
    '      <TaxObjectCode>24-104-24</TaxObjectCode>',
    '      <TaxBase>1801.8018</TaxBase>',
    '      <Rate>0</Rate>',
    '      <Document>CommercialInvoice</Document>',
    '      <DocumentNumber>IVR/20261005/XXVI/X/3214199800</DocumentNumber>',
    '      <DocumentDate>2026-10-05</DocumentDate>',
    '      <IDPlaceOfBusinessActivity>0123456789012345000000</IDPlaceOfBusinessActivity>',
    '      <GovTreasurerOpt>N/A</GovTreasurerOpt>',
    '      <SP2DNumber xsi:nil="true"/>',
    '      <WithholdingDate>2026-10-05</WithholdingDate>',
    '    </Bpu>',
    '    <Bpu>',
    '      <TaxPeriodMonth>10</TaxPeriodMonth>',
    '      <TaxPeriodYear>2026</TaxPeriodYear>',
    '      <CounterpartTin>3273010101010001</CounterpartTin>',
    '      <IDPlaceOfBusinessActivityOfIncomeRecipient>3273010101010001000000</IDPlaceOfBusinessActivityOfIncomeRecipient>',
    '      <TaxCertificate>N/A</TaxCertificate>',
    '      <TaxObjectCode>28-403-02</TaxObjectCode>',
    '      <TaxBase>4444444</TaxBase>',
    '      <Rate>10</Rate>',
    '      <Document>CommercialInvoice</Document>',
    '      <DocumentNumber>SEWA &amp; &quot;PDM&quot; &lt;68&gt;</DocumentNumber>',
    '      <DocumentDate>2026-10-29</DocumentDate>',
    '      <IDPlaceOfBusinessActivity>0123456789012345000000</IDPlaceOfBusinessActivity>',
    '      <GovTreasurerOpt>N/A</GovTreasurerOpt>',
    '      <SP2DNumber xsi:nil="true"/>',
    '      <WithholdingDate>2026-10-29</WithholdingDate>',
    '    </Bpu>',
    '  </ListOfBpu>',
    '</BpuBulk>',
    '',
  ].join('\n'));
});

test('formatXmlDecimal keeps the stored precision without trailing zeros or exponents', () => {
  assert.equal(formatXmlDecimal('2702.702703'), '2702.702703');
  assert.equal(formatXmlDecimal('1000000.000000'), '1000000');
  assert.equal(formatXmlDecimal('2.000', 3), '2');
  assert.equal(formatXmlDecimal('2.650', 3), '2.65');
  assert.equal(formatXmlDecimal('1e6'), '1000000');
});

test('validateSlipForXml accepts a ready NPWP/NIK slip and names every blocking problem', () => {
  assert.deepEqual(validateSlipForXml(slip(), period, codes), []);
  assert.deepEqual(validateSlipForXml(slip({ counterparty_identity_type: 'nik', counterparty_identity_number: '3273010101010001' }), period, codes), []);

  const foreign = validateSlipForXml(slip({ counterparty_identity_type: 'foreign_tin', counterparty_identity_number: 'US-12-3456789', object_code: '27-104-01' }), period, codes);
  assert.equal(foreign.length, 1);
  assert.match(foreign[0], /non-residen/);

  const unknown = validateSlipForXml(slip({ counterparty_identity_type: 'unknown', counterparty_identity_number: 'TIDAK ADA IDENTITAS' }), period, codes);
  assert.match(unknown[0], /belum punya NPWP\/NIK/);

  const problems = validateSlipForXml(slip({
    status: 'draft',
    period_month: 9,
    counterparty_identity_number: '12345',
    object_code: '99-999-99',
    facility_code: 'SKD',
    gross_amount: '0',
    invoice_number: '  ',
    withholding_date: '2026-09-30',
  }), period, codes);
  assert.equal(problems.length, 8, problems.join(' | '));
  assert.ok(problems.some((message) => /Status draft/.test(message)));
  assert.ok(problems.some((message) => /Masa pajak/.test(message)));
  assert.ok(problems.some((message) => /16 digit angka/.test(message)));
  assert.ok(problems.some((message) => /Kode objek 99-999-99/.test(message)));
  assert.ok(problems.some((message) => /Fasilitas SKD/.test(message)));
  assert.ok(problems.some((message) => /DPP harus lebih dari 0/.test(message)));
  assert.ok(problems.some((message) => /Nomor dokumen kosong/.test(message)));
  assert.ok(problems.some((message) => /lebih awal dari masa pajak/.test(message)));

  assert.deepEqual(validateSlipForXml(slip({ document_type: 'TaxInvoice', invoice_number: 'INV-123' }), period, codes), ['Dokumen TaxInvoice memerlukan nomor faktur pajak 16 digit.']);
  assert.deepEqual(validateSlipForXml(slip({ document_type: 'TaxInvoice', invoice_number: '010.000-26.12345678' }), period, codes), []);
});

test('validateEntityForXml requires a 16-digit NPWP, 22-digit TKU and an active entity', () => {
  assert.deepEqual(validateEntityForXml(entity), []);
  assert.equal(validateEntityForXml({ ...entity, npwp: '123', tku_id: '1', is_active: false }).length, 3);
});

test('entityShortCode and exportFileNamePrefix follow the finance team file naming', () => {
  assert.equal(entityShortCode('PT. ROOVE TIJARA INTERNASIONAL'), 'RTI');
  assert.equal(entityShortCode('PT ROOVE LAUTAN BARAT'), 'RLB');
  assert.equal(entityShortCode('CV. BERKAH JAYA'), 'BJ');
  assert.equal(entityShortCode('PT'), 'PT');
  assert.equal(exportFileNamePrefix({ legal_name: 'PT. ROOVE TIJARA INTERNASIONAL' }, { year: 2026, month: 3 }), 'BPPU - EBUPOT - RTI - 03 2026 - ');
});
