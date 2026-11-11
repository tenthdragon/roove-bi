import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { transpileModule, ModuleKind, ScriptTarget, JsxEmit } from 'typescript';
import * as domain from '../lib/tax-withholding-domain';

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
  const pending: Pending[] = [], previews: Pending[] = [], notifications: any[] = [];
  const timers = new Map<number, { fn: () => void; ms: number }>(); let timerId = 0;
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: { setTimeout(fn: () => void, ms: number) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout(id: number) { timers.delete(id); } },
    document: { body: { style: {} }, addEventListener() {}, removeEventListener() {} },
  });
  const deferred = (list: Pending[], input: any) => new Promise((resolve, reject) => list.push({ input, resolve, reject }));
  const stubs: Record<string, any> = {
    '@/lib/tax-withholding-slip-actions': {
      listTaxSlips: (input: any) => deferred(pending, input),
      getTaxObjectCodes: async () => [{ code: '24-104-24', name: 'Software', pph_article: 'pph23', rate_percent: 2 }],
      previewTaxSlip: (input: any) => deferred(previews, input),
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
  return {
    pending, previews, notifications,
    get root() { return view.root; },
    text: () => JSON.stringify(view.toJSON()),
    async mount(overrides = {}) { await act(async () => { view = create(React.createElement(exports.SlipsSection, { ...props, ...overrides })); await tick(); }); },
    async update(overrides = {}) { await act(async () => { view.update(React.createElement(exports.SlipsSection, { ...props, ...overrides })); await tick(); }); },
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
