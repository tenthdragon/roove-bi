'use server';

// Phase 3: BPPU XML export batches. Preview validates the masa, create builds
// the BpuBulk XML and lets the database move the slips to `exported` in one
// transaction, and a batch can be downloaded again or a slip voided out of it.

import { createHash } from 'node:crypto';
import { createServiceSupabase } from './supabase-server';
import { requireDashboardTabAccess } from './dashboard-access';
import type { SlipStatus, TaxArticle } from './tax-withholding-domain';
import { fromMicro, toMicro } from './tax-withholding-rules';
import {
  BPU_BULK_SCHEMA_VERSION,
  buildBpuBulkXml,
  exportFileNamePrefix,
  validateEntityForXml,
  validateSlipForXml,
  type ExportEntity,
  type ExportSlip,
} from './tax-withholding-xml';

const TAB_ID = 'tax-withholding';
const TAB_LABEL = 'Bukti Potong (PPh)';
const MANAGE_ROLES = ['owner', 'admin', 'direktur_finance', 'staf_finance'];
const PAGE_SIZE = 1000;
const MAX_BATCH_SLIPS = 2000;

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
  if (!ctx.canManage) throw new Error('Hanya role finance yang dapat meng-export bukti potong.');
  return ctx;
}

export type TaxExportPeriodInput = { entityId: number; year: number; month: number };

function checkPeriod(input: TaxExportPeriodInput) {
  if (!Number.isInteger(input.entityId) || input.entityId <= 0) throw new Error('Pemotong wajib dipilih.');
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) throw new Error('Masa pajak tidak valid.');
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) throw new Error('Tahun pajak tidak valid.');
}

type EntityRow = ExportEntity & { id: number };

async function loadEntity(workspaceId: string, entityId: number): Promise<EntityRow> {
  const svc = createServiceSupabase();
  const result = await svc.from('tax_withholding_entities').select('id, legal_name, npwp, tku_id, is_active')
    .eq('workspace_id', workspaceId).eq('id', entityId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Pemotong tidak ditemukan di workspace ini.');
  return result.data as EntityRow;
}

const SLIP_COLUMNS = 'id, status, period_month, period_year, counterparty_name, counterparty_identity_type, counterparty_identity_number, object_code, pph_article, facility_code, gross_amount, rate_percent, withholding_amount, document_type, invoice_number, invoice_date, description, document_date, withholding_date, export_batch_id';

type SlipRow = ExportSlip & {
  pph_article: TaxArticle;
  invoice_date: string;
  description: string | null;
  export_batch_id: number | null;
};

function normalizeSlipRow(row: Record<string, unknown>): SlipRow {
  return {
    ...(row as unknown as SlipRow),
    gross_amount: fromMicro(toMicro(String(row.gross_amount))),
    rate_percent: fromMicro(toMicro(String(row.rate_percent)), 3),
    withholding_amount: fromMicro(toMicro(String(row.withholding_amount)), 0),
  };
}

async function loadPeriodSlips(workspaceId: string, input: TaxExportPeriodInput, ids?: number[]): Promise<SlipRow[]> {
  const svc = createServiceSupabase();
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) => {
    let query = svc.from('tax_withholding_slips').select(SLIP_COLUMNS)
      .eq('workspace_id', workspaceId).eq('entity_id', input.entityId)
      .eq('period_year', input.year).eq('period_month', input.month);
    if (ids) query = query.in('id', ids);
    return query.order('invoice_date').order('id').range(from, to);
  });
  return rows.map(normalizeSlipRow);
}

async function loadActiveObjectCodes(): Promise<Set<string>> {
  const svc = createServiceSupabase();
  const rows = await fetchAllRows<{ code: string }>((from, to) => svc.from('tax_object_codes').select('code').eq('is_active', true).range(from, to));
  return new Set(rows.map((row) => row.code));
}

export type TaxExportPreviewRow = {
  id: number;
  status: SlipStatus;
  invoice_date: string;
  invoice_number: string;
  description: string | null;
  counterparty_name: string;
  counterparty_identity_type: ExportSlip['counterparty_identity_type'];
  object_code: string;
  pph_article: TaxArticle;
  facility_code: string;
  gross_amount: string;
  rate_percent: string;
  withholding_amount: string;
  export_batch_id: number | null;
  errors: string[];
};

export type TaxExportBatchSummary = {
  id: number;
  sequence: number;
  file_name: string;
  schema_version: string;
  slip_count: number;
  total_gross: string;
  total_withholding: string;
  xml_sha256: string;
  created_at: string;
  /** Slips still attached to the batch (voided slips leave). */
  current_slip_count: number;
};

export type TaxExportPreview = {
  entity: { id: number; legal_name: string; npwp: string; tku_id: string };
  entityErrors: string[];
  nextFileName: string;
  rows: TaxExportPreviewRow[];
  eligibleIds: number[];
  totals: { eligibleCount: number; blockedCount: number; grossAmount: string; withholdingAmount: string };
  statusCounts: Record<SlipStatus, number>;
  batches: TaxExportBatchSummary[];
};

async function loadBatches(workspaceId: string, input: TaxExportPeriodInput): Promise<TaxExportBatchSummary[]> {
  const svc = createServiceSupabase();
  const [batches, attached] = await Promise.all([
    svc.from('tax_export_batches')
      .select('id, sequence, file_name, schema_version, slip_count, total_gross, total_withholding, xml_sha256, created_at')
      .eq('workspace_id', workspaceId).eq('entity_id', input.entityId)
      .eq('period_year', input.year).eq('period_month', input.month)
      .order('sequence'),
    svc.from('tax_withholding_slips').select('export_batch_id')
      .eq('workspace_id', workspaceId).eq('entity_id', input.entityId)
      .eq('period_year', input.year).eq('period_month', input.month)
      .not('export_batch_id', 'is', null),
  ]);
  if (batches.error) throw batches.error;
  if (attached.error) throw attached.error;
  const counts = new Map<number, number>();
  for (const row of attached.data ?? []) {
    const id = Number((row as { export_batch_id: number }).export_batch_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return (batches.data ?? []).map((row) => ({
    id: Number(row.id),
    sequence: Number(row.sequence),
    file_name: String(row.file_name),
    schema_version: String(row.schema_version),
    slip_count: Number(row.slip_count),
    total_gross: fromMicro(toMicro(String(row.total_gross))),
    total_withholding: fromMicro(toMicro(String(row.total_withholding)), 0),
    xml_sha256: String(row.xml_sha256),
    created_at: String(row.created_at),
    current_slip_count: counts.get(Number(row.id)) ?? 0,
  }));
}

function toPreviewRow(slip: SlipRow, errors: string[]): TaxExportPreviewRow {
  return {
    id: slip.id,
    status: slip.status as SlipStatus,
    invoice_date: slip.invoice_date,
    invoice_number: slip.invoice_number,
    description: slip.description,
    counterparty_name: slip.counterparty_name,
    counterparty_identity_type: slip.counterparty_identity_type,
    object_code: slip.object_code,
    pph_article: slip.pph_article,
    facility_code: slip.facility_code,
    gross_amount: slip.gross_amount,
    rate_percent: slip.rate_percent,
    withholding_amount: slip.withholding_amount,
    export_batch_id: slip.export_batch_id,
    errors,
  };
}

/** Lists the masa's slips with their export verdict. Reads only. */
export async function previewTaxExport(input: TaxExportPeriodInput): Promise<TaxExportPreview> {
  const { workspaceId } = await requireTaxAccess();
  checkPeriod(input);
  const [entity, slips, codes, batches] = await Promise.all([
    loadEntity(workspaceId, input.entityId),
    loadPeriodSlips(workspaceId, input),
    loadActiveObjectCodes(),
    loadBatches(workspaceId, input),
  ]);
  const period = { year: input.year, month: input.month };
  const statusCounts: Record<SlipStatus, number> = { draft: 0, ready: 0, exported: 0, reported: 0, paid: 0 };
  const rows: TaxExportPreviewRow[] = [];
  const eligibleIds: number[] = [];
  let gross = 0n;
  let withholding = 0n;
  for (const slip of slips) {
    statusCounts[slip.status as SlipStatus] += 1;
    // Slips already handed to Coretax are not candidates and are not listed as problems.
    if (slip.status !== 'draft' && slip.status !== 'ready') continue;
    const errors = validateSlipForXml(slip, period, codes);
    rows.push(toPreviewRow(slip, errors));
    if (errors.length === 0) {
      eligibleIds.push(slip.id);
      gross += toMicro(slip.gross_amount);
      withholding += toMicro(slip.withholding_amount);
    }
  }
  const nextSequence = batches.reduce((max, batch) => Math.max(max, batch.sequence), 0) + 1;
  return {
    entity: { id: entity.id, legal_name: entity.legal_name, npwp: entity.npwp, tku_id: entity.tku_id },
    entityErrors: validateEntityForXml(entity),
    nextFileName: `${exportFileNamePrefix(entity, period)}${String(nextSequence).padStart(2, '0')}.xml`,
    rows,
    eligibleIds,
    totals: {
      eligibleCount: eligibleIds.length,
      blockedCount: rows.length - eligibleIds.length,
      grossAmount: fromMicro(gross),
      withholdingAmount: fromMicro(withholding, 0),
    },
    statusCounts,
    batches,
  };
}

export type TaxExportBatchResult = {
  batchId: number;
  sequence: number;
  fileName: string;
  slipCount: number;
  xml: string;
};

/** Re-validates the chosen slips, writes the batch and returns the XML for download. */
export async function createTaxExportBatch(input: TaxExportPeriodInput & { slipIds: number[] }): Promise<TaxExportBatchResult> {
  const { workspaceId, profile } = await requireTaxManageAccess();
  checkPeriod(input);
  const ids = [...new Set((input.slipIds ?? []).map(Number))];
  if (ids.length === 0) throw new Error('Pilih minimal satu bukti potong siap untuk di-export.');
  if (ids.length > MAX_BATCH_SLIPS || ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error('Daftar bukti potong tidak valid.');

  const [entity, slips, codes] = await Promise.all([
    loadEntity(workspaceId, input.entityId),
    loadPeriodSlips(workspaceId, input, ids),
    loadActiveObjectCodes(),
  ]);
  const entityErrors = validateEntityForXml(entity);
  if (entityErrors.length > 0) throw new Error(`Pemotong belum siap: ${entityErrors.join(' ')}`);
  if (slips.length !== ids.length) throw new Error('Sebagian bukti potong tidak ditemukan di masa ini; muat ulang pratinjau.');
  const period = { year: input.year, month: input.month };
  const blocked = slips.map((slip) => ({ slip, errors: validateSlipForXml(slip, period, codes) })).filter((row) => row.errors.length > 0);
  if (blocked.length > 0) {
    const first = blocked[0];
    throw new Error(`${blocked.length} bukti potong tidak valid untuk XML (mis. ${first.slip.invoice_number}: ${first.errors[0]}). Muat ulang pratinjau.`);
  }

  const xml = buildBpuBulkXml(entity, slips);
  const sha256 = createHash('sha256').update(xml, 'utf8').digest('hex');
  const svc = createServiceSupabase();
  const result = await svc.rpc('tax_create_export_batch', {
    p_workspace_id: workspaceId,
    p_entity_id: input.entityId,
    p_period_year: input.year,
    p_period_month: input.month,
    p_slip_ids: ids,
    p_file_name_prefix: exportFileNamePrefix(entity, period),
    p_schema_version: BPU_BULK_SCHEMA_VERSION,
    p_xml_content: xml,
    p_xml_sha256: sha256,
    p_created_by: profile.id,
  });
  if (result.error) throw new Error(translateBatchError(result.error.message));
  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as { batch_id: number; sequence: number; file_name: string } | undefined;
  if (!row) throw new Error('Batch tidak terbentuk.');
  return { batchId: Number(row.batch_id), sequence: Number(row.sequence), fileName: String(row.file_name), slipCount: slips.length, xml };
}

function translateBatchError(message: string): string {
  if (/sudah berubah|bukan status siap/i.test(message)) return 'Sebagian bukti potong sudah berubah sejak pratinjau (status bukan siap atau sudah masuk batch lain). Muat ulang pratinjau lalu coba lagi.';
  if (/nonaktif/i.test(message)) return 'Pemotong tidak ditemukan atau nonaktif.';
  return message;
}

/** Returns the stored XML of a batch for re-download. */
export async function getTaxExportBatchXml(batchId: number): Promise<{ fileName: string; xml: string; sha256: string }> {
  const { workspaceId } = await requireTaxAccess();
  if (!Number.isInteger(batchId) || batchId <= 0) throw new Error('Batch tidak valid.');
  const svc = createServiceSupabase();
  const result = await svc.from('tax_export_batches').select('file_name, xml_content, xml_sha256')
    .eq('workspace_id', workspaceId).eq('id', batchId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Batch tidak ditemukan.');
  return { fileName: String(result.data.file_name), xml: String(result.data.xml_content), sha256: String(result.data.xml_sha256) };
}

/** Takes an exported slip out of its batch so it can be corrected and exported again. */
export async function voidExportedTaxSlip(input: { slipId: number; reason: string }): Promise<void> {
  const { workspaceId } = await requireTaxManageAccess();
  if (!Number.isInteger(input.slipId) || input.slipId <= 0) throw new Error('Bukti potong tidak valid.');
  const reason = String(input.reason ?? '').trim().replace(/\s+/g, ' ');
  if (reason.length < 5) throw new Error('Alasan pembatalan export wajib diisi (minimal 5 karakter).');
  if (reason.length > 500) throw new Error('Alasan pembatalan terlalu panjang.');
  const svc = createServiceSupabase();
  const current = await svc.from('tax_withholding_slips').select('id, status, export_batch_id')
    .eq('workspace_id', workspaceId).eq('id', input.slipId).maybeSingle();
  if (current.error) throw current.error;
  if (!current.data) throw new Error('Bukti potong tidak ditemukan.');
  if (current.data.status !== 'exported' || current.data.export_batch_id === null) {
    throw new Error('Hanya bukti potong berstatus di-export yang dapat dibatalkan dari batch.');
  }
  const update = await svc.from('tax_withholding_slips')
    .update({ status: 'draft', export_batch_id: null, voided_from_batch_id: current.data.export_batch_id, void_reason: reason })
    .eq('workspace_id', workspaceId).eq('id', input.slipId).eq('status', 'exported').eq('export_batch_id', current.data.export_batch_id)
    .select('id');
  if (update.error) throw update.error;
  if (!update.data || update.data.length !== 1) throw new Error('Bukti potong berubah saat dibatalkan; muat ulang.');
}
