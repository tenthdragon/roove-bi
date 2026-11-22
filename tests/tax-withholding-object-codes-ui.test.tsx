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

const row = (code: string, overrides = {}) => ({
  code, name: `Objek ${code}`, pph_article: 'pph23', rate_percent: 2, kap: '411124', kjs: '104',
  description: null, legal_basis: null, is_active: true, updated_at: '2026-11-19T01:00:00Z', ...overrides,
});
const rows = [
  row('24-104-24', { name: 'Jasa Software', description: 'Termasuk lisensi dan pemeliharaan.' }),
  row('27-100-06', { name: 'Premi Asuransi (PPh Pasal 26)', pph_article: 'pph26', rate_percent: 20, kap: '411127', kjs: '100' }),
  row('24-104-99', { name: 'Kode lama', is_active: false }),
];

function harness() {
  const saves: any[] = [], notifications: any[] = [];
  const previous = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: { addEventListener() {}, removeEventListener() {}, setTimeout(fn: () => void) { fn(); return 1; }, clearTimeout() {} },
    document: { body: { style: {} }, addEventListener() {}, removeEventListener() {} },
  });
  const stubs: Record<string, any> = {
    '@/lib/tax-withholding-actions': {
      listTaxObjectCodes: async () => structuredClone(rows),
      saveTaxObjectCode: async (input: any) => {
        saves.push(input);
        const normalized = domain.normalizeObjectCodeInput(input);
        if (!normalized.value) throw new Error(normalized.errors.join(' '));
        return { ...normalized.value, updated_at: '2026-11-19T02:00:00Z' };
      },
    },
    '@/lib/tax-withholding-domain': domain,
  };
  const source = transpileModule(readFileSync(new URL('../components/TaxWithholdingObjectCodes.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports: any = {};
  new Function('require', 'exports', 'React', source)((name: string) => stubs[name] ?? require(name), exports, React);
  let view: any;
  return {
    saves, notifications,
    get root() { return view.root; },
    text: () => JSON.stringify(view.toJSON()),
    async mount(canManage = true) {
      await act(async () => {
        view = create(React.createElement(exports.ObjectCodesSection, { canManage, notify: (message: any) => notifications.push(message) }));
        await tick();
      });
    },
    async close() { try { await act(async () => view?.unmount()); } finally { Object.assign(globalThis, previous); } },
  };
}
const button = (h: ReturnType<typeof harness>, label: string) => h.root.findAllByType('button').find((node: any) => node.children.includes(label));
const change = async (node: any, value: unknown) => act(async () => { node.props.onChange({ target: { value } }); await tick(); });

test('object code list hides inactive codes by default, filters by pasal and searches descriptions', async () => {
  const h = harness();
  try {
    await h.mount();
    assert.match(h.text(), /24-104-24/); assert.match(h.text(), /27-100-06/);
    assert.doesNotMatch(h.text(), /24-104-99/, 'inactive codes stay hidden until requested');
    assert.match(h.text(), /Termasuk lisensi/);

    await change(h.root.findByProps({ 'aria-label': 'Filter pasal' }), 'pph26');
    assert.doesNotMatch(h.text(), /24-104-24/); assert.match(h.text(), /27-100-06/);

    await change(h.root.findByProps({ 'aria-label': 'Filter pasal' }), 'all');
    await change(h.root.findByProps({ 'aria-label': 'Cari kode objek' }), 'lisensi');
    assert.match(h.text(), /24-104-24/); assert.doesNotMatch(h.text(), /27-100-06/);

    await change(h.root.findByProps({ 'aria-label': 'Cari kode objek' }), '');
    await act(async () => { h.root.findAllByType('input').find((node: any) => node.props.type === 'checkbox')!.props.onChange({ target: { checked: true } }); await tick(); });
    assert.match(h.text(), /24-104-99/);
  } finally { await h.close(); }
});

test('finance adds a code: pasal is suggested from the prefix, validation errors stay in the dialog, saved code joins the list', async () => {
  const h = harness();
  try {
    await h.mount();
    await act(async () => button(h, '+ Tambah kode').props.onClick());
    const dialog = h.root.findByProps({ role: 'dialog' });
    const codeInput = dialog.findAllByType('input').find((node: any) => node.props.placeholder === '24-104-24');
    await change(codeInput, '24.104.70');
    const pasalSelect = dialog.findAllByType('select')[0];
    assert.equal(pasalSelect.props.value, 'pph23', 'prefix 24 suggests PPh 23');

    await act(async () => button(h, 'Simpan').props.onClick());
    assert.match(h.text(), /Nama objek pajak wajib diisi/);
    assert.equal(h.saves.length, 1); assert.deepEqual(h.notifications, []);
    assert.ok(h.root.findAllByProps({ role: 'dialog' }).length > 0, 'dialog stays open after a validation error');

    const nameInput = dialog.findAllByType('input').find((node: any) => node.props.value === '' && node.props.placeholder === undefined && node.props.type === undefined);
    await change(nameInput, 'Jasa Baru');
    const rateInput = dialog.findAllByType('input').find((node: any) => node.props.placeholder === '2');
    await change(rateInput, '2');
    await act(async () => button(h, 'Simpan').props.onClick());
    assert.equal(h.saves.length, 2);
    assert.equal(h.saves[1].mode, 'create'); assert.equal(h.saves[1].code, '24.104.70');
    assert.deepEqual(h.notifications, [{ type: 'success', text: 'Kode objek 24-104-70 ditambahkan.' }]);
    assert.match(h.text(), /24-104-70/); assert.match(h.text(), /Jasa Baru/);
    assert.equal(h.root.findAllByProps({ role: 'dialog' }).length, 0);
  } finally { await h.close(); }
});

test('editing keeps the code fixed and read-only roles get no edit controls', async () => {
  const h = harness();
  try {
    await h.mount();
    await act(async () => button(h, 'Edit').props.onClick());
    const dialog = h.root.findByProps({ role: 'dialog' });
    const codeInput = dialog.findAllByType('input').find((node: any) => node.props.placeholder === '24-104-24');
    assert.equal(codeInput.props.disabled, true);
    assert.equal(codeInput.props.value, '24-104-24');
    await act(async () => button(h, 'Simpan').props.onClick());
    assert.equal(h.saves[0].mode, 'update');
    assert.equal(h.saves[0].description, 'Termasuk lisensi dan pemeliharaan.');
    assert.deepEqual(h.notifications, [{ type: 'success', text: 'Kode objek 24-104-24 diperbarui.' }]);
  } finally { await h.close(); }

  const readOnly = harness();
  try {
    await readOnly.mount(false);
    assert.equal(button(readOnly, '+ Tambah kode'), undefined);
    assert.equal(button(readOnly, 'Edit'), undefined);
    assert.match(readOnly.text(), /24-104-24/);
  } finally { await readOnly.close(); }
});
