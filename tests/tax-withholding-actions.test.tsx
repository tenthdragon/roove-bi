import React from 'react';
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createRequire } from 'node:module';
import * as XLSX from 'xlsx';

const require = createRequire(import.meta.url);
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
let activeWorkspace = A, displayedWorkspace = A, role = 'admin', denied = false;
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
beforeEach(() => { activeWorkspace = A; displayedWorkspace = A; role = 'admin'; denied = false; reads = 0; writes = 0; db = { tax_counterparties: [], tax_counterparty_facilities: [] }; });

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
require.cache[require.resolve('../lib/tax-withholding-actions')] = { exports: { ...actions, getTaxWithholdingBootstrap: async () => ({ canManage: true, businesses: [], entities: [], counterparties: [], objectCodeCount: 210 }) } } as any;
const Page = require('../app/dashboard/tax-withholding/page').default;
const { create, act } = require('react-test-renderer');

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
    await click('Impor Master');
    await act(async () => renderer.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [workbook([['VENDOR', '0210893970035000']])] } }));
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
