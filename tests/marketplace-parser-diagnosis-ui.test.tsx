import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { create,act,type ReactTestInstance } from 'react-test-renderer';
import type { ParserDiagnosis, RepairRequest, RepairResult } from '../lib/marketplace-parser/diagnosis-types';
const require = createRequire(import.meta.url);
require.extensions['.css'] = module => { module.exports = {}; };
(globalThis as unknown as { React: typeof React }).React = React;
const Diagnosis = require('../components/MarketplaceParserDiagnosis').default;
const content = (node: ReactTestInstance): string => node.children.map(c => typeof c === 'string' ? c : content(c)).join(' ').replace(/\s+/g,' ').trim();
const button = (root: ReactTestInstance,name: string) => root.findAllByType('button').find(b => content(b) === name)!;
function fixture() {
  const data: ParserDiagnosis = { checkedAt: '2026-11-10T08:00:00Z',business: 'RTI',account: 'Shopee Roove',stores: [{ id: 10,name: 'Marketplace' }],suggestedStoreId: 10,issues: [],token: 'test',items: [{ sku: 'ROV20-295',status: 'found',message: 'Perlu sharing',bundles: [{ id: 2,name: 'Roove 20',sku: 'ROV20-295',owner: 'RLB',ownerBusinessId: 8,availableInBusiness: false,installedStoreIds: [],canShare: true,options: [{ id: 1,name: '250',price: '250000' },{ id: 2,name: '295',price: '295000' }] }] }] };
  const calls: RepairRequest[] = [];
  const props = { workspace: 'w',account: 'roove',revision: 3,skus: ['ROV20-295'],enabled: true,canManage: true,busy: false,dirty: false,diagnose: async () => structuredClone(data),repair: async (request: RepairRequest): Promise<RepairResult> => { calls.push(request); return { items: [],synced: true,message: 'Batch divalidasi ulang' }; },openSettings() {} };
  return { data,calls,props };
}
test('inline diagnosis displays owner and target, asks for multiple BPO choices and never infers from SKU price',async () => {
  const f = fixture(); let view: ReturnType<typeof create>;
  await act(async () => { view = create(<Diagnosis {...f.props}/>); });
  try {
    const root = view!.root;
    assert.match(content(root),/Pemilik: RLB/); assert.match(content(root),/Business RTI/);
    assert.equal(root.findAllByProps({ role: 'dialog' }).length,0);
    const select = root.findAllByType('select').find(s => s.findAllByType('option').some(o => o.props.value === 2))!;
    assert.equal(select.props.value,0); assert.equal(button(root,'Bagikan & tambahkan ke Store').props.disabled,true);
    await act(async () => select.props.onChange({ target: { value: '2' } }));
    await act(async () => button(root,'Bagikan & tambahkan ke Store').props.onClick());
    assert.deepEqual(f.calls[0],{ token: 'test',storeId: 10,mode: 'attach',items: [{ sku: 'ROV20-295',bundleId: 2,optionId: 2,share: true }] });
  } finally { view!.unmount(); }
});
test('installed bundle offers catalog refresh, and readers cannot share or attach',async () => {
  const f = fixture(); f.props.canManage = false; f.data.items[0].bundles[0].options = [f.data.items[0].bundles[0].options[0]];
  let view: ReturnType<typeof create>; await act(async () => { view = create(<Diagnosis {...f.props}/>); });
  try {
    assert.equal(button(view!.root,'Bagikan & tambahkan ke Store').props.disabled,true);
    await act(async () => button(view!.root,'Perbarui katalog').props.onClick());
    assert.equal(f.calls[0].mode,'refresh'); assert.deepEqual(f.calls[0].items,[]);
    f.data.items[0].bundles[0].installedStoreIds = [10];
    await act(async () => button(view!.root,'Periksa ulang Scalev').props.onClick());
    assert.match(content(view!.root),/Sudah terpasang/); assert.equal(button(view!.root,'Bagikan & tambahkan ke Store'),undefined);
  } finally { view!.unmount(); }
});
test('bulk action honors selected bundles and explicitly labels cross-Business sharing',async () => {
  const f = fixture(); const second = structuredClone(f.data.items[0]); second.sku = 'PLV'; second.bundles[0] = { ...second.bundles[0],sku: 'PLV',id: 3,availableInBusiness: true,canShare: false };
  f.data.items.push(second); f.data.items.forEach(i => { i.bundles[0].options = [i.bundles[0].options[0]]; });
  let view: ReturnType<typeof create>; await act(async () => { view = create(<Diagnosis {...f.props}/>); });
  try {
    assert.ok(button(view!.root,'Bagikan & tambahkan 2 bundle ke Store'));
    await act(async () => view!.root.findByProps({ 'aria-label': 'Pilih bundle PLV' }).props.onChange({ target: { checked: false } }));
    await act(async () => button(view!.root,'Bagikan & tambahkan 1 bundle ke Store').props.onClick());
    assert.equal(f.calls[0].items.length,1); assert.equal(f.calls[0].items[0].sku,'ROV20-295');
  } finally { view!.unmount(); }
});
test('diagnosis failures allow retry; a late response cannot overwrite a different account',async () => {
  const f = fixture(); let resolve: (value: ParserDiagnosis) => void = () => {};
  f.props.diagnose = async () => new Promise(r => { resolve = r; });
  let view: ReturnType<typeof create>; await act(async () => { view = create(<Diagnosis {...f.props}/>); });
  await act(async () => { view!.update(<Diagnosis {...f.props} account="pluve" diagnose={async () => ({ ...f.data,account: 'Shopee Pluve',business: 'JHN' })}/>); });
  await act(async () => resolve(f.data));
  assert.match(content(view!.root),/Shopee Pluve/); assert.doesNotMatch(content(view!.root),/Shopee Roove/); view!.unmount();
  let attempts = 0;
  await act(async () => { view = create(<Diagnosis {...f.props} diagnose={async () => { if (++attempts === 1) throw new Error('Scalev offline'); return f.data; }}/>); });
  try { assert.match(content(view!.root),/Scalev offline/); await act(async () => button(view!.root,'Periksa ulang Scalev').props.onClick()); assert.match(content(view!.root),/Pemilik: RLB/); }
  finally { view!.unmount(); }
});
test('local mode and unsaved configuration prevent external diagnosis',async () => {
  const f = fixture(); let calls = 0; f.props.diagnose = async () => { calls++; return f.data; };
  let view: ReturnType<typeof create>;
  await act(async () => { view = create(<Diagnosis {...f.props} enabled={false}/>); });
  assert.equal(calls,0); view!.unmount();
  await act(async () => { view = create(<Diagnosis {...f.props} dirty/>); });
  assert.equal(calls,0); assert.match(content(view!.root),/Simpan atau batalkan/); view!.unmount();
});
test('an incomplete production diagnosis explains rate limiting, offers retry, and exposes no mutation controls',async () => {
  const f = fixture(); let calls = 0;
  const failed: ParserDiagnosis = { ...f.data,stores: [],suggestedStoreId: null,token: '',issues: ['Scalev sedang membatasi jumlah permintaan (HTTP 429). Tunggu sebentar, lalu pilih Periksa ulang Scalev.'],items: [{ sku: 'ROV20-295',status: 'unavailable',bundles: [],message: 'Pemeriksaan belum selesai.' }] };
  let view: ReturnType<typeof create>;
  await act(async () => { view = create(<Diagnosis {...f.props} diagnose={async () => ++calls === 1 ? failed : f.data}/>); });
  try {
    assert.match(content(view!.root),/HTTP 429/);
    assert.equal(button(view!.root,'Bagikan & tambahkan ke Store'),undefined);
    assert.equal(button(view!.root,'Perbarui katalog').props.disabled,true);
    await act(async () => button(view!.root,'Periksa ulang Scalev').props.onClick());
    assert.match(content(view!.root),/Pemilik: RLB/); assert.doesNotMatch(content(view!.root),/HTTP 429/);
    assert.equal(f.calls.length,0);
  } finally { view!.unmount(); }
});
