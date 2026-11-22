import React from 'react';
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createRequire } from 'node:module';
import * as XLSX from 'xlsx';

const require = createRequire(import.meta.url);
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let activeWorkspace = A, displayedWorkspace = A, role = 'admin', denied = false, failBootstrap = false;
let db: Record<string, any[]> = {}, reads = 0, writes = 0;
function from(table: string) {
  const filters: Record<string, unknown> = {};
  let operation = 'read', payload: any, bounds: number[] | undefined, single = false;
  const query: any = {
    select() { return query; }, order() { return query; },
    eq(key: string, value: unknown) { filters[key] = value; return query; },
    range(start: number, end: number) { bounds = [start, end]; return query; },
    insert(value: any) { operation = 'insert'; payload = value; return query; },
    update(value: any) { operation = 'update'; payload = value; return query; },
    upsert(value: any, options: any) {
      assert.deepEqual(options, { onConflict: 'counterparty_id,facility_code,document_number,valid_from', ignoreDuplicates: true });
      operation = 'upsert'; payload = value; return query;
    },
    single() { single = true; return query; },
    then(resolve: (result: any) => void) {
      const stored = db[table] ??= [];
      let rows = stored.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
      if (operation === 'read') reads++;
      else {
        writes++;
        if (operation === 'update') rows.forEach(row => Object.assign(row, payload));
        else {
          rows = [];
          for (const value of Array.isArray(payload) ? payload : [payload]) {
            if (operation === 'upsert' && stored.some(row => ['counterparty_id', 'facility_code', 'document_number', 'valid_from'].every(key => (row[key] ?? null) === (value[key] ?? null)))) continue;
            const row = { id: Math.max(0, ...stored.map(row => row.id)) + 1, ...value };
            stored.push(row); rows.push(row);
          }
        }
      }
      if (bounds) rows = rows.slice(bounds[0], bounds[1] + 1);
      resolve({ data: structuredClone(single ? rows[0] : rows), error: null });
    },
  };
  return query;
}
require.cache[require.resolve('../lib/supabase-server')] = { exports: { createServiceSupabase: () => ({ from }) } } as any;
require.cache[require.resolve('../lib/dashboard-access')] = { exports: { requireDashboardTabAccess: async () => {
  if (denied) throw new Error('Forbidden');
  return { workspaceId: activeWorkspace, profile: { id: 'synthetic-user', role } };
} } } as any;
const actions = require('../lib/tax-withholding-actions') as typeof import('../lib/tax-withholding-actions');
const headers = ['NAMA LAWAN TRANSAKSI', 'NPWP', 'STATUS PKP', 'TIN', 'ALAMAT', 'KODE NEGARA', 'JENIS FASILITAS', 'NO. SKD / SKB', 'TGL BERLAKU'];
function workbook(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'MASTER LAWAN TRANSAKSI');
  return new File([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })], 'synthetic.xlsx');
}
function form(rows: unknown[][], workspace: string | null = A) {
  const data = new FormData(); data.set('file', workbook(rows));
  if (workspace) data.set('workspaceId', workspace);
  return data;
}
const vendor = (overrides = {}) => ({ id: 1, workspace_id: A, name: 'VENDOR', identity_type: 'npwp', identity_number: '0210893970035000', is_pkp: false, country_code: 'IDN', address: null, notes: null, ...overrides });
beforeEach(() => { activeWorkspace = A; displayedWorkspace = A; role = 'admin'; denied = false; failBootstrap = false; reads = 0; writes = 0; db = { tax_counterparties: [], tax_counterparty_facilities: [] }; });

test('Tax Manager can manage tax master data but still needs the workspace tab permission', async () => {
  role = 'tax_manager';
  assert.equal((await actions.getTaxWithholdingBootstrap()).canManage, true);
  const rows = [['VENDOR', '0210893970035000']];
  assert.equal((await actions.commitCounterpartyImport(form(rows))).inserted, 1);
  const before = structuredClone(db);
  denied = true;
  await assert.rejects(actions.commitCounterpartyImport(form(rows)), /Forbidden/);
  assert.deepEqual(db, before);
});

test('import preserves renewed certificates and repeated imports remain idempotent', async () => {
  db.tax_counterparties = [vendor()];
  db.tax_counterparty_facilities = [{ id: 1, workspace_id: A, counterparty_id: 1, facility_code: 'TaxExAr23', document_number: 'CERT', valid_from: '2026-01-01' }];
  const rows = [['VENDOR', '0210893970035000', '', '', '', 'IDN', 'SKB', 'CERT', '2027-01-01']];
  assert.equal((await actions.previewCounterpartyImport(form(rows))).facilityCount, 1);
  assert.equal((await actions.commitCounterpartyImport(form(rows))).facilitiesInserted, 1);
  assert.equal((await actions.commitCounterpartyImport(form(rows))).facilitiesInserted, 0);
  assert.deepEqual(db.tax_counterparty_facilities.map(row => row.valid_from), ['2026-01-01', '2027-01-01']);
});

test('unnumbered renewals and undated certificates use the same database identity', async () => {
  db.tax_counterparties = [vendor()];
  const rows = (date: string) => [['VENDOR', '0210893970035000', '', '', '', 'IDN', 'SKB', '', date]];
  for (const date of ['', '2026-01-01', '2027-01-01']) {
    assert.equal((await actions.commitCounterpartyImport(form(rows(date)))).facilitiesInserted, 1);
    assert.equal((await actions.commitCounterpartyImport(form(rows(date)))).facilitiesInserted, 0);
  }
  assert.equal(db.tax_counterparty_facilities.length, 3);
});

test('identity conflicts are visible in preview and commit without any vendor or facility mutation', async () => {
  db.tax_counterparties = [vendor()];
  const before = structuredClone(db);
  const rows = [['VENDOR', '0021628888053000', 'PKP', '', 'Other taxpayer address', 'IDN', 'SKB', 'OTHER-CERT', '2026-01-01']];
  const preview = await actions.previewCounterpartyImport(form(rows));
  assert.deepEqual([preview.newCount, preview.existingCount, preview.facilityCount, preview.skipped], [0, 0, 0, 1]);
  assert.equal(preview.sample[0].status, 'blocked');
  assert.equal(preview.issues[0].level, 'error');
  const result = await actions.commitCounterpartyImport(form(rows));
  assert.deepEqual(result, { inserted: 0, updated: 0, facilitiesInserted: 0, skipped: 1, issues: preview.issues });
  assert.deepEqual(db, before); assert.equal(writes, 0);
});

test('commit rechecks identity conflicts introduced after preview while valid neighbors still import', async () => {
  const rows = [['VENDOR', '0021628888053000', 'PKP'], ['NEIGHBOR', '0940424419429000']];
  assert.equal((await actions.previewCounterpartyImport(form(rows))).newCount, 2);
  db.tax_counterparties = [vendor()];
  const result = await actions.commitCounterpartyImport(form(rows));
  assert.equal(result.inserted, 1); assert.equal(result.skipped, 1);
  assert.match(result.issues[0].message, /identitas berbeda/);
  assert.deepEqual(db.tax_counterparties[0], vendor());
});

test('matching identities still enrich the existing vendor', async () => {
  db.tax_counterparties = [vendor()];
  const result = await actions.commitCounterpartyImport(form([['VENDOR', '0210893970035000', 'PKP', '', 'Verified address']]));
  assert.equal(result.updated, 1); assert.deepEqual(result.issues, []);
  assert.equal(db.tax_counterparties[0].is_pkp, true);
  assert.equal(db.tax_counterparties[0].address, 'Verified address');
});

test('preview and commit reject stale/missing workspace and unauthorized roles before reading data', async () => {
  const rows = [['VENDOR', '0210893970035000']];
  for (const action of [actions.previewCounterpartyImport, actions.commitCounterpartyImport]) {
    await assert.rejects(action(form(rows, B)), /Workspace aktif berubah/);
    await assert.rejects(action(form(rows, null)), /Pratinjau/);
    role = 'staf_ops'; await assert.rejects(action(form(rows)), /role finance/); role = 'admin';
    denied = true; await assert.rejects(action(form(rows)), /Forbidden/); denied = false;
  }
  assert.equal(reads, 0); assert.equal(writes, 0);
});

// Render the actual page with real preview/commit actions and XLSX parsing.
// Only the authenticated workspace and database transport are synthetic.
Object.assign(globalThis, { React });
require.cache[require.resolve('../lib/WorkspaceContext')] = { exports: { useWorkspace: () => ({ activeWorkspace: { id: displayedWorkspace, name: displayedWorkspace === A ? 'Alpha' : 'Beta' } }) } } as any;
require.cache[require.resolve('../lib/tax-withholding-actions')] = { exports: { ...actions, getTaxWithholdingBootstrap: async () => {
  if (failBootstrap) throw new Error('Master belum dapat dimuat ulang');
  return { canManage: true, businesses: [], entities: [], counterparties: [], objectCodeCount: 210 };
} } } as any;
const Page = require('../app/dashboard/tax-withholding/page').default;
const { create, act } = require('react-test-renderer');

test('an unrelated oversized sheet does not block the sheet that carries the master header', async () => {
  const book = XLSX.utils.book_new();
  const raw = XLSX.utils.aoa_to_sheet([['Raw export']]);
  raw[XLSX.utils.encode_cell({ r: 50_000, c: 0 })] = { t: 'n', v: 1 };
  raw['!ref'] = 'A1:A50001';
  XLSX.utils.book_append_sheet(book, raw, 'Raw export');
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ['VENDOR BARU', '0210893970035000', '', '', '', 'IDN', '', '', '']]), 'Import data');
  const data = new FormData();
  data.set('file', new File([XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })], 'two-sheets.xlsx'));
  data.set('workspaceId', A);
  const preview = await actions.previewCounterpartyImport(data);
  assert.equal(preview.sheetName, 'Import data');
  assert.equal(preview.newCount, 1);
});

test('two tabs: page workspace is sent before preview and commit; switching the page clears its preview', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const confirmations: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout, confirm: (text: string) => { confirmations.push(text); return true; } } });
  let renderer: any;
  const click = async (label: string) => {
    const button = renderer.root.findAllByType('button').find((b: any) => b.children.join('') === label);
    assert.ok(button, label); assert.equal(button.props.disabled ?? false, false, label);
    await act(async () => { button.props.onClick(); });
  };
  try {
    await act(async () => { renderer = create(<Page />); });
    await click('Impor');
    await act(async () => renderer.root.findAllByProps({ type: 'file' })[0].props.onChange({ target: { files: [workbook([['VENDOR', '0210893970035000']])] } }));
    activeWorkspace = B; // Another tab changes the shared cookie before Preview.
    await click('Pratinjau');
    assert.match(JSON.stringify(renderer.toJSON()), /Workspace aktif berubah/);
    assert.equal(reads, 0); assert.equal(writes, 0);
    activeWorkspace = A;
    await click('Pratinjau');
    activeWorkspace = B; // Another tab changes it after Preview.
    await click('Impor sekarang');
    assert.match(confirmations[0], /workspace Alpha/);
    assert.match(JSON.stringify(renderer.toJSON()), /Workspace aktif berubah/);
    assert.equal(writes, 0);
    displayedWorkspace = B;
    await act(async () => renderer.update(<Page />));
    const commit = renderer.root.findAllByType('button').find((b: any) => b.children.join('') === 'Impor sekarang');
    assert.equal(commit.props.disabled, true);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('inline counterparty save keeps its editor mounted so facilities can be added before closing', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} } });
  let renderer: any;
  try {
    await act(async () => { renderer = create(<Page />); });
    await act(async () => renderer.root.find((node: any) => node.type?.name === 'SlipsSection').props.onCreateCounterparty());
    const editor = renderer.root.find((node: any) => node.type?.name === 'CounterpartyModal');
    await act(async () => editor.props.onSaved('Lawan transaksi ditambahkan. Anda bisa menambah fasilitas sekarang.'));
    assert.equal(renderer.root.findAll((node: any) => node.type?.name === 'CounterpartyModal').length, 1);
    await act(async () => editor.props.onSaved('Fasilitas ditambahkan.'));
    assert.equal(renderer.root.findAll((node: any) => node.type?.name === 'CounterpartyModal').length, 1);
    await act(async () => editor.props.onClose());
    assert.equal(renderer.root.findAllByType('dialog').length, 0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('a failed master refresh preserves the mounted form and its unsaved inputs', async () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} } });
  let renderer: any;
  const click = async (label: string) => act(async () => renderer.root.findAllByType('button').find((b: any) => b.children.join('') === label).props.onClick());
  try {
    await act(async () => { renderer = create(<Page />); });
    await click('Lawan Transaksi');
    await click('+ Tambah');
    const nameInput = () => renderer.root.findByType('dialog').findAllByType('input')[0];
    await act(async () => nameInput().props.onChange({ target: { value: 'ISIAN BELUM DISIMPAN' } }));
    failBootstrap = true;
    await act(async () => renderer.root.find((node: any) => node.type?.name === 'CounterpartiesSection').props.onChanged());
    assert.match(JSON.stringify(renderer.toJSON()), /Master belum dapat dimuat ulang/);
    assert.equal(nameInput().props.value, 'ISIAN BELUM DISIMPAN');
    failBootstrap = false;
    await click('Coba lagi');
    assert.equal(nameInput().props.value, 'ISIAN BELUM DISIMPAN');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('object codes: finance creates a code once, edits keep the code fixed, other roles are rejected', async () => {
  db.tax_object_codes = [{ code: '24-104-24', name: 'Jasa Software', pph_article: 'pph23', rate_percent: '2.000', kap: '411124', kjs: '104', description: null, legal_basis: null, is_active: true, updated_at: '2026-01-01T00:00:00Z' }];
  const created = await actions.saveTaxObjectCode({ mode: 'create', code: '28.408.02', name: 'Hibah saham BUMN', pphArticle: 'pph4_2', ratePercent: '0', kap: '411128', kjs: '408', legalBasis: 'PER-12/PJ/2026', description: 'Restrukturisasi BUMN' });
  assert.equal(created.code, '28-408-02');
  assert.equal(created.rate_percent, 0);
  assert.equal(created.is_active, true);
  assert.equal(db.tax_object_codes.length, 2);

  await assert.rejects(actions.saveTaxObjectCode({ mode: 'create', code: '24-104-24', name: 'Dup', pphArticle: 'pph23', ratePercent: '2' }), /sudah ada/);
  await assert.rejects(actions.saveTaxObjectCode({ mode: 'update', code: '24-104-99', name: 'Hilang', pphArticle: 'pph23', ratePercent: '2' }), /tidak ditemukan/);
  await assert.rejects(actions.saveTaxObjectCode({ mode: 'create', code: '24-104-70', name: 'Salah pasal', pphArticle: 'pph26', ratePercent: '20' }), /Awalan kode 24-/);
  assert.equal(db.tax_object_codes.length, 2);

  const updated = await actions.saveTaxObjectCode({ mode: 'update', code: '24-104-24', name: 'Jasa Software (PMK 141)', pphArticle: 'pph23', ratePercent: '2', kap: '411124', kjs: '104', description: 'Termasuk lisensi dan pemeliharaan.', isActive: false });
  assert.equal(updated.code, '24-104-24');
  assert.equal(updated.description, 'Termasuk lisensi dan pemeliharaan.');
  assert.equal(updated.is_active, false);
  assert.equal(db.tax_object_codes.find(row => row.code === '24-104-24').name, 'Jasa Software (PMK 141)');

  const all = await actions.listTaxObjectCodes();
  assert.deepEqual(all.map(row => [row.code, row.rate_percent, row.is_active]), [['24-104-24', 2, false], ['28-408-02', 0, true]]);

  role = 'staf_marketing';
  const writesBefore = writes;
  await assert.rejects(actions.saveTaxObjectCode({ mode: 'create', code: '24-104-71', name: 'X', pphArticle: 'pph23', ratePercent: '2' }), /Hanya role finance/);
  assert.equal(writes, writesBefore);
});

test('object codes: pasal/KAP/KJS stay fixed once slips use the code, and PPh 26 codes must exist in the BPNR reference', async () => {
  db.tax_object_codes = [{ code: '24-104-24', name: 'Jasa Software', pph_article: 'pph23', rate_percent: '2.000', kap: '411124', kjs: '104', description: null, legal_basis: null, is_active: true, updated_at: '2026-01-01T00:00:00Z' }];
  db.tax_withholding_slips = [{ id: 1, workspace_id: A, object_code: '24-104-24' }];
  const base = { mode: 'update' as const, code: '24-104-24', name: 'Jasa Software', pphArticle: 'pph23', ratePercent: '2', kap: '411124', kjs: '104' };
  await assert.rejects(actions.saveTaxObjectCode({ ...base, kjs: '100' }), /sudah dipakai bukti potong/);
  await assert.rejects(actions.saveTaxObjectCode({ ...base, kap: '', kjs: '' }), /sudah dipakai bukti potong/);
  await assert.rejects(actions.saveTaxObjectCode({ ...base, pphArticle: 'pph4_2', code: '24-104-24' }), /Awalan kode 24-/);
  assert.equal(db.tax_object_codes[0].kjs, '104');
  const renamed = await actions.saveTaxObjectCode({ ...base, name: 'Jasa Software (PMK 141)', ratePercent: '3', description: 'Cakupan', isActive: false });
  assert.deepEqual([renamed.name, renamed.rate_percent, renamed.kjs, renamed.is_active], ['Jasa Software (PMK 141)', 3, '104', false]);

  db.tax_withholding_slips = [];
  const regrouped = await actions.saveTaxObjectCode({ ...base, kjs: '100' });
  assert.equal(regrouped.kjs, '100', 'unused codes may still be corrected');

  await assert.rejects(actions.saveTaxObjectCode({ mode: 'create', code: '27-100-99', name: 'Belum ada di BPNR', pphArticle: 'pph26', ratePercent: '20' }), /referensi BPNR/);
  assert.equal(db.tax_object_codes.length, 1);
  const bpnr = await actions.saveTaxObjectCode({ mode: 'create', code: '27-100-02', name: 'Bunga (PPh Pasal 26)', pphArticle: 'pph26', ratePercent: '20', kap: '411127', kjs: '100' });
  assert.equal(bpnr.code, '27-100-02');
});

test('object codes: the base rate of a BPNR-listed code must be one of the reference Deemed x Rate results', async () => {
  db.tax_object_codes = [{ code: '27-104-01', name: 'Imbalan jasa (PPh 26)', pph_article: 'pph26', rate_percent: '20.000', kap: '411127', kjs: '104', description: null, legal_basis: null, is_active: true, updated_at: '2026-01-01T00:00:00Z' }];
  const base = { mode: 'update' as const, code: '27-104-01', name: 'Imbalan jasa (PPh 26)', pphArticle: 'pph26', kap: '411127', kjs: '104' };
  await assert.rejects(actions.saveTaxObjectCode({ ...base, ratePercent: '10' }), /tidak cocok dengan referensi BPNR kode 27-104-01 \(pilihan: 20%\)/);
  assert.equal(db.tax_object_codes[0].rate_percent, '20.000');
  assert.equal((await actions.saveTaxObjectCode({ ...base, ratePercent: '20', description: 'Jasa, pekerjaan, kegiatan' })).description, 'Jasa, pekerjaan, kegiatan');

  await assert.rejects(actions.saveTaxObjectCode({ mode: 'create', code: '27-100-06', name: 'Premi asuransi (PPh 26)', pphArticle: 'pph26', ratePercent: '3' }), /pilihan: 1%, 2%, 5%/);
  const premium = await actions.saveTaxObjectCode({ mode: 'create', code: '27-100-06', name: 'Premi asuransi (PPh 26)', pphArticle: 'pph26', ratePercent: '5' });
  assert.equal(premium.rate_percent, 5);
  await assert.rejects(actions.saveTaxObjectCode({ mode: 'create', code: '28-405-02', name: 'Hadiah Undian', pphArticle: 'pph4_2', ratePercent: '20' }), /pilihan: 25%/);
  assert.equal((await actions.saveTaxObjectCode({ mode: 'create', code: '28-405-02', name: 'Hadiah Undian', pphArticle: 'pph4_2', ratePercent: '25' })).code, '28-405-02');
});

test('object codes: an unchanged seeded rate never blocks metadata edits; a changed or new rate must match the reference exactly', async () => {
  const seeded = (code: string, rate: string, article = 'pph4_2') => ({ code, name: `Objek ${code}`, pph_article: article, rate_percent: rate, kap: '411128', kjs: '409', description: null, legal_basis: null, is_active: true, updated_at: '2026-01-01T00:00:00Z' });
  db.tax_object_codes = [seeded('28-409-25', '2.650'), seeded('27-100-05', '20.000', 'pph26')];
  const edit = (code: string, ratePercent: string, article = 'pph4_2') => actions.saveTaxObjectCode({ mode: 'update', code, name: `Objek ${code}`, pphArticle: article, ratePercent, kap: '411128', kjs: '409', description: 'Catatan' });
  assert.equal((await edit('28-409-25', '2.65')).description, 'Catatan', 'the corrected reference accepts the seeded 2.65');
  assert.equal((await edit('28-409-25', '2.650')).rate_percent, 2.65);
  assert.equal((await edit('27-100-05', '20', 'pph26')).description, 'Catatan', 'a seeded off-reference rate left unchanged still allows metadata edits');
  await assert.rejects(edit('27-100-05', '10', 'pph26'), /pilihan: 5%/);
  await assert.rejects(edit('28-409-25', '0.002'), /pilihan: 2.65%/);
  assert.equal((await edit('27-100-05', '5', 'pph26')).rate_percent, 5);
  await assert.rejects(edit('27-100-05', '20', 'pph26'), /pilihan: 5%/, 'once corrected the old off-reference rate cannot come back');
});
