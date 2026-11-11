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
  const data: ParserDiagnosis = { checkedAt: '2026-11-10T08:00:00Z',business: 'RTI',account: 'Shopee Roove',stores: [{ id: 10,name: 'Marketplace' }],suggestedStoreId: 10,issues: [],token: 'test',items: [{ sku: 'ROV20-295',status: 'found',message: 'Perlu sharing',bundles: [{ id: 2,name: 'Roove 20',sku: 'ROV20-295',owner: 'RLB',ownerBusinessId: 8,availableInBusiness: false,canShare: true }] }] };
  const calls: RepairRequest[] = [];
  const props = { workspace: 'w',account: 'roove',revision: 3,skus: ['ROV20-295'],canSync: true,canManage: true,busy: false,dirty: false,diagnose: async () => structuredClone(data),repair: async (request: RepairRequest): Promise<RepairResult> => { calls.push(request); return { items: [],synced: true,message: 'Batch divalidasi ulang' }; },openSettings() {} };
  return { data,calls,props };
}
test('sharing is Business-only with no Store or price picker, while the source price stays visible',async () => {
  const f = fixture(); let view: ReturnType<typeof create>;
  await act(async () => { view = create(<Diagnosis {...f.props} orderTotalCents={52500000}/>); });
  try {
    const root = view!.root;
    assert.match(content(root),/Pemilik: RLB/); assert.match(content(root),/Store Marketplace Sesuai mapping Produk/);
    assert.equal(root.findAllByType('select').length,0); assert.equal(root.findAllByProps({role: 'dialog'}).length,0);
    assert.match(content(root).replace(/\s/g,''),/HargamarketplaceRp525\.000(?:,00)?/);
    assert.equal(root.findByType('details').props.open,undefined);
    await act(async () => button(root,'Bagikan ke Business RTI').props.onClick());
    assert.deepEqual(f.calls[0],{token:'test',mode:'share',items:[{sku:'ROV20-295',bundleId:2}]});
  } finally { view!.unmount(); }
});
test('a bundle available in Business needs no repair and Store is a read-only mapped destination',async () => {
  const f = fixture(); f.data.items[0].bundles[0].availableInBusiness = true;
  let view: ReturnType<typeof create>; await act(async () => { view = create(<Diagnosis {...f.props}/>); });
  try {
    assert.match(content(view!.root),/Business RTI Tersedia/); assert.equal(button(view!.root,'Bagikan ke Business RTI'),undefined);
    assert.doesNotMatch(content(view!.root),/Terpasang|Tambahkan ke Store|Opsi harga/);
    assert.equal(view!.root.findAllByType('select').length,0);
    await act(async () => button(view!.root,'Muat ulang data aplikasi').props.onClick()); assert.deepEqual(f.calls,[]);
  } finally { view!.unmount(); }
});
test('missing route opens global settings, never guesses the sole Store or offers a per-order override',async () => {
  const f = fixture(); f.data.suggestedStoreId = null; f.data.items[0].bundles[0].availableInBusiness = true;
  let opened = 0; f.props.openSettings = () => { opened++; };
  let view: ReturnType<typeof create>; await act(async () => { view = create(<Diagnosis {...f.props}/>); });
  try {
    assert.match(content(view!.root),/Store Perlu mapping/); assert.equal(view!.root.findAllByType('select').length,0);
    await act(async () => button(view!.root,'Atur mapping Produk / Store').props.onClick()); assert.equal(opened,1);
  } finally { view!.unmount(); }
});
test('readers cannot share or sync, including direct invocation of disabled controls',async () => {
  const f = fixture(); f.props.canManage = false;
  let view: ReturnType<typeof create>; await act(async () => { view = create(<Diagnosis {...f.props}/>); });
  try {
    for (const name of ['Bagikan ke Business RTI','Sinkronkan Business dari Scalev']) {
      assert.equal(button(view!.root,name).props.disabled,true); await act(async () => button(view!.root,name).props.onClick());
    }
    assert.deepEqual(f.calls,[]);
  } finally { view!.unmount(); }
});
test('bulk sharing preserves deselection across reload even when only one candidate remains',async () => {
  const f = fixture(); const second = structuredClone(f.data.items[0]); second.sku = 'PLV'; second.bundles[0] = {...second.bundles[0],id:3,sku:'PLV'}; f.data.items.push(second);
  let view: ReturnType<typeof create>; await act(async () => { view = create(<Diagnosis {...f.props}/>); });
  try {
    await act(async () => view!.root.findByProps({'aria-label':'Pilih bundle ROV20-295'}).props.onChange({target:{checked:false}}));
    second.bundles[0].availableInBusiness = true;
    await act(async () => button(view!.root,'Muat ulang data aplikasi').props.onClick());
    assert.equal(button(view!.root,'Bagikan ke Business RTI').props.disabled,true);
    await act(async () => button(view!.root,'Bagikan ke Business RTI').props.onClick()); assert.deepEqual(f.calls,[]);
    await act(async () => view!.root.findByProps({'aria-label':'Pilih bundle ROV20-295'}).props.onChange({target:{checked:true}}));
    await act(async () => button(view!.root,'Bagikan ke Business RTI').props.onClick());
    assert.equal(f.calls[0].items.length,1);
  } finally { view!.unmount(); }
});
test('incomplete Business snapshot offers explicit sync without Store selection; reload never calls Scalev',async () => {
  const f = fixture(); f.data.suggestedStoreId = null; f.data.stores = []; f.data.items = [{sku:'ROV20-295',status:'unavailable',bundles:[],message:'Sinkronkan Business'}];
  let view: ReturnType<typeof create>; await act(async () => { view = create(<Diagnosis {...f.props}/>); });
  try {
    await act(async () => button(view!.root,'Muat ulang data aplikasi').props.onClick()); assert.deepEqual(f.calls,[]);
    await act(async () => button(view!.root,'Sinkronkan Business dari Scalev').props.onClick());
    assert.deepEqual(f.calls[0],{token:'test',mode:'refresh',items:[]});
  } finally { view!.unmount(); }
});
test('partial sharing result stays visible and success is confirmed by a fresh database diagnosis',async () => {
  const f = fixture(); f.props.repair = async () => ({synced:false,message:'Sebagian aksi belum selesai.',items:[{sku:'ROV20-295',stage:'shared',message:'Sharing belum terkonfirmasi.'}]});
  let view: ReturnType<typeof create>; await act(async () => { view = create(<Diagnosis {...f.props}/>); });
  try { await act(async () => button(view!.root,'Bagikan ke Business RTI').props.onClick()); assert.match(content(view!.root),/Sharing belum terkonfirmasi/); } finally { view!.unmount(); }
  f.props.repair = async () => { f.data.items[0].bundles[0].availableInBusiness = true; return {synced:true,message:'Batch diperbarui',items:[{sku:'ROV20-295',stage:'ready',message:'Tersedia'}]}; };
  await act(async () => { view = create(<Diagnosis {...f.props}/>); });
  try { await act(async () => button(view!.root,'Bagikan ke Business RTI').props.onClick()); assert.match(content(view!.root),/Business RTI Tersedia/); assert.equal(button(view!.root,'Bagikan ke Business RTI'),undefined); } finally { view!.unmount(); }
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
  try { assert.match(content(view!.root),/Scalev offline/); await act(async () => button(view!.root,'Muat ulang data aplikasi').props.onClick()); assert.match(content(view!.root),/Pemilik: RLB/); }
  finally { view!.unmount(); }
});
test('local mode allows database diagnosis but blocks sync; unsaved rules block diagnosis',async () => {
  const f = fixture(); let calls = 0; f.props.diagnose = async () => { calls++; return f.data; };
  let view: ReturnType<typeof create>;
  await act(async () => { view = create(<Diagnosis {...f.props} canSync={false}/>); });
  assert.equal(calls,1); assert.equal(button(view!.root,'Sinkronkan Business dari Scalev').props.disabled,true); view!.unmount();
  await act(async () => { view = create(<Diagnosis {...f.props} dirty/>); });
  assert.equal(calls,1); assert.match(content(view!.root),/Simpan atau batalkan/); view!.unmount();
});
test('an incomplete database diagnosis explains a failed sync, offers retry, and exposes no mutation controls',async () => {
  const f = fixture(); let calls = 0;
  const failed: ParserDiagnosis = { ...f.data,stores: [],suggestedStoreId: null,token: '',issues: ['Sinkronisasi katalog belum selesai. Muat ulang data aplikasi setelah sinkronisasi.'],items: [{ sku: 'ROV20-295',status: 'unavailable',bundles: [],message: 'Pemeriksaan belum selesai.' }] };
  let view: ReturnType<typeof create>;
  await act(async () => { view = create(<Diagnosis {...f.props} diagnose={async () => ++calls === 1 ? failed : f.data}/>); });
  try {
    assert.match(content(view!.root),/Sinkronisasi katalog belum selesai/g);
    assert.equal(button(view!.root,'Bagikan ke Business RTI'),undefined);
    assert.equal(button(view!.root,'Sinkronkan Business dari Scalev').props.disabled,true);
    await act(async () => button(view!.root,'Muat ulang data aplikasi').props.onClick());
    assert.match(content(view!.root),/Pemilik: RLB/); assert.doesNotMatch(content(view!.root),/Sinkronisasi katalog belum selesai/g);
    assert.equal(f.calls.length,0);
  } finally { view!.unmount(); }
});
test('a late repair response cannot replace a new account diagnosis',async () => {
  const f = fixture(); let resolve: (value: RepairResult) => void = () => {};
  f.props.repair = async () => new Promise(r => {resolve = r;});
  let view: ReturnType<typeof create>; await act(async () => { view = create(<Diagnosis {...f.props}/>); });
  let pending: Promise<void>;
  await act(async () => { pending = button(view!.root,'Bagikan ke Business RTI').props.onClick(); });
  await act(async () => { view!.update(<Diagnosis {...f.props} account="pluve" diagnose={async () => ({...f.data,account:'Shopee Pluve',business:'JHN'})}/>); });
  await act(async () => { resolve({synced:true,items:[],message:'OLD RESULT'}); await pending; });
  try { assert.match(content(view!.root),/Shopee Pluve/); assert.doesNotMatch(content(view!.root),/OLD RESULT|Shopee Roove/); } finally { view!.unmount(); }
});
