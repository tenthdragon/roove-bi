import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { create,act,type ReactTestInstance } from 'react-test-renderer';
import * as XLSX from 'xlsx';
import { contextFixture,book,shopee,tiktok } from './marketplace-parser-fixtures';
import { parseWorkbook,readMarketplaceFile } from '../lib/marketplace-parser/read';
import { projectMarketplace,exportBusinessCsv } from '../lib/marketplace-parser/project';
import type { ParserConfig } from '../lib/marketplace-parser/types';
const require = createRequire(import.meta.url);
require.extensions['.css'] = module => { module.exports = {}; };
(globalThis as unknown as { React: typeof React }).React = React;
const Tool = require('../components/MarketplaceParserTool').default;
const content = (node: ReactTestInstance): string => node.children.map(c => typeof c === 'string' ? c : content(c)).join(' ').replace(/\s+/g,' ').trim();
const buttons = (root: ReactTestInstance,label: string) => root.findAllByType('button').filter(b => content(b).includes(label));
function props() {
  const context = contextFixture(); let archived:any;
  return { context,saveConfig: async (_w: string,_r: number,_c: ParserConfig) => ({ workspaceId: context.workspaceId,revision: 4 }),loadCatalog: async () => structuredClone(context.catalog),syncBusiness: async () => ({ success: true }),reloadContext: async () => context,
    uploadSource:async(_w:string,file:any,account:string,date:string)=>{archived={id:'batch-a',filename:file.name,sourceSha256:'test-hash',account,business:context.config.accounts.find(a=>a.id===account)!.business,date,actor:'Tester',createdAt:'2026-11-11',file:readMarketplaceFile(await file.arrayBuffer(),file.name)};return archived;},
    listBatches:async()=>[],listExports:async()=>[],openBatch:async()=>archived,approveStore:async()=>context,
    prepareDownload: async (_w: string,input: any) => { const p = projectMarketplace({ file:archived.file,account:archived.account,date:archived.date,revision:3,config: context.config,catalog: context.catalog }); return { business: 'RTI',csv: exportBusinessCsv(p,'RTI') }; } };
}
function uploadFile(sku = 'ROV20-295') {
  const bytes = XLSX.write(book({ orders: [shopee({ 'Nomor Referensi SKU': sku })] }),{ type: 'buffer',bookType: 'xlsx' });
  return { name: 'synthetic.xlsx',size: bytes.length,arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset + bytes.byteLength) };
}
async function uploadData(root: ReactTestInstance,file: ReturnType<typeof uploadFile>) {
  await act(async () => { root.findByProps({ type: 'file' }).props.onChange({ target: { files: [file],value: '' } }); });
  const deadline = Date.now() + 5000;
  while (root.findByProps({ type: 'file' }).props.disabled && Date.now() < deadline) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve,10)); });
  }
  assert.equal(root.findByProps({ type: 'file' }).props.disabled,false,'Upload should finish before inspecting the preview');
}
async function upload(root: ReactTestInstance,sku?: string) { await uploadData(root,uploadFile(sku)); }
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
  try { await upload(rendered.root); assert.ok(content(rendered.root).includes('Bundle # 101')); assert.ok(content(rendered.root).includes('Roove Main Store - Marketplace')); assert.ok(buttons(rendered.root,'Download CSV')[0].props.disabled); await review(rendered.root); await click(rendered.root,'Download CSV'); assert.equal(validated,1); assert.ok((await intercepted.blob()!.text()).includes('ORDER-TEST-1')); }
  finally { rendered.unmount(); intercepted.restore(); }
});
test('non-divisible TikTok price shows both allocations and downloads the same exact CSV after review',async () => {
  const p=props(), intercepted=interceptDownload(), rendered=create(React.createElement(Tool,p));
  try {
    const account=rendered.root.findAllByType('label').find(l=>content(l).startsWith('Akun marketplace asal'))!.findByType('select');
    await act(async()=>account.props.onChange({target:{value:'tiktok-roove'}}));
    const bytes=XLSX.write(book({TikTok:[tiktok({Quantity:3,'SKU Unit Original Price':590000,'SKU Subtotal Before Discount':1770000,'SKU Seller Discount':275000})]}),{type:'buffer',bookType:'xlsx'});
    await uploadData(rendered.root,{name:'synthetic-tiktok.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
    const allocation=content(rendered.root.findByProps({'aria-label':'Pembagian harga satuan'}));
    assert.match(allocation,/2 × Rp\s*498\.333,33/); assert.match(allocation,/1 × Rp\s*498\.333,34/);
    assert.ok(!content(rendered.root).includes('Download diblokir'));
    assert.equal(rendered.root.findByProps({'aria-label':'Konfirmasi hasil parsing'}).props.disabled,false);
    await click(rendered.root,'Detail');assert.match(content(rendered.root),/quantity dan total tetap sama/);
    await review(rendered.root);await click(rendered.root,'Download CSV');
    const csv=await intercepted.blob()!.text();assert.match(csv,/,498333\.33,2,/);assert.match(csv,/,498333\.34,1,/);
  } finally {rendered.unmount();intercepted.restore();}
});
test('unresolved bundle blocks review and download and has no manual SKU or destination override',async () => {
  const rendered = create(React.createElement(Tool,props()));
  try { await upload(rendered.root,'MISSING'); assert.ok(rendered.root.findByProps({ 'aria-label': 'Konfirmasi hasil parsing' }).props.disabled); assert.ok(buttons(rendered.root,'Download CSV')[0].props.disabled); await click(rendered.root,'Detail'); const labels = rendered.root.findAllByType('label').map(content); assert.ok(!labels.some(t => /^(SKU Scalev|Business tujuan|Store tujuan|Warehouse tujuan)/.test(t))); assert.ok(content(rendered.root).includes('identifier code')); }
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
test('add account validates an inline form and preserves existing advanced routing rules on save',async () => {
  let saved: ParserConfig | undefined; const p = props(); p.saveConfig = async (_w,_r,c) => { saved = structuredClone(c); return { workspaceId: p.context.workspaceId,revision: 4 }; };
  const rendered = create(React.createElement(Tool,p));
  try {
    await click(rendered.root,'Aturan parsing'); await click(rendered.root,'Tambah akun'); await click(rendered.root,'Tambahkan akun'); assert.ok(content(rendered.root).includes('Isi nama akun'));
    const formLabel = (text: string) => rendered.root.findAllByType('label').find(l => content(l).startsWith(text))!;
    await act(async () => { formLabel('Nama akun').findByType('input').props.onChange({ target: { value: 'Lazada New' } }); });
    await act(async () => { formLabel('Business akun').findByType('select').props.onChange({ target: { value: 'JHN' } }); });
    await click(rendered.root,'Tambahkan akun'); assert.equal(rendered.root.findByProps({ 'aria-label': 'Nama akun 5' }).props.value,'Lazada New');
    assert.ok(!/[a-f0-9]{8}-[a-f0-9]{4}-/i.test(content(rendered.root)));
    await click(rendered.root,'Simpan konfigurasi tim'); assert.ok(saved); assert.equal(saved.schemaVersion,3); assert.equal(saved.accounts.at(-1)!.business,'JHN');
    for (const kind of ['groups','products','routes','combinations'] as const) assert.deepEqual(saved[kind],p.context.config[kind]);
  } finally { rendered.unmount(); }
});
test('settings list current bundle mappings per account and Business with exact combination quantities', async () => {
  const p = props();
  const single = { id: 'a', account: 'roove', business: 'RTI', caseKey: 'single',
    items: [{bundleId: 1, sku: 'SKU-A', quantity: 1}], storeId: 10, revision: 2, actor: 'Tester', createdAt: '2026-11-11' };
  p.context.catalog.decisions = [
    single,
    { ...single, id: 'old', revision: 1, storeId: 11 },
    { ...single, id: 'other-account', account: 'tiktok-roove', storeId: 12 },
    { ...single, id: 'other-business', business: 'JHN', storeId: 20 },
    { ...single, id: 'combo', account: 'archived', accountLabel: 'Akun arsip', caseKey: 'combo', storeId: 99, storeName: 'Store arsip',
      items: [...single.items, {bundleId: 2, sku: 'BONUS', quantity: 3}] },
  ];
  const rendered = create(React.createElement(Tool, p));
  try {
    await click(rendered.root, 'Aturan parsing');
    const summaries = rendered.root.findAllByType('summary').map(content);
    assert.ok(summaries.includes('Mapping bundle ke Store 4 mapping'));
    assert.ok(!summaries.some(label => /Produk dan pengenalan SKU|Routing Produk ke Store|Routing kombinasi Produk/.test(label)));
    const table = () => rendered.root.findByProps({'aria-label': 'Mapping bundle ke Store'});
    const rows = () => table().findByType('tbody').findAllByType('tr').map(content);
    assert.deepEqual(rows().sort(), [
      'Shopee Roove RTI SKU-A Semua jumlah Roove Main Store - Marketplace',
      'TikTok Roove RTI SKU-A Semua jumlah Globite Store - Marketplace',
      'Shopee Roove JHN SKU-A Semua jumlah Pluve Main Store JHN',
      'Akun arsip RTI SKU-A × 1 BONUS × 3 Store arsip',
    ].sort());
    const section = table().parent!.parent!;
    await act(async () => section.findByType('input').props.onChange({target: {value: 'bonus'}}));
    assert.deepEqual(rows(), ['Akun arsip RTI SKU-A × 1 BONUS × 3 Store arsip']);
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
test('failed replacement upload invalidates review; source fields have no edit controls',async()=>{
 const rendered=create(React.createElement(Tool,props()));
 try{await upload(rendered.root);await review(rendered.root);await act(async()=>{await rendered.root.findByProps({type:'file'}).props.onChange({target:{files:[{...uploadFile(),name:'wrong.csv'}],value:''}});});assert.equal(rendered.root.findByProps({'aria-label':'Konfirmasi hasil parsing'}).props.checked,false);await click(rendered.root,'Detail');assert.ok(content(rendered.root).includes('Data asli marketplace'));assert.equal(rendered.root.findAllByType('input').filter(i=>['numeric','decimal'].includes(i.props.inputMode)).length,0);assert.ok(!content(rendered.root).includes('Koreksi kurir atau nama pembeli'));}
 finally{rendered.unmount();}
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

test('catalog reload revalidates every order while preserving archived source and requiring review',async()=>{
 const p=props(),cat=structuredClone(p.context.catalog);p.context.catalog.bundles=[];
 p.loadCatalog=async()=>cat;
 const rendered=create(React.createElement(Tool,p));
 try{await upload(rendered.root);assert.match(content(rendered.root),/1 perlu diselesaikan/);await click(rendered.root,'Muat ulang katalog');assert.match(content(rendered.root),/1 order valid/);assert.equal(rendered.root.findByProps({'aria-label':'Konfirmasi hasil parsing'}).props.checked,false);assert.match(content(rendered.root),/pembeli-test/);assert.match(content(rendered.root),/00012345/);}
 finally{rendered.unmount();}
});
