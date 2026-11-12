// Phase 4: recording the bukti potong numbers Coretax assigns after a BPPU
// file is uploaded. Pure helpers: number validation, parsing of a pasted
// two-column list or a downloaded Coretax sheet, and matching those rows to
// the slips of a masa by the document number that was written in the XML.

import type { DocumentType } from './tax-withholding-domain';
import type { SheetRow } from './tax-withholding-import';
import { toMicro } from './tax-withholding-rules';
import { xmlDocumentNumber } from './tax-withholding-xml';

/** Coretax numbers seen so far are nine upper-case alphanumerics (`26000UK7L`); the bound is kept loose for format changes. */
export const CORETAX_NUMBER_PATTERN = /^(?=.*\d)[0-9A-Z]{6,20}$/;
export const CORETAX_STANDARD_LENGTH = 9;

export function normalizeCoretaxNumber(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase();
}

/** Blocking problem with a Coretax number, or null when it can be stored. */
export function coretaxNumberProblem(value: string): string | null {
  if (!value) return 'Nomor bukti potong kosong.';
  if (!CORETAX_NUMBER_PATTERN.test(value)) return 'Nomor bukti potong harus 6-20 huruf besar/angka (memuat angka) tanpa spasi.';
  return null;
}

/** Non-blocking note for a number that does not look like the usual Coretax format. */
export function coretaxNumberWarning(value: string): string | null {
  if (value && CORETAX_NUMBER_PATTERN.test(value) && value.length !== CORETAX_STANDARD_LENGTH) {
    return `Nomor ${value.length} karakter; nomor Coretax biasanya ${CORETAX_STANDARD_LENGTH} karakter.`;
  }
  return null;
}

export type CoretaxInputRow = {
  /** 1-based line (paste) or Excel row number (sheet) for messages. */
  line: number;
  documentNumber: string | null;
  coretaxNumber: string | null;
  /** Digits of the recipient NPWP/NIK when the source carries one. */
  identity: string | null;
  /** DPP in micro-rupiah when the source carries one. */
  grossMicro: bigint | null;
};

export type CoretaxParseResult = { rows: CoretaxInputRow[]; issues: string[] };

const cellText = (cell: unknown): string => {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
};
const normalizeKey = (value: string): string => value.trim().toUpperCase().replace(/\s+/g, ' ');
const digitsOf = (value: string): string => value.replace(/\D/g, '');

/**
 * DPP from a source cell. A numeric Excel cell is taken as-is (1.234 is one
 * point two three four); only text goes through separator heuristics:
 * `1.234.567,89` and `1,234,567.89` (the last separator is the decimal one),
 * `1000,50` (decimal comma), `1.234` (Indonesian thousands).
 */
export function parseAmount(cell: unknown): bigint | null {
  if (cell === null || cell === undefined || cell === '') return null;
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell)) return null;
    try { return toMicro(cell); } catch { return null; }
  }
  const cleaned = String(cell).replace(/[^\d.,-]/g, '');
  if (!cleaned) return null;
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    normalized = lastComma > lastDot
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = /^-?\d{1,3}(,\d{3})+$/.test(cleaned) && !/^-?\d{1,3},\d{1,2}$/.test(cleaned)
      ? cleaned.replace(/,/g, '')
      : cleaned.replace(/,/g, (match, offset: number) => (offset === lastComma ? '.' : ''));
  } else if (lastDot >= 0) {
    normalized = /^-?\d{1,3}(\.\d{3})+$/.test(cleaned) ? cleaned.replace(/\./g, '') : cleaned;
  } else {
    normalized = cleaned;
  }
  try {
    return toMicro(normalized);
  } catch {
    return null;
  }
}

type ColumnRoles = { coretax: number; document: number; identity: number | null; gross: number | null };

const HEADER_PATTERNS: Record<keyof ColumnRoles, RegExp> = {
  coretax: /nomor bukti potong|no\.? ?bukti potong|nomor bupot|no\.? ?bupot|nomor bpu|bukti potong|nomor bp\b/i,
  document: /nomor dokumen|no\.? ?dokumen|dokumen referensi|nomor referensi|nomor invoice|no\.? ?invoice|nomor faktur|document ?number/i,
  identity: /\bnpwp\b|\bnik\b|identitas|\btin\b|counterpart/i,
  gross: /\bdpp\b|bruto|dasar pengenaan|penghasilan|tax ?base|jumlah penghasilan/i,
};

function detectHeaderRow(rows: SheetRow[]): { index: number; roles: ColumnRoles } | null {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const headers = rows[index].map((cell) => cellText(cell).toLowerCase().replace(/\s+/g, ' '));
    const find = (pattern: RegExp, exclude: number[] = []) => headers.findIndex((header, column) => header && pattern.test(header) && !exclude.includes(column));
    const coretax = find(HEADER_PATTERNS.coretax);
    if (coretax < 0) continue;
    const document = find(HEADER_PATTERNS.document, [coretax]);
    if (document < 0) continue;
    const identity = find(HEADER_PATTERNS.identity, [coretax, document]);
    const gross = find(HEADER_PATTERNS.gross, [coretax, document, identity]);
    return { index, roles: { coretax, document, identity: identity < 0 ? null : identity, gross: gross < 0 ? null : gross } };
  }
  return null;
}

/** Without a header, the column whose values look like Coretax numbers is the number column; the other text column is the document. */
function guessRoles(rows: SheetRow[]): ColumnRoles | null {
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (width < 2) return null;
  const scores = Array.from({ length: width }, () => ({ filled: 0, coretax: 0 }));
  for (const row of rows) {
    row.forEach((cell, column) => {
      const text = cellText(cell);
      if (!text) return;
      scores[column].filled += 1;
      if (CORETAX_NUMBER_PATTERN.test(text.toUpperCase()) && !/^\d+$/.test(text)) scores[column].coretax += 1;
    });
  }
  let coretax = -1;
  scores.forEach((score, column) => {
    if (score.filled > 0 && score.coretax / score.filled >= 0.5 && (coretax < 0 || score.coretax > scores[coretax].coretax)) coretax = column;
  });
  if (coretax < 0) return null;
  let document = -1;
  scores.forEach((score, column) => {
    if (column !== coretax && score.filled > 0 && (document < 0 || score.filled > scores[document].filled)) document = column;
  });
  if (document < 0) return null;
  return { coretax, document, identity: null, gross: null };
}

function rowsToInput(rows: SheetRow[], roles: ColumnRoles, firstDataIndex: number, lineOffset: number): CoretaxParseResult {
  const result: CoretaxParseResult = { rows: [], issues: [] };
  for (let index = firstDataIndex; index < rows.length; index += 1) {
    const row = rows[index];
    const documentNumber = cellText(row[roles.document]);
    const coretaxNumber = normalizeCoretaxNumber(cellText(row[roles.coretax]));
    if (!documentNumber && !coretaxNumber) continue;
    // Old 15-digit NPWP are stored as 16 digits with a leading zero, as the master import does.
    const identityDigits = roles.identity === null ? '' : digitsOf(cellText(row[roles.identity]));
    const identityText = identityDigits.length === 15 ? `0${identityDigits}` : identityDigits;
    result.rows.push({
      line: index + lineOffset,
      documentNumber: documentNumber || null,
      coretaxNumber: coretaxNumber || null,
      identity: identityText.length === 16 ? identityText : null,
      grossMicro: roles.gross === null ? null : parseAmount(row[roles.gross]),
    });
  }
  return result;
}

/** Parses a downloaded Coretax list (xlsx/csv rows); the header row names the columns, or roles are guessed from the values. */
export function parseCoretaxSheetRows(rows: SheetRow[]): CoretaxParseResult {
  const header = detectHeaderRow(rows);
  if (header) return rowsToInput(rows, header.roles, header.index + 1, 1);
  const roles = guessRoles(rows);
  if (!roles) return { rows: [], issues: ['Kolom nomor bukti potong dan nomor dokumen tidak ditemukan. Sertakan baris judul (mis. "Nomor Dokumen" dan "Nomor Bukti Potong") atau tempel dua kolom.'] };
  return rowsToInput(rows, roles, 0, 1);
}

function splitLine(line: string): string[] {
  if (line.includes('\t')) return line.split('\t');
  if (line.includes(';')) return line.split(';');
  if (line.includes('|')) return line.split('|');
  if (/\s{2,}/.test(line.trim())) return line.trim().split(/\s{2,}/);
  const commaParts = line.split(',');
  if (commaParts.length === 2) return commaParts;
  const spaceParts = line.trim().split(/\s+/);
  if (spaceParts.length === 2) return spaceParts;
  return [line];
}

/** Parses text pasted from a spreadsheet: one slip per line, document number and Coretax number separated by tab, `;`, `|`, two spaces or a comma. */
export function parseCoretaxPaste(text: string): CoretaxParseResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const rows: SheetRow[] = lines.map((line) => splitLine(line).map((part) => part.trim()));
  const nonEmpty = rows.filter((row) => row.some((cell) => cell));
  if (nonEmpty.length === 0) return { rows: [], issues: ['Tidak ada baris yang ditempel.'] };
  if (nonEmpty.every((row) => row.filter((cell) => cell).length < 2)) {
    return { rows: [], issues: ['Setiap baris perlu dua kolom: nomor dokumen dan nomor bukti potong Coretax (pisahkan dengan tab, titik koma, atau koma).'] };
  }
  const header = detectHeaderRow(rows);
  if (header) return rowsToInput(rows, header.roles, header.index + 1, 1);
  const roles = guessRoles(rows);
  if (!roles) return { rows: [], issues: ['Kolom nomor bukti potong tidak dikenali; nomor Coretax berupa 6-20 huruf besar/angka (mis. 26000UK7L).'] };
  return rowsToInput(rows, roles, 0, 1);
}

export type CoretaxMatchSlip = {
  id: number;
  invoice_number: string;
  tax_invoice_number: string | null;
  document_type: DocumentType;
  counterparty_identity_number: string;
  gross_amount: string;
  coretax_slip_number: string | null;
};

export type CoretaxAssignment = {
  slipId: number;
  coretaxNumber: string;
  /** How the input row was tied to the slip. */
  matchedBy: 'document' | 'document+identity' | 'document+amount' | 'identity+amount';
  line: number;
};

export type CoretaxMatchResult = {
  assignments: CoretaxAssignment[];
  /** Input rows no slip of the masa claims. */
  unmatched: Array<{ row: CoretaxInputRow; reason: string }>;
  /** Input rows that fit several slips equally well. */
  ambiguous: Array<{ row: CoretaxInputRow; slipIds: number[] }>;
  /** Slips that received different numbers from several rows, or numbers given to several slips. */
  conflicts: string[];
  /** Slips left without a proposal because of a conflict; the user picks their number by hand. */
  conflictedSlipIds: number[];
};

/**
 * Ties parsed rows to slips. The document number Coretax echoes is the one the
 * XML carried (faktur pajak for TaxInvoice, else the commercial invoice), so
 * that key is tried first, then the plain invoice number. NPWP + DPP alone
 * identify a slip only for rows without a document number: a filled number
 * that matches nothing stays unmatched (it may belong to another masa), with
 * the look-alike slip named so the user can type the number there on purpose.
 */
export function matchCoretaxNumbers(slips: CoretaxMatchSlip[], rows: CoretaxInputRow[]): CoretaxMatchResult {
  const byDocument = new Map<string, CoretaxMatchSlip[]>();
  const byInvoice = new Map<string, CoretaxMatchSlip[]>();
  const push = (map: Map<string, CoretaxMatchSlip[]>, key: string, slip: CoretaxMatchSlip) => {
    if (!key) return;
    const list = map.get(key) ?? [];
    if (!list.includes(slip)) list.push(slip);
    map.set(key, list);
  };
  for (const slip of slips) {
    push(byDocument, normalizeKey(xmlDocumentNumber(slip)), slip);
    push(byInvoice, normalizeKey(slip.invoice_number), slip);
  }
  const grossOf = (slip: CoretaxMatchSlip): bigint | null => {
    try { return toMicro(slip.gross_amount); } catch { return null; }
  };

  const result: CoretaxMatchResult = { assignments: [], unmatched: [], ambiguous: [], conflicts: [], conflictedSlipIds: [] };
  const numberBySlip = new Map<number, CoretaxAssignment>();
  const conflicted = new Set<number>();
  const lookAlikes = (row: CoretaxInputRow) => (row.identity && row.grossMicro !== null
    ? slips.filter((slip) => digitsOf(slip.counterparty_identity_number) === row.identity && grossOf(slip) === row.grossMicro)
    : []);
  for (const row of rows) {
    if (!row.coretaxNumber) {
      result.unmatched.push({ row, reason: 'Nomor bukti potong kosong.' });
      continue;
    }
    let candidates: CoretaxMatchSlip[] = [];
    let matchedBy: CoretaxAssignment['matchedBy'] = 'document';
    if (row.documentNumber) {
      const key = normalizeKey(row.documentNumber);
      candidates = byDocument.get(key) ?? byInvoice.get(key) ?? [];
      if (candidates.length > 1 && row.identity) {
        const narrowed = candidates.filter((slip) => digitsOf(slip.counterparty_identity_number) === row.identity);
        if (narrowed.length > 0) { candidates = narrowed; matchedBy = 'document+identity'; }
      }
      if (candidates.length > 1 && row.grossMicro !== null) {
        const narrowed = candidates.filter((slip) => grossOf(slip) === row.grossMicro);
        if (narrowed.length > 0) { candidates = narrowed; matchedBy = 'document+amount'; }
      }
    }
    if (candidates.length === 0 && !row.documentNumber) {
      candidates = lookAlikes(row);
      matchedBy = 'identity+amount';
    }
    if (candidates.length === 0) {
      if (!row.documentNumber) {
        result.unmatched.push({ row, reason: 'Baris tanpa nomor dokumen; NPWP + DPP tidak cocok dengan bukti potong mana pun.' });
        continue;
      }
      const similar = lookAlikes(row).map((slip) => xmlDocumentNumber(slip) || slip.invoice_number);
      result.unmatched.push({
        row,
        reason: `Nomor dokumen ${row.documentNumber} tidak ada di bukti potong masa ini.${similar.length > 0 ? ` NPWP + DPP sama dengan ${similar.join(', ')}; ketik nomornya di baris itu bila memang dokumen yang sama.` : ''}`,
      });
      continue;
    }
    if (candidates.length > 1) {
      result.ambiguous.push({ row, slipIds: candidates.map((slip) => slip.id) });
      continue;
    }
    const slip = candidates[0];
    if (conflicted.has(slip.id)) continue;
    const existing = numberBySlip.get(slip.id);
    if (existing && existing.coretaxNumber !== row.coretaxNumber) {
      // Neither number is proposed: the user resolves the slip by hand.
      result.conflicts.push(`Dokumen ${xmlDocumentNumber(slip) || slip.invoice_number} mendapat dua nomor berbeda (${existing.coretaxNumber} baris ${existing.line}, ${row.coretaxNumber} baris ${row.line}); tidak ada yang diusulkan.`);
      numberBySlip.delete(slip.id);
      conflicted.add(slip.id);
      continue;
    }
    if (!existing) numberBySlip.set(slip.id, { slipId: slip.id, coretaxNumber: row.coretaxNumber, matchedBy, line: row.line });
  }
  const slipsByNumber = new Map<string, number[]>();
  for (const assignment of numberBySlip.values()) {
    const list = slipsByNumber.get(assignment.coretaxNumber) ?? [];
    list.push(assignment.slipId);
    slipsByNumber.set(assignment.coretaxNumber, list);
  }
  for (const [number, slipIds] of slipsByNumber) {
    if (slipIds.length > 1) {
      result.conflicts.push(`Nomor ${number} dipakai ${slipIds.length} bukti potong sekaligus; tidak ada yang diusulkan.`);
      for (const slipId of slipIds) { numberBySlip.delete(slipId); conflicted.add(slipId); }
    }
  }
  result.assignments = [...numberBySlip.values()];
  result.conflictedSlipIds = [...conflicted];
  return result;
}
