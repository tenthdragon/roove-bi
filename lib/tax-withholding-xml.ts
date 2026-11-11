// Coretax BPPU bulk-upload XML (BpuBulk) generator and pre-export validation.
// Pure: no database access. The element order and enums come from the XML Map
// embedded in the DJP template "BPPU Excel to XML v.3" (see docs §3); the
// generator mirrors that template so a Roove BI batch can replace the Excel
// step without changing what Coretax receives.

import { digitsOnly, type DocumentType, type FacilityCode, type IdentityType } from './tax-withholding-domain';
import { fromMicro, periodStartIso, toMicro } from './tax-withholding-rules';

export const BPU_BULK_SCHEMA_VERSION = 'BpuBulk-v3';

/** TaxCertificate values accepted by the BPPU schema. SKD (non-resident) is not one of them. */
export const XML_FACILITY_CODES = ['N/A', 'TaxExAr22', 'TaxExAr23', 'TaxExIntDep', 'TaxExIntPhtb', 'DTP', 'PP23', 'ETC'] as const;
export const XML_DOCUMENT_TYPES = ['TaxInvoice', 'CommercialInvoice', 'Announchment', 'Contract', 'PaymentProof', 'DeedofEngangement', 'DeedofGeneralMeetingStakeholder', 'StatementLetter', 'BankAccountNumber'] as const;
/** Only recipients with an Indonesian NPWP or NIK can be reported through BPPU; non-residents use a different form. */
export const XML_IDENTITY_TYPES: readonly IdentityType[] = ['npwp', 'nik'];

export type ExportEntity = {
  legal_name: string;
  npwp: string;
  tku_id: string;
  is_active: boolean;
};

export type ExportSlip = {
  id: number;
  status: string;
  period_month: number;
  period_year: number;
  counterparty_name: string;
  counterparty_identity_type: IdentityType;
  counterparty_identity_number: string;
  object_code: string;
  facility_code: FacilityCode | 'N/A';
  gross_amount: string;
  rate_percent: string;
  withholding_amount: string;
  document_type: DocumentType;
  invoice_number: string;
  document_date: string;
  withholding_date: string;
};

export type ExportPeriod = { year: number; month: number };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateEntityForXml(entity: ExportEntity): string[] {
  const errors: string[] = [];
  if (!/^\d{16}$/.test(entity.npwp)) errors.push('NPWP pemotong harus 16 digit.');
  if (!/^\d{22}$/.test(entity.tku_id)) errors.push('ID TKU pemotong harus 22 digit.');
  if (!entity.is_active) errors.push('Pemotong nonaktif.');
  return errors;
}

/**
 * Errors that keep one slip out of a BpuBulk file. Returns [] when the slip can
 * be exported as-is. Period and status are checked here too so the caller can
 * pass any slip of the masa and show the reason per row.
 */
export function validateSlipForXml(slip: ExportSlip, period: ExportPeriod, activeObjectCodes: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  if (slip.status !== 'ready') errors.push(`Status ${slip.status}; hanya bukti potong siap yang di-export.`);
  if (slip.period_year !== period.year || slip.period_month !== period.month) errors.push('Masa pajak bukti potong berbeda dari masa batch.');
  if (!XML_IDENTITY_TYPES.includes(slip.counterparty_identity_type)) {
    errors.push(slip.counterparty_identity_type === 'foreign_tin'
      ? 'Lawan transaksi non-residen (TIN asing) tidak masuk BPPU; laporkan lewat bukti potong non-residen.'
      : 'Lawan transaksi belum punya NPWP/NIK.');
  } else if (!/^\d{16}$/.test(slip.counterparty_identity_number)) {
    errors.push('NPWP/NIK lawan transaksi harus 16 digit angka.');
  }
  if (!activeObjectCodes.has(slip.object_code)) errors.push(`Kode objek ${slip.object_code} tidak aktif di referensi.`);
  if (!(XML_FACILITY_CODES as readonly string[]).includes(slip.facility_code)) {
    errors.push(`Fasilitas ${slip.facility_code} tidak dikenal skema BPPU.`);
  }
  if (!(XML_DOCUMENT_TYPES as readonly string[]).includes(slip.document_type)) errors.push(`Jenis dokumen ${slip.document_type} tidak dikenal.`);
  let grossMicro = 0n;
  try {
    grossMicro = toMicro(slip.gross_amount);
  } catch {
    errors.push('DPP bukan angka.');
  }
  if (grossMicro <= 0n) errors.push('DPP harus lebih dari 0.');
  try {
    if (toMicro(slip.rate_percent) < 0n) errors.push('Tarif tidak boleh negatif.');
  } catch {
    errors.push('Tarif bukan angka.');
  }
  const documentNumber = slip.invoice_number.trim();
  if (!documentNumber) errors.push('Nomor dokumen kosong.');
  else if (slip.document_type === 'TaxInvoice' && digitsOnly(documentNumber).length !== 16) {
    errors.push('Dokumen TaxInvoice memerlukan nomor faktur pajak 16 digit.');
  }
  if (!ISO_DATE.test(slip.document_date)) errors.push('Tanggal dokumen tidak valid.');
  if (!ISO_DATE.test(slip.withholding_date)) errors.push('Tanggal pemotongan tidak valid.');
  else if (slip.withholding_date < periodStartIso(period.year, period.month)) errors.push('Tanggal pemotongan lebih awal dari masa pajak.');
  return errors;
}

/** "PT. ROOVE TIJARA INTERNASIONAL" → "RTI": initials of the name without its legal form. */
export function entityShortCode(legalName: string): string {
  const words = legalName
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !['PT', 'CV', 'UD', 'PD', 'TBK', 'PERSERO', 'KOPERASI', 'YAYASAN', 'FIRMA', 'PERUSAHAAN'].includes(word));
  const code = words.map((word) => word[0]).join('');
  return code || 'PT';
}

/** `BPPU - EBUPOT - RTI - 10 2026 - `; the server appends the two-digit sequence and `.xml`. */
export function exportFileNamePrefix(entity: Pick<ExportEntity, 'legal_name'>, period: ExportPeriod): string {
  return `BPPU - EBUPOT - ${entityShortCode(entity.legal_name)} - ${String(period.month).padStart(2, '0')} ${period.year} - `;
}

export function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char] as string);
}

/** Decimal text without trailing zeros or exponent, as the template's XML Map writes numbers. */
export function formatXmlDecimal(value: string, decimals = 6): string {
  return fromMicro(toMicro(value), decimals);
}

/** Recipient TKU: identity number followed by the six-digit head-office suffix. */
export function recipientTku(identityNumber: string): string {
  return `${identityNumber}000000`;
}

/**
 * Builds the BpuBulk document. Slips are written in the order given; callers
 * validate first, since this function trusts its input and only escapes text.
 */
export function buildBpuBulkXml(entity: Pick<ExportEntity, 'npwp' | 'tku_id'>, slips: ExportSlip[]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<BpuBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `  <TIN>${escapeXml(entity.npwp)}</TIN>`,
    '  <ListOfBpu>',
  ];
  for (const slip of slips) {
    lines.push(
      '    <Bpu>',
      `      <TaxPeriodMonth>${slip.period_month}</TaxPeriodMonth>`,
      `      <TaxPeriodYear>${slip.period_year}</TaxPeriodYear>`,
      `      <CounterpartTin>${escapeXml(slip.counterparty_identity_number)}</CounterpartTin>`,
      `      <IDPlaceOfBusinessActivityOfIncomeRecipient>${escapeXml(recipientTku(slip.counterparty_identity_number))}</IDPlaceOfBusinessActivityOfIncomeRecipient>`,
      `      <TaxCertificate>${escapeXml(slip.facility_code)}</TaxCertificate>`,
      `      <TaxObjectCode>${escapeXml(slip.object_code)}</TaxObjectCode>`,
      `      <TaxBase>${formatXmlDecimal(slip.gross_amount)}</TaxBase>`,
      `      <Rate>${formatXmlDecimal(slip.rate_percent, 3)}</Rate>`,
      `      <Document>${escapeXml(slip.document_type)}</Document>`,
      `      <DocumentNumber>${escapeXml(slip.invoice_number.trim())}</DocumentNumber>`,
      `      <DocumentDate>${escapeXml(slip.document_date)}</DocumentDate>`,
      `      <IDPlaceOfBusinessActivity>${escapeXml(entity.tku_id)}</IDPlaceOfBusinessActivity>`,
      '      <GovTreasurerOpt>N/A</GovTreasurerOpt>',
      '      <SP2DNumber xsi:nil="true"/>',
      `      <WithholdingDate>${escapeXml(slip.withholding_date)}</WithholdingDate>`,
      '    </Bpu>',
    );
  }
  lines.push('  </ListOfBpu>', '</BpuBulk>', '');
  return lines.join('\n');
}
