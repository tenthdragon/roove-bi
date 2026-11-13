// Coretax BPNR bulk-upload XML (BPNRBulk) generator and pre-export validation
// for bukti potong PPh 26 to non-resident recipients. Pure: no database access.
// The element order and enums come from the DJP template "BPNR Excel to XML"
// (sheets DATA, BPNR and REF) and the XML it produced for a real upload; the
// generator mirrors that template so a Roove BI batch replaces the Excel step.
//
// Differences from BPPU (lib/tax-withholding-xml.ts): the recipient is named by
// TIN (an NPWP or a foreign tax number), name, ISO country and address instead
// of NPWP + TKU; income is reported as GrossIncome × Deemed (norma) × Rate; the
// facility enum is N/A / COD (SKD) / ETC; the document enum is spelled
// differently; and IDPlaceOfBusinessActivity closes the element.

import { digitsOnly, type DocumentType, type FacilityCode, type TaxArticle } from './tax-withholding-domain';
import { fromMicro, periodStartIso, toMicro } from './tax-withholding-rules';
import { entityShortCode, escapeXml, formatXmlDecimal, xmlDocumentNumber, type ExportEntity, type ExportPeriod, type ExportSlip } from './tax-withholding-xml';
import { BPNR_COUNTRIES, BPNR_OBJECT_CODES } from './tax-withholding-bpnr-ref';

export const BPNR_BULK_SCHEMA_VERSION = 'BPNRBulk-v1';

/** TaxCertificate values of the BPNR schema. COD is the SKD (tax-treaty residence certificate). */
export const BPNR_FACILITY_CODES = ['N/A', 'COD', 'ETC'] as const;
export type BpnrFacilityCode = (typeof BPNR_FACILITY_CODES)[number];

/** Roove facility → BPNR TaxCertificate; null when the facility has no non-resident counterpart (SKB PPh 23, PP23, DTP…). */
export function bpnrTaxCertificate(facility: FacilityCode | 'N/A'): BpnrFacilityCode | null {
  if (facility === 'N/A') return 'N/A';
  if (facility === 'SKD') return 'COD';
  if (facility === 'ETC') return 'ETC';
  return null;
}

/** Roove/BPPU document enum → BPNR spelling; null when BPNR has no such document. */
export const BPNR_DOCUMENT_TYPES: Record<DocumentType, string | null> = {
  CommercialInvoice: 'CommercialInvoice',
  TaxInvoice: 'TaxInvoice',
  Contract: 'Contract',
  PaymentProof: 'PaymentProof',
  StatementLetter: 'StatementLetter',
  Announchment: 'Announcement',
  DeedofEngangement: 'DeedOfEngagement',
  DeedofGeneralMeetingStakeholder: 'DeedOfGeneral',
  BankAccountNumber: null,
};

const COUNTRY_CODES: ReadonlySet<string> = new Set(BPNR_COUNTRIES.map(([code]) => code));
const RESIDENT_COUNTRY = 'IDN';

export function isBpnrCountry(code: string): boolean {
  return COUNTRY_CODES.has(code);
}

const OBJECT_CODE_OPTIONS = (() => {
  const map = new Map<string, Array<{ deemed: number; rate: string }>>();
  for (const row of BPNR_OBJECT_CODES) {
    const list = map.get(row.code) ?? [];
    list.push({ deemed: row.deemed, rate: row.rate });
    map.set(row.code, list);
  }
  return map;
})();

export function isBpnrObjectCode(code: string): boolean {
  return OBJECT_CODE_OPTIONS.has(code);
}

export type BpnrRateResolution = { deemed: number; rate: string; error: null } | { deemed: null; rate: null; error: string };

/**
 * Coretax computes PPh 26 as GrossIncome × Deemed% × Rate%, while a Roove slip
 * stores the effective rate applied to the DPP. For a code with one norma the
 * nominal rate is effective ÷ norma; when the regulation allows several normas
 * (27-100-06) the one whose reference rate reproduces the slip's effective rate
 * is chosen, and anything else is reported instead of guessed.
 */
export function resolveBpnrRate(objectCode: string, ratePercent: string): BpnrRateResolution {
  const options = OBJECT_CODE_OPTIONS.get(objectCode);
  if (!options) return { deemed: null, rate: null, error: `Kode objek ${objectCode} tidak ada di referensi BPNR.` };
  let effective: bigint;
  try {
    effective = toMicro(ratePercent);
  } catch {
    return { deemed: null, rate: null, error: 'Tarif bukan angka.' };
  }
  if (effective < 0n) return { deemed: null, rate: null, error: 'Tarif tidak boleh negatif.' };
  if (options.length === 1) {
    const [{ deemed }] = options;
    const scaled = effective * 100n;
    if (scaled % BigInt(deemed) !== 0n) {
      return { deemed: null, rate: null, error: `Tarif ${ratePercent}% tidak dapat dinyatakan dengan norma ${deemed}% kode ${objectCode}.` };
    }
    return { deemed, rate: fromMicro(scaled / BigInt(deemed), 3), error: null };
  }
  for (const option of options) {
    if (effective * 100n === toMicro(option.rate) * BigInt(option.deemed)) return { deemed: option.deemed, rate: fromMicro(toMicro(option.rate), 3), error: null };
  }
  return {
    deemed: null,
    rate: null,
    error: `Norma kode ${objectCode} tidak dapat ditentukan dari tarif ${ratePercent}% (pilihan norma ${options.map((option) => option.deemed).join('/')}% × tarif ${options[0].rate}%).`,
  };
}

export type BpnrSlip = ExportSlip & {
  pph_article: TaxArticle;
  /** Nomor SKD WPLN when facility_code is SKD. */
  facility_document_number: string | null;
  /** From the counterparty master at export time: ISO 3166-1 alpha-3. */
  counterparty_country_code: string;
  counterparty_address: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Errors that keep one slip out of a BPNRBulk file; [] when it can be exported
 * as-is. Period and status are checked here too so the caller can pass any
 * slip of the masa and show the reason per row.
 */
export function validateSlipForBpnr(slip: BpnrSlip, period: ExportPeriod, activeObjectCodes: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  if (slip.status !== 'ready') errors.push(`Status ${slip.status}; hanya bukti potong siap yang di-export.`);
  if (slip.period_year !== period.year || slip.period_month !== period.month) errors.push('Masa pajak bukti potong berbeda dari masa batch.');
  if (slip.pph_article !== 'pph26') errors.push('Bukan PPh 26; bukti potong residen dilaporkan lewat BPPU.');
  if (slip.counterparty_identity_type === 'unknown') errors.push('Lawan transaksi belum punya NPWP/TIN.');
  else if (slip.counterparty_identity_type === 'nik') errors.push('Lawan transaksi ber-NIK adalah residen; laporkan lewat BPPU.');
  else if (!slip.counterparty_identity_number.trim()) errors.push('NPWP/TIN lawan transaksi kosong.');
  if (!slip.counterparty_name.trim()) errors.push('Nama lawan transaksi kosong.');
  const country = slip.counterparty_country_code.trim().toUpperCase();
  if (!isBpnrCountry(country)) errors.push(`Kode negara ${country || '(kosong)'} tidak ada di referensi Coretax; perbaiki di master lawan transaksi.`);
  else if (country === RESIDENT_COUNTRY) errors.push('Negara lawan transaksi IDN; bukti potong non-residen memerlukan negara domisili asing.');
  if (!(slip.counterparty_address ?? '').trim()) errors.push('Alamat lawan transaksi wajib untuk BPNR; lengkapi di master lawan transaksi.');
  if (!activeObjectCodes.has(slip.object_code)) errors.push(`Kode objek ${slip.object_code} tidak aktif di referensi.`);
  if (!isBpnrObjectCode(slip.object_code)) errors.push(`Kode objek ${slip.object_code} tidak dikenal skema BPNR.`);
  const certificate = bpnrTaxCertificate(slip.facility_code);
  if (certificate === null) errors.push(`Fasilitas ${slip.facility_code} tidak dikenal skema BPNR (hanya SKD atau fasilitas lainnya).`);
  else if (certificate === 'COD' && !(slip.facility_document_number ?? '').trim()) errors.push('Fasilitas SKD memerlukan nomor SKD WPLN pada bukti potong.');
  const documentType = BPNR_DOCUMENT_TYPES[slip.document_type];
  if (documentType === undefined || documentType === null) errors.push(`Jenis dokumen ${slip.document_type} tidak dikenal skema BPNR.`);
  let grossMicro = 0n;
  try {
    grossMicro = toMicro(slip.gross_amount);
  } catch {
    errors.push('DPP bukan angka.');
  }
  if (grossMicro <= 0n) errors.push('DPP harus lebih dari 0.');
  if (isBpnrObjectCode(slip.object_code)) {
    const resolution = resolveBpnrRate(slip.object_code, slip.rate_percent);
    if (resolution.error) errors.push(resolution.error);
  }
  const documentNumber = xmlDocumentNumber(slip);
  if (slip.document_type === 'TaxInvoice') {
    if (!documentNumber) errors.push('Dokumen TaxInvoice memerlukan nomor faktur pajak.');
    else if (digitsOnly(documentNumber).length !== 16) errors.push('Dokumen TaxInvoice memerlukan nomor faktur pajak 16 digit.');
  } else if (!documentNumber) {
    errors.push('Nomor dokumen kosong.');
  }
  if (!ISO_DATE.test(slip.document_date)) errors.push('Tanggal dokumen tidak valid.');
  if (!ISO_DATE.test(slip.withholding_date)) errors.push('Tanggal pemotongan tidak valid.');
  else if (slip.withholding_date < periodStartIso(period.year, period.month)) errors.push('Tanggal pemotongan lebih awal dari masa pajak.');
  return errors;
}

/** `BPNR - EBUPOT - RTI - 09 2026 - `; the server appends the two-digit sequence and `.xml`. */
export function bpnrFileNamePrefix(entity: Pick<ExportEntity, 'legal_name'>, period: ExportPeriod): string {
  return `BPNR - EBUPOT - ${entityShortCode(entity.legal_name)} - ${String(period.month).padStart(2, '0')} ${period.year} - `;
}

/**
 * Builds the BPNRBulk document in the template's element order. Slips are
 * written as given; callers validate first, since this function trusts its
 * input and only escapes text. Individual-recipient fields (birth date and
 * city, passport, KITAS) are not tracked by Roove and are written as nil.
 */
export function buildBpnrBulkXml(entity: Pick<ExportEntity, 'npwp' | 'tku_id'>, slips: BpnrSlip[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<BPNRBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `  <TIN>${escapeXml(entity.npwp)}</TIN>`,
    '  <ListOfBPNR>',
  ];
  for (const slip of slips) {
    const certificate = bpnrTaxCertificate(slip.facility_code) ?? 'N/A';
    const receipt = certificate === 'COD' ? (slip.facility_document_number ?? '').trim() : 'N/A';
    const resolution = resolveBpnrRate(slip.object_code, slip.rate_percent);
    const deemed = resolution.deemed ?? 100;
    const rate = resolution.rate ?? formatXmlDecimal(slip.rate_percent, 3);
    lines.push(
      '    <BPNR>',
      `      <TaxPeriodMonth>${slip.period_month}</TaxPeriodMonth>`,
      `      <TaxPeriodYear>${slip.period_year}</TaxPeriodYear>`,
      `      <CounterpartTin>${escapeXml(slip.counterparty_identity_number.trim())}</CounterpartTin>`,
      `      <CounterpartReceiptNumber>${escapeXml(receipt)}</CounterpartReceiptNumber>`,
      `      <CounterpartName>${escapeXml(slip.counterparty_name.trim())}</CounterpartName>`,
      `      <CounterpartCountry>${escapeXml(slip.counterparty_country_code.trim().toUpperCase())}</CounterpartCountry>`,
      `      <CounterpartAddress>${escapeXml((slip.counterparty_address ?? '').trim())}</CounterpartAddress>`,
      '      <CounterpartDob xsi:nil="true"/>',
      '      <CounterpartBirthCity xsi:nil="true"/>',
      '      <CounterpartPassport xsi:nil="true"/>',
      '      <CounterpartKitas xsi:nil="true"/>',
      `      <TaxCertificate>${certificate}</TaxCertificate>`,
      `      <TaxObjectCode>${escapeXml(slip.object_code)}</TaxObjectCode>`,
      `      <GrossIncome>${formatXmlDecimal(slip.gross_amount)}</GrossIncome>`,
      `      <Deemed>${deemed}</Deemed>`,
      `      <Rate>${rate}</Rate>`,
      `      <Document>${escapeXml(BPNR_DOCUMENT_TYPES[slip.document_type] ?? slip.document_type)}</Document>`,
      `      <DocumentNumber>${escapeXml(xmlDocumentNumber(slip))}</DocumentNumber>`,
      `      <DocumentDate>${escapeXml(slip.document_date)}</DocumentDate>`,
      '      <GovTreasurerOpt>N/A</GovTreasurerOpt>',
      '      <SP2DNumber xsi:nil="true"/>',
      `      <WithholdingDate>${escapeXml(slip.withholding_date)}</WithholdingDate>`,
      `      <IDPlaceOfBusinessActivity>${escapeXml(entity.tku_id)}</IDPlaceOfBusinessActivity>`,
      '    </BPNR>',
    );
  }
  lines.push('  </ListOfBPNR>', '</BPNRBulk>', '');
  return lines.join('\n');
}
