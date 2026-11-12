import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BILLING_ID_PATTERN,
  NTPN_PATTERN,
  listExpiringFacilities,
  normalizeBillingId,
  normalizeNtpn,
  paymentGroupKey,
  paymentGroupStatus,
} from '../lib/tax-withholding-payment';

test('billing ids and NTPN are normalised and validated by their DJP formats', () => {
  assert.equal(normalizeBillingId(' 0123 4567 8901 234 '), '012345678901234');
  assert.ok(BILLING_ID_PATTERN.test(normalizeBillingId('012345678901234')));
  assert.ok(!BILLING_ID_PATTERN.test('01234567890123'));
  assert.ok(!BILLING_ID_PATTERN.test('0123456789012345'));
  assert.equal(normalizeNtpn(' abcd efgh 1234 5678 '), 'ABCDEFGH12345678');
  assert.ok(NTPN_PATTERN.test('ABCDEFGH12345678'));
  assert.ok(!NTPN_PATTERN.test('ABCDEFGH1234567'));
  assert.ok(!NTPN_PATTERN.test('abcdefgh12345678'));
});

test('paymentGroupKey and paymentGroupStatus tie records to a recap group and grade coverage', () => {
  assert.equal(paymentGroupKey({ period_month: 3, pph_article: 'pph23', kap: '411124', kjs: '104' }), '3|pph23|411124|104');
  assert.equal(paymentGroupKey({ period_month: 3, pph_article: 'pph23', kap: null, kjs: null }), '3|pph23||');
  assert.equal(paymentGroupStatus('1000', []), 'none');
  assert.equal(paymentGroupStatus('1000', [{ ntpn: null, paid_amount: null }]), 'billed');
  assert.equal(paymentGroupStatus('1000', [{ ntpn: 'ABCDEFGH12345678', paid_amount: '1000' }]), 'paid');
  assert.equal(paymentGroupStatus('1000', [{ ntpn: 'ABCDEFGH12345678', paid_amount: '600' }, { ntpn: null, paid_amount: null }]), 'partial');
  assert.equal(paymentGroupStatus('1000', [{ ntpn: 'ABCDEFGH12345678', paid_amount: '600' }, { ntpn: 'ABCDEFGH12345679', paid_amount: '400' }]), 'paid');
});

test('listExpiringFacilities lists active vendors whose facilities end soon or ended recently, nearest first', () => {
  const facility = (code: string, validTo: string | null, validFrom: string | null = null) => ({ facility_code: code, document_number: `${code}/1`, valid_from: validFrom, valid_to: validTo });
  const rows = listExpiringFacilities([
    { id: 1, name: 'VENDOR SOON', is_active: true, facilities: [facility('TaxExAr23', '2026-11-30')] },
    { id: 2, name: 'VENDOR LATER', is_active: true, facilities: [facility('PP23', '2027-03-31')] },
    { id: 3, name: 'VENDOR JUST ENDED', is_active: true, facilities: [facility('TaxExAr23', '2026-11-01')] },
    { id: 4, name: 'VENDOR LONG ENDED', is_active: true, facilities: [facility('TaxExAr23', '2026-01-31')] },
    { id: 5, name: 'VENDOR INACTIVE', is_active: false, facilities: [facility('TaxExAr23', '2026-11-20')] },
    { id: 6, name: 'VENDOR OPEN ENDED', is_active: true, facilities: [facility('DTP', null)] },
    { id: 7, name: 'VENDOR UPCOMING', is_active: true, facilities: [facility('PP23', '2026-11-25', '2026-11-20')] },
  ], '2026-11-12');
  assert.deepEqual(rows.map((row) => [row.counterpartyName, row.status, row.daysLeft]), [
    ['VENDOR JUST ENDED', 'expired', -11],
    ['VENDOR SOON', 'expiring', 18],
  ]);
  assert.equal(rows[0].validTo, '2026-11-01');
  assert.equal(rows[1].documentNumber, 'TaxExAr23/1');
});
