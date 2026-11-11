import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPercent,
  computeSlip,
  deriveConsistentRatePercent,
  fromMicro,
  percentToScaled,
  periodFromDate,
  resolveGrossMicro,
  resolveRate,
  resolveVatRatePercent,
  roundToRupiah,
  scaledToPercent,
  toMicro,
  type RuleFacility,
} from '../lib/tax-withholding-rules';

const grabCode = { code: '24-104-24', pph_article: 'pph23' as const, rate_percent: 2 };
const freightCode = { code: '24-104-56', pph_article: 'pph23' as const, rate_percent: 2 };
const rentCode = { code: '28-403-02', pph_article: 'pph4_2' as const, rate_percent: 10 };
const foreignCode = { code: '27-104-01', pph_article: 'pph26' as const, rate_percent: 20 };
const pkp = { identity_type: 'npwp' as const, is_pkp: true };
const nonPkp = { identity_type: 'npwp' as const, is_pkp: false };
const person = { identity_type: 'nik' as const, is_pkp: false };
const skb: RuleFacility = {
  facility_code: 'TaxExAr23', document_number: 'KET-00020/PPUT-CT/KPP.0413/2026',
  applies_to: ['pph23'], rate_override: null, valid_from: '2026-03-09', valid_to: null,
};

test('decimal helpers keep six decimals exactly and round half up', () => {
  assert.equal(fromMicro(toMicro('7600')), '7600');
  assert.equal(fromMicro(toMicro('2702.7027027027025')), '2702.702703');
  assert.equal(fromMicro(toMicro(1e12 + 0.5)), '1000000000000.5');
  assert.equal(scaledToPercent(percentToScaled('2.5')), '2.5');
  assert.equal(scaledToPercent(percentToScaled(0.5)), '0.5');
  assert.equal(fromMicro(roundToRupiah(toMicro('137.5')), 0), '138');
  assert.equal(fromMicro(roundToRupiah(toMicro('137.499999')), 0), '137');
  assert.equal(fromMicro(applyPercent(toMicro('100'), percentToScaled('2.5'))), '2.5');
  assert.throws(() => toMicro('abc'), /bukan angka/);
});

test('DPP from a VAT-inclusive total replicates the workbook formula =total/1.11', () => {
  const gross = resolveGrossMicro('total_incl_vat', '7600', '11');
  assert.equal(fromMicro(gross), '6846.846847');
  assert.equal(fromMicro(resolveGrossMicro('total_incl_vat', '1000', '1.1')), '989.119683');
  assert.equal(fromMicro(resolveGrossMicro('dpp', '38010204', '11')), '38010204');
  assert.throws(() => resolveGrossMicro('dpp', '0', '11'), /lebih dari nol/);
});

test('VAT applies to PKP only, with the freight exception', () => {
  assert.equal(resolveVatRatePercent(pkp, '24-104-24'), '11');
  assert.equal(resolveVatRatePercent(pkp, '24-104-56'), '1.1');
  assert.equal(resolveVatRatePercent(nonPkp, '24-104-24'), '0');
});

test('rate comes from the object code, is doubled for NIK, zeroed by an active facility, or overridden', () => {
  const base = resolveRate({ objectCode: grabCode, counterparty: pkp, facilities: [], transactionDate: '2026-10-16' });
  assert.equal(base.ratePercent, '2');
  assert.equal(base.rateSource, 'object_code');

  const doubled = resolveRate({ objectCode: grabCode, counterparty: person, facilities: [], transactionDate: '2026-10-16' });
  assert.equal(doubled.ratePercent, '4');
  assert.equal(doubled.rateSource, 'nik_double');

  const rent = resolveRate({ objectCode: rentCode, counterparty: person, facilities: [], transactionDate: '2026-10-16' });
  assert.equal(rent.ratePercent, '10', 'PPh 4(2) is never doubled');

  const exempt = resolveRate({ objectCode: grabCode, counterparty: pkp, facilities: [skb], transactionDate: '2026-10-16' });
  assert.equal(exempt.ratePercent, '0');
  assert.equal(exempt.rateSource, 'facility');
  assert.equal(exempt.facilityCode, 'TaxExAr23');
  assert.equal(exempt.facilityDocumentNumber, skb.document_number);

  const beforeSkb = resolveRate({ objectCode: grabCode, counterparty: pkp, facilities: [skb], transactionDate: '2026-03-08' });
  assert.equal(beforeSkb.ratePercent, '2', 'SKB is not active before valid_from');

  const otherArticle = resolveRate({ objectCode: rentCode, counterparty: pkp, facilities: [skb], transactionDate: '2026-10-16' });
  assert.equal(otherArticle.ratePercent, '10', 'SKB for PPh 23 does not touch PPh 4(2)');

  const pp23 = resolveRate({ objectCode: grabCode, counterparty: nonPkp, facilities: [{ ...skb, facility_code: 'PP23', rate_override: '0.5' }], transactionDate: '2026-10-16' });
  assert.equal(pp23.ratePercent, '0.5');

  const override = resolveRate({ objectCode: grabCode, counterparty: pkp, facilities: [skb], transactionDate: '2026-10-16', rateOverridePercent: '2.5' });
  assert.equal(override.rateSource, 'override');
  assert.equal(override.ratePercent, '2.5');
  assert.equal(override.facilityCode, 'N/A', 'a manual rate ignores the facility');

  const foreign = resolveRate({ objectCode: foreignCode, counterparty: { identity_type: 'foreign_tin', is_pkp: false, country_code: 'SGP' }, facilities: [], transactionDate: '2026-10-29' });
  assert.equal(foreign.ratePercent, '20');
});

test('computeSlip reproduces workbook rows', () => {
  // REKAPAN row 1: Tokopedia token listrik, total 7,600 incl. VAT, PKP, 2% → PPh 137, PPN 753.15
  const tokopedia = computeSlip({
    objectCode: grabCode, counterparty: pkp, facilities: [], transactionDate: '2026-01-05',
    grossInputMode: 'total_incl_vat', grossInputAmount: '7600',
  });
  assert.equal(tokopedia.grossAmount, '6846.846847');
  assert.equal(tokopedia.withholdingAmount, '137');
  assert.equal(tokopedia.vatAmount, '753');
  assert.equal(tokopedia.ratePercent, '2');

  // REKAPAN row 2: Grab Express freight 1,000 incl. 1.1% VAT → DPP 989.12, PPh 20
  const grab = computeSlip({
    objectCode: freightCode, counterparty: pkp, facilities: [], transactionDate: '2026-01-06',
    grossInputMode: 'total_incl_vat', grossInputAmount: '1000',
  });
  assert.equal(grab.grossAmount, '989.119683');
  assert.equal(grab.withholdingAmount, '20');
  assert.equal(grab.vatRatePercent, '1.1');
  assert.equal(grab.vatAmount, '11');
  assert.equal(grab.totalAmount, '1000.119683');

  // Rent PPh 4(2) 10% on DPP 4,444,444 → 444,444
  const rent = computeSlip({
    objectCode: rentCode, counterparty: nonPkp, facilities: [], transactionDate: '2026-10-29',
    grossInputMode: 'dpp', grossInputAmount: 4444444, additionalCost: '0',
  });
  assert.equal(rent.withholdingAmount, '444444');
  assert.equal(rent.vatAmount, '0');
  assert.equal(rent.totalAmount, '4444444');

  // SKB vendor: DPP 1,801.80 at 0% → PPh 0, certificate reported
  const exempt = computeSlip({
    objectCode: grabCode, counterparty: pkp, facilities: [skb], transactionDate: '2026-10-22',
    grossInputMode: 'dpp', grossInputAmount: '1801.8018018018017',
  });
  assert.equal(exempt.withholdingAmount, '0');
  assert.equal(exempt.facilityCode, 'TaxExAr23');
  assert.ok(exempt.explanation.some((line) => /Fasilitas TaxExAr23/.test(line)));

  // Accounting services 38,010,204 at 2% → 760,204.08 rounds to 760,204
  const accountant = computeSlip({
    objectCode: { code: '24-104-06', pph_article: 'pph23', rate_percent: '2' }, counterparty: nonPkp, facilities: [],
    transactionDate: '2026-10-01', grossInputMode: 'dpp', grossInputAmount: '38010204',
  });
  assert.equal(accountant.withholdingAmount, '760204');
});

test('period helpers', () => {
  assert.deepEqual(periodFromDate('2026-10-22'), { year: 2026, month: 10 });
  assert.throws(() => periodFromDate('22/10/2026'), /tidak valid/);
});

test('deriveConsistentRatePercent returns a rate the engine can recompute, or null', () => {
  assert.equal(deriveConsistentRatePercent('6846.846847', '137', ['2']), '2');
  assert.equal(deriveConsistentRatePercent('6846.846847', '137', []), '2');
  assert.equal(deriveConsistentRatePercent('1801.8018', '36', [null]), '2');
  assert.equal(deriveConsistentRatePercent('38010204', '760204', ['2']), '2');
  // workbook rate that does not reproduce the amount is ignored in favour of a derived one
  assert.equal(deriveConsistentRatePercent('1000000', '40000', ['2']), '4');
  assert.equal(deriveConsistentRatePercent('1000000', '25000', ['0.025']), '2.5', 'a fraction-style workbook rate is replaced by the percent that reproduces the amount');
  // 7,692,308 × 2.5% = 192,307.7 → 192,308; a workbook amount of 192,307 is not reproducible by any 3-decimal rate
  assert.equal(deriveConsistentRatePercent('7692308', '192307', ['0.025']), null);
  assert.equal(deriveConsistentRatePercent('100', '137', []), '137', 'rates above 100% are representable');
  // 1 rupiah on a billion needs a rate below 0.001%, which the 3-decimal scale cannot express
  assert.equal(deriveConsistentRatePercent('1000000000', '1', []), null);
  assert.equal(deriveConsistentRatePercent('0', '137', []), null);
});
