'use server';

// Phase 5: setoran PPh. One kode billing pays one pasal + KAP + KJS of one masa;
// recording its NTPN marks the group's reported slips paid.

import { createServiceSupabase } from './supabase-server';
import { requireDashboardTabAccess } from './dashboard-access';
import { TAX_ARTICLES, normalizeIsoDate, type TaxArticle } from './tax-withholding-domain';
import { fromMicro, toMicro } from './tax-withholding-rules';
import {
  BILLING_ID_PATTERN,
  NTPN_PATTERN,
  normalizeBillingId,
  normalizeNtpn,
  paymentGroupKey,
} from './tax-withholding-payment';

const PAGE_SIZE = 1000;
const TAB_ID = 'tax-withholding';
const TAB_LABEL = 'Bukti Potong (PPh)';
const MANAGE_ROLES = ['owner', 'admin', 'direktur_finance', 'staf_finance'];

async function requireTaxAccess() {
  const ctx = await requireDashboardTabAccess(TAB_ID, TAB_LABEL);
  return { ...ctx, canManage: MANAGE_ROLES.includes(ctx.profile.role) };
}
async function requireTaxManageAccess() {
  const ctx = await requireTaxAccess();
  if (!ctx.canManage) throw new Error('Hanya role finance yang dapat mencatat setoran.');
  return ctx;
}

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

/** The entity must exist in the caller's workspace; the service role would otherwise accept any id. */
async function requireEntity(workspaceId: string, entityId: number): Promise<void> {
  const svc = createServiceSupabase();
  const result = await svc.from('tax_withholding_entities').select('id').eq('workspace_id', workspaceId).eq('id', entityId).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Pemotong tidak ditemukan di workspace ini.');
}

export type TaxPaymentRecord = {
  id: number;
  entity_id: number;
  period_month: number;
  period_year: number;
  pph_article: TaxArticle;
  kap: string;
  kjs: string;
  billing_id: string;
  billing_amount: string;
  billing_created_at: string;
  billing_valid_until: string | null;
  ntpn: string | null;
  paid_at: string | null;
  paid_amount: string | null;
  notes: string | null;
  created_at: string;
  /** Row version to send back with NTPN or deletion. */
  updated_at: string;
  /** `${month}|${article}|${kap}|${kjs}`: the recap group this payment belongs to. */
  groupKey: string;
};

const RECORD_COLUMNS = 'id, entity_id, period_month, period_year, pph_article, kap, kjs, billing_id, billing_amount, billing_created_at, billing_valid_until, ntpn, paid_at, paid_amount, notes, created_at, updated_at';

function normalizeRecord(row: Record<string, unknown>): TaxPaymentRecord {
  const text = (key: string) => (row[key] === null || row[key] === undefined ? null : String(row[key]));
  const record = {
    ...(row as unknown as TaxPaymentRecord),
    id: Number(row.id),
    entity_id: Number(row.entity_id),
    period_month: Number(row.period_month),
    period_year: Number(row.period_year),
    billing_amount: fromMicro(toMicro(String(row.billing_amount)), 0),
    billing_valid_until: text('billing_valid_until'),
    ntpn: text('ntpn'),
    paid_at: text('paid_at'),
    paid_amount: text('paid_amount') === null ? null : fromMicro(toMicro(text('paid_amount') as string), 0),
    notes: text('notes'),
  };
  return { ...record, groupKey: paymentGroupKey(record) };
}

function checkEntityYear(entityId: number, year: number) {
  if (!Number.isInteger(entityId) || entityId <= 0) throw new Error('Pemotong wajib dipilih.');
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Tahun pajak tidak valid.');
}

/** All payment records of one entity and year, oldest first (paged past the PostgREST row limit). */
export async function listTaxPaymentRecords(input: { entityId: number; year: number }): Promise<TaxPaymentRecord[]> {
  const { workspaceId } = await requireTaxAccess();
  checkEntityYear(input.entityId, input.year);
  await requireEntity(workspaceId, input.entityId);
  const svc = createServiceSupabase();
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) => svc.from('tax_payment_records').select(RECORD_COLUMNS)
    .eq('workspace_id', workspaceId).eq('entity_id', input.entityId).eq('period_year', input.year)
    .order('period_month').order('id').range(from, to));
  return rows.map(normalizeRecord);
}

export type TaxPaymentRecordInput = {
  id?: number | null;
  /** Required when editing: the updated_at the form showed. */
  version?: string | null;
  entityId: number;
  year: number;
  month: number;
  article: TaxArticle;
  kap: string;
  kjs: string;
  billingId: string;
  billingAmount: string | number;
  billingCreatedAt: string;
  billingValidUntil?: string | null;
  notes?: string | null;
};

/** Creates a billing record for a recap group, or edits one that has no NTPN yet. */
export async function saveTaxPaymentRecord(input: TaxPaymentRecordInput): Promise<TaxPaymentRecord> {
  const { workspaceId, profile } = await requireTaxManageAccess();
  checkEntityYear(input.entityId, input.year);
  if (!Number.isInteger(input.month) || input.month < 1 || input.month > 12) throw new Error('Masa pajak tidak valid.');
  if (!TAX_ARTICLES.includes(input.article)) throw new Error('Pasal tidak valid.');
  const kap = String(input.kap ?? '').trim();
  const kjs = String(input.kjs ?? '').trim();
  if (!/^\d{6}$/.test(kap) || !/^\d{3}$/.test(kjs)) throw new Error('KAP harus 6 digit dan KJS 3 digit.');
  const billingId = normalizeBillingId(input.billingId);
  if (!BILLING_ID_PATTERN.test(billingId)) throw new Error('ID Billing harus 15 digit angka.');
  let amountMicro: bigint;
  try {
    amountMicro = toMicro(input.billingAmount);
  } catch {
    throw new Error('Jumlah ID Billing bukan angka.');
  }
  if (amountMicro <= 0n || amountMicro % 1_000_000n !== 0n) throw new Error('Jumlah ID Billing harus rupiah bulat lebih dari 0.');
  const createdAt = normalizeIsoDate(input.billingCreatedAt);
  if (!createdAt) throw new Error('Tanggal pembuatan ID Billing tidak valid.');
  const validUntil = input.billingValidUntil ? normalizeIsoDate(input.billingValidUntil) : null;
  if (input.billingValidUntil && !validUntil) throw new Error('Tanggal berlaku ID Billing tidak valid.');
  if (validUntil && validUntil < createdAt) throw new Error('Masa berlaku ID Billing tidak boleh sebelum tanggal pembuatannya.');
  const notes = String(input.notes ?? '').trim() || null;

  await requireEntity(workspaceId, input.entityId);
  const svc = createServiceSupabase();
  const codes = await svc.from('tax_object_codes').select('code').eq('pph_article', input.article).eq('kap', kap).eq('kjs', kjs).limit(1);
  if (codes.error) throw codes.error;
  if (!codes.data || codes.data.length === 0) throw new Error(`Tidak ada kode objek ${input.article} dengan KAP ${kap} / KJS ${kjs} di referensi.`);

  const payload = {
    period_month: input.month, period_year: input.year, pph_article: input.article, kap, kjs,
    billing_id: billingId, billing_amount: fromMicro(amountMicro, 0), billing_created_at: createdAt, billing_valid_until: validUntil, notes,
  };
  if (input.id) {
    if (!input.version) throw new Error('Versi catatan tidak dikirim; muat ulang.');
    const update = await svc.from('tax_payment_records').update(payload)
      .eq('workspace_id', workspaceId).eq('entity_id', input.entityId).eq('id', input.id).is('ntpn', null).eq('updated_at', input.version)
      .select(RECORD_COLUMNS);
    if (update.error) throw new Error(translatePaymentError(update.error.message));
    if (!update.data || update.data.length !== 1) throw new Error('Catatan setoran berubah sejak dibuka (NTPN sudah dicatat atau diubah orang lain); muat ulang.');
    return normalizeRecord(update.data[0] as Record<string, unknown>);
  }
  const insert = await svc.from('tax_payment_records')
    .insert({ workspace_id: workspaceId, entity_id: input.entityId, created_by: profile.id, ...payload })
    .select(RECORD_COLUMNS).single();
  if (insert.error) throw new Error(translatePaymentError(insert.error.message));
  return normalizeRecord(insert.data as Record<string, unknown>);
}

function translatePaymentError(message: string): string {
  if (/tax_payment_records_workspace_id_entity_id_billing_id_key|duplicate key/i.test(message)) return 'ID Billing ini sudah tercatat untuk pemotong ini.';
  if (/tax_payment_records_workspace_entity_fkey/i.test(message)) return 'Pemotong tidak ditemukan di workspace ini.';
  if (/idx_tax_payment_records_ntpn|sudah dipakai catatan setoran lain/i.test(message)) return 'NTPN ini sudah tercatat pada setoran lain.';
  if (/berubah sejak dibaca|belum punya NTPN|sudah tercatat untuk ID Billing/i.test(message)) return `${message.replace(/^[^:]*: ?/, '')} Muat ulang lalu coba lagi.`;
  return message;
}

export type TaxPaymentNtpnInput = { id: number; version: string; ntpn: string; paidAt: string; paidAmount: string | number };

/** Stores the NTPN and marks the group's reported slips paid. Returns how many slips moved. */
export async function recordTaxPaymentNtpn(input: TaxPaymentNtpnInput): Promise<{ slipsPaid: number }> {
  const { workspaceId, profile } = await requireTaxManageAccess();
  if (!Number.isInteger(input.id) || input.id <= 0) throw new Error('Catatan setoran tidak valid.');
  if (!input.version) throw new Error('Versi catatan tidak dikirim; muat ulang.');
  const ntpn = normalizeNtpn(input.ntpn);
  if (!NTPN_PATTERN.test(ntpn)) throw new Error('NTPN harus 16 huruf besar/angka.');
  const paidAt = normalizeIsoDate(input.paidAt);
  if (!paidAt) throw new Error('Tanggal setor tidak valid.');
  let amountMicro: bigint;
  try {
    amountMicro = toMicro(input.paidAmount);
  } catch {
    throw new Error('Jumlah setoran bukan angka.');
  }
  if (amountMicro <= 0n || amountMicro % 1_000_000n !== 0n) throw new Error('Jumlah setoran harus rupiah bulat lebih dari 0.');
  const svc = createServiceSupabase();
  const result = await svc.rpc('tax_record_payment_ntpn', {
    p_workspace_id: workspaceId,
    p_record_id: input.id,
    p_ntpn: ntpn,
    p_paid_at: paidAt,
    p_paid_amount: fromMicro(amountMicro, 0),
    p_version: input.version,
    p_recorded_by: profile.id,
  });
  if (result.error) throw new Error(translatePaymentError(result.error.message));
  return { slipsPaid: Number(result.data ?? 0) };
}

/** Removes a recorded NTPN; the group's paid slips go back to reported unless another record still pays them. */
export async function clearTaxPaymentNtpn(input: { id: number; version: string }): Promise<{ slipsReverted: number }> {
  const { workspaceId } = await requireTaxManageAccess();
  if (!Number.isInteger(input.id) || input.id <= 0) throw new Error('Catatan setoran tidak valid.');
  if (!input.version) throw new Error('Versi catatan tidak dikirim; muat ulang.');
  const svc = createServiceSupabase();
  const result = await svc.rpc('tax_clear_payment_ntpn', { p_workspace_id: workspaceId, p_record_id: input.id, p_version: input.version });
  if (result.error) throw new Error(translatePaymentError(result.error.message));
  return { slipsReverted: Number(result.data ?? 0) };
}

/** Deletes a billing record that has no NTPN yet. */
export async function deleteTaxPaymentRecord(input: { id: number; version: string }): Promise<void> {
  const { workspaceId } = await requireTaxManageAccess();
  if (!Number.isInteger(input.id) || input.id <= 0) throw new Error('Catatan setoran tidak valid.');
  if (!input.version) throw new Error('Versi catatan tidak dikirim; muat ulang.');
  const svc = createServiceSupabase();
  const result = await svc.from('tax_payment_records').delete()
    .eq('workspace_id', workspaceId).eq('id', input.id).is('ntpn', null).eq('updated_at', input.version)
    .select('id');
  if (result.error) throw result.error;
  if (!result.data || result.data.length !== 1) throw new Error('Catatan setoran tidak bisa dihapus: sudah punya NTPN atau berubah sejak dibuka; muat ulang.');
}
