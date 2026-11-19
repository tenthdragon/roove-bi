import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transpileModule, ModuleKind, ScriptTarget, JsxEmit } from 'typescript';
import * as domain from '../lib/tax-withholding-domain';
import { TaxWorkProvider } from '../components/TaxWithholdingContext';

const require = createRequire(import.meta.url);
const { create, act } = require('react-test-renderer');
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const entities = [{ id: 1, legal_name: 'PT A', is_active: true }, { id: 2, legal_name: 'PT B', is_active: true }];
const slip = (id: number, invoice: string) => ({
  id, entity_id: id, counterparty_id: 1, counterparty_name: 'VENDOR', counterparty_identity_type: 'npwp',
  counterparty_identity_number: '0012345678901234', invoice_number: invoice, invoice_date: '2026-11-01',
  object_code: '24-104-24', pph_article: 'pph23', facility_code: 'N/A', gross_amount: '1000', rate_percent: '2',
  rate_source: 'object_code', withholding_amount: '20', status: 'ready', gross_input_mode: 'dpp', gross_input_amount: '1000',
  additional_cost: '0', document_type: 'CommercialInvoice', document_date: '2026-11-01', withholding_date: '2026-11-01',
  period_month: 11, period_year: 2026, vat_rate_percent: '0', vat_amount: '0', total_amount: '1000', workbook_withholding_amount: null,
});
const result = (id: number, invoice: string, amount = '1000') => ({
  slips: [slip(id, invoice)], totals: { count: 1, grossAmount: amount, withholdingAmount: amount,
    byStatus: { draft: 0, ready: 1, reported: 0, paid: 0 }, byArticle: [] },
});
const previewResult = (gross: string, withholding: string) => ({ grossAmount: gross, withholdingAmount: withholding,
  vatRatePercent: '0', vatAmount: '0', ratePercent: '2', facilityCode: 'N/A', totalAmount: gross,
  explanation: [`DPP-${gross}-PPh-${withholding}`] });
type Pending = { input: any; resolve: (value: any) => void; reject: (error: Error) => void };

function harness() {
  const pending: Pending[] = [], previews: Pending[] = [], saves: Pending[] = [], notifications: any[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>(); let timerId = 0;
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: { addEventListener() {}, removeEventListener() {}, setTimeout(fn: () => void, ms: number) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout(id: number) { timers.delete(id); } },
    document: { body: { style: {} }, addEventListener() {}, removeEventListener() {} },
  });
  const deferred = (list: Pending[], input: any) => new Promise((resolve, reject) => list.push({ input, resolve, reject }));
  const stubs: Record<string, any> = {
    '@/lib/tax-withholding-slip-actions': {
      listTaxSlips: (input: any) => deferred(pending, input),
      getTaxObjectCodes: async () => [{ code: '24-104-24', name: 'Software', pph_article: 'pph23', rate_percent: 2 }],
      previewTaxSlip: (input: any) => deferred(previews, input),
      saveTaxSlip: (input: any) => deferred(saves, input),
    },
    '@/lib/tax-withholding-domain': domain,
  };
  const source = transpileModule(readFileSync(new URL('../components/TaxWithholdingSlips.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports: any = {};
  new Function('require', 'exports', 'React', source)((name: string) => stubs[name] ?? require(name), exports, React);
  const props = { entities, counterparties: [], canManage: true, notify: (message: any) => notifications.push(message) };
  let view: any;
  let currentProps = props;
  const tree = (visible = true) => React.createElement(TaxWorkProvider, null, visible ? React.createElement(exports.SlipsSection, currentProps) : null);
  return {
    pending, previews, saves, notifications,
    get root() { return view.root; },
    text: () => JSON.stringify(view.toJSON()),
    async mount(overrides = {}) { currentProps = { ...props, ...overrides }; await act(async () => { view = create(tree()); await tick(); }); },
    async update(overrides = {}) { currentProps = { ...props, ...overrides }; await act(async () => { view.update(tree()); await tick(); }); },
    async switchSection(visible: boolean) { await act(async () => { view.update(tree(visible)); await tick(); }); },
    async previewTimer() { await act(async () => { for (const [id, timer] of [...timers]) if (timer.ms === 350) { timers.delete(id); timer.fn(); } await tick(); }); },
    async close() { try { await act(async () => view?.unmount()); } finally { Object.assign(globalThis, previous); } },
  };
}
const settle = async (pending: Pending, value: any) => act(async () => { pending.resolve(value); await tick(); });
const reject = async (pending: Pending) => act(async () => { pending.reject(new Error('Obsolete request failed')); await tick(); });
const button = (h: ReturnType<typeof harness>, label: string) => h.root.findAllByType('button').find((node: any) => node.children.includes(label));

test('slip list ignores late responses and errors after entity/period selection changes', async () => {
  const h = harness();
  try {
    await h.mount();
    await act(async () => h.root.findByProps({ 'aria-label': 'Pemotong' }).props.onChange({ target: { value: '2' } }));
    await settle(h.pending[1], result(2, 'INVOICE-PT-B', '987654'));
    await settle(h.pending[0], result(1, 'INVOICE-PT-A'));
    assert.equal(h.root.findByProps({ 'aria-label': 'Pemotong' }).props.value, 2);
    assert.match(h.text(), /INVOICE-PT-B/); assert.doesNotMatch(h.text(), /INVOICE-PT-A/);
    assert.match(h.text(), /987\.654/);
    await act(async () => h.root.findByProps({ 'aria-label': 'Masa pajak' }).props.onChange({ target: { value: '1' } }));
    assert.doesNotMatch(h.text(), /INVOICE-PT-B|987\.654/, 'old rows and totals disappear while a new period loads');
    await act(async () => h.root.findByProps({ 'aria-label': 'Masa pajak' }).props.onChange({ target: { value: '2' } }));
    await reject(h.pending[2]);
    assert.match(h.text(), /Memuat/); assert.deepEqual(h.notifications, []);
    await settle(h.pending[3], result(2, 'FEBRUARY'));
    assert.match(h.text(), /FEBRUARY/);
  } finally { await h.close(); }
});

test('working PT, period and filters survive visiting another section', async () => {
  const h = harness();
  try {
    await h.mount();
    await act(async () => {
      h.root.findByProps({ 'aria-label': 'Pemotong' }).props.onChange({ target: { value: '2' } });
      h.root.findByProps({ 'aria-label': 'Masa pajak' }).props.onChange({ target: { value: '10' } });
      h.root.findByProps({ 'aria-label': 'Tahun pajak' }).props.onChange({ target: { value: '2025' } });
      h.root.findByProps({ 'aria-label': 'Cari bukti potong' }).props.onChange({ target: { value: 'INV-OLD' } });
    });
    await h.switchSection(false);
    await h.switchSection(true);
    assert.deepEqual(h.pending.at(-1)!.input, { entityId: 2, year: 2025, month: 10, status: 'all', search: 'INV-OLD' });
    assert.equal(h.root.findByProps({ 'aria-label': 'Pemotong' }).props.value, 2);
  } finally { await h.close(); }
});

test('new slip uses selected filing period even when invoice date differs, then reveals the saved PT', async () => {
  const h = harness();
  try {
    await h.mount({ counterparties: [{ id: 1, name: 'VENDOR', identity_type: 'npwp', identity_number: '0012345678901234', is_active: true, is_pkp: false, country_code: 'IDN', facilities: [] }] });
    await act(async () => {
      h.root.findByProps({ 'aria-label': 'Masa pajak' }).props.onChange({ target: { value: '10' } });
      h.root.findByProps({ 'aria-label': 'Tahun pajak' }).props.onChange({ target: { value: '2025' } });
    });
    await act(async () => button(h, '+ Tambah').props.onClick());
    assert.match(h.text(), /Oktober 2025/);
    const dialog = h.root.findByProps({ role: 'dialog' });
    const date = dialog.findAllByProps({ type: 'date' })[0];
    assert.equal(date.props.value, '2025-10-01');
    await act(async () => {
      date.props.onChange({ target: { value: '2025-11-02' } });
      dialog.findAllByType('select')[0].props.onChange({ target: { value: '2' } });
      dialog.findByProps({ placeholder: 'INV/2026/10/0001' }).props.onChange({ target: { value: 'INV-NEW' } });
      dialog.findByProps({ 'aria-label': 'Cari lawan transaksi' }).props.onChange({ target: { value: 'VENDOR' } });
      dialog.findByProps({ 'aria-label': 'Cari kode objek pajak' }).props.onChange({ target: { value: '24-104-24' } });
      dialog.findByProps({ placeholder: '7600' }).props.onChange({ target: { value: '1000' } });
    });
    await act(async () => {
      h.root.findAllByType('button').find((b: any) => b.children[0] === 'VENDOR')!.props.onClick();
      h.root.findAllByType('button').find((b: any) => b.children.some((c: any) => c?.type === 'span' && c.children[0] === '24-104-24'))!.props.onClick();
    });
    await act(async () => button(h, 'Simpan').props.onClick());
    assert.equal(h.saves[0].input.periodMonth, 10);
    assert.equal(h.saves[0].input.periodYear, 2025);
    assert.equal(h.saves[0].input.invoiceDate, '2025-11-02');
    await settle(h.saves[0], { ...slip(2, 'INV-NEW'), period_month: 10, period_year: 2025 });
    assert.deepEqual(h.pending.at(-1)!.input, { entityId: 2, year: 2025, month: 10, status: 'all', search: '' });
    assert.match(h.notifications.at(-1).text, /Oktober 2025/);
  } finally { await h.close(); }
});

test('load errors persist with retry and do not claim the period is empty; filtered empty offers reset', async () => {
  const h = harness();
  try {
    await h.mount();
    await act(async () => h.pending[0].reject(new Error('Koneksi terputus')));
    assert.match(h.text(), /Koneksi terputus/);
    assert.doesNotMatch(h.text(), /Belum ada bukti potong/);
    await act(async () => button(h, 'Coba lagi').props.onClick());
    await settle(h.pending.at(-1)!, result(1, 'RECOVERED'));
    assert.match(h.text(), /RECOVERED/);
    await act(async () => h.root.findByProps({ 'aria-label': 'Cari bukti potong' }).props.onChange({ target: { value: 'NO-MATCH' } }));
    await settle(h.pending.at(-1)!, { slips: [], totals: { ...result(1, '').totals, count: 0 } });
    assert.match(h.text(), /Tidak ada bukti potong yang cocok/);
    assert.doesNotMatch(h.text(), /Belum ada bukti potong/);
    await act(async () => button(h, 'Hapus filter').props.onClick());
    assert.equal(h.pending.at(-1)!.input.search, '');
  } finally { await h.close(); }
});

test('adding a missing counterparty keeps the open slip inputs when the master list refreshes', async () => {
  const h = harness();
  let requested = 0;
  try {
    await h.mount({ onCreateCounterparty: () => requested++ });
    await act(async () => button(h, '+ Tambah').props.onClick());
    await act(async () => {
      h.root.findByProps({ placeholder: 'INV/2026/10/0001' }).props.onChange({ target: { value: 'KEEP-INVOICE' } });
      h.root.findByProps({ 'aria-label': 'Cari lawan transaksi' }).props.onChange({ target: { value: 'VENDOR BARU' } });
    });
    await act(async () => button(h, 'Tambah lawan transaksi tanpa menutup form').props.onClick());
    assert.equal(requested, 1);
    await h.update({ counterparties: [{ id: 9, name: 'VENDOR BARU', identity_type: 'npwp', identity_number: '0012345678901234', is_active: true, is_pkp: false, country_code: 'IDN', facilities: [] }] });
    assert.equal(h.root.findByProps({ placeholder: 'INV/2026/10/0001' }).props.value, 'KEEP-INVOICE');
    await act(async () => h.root.findAllByType('button').find((b: any) => b.children[0] === 'VENDOR BARU')!.props.onClick());
    assert.equal(h.root.findByProps({ 'aria-label': 'Cari lawan transaksi' }).props.value, 'VENDOR BARU');
  } finally { await h.close(); }
});

test('slip preview clears obsolete amounts and ignores late successes/errors, including after clearing input', async () => {
  const h = harness();
  try {
    await h.mount(); await settle(h.pending[0], result(1, 'INVOICE'));
    await act(async () => button(h, 'Edit').props.onClick()); await h.previewTimer();
    const amount = () => h.root.findAllByType('input').find((input: any) => input.props.placeholder === '7600');
    await act(async () => amount().props.onChange({ target: { value: '10000' } })); await h.previewTimer();
    await settle(h.previews[1], previewResult('10000', '200'));
    await settle(h.previews[0], previewResult('1000', '20'));
    assert.equal(amount().props.value, '10000'); assert.match(h.text(), /DPP-10000-PPh-200/);
    assert.doesNotMatch(h.text(), /DPP-1000-PPh-20/);
    await act(async () => amount().props.onChange({ target: { value: '20000' } }));
    assert.doesNotMatch(h.text(), /DPP-10000-PPh-200/); await h.previewTimer();
    await act(async () => amount().props.onChange({ target: { value: '30000' } })); await h.previewTimer();
    await settle(h.previews[3], previewResult('30000', '600')); await reject(h.previews[2]);
    assert.match(h.text(), /DPP-30000-PPh-600/); assert.doesNotMatch(h.text(), /Obsolete request failed/);
    await act(async () => amount().props.onChange({ target: { value: '40000' } })); await h.previewTimer();
    await act(async () => amount().props.onChange({ target: { value: '' } }));
    await settle(h.previews[4], previewResult('40000', '800'));
    assert.doesNotMatch(h.text(), /DPP-40000-PPh-800/);
  } finally { await h.close(); }
});

test('inactive entities retain readable slip history and stored details, with creation/edit/delete disabled', async () => {
  const h = harness();
  try {
    await h.mount({ entities: [{ ...entities[0], is_active: false }] });
    assert.equal(h.pending[0].input.entityId, 1);
    await settle(h.pending[0], result(1, 'HISTORICAL-INVOICE'));
    assert.match(h.text(), /HISTORICAL-INVOICE/);
    assert.match(h.root.findByProps({ 'aria-label': 'Pemotong' }).findByType('option').children.join(''), /nonaktif/);
    assert.equal(button(h, '+ Tambah').props.disabled, true);
    assert.equal(button(h, 'Edit'), undefined); assert.equal(button(h, 'Hapus'), undefined);
    await act(async () => button(h, 'Lihat').props.onClick());
    assert.match(h.text(), /Angka tersimpan/); assert.equal(button(h, 'Simpan'), undefined);
    await h.previewTimer(); assert.equal(h.previews.length, 0);
  } finally { await h.close(); }
});

test('deactivating the selected entity preserves its history selection while another entity stays active', async () => {
  const h = harness();
  try {
    await h.mount(); await settle(h.pending[0], result(1, 'HISTORY-A'));
    await h.update({ entities: [{ ...entities[0], is_active: false }, entities[1]] });
    assert.equal(h.root.findByProps({ 'aria-label': 'Pemotong' }).props.value, 1);
    assert.match(h.text(), /HISTORY-A/); assert.equal(button(h, '+ Tambah').props.disabled, true);
    await act(async () => h.root.findByProps({ 'aria-label': 'Pemotong' }).props.onChange({ target: { value: '2' } }));
    await settle(h.pending[1], result(2, 'CURRENT-B'));
    assert.equal(button(h, '+ Tambah').props.disabled, false); assert.ok(button(h, 'Edit')); assert.ok(button(h, 'Hapus'));
  } finally { await h.close(); }
});
