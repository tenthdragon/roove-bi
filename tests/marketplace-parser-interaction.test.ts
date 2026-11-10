import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { create,act,type ReactTestInstance } from 'react-test-renderer';
import * as XLSX from 'xlsx';
import { contextFixture,book,shopee } from './marketplace-parser-fixtures';
import { projectMarketplace,exportBusinessCsv } from '../lib/marketplace-parser/project';
import type { ParserConfig } from '../lib/marketplace-parser/types';
const require = createRequire(import.meta.url);
require.extensions['.css'] = module => { module.exports = {}; };
(globalThis as unknown as { React: typeof React }).React = React;
const Tool = require('../components/MarketplaceParserTool').default;
const content = (node: ReactTestInstance): string => node.children.map(c => typeof c === 'string' ? c : content(c)).join(' ').replace(/\s+/g,' ').trim();
const buttons = (root: ReactTestInstance,label: string) => root.findAllByType('button').filter(b => content(b).includes(label));
function props() {
  const context = contextFixture();
  return { context,saveConfig: async (_w: string,_r: number,_c: ParserConfig) => ({ workspaceId: context.workspaceId,revision: 4 }),loadCatalog: async () => structuredClone(context.catalog),syncStore: async (_w: string,id: number) => ({ storeId: id,bundleCount: 4 }),reloadContext: async () => context,
    prepareDownload: async (_w: string,input: any) => { const p = projectMarketplace({ ...input,config: context.config,catalog: context.catalog }); return { business: 'RTI',csv: exportBusinessCsv(p,'RTI') }; } };
}
function uploadFile(sku = 'ROV20-295') {
  const bytes = XLSX.write(book({ orders: [shopee({ 'Nomor Referensi SKU': sku })] }),{ type: 'buffer',bookType: 'xlsx' });
  return { name: 'synthetic.xlsx',size: bytes.length,arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset + bytes.byteLength) };
}
async function upload(root: ReactTestInstance,sku?: string) { await act(async () => { root.findByProps({ type: 'file' }).props.onChange({ target: { files: [uploadFile(sku)],value: '' } }); await new Promise(r => setTimeout(r,50)); }); }
async function review(root: ReactTestInstance) { await act(async () => { root.findByProps({ 'aria-label': 'Konfirmasi hasil parsing' }).props.onChange({ target: { checked: true } }); }); }
async function click(root: ReactTestInstance,label: string) { await act(async () => { await buttons(root,label)[0].props.onClick(); }); }
function interceptDownload() {
  let downloaded: Blob | undefined;
  const oldDocument = globalThis.document, oldURL = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  URL.createObjectURL = blob => { downloaded = blob as Blob; return 'blob:test'; }; URL.revokeObjectURL = () => {};
  globalThis.document = { createElement: () => ({ click() {},remove() {} }),body: { appendChild() {} } } as unknown as Document;
  return { blob: () => downloaded,restore() { globalThis.document = oldDocument; URL.createObjectURL = oldURL; URL.revokeObjectURL = oldRevoke; } };
}
test('upload automatically fills Business/Store/bundle and server-validates the exact preview CSV before download',async () => {
  const p = props(), original = p.prepareDownload; let validated = 0; p.prepareDownload = async (...args) => { validated++; return original(...args); };
  const intercepted = interceptDownload(), rendered = create(React.createElement(Tool,p));
  try { await upload(rendered.root); assert.ok(content(rendered.root).includes('Bundle #101')); assert.ok(content(rendered.root).includes('Roove Main Store - Marketplace')); assert.ok(buttons(rendered.root,'Download CSV')[0].props.disabled); await review(rendered.root); await click(rendered.root,'Download CSV'); assert.equal(validated,1); assert.ok((await intercepted.blob()!.text()).includes('ORDER-TEST-1')); }
  finally { rendered.unmount(); intercepted.restore(); }
});
test('unresolved bundle blocks review and download and has no manual SKU or destination override',async () => {
  const rendered = create(React.createElement(Tool,props()));
  try { await upload(rendered.root,'MISSING'); assert.ok(rendered.root.findByProps({ 'aria-label': 'Konfirmasi hasil parsing' }).props.disabled); assert.ok(buttons(rendered.root,'Download CSV')[0].props.disabled); await click(rendered.root,'Periksa masalah'); const labels = rendered.root.findAllByType('label').map(content); assert.ok(!labels.some(t => /^(SKU Scalev|Business tujuan|Store tujuan|Warehouse tujuan)/.test(t))); assert.ok(content(rendered.root).includes('identifier code')); }
  finally { rendered.unmount(); }
});
test('editing global rules invalidates review and blocks export until saved for the team',async () => {
  const rendered = create(React.createElement(Tool,props()));
  try { await upload(rendered.root); await review(rendered.root); await click(rendered.root,'Aturan parsing'); await act(async () => { rendered.root.findByProps({ 'aria-label': 'Nama akun 1' }).props.onChange({ target: { value: 'Shopee Roove Updated' } }); }); assert.equal(rendered.root.findByProps({ 'aria-label': 'Konfirmasi hasil parsing' }).props.checked,false); assert.ok(buttons(rendered.root,'Download CSV')[0].props.disabled); assert.equal(buttons(rendered.root,'Terapkan untuk sesi ini').length,0); assert.ok(content(rendered.root).includes('belum disimpan')); }
  finally { rendered.unmount(); }
});
test('catalog refresh invalidates confirmation, and server refusal cannot produce a CSV',async () => {
  const p = props(); p.prepareDownload = async () => { throw new Error('Katalog berubah. Muat ulang katalog.'); };
  const intercepted = interceptDownload(), rendered = create(React.createElement(Tool,p));
  try { await upload(rendered.root); await review(rendered.root); await click(rendered.root,'Muat ulang katalog'); assert.equal(rendered.root.findByProps({ 'aria-label': 'Konfirmasi hasil parsing' }).props.checked,false); await review(rendered.root); await click(rendered.root,'Download CSV'); assert.equal(intercepted.blob(),undefined); assert.equal(rendered.root.findByProps({ 'aria-label': 'Konfirmasi hasil parsing' }).props.checked,false); assert.ok(content(rendered.root).includes('Katalog berubah')); }
  finally { rendered.unmount(); intercepted.restore(); }
});
test('add account validates an inline form; UUID is not rendered; routing Store options remain in the account Business',async () => {
  let saved: ParserConfig | undefined; const p = props(); p.saveConfig = async (_w,_r,c) => { saved = structuredClone(c); return { workspaceId: p.context.workspaceId,revision: 4 }; };
  const rendered = create(React.createElement(Tool,p));
  try {
    await click(rendered.root,'Aturan parsing'); await click(rendered.root,'Tambah akun'); await click(rendered.root,'Tambahkan akun'); assert.ok(content(rendered.root).includes('Isi nama akun'));
    const formLabel = (text: string) => rendered.root.findAllByType('label').find(l => content(l).startsWith(text))!;
    await act(async () => { formLabel('Nama akun').findByType('input').props.onChange({ target: { value: 'Lazada New' } }); });
    await act(async () => { formLabel('Business akun').findByType('select').props.onChange({ target: { value: 'JHN' } }); });
    await click(rendered.root,'Tambahkan akun'); assert.equal(rendered.root.findByProps({ 'aria-label': 'Nama akun 5' }).props.value,'Lazada New');
    assert.ok(!/[a-f0-9]{8}-[a-f0-9]{4}-/i.test(content(rendered.root)));
    const jhnRoute = rendered.root.findByProps({ 'aria-label': 'Store routing 6' }); assert.ok(content(jhnRoute).includes('Pluve Main Store JHN')); assert.ok(!content(jhnRoute).includes('Roove Main Store - Marketplace'));
    await click(rendered.root,'Simpan konfigurasi tim'); assert.ok(saved); assert.equal(saved.schemaVersion,3); assert.equal(saved.accounts.at(-1)!.business,'JHN');
  } finally { rendered.unmount(); }
});
test('save disables controls until complete and preserves revision conflict feedback',async () => {
  let complete: (result: { workspaceId: string; revision: number }) => void = () => {};
  const p = props(); p.saveConfig = () => new Promise(resolve => { complete = resolve; }); const rendered = create(React.createElement(Tool,p));
  try { await click(rendered.root,'Aturan parsing'); await act(async () => { void buttons(rendered.root,'Simpan konfigurasi tim')[0].props.onClick(); }); assert.equal(rendered.root.findAllByType('fieldset')[0].props.disabled,true); await act(async () => { complete({ workspaceId: p.context.workspaceId,revision: 4 }); }); assert.ok(content(rendered.root).includes('Konfigurasi tim tersimpan')); }
  finally { rendered.unmount(); }
  const failed = props(); failed.saveConfig = async () => { throw new Error('Konfigurasi telah diubah pengguna lain.'); }; const second = create(React.createElement(Tool,failed));
  try { await click(second.root,'Aturan parsing'); await click(second.root,'Simpan konfigurasi tim'); assert.ok(content(second.root).includes('Konfigurasi telah diubah pengguna lain.')); } finally { second.unmount(); }
});
test('failed replacement upload and financial edits invalidate download review',async () => {
  const rendered = create(React.createElement(Tool,props()));
  try { await upload(rendered.root); await review(rendered.root); await act(async () => { await rendered.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [{ ...uploadFile(),name: 'wrong.csv' }],value: '' } }); }); assert.equal(rendered.root.findByProps({ 'aria-label': 'Konfirmasi hasil parsing' }).props.checked,false); assert.ok(buttons(rendered.root,'Download CSV')[0].props.disabled); await click(rendered.root,'Detail order'); const price = rendered.root.findAllByType('label').find(l => content(l).startsWith('Harga satuan (Rp)'))!; await act(async () => { price.findByType('input').props.onChange({ target: { value: '280000' } }); }); assert.ok(content(rendered.root).includes('Isi alasan koreksi item')); }
  finally { rendered.unmount(); }
});

test('save failure focuses and reveals the error summary even from a distant action', async () => {
  const p = props(); p.saveConfig = async () => { throw new Error('Konfigurasi telah diubah pengguna lain.'); };
  let focused = 0, revealed = 0;
  const rendered = create(React.createElement(Tool,p),{ createNodeMock: element => element.props.role === 'alert' ? { focus() { focused++; },scrollIntoView() { revealed++; } } : null });
  try {
    await click(rendered.root,'Aturan parsing'); await click(rendered.root,'Simpan konfigurasi tim');
    assert.equal(focused,1); assert.equal(revealed,1);
    assert.equal(rendered.root.findByProps({role:'alert'}).props.tabIndex,-1);
  } finally { rendered.unmount(); }
});

test('repair replaces the catalog and revalidates every order, including filtered-out orders, while requiring review again',async () => {
  const p = props(), completeCatalog = structuredClone(p.context.catalog);
  p.context.canManageCatalog = true; p.context.catalog.bundles = [];
  const data = { checkedAt: '2026-11-10T00:00:00Z',business: 'RTI',account: 'Shopee Roove',stores: [{ id: 10,name: 'Roove Main Store - Marketplace' }],suggestedStoreId: 10,issues: [],token: 'test',items: [{ sku: 'ROV20-295',status: 'found',message: 'Tersedia',bundles: [{ id: 101,name: 'Roove A',sku: 'ROV20-295',owner: 'RLB',ownerBusinessId: 8,availableInBusiness: true,installedStoreIds: [],canShare: false,options: [{ id: 4050,name: '295',price: '295000' }] }] }] };
  let mutations = 0;
  const rendered = create(React.createElement(Tool,{ ...p,diagnoseCase: async () => data,repairCase: async () => { mutations++; return { result: { synced: true,message: 'Seluruh batch divalidasi ulang',items: [] },catalog: completeCatalog }; } }));
  try {
    const bytes = XLSX.write(book({ orders: [shopee(),shopee({ 'No. Pesanan': 'ORDER-TEST-2','No. Resi': '00054321' })] }),{ type: 'buffer',bookType: 'xlsx' });
    await act(async () => { rendered.root.findByProps({ type: 'file' }).props.onChange({ target: { files: [{ name: 'synthetic-two-orders.xlsx',size: bytes.length,arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset + bytes.byteLength) }],value: '' } }); await new Promise(r => setTimeout(r,50)); });
    assert.match(content(rendered.root),/2 perlu diselesaikan/);
    await act(async () => rendered.root.findByProps({ type: 'search' }).props.onChange({ target: { value: 'ORDER-TEST-1' } }));
    await click(rendered.root,'Periksa masalah');
    await click(rendered.root,'Tambahkan ke Store');
    assert.equal(mutations,1); assert.match(content(rendered.root),/2 order valid/);
    assert.equal(rendered.root.findByProps({ 'aria-label': 'Konfirmasi hasil parsing' }).props.checked,false);
    assert.equal(buttons(rendered.root,'Download CSV')[0].props.disabled,true);
  } finally { rendered.unmount(); }
});
