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

async function rpc(name: string, args: Record<string, any>) {
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
    slip_count: locked.length, total_gross: 0, total_withholding: 0, xml_sha256: args.p_xml_sha256, xml_content: args.p_xml_content, created_at: stamp(),
  };
  batches.push(batch);
  for (const row of locked) Object.assign(row, { status: 'exported', export_batch_id: batch.id, updated_at: stamp() });
  return { data: [{ batch_id: batch.id, sequence, file_name: batch.file_name }], error: null };
}

require.cache[require.resolve('../lib/supabase-server')] = { exports: { createServiceSupabase: () => ({ from, rpc }) } } as any;
require.cache[require.resolve('../lib/dashboard-access')] = { exports: { requireDashboardTabAccess: async () => ({ workspaceId: A, profile: { id: 'synthetic-user', role: 'staf_finance' } }) } } as any;
const slipActions = require('../lib/tax-withholding-slip-actions') as typeof import('../lib/tax-withholding-slip-actions');
const exportActions = require('../lib/tax-withholding-export-actions') as typeof import('../lib/tax-withholding-export-actions');

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
