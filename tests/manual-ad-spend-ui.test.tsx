import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import * as domain from '../lib/manual-marketplace-ad-spend';

const require = createRequire(import.meta.url);
const { create, act } = require('react-test-renderer');
const source = readFileSync(new URL('../app/dashboard/manual-ad-spend/page.tsx', import.meta.url), 'utf8');
const output = transpileModule(source, {
  compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
}).outputText;
const base = () => ({
  workspaceId: 'a',
  viewerId: 'me',
  canInput: true,
  startsOn: '2026-10-01',
  platforms: ['shopee_ads', 'tiktok_ads'],
  brands: [
    { id: 1, name: 'Roove', is_active: true },
    { id: 2, name: 'Other brand', is_active: false },
  ],
  actorNames: {},
  history: [],
  entries: [
    {
      id: 1,
      platform: 'shopee_ads',
      brand_id: 1,
      spend_date: '2026-11-02',
      amount: 150000,
      note: '',
      created_by: 'me',
      updated_at: '2026-11-02T00:00:00Z',
      version: 1,
    },
  ],
  fallbackRows: [{ platform: 'shopee_ads', brand_id: 1, date: '2026-11-01', amount: 300000 }],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function mount(overrides: Record<string, any> = {}) {
  const data = base();
  const saves: any[] = [];
  const deletes: any[] = [];
  let workspaceId = 'a';
  Object.assign(globalThis, {
    window: {
      addEventListener() {},
      removeEventListener() {},
      confirm: () => true,
      matchMedia: () => ({ matches: true }),
    },
    document: { getElementById: () => ({ focus() {}, scrollIntoView() {} }) },
    requestAnimationFrame: (fn: () => void) => fn(),
  });
  const stubs: Record<string, any> = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'lucide-react': require('lucide-react'),
    '@/lib/WorkspaceContext': { useWorkspace: () => ({ activeWorkspace: { id: workspaceId } }) },
    '@/lib/dashboard-cache': { invalidateAll() {} },
    '@/lib/utils': { getDatePartsInTimeZone: () => ({ iso: '2026-11-03' }) },
    '@/lib/manual-marketplace-ad-spend': domain,
    './page.module.css': { default: new Proxy({}, { get: (_target, name) => String(name) }) },
    '@/lib/manual-marketplace-ad-spend-actions': {
      getManualMarketplaceSpendPage: async () => data,
      saveManualMarketplaceSpend: async (input: any) => {
        saves.push(input);
      },
      deleteManualMarketplaceSpend: async (input: any) => {
        deletes.push(input);
        data.entries = data.entries.filter((row) => row.id !== input.id);
      },
      ...overrides,
    },
  };
  const exports: any = {};
  new Function('require', 'exports', output)((name: string) => {
    assert.ok(name in stubs, name);
    return stubs[name];
  }, exports);
  let root: any;
  await act(async () => {
    root = create(React.createElement(exports.default));
  });
  return {
    root,
    data,
    saves,
    deletes,
    actions: stubs['@/lib/manual-marketplace-ad-spend-actions'],
    change: async (id: string, value: string) =>
      act(async () => root.root.findByProps({ id }).props.onChange({ target: { value } })),
    submit: async () =>
      act(async () => root.root.findByProps({ id: 'spend-form-shopee_ads' }).props.onSubmit({ preventDefault() {} })),
    text: () => JSON.stringify(root.toJSON()),
    month: async (value: string) =>
      act(async () => root.root.findByProps({ type: 'month' }).props.onChange({ target: { value } })),
    workspace: async (value: string) =>
      act(async () => {
        workspaceId = value;
        root.update(React.createElement(exports.default));
      }),
    unmount: async () => act(async () => root.unmount()),
  };
}

test('failed save preserves the draft and retry accepts explicit zero with workspace and version guards', async () => {
  const view = await mount();
  await view.change('brand-shopee_ads', '1');
  await view.change('amount-shopee_ads', '0');
  await view.change('note-shopee_ads', 'Biaya aktual');
  view.actions.saveManualMarketplaceSpend = async () => {
    throw new Error('Koneksi terputus');
  };
  await view.submit();
  assert.match(view.text(), /Koneksi terputus/);
  assert.equal(view.root.root.findByProps({ id: 'amount-shopee_ads' }).props.value, '0');
  view.actions.saveManualMarketplaceSpend = async (input: any) => {
    view.saves.push(input);
  };
  await view.submit();
  assert.deepEqual(view.saves, [
    {
      workspaceId: 'a',
      id: null,
      platform: 'shopee_ads',
      brandId: 1,
      date: '2026-11-03',
      amount: 0,
      note: 'Biaya aktual',
      version: null,
    },
  ]);
  assert.equal(view.root.root.findByProps({ id: 'amount-shopee_ads' }).props.value, '');
  assert.match(view.text(), /tersimpan untuk/);
  await view.unmount();
});

test('duplicate date and brand cannot save; source filters do not alter the platform total', async () => {
  const view = await mount();
  await view.change('brand-shopee_ads', '1');
  await view.change('date-shopee_ads', '2026-11-02');
  await view.change('amount-shopee_ads', '500');
  await view.submit();
  assert.equal(view.saves.length, 0);
  assert.match(view.text(), /Sudah ada input/);
  await act(async () =>
    view.root.root
      .findByProps({ 'aria-label': 'Filter sumber Shopee Ads' })
      .props.onChange({ target: { value: 'sheet' } }),
  );
  assert.match(view.text(), /Rp 450.000/);
  assert.match(view.text(), /1 dari 2 catatan/);
  assert.equal(view.root.root.findAllByProps({ 'aria-label': 'Edit Roove, 2 Nov 2026' }).length, 0);
  await view.unmount();
});

test('save success survives refresh failure and a pending mutation blocks duplicate submits', async () => {
  const pending = deferred<void>();
  const view = await mount();
  let calls = 0;
  await view.change('brand-shopee_ads', '1');
  await view.change('amount-shopee_ads', '200');
  view.actions.saveManualMarketplaceSpend = async () => {
    calls += 1;
    await pending.promise;
  };
  view.actions.getManualMarketplaceSpendPage = async () => {
    throw new Error('Refresh gagal');
  };
  await view.submit();
  await view.submit();
  assert.equal(calls, 1);
  assert.ok(view.root.root.findByProps({ type: 'month' }).props.disabled);
  await act(async () => pending.resolve());
  assert.match(view.text(), /tersimpan untuk/);
  assert.match(view.text(), /Data belum diperbarui/);
  assert.match(view.text(), /Rp 450.000/);
  await view.unmount();
});

test('out-of-order month loads cannot replace the latest period, and workspace switches clear prior data', async () => {
  const october = deferred<ReturnType<typeof base>>();
  const november = deferred<ReturnType<typeof base>>();
  const view = await mount();
  view.actions.getManualMarketplaceSpendPage = (month: string) =>
    month === '2026-10' ? october.promise : november.promise;
  await view.month('2026-10');
  await view.month('2026-11');
  const current = base();
  current.entries[0].note = 'LATEST_PERIOD';
  await act(async () => november.resolve(current));
  const old = base();
  old.entries[0].note = 'STALE_PERIOD';
  await act(async () => october.resolve(old));
  assert.match(view.text(), /LATEST_PERIOD/);
  assert.doesNotMatch(view.text(), /STALE_PERIOD/);
  view.actions.getManualMarketplaceSpendPage = async () => ({
    ...base(),
    workspaceId: 'b',
    entries: [],
    fallbackRows: [],
  });
  await view.workspace('b');
  assert.doesNotMatch(view.text(), /LATEST_PERIOD/);
  assert.match(view.text(), /Belum ada biaya/);
  await view.unmount();
});

test('deleting the record being edited resets its draft, while other users have no edit controls', async () => {
  const view = await mount();
  await act(async () => view.root.root.findByProps({ 'aria-label': 'Edit Roove, 2 Nov 2026' }).props.onClick());
  assert.equal(view.root.root.findByProps({ id: 'amount-shopee_ads' }).props.value, '150000');
  await act(async () => view.root.root.findByProps({ 'aria-label': 'Hapus Roove, 2 Nov 2026' }).props.onClick());
  assert.deepEqual(view.deletes, [{ workspaceId: 'a', id: 1, version: 1 }]);
  assert.equal(view.root.root.findByProps({ id: 'amount-shopee_ads' }).props.value, '');
  await view.unmount();
  const data = base();
  data.entries[0].created_by = 'someone-else';
  const other = await mount({ getManualMarketplaceSpendPage: async () => data });
  assert.equal(other.root.root.findAllByProps({ 'aria-label': 'Edit Roove, 2 Nov 2026' }).length, 0);
  assert.match(other.text(), /Hanya pengisi/);
  await other.unmount();
});

test('own inactive-brand records remain editable even when no active brand is available', async () => {
  const data = base();
  data.brands.forEach((brand) => {
    brand.is_active = false;
  });
  const view = await mount({ getManualMarketplaceSpendPage: async () => data });
  await act(async () => view.root.root.findByProps({ 'aria-label': 'Edit Roove, 2 Nov 2026' }).props.onClick());
  const form = view.root.root.findByProps({ id: 'spend-form-shopee_ads' });
  assert.equal(form.findByProps({ type: 'submit' }).props.disabled, false);
  await view.change('amount-shopee_ads', '200000');
  await view.submit();
  assert.equal(view.saves[0].id, 1);
  assert.equal(view.saves[0].version, 1);
  await view.unmount();
});
