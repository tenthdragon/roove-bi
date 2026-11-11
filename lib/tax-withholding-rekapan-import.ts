// Parses the legacy "REKAPAN" sheet (one row per bukti potong) of the REKAP
// POTPUT workbook into slip candidates, and compares the workbook's withheld
// amount with the rule engine. Pure: callers pass the sheet as rows.

import {
  UNIQUE_IDENTITY_TYPES,
  cleanOptional,
  digitsOnly,
  normalizeIsoDate,
  normalizeNpwp,
  type DateOptions,
  type IdentityType,
  type TaxArticle,
} from './tax-withholding-domain';
import type { ImportIssue, SheetCell, SheetRow } from './tax-withholding-import';
import {
  computeSlip,
  fromMicro,
  toMicro,
  type RuleCounterparty,
  type RuleFacility,
  type RuleObjectCode,
} from './tax-withholding-rules';

export type ParsedRekapanRow = {
  rowNumber: number;
  invoiceDate: string;
  periodMonth: number;
  periodYear: number;
  invoiceNumber: string;
  taxInvoiceNumber: string | null;
  description: string | null;
  objectCode: string;
  pphArticle: TaxArticle;
  counterpartyName: string;
  counterpartyIdentityDigits: string | null;
  grossAmount: string;
  workbookRatePercent: string | null;
  workbookWithholdingAmount: string | null;
  additionalCost: string;
  workbookVatAmount: string | null;
  workbookTotalAmount: string | null;
  coretaxSlipNumber: string | null;
  billingId: string | null;
  ntpn: string | null;
  paidAt: string | null;
  reportedAt: string | null;
  trelloUrl: string | null;
  accountCode: string | null;
  accountName: string | null;
  warnings: string[];
};

export type ParsedRekapan = {
  headerRowNumber: number;
  rows: ParsedRekapanRow[];
  issues: ImportIssue[];
  skipped: number;
};

const ARTICLE_LABELS: Record<string, TaxArticle | null> = {
  PPH23: 'pph23',
  'PPH4-2': 'pph4_2',
  'PPH4(2)': 'pph4_2',
  PPH22: 'pph22',
  PPH15: 'pph15',
  PPH26: 'pph26',
  PPH21: null,
};

const HEADERS: Record<string, string[]> = {
  invoiceDate: ['periode invoice'],
  period: ['masa'],
  invoiceNumber: ['no invoice'],
  taxInvoice: ['faktur pajak'],
  description: ['keterangan transaksi'],
  objectText: ['kode & nama objek', 'kode dan nama objek'],
  identity: ['npwp / nik', 'npwp/nik'],
  article: ['pph pasal'],
  gross: ['penghasilan bruto'],
  rate: ['tarif'],
  withholding: ['pajak yang di potong', 'pajak yang dipotong'],
  additional: ['biaya tambahan'],
  vat: ['ppn'],
  total: ['total biaya'],
  slipNumber: ['bupot'],
  billingId: ['id billing'],
  ntpn: ['ntpn'],
  paidAt: ['tgl. bayar pajak', 'tgl bayar pajak'],
  reportedAt: ['tgl lapor pajak', 'tgl. lapor pajak'],
  trello: ['link trello - invoice', 'link trello'],
  account: ['no akun'],
};

function cellText(cell: SheetCell): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

function normalizeHeader(cell: SheetCell): string {
  return cellText(cell).toLowerCase().replace(/\s+/g, ' ').trim();
}

export function findRekapanHeaderRow(rows: SheetRow[]): number {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const headers = rows[index].map(normalizeHeader);
    if (headers.includes('periode invoice') && headers.includes('no invoice')) return index;
  }
  return -1;
}

function mapColumns(headerRow: SheetRow): Record<string, number> {
  const map: Record<string, number> = {};
  headerRow.forEach((cell, index) => {
    const header = normalizeHeader(cell);
    if (!header) return;
    for (const [key, aliases] of Object.entries(HEADERS)) {
      if (map[key] === undefined && aliases.includes(header)) map[key] = index;
    }
  });
  // The vendor column has a blank header in the legacy sheet: it is the column
  // right after "KODE & NAMA OBJEK".
  if (map.objectText !== undefined) map.counterparty = map.objectText + 1;
  if (map.account !== undefined) map.accountName = map.account + 1;
  return map;
}

function numberCell(cell: SheetCell): string | null {
  if (cell === null || cell === undefined || cell === '') return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? fromMicro(toMicro(cell)) : null;
  const text = cellText(cell).replace(/\s/g, '');
  if (!text || text === '-') return null;
  try {
    return fromMicro(toMicro(text.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')));
  } catch {
    return null;
  }
}

export function parseRekapan(rows: SheetRow[], options: DateOptions = {}): ParsedRekapan {
  const headerIndex = findRekapanHeaderRow(rows);
  if (headerIndex < 0) {
    return {
      headerRowNumber: 0,
      rows: [],
      issues: [{ level: 'error', rowNumber: 0, name: '', message: 'Header "PERIODE INVOICE" dan "NO INVOICE" tidak ditemukan di sheet ini.' }],
      skipped: 0,
    };
  }
  const columns = mapColumns(rows[headerIndex]);
  const required = ['invoiceDate', 'invoiceNumber', 'objectText', 'gross'];
  const missing = required.filter((key) => columns[key] === undefined);
  if (missing.length > 0) {
    return {
      headerRowNumber: headerIndex + 1,
      rows: [],
      issues: [{ level: 'error', rowNumber: headerIndex + 1, name: '', message: `Kolom wajib tidak ditemukan: ${missing.join(', ')}.` }],
      skipped: 0,
    };
  }

  const issues: ImportIssue[] = [];
  const parsed: ParsedRekapanRow[] = [];
  let skipped = 0;
  const get = (row: SheetRow, key: string): SheetCell => (columns[key] === undefined ? null : row[columns[key]]);

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 1;
    const dateCell = get(row, 'invoiceDate');
    const invoiceDate = normalizeIsoDate(dateCell, options);
    const invoiceNumber = cellText(get(row, 'invoiceNumber')).replace(/\s+/g, ' ');
    const counterpartyName = cellText(get(row, 'counterparty')).replace(/\s+/g, ' ');
    if (!invoiceDate && !invoiceNumber && !counterpartyName) {
      skipped += 1;
      continue;
    }
    const name = counterpartyName || invoiceNumber || `baris ${rowNumber}`;
    if (invoiceDate === null || invoiceDate === undefined) {
      issues.push({ level: 'error', rowNumber, name, message: `Tanggal invoice "${cellText(dateCell)}" kosong atau tidak valid.` });
      continue;
    }
    if (!invoiceNumber) {
      issues.push({ level: 'error', rowNumber, name, message: 'Nomor invoice kosong.' });
      continue;
    }
    if (!counterpartyName) {
      issues.push({ level: 'error', rowNumber, name, message: 'Nama lawan transaksi kosong.' });
      continue;
    }

    const objectText = cellText(get(row, 'objectText'));
    const codeMatch = /\b(\d{2}-\d{3}-\d{2})\b/.exec(objectText);
    if (!codeMatch) {
      issues.push({ level: 'error', rowNumber, name, message: `Kode objek pajak tidak ditemukan di "${objectText.slice(0, 80)}".` });
      continue;
    }
    const objectCode = codeMatch[1];
    const articleText = cellText(get(row, 'article')).toUpperCase().replace(/\s+/g, '')
      || (/PPH[0-9()-]+/i.exec(objectText)?.[0] ?? '').toUpperCase();
    const article = ARTICLE_LABELS[articleText];
    if (article === null) {
      issues.push({ level: 'error', rowNumber, name, message: 'PPh 21 tidak termasuk bukti potong unifikasi; baris dilewati.' });
      continue;
    }
    const pphArticle: TaxArticle = article ?? (objectCode.startsWith('22') ? 'pph22' : objectCode.startsWith('27') ? 'pph26' : objectCode.startsWith('29') ? 'pph15' : objectCode.startsWith('28') ? 'pph4_2' : 'pph23');

    const grossAmount = numberCell(get(row, 'gross'));
    if (grossAmount === null || toMicro(grossAmount) <= 0n) {
      issues.push({ level: 'error', rowNumber, name, message: `Penghasilan bruto "${cellText(get(row, 'gross'))}" kosong atau tidak lebih dari nol.` });
      continue;
    }

    const warnings: string[] = [];
    const periodText = cellText(get(row, 'period'));
    let periodMonth = Number(periodText);
    let periodYear = Number(invoiceDate.slice(0, 4));
    if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) {
      periodMonth = Number(invoiceDate.slice(5, 7));
      if (periodText) warnings.push(`Masa "${periodText}" tidak dikenali; dipakai bulan tanggal invoice.`);
    } else if (periodMonth !== Number(invoiceDate.slice(5, 7))) {
      warnings.push(`Masa ${periodText} berbeda dari bulan tanggal invoice ${invoiceDate}; masa dari sheet dipakai.`);
      if (periodMonth === 12 && Number(invoiceDate.slice(5, 7)) === 1) periodYear -= 1;
    }

    const rateRaw = get(row, 'rate');
    let workbookRatePercent: string | null = null;
    if (typeof rateRaw === 'number') workbookRatePercent = fromMicro(toMicro(rateRaw * 100), 3);
    else if (cellText(rateRaw)) {
      const parsedRate = numberCell(rateRaw);
      workbookRatePercent = parsedRate === null ? null : fromMicro(toMicro(parsedRate) * 100n, 3);
    }

    const identityRaw = cellText(get(row, 'identity'));
    const identityDigits = identityRaw ? digitsOnly(identityRaw) : '';
    const identityNormalized = identityDigits.length === 15 ? normalizeNpwp(identityDigits).value : identityDigits || null;

    const paidAt = normalizeIsoDate(get(row, 'paidAt'), options);
    const reportedAt = normalizeIsoDate(get(row, 'reportedAt'), options);
    if (paidAt === undefined) warnings.push(`Tanggal bayar "${cellText(get(row, 'paidAt'))}" tidak dikenali; dikosongkan.`);
    if (reportedAt === undefined) warnings.push(`Tanggal lapor "${cellText(get(row, 'reportedAt'))}" tidak dikenali; dikosongkan.`);

    const withholding = numberCell(get(row, 'withholding'));
    parsed.push({
      rowNumber,
      invoiceDate,
      periodMonth,
      periodYear,
      invoiceNumber,
      taxInvoiceNumber: cleanOptional(cellText(get(row, 'taxInvoice')).replace(/^#N\/A$/, '')),
      description: cleanOptional(cellText(get(row, 'description'))),
      objectCode,
      pphArticle,
      counterpartyName,
      counterpartyIdentityDigits: identityNormalized,
      grossAmount,
      workbookRatePercent,
      workbookWithholdingAmount: withholding === null ? null : fromMicro(toMicro(withholding), 0),
      additionalCost: numberCell(get(row, 'additional')) ?? '0',
      workbookVatAmount: numberCell(get(row, 'vat')),
      workbookTotalAmount: numberCell(get(row, 'total')),
      coretaxSlipNumber: cleanOptional(cellText(get(row, 'slipNumber')).replace(/^0$/, '')),
      billingId: cleanOptional(cellText(get(row, 'billingId')).replace(/^0$/, '')),
      ntpn: cleanOptional(cellText(get(row, 'ntpn')).replace(/^0$/, '')),
      paidAt: paidAt ?? null,
      reportedAt: reportedAt ?? null,
      trelloUrl: cleanOptional(cellText(get(row, 'trello'))),
      accountCode: cleanOptional(cellText(get(row, 'account'))),
      accountName: cleanOptional(cellText(get(row, 'accountName'))),
      warnings,
    });
    for (const warning of warnings) issues.push({ level: 'warning', rowNumber, name, message: warning });
  }

  return { headerRowNumber: headerIndex + 1, rows: parsed, issues, skipped };
}

export type CounterpartyLike = {
  id: number;
  name: string;
  identity_type: IdentityType;
  identity_number: string;
  is_active: boolean;
};

export type CounterpartyIndex = {
  byName: Map<string, CounterpartyLike[]>;
  byIdentity: Map<string, CounterpartyLike>;
};

export function normalizeVendorName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildCounterpartyIndex(rows: CounterpartyLike[]): CounterpartyIndex {
  const byName = new Map<string, CounterpartyLike[]>();
  const byIdentity = new Map<string, CounterpartyLike>();
  for (const row of rows) {
    const key = normalizeVendorName(row.name);
    byName.set(key, [...(byName.get(key) ?? []), row]);
    if (UNIQUE_IDENTITY_TYPES.includes(row.identity_type)) byIdentity.set(`${row.identity_type}:${row.identity_number}`, row);
  }
  return { byName, byIdentity };
}

export type CounterpartyMatch = { counterparty: CounterpartyLike | null; problem: string | null };

/**
 * Matches a workbook row to the master. A name match is only accepted when it
 * does not contradict the workbook's NPWP/NIK; ambiguous names (several
 * master rows) and identity conflicts are refused rather than guessed.
 */
export function matchRekapanCounterparty(row: Pick<ParsedRekapanRow, 'counterpartyName' | 'counterpartyIdentityDigits'>, index: CounterpartyIndex): CounterpartyMatch {
  const digits = row.counterpartyIdentityDigits && row.counterpartyIdentityDigits.length === 16 ? row.counterpartyIdentityDigits : null;
  const byIdentity = digits
    ? index.byIdentity.get(`npwp:${digits}`) ?? index.byIdentity.get(`nik:${digits}`) ?? null
    : null;
  const nameMatches = index.byName.get(normalizeVendorName(row.counterpartyName)) ?? [];

  if (nameMatches.length === 1) {
    const candidate = nameMatches[0];
    const candidateHasIdentity = UNIQUE_IDENTITY_TYPES.includes(candidate.identity_type);
    if (digits && candidateHasIdentity && candidate.identity_number !== digits) {
      if (byIdentity) {
        return { counterparty: null, problem: `Nama cocok dengan "${candidate.name}" (${candidate.identity_number}) tetapi NPWP/NIK di sheet (${digits}) milik "${byIdentity.name}"; perbaiki nama atau identitas di sheet.` };
      }
      return { counterparty: null, problem: `Nama cocok dengan master tetapi NPWP/NIK berbeda (master ${candidate.identity_number}, sheet ${digits}); periksa identitas vendor.` };
    }
    return { counterparty: candidate, problem: null };
  }
  if (nameMatches.length > 1) {
    const byDigits = digits ? nameMatches.find((candidate) => candidate.identity_number === digits) ?? null : null;
    if (byDigits) return { counterparty: byDigits, problem: null };
    return { counterparty: null, problem: `Nama "${row.counterpartyName}" ada ${nameMatches.length} kali di master; tambahkan NPWP/NIK di sheet untuk membedakannya.` };
  }
  if (byIdentity) return { counterparty: byIdentity, problem: null };
  return { counterparty: null, problem: 'Lawan transaksi tidak ditemukan di master; tambahkan dahulu.' };
}

export type RekapanComparison = {
  engineWithholding: string;
  workbookWithholding: string | null;
  difference: string | null;
  engineRatePercent: string;
  workbookRatePercent: string | null;
  rateSource: string;
  facilityCode: string;
  explanation: string[];
};

/** Recomputes a workbook row with the rule engine and reports the difference. */
export function compareRekapanRow(
  row: ParsedRekapanRow,
  objectCode: RuleObjectCode,
  counterparty: RuleCounterparty,
  facilities: RuleFacility[],
): RekapanComparison {
  const computed = computeSlip({
    objectCode,
    counterparty,
    facilities,
    transactionDate: row.invoiceDate,
    grossInputMode: 'dpp',
    grossInputAmount: row.grossAmount,
    additionalCost: row.additionalCost,
  });
  const difference = row.workbookWithholdingAmount === null
    ? null
    : fromMicro(toMicro(computed.withholdingAmount) - toMicro(row.workbookWithholdingAmount), 0);
  return {
    engineWithholding: computed.withholdingAmount,
    workbookWithholding: row.workbookWithholdingAmount,
    difference,
    engineRatePercent: computed.ratePercent,
    workbookRatePercent: row.workbookRatePercent,
    rateSource: computed.rateSource,
    facilityCode: computed.facilityCode,
    explanation: computed.explanation,
  };
}
