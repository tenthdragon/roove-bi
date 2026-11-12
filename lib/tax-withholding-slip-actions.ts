'use server';

import * as XLSX from 'xlsx';
import { sheetToRows } from './tax-withholding-sheet';
import { createServiceSupabase } from './supabase-server';
import { requireDashboardTabAccess } from './dashboard-access';
import {
  DOCUMENT_TYPES,
  UNIQUE_IDENTITY_TYPES,
  checkImportWorkspace,
  cleanOptional,
  digitsOnly,
  normalizeIsoDate,
  type DocumentType,
  type FacilityCode,
  type IdentityType,
  type SlipStatus,
  type TaxArticle,
} from './tax-withholding-domain';

export type { DocumentType, SlipStatus } from './tax-withholding-domain';
import type { ImportIssue, SheetRow } from './tax-withholding-import';
import {
  buildCounterpartyIndex,
  compareRekapanRow,
  matchRekapanCounterparty,
  parseRekapan,
  type CounterpartyIndex,
  type ParsedRekapanRow,
} from './tax-withholding-rekapan-import';
import {
  computeSlip,
  deriveConsistentRatePercent,
  fromMicro,
  periodFromDate,
  periodStartIso,
  toMicro,
  type GrossInputMode,
  type RateSource,
  type RuleFacility,
  type RuleObjectCode,
} from './tax-withholding-rules';

const TAB_ID = 'tax-withholding';
const TAB_LABEL = 'Bukti Potong (PPh)';
const MANAGE_ROLES = ['owner', 'admin', 'direktur_finance', 'staf_finance'];
const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
const PAGE_SIZE = 1000;
const EDITABLE_STATUSES = ['draft', 'ready'];


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
  if (!ctx.canManage) throw new Error('Hanya role finance yang dapat mengubah bukti potong.');
  return ctx;
}

export type TaxObjectCodeOption = {
  code: string;
  name: string;
  pph_article: TaxArticle;
  rate_percent: number;
  kap: string | null;
  kjs: string | null;
};

export type TaxSlip = {
  id: number;
  entity_id: number;
  counterparty_id: number;
  counterparty_name: string;
  counterparty_identity_type: IdentityType;
  counterparty_identity_number: string;
  period_month: number;
  period_year: number;
  invoice_date: string;
  invoice_number: string;
  tax_invoice_number: string | null;
  description: string | null;
  object_code: string;
  pph_article: TaxArticle;
  gross_input_mode: GrossInputMode;
  gross_input_amount: string;
  gross_amount: string;
  rate_percent: string;
  rate_source: RateSource;
  rate_override_reason: string | null;
  facility_code: FacilityCode | 'N/A';
  facility_document_number: string | null;
  withholding_amount: string;
  vat_rate_percent: string;
  vat_amount: string;
  additional_cost: string;
  total_amount: string;
  document_type: DocumentType;
  document_date: string;
  withholding_date: string;
  status: SlipStatus;
  coretax_slip_number: string | null;
  account_code: string | null;
  account_name: string | null;
  trello_url: string | null;
  notes: string | null;
  source: 'manual' | 'import_rekapan';
  workbook_withholding_amount: string | null;
  export_batch_id: number | null;
  voided_from_batch_id: number | null;
  void_reason: string | null;
  updated_at: string;
};

const SLIP_COLUMNS = 'id, entity_id, counterparty_id, counterparty_name, counterparty_identity_type, counterparty_identity_number, period_month, period_year, invoice_date, invoice_number, tax_invoice_number, description, object_code, pph_article, gross_input_mode, gross_input_amount, gross_amount, rate_percent, rate_source, rate_override_reason, facility_code, facility_document_number, withholding_amount, vat_rate_percent, vat_amount, additional_cost, total_amount, document_type, document_date, withholding_date, status, coretax_slip_number, account_code, account_name, trello_url, notes, source, workbook_withholding_amount, export_batch_id, voided_from_batch_id, void_reason, updated_at';

function normalizeSlipRow(row: Record<string, unknown>): TaxSlip {
  const text = (key: string) => (row[key] === null || row[key] === undefined ? null : String(row[key]));
  return {
    ...(row as unknown as TaxSlip),
    gross_input_amount: fromMicro(toMicro(String(row.gross_input_amount))),
    gross_amount: fromMicro(toMicro(String(row.gross_amount))),
    rate_percent: fromMicro(toMicro(String(row.rate_percent)), 3),
    withholding_amount: fromMicro(toMicro(String(row.withholding_amount)), 0),
    vat_rate_percent: fromMicro(toMicro(String(row.vat_rate_percent)), 3),
    vat_amount: fromMicro(toMicro(String(row.vat_amount)), 0),
    additional_cost: fromMicro(toMicro(String(row.additional_cost)), 2),
    total_amount: fromMicro(toMicro(String(row.total_amount))),
    workbook_withholding_amount: text('workbook_withholding_amount') === null ? null : fromMicro(toMicro(text('workbook_withholding_amount') as string), 0),
  };
}

export async function getTaxObjectCodes(): Promise<TaxObjectCodeOption[]> {
  await requireTaxAccess();
  const svc = createServiceSupabase();
  const rows = await fetchAllRows<TaxObjectCodeOption>((from, to) => svc
    .from('tax_object_codes')
    .select('code, name, pph_article, rate_percent, kap, kjs')
    .eq('is_active', true)
    .order('code')
    .range(from, to));
  return rows.map((row) => ({ ...row, rate_percent: Number(row.rate_percent) }));
}

export type TaxSlipListFilter = {
  entityId: number;
  year: number;
  month: number;
  status?: SlipStatus | 'all';
  search?: string;
};

export type TaxSlipTotals = {
  count: number;
  byStatus: Record<SlipStatus, number>;
  grossAmount: string;
  withholdingAmount: string;
  byArticle: Array<{ article: TaxArticle; count: number; grossAmount: string; withholdingAmount: string }>;
};

export async function listTaxSlips(filter: TaxSlipListFilter): Promise<{ slips: TaxSlip[]; totals: TaxSlipTotals }> {
  const { workspaceId } = await requireTaxAccess();
  if (!Number.isInteger(filter.entityId) || filter.entityId <= 0) throw new Error('Pemotong wajib dipilih.');
  if (!Number.isInteger(filter.month) || filter.month < 1 || filter.month > 12) throw new Error('Masa pajak tidak valid.');
  if (!Number.isInteger(filter.year) || filter.year < 2000 || filter.year > 2100) throw new Error('Tahun pajak tidak valid.');
  const svc = createServiceSupabase();
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) => svc
    .from('tax_withholding_slips')
    .select(SLIP_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('entity_id', filter.entityId)
    .eq('period_year', filter.year)
    .eq('period_month', filter.month)
    .order('invoice_date')
    .order('id')
    .range(from, to));
  const all = rows.map(normalizeSlipRow);

  const byStatus: Record<SlipStatus, number> = { draft: 0, ready: 0, exported: 0, reported: 0, paid: 0 };
  let gross = 0n;
  let withholding = 0n;
  const articles = new Map<TaxArticle, { count: number; gross: bigint; withholding: bigint }>();
  for (const slip of all) {
    byStatus[slip.status] += 1;
    gross += toMicro(slip.gross_amount);
    withholding += toMicro(slip.withholding_amount);
    const bucket = articles.get(slip.pph_article) ?? { count: 0, gross: 0n, withholding: 0n };
    bucket.count += 1;
    bucket.gross += toMicro(slip.gross_amount);
    bucket.withholding += toMicro(slip.withholding_amount);
    articles.set(slip.pph_article, bucket);
  }

  const needle = (filter.search ?? '').trim().toLowerCase();
  const slips = all.filter((slip) => {
    if (filter.status && filter.status !== 'all' && slip.status !== filter.status) return false;
    if (!needle) return true;
    return slip.counterparty_name.toLowerCase().includes(needle)
      || slip.invoice_number.toLowerCase().includes(needle)
      || (slip.description ?? '').toLowerCase().includes(needle)
      || slip.object_code.includes(needle)
      || (slip.coretax_slip_number ?? '').toLowerCase().includes(needle);
  });

  return {
    slips,
    totals: {
      count: all.length,
      byStatus,
      grossAmount: fromMicro(gross),
      withholdingAmount: fromMicro(withholding, 0),
      byArticle: [...articles.entries()].map(([article, bucket]) => ({
        article, count: bucket.count, grossAmount: fromMicro(bucket.gross), withholdingAmount: fromMicro(bucket.withholding, 0),
      })).sort((a, b) => a.article.localeCompare(b.article)),
    },
  };
}

export type TaxSlipInput = {
  id?: number | null;
  entityId: number;
  counterpartyId: number;
  invoiceDate: string;
  invoiceNumber: string;
  description?: string | null;
  objectCode: string;
  grossInputMode: GrossInputMode;
  grossInputAmount: string | number;
  additionalCost?: string | number | null;
  rateOverridePercent?: string | number | null;
  rateOverrideReason?: string | null;
  documentType?: DocumentType;
  /** Faktur pajak number, required when documentType is TaxInvoice. */
  taxInvoiceNumber?: string | null;
  documentDate?: string | null;
  withholdingDate?: string | null;
  periodMonth?: number | null;
  periodYear?: number | null;
  accountCode?: string | null;
  accountName?: string | null;
  trelloUrl?: string | null;
  notes?: string | null;
};

type CounterpartyRow = {
  id: number;
  name: string;
  identity_type: IdentityType;
  identity_number: string;
  is_pkp: boolean;
  country_code: string;
  is_active: boolean;
};

async function loadCounterpartyWithFacilities(workspaceId: string, counterpartyId: number) {
  const svc = createServiceSupabase();
  const [counterparty, facilities] = await Promise.all([
    svc.from('tax_counterparties').select('id, name, identity_type, identity_number, is_pkp, country_code, is_active')
      .eq('workspace_id', workspaceId).eq('id', counterpartyId).maybeSingle(),
    svc.from('tax_counterparty_facilities').select('facility_code, document_number, applies_to, rate_override, valid_from, valid_to')
      .eq('workspace_id', workspaceId).eq('counterparty_id', counterpartyId),
  ]);
  if (counterparty.error) throw counterparty.error;
  if (facilities.error) throw facilities.error;
  if (!counterparty.data) throw new Error('Lawan transaksi tidak ditemukan di workspace ini.');
  return { counterparty: counterparty.data as CounterpartyRow, facilities: (facilities.data ?? []) as RuleFacility[] };
}

async function loadObjectCode(code: string): Promise<RuleObjectCode> {
  const svc = createServiceSupabase();
  const result = await svc.from('tax_object_codes').select('code, pph_article, rate_percent, is_active').eq('code', code).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data || !result.data.is_active) throw new Error(`Kode objek pajak ${code} tidak dikenal atau tidak aktif.`);
  return result.data as RuleObjectCode;
}

function slipReadiness(counterparty: Pick<CounterpartyRow, 'identity_type' | 'identity_number'>): SlipStatus {
  if (counterparty.identity_type === 'unknown') return 'draft';
  if (UNIQUE_IDENTITY_TYPES.includes(counterparty.identity_type) && !/^[0-9]{16}$/.test(counterparty.identity_number)) return 'draft';
  return 'ready';
}

export async function saveTaxSlip(input: TaxSlipInput): Promise<TaxSlip> {
  const { workspaceId, profile } = await requireTaxManageAccess();
  const svc = createServiceSupabase();
  const errors: string[] = [];

  const invoiceDate = normalizeIsoDate(input.invoiceDate);
  if (!invoiceDate) errors.push('Tanggal invoice wajib diisi.');
  const invoiceNumber = String(input.invoiceNumber ?? '').trim().replace(/\s+/g, ' ');
  if (!invoiceNumber) errors.push('Nomor invoice wajib diisi.');
  if (!Number.isInteger(input.entityId) || input.entityId <= 0) errors.push('Pemotong wajib dipilih.');
  if (!Number.isInteger(input.counterpartyId) || input.counterpartyId <= 0) errors.push('Lawan transaksi wajib dipilih.');
  if (!/^[0-9]{2}-[0-9]{3}-[0-9]{2}$/.test(String(input.objectCode ?? ''))) errors.push('Kode objek pajak wajib dipilih.');
  if (input.grossInputMode !== 'dpp' && input.grossInputMode !== 'total_incl_vat') errors.push('Mode nominal tidak valid.');
  const documentType: DocumentType = input.documentType ?? 'CommercialInvoice';
  if (!DOCUMENT_TYPES.includes(documentType)) errors.push('Jenis dokumen tidak valid.');
  const taxInvoiceNumber = documentType === 'TaxInvoice' ? cleanOptional(input.taxInvoiceNumber) : null;
  if (documentType === 'TaxInvoice' && !taxInvoiceNumber) errors.push('Nomor faktur pajak wajib diisi untuk dokumen TaxInvoice.');
  if (taxInvoiceNumber && digitsOnly(taxInvoiceNumber).length !== 16) errors.push('Nomor faktur pajak harus 16 digit.');
  const hasOverride = input.rateOverridePercent !== null && input.rateOverridePercent !== undefined && String(input.rateOverridePercent).trim() !== '';
  const overrideReason = cleanOptional(input.rateOverrideReason);
  if (hasOverride && !overrideReason) errors.push('Alasan wajib diisi jika tarif diubah manual.');
  if (errors.length > 0) throw new Error(errors.join(' '));

  const entity = await svc.from('tax_withholding_entities').select('id, is_active').eq('workspace_id', workspaceId).eq('id', input.entityId).maybeSingle();
  if (entity.error) throw entity.error;
  if (!entity.data) throw new Error('Pemotong tidak ditemukan di workspace ini.');
  if (!entity.data.is_active) throw new Error('Pemotong nonaktif; aktifkan dahulu di bagian Pemotong atau pilih pemotong lain.');

  const [{ counterparty, facilities }, objectCode] = await Promise.all([
    loadCounterpartyWithFacilities(workspaceId, input.counterpartyId),
    loadObjectCode(input.objectCode),
  ]);
  if (!counterparty.is_active) throw new Error('Lawan transaksi nonaktif; aktifkan dulu atau pilih vendor lain.');

  let existingSlip: { id: number; status: string; period_month: number; period_year: number } | null = null;
  if (input.id) {
    const existing = await svc.from('tax_withholding_slips').select('id, status, period_month, period_year').eq('workspace_id', workspaceId).eq('id', input.id).maybeSingle();
    if (existing.error) throw existing.error;
    if (!existing.data) throw new Error('Bukti potong tidak ditemukan.');
    if (!EDITABLE_STATUSES.includes(existing.data.status)) {
      throw new Error(`Bukti potong berstatus ${existing.data.status} tidak bisa diubah. Batalkan dari batch dahulu.`);
    }
    existingSlip = existing.data;
  }

  const documentDate = normalizeIsoDate(input.documentDate) || invoiceDate!;
  const withholdingDate = normalizeIsoDate(input.withholdingDate) || invoiceDate!;
  // An imported slip may sit in a tax period other than its invoice month
  // (MASA column); an edit that does not state a period keeps the stored one.
  const defaultPeriod = existingSlip
    ? { month: existingSlip.period_month, year: existingSlip.period_year }
    : periodFromDate(invoiceDate!);
  const periodMonth = input.periodMonth ?? defaultPeriod.month;
  const periodYear = input.periodYear ?? defaultPeriod.year;
  if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) throw new Error('Masa pajak tidak valid.');
  if (!Number.isInteger(periodYear) || periodYear < 2000 || periodYear > 2100) throw new Error('Tahun pajak tidak valid.');
  if (withholdingDate < periodStartIso(periodYear, periodMonth)) throw new Error('Tanggal pemotongan tidak boleh lebih awal dari masa pajak.');

  let computed;
  try {
    computed = computeSlip({
      objectCode,
      counterparty,
      facilities,
      transactionDate: invoiceDate!,
      grossInputMode: input.grossInputMode,
      grossInputAmount: input.grossInputAmount,
      additionalCost: input.additionalCost ?? null,
      rateOverridePercent: hasOverride ? input.rateOverridePercent : null,
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
  }

  const payload = {
    workspace_id: workspaceId,
    entity_id: input.entityId,
    counterparty_id: counterparty.id,
    counterparty_name: counterparty.name,
    counterparty_identity_type: counterparty.identity_type,
    counterparty_identity_number: counterparty.identity_number,
    period_month: periodMonth,
    period_year: periodYear,
    invoice_date: invoiceDate,
    invoice_number: invoiceNumber,
    description: cleanOptional(input.description),
    object_code: objectCode.code,
    pph_article: computed.pphArticle,
    gross_input_mode: input.grossInputMode,
    gross_input_amount: fromMicro(toMicro(input.grossInputAmount)),
    gross_amount: computed.grossAmount,
    rate_percent: computed.ratePercent,
    rate_source: computed.rateSource,
    rate_override_reason: hasOverride ? overrideReason : null,
    facility_code: computed.facilityCode,
    facility_document_number: computed.facilityDocumentNumber,
    withholding_amount: computed.withholdingAmount,
    vat_rate_percent: computed.vatRatePercent,
    vat_amount: computed.vatAmount,
    additional_cost: computed.additionalCost,
    total_amount: computed.totalAmount,
    document_type: documentType,
    tax_invoice_number: taxInvoiceNumber,
    document_date: documentDate,
    withholding_date: withholdingDate,
    status: slipReadiness(counterparty),
    account_code: cleanOptional(input.accountCode),
    account_name: cleanOptional(input.accountName),
    trello_url: cleanOptional(input.trelloUrl),
    notes: cleanOptional(input.notes),
  };

  if (input.id) {
    // The status check above is advisory; the UPDATE itself only touches a
    // slip that is still editable, so an export that lands in between leaves
    // the exported row untouched.
    const result = await svc.from('tax_withholding_slips').update(payload)
      .eq('workspace_id', workspaceId).eq('id', input.id).in('status', EDITABLE_STATUSES).is('export_batch_id', null)
      .select(SLIP_COLUMNS);
    if (result.error) throw translateSlipError(result.error);
    if (!result.data || result.data.length !== 1) throw new Error('Bukti potong berubah status saat disimpan (mungkin baru di-export); muat ulang.');
    return normalizeSlipRow(result.data[0]);
  }
  const result = await svc.from('tax_withholding_slips').insert({ ...payload, source: 'manual', created_by: profile.id }).select(SLIP_COLUMNS).single();
  if (result.error) throw translateSlipError(result.error);
  return normalizeSlipRow(result.data);
}

export async function deleteTaxSlip(id: number): Promise<void> {
  const { workspaceId } = await requireTaxManageAccess();
  const svc = createServiceSupabase();
  const existing = await svc.from('tax_withholding_slips').select('id, status').eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) throw new Error('Bukti potong tidak ditemukan.');
  if (!EDITABLE_STATUSES.includes(existing.data.status)) throw new Error(`Bukti potong berstatus ${existing.data.status} tidak bisa dihapus.`);
  // Delete only while still editable: an export committed between the read
  // above and this statement must keep its slip.
  const result = await svc.from('tax_withholding_slips').delete()
    .eq('workspace_id', workspaceId).eq('id', id).in('status', EDITABLE_STATUSES).is('export_batch_id', null)
    .select('id');
  if (result.error) throw result.error;
  if (!result.data || result.data.length !== 1) throw new Error('Bukti potong berubah status saat dihapus (mungkin baru di-export); muat ulang.');
}

export async function previewTaxSlip(input: Omit<TaxSlipInput, 'id'>): Promise<{
  grossAmount: string; ratePercent: string; rateSource: RateSource; facilityCode: string;
  withholdingAmount: string; vatRatePercent: string; vatAmount: string; totalAmount: string; explanation: string[];
}> {
  const { workspaceId } = await requireTaxAccess();
  const invoiceDate = normalizeIsoDate(input.invoiceDate);
  if (!invoiceDate) throw new Error('Tanggal invoice wajib diisi.');
  const [{ counterparty, facilities }, objectCode] = await Promise.all([
    loadCounterpartyWithFacilities(workspaceId, input.counterpartyId),
    loadObjectCode(input.objectCode),
  ]);
  const hasOverride = input.rateOverridePercent !== null && input.rateOverridePercent !== undefined && String(input.rateOverridePercent).trim() !== '';
  const computed = computeSlip({
    objectCode, counterparty, facilities, transactionDate: invoiceDate,
    grossInputMode: input.grossInputMode, grossInputAmount: input.grossInputAmount,
    additionalCost: input.additionalCost ?? null, rateOverridePercent: hasOverride ? input.rateOverridePercent : null,
  });
  return {
    grossAmount: computed.grossAmount, ratePercent: computed.ratePercent, rateSource: computed.rateSource,
    facilityCode: computed.facilityCode, withholdingAmount: computed.withholdingAmount, vatRatePercent: computed.vatRatePercent,
    vatAmount: computed.vatAmount, totalAmount: computed.totalAmount, explanation: computed.explanation,
  };
}

// ---------------------------------------------------------------------------
// REKAPAN import
// ---------------------------------------------------------------------------

export type RekapanPreviewRow = {
  rowNumber: number;
  invoiceDate: string;
  invoiceNumber: string;
  counterpartyName: string;
  counterpartyId: number | null;
  objectCode: string;
  pphArticle: TaxArticle;
  grossAmount: string;
  workbookWithholding: string | null;
  engineWithholding: string | null;
  difference: string | null;
  engineRatePercent: string | null;
  workbookRatePercent: string | null;
  facilityCode: string | null;
  coretaxSlipNumber: string | null;
  status: 'new' | 'existing' | 'blocked';
  problems: string[];
};

export type RekapanImportPreview = {
  workspaceId: string;
  entityId: number;
  fileName: string;
  sheetName: string;
  headerRowNumber: number;
  totalRows: number;
  importable: number;
  existing: number;
  blocked: number;
  skipped: number;
  matchedDifferences: number;
  unmatchedVendors: Array<{ name: string; rows: number }>;
  unknownObjectCodes: string[];
  issues: ImportIssue[];
  rows: RekapanPreviewRow[];
};

export type RekapanImportResult = {
  inserted: number;
  skippedExisting: number;
  blocked: number;
  issues: ImportIssue[];
};

async function readRekapanSheet(formData: FormData): Promise<{ fileName: string; sheetName: string; rows: SheetRow[]; date1904: boolean }> {
  const file = formData.get('file');
  if (!(file instanceof File)) throw new Error('File workbook tidak ditemukan.');
  if (file.size === 0) throw new Error('File kosong.');
  if (file.size > MAX_IMPORT_BYTES) throw new Error('Ukuran file melebihi 15 MB.');
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) throw new Error('Format file harus .xlsx atau .xlsm.');
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  const requested = String(formData.get('sheet') ?? '').trim();
  const candidates = requested ? [requested] : [
    ...workbook.SheetNames.filter((name) => /^rekapan$/i.test(name.trim())),
    ...workbook.SheetNames.filter((name) => !/^rekapan$/i.test(name.trim())),
  ];
  for (const sheetName of candidates) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const headerText = sheetToRows(sheet, { maxRows: 20 }).map((row) => row.map((cell) => String(cell ?? '').toLowerCase().replace(/\s+/g, ' ')).join('|')).join('\n');
    if (headerText.includes('periode invoice') && headerText.includes('no invoice')) return { fileName: file.name, sheetName, rows: sheetToRows(sheet), date1904 };
  }
  throw new Error('Sheet "REKAPAN" tidak ditemukan di workbook ini.');
}

type ImportContext = {
  entityId: number;
  counterparties: Map<number, CounterpartyRow>;
  index: CounterpartyIndex;
  facilitiesByCounterparty: Map<number, RuleFacility[]>;
  objectCodes: Map<string, RuleObjectCode>;
  existingKeys: Set<string>;
};

const slipKey = (entityId: number, counterpartyId: number, objectCode: string, invoiceNumber: string, invoiceDate: string, gross: string) =>
  `${entityId}|${counterpartyId}|${objectCode}|${invoiceNumber.trim().toLowerCase()}|${invoiceDate}|${fromMicro(toMicro(gross))}`;

async function loadImportContext(workspaceId: string, entityId: number): Promise<ImportContext> {
  const svc = createServiceSupabase();
  const entity = await svc.from('tax_withholding_entities').select('id, is_active').eq('workspace_id', workspaceId).eq('id', entityId).maybeSingle();
  if (entity.error) throw entity.error;
  if (!entity.data) throw new Error('Pemotong tidak ditemukan di workspace ini.');
  if (!entity.data.is_active) throw new Error('Pemotong nonaktif; impor REKAPAN memerlukan pemotong aktif.');

  const [counterparties, facilities, objectCodes, existing] = await Promise.all([
    fetchAllRows<CounterpartyRow>((from, to) => svc.from('tax_counterparties')
      .select('id, name, identity_type, identity_number, is_pkp, country_code, is_active').eq('workspace_id', workspaceId).order('id').range(from, to)),
    fetchAllRows<RuleFacility & { counterparty_id: number }>((from, to) => svc.from('tax_counterparty_facilities')
      .select('counterparty_id, facility_code, document_number, applies_to, rate_override, valid_from, valid_to').eq('workspace_id', workspaceId).order('id').range(from, to)),
    fetchAllRows<RuleObjectCode & { is_active: boolean }>((from, to) => svc.from('tax_object_codes')
      .select('code, pph_article, rate_percent, is_active').order('code').range(from, to)),
    fetchAllRows<{ counterparty_id: number; object_code: string; invoice_number: string; invoice_date: string; gross_amount: string }>((from, to) => svc.from('tax_withholding_slips')
      .select('counterparty_id, object_code, invoice_number, invoice_date, gross_amount').eq('workspace_id', workspaceId).eq('entity_id', entityId).order('id').range(from, to)),
  ]);

  const facilityMap = new Map<number, RuleFacility[]>();
  for (const facility of facilities) {
    const list = facilityMap.get(facility.counterparty_id) ?? [];
    list.push(facility);
    facilityMap.set(facility.counterparty_id, list);
  }
  return {
    entityId,
    counterparties: new Map(counterparties.map((row) => [row.id, row])),
    index: buildCounterpartyIndex(counterparties),
    facilitiesByCounterparty: facilityMap,
    objectCodes: new Map(objectCodes.filter((code) => code.is_active).map((code) => [code.code, code])),
    existingKeys: new Set(existing.map((row) => slipKey(entityId, row.counterparty_id, row.object_code, row.invoice_number, row.invoice_date, String(row.gross_amount)))),
  };
}

function matchCounterparty(row: ParsedRekapanRow, context: ImportContext): { counterparty: CounterpartyRow | null; problem: string | null } {
  const match = matchRekapanCounterparty(row, context.index);
  const counterparty = match.counterparty ? context.counterparties.get(match.counterparty.id) ?? null : null;
  return { counterparty, problem: match.problem };
}

function evaluateRekapanRow(row: ParsedRekapanRow, context: ImportContext, amountSource: 'engine' | 'workbook' = 'engine'): RekapanPreviewRow {
  const problems: string[] = [];
  const { counterparty, problem: matchProblem } = matchCounterparty(row, context);
  if (matchProblem) problems.push(matchProblem);
  else if (counterparty && !counterparty.is_active) problems.push('Lawan transaksi nonaktif.');
  const objectCode = context.objectCodes.get(row.objectCode) ?? null;
  if (!objectCode) problems.push(`Kode objek ${row.objectCode} tidak ada di referensi.`);
  else if (objectCode.pph_article !== row.pphArticle) problems.push(`Pasal di sheet (${row.pphArticle}) berbeda dari referensi kode (${objectCode.pph_article}); referensi dipakai.`);

  let comparison: ReturnType<typeof compareRekapanRow> | null = null;
  if (counterparty && objectCode) {
    try {
      comparison = compareRekapanRow(row, objectCode, counterparty, context.facilitiesByCounterparty.get(counterparty.id) ?? []);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (amountSource === 'workbook' && comparison && comparison.difference !== null && comparison.difference !== '0'
    && deriveConsistentRatePercent(row.grossAmount, row.workbookWithholdingAmount ?? '0', [row.workbookRatePercent]) === null) {
    problems.push(`PPh workbook ${row.workbookWithholdingAmount} tidak bisa dihasilkan dari DPP ${row.grossAmount} dengan tarif mana pun; pilih angka engine atau perbaiki sheet.`);
  }
  const blocked = !counterparty || !objectCode || !counterparty.is_active || !comparison || problems.some((text) => /tidak bisa dihasilkan|Nama cocok|ada \d+ kali/.test(text));
  const existing = !blocked && counterparty
    && context.existingKeys.has(slipKey(context.entityId, counterparty.id, row.objectCode, row.invoiceNumber, row.invoiceDate, row.grossAmount));
  return {
    rowNumber: row.rowNumber,
    invoiceDate: row.invoiceDate,
    invoiceNumber: row.invoiceNumber,
    counterpartyName: row.counterpartyName,
    counterpartyId: counterparty?.id ?? null,
    objectCode: row.objectCode,
    pphArticle: objectCode?.pph_article ?? row.pphArticle,
    grossAmount: row.grossAmount,
    workbookWithholding: row.workbookWithholdingAmount,
    engineWithholding: comparison?.engineWithholding ?? null,
    difference: comparison?.difference ?? null,
    engineRatePercent: comparison?.engineRatePercent ?? null,
    workbookRatePercent: row.workbookRatePercent,
    facilityCode: comparison?.facilityCode ?? null,
    coretaxSlipNumber: row.coretaxSlipNumber,
    status: blocked ? 'blocked' : existing ? 'existing' : 'new',
    problems,
  };
}

export async function previewRekapanImport(formData: FormData): Promise<RekapanImportPreview> {
  const { workspaceId } = await requireTaxManageAccess();
  const entityId = Number(formData.get('entityId'));
  if (!Number.isInteger(entityId) || entityId <= 0) throw new Error('Pemotong wajib dipilih.');
  const { fileName, sheetName, rows, date1904 } = await readRekapanSheet(formData);
  const parsed = parseRekapan(rows, { date1904 });
  const amountSource = String(formData.get('amountSource') ?? 'engine') === 'workbook' ? 'workbook' : 'engine';
  const context = await loadImportContext(workspaceId, entityId);
  const evaluated = parsed.rows.map((row) => evaluateRekapanRow(row, context, amountSource));

  const unmatched = new Map<string, number>();
  const unknownCodes = new Set<string>();
  for (const row of evaluated) {
    if (row.counterpartyId === null) unmatched.set(row.counterpartyName, (unmatched.get(row.counterpartyName) ?? 0) + 1);
    if (!context.objectCodes.has(row.objectCode)) unknownCodes.add(row.objectCode);
  }
  return {
    workspaceId,
    entityId,
    fileName,
    sheetName,
    headerRowNumber: parsed.headerRowNumber,
    totalRows: parsed.rows.length,
    importable: evaluated.filter((row) => row.status === 'new').length,
    existing: evaluated.filter((row) => row.status === 'existing').length,
    blocked: evaluated.filter((row) => row.status === 'blocked').length,
    skipped: parsed.skipped,
    matchedDifferences: evaluated.filter((row) => row.difference !== null && row.difference !== '0').length,
    unmatchedVendors: [...unmatched.entries()].map(([name, count]) => ({ name, rows: count })).sort((a, b) => b.rows - a.rows),
    unknownObjectCodes: [...unknownCodes].sort(),
    issues: parsed.issues,
    rows: evaluated,
  };
}

export async function commitRekapanImport(formData: FormData): Promise<RekapanImportResult> {
  const { workspaceId, profile } = await requireTaxManageAccess();
  const mismatch = checkImportWorkspace(formData.get('workspaceId'), workspaceId);
  if (mismatch) throw new Error(mismatch);
  const entityId = Number(formData.get('entityId'));
  if (!Number.isInteger(entityId) || entityId <= 0) throw new Error('Pemotong wajib dipilih.');
  const keepWorkbookAmount = String(formData.get('amountSource') ?? 'engine') === 'workbook';

  const { rows, date1904 } = await readRekapanSheet(formData);
  const parsed = parseRekapan(rows, { date1904 });
  const context = await loadImportContext(workspaceId, entityId);
  const svc = createServiceSupabase();
  const issues: ImportIssue[] = [...parsed.issues];
  let inserted = 0;
  let skippedExisting = 0;
  let blocked = 0;

  const payloads: Record<string, unknown>[] = [];
  for (const row of parsed.rows) {
    const evaluated = evaluateRekapanRow(row, context, keepWorkbookAmount ? 'workbook' : 'engine');
    if (evaluated.status === 'blocked') {
      blocked += 1;
      for (const problem of evaluated.problems) issues.push({ level: 'error', rowNumber: row.rowNumber, name: row.counterpartyName, message: problem });
      continue;
    }
    if (evaluated.status === 'existing') { skippedExisting += 1; continue; }
    const counterparty = matchCounterparty(row, context).counterparty!;
    const objectCode = context.objectCodes.get(row.objectCode)!;
    const facilities = context.facilitiesByCounterparty.get(counterparty.id) ?? [];
    const engine = computeSlip({
      objectCode, counterparty, facilities,
      transactionDate: row.invoiceDate, grossInputMode: 'dpp', grossInputAmount: row.grossAmount, additionalCost: row.additionalCost,
    });
    const workbookAmount = row.workbookWithholdingAmount;
    const differs = workbookAmount !== null && toMicro(workbookAmount) !== toMicro(engine.withholdingAmount);
    const useWorkbook = keepWorkbookAmount && differs && workbookAmount !== null;
    // Retaining the workbook amount means storing a manual rate that the
    // engine can recompute to exactly that amount (evaluateRekapanRow already
    // blocked rows where no such rate exists), so the slip stays consistent.
    const computed = useWorkbook
      ? computeSlip({
        objectCode, counterparty, facilities,
        transactionDate: row.invoiceDate, grossInputMode: 'dpp', grossInputAmount: row.grossAmount, additionalCost: row.additionalCost,
        rateOverridePercent: deriveConsistentRatePercent(row.grossAmount, workbookAmount, [row.workbookRatePercent]),
      })
      : engine;
    const noteParts = ['Diimpor dari REKAPAN'];
    if (differs) noteParts.push(`PPh workbook ${workbookAmount} vs engine ${engine.withholdingAmount}${useWorkbook ? ` (angka workbook dipakai, tarif manual ${computed.ratePercent}%)` : ' (angka engine dipakai)'}`);
    if (row.taxInvoiceNumber) noteParts.push(`Faktur pajak ${row.taxInvoiceNumber}`);
    if (row.billingId) noteParts.push(`ID Billing ${row.billingId}`);
    if (row.ntpn) noteParts.push(`NTPN ${row.ntpn}`);
    if (row.paidAt) noteParts.push(`Bayar ${row.paidAt}`);
    if (row.reportedAt) noteParts.push(`Lapor ${row.reportedAt}`);
    for (const problem of evaluated.problems) noteParts.push(problem);

    const status: SlipStatus = row.coretaxSlipNumber ? 'reported' : slipReadiness(counterparty);
    payloads.push({
      workspace_id: workspaceId,
      entity_id: entityId,
      counterparty_id: counterparty.id,
      counterparty_name: counterparty.name,
      counterparty_identity_type: counterparty.identity_type,
      counterparty_identity_number: counterparty.identity_number,
      period_month: row.periodMonth,
      period_year: row.periodYear,
      invoice_date: row.invoiceDate,
      invoice_number: row.invoiceNumber,
      description: row.description,
      object_code: objectCode.code,
      pph_article: computed.pphArticle,
      gross_input_mode: 'dpp',
      gross_input_amount: row.grossAmount,
      gross_amount: computed.grossAmount,
      rate_percent: computed.ratePercent,
      rate_source: computed.rateSource,
      rate_override_reason: useWorkbook ? `Angka workbook REKAPAN dipertahankan saat impor (engine ${engine.withholdingAmount} pada ${engine.ratePercent}%)` : null,
      facility_code: computed.facilityCode,
      facility_document_number: computed.facilityDocumentNumber,
      withholding_amount: computed.withholdingAmount,
      vat_rate_percent: computed.vatRatePercent,
      vat_amount: computed.vatAmount,
      additional_cost: computed.additionalCost,
      total_amount: computed.totalAmount,
      document_type: row.taxInvoiceNumber ? 'TaxInvoice' : 'CommercialInvoice',
      tax_invoice_number: row.taxInvoiceNumber,
      document_date: row.invoiceDate,
      withholding_date: row.invoiceDate < periodStartIso(row.periodYear, row.periodMonth) ? periodStartIso(row.periodYear, row.periodMonth) : row.invoiceDate,
      status,
      coretax_slip_number: row.coretaxSlipNumber,
      account_code: row.accountCode,
      account_name: row.accountName,
      trello_url: row.trelloUrl,
      notes: noteParts.join('; '),
      source: 'import_rekapan',
      workbook_withholding_amount: workbookAmount,
      created_by: profile.id,
    });
    context.existingKeys.add(slipKey(entityId, counterparty.id, objectCode.code, row.invoiceNumber, row.invoiceDate, row.grossAmount));
  }

  for (let offset = 0; offset < payloads.length; offset += 100) {
    const chunk = payloads.slice(offset, offset + 100);
    const result = await svc.from('tax_withholding_slips').insert(chunk).select('id');
    if (result.error) {
      for (const payload of chunk) {
        const single = await svc.from('tax_withholding_slips').insert(payload).select('id').single();
        if (single.error) {
          issues.push({ level: 'error', rowNumber: 0, name: String(payload.invoice_number), message: translateSlipError(single.error).message });
          blocked += 1;
          continue;
        }
        inserted += 1;
      }
      continue;
    }
    inserted += result.data.length;
  }

  return { inserted, skippedExisting, blocked, issues: issues.sort((a, b) => (a.level === b.level ? a.rowNumber - b.rowNumber : a.level === 'error' ? -1 : 1)) };
}

function translateSlipError(error: { code?: string; message: string }): Error {
  if (error.code === '23505') return new Error('Bukti potong dengan invoice, vendor, kode objek, tanggal dan DPP yang sama sudah ada.');
  if (error.code === '23514') return new Error(`Data tidak lolos validasi database: ${error.message}`);
  return new Error(error.message);
}
