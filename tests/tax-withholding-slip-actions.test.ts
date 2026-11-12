import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createRequire } from 'node:module';
import * as XLSX from 'xlsx';

// Server actions against an in-memory Supabase stand-in that mimics PostgREST
// filters, the 1,000-row default page, and the tax_create_export_batch RPC.
// Covers the export-versus-edit/delete interleavings and the import → export
// path for faktur pajak documents. All identities are synthetic.
const require = createRequire(import.meta.url);
const A = '00000000-0000-4000-8000-000000000001';
const DEFAULT_PAGE = 1000;
let db: Record<string, any[]> = {};
let onRead: ((table: string) => void) | null = null;
let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 10, 12, 0, 0, clock++)).toISOString();

function from(table: string) {
  const filters: Array<(row: any) => boolean> = [];
  let operation: 'read' | 'insert' | 'update' | 'delete' = 'read';
  let payload: any;
  let bounds: [number, number] | undefined;
  let mode: 'many' | 'single' | 'maybe' = 'many';
  const query: any = {
    select() { return query; },
    order() { return query; },
    eq(key: string, value: unknown) { filters.push((row) => row[key] === value); return query; },
    in(key: string, values: unknown[]) { filters.push((row) => values.includes(row[key])); return query; },
    is(key: string, value: unknown) { filters.push((row) => (row[key] ?? null) === value); return query; },
    not(key: string, operator: string, value: unknown) {
      assert.equal(operator, 'is');
      filters.push((row) => (row[key] ?? null) !== value);
      return query;
    },
    range(start: number, end: number) { bounds = [start, end]; return query; },
    limit(count: number) { bounds = [0, count - 1]; return query; },
    insert(value: any) { operation = 'insert'; payload = value; return query; },
    update(value: any) { operation = 'update'; payload = value; return query; },
    delete() { operation = 'delete'; return query; },
    single() { mode = 'single'; return query; },
    maybeSingle() { mode = 'maybe'; return query; },
    then(resolve: (result: any) => void) {
      const stored = db[table] ??= [];
      let rows = stored.filter((row) => filters.every((filter) => filter(row)));
      if (operation === 'update') rows.forEach((row) => Object.assign(row, payload, { updated_at: stamp() }));
      else if (operation === 'delete') {
        db[table] = stored.filter((row) => !rows.includes(row));
      } else if (operation === 'insert') {
        rows = [];
        for (const value of Array.isArray(payload) ? payload : [payload]) {
          const row = { id: Math.max(0, ...stored.map((r) => r.id)) + 1, created_at: stamp(), updated_at: stamp(), ...value };
          stored.push(row);
          rows.push(row);
        }
      }
      rows = rows.slice(...(bounds ? [bounds[0], bounds[1] + 1] : [0, DEFAULT_PAGE]));
      const data = structuredClone(mode === 'many' ? rows : rows[0] ?? null);
      // Interleaving hook: another transaction commits right after this read returns.
      if (operation === 'read') onRead?.(table);
      if (mode === 'single' && rows.length !== 1) resolve({ data: null, error: { message: `expected one row, got ${rows.length}` } });
      else resolve({ data, error: null });
    },
  };
  return query;
}

function recordCoretaxRpc(args: Record<string, any>) {
  const slips = db.tax_withholding_slips ??= [];
  const ids: number[] = args.p_slip_ids;
  const numbers: string[] = args.p_numbers;
  if (numbers.length !== ids.length || args.p_versions.length !== ids.length) return { data: null, error: { message: 'Nomor dan versi harus dikirim untuk setiap bukti potong.' } };
  if (numbers.some((n) => !/^(?=.*\d)[0-9A-Z]{6,20}$/.test(n))) return { data: null, error: { message: `Nomor bukti potong tidak valid: ${numbers.join(', ')}` } };
  if (new Set(numbers).size !== numbers.length) return { data: null, error: { message: 'Nomor bukti potong yang sama diberikan ke beberapa bukti potong.' } };
  const locked = slips.filter((row) => ids.includes(row.id) && row.workspace_id === args.p_workspace_id && row.entity_id === args.p_entity_id
    && (row.status === 'exported' || (args.p_allow_replace && row.status === 'reported')));
  if (locked.length !== ids.length) return { data: null, error: { message: `Sebagian bukti potong bukan status di-export (${locked.length} dari ${ids.length} cocok); muat ulang.` } };
  if (locked.some((row) => row.updated_at !== args.p_versions[ids.indexOf(row.id)])) return { data: null, error: { message: 'Sebagian bukti potong berubah sejak dibaca' } };
  const used = slips.filter((row) => row.entity_id === args.p_entity_id && !ids.includes(row.id) && numbers.includes(row.coretax_slip_number)).map((row) => row.coretax_slip_number);
  if (used.length > 0) return { data: null, error: { message: `Nomor bukti potong sudah dipakai bukti potong lain: ${used.join(', ')}` } };
  for (const row of locked) Object.assign(row, { coretax_slip_number: numbers[ids.indexOf(row.id)], status: 'reported', coretax_recorded_at: stamp(), coretax_recorded_by: args.p_recorded_by, updated_at: stamp() });
  return { data: ids.length, error: null };
}

function paymentGroupSlips(record: any) {
  const codes = (db.tax_object_codes ?? []).filter((code) => code.kap === record.kap && code.kjs === record.kjs).map((code) => code.code);
  return (db.tax_withholding_slips ?? []).filter((row) => row.workspace_id === record.workspace_id && row.entity_id === record.entity_id
    && row.period_year === record.period_year && row.period_month === record.period_month && row.pph_article === record.pph_article && codes.includes(row.object_code));
}

function paymentRpc(name: string, args: Record<string, any>) {
  const records = db.tax_payment_records ??= [];
  const record = records.find((row) => row.id === args.p_record_id && row.workspace_id === args.p_workspace_id);
  if (!record) return { data: null, error: { message: 'Catatan setoran tidak ditemukan.' } };
  if (record.updated_at !== args.p_version) return { data: null, error: { message: 'Catatan setoran berubah sejak dibaca; muat ulang.' } };
  if (name === 'tax_record_payment_ntpn') {
    if (!/^[0-9A-Z]{16}$/.test(args.p_ntpn)) return { data: null, error: { message: 'NTPN harus 16 huruf besar/angka.' } };
    if (record.ntpn) return { data: null, error: { message: 'NTPN sudah tercatat untuk ID Billing ini; hapus dulu untuk mengganti.' } };
    if (records.some((row) => row.entity_id === record.entity_id && row.ntpn === args.p_ntpn && row.id !== record.id)) return { data: null, error: { message: `NTPN ${args.p_ntpn} sudah dipakai catatan setoran lain.` } };
    Object.assign(record, { ntpn: args.p_ntpn, paid_at: args.p_paid_at, paid_amount: args.p_paid_amount, paid_recorded_by: args.p_recorded_by, updated_at: stamp() });
    const moved = paymentGroupSlips(record).filter((row) => row.status === 'reported');
    for (const row of moved) Object.assign(row, { status: 'paid', updated_at: stamp() });
    return { data: moved.length, error: null };
  }
  assert.equal(name, 'tax_clear_payment_ntpn');
  if (!record.ntpn) return { data: null, error: { message: 'Catatan setoran ini belum punya NTPN.' } };
  Object.assign(record, { ntpn: null, paid_at: null, paid_amount: null, paid_recorded_by: null, updated_at: stamp() });
  const stillPaid = records.some((row) => row.id !== record.id && row.ntpn && row.entity_id === record.entity_id && row.period_year === record.period_year
    && row.period_month === record.period_month && row.pph_article === record.pph_article && row.kap === record.kap && row.kjs === record.kjs);
  if (stillPaid) return { data: 0, error: null };
  const moved = paymentGroupSlips(record).filter((row) => row.status === 'paid');
  for (const row of moved) Object.assign(row, { status: 'reported', updated_at: stamp() });
  return { data: moved.length, error: null };
}

async function rpc(name: string, args: Record<string, any>) {
  if (name === 'tax_record_coretax_numbers') return recordCoretaxRpc(args);
  if (name === 'tax_record_payment_ntpn' || name === 'tax_clear_payment_ntpn') return paymentRpc(name, args);
  assert.equal(name, 'tax_create_export_batch');
  const slips = db.tax_withholding_slips ??= [];
  const ids: number[] = [...new Set(args.p_slip_ids as number[])];
  const versions = new Map((args.p_slip_ids as number[]).map((id, index) => [id, args.p_slip_versions[index]]));
  const locked = slips.filter((row) => ids.includes(row.id) && row.workspace_id === args.p_workspace_id && row.entity_id === args.p_entity_id
    && row.period_year === args.p_period_year && row.period_month === args.p_period_month && row.status === 'ready' && (row.export_batch_id ?? null) === null);
  if (locked.length !== ids.length) return { data: null, error: { message: 'Sebagian bukti potong sudah berubah atau bukan status siap' } };
  if (locked.some((row) => row.updated_at !== versions.get(row.id))) return { data: null, error: { message: 'Sebagian bukti potong diubah setelah pratinjau' } };
  const batches = db.tax_export_batches ??= [];
  const sequence = batches.filter((b) => b.entity_id === args.p_entity_id && b.period_year === args.p_period_year && b.period_month === args.p_period_month).length + 1;
  const batch = {
    id: batches.length + 1, workspace_id: args.p_workspace_id, entity_id: args.p_entity_id, period_year: args.p_period_year, period_month: args.p_period_month,
    sequence, file_name: `${args.p_file_name_prefix}${String(sequence).padStart(2, '0')}.xml`, schema_version: args.p_schema_version,
    slip_count: locked.length,
    total_gross: String(locked.reduce((sum, row) => sum + Number(row.gross_amount), 0)),
    total_withholding: String(locked.reduce((sum, row) => sum + Number(row.withholding_amount), 0)),
    xml_sha256: args.p_xml_sha256, xml_content: args.p_xml_content, created_at: stamp(),
  };
  batches.push(batch);
  for (const row of locked) Object.assign(row, { status: 'exported', export_batch_id: batch.id, updated_at: stamp() });
  return { data: [{ batch_id: batch.id, sequence, file_name: batch.file_name }], error: null };
}

require.cache[require.resolve('../lib/supabase-server')] = { exports: { createServiceSupabase: () => ({ from, rpc }) } } as any;
require.cache[require.resolve('../lib/dashboard-access')] = { exports: { requireDashboardTabAccess: async () => ({ workspaceId: A, profile: { id: 'synthetic-user', role: 'staf_finance' } }) } } as any;
const slipActions = require('../lib/tax-withholding-slip-actions') as typeof import('../lib/tax-withholding-slip-actions');
const exportActions = require('../lib/tax-withholding-export-actions') as typeof import('../lib/tax-withholding-export-actions');
const coretaxActions = require('../lib/tax-withholding-coretax-actions') as typeof import('../lib/tax-withholding-coretax-actions');
const paymentActions = require('../lib/tax-withholding-payment-actions') as typeof import('../lib/tax-withholding-payment-actions');

const entity = { id: 1, workspace_id: A, business_id: 4, legal_name: 'PT. CONTOH SINTETIS INDONESIA', npwp: '0123456789012345', tku_id: '0123456789012345000000', is_active: true };
const vendor = { id: 1, workspace_id: A, name: 'PT CONTOH MARKETPLACE', identity_type: 'npwp', identity_number: '0012345678901000', is_pkp: true, country_code: 'IDN', is_active: true };
const software = { code: '24-104-24', name: 'Jasa software', pph_article: 'pph23', rate_percent: 2, is_active: true, kap: '411124', kjs: '104' };
const readySlip = (overrides: Record<string, unknown> = {}) => ({
  workspace_id: A, entity_id: 1, counterparty_id: 1, counterparty_name: vendor.name, counterparty_identity_type: 'npwp', counterparty_identity_number: vendor.identity_number,
  period_month: 1, period_year: 2026, invoice_date: '2026-01-05', invoice_number: 'INV-READY', tax_invoice_number: null, description: null,
  object_code: '24-104-24', pph_article: 'pph23', gross_input_mode: 'dpp', gross_input_amount: '1000000', gross_amount: '1000000',
  rate_percent: '2', rate_source: 'object_code', rate_override_reason: null, facility_code: 'N/A', facility_document_number: null,
  withholding_amount: '20000', vat_rate_percent: '11', vat_amount: '110000', additional_cost: '0', total_amount: '1110000',
  document_type: 'CommercialInvoice', document_date: '2026-01-05', withholding_date: '2026-01-05', status: 'ready', coretax_slip_number: null,
  account_code: null, account_name: null, trello_url: null, notes: null, source: 'manual', workbook_withholding_amount: null,
  export_batch_id: null, voided_from_batch_id: null, void_reason: null, ...overrides,
});

beforeEach(() => {
  clock = 0;
  onRead = null;
  db = {
    tax_withholding_entities: [structuredClone(entity)],
    tax_counterparties: [structuredClone(vendor)],
    tax_counterparty_facilities: [],
    tax_object_codes: [structuredClone(software)],
    tax_withholding_slips: [],
    tax_export_batches: [],
    tax_payment_records: [],
  };
});

// Flip the slip to exported the moment the action has read it as ready.
function exportAfterFirstRead(slipId: number) {
  let fired = false;
  onRead = (table) => {
    if (fired || table !== 'tax_withholding_slips') return;
    fired = true;
    const row = db.tax_withholding_slips.find((r) => r.id === slipId);
    db.tax_export_batches.push({ id: 1, workspace_id: A, entity_id: 1, period_year: 2026, period_month: 1, sequence: 1, file_name: 'x-01.xml', slip_count: 1 });
    Object.assign(row, { status: 'exported', export_batch_id: 1, updated_at: stamp() });
  };
}

test('deleteTaxSlip keeps a slip that was exported between the status check and the delete', async () => {
  const slip = { id: 7, ...readySlip(), updated_at: stamp() };
  db.tax_withholding_slips.push(slip);
  exportAfterFirstRead(7);
  await assert.rejects(slipActions.deleteTaxSlip(7), /berubah status saat dihapus/);
  assert.equal(db.tax_withholding_slips.length, 1);
  assert.equal(db.tax_withholding_slips[0].status, 'exported');
});

test('saveTaxSlip does not overwrite a slip that was exported after it was read as ready', async () => {
  const slip = { id: 8, ...readySlip({ invoice_number: 'INV-EDIT' }), updated_at: stamp() };
  db.tax_withholding_slips.push(slip);
  exportAfterFirstRead(8);
  await assert.rejects(slipActions.saveTaxSlip({
    id: 8, entityId: 1, counterpartyId: 1, invoiceDate: '2026-01-05', invoiceNumber: 'INV-EDITED', objectCode: '24-104-24',
    grossInputMode: 'dpp', grossInputAmount: '2000000',
  }), /berubah status saat disimpan/);
  assert.equal(db.tax_withholding_slips[0].invoice_number, 'INV-EDIT');
  assert.equal(db.tax_withholding_slips[0].gross_amount, '1000000');
});

test('saveTaxSlip stores the faktur pajak number only for TaxInvoice documents and validates it', async () => {
  await assert.rejects(slipActions.saveTaxSlip({
    entityId: 1, counterpartyId: 1, invoiceDate: '2026-01-05', invoiceNumber: 'INV-FP', objectCode: '24-104-24',
    grossInputMode: 'dpp', grossInputAmount: '1000000', documentType: 'TaxInvoice',
  }), /Nomor faktur pajak wajib diisi/);
  await assert.rejects(slipActions.saveTaxSlip({
    entityId: 1, counterpartyId: 1, invoiceDate: '2026-01-05', invoiceNumber: 'INV-FP', objectCode: '24-104-24',
    grossInputMode: 'dpp', grossInputAmount: '1000000', documentType: 'TaxInvoice', taxInvoiceNumber: '12345',
  }), /16 digit/);
  const saved = await slipActions.saveTaxSlip({
    entityId: 1, counterpartyId: 1, invoiceDate: '2026-01-05', invoiceNumber: 'INV-FP', objectCode: '24-104-24',
    grossInputMode: 'dpp', grossInputAmount: '1000000', documentType: 'TaxInvoice', taxInvoiceNumber: '010.000-26.12345678',
  });
  assert.equal(saved.tax_invoice_number, '010.000-26.12345678');
  const commercial = await slipActions.saveTaxSlip({
    entityId: 1, counterpartyId: 1, invoiceDate: '2026-01-06', invoiceNumber: 'INV-CI', objectCode: '24-104-24',
    grossInputMode: 'dpp', grossInputAmount: '1000000', documentType: 'CommercialInvoice', taxInvoiceNumber: '010.000-26.12345678',
  });
  assert.equal(commercial.tax_invoice_number, null, 'a faktur number is ignored unless the document is a TaxInvoice');
});

test('a REKAPAN row with a faktur pajak exports its faktur number as the XML DocumentNumber', async () => {
  const header = [' ', 'PERIODE INVOICE ', 'MASA ', 'NO INVOICE ', 'FAKTUR PAJAK', 'KETERANGAN TRANSAKSI ', 'KODE & NAMA OBJEK', '       ',
    'NPWP / NIK', 'PPH PASAL', 'PENGHASILAN  BRUTO ', 'TARIF ', 'PAJAK YANG DI POTONG ', 'BIAYA TAMBAHAN', 'PPN', 'TOTAL BIAYA', 'BUPOT'];
  const objectText = 'Jasa Sehubungan Dengan Software  -  24-104-24  -  PPH23';
  const sheet = XLSX.utils.aoa_to_sheet([['x'], ['y'], ['z'], ['w'], header,
    [1, 46027, '01', 'INV-2026-001', '0100002612345678', 'Langganan software', objectText, vendor.name, vendor.identity_number, 'PPH23', 1000000, 0.02, 20000, null, 110000, 1110000, null],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'REKAPAN');
  const data = new FormData();
  data.set('file', new File([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })], 'rekapan.xlsx'));
  data.set('workspaceId', A);
  data.set('entityId', '1');

  const imported = await slipActions.commitRekapanImport(data);
  assert.equal(imported.inserted, 1, imported.issues.map((issue) => issue.message).join(' | '));
  const stored = db.tax_withholding_slips[0];
  assert.equal(stored.document_type, 'TaxInvoice');
  assert.equal(stored.invoice_number, 'INV-2026-001');
  assert.equal(stored.tax_invoice_number, '0100002612345678');
  assert.equal(stored.status, 'ready');

  const preview = await exportActions.previewTaxExport({ entityId: 1, year: 2026, month: 1 });
  assert.deepEqual(preview.rows.map((row) => row.errors), [[]]);
  assert.equal(preview.eligibleIds.length, 1);

  const batch = await exportActions.createTaxExportBatch({ entityId: 1, year: 2026, month: 1, slipIds: preview.eligibleIds });
  assert.match(batch.xml, /<Document>TaxInvoice<\/Document>\n\s+<DocumentNumber>0100002612345678<\/DocumentNumber>/);
  assert.doesNotMatch(batch.xml, /INV-2026-001/);
  assert.equal(batch.fileName, 'BPPU - EBUPOT - CSI - 01 2026 - 01.xml');
  assert.equal(db.tax_withholding_slips[0].status, 'exported');
});

test('previewTaxExport counts every attached slip of a batch beyond one PostgREST page', async () => {
  db.tax_export_batches.push({
    id: 1, workspace_id: A, entity_id: 1, period_year: 2026, period_month: 1, sequence: 1, file_name: 'BPPU - EBUPOT - CSI - 01 2026 - 01.xml',
    schema_version: 'BpuBulk-v3', slip_count: 1001, total_gross: '1001000000', total_withholding: '20020000', xml_sha256: 'a'.repeat(64), created_at: stamp(),
  });
  for (let index = 0; index < 1001; index += 1) {
    db.tax_withholding_slips.push({ id: index + 1, ...readySlip({ invoice_number: `INV-${index}`, status: 'exported', export_batch_id: 1 }), updated_at: stamp() });
  }
  const preview = await exportActions.previewTaxExport({ entityId: 1, year: 2026, month: 1 });
  assert.equal(preview.statusCounts.exported, 1001);
  assert.equal(preview.batches[0].current_slip_count, 1001);
  assert.equal(preview.batches[0].slip_count, 1001);
});

test('preview totals and membership describe the first batch when more slips are eligible than one batch holds', async () => {
  for (let index = 0; index < 2001; index += 1) {
    db.tax_withholding_slips.push({ id: index + 1, ...readySlip({ invoice_number: `INV-${index}`, gross_amount: '1000', gross_input_amount: '1000', withholding_amount: '20', total_amount: '1110' }), updated_at: stamp() });
  }
  const preview = await exportActions.previewTaxExport({ entityId: 1, year: 2026, month: 1 });
  assert.equal(preview.eligibleIds.length, 2001);
  assert.equal(preview.batchIds.length, 2000);
  assert.equal(preview.deferredCount, 1);
  assert.equal(preview.totals.batchCount, 2000);
  assert.equal(preview.totals.grossAmount, '2000000');
  assert.equal(preview.totals.withholdingAmount, '40000');
  assert.equal(preview.rows.filter((row) => row.inBatch).length, 2000);
  assert.equal(preview.rows[2000].inBatch, false);
  assert.deepEqual(preview.rows[2000].errors, []);

  const batch = await exportActions.createTaxExportBatch({ entityId: 1, year: 2026, month: 1, slipIds: preview.batchIds });
  assert.equal(batch.slipCount, 2000);
  assert.equal(String(db.tax_export_batches[0].total_gross), preview.totals.grossAmount);
  assert.equal(String(db.tax_export_batches[0].total_withholding), preview.totals.withholdingAmount);
  assert.equal((batch.xml.match(/<Bpu>/g) ?? []).length, 2000);
  assert.equal(db.tax_withholding_slips.filter((row) => row.status === 'ready').length, 1, 'the deferred slip stays ready for the next batch');

  const next = await exportActions.previewTaxExport({ entityId: 1, year: 2026, month: 1 });
  assert.deepEqual(next.batchIds, [2001]);
  assert.equal(next.totals.grossAmount, '1000');
});

function recordingForm(fields: Record<string, string | File>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries({ entityId: '1', year: '2026', month: '1', ...fields })) formData.set(key, value);
  return formData;
}

test('Coretax numbers pasted for a batch are matched by document number, recorded atomically and can be corrected or cleared', async () => {
  for (let index = 0; index < 3; index += 1) {
    db.tax_withholding_slips.push({ id: index + 1, ...readySlip({ invoice_number: `INV-${index + 1}` }), updated_at: stamp() });
  }
  // The faktur pajak number is what Coretax echoes for a TaxInvoice document.
  db.tax_withholding_slips.push({ id: 4, ...readySlip({ invoice_number: 'INV-FP', document_type: 'TaxInvoice', tax_invoice_number: '010.000-26.12345678' }), updated_at: stamp() });
  const preview = await exportActions.previewTaxExport({ entityId: 1, year: 2026, month: 1 });
  await exportActions.createTaxExportBatch({ entityId: 1, year: 2026, month: 1, slipIds: preview.batchIds });

  const empty = await coretaxActions.previewCoretaxRecording(recordingForm({}));
  assert.equal(empty.totals.exported, 4);
  assert.equal(empty.parsedRows, 0);
  assert.equal(empty.batches.length, 1);
  assert.equal(empty.batches[0].exported_count, 4);

  const matched = await coretaxActions.previewCoretaxRecording(recordingForm({ text: 'INV-1\t26000AAA1\n010.000-26.12345678\t26000AAA4\nINV-9\t26000AAA9\nINV-2\tkosong' }));
  assert.equal(matched.parsedRows, 4);
  assert.deepEqual(matched.candidates.map((row) => [row.id, row.proposedNumber, row.action]), [[1, '26000AAA1', 'record'], [2, 'KOSONG', 'none'], [3, null, 'none'], [4, '26000AAA4', 'record']]);
  assert.match(matched.candidates[1].problems[0], /memuat angka/);
  assert.equal(matched.candidates[3].document_number, '010.000-26.12345678');
  assert.equal(matched.unmatched.length, 1, 'INV-9 is unknown');
  assert.equal(matched.totals.record, 2);
  assert.equal(matched.totals.blocked, 1);

  const recorded = await coretaxActions.recordCoretaxNumbers({
    entityId: 1, year: 2026, month: 1,
    assignments: matched.candidates.filter((row) => row.action === 'record').map((row) => ({ slipId: row.id, coretaxNumber: row.proposedNumber!, version: row.updated_at })),
  });
  assert.deepEqual(recorded, { recorded: 2, replaced: 0 });
  assert.equal(db.tax_withholding_slips.find((row) => row.id === 1).status, 'reported');
  assert.equal(db.tax_withholding_slips.find((row) => row.id === 4).coretax_slip_number, '26000AAA4');
  assert.equal(db.tax_withholding_slips.find((row) => row.id === 2).status, 'exported');

  // A stale version (the slip was recorded by someone else meanwhile) aborts the call.
  await assert.rejects(coretaxActions.recordCoretaxNumbers({
    entityId: 1, year: 2026, month: 1, allowReplace: true,
    assignments: [{ slipId: 1, coretaxNumber: '26000AAA7', version: matched.candidates[0].updated_at }],
  }), /berubah sejak pratinjau/);
  // Replacing needs explicit permission; a number held by another slip is refused.
  const after = await coretaxActions.previewCoretaxRecording(recordingForm({}));
  const first = after.candidates.find((row) => row.id === 1)!;
  await assert.rejects(coretaxActions.recordCoretaxNumbers({ entityId: 1, year: 2026, month: 1, assignments: [{ slipId: 1, coretaxNumber: '26000AAA7', version: first.updated_at }] }), /izin ganti nomor/);
  await assert.rejects(coretaxActions.recordCoretaxNumbers({ entityId: 1, year: 2026, month: 1, allowReplace: true, assignments: [{ slipId: 1, coretaxNumber: '26000AAA4', version: first.updated_at }] }), /sudah dipakai bukti potong lain/);
  const replaced = await coretaxActions.recordCoretaxNumbers({ entityId: 1, year: 2026, month: 1, allowReplace: true, assignments: [{ slipId: 1, coretaxNumber: '26000aaa7', version: first.updated_at }] });
  assert.deepEqual(replaced, { recorded: 1, replaced: 1 });
  assert.equal(db.tax_withholding_slips.find((row) => row.id === 1).coretax_slip_number, '26000AAA7');
  // Malformed input never reaches the database.
  await assert.rejects(coretaxActions.recordCoretaxNumbers({ entityId: 1, year: 2026, month: 1, assignments: [{ slipId: 2, coretaxNumber: 'SUDAH DIUPLOAD', version: 'x' }] }), /tanpa spasi/);
  await assert.rejects(coretaxActions.recordCoretaxNumbers({ entityId: 1, year: 2026, month: 1, assignments: [{ slipId: 2, coretaxNumber: '26000AAA2', version: 'x' }, { slipId: 3, coretaxNumber: '26000AAA2', version: 'y' }] }), /sama diberikan/);

  // Clearing needs the version the dialog showed: a number corrected meanwhile survives.
  const shown = after.candidates.find((row) => row.id === 4)!;
  await coretaxActions.recordCoretaxNumbers({ entityId: 1, year: 2026, month: 1, allowReplace: true, assignments: [{ slipId: 4, coretaxNumber: '26000AAA5', version: shown.updated_at }] });
  await assert.rejects(coretaxActions.clearCoretaxNumber({ slipId: 4, version: shown.updated_at }), /berubah sejak dibuka/);
  assert.equal(db.tax_withholding_slips.find((row) => row.id === 4).coretax_slip_number, '26000AAA5');
  const latest = (await coretaxActions.previewCoretaxRecording(recordingForm({}))).candidates.find((row) => row.id === 4)!;
  await coretaxActions.clearCoretaxNumber({ slipId: 4, version: latest.updated_at });
  const cleared = db.tax_withholding_slips.find((row) => row.id === 4);
  assert.equal(cleared.status, 'exported');
  assert.equal(cleared.coretax_slip_number, null);
  await assert.rejects(coretaxActions.clearCoretaxNumber({ slipId: 4, version: cleared.updated_at }), /berstatus dilaporkan/);
});

test('clearCoretaxNumber refuses an imported reported slip that has no batch to return to', async () => {
  db.tax_withholding_slips.push({ id: 1, ...readySlip({ status: 'reported', coretax_slip_number: '26000AAA1', source: 'import_rekapan' }), updated_at: stamp() });
  await assert.rejects(coretaxActions.clearCoretaxNumber({ slipId: 1, version: db.tax_withholding_slips[0].updated_at }), /tanpa batch export/);
  assert.equal(db.tax_withholding_slips[0].status, 'reported');
});

test('getTaxYearSummary groups the year per masa and pasal + KAP + KJS with pending PPh', async () => {
  db.tax_object_codes.push({ code: '28-409-01', name: 'Sewa tanah/bangunan', pph_article: 'pph4_2', rate_percent: 10, is_active: true, kap: '411128', kjs: '409' });
  db.tax_object_codes.push({ code: '24-104-34', name: 'Jasa iklan', pph_article: 'pph23', rate_percent: 2, is_active: true, kap: '411124', kjs: '104' });
  let id = 0;
  const add = (overrides: Record<string, unknown>) => db.tax_withholding_slips.push({ id: ++id, ...readySlip(overrides), updated_at: stamp() });
  add({ period_month: 1, gross_amount: '1000000', withholding_amount: '20000', status: 'reported', coretax_slip_number: '26000AAA1' });
  add({ period_month: 1, object_code: '24-104-34', gross_amount: '500000', withholding_amount: '10000' });
  add({ period_month: 1, object_code: '28-409-01', pph_article: 'pph4_2', gross_amount: '2000000', withholding_amount: '200000', status: 'draft' });
  add({ period_month: 3, gross_amount: '1500000', withholding_amount: '30000', status: 'exported', export_batch_id: 1 });
  add({ period_month: 3, period_year: 2025, gross_amount: '9', withholding_amount: '9' });

  const summary = await coretaxActions.getTaxYearSummary({ entityId: 1, year: 2026 });
  assert.equal(summary.count, 4);
  assert.equal(summary.withholdingAmount, '260000');
  assert.deepEqual(summary.months.map((month) => [month.month, month.count, month.withholdingAmount]), [[1, 3, '230000'], [3, 1, '30000']]);
  assert.deepEqual(summary.months[0].groups.map((group) => [group.article, group.kap, group.kjs, group.objectCodes, group.count, group.withholdingAmount, group.pendingWithholdingAmount]), [
    ['pph23', '411124', '104', ['24-104-24', '24-104-34'], 2, '30000', '10000'],
    ['pph4_2', '411128', '409', ['28-409-01'], 1, '200000', '200000'],
  ]);
  assert.deepEqual(summary.groups.map((group) => [group.article, group.count, group.withholdingAmount, group.pendingWithholdingAmount, group.byStatus.reported, group.byStatus.exported]), [
    ['pph23', 3, '60000', '40000', 1, 1],
    ['pph4_2', 1, '200000', '200000', 0, 0],
  ]);
});

test('a multi-column CSV download with quoted fields is parsed as a sheet and matched', async () => {
  db.tax_withholding_slips.push({ id: 1, ...readySlip({ invoice_number: 'INV, 1', status: 'exported', export_batch_id: 1 }), updated_at: stamp() });
  db.tax_withholding_slips.push({ id: 2, ...readySlip({ invoice_number: 'INV-2', status: 'exported', export_batch_id: 1 }), updated_at: stamp() });
  const csv = 'Nomor Dokumen,NPWP,DPP,Nomor Bukti Potong\n"INV, 1",0012345678901000,1000000,26000CSV01\nINV-2,0012345678901000,1000000,26000CSV02\n';
  const file = new File([csv], 'daftar-bpu.csv', { type: 'text/csv' });
  const preview = await coretaxActions.previewCoretaxRecording(recordingForm({ file }));
  assert.deepEqual(preview.issues, []);
  assert.equal(preview.parsedRows, 2);
  assert.deepEqual(preview.candidates.map((row) => [row.id, row.proposedNumber, row.action]), [[1, '26000CSV01', 'record'], [2, '26000CSV02', 'record']]);
  const semicolon = new File(['Nomor Dokumen;Nomor Bukti Potong\nINV-2;26000CSV09\n'], 'daftar.txt', { type: 'text/plain' });
  const second = await coretaxActions.previewCoretaxRecording(recordingForm({ file: semicolon }));
  assert.equal(second.candidates.find((row) => row.id === 2)?.proposedNumber, '26000CSV09');
});

test('previewCoretaxRecording proposes nothing for a slip with conflicting source numbers or a document from another masa', async () => {
  db.tax_withholding_slips.push({ id: 1, ...readySlip({ invoice_number: 'INV-ONE', status: 'exported', export_batch_id: 1 }), updated_at: stamp() });
  db.tax_withholding_slips.push({ id: 2, ...readySlip({ invoice_number: 'INV-JAN', status: 'exported', export_batch_id: 1 }), updated_at: stamp() });
  const preview = await coretaxActions.previewCoretaxRecording(recordingForm({
    text: 'Nomor Dokumen\tNPWP\tDPP\tNomor Bukti Potong\nINV-ONE\t\t\t26000REV3\nINV-ONE\t\t\t26000REV4\nINV-DEC\t0012345678901000\t1000000\t26000REV2',
  }));
  const one = preview.candidates.find((row) => row.id === 1)!;
  assert.equal(one.proposedNumber, null);
  assert.equal(one.action, 'none');
  assert.match(one.problems[0], /bertentangan/);
  const jan = preview.candidates.find((row) => row.id === 2)!;
  assert.equal(jan.proposedNumber, null, 'INV-DEC is not tied to INV-JAN by NPWP + DPP');
  assert.equal(preview.unmatched.length, 1);
  assert.match(preview.unmatched[0].reason, /INV-DEC tidak ada .* sama dengan INV-ONE, INV-JAN; ketik/);
  assert.equal(preview.conflicts.length, 1);
  assert.equal(preview.totals.record, 0);
  assert.equal(preview.totals.blocked, 1);

  // Combined conflicts: INV-JAN claiming the number INV-ONE also claimed gets no proposal either.
  const combined = await coretaxActions.previewCoretaxRecording(recordingForm({ text: 'INV-ONE\t26000AAA1\nINV-ONE\t26000AAA2\nINV-JAN\t26000AAA1' }));
  assert.deepEqual(combined.candidates.map((row) => [row.id, row.proposedNumber, row.action, row.problems.length]), [[1, null, 'none', 1], [2, null, 'none', 1]]);
  assert.equal(combined.totals.record, 0);
  await assert.rejects(coretaxActions.recordCoretaxNumbers({ entityId: 1, year: 2026, month: 1, assignments: [] }), /Tidak ada nomor/);
});

test('payment records validate the billing id and group, record NTPN to pay the group, and revert on clear', async () => {
  db.tax_withholding_slips.push({ id: 1, ...readySlip({ status: 'reported', coretax_slip_number: '26000AAA1', export_batch_id: 1 }), updated_at: stamp() });
  db.tax_withholding_slips.push({ id: 2, ...readySlip({ status: 'reported', coretax_slip_number: '26000AAA2', export_batch_id: 1, invoice_number: 'INV-B' }), updated_at: stamp() });
  db.tax_withholding_slips.push({ id: 3, ...readySlip({ status: 'exported', export_batch_id: 1, invoice_number: 'INV-C' }), updated_at: stamp() });
  db.tax_withholding_slips.push({ id: 4, ...readySlip({ status: 'reported', coretax_slip_number: '26000AAA4', export_batch_id: 1, invoice_number: 'INV-FEB', period_month: 2, invoice_date: '2026-02-05', document_date: '2026-02-05', withholding_date: '2026-02-05' }), updated_at: stamp() });
  const base = { entityId: 1, year: 2026, month: 1, article: 'pph23' as const, kap: '411124', kjs: '104', billingCreatedAt: '2026-02-03' };

  await assert.rejects(paymentActions.saveTaxPaymentRecord({ ...base, billingId: '12345', billingAmount: '40000' }), /15 digit/);
  await assert.rejects(paymentActions.saveTaxPaymentRecord({ ...base, kjs: '999', billingId: '012345678901234', billingAmount: '40000' }), /Tidak ada kode objek/);
  await assert.rejects(paymentActions.saveTaxPaymentRecord({ ...base, billingId: '012345678901234', billingAmount: '400.5' }), /rupiah bulat/);
  await assert.rejects(paymentActions.saveTaxPaymentRecord({ ...base, billingId: '012345678901234', billingAmount: '40000', billingValidUntil: '2026-01-01' }), /sebelum tanggal pembuatannya/);

  const record = await paymentActions.saveTaxPaymentRecord({ ...base, billingId: '0123 4567 8901 234', billingAmount: '40000', billingValidUntil: '2026-03-05' });
  assert.equal(record.billing_id, '012345678901234');
  assert.equal(record.groupKey, '1|pph23|411124|104');
  assert.equal(record.ntpn, null);
  const listed = await paymentActions.listTaxPaymentRecords({ entityId: 1, year: 2026 });
  assert.equal(listed.length, 1);

  await assert.rejects(paymentActions.recordTaxPaymentNtpn({ id: record.id, version: record.updated_at, ntpn: 'abc', paidAt: '2026-02-05', paidAmount: '40000' }), /16 huruf/);
  await assert.rejects(paymentActions.recordTaxPaymentNtpn({ id: record.id, version: 'stale', ntpn: 'ABCDEFGH12345678', paidAt: '2026-02-05', paidAmount: '40000' }), /berubah sejak dibaca/);
  const paid = await paymentActions.recordTaxPaymentNtpn({ id: record.id, version: record.updated_at, ntpn: 'abcdefgh12345678', paidAt: '2026-02-05', paidAmount: '40000' });
  assert.deepEqual(paid, { slipsPaid: 2 }, 'both reported January pph23 slips are paid; the exported one and February are untouched');
  assert.deepEqual(db.tax_withholding_slips.map((row) => row.status), ['paid', 'paid', 'exported', 'reported']);
  const afterPay = (await paymentActions.listTaxPaymentRecords({ entityId: 1, year: 2026 }))[0];
  assert.equal(afterPay.ntpn, 'ABCDEFGH12345678');

  // A record with an NTPN can be neither edited nor deleted; clearing reverts the group.
  await assert.rejects(paymentActions.saveTaxPaymentRecord({ ...base, id: record.id, version: afterPay.updated_at, billingId: '012345678901234', billingAmount: '41000' }), /berubah sejak dibuka/);
  await assert.rejects(paymentActions.deleteTaxPaymentRecord({ id: record.id, version: afterPay.updated_at }), /sudah punya NTPN/);
  const cleared = await paymentActions.clearTaxPaymentNtpn({ id: record.id, version: afterPay.updated_at });
  assert.deepEqual(cleared, { slipsReverted: 2 });
  assert.deepEqual(db.tax_withholding_slips.map((row) => row.status), ['reported', 'reported', 'exported', 'reported']);
  const afterClear = (await paymentActions.listTaxPaymentRecords({ entityId: 1, year: 2026 }))[0];
  await paymentActions.deleteTaxPaymentRecord({ id: record.id, version: afterClear.updated_at });
  assert.equal((await paymentActions.listTaxPaymentRecords({ entityId: 1, year: 2026 })).length, 0);
});
