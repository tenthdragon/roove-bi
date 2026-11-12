'use server';

// Phase 4: record the bukti potong numbers Coretax assigned to an exported
// batch (moving slips to `reported`), correct or clear a recorded number, and
// summarise a year per masa and KAP/KJS as the basis for ID Billing.

import * as XLSX from 'xlsx';
import { createServiceSupabase } from './supabase-server';
import { requireDashboardTabAccess } from './dashboard-access';
import type { DocumentType, IdentityType, SlipStatus, TaxArticle } from './tax-withholding-domain';
import { fromMicro, toMicro } from './tax-withholding-rules';
import { sheetToRows } from './tax-withholding-sheet';
import {
  coretaxNumberProblem,
  coretaxNumberWarning,
  matchCoretaxNumbers,
  normalizeCoretaxNumber,
  parseCoretaxPaste,
  parseCoretaxSheetRows,
  type CoretaxAssignment,
  type CoretaxInputRow,
} from './tax-withholding-coretax';
import { xmlDocumentNumber } from './tax-withholding-xml';

const TAB_ID = 'tax-withholding';
const TAB_LABEL = 'Bukti Potong (PPh)';
const MANAGE_ROLES = ['owner', 'admin', 'direktur_finance', 'staf_finance'];
const PAGE_SIZE = 1000;
const MAX_RECORD_SLIPS = 2000;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_PASTE_CHARS = 2_000_000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };
async function fetchAllRows<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await page(from, from + PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const chunk = result.data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) return rows;
  }
}

async function requireTaxAccess() {
  const ctx = await requireDashboardTabAccess(TAB_ID, TAB_LABEL);
  return { ...ctx, canManage: MANAGE_ROLES.includes(ctx.profile.role) };
}
async function requireTaxManageAccess() {
  const ctx = await requireTaxAccess();
  if (!ctx.canManage) throw new Error('Hanya role finance yang dapat mencatat nomor bukti potong.');
  return ctx;
}

export type CoretaxPeriodInput = { entityId: number; year: number; month: number };

function checkPeriod(input: CoretaxPeriodInput) {
  if (!Number.isInteger(input.entityId) || input.entityId <= 0) throw new Error('Pemotong wajib dipilih.');
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) throw new Error('Masa pajak tidak valid.');
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) throw new Error('Tahun pajak tidak valid.');
}

async function loadEntity(workspaceId: string, entityId: number): Promise<{ id: number; legal_name: string; is_active: boolean }> {
  const svc = createServiceSupabase();
  const result = await svc.from('tax_withholding_entities').select('id, legal_name, is_active')
    .eq('workspace_id', workspaceId).eq('id', entityId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Pemotong tidak ditemukan di workspace ini.');
  return { id: Number(result.data.id), legal_name: String(result.data.legal_name), is_active: Boolean(result.data.is_active) };
}

const SLIP_COLUMNS = 'id, status, invoice_number, tax_invoice_number, document_type, invoice_date, description, counterparty_name, counterparty_identity_type, counterparty_identity_number, object_code, pph_article, gross_amount, withholding_amount, export_batch_id, coretax_slip_number, updated_at';

type SlipRow = {
  id: number;
  status: SlipStatus;
  invoice_number: string;
  tax_invoice_number: string | null;
  document_type: DocumentType;
  invoice_date: string;
  description: string | null;
  counterparty_name: string;
  counterparty_identity_type: IdentityType;
  counterparty_identity_number: string;
  object_code: string;
  pph_article: TaxArticle;
  gross_amount: string;
  withholding_amount: string;
  export_batch_id: number | null;
  coretax_slip_number: string | null;
  updated_at: string;
};

function normalizeSlipRow(row: Record<string, unknown>): SlipRow {
  return {
    ...(row as unknown as SlipRow),
    id: Number(row.id),
    export_batch_id: row.export_batch_id === null || row.export_batch_id === undefined ? null : Number(row.export_batch_id),
    gross_amount: fromMicro(toMicro(String(row.gross_amount))),
    withholding_amount: fromMicro(toMicro(String(row.withholding_amount)), 0),
  };
}

/** Exported and reported slips of the masa (the ones Coretax has or will have a number for). */
async function loadHandedSlips(workspaceId: string, input: CoretaxPeriodInput, ids?: number[]): Promise<SlipRow[]> {
  const svc = createServiceSupabase();
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) => {
    let query = svc.from('tax_withholding_slips').select(SLIP_COLUMNS)
      .eq('workspace_id', workspaceId).eq('entity_id', input.entityId)
      .eq('period_year', input.year).eq('period_month', input.month)
      .in('status', ['exported', 'reported']);
    if (ids) query = query.in('id', ids);
    return query.order('invoice_date').order('id').range(from, to);
  });
  return rows.map(normalizeSlipRow);
}

export type CoretaxCandidateAction = 'record' | 'replace' | 'keep' | 'none';

export type CoretaxCandidate = {
  id: number;
  status: SlipStatus;
  invoice_date: string;
  invoice_number: string;
  /** The DocumentNumber Coretax received (faktur pajak for TaxInvoice). */
  document_number: string;
  description: string | null;
  counterparty_name: string;
  counterparty_identity_type: IdentityType;
  object_code: string;
  pph_article: TaxArticle;
  gross_amount: string;
  withholding_amount: string;
  export_batch_id: number | null;
  coretax_slip_number: string | null;
  /** Row version to send back with the number. */
  updated_at: string;
  proposedNumber: string | null;
  matchedBy: CoretaxAssignment['matchedBy'] | null;
  /** What recording the proposed number would do to this slip. */
  action: CoretaxCandidateAction;
  problems: string[];
  warnings: string[];
};

export type CoretaxBatchSummary = {
  id: number;
  sequence: number;
  file_name: string;
  created_at: string;
  exported_count: number;
  reported_count: number;
};

export type CoretaxRecordingPreview = {
  entity: { id: number; legal_name: string };
  maxRecordSlips: number;
  candidates: CoretaxCandidate[];
  /** Parsed input rows and what happened to them. */
  parsedRows: number;
  unmatched: Array<{ line: number; documentNumber: string | null; coretaxNumber: string | null; reason: string }>;
  ambiguous: Array<{ line: number; documentNumber: string | null; coretaxNumber: string | null; slipIds: number[] }>;
  conflicts: string[];
  issues: string[];
  totals: { exported: number; reported: number; record: number; replace: number; blocked: number };
  batches: CoretaxBatchSummary[];
};

async function loadBatchSummaries(workspaceId: string, input: CoretaxPeriodInput, slips: SlipRow[]): Promise<CoretaxBatchSummary[]> {
  const svc = createServiceSupabase();
  const result = await svc.from('tax_export_batches').select('id, sequence, file_name, created_at')
    .eq('workspace_id', workspaceId).eq('entity_id', input.entityId)
    .eq('period_year', input.year).eq('period_month', input.month).order('sequence');
  if (result.error) throw result.error;
  return (result.data ?? []).map((row) => {
    const id = Number(row.id);
    const attached = slips.filter((slip) => slip.export_batch_id === id);
    return {
      id,
      sequence: Number(row.sequence),
      file_name: String(row.file_name),
      created_at: String(row.created_at),
      exported_count: attached.filter((slip) => slip.status === 'exported').length,
      reported_count: attached.filter((slip) => slip.status === 'reported').length,
    };
  });
}

async function parseUpload(formData: FormData): Promise<{ rows: CoretaxInputRow[]; issues: string[] } | null> {
  const file = formData.get('file');
  const text = String(formData.get('text') ?? '');
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('Ukuran file melebihi 15 MB.');
    if (!/\.(xlsx|xlsm|xls|csv|txt)$/i.test(file.name)) throw new Error('Format file harus .xlsx, .xlsm, .csv, atau .txt.');
    // Delimited text goes through SheetJS too, so quoted fields, comma/semicolon/tab
    // delimiters and extra columns are handled like a workbook sheet.
    const workbook = /\.(csv|txt)$/i.test(file.name)
      ? XLSX.read(await file.text(), { type: 'string', raw: true })
      : XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const issues: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const parsed = parseCoretaxSheetRows(sheetToRows(sheet));
      if (parsed.rows.length > 0) return parsed;
      issues.push(...parsed.issues.map((issue) => `Sheet ${sheetName}: ${issue}`));
    }
    return { rows: [], issues: issues.length > 0 ? issues : ['Tidak ada baris nomor bukti potong di workbook ini.'] };
  }
  if (text.trim()) {
    if (text.length > MAX_PASTE_CHARS) throw new Error('Teks yang ditempel terlalu panjang.');
    return parseCoretaxPaste(text);
  }
  return null;
}

function readPeriod(formData: FormData): CoretaxPeriodInput & { batchId: number | null } {
  const input = { entityId: Number(formData.get('entityId')), year: Number(formData.get('year')), month: Number(formData.get('month')) };
  checkPeriod(input);
  const batchRaw = String(formData.get('batchId') ?? '').trim();
  const batchId = batchRaw ? Number(batchRaw) : null;
  if (batchId !== null && (!Number.isInteger(batchId) || batchId <= 0)) throw new Error('Batch tidak valid.');
  return { ...input, batchId };
}

/**
 * Lists the exported/reported slips of the masa and, when a pasted list or a
 * Coretax download is included, the number each slip would receive. Reads only.
 * Fields: entityId, year, month, batchId (optional), text or file (optional).
 */
export async function previewCoretaxRecording(formData: FormData): Promise<CoretaxRecordingPreview> {
  const { workspaceId } = await requireTaxAccess();
  const { batchId, ...period } = readPeriod(formData);
  const [entity, allSlips, parsed] = await Promise.all([
    loadEntity(workspaceId, period.entityId),
    loadHandedSlips(workspaceId, period),
    parseUpload(formData),
  ]);
  const batches = await loadBatchSummaries(workspaceId, period, allSlips);
  const slips = batchId === null ? allSlips : allSlips.filter((slip) => slip.export_batch_id === batchId);
  const match = parsed ? matchCoretaxNumbers(slips, parsed.rows) : null;
  const assignmentBySlip = new Map((match?.assignments ?? []).map((assignment) => [assignment.slipId, assignment]));
  const conflictedSlips = new Set(match?.conflictedSlipIds ?? []);

  const candidates: CoretaxCandidate[] = slips.map((slip) => {
    const assignment = assignmentBySlip.get(slip.id) ?? null;
    const proposedNumber = assignment?.coretaxNumber ?? null;
    const problems: string[] = [];
    const warnings: string[] = [];
    let action: CoretaxCandidateAction = 'none';
    if (conflictedSlips.has(slip.id)) problems.push('Sumber memberi nomor yang bertentangan untuk bukti potong ini; ketik nomor yang benar.');
    if (proposedNumber) {
      const problem = coretaxNumberProblem(proposedNumber);
      if (problem) problems.push(problem);
      const warning = coretaxNumberWarning(proposedNumber);
      if (warning) warnings.push(warning);
      if (slip.status === 'reported') {
        action = slip.coretax_slip_number === proposedNumber ? 'keep' : 'replace';
      } else {
        action = 'record';
      }
    }
    return {
      id: slip.id,
      status: slip.status,
      invoice_date: slip.invoice_date,
      invoice_number: slip.invoice_number,
      document_number: xmlDocumentNumber(slip) || slip.invoice_number,
      description: slip.description,
      counterparty_name: slip.counterparty_name,
      counterparty_identity_type: slip.counterparty_identity_type,
      object_code: slip.object_code,
      pph_article: slip.pph_article,
      gross_amount: slip.gross_amount,
      withholding_amount: slip.withholding_amount,
      export_batch_id: slip.export_batch_id,
      coretax_slip_number: slip.coretax_slip_number,
      updated_at: slip.updated_at,
      proposedNumber,
      matchedBy: assignment?.matchedBy ?? null,
      action: problems.length > 0 ? 'none' : action,
      problems,
      warnings,
    };
  });

  const rowView = (row: CoretaxInputRow) => ({ line: row.line, documentNumber: row.documentNumber, coretaxNumber: row.coretaxNumber });
  return {
    entity: { id: entity.id, legal_name: entity.legal_name },
    maxRecordSlips: MAX_RECORD_SLIPS,
    candidates,
    parsedRows: parsed?.rows.length ?? 0,
    unmatched: (match?.unmatched ?? []).map(({ row, reason }) => ({ ...rowView(row), reason })),
    ambiguous: (match?.ambiguous ?? []).map(({ row, slipIds }) => ({ ...rowView(row), slipIds })),
    conflicts: match?.conflicts ?? [],
    issues: parsed?.issues ?? [],
    totals: {
      exported: candidates.filter((row) => row.status === 'exported').length,
      reported: candidates.filter((row) => row.status === 'reported').length,
      record: candidates.filter((row) => row.action === 'record').length,
      replace: candidates.filter((row) => row.action === 'replace').length,
      blocked: candidates.filter((row) => row.problems.length > 0).length,
    },
    batches,
  };
}

export type CoretaxNumberAssignment = { slipId: number; coretaxNumber: string; version: string };

export type CoretaxRecordResult = { recorded: number; replaced: number };

/**
 * Stores the numbers and marks the slips reported, in one database transaction
 * that re-checks status and version under the lock. Replacing a number already
 * recorded on a reported slip needs allowReplace.
 */
export async function recordCoretaxNumbers(input: CoretaxPeriodInput & { assignments: CoretaxNumberAssignment[]; allowReplace?: boolean }): Promise<CoretaxRecordResult> {
  const { workspaceId, profile } = await requireTaxManageAccess();
  checkPeriod(input);
  const assignments = (input.assignments ?? []).map((assignment) => ({
    slipId: Number(assignment.slipId),
    coretaxNumber: normalizeCoretaxNumber(assignment.coretaxNumber),
    version: String(assignment.version ?? ''),
  }));
  if (assignments.length === 0) throw new Error('Tidak ada nomor bukti potong untuk dicatat.');
  if (assignments.length > MAX_RECORD_SLIPS) throw new Error(`Maksimal ${MAX_RECORD_SLIPS} bukti potong per pencatatan.`);
  const ids = assignments.map((assignment) => assignment.slipId);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error('Daftar bukti potong tidak valid.');
  if (new Set(ids).size !== ids.length) throw new Error('Bukti potong yang sama dikirim lebih dari sekali.');
  for (const assignment of assignments) {
    const problem = coretaxNumberProblem(assignment.coretaxNumber);
    if (problem) throw new Error(`Bukti potong #${assignment.slipId}: ${problem}`);
    if (!assignment.version) throw new Error(`Bukti potong #${assignment.slipId}: versi baris tidak dikirim; muat ulang.`);
  }
  const numbers = assignments.map((assignment) => assignment.coretaxNumber);
  if (new Set(numbers).size !== numbers.length) throw new Error('Nomor bukti potong yang sama diberikan ke beberapa bukti potong.');

  const slips = await loadHandedSlips(workspaceId, input, ids);
  if (slips.length !== ids.length) throw new Error('Sebagian bukti potong tidak ditemukan di masa ini atau belum di-export; muat ulang.');
  const allowReplace = Boolean(input.allowReplace);
  const byId = new Map(slips.map((slip) => [slip.id, slip]));
  let replaced = 0;
  for (const assignment of assignments) {
    const slip = byId.get(assignment.slipId)!;
    if (slip.status === 'reported') {
      if (!allowReplace) throw new Error(`Bukti potong ${slip.invoice_number} sudah tercatat (${slip.coretax_slip_number}); centang izin ganti nomor untuk menimpanya.`);
      if (slip.coretax_slip_number !== assignment.coretaxNumber) replaced += 1;
    }
  }

  const svc = createServiceSupabase();
  const result = await svc.rpc('tax_record_coretax_numbers', {
    p_workspace_id: workspaceId,
    p_entity_id: input.entityId,
    p_slip_ids: ids,
    p_numbers: numbers,
    p_versions: assignments.map((assignment) => assignment.version),
    p_allow_replace: allowReplace,
    p_recorded_by: profile.id,
  });
  if (result.error) throw new Error(translateRecordError(result.error.message));
  return { recorded: Number(result.data ?? ids.length), replaced };
}

function translateRecordError(message: string): string {
  if (/berubah sejak dibaca|bukan status di-export/i.test(message)) return 'Sebagian bukti potong berubah sejak pratinjau (dibatalkan dari batch, di-export ulang, atau sudah dicatat). Muat ulang lalu coba lagi.';
  if (/sudah dipakai bukti potong lain/i.test(message)) return message.replace(/^[^:]*: ?/, 'Nomor bukti potong sudah dipakai bukti potong lain di pemotong ini: ');
  if (/nonaktif/i.test(message)) return 'Pemotong tidak ditemukan atau nonaktif.';
  return message;
}

/** Removes a recorded number: the slip returns to `exported` so it can be recorded again or voided. `version` is the updated_at the caller saw. */
export async function clearCoretaxNumber(input: { slipId: number; version: string }): Promise<void> {
  const { workspaceId } = await requireTaxManageAccess();
  if (!Number.isInteger(input.slipId) || input.slipId <= 0) throw new Error('Bukti potong tidak valid.');
  const version = String(input.version ?? '');
  if (!version) throw new Error('Versi baris tidak dikirim; muat ulang.');
  const svc = createServiceSupabase();
  const current = await svc.from('tax_withholding_slips').select('id, status, export_batch_id, updated_at')
    .eq('workspace_id', workspaceId).eq('id', input.slipId).maybeSingle();
  if (current.error) throw current.error;
  if (!current.data) throw new Error('Bukti potong tidak ditemukan.');
  if (current.data.status !== 'reported') throw new Error('Hanya bukti potong berstatus dilaporkan yang nomornya dapat dihapus.');
  if (current.data.export_batch_id === null) {
    throw new Error('Bukti potong ini dilaporkan tanpa batch export di Roove BI (hasil impor); ubah nomornya lewat "Ubah nomor", bukan dihapus.');
  }
  const update = await svc.from('tax_withholding_slips')
    .update({ coretax_slip_number: null, status: 'exported', coretax_recorded_at: null, coretax_recorded_by: null })
    .eq('workspace_id', workspaceId).eq('id', input.slipId).eq('status', 'reported').not('export_batch_id', 'is', null)
    // The version the dialog showed: a number corrected meanwhile is not silently deleted.
    .eq('updated_at', version)
    .select('id');
  if (update.error) throw update.error;
  if (!update.data || update.data.length !== 1) throw new Error('Bukti potong berubah sejak dibuka (nomor diubah orang lain atau status berganti); muat ulang.');
}

// ---------------------------------------------------------------------------
// Rekap per masa dan KAP/KJS
// ---------------------------------------------------------------------------

export type TaxSummaryGroup = {
  article: TaxArticle;
  kap: string | null;
  kjs: string | null;
  objectCodes: string[];
  count: number;
  grossAmount: string;
  withholdingAmount: string;
  byStatus: Record<SlipStatus, number>;
  /** PPh of slips not yet reported to Coretax (draft, ready, exported). */
  pendingWithholdingAmount: string;
};

export type TaxMonthlySummary = {
  month: number;
  count: number;
  grossAmount: string;
  withholdingAmount: string;
  byStatus: Record<SlipStatus, number>;
  groups: TaxSummaryGroup[];
};

export type TaxYearSummary = {
  entity: { id: number; legal_name: string };
  year: number;
  count: number;
  grossAmount: string;
  withholdingAmount: string;
  months: TaxMonthlySummary[];
  /** The year's totals per pasal + KAP + KJS. */
  groups: TaxSummaryGroup[];
};

type GroupAccumulator = {
  article: TaxArticle;
  kap: string | null;
  kjs: string | null;
  objectCodes: Set<string>;
  count: number;
  gross: bigint;
  withholding: bigint;
  pending: bigint;
  byStatus: Record<SlipStatus, number>;
};

const emptyStatus = (): Record<SlipStatus, number> => ({ draft: 0, ready: 0, exported: 0, reported: 0, paid: 0 });
const PENDING_STATUSES: readonly SlipStatus[] = ['draft', 'ready', 'exported'];

function finishGroup(group: GroupAccumulator): TaxSummaryGroup {
  return {
    article: group.article,
    kap: group.kap,
    kjs: group.kjs,
    objectCodes: [...group.objectCodes].sort(),
    count: group.count,
    grossAmount: fromMicro(group.gross),
    withholdingAmount: fromMicro(group.withholding, 0),
    byStatus: group.byStatus,
    pendingWithholdingAmount: fromMicro(group.pending, 0),
  };
}

const compareGroups = (a: TaxSummaryGroup, b: TaxSummaryGroup) =>
  a.article.localeCompare(b.article) || (a.kap ?? '').localeCompare(b.kap ?? '') || (a.kjs ?? '').localeCompare(b.kjs ?? '');

/** DPP and PPh per masa, split by pasal + KAP + KJS: one group is one ID Billing. */
export async function getTaxYearSummary(input: { entityId: number; year: number }): Promise<TaxYearSummary> {
  const { workspaceId } = await requireTaxAccess();
  if (!Number.isInteger(input.entityId) || input.entityId <= 0) throw new Error('Pemotong wajib dipilih.');
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) throw new Error('Tahun pajak tidak valid.');
  const svc = createServiceSupabase();
  const [entity, slips, codes] = await Promise.all([
    loadEntity(workspaceId, input.entityId),
    fetchAllRows<{ period_month: number; pph_article: TaxArticle; object_code: string; status: SlipStatus; gross_amount: string; withholding_amount: string }>((from, to) => svc
      .from('tax_withholding_slips').select('period_month, pph_article, object_code, status, gross_amount, withholding_amount')
      .eq('workspace_id', workspaceId).eq('entity_id', input.entityId).eq('period_year', input.year)
      .order('id').range(from, to)),
    fetchAllRows<{ code: string; kap: string | null; kjs: string | null }>((from, to) => svc
      .from('tax_object_codes').select('code, kap, kjs').order('code').range(from, to)),
  ]);
  const codeMap = new Map(codes.map((code) => [code.code, { kap: code.kap ?? null, kjs: code.kjs ?? null }]));

  const monthGroups = new Map<number, Map<string, GroupAccumulator>>();
  const yearGroups = new Map<string, GroupAccumulator>();
  const monthTotals = new Map<number, { count: number; gross: bigint; withholding: bigint; byStatus: Record<SlipStatus, number> }>();
  let totalCount = 0;
  let totalGross = 0n;
  let totalWithholding = 0n;

  const accumulate = (groups: Map<string, GroupAccumulator>, key: string, seed: Omit<GroupAccumulator, 'objectCodes' | 'count' | 'gross' | 'withholding' | 'pending' | 'byStatus'>, slip: typeof slips[number], gross: bigint, withholding: bigint) => {
    const group = groups.get(key) ?? { ...seed, objectCodes: new Set<string>(), count: 0, gross: 0n, withholding: 0n, pending: 0n, byStatus: emptyStatus() };
    group.objectCodes.add(slip.object_code);
    group.count += 1;
    group.gross += gross;
    group.withholding += withholding;
    if (PENDING_STATUSES.includes(slip.status)) group.pending += withholding;
    group.byStatus[slip.status] += 1;
    groups.set(key, group);
  };

  for (const slip of slips) {
    const month = Number(slip.period_month);
    const gross = toMicro(String(slip.gross_amount));
    const withholding = toMicro(String(slip.withholding_amount));
    const code = codeMap.get(slip.object_code) ?? { kap: null, kjs: null };
    const key = `${slip.pph_article}|${code.kap ?? ''}|${code.kjs ?? ''}`;
    const seed = { article: slip.pph_article, kap: code.kap, kjs: code.kjs };
    const groups = monthGroups.get(month) ?? new Map<string, GroupAccumulator>();
    accumulate(groups, key, seed, slip, gross, withholding);
    monthGroups.set(month, groups);
    accumulate(yearGroups, key, seed, slip, gross, withholding);
    const total = monthTotals.get(month) ?? { count: 0, gross: 0n, withholding: 0n, byStatus: emptyStatus() };
    total.count += 1;
    total.gross += gross;
    total.withholding += withholding;
    total.byStatus[slip.status] += 1;
    monthTotals.set(month, total);
    totalCount += 1;
    totalGross += gross;
    totalWithholding += withholding;
  }

  const months: TaxMonthlySummary[] = [...monthTotals.entries()].sort((a, b) => a[0] - b[0]).map(([month, total]) => ({
    month,
    count: total.count,
    grossAmount: fromMicro(total.gross),
    withholdingAmount: fromMicro(total.withholding, 0),
    byStatus: total.byStatus,
    groups: [...(monthGroups.get(month) ?? new Map()).values()].map(finishGroup).sort(compareGroups),
  }));

  return {
    entity: { id: entity.id, legal_name: entity.legal_name },
    year: input.year,
    count: totalCount,
    grossAmount: fromMicro(totalGross),
    withholdingAmount: fromMicro(totalWithholding, 0),
    months,
    groups: [...yearGroups.values()].map(finishGroup).sort(compareGroups),
  };
}
