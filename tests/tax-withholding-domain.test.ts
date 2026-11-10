import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkImportWorkspace,
  facilityExpiryStatus,
  formatNpwp,
  isFacilityActiveOn,
  normalizeCounterpartyInput,
  normalizeEntityInput,
  normalizeFacilityInput,
  normalizeIsoDate,
  normalizeNpwp,
  tkuFromNpwp,
} from '../lib/tax-withholding-domain';
import { parseCounterpartyMaster } from '../lib/tax-withholding-import';

test('legacy 15-digit NPWP is padded to the 16-digit Coretax form', () => {
  const result = normalizeNpwp('94.042.441.9-429.000');
  assert.equal(result.value, '0940424419429000');
  assert.equal(result.converted, true);
  assert.equal(formatNpwp(result.value!), '94.042.441.9-429.000');
  assert.equal(tkuFromNpwp(result.value!), '0940424419429000000000');
});

test('16-digit NPWP is kept and other lengths are rejected', () => {
  assert.equal(normalizeNpwp('0021628888053000').value, '0021628888053000');
  assert.equal(normalizeNpwp('0021628888053000').converted, false);
  assert.match(normalizeNpwp('12345').error ?? '', /15 atau 16 digit/);
  assert.match(normalizeNpwp('').error ?? '', /kosong/);
});

test('entity input derives TKU from NPWP and validates the signer', () => {
  const ok = normalizeEntityInput({
    businessId: 3,
    legalName: ' PT. ROOVE TIJARA INTERNASIONAL ',
    npwp: '94.042.441.9-429.000',
    signerNpwp: '35.490.311.4-045.000',
  });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.value?.tku_id, '0940424419429000000000');
  assert.equal(ok.value?.signer_npwp, '0354903114045000');
  assert.equal(ok.value?.legal_name, 'PT. ROOVE TIJARA INTERNASIONAL');

  const bad = normalizeEntityInput({ businessId: 0, legalName: '', npwp: '123', tkuId: '999' });
  assert.ok(bad.errors.length >= 3);
  assert.equal(bad.value, null);
});

test('counterparty input enforces identity rules', () => {
  const nik = normalizeCounterpartyInput({ name: 'Riza', identityType: 'nik', identityNumber: '3671 1302 0788 0002' });
  assert.equal(nik.value?.identity_number, '3671130207880002');
  assert.equal(nik.value?.country_code, 'IDN');

  const foreign = normalizeCounterpartyInput({ name: 'Adspert', identityType: 'foreign_tin', identityNumber: '202238815E', countryCode: 'sgp' });
  assert.equal(foreign.value?.country_code, 'SGP');

  const foreignWithoutCountry = normalizeCounterpartyInput({ name: 'X', identityType: 'foreign_tin', identityNumber: 'ABC' });
  assert.match(foreignWithoutCountry.errors.join(' '), /kode negara selain IDN/);
});

test('facility input defaults articles per facility and checks the validity window', () => {
  const skb = normalizeFacilityInput({ counterpartyId: 1, facilityCode: 'TaxExAr23', validFrom: '17/03/2026' });
  assert.deepEqual(skb.value?.applies_to, ['pph23']);
  assert.equal(skb.value?.valid_from, '2026-03-17');
  assert.equal(skb.value?.rate_override, null);

  const pp23 = normalizeFacilityInput({ counterpartyId: 1, facilityCode: 'PP23', rateOverride: '0,5' });
  assert.equal(pp23.value?.rate_override, 0.5);

  const reversed = normalizeFacilityInput({ counterpartyId: 1, facilityCode: 'PP23', validFrom: '2026-02-01', validTo: '2026-01-01' });
  assert.match(reversed.errors.join(' '), /akhir berlaku/);

  const explicitlyEmpty = normalizeFacilityInput({ counterpartyId: 1, facilityCode: 'TaxExAr23', appliesTo: [] });
  assert.equal(explicitlyEmpty.value, null);
  assert.match(explicitlyEmpty.errors.join(' '), /minimal satu pasal/);
  const omitted = normalizeFacilityInput({ counterpartyId: 1, facilityCode: 'TaxExAr23', appliesTo: null });
  assert.deepEqual(omitted.value?.applies_to, ['pph23']);
});

test('import commit must carry the previewed workspace', () => {
  const workspace = '00000000-0000-4000-8000-000000000001';
  assert.equal(checkImportWorkspace(workspace, workspace), null);
  assert.match(checkImportWorkspace(null, workspace) ?? '', /Pratinjau/);
  assert.match(checkImportWorkspace('', workspace) ?? '', /Pratinjau/);
  assert.match(checkImportWorkspace('00000000-0000-4000-8000-000000000002', workspace) ?? '', /Workspace aktif berubah/);
});

test('facility activity and expiry follow the validity window', () => {
  const facility = { valid_from: '2026-01-15', valid_to: '2026-12-31' };
  assert.equal(isFacilityActiveOn(facility, '2026-01-14'), false);
  assert.equal(isFacilityActiveOn(facility, '2026-06-01'), true);
  assert.equal(isFacilityActiveOn({ valid_from: '2026-01-15', valid_to: null }, '2030-01-01'), true);
  assert.equal(facilityExpiryStatus(facility, '2026-12-15'), 'expiring');
  assert.equal(facilityExpiryStatus(facility, '2027-01-01'), 'expired');
  assert.equal(facilityExpiryStatus(facility, '2026-01-01'), 'upcoming');
});

test('normalizeIsoDate accepts ISO, dd/mm/yyyy and Date values and rejects garbage', () => {
  assert.equal(normalizeIsoDate('2026-03-17'), '2026-03-17');
  assert.equal(normalizeIsoDate('17/03/2026'), '2026-03-17');
  assert.equal(normalizeIsoDate(new Date(2026, 2, 17)), '2026-03-17');
  assert.equal(normalizeIsoDate(new Date(2026, 2, 16, 23, 59, 48)), '2026-03-17'); // xlsx near-midnight drift
  assert.equal(normalizeIsoDate(46098), '2026-03-17'); // Excel serial, 1900 system
  assert.equal(normalizeIsoDate(44636, { date1904: true }), '2026-03-17'); // same day, 1904 system
  assert.equal(normalizeIsoDate(44636), '2022-03-16'); // the 1900 reading of that serial is a different day
  assert.equal(normalizeIsoDate(16), undefined);
  assert.equal(normalizeIsoDate(''), null);
  assert.equal(normalizeIsoDate('31/02/2026'), undefined);
  assert.equal(normalizeIsoDate('kemarin'), undefined);
});

test('master sheet parser maps legacy columns, identities and facilities', () => {
  const header = [null, 'NO', 'NAMA LAWAN TRANSAKSI', 'NPWP', 'KTP', 'NPWP / NIK', 'STATUS', 'STATUS PKP', 'TIN', 'ALAMAT', 'KODE NEGARA', 'JENIS FASILITAS', 'NO. SKD / SKB', 'ATURAN DTP', 'JENIS FASILITAS', 'NOMOR SUKET PP23', 'TGL BERLAKU SKD/SKB/PP23'];
  const rows = [
    ['IDENTITAS'],
    header,
    [null, 1, 'TOKOPEDIA', '21.089.397.0-035.000', null, '21.089.397.0-035.000', 'NPWP', 'PKP', null, null, null, 'SKB', 'KET-00020/PPUT-CT/KPP.0413/2026', null, 'SKB ', null, 46090],
    [null, 2, 'DELLA SAPPHIRA GANDJAR', null, 3273124112970000, '3273124112970000', 'NIK', null, null, null, null, null, null, null, null, null, null],
    [null, 3, 'ADSPERT PRO PTE. LTD.', null, null, null, 'NIK', null, '202238815E', null, 'SGP', 'SKD', null, null, 'SKD', null, new Date(2025, 1, 1)],
    [null, 4, 'SCALEV', '99.900.000.0-099.9000', null, null, 'NPWP', null, null, null, 'USA', null, null, null, null, null, null],
    [null, 5, 'PT PERJALANAN MENEMBUS GALAKSI', '95.214.256.0-063.000', null, null, 'NPWP', null, null, null, null, 'PP23', null, null, null, 'KET-98/PP23/WPJ.04/KP.1203/2021', null],
    [null, 6, 'TOKOPEDIA', '21.089.397.0-035.000', null, null, 'NPWP', 'PKP', null, null, null, null, null, null, null, null, null],
    [null, 7, 'RUSAK', '12.345', null, null, 'NPWP', null, null, null, null, null, null, null, null, null, null],
    [null, 8, 'HALODOC', '99.900.000.0-099.9000', null, null, 'NPWP', null, null, null, null, null, null, null, null, null, null],
    [null, 9, 'BAGAS', null, '327312411297000', '327312411297000', 'NIK', null, null, null, null, null, null, null, null, null, null],
    [null, 10, 'DELLA DENGAN PLACEHOLDER', '99.900.000.0-099.9000', '3273124112970001', '3273124112970001', 'NIK', null, null, null, null, null, null, null, null, null, null],
    [null, 11, 'PT TANGGAL RUSAK', '11.111.111.1-111.000', null, null, 'NPWP', null, null, null, null, 'SKB', 'KET-RUSAK/2026', null, 'SKB', null, '31/02/2026'],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  ];

  const parsed = parseCounterpartyMaster(rows);
  assert.equal(parsed.headerRowNumber, 2);
  assert.equal(parsed.rows.length, 9);

  const tokopedia = parsed.rows[0];
  assert.equal(tokopedia.identity_type, 'npwp');
  assert.equal(tokopedia.identity_number, '0210893970035000');
  assert.equal(tokopedia.is_pkp, true);
  assert.equal(tokopedia.facilities.length, 1);
  assert.equal(tokopedia.facilities[0].facility_code, 'TaxExAr23');
  assert.equal(tokopedia.facilities[0].document_number, 'KET-00020/PPUT-CT/KPP.0413/2026');
  assert.equal(tokopedia.facilities[0].valid_from, '2026-03-09');

  const della = parsed.rows[1];
  assert.equal(della.identity_type, 'nik');
  assert.equal(della.identity_number, '3273124112970000');
  assert.ok(della.warnings.some((w) => /angka/.test(w)));

  const adspert = parsed.rows[2];
  assert.equal(adspert.identity_type, 'foreign_tin');
  assert.equal(adspert.identity_number, '202238815E');
  assert.equal(adspert.country_code, 'SGP');
  assert.equal(adspert.facilities[0].facility_code, 'SKD');
  assert.deepEqual(adspert.facilities[0].applies_to, ['pph26']);

  const scalev = parsed.rows[3];
  assert.equal(scalev.identity_type, 'foreign_tin');
  assert.equal(scalev.country_code, 'USA');
  assert.ok(scalev.warnings.some((w) => /tanpa TIN/.test(w)));

  const noIdentity = parsed.rows[5];
  assert.equal(noIdentity.identity_type, 'unknown');
  assert.equal(noIdentity.identity_number, 'TIDAK ADA IDENTITAS');
  assert.ok(noIdentity.warnings.some((w) => /placeholder/.test(w)));

  const nikOverPlaceholder = parsed.rows[7];
  assert.equal(nikOverPlaceholder.identity_type, 'nik');
  assert.equal(nikOverPlaceholder.identity_number, '3273124112970001');

  const badDate = parsed.rows[8];
  assert.equal(badDate.identity_type, 'npwp');
  assert.deepEqual(badDate.facilities, []);
  assert.match(badDate.notes ?? '', /31\/02\/2026/);
  assert.ok(parsed.issues.some((issue) => issue.level === 'error' && issue.rowNumber === 13 && /tidak valid/.test(issue.message)));

  const badNik = parsed.rows[6];
  assert.equal(badNik.identity_type, 'unknown');
  assert.match(badNik.notes ?? '', /327312411297000$/);
  assert.ok(badNik.warnings.some((w) => /15 digit/.test(w)));

  const pp23 = parsed.rows[4];
  assert.equal(pp23.facilities[0].facility_code, 'PP23');
  assert.equal(pp23.facilities[0].document_number, 'KET-98/PP23/WPJ.04/KP.1203/2021');
  assert.equal(pp23.facilities[0].valid_from, null);

  assert.ok(parsed.issues.some((issue) => issue.level === 'warning' && issue.rowNumber === 8 && /dilewati/.test(issue.message)));
  assert.ok(parsed.issues.some((issue) => issue.level === 'error' && issue.rowNumber === 9));
  assert.equal(parsed.skipped, 2);
});

test('master sheet parser honours the 1904 date system when told', () => {
  const header = [null, 'NO', 'NAMA LAWAN TRANSAKSI', 'NPWP', 'KTP', 'NPWP / NIK', 'STATUS', 'STATUS PKP', 'TIN', 'ALAMAT', 'KODE NEGARA', 'JENIS FASILITAS', 'NO. SKD / SKB', 'ATURAN DTP', 'JENIS FASILITAS', 'NOMOR SUKET PP23', 'TGL BERLAKU SKD/SKB/PP23'];
  const row = [null, 1, 'PT MAC', '11.111.111.1-111.000', null, null, 'NPWP', null, null, null, null, 'SKB', 'KET-MAC/2026', null, 'SKB', null, 44636];
  assert.equal(parseCounterpartyMaster([header, row], { date1904: true }).rows[0].facilities[0].valid_from, '2026-03-17');
  assert.equal(parseCounterpartyMaster([header, row]).rows[0].facilities[0].valid_from, '2022-03-16');
});

test('master sheet parser reports a missing header', () => {
  const parsed = parseCounterpartyMaster([['a', 'b'], ['c', 'd']]);
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.issues[0].level, 'error');
});
