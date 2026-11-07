import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import React from 'react';
import { create, act, type ReactTestInstance } from 'react-test-renderer';
import * as XLSX from 'xlsx';
import { defaultParserConfig } from '../lib/marketplace-parser/config';

// Component state tests, not a browser/screenshot substitute. Next handles CSS
// modules in production; the test runner only needs stable class-name strings.
const require=createRequire(import.meta.url);
require.extensions['.css']=(module)=>{module.exports={};};
(globalThis as unknown as {React:typeof React}).React=React;
const Tool=require('../components/MarketplaceParserTool').default;
const content=(node:ReactTestInstance):string=>node.children.map(c=>typeof c==='string'?c:content(c)).join(' ').replace(/\s+/g,' ').trim();
const buttons=(root:ReactTestInstance,label:string)=>root.findAllByType('button').filter(b=>content(b).includes(label));
function setup() {
  const config=defaultParserConfig();config.rooveBusiness='RTI';
  return {workspaceId:'synthetic-test',config,revision:1,canSave:true,catalog:{businesses:[{code:'RTI',name:'Roove'}],stores:[{business:'RTI',name:'Roove Main Store - Marketplace'}],bundles:[{business:'RTI',sku:'ROV20-295',name:'Roove'}],warehouses:[]}};
}
function file(qty:unknown=2) {
  const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.json_to_sheet([{'No. Pesanan':'TEST-ONLY','Nomor Referensi SKU':'ROV20-295','Nama Produk':'Roove','Jumlah':qty,'Harga Setelah Diskon':295000,'No. Resi':'000TEST','Opsi Pengiriman':'SPX Standard','Username (Pembeli)':'test-user'}]),'orders');
  const bytes=XLSX.write(w,{type:'buffer',bookType:'xlsx'});
  return {name:'synthetic.xlsx',size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
}
test('upload, review, CSV download, and editing invalidates approval',async()=>{
  let downloaded:Blob|undefined;
  const oldDocument=globalThis.document;const oldURL=URL.createObjectURL;const oldRevoke=URL.revokeObjectURL;
  URL.createObjectURL=(blob)=>{downloaded=blob as Blob;return 'blob:test';};URL.revokeObjectURL=()=>{};
  globalThis.document={createElement:()=>({click(){},remove(){}}),body:{appendChild(){}}} as unknown as Document;
  const rendered=create(React.createElement(Tool,{context:setup(),saveConfig:async()=>({workspaceId:'synthetic-test',revision:2})}));
  try {
    await act(async()=>{rendered.root.findByProps({type:'file'}).props.onChange({target:{files:[file()],value:''}});await new Promise(r=>setTimeout(r,50));});
    assert.ok(content(rendered.root).includes('TEST-ONLY'));
    let download=buttons(rendered.root,'Download CSV RTI')[0];assert.ok(download.props.disabled);
    await act(async()=>{rendered.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}});});
    download=buttons(rendered.root,'Download CSV RTI')[0];assert.equal(download.props.disabled,false);
    await act(async()=>{download.props.onClick();});assert.ok(downloaded);const csv=await downloaded!.text();assert.ok(csv.includes('TEST-ONLY'));assert.ok(csv.includes(',295000,2,'));
    await act(async()=>{buttons(rendered.root,'Detail & koreksi')[0].props.onClick();});
    const priceLabel=rendered.root.findAllByType('label').find(l=>content(l).includes('Harga satuan (Rp)'))!;
    await act(async()=>{priceLabel.findByType('input').props.onChange({target:{value:'280000'}});});
    assert.equal(rendered.root.findByProps({type:'checkbox'}).props.checked,false);
    assert.ok(buttons(rendered.root,'Download CSV RTI')[0].props.disabled);
    assert.ok(content(rendered.root).includes('Isi alasan koreksi item'));
  } finally {rendered.unmount();globalThis.document=oldDocument;URL.createObjectURL=oldURL;URL.revokeObjectURL=oldRevoke;}
});
test('unknown quantity blocks review and configuration save errors remain visible',async()=>{
  const rendered=create(React.createElement(Tool,{context:setup(),saveConfig:async()=>{throw new Error('Konfigurasi telah diubah pengguna lain.');}}));
  try {
    await act(async()=>{rendered.root.findByProps({type:'file'}).props.onChange({target:{files:[file('')],value:''}});await new Promise(r=>setTimeout(r,50));});
    assert.ok(rendered.root.findByProps({type:'checkbox'}).props.disabled);
    await act(async()=>{buttons(rendered.root,'Konfigurasi')[0].props.onClick();});
    await act(async()=>{buttons(rendered.root,'Simpan konfigurasi tim')[0].props.onClick();});
    assert.ok(content(rendered.root).includes('Konfigurasi telah diubah pengguna lain.'));
  }finally{rendered.unmount();}
});
test('configuration inputs are disabled while a save is pending',async()=>{
  let complete:(v:{workspaceId:string;revision:number})=>void=()=>{};
  const context=setup();context.config.rooveBusiness='';
  const rendered=create(React.createElement(Tool,{context,saveConfig:()=>new Promise(resolve=>{complete=resolve;})}));
  try {
    await act(async()=>{buttons(rendered.root,'Konfigurasi')[0].props.onClick();});
    await act(async()=>{buttons(rendered.root,'Simpan konfigurasi tim')[0].props.onClick();});
    assert.equal(rendered.root.findByType('fieldset').props.disabled,true);
    assert.equal(buttons(rendered.root,'Atur business')[0].props.disabled,true);
    await act(async()=>{complete({workspaceId:'synthetic-test',revision:2});});
    assert.ok(content(rendered.root).includes('Konfigurasi tersimpan'));
  }finally{rendered.unmount();}
});
test('a failed replacement file invalidates the previous download review',async()=>{
  const rendered=create(React.createElement(Tool,{context:setup(),saveConfig:async()=>({workspaceId:'synthetic-test',revision:2})}));
  try {
    await act(async()=>{rendered.root.findByProps({type:'file'}).props.onChange({target:{files:[file()],value:''}});await new Promise(r=>setTimeout(r,50));});
    await act(async()=>{rendered.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}});});
    await act(async()=>{rendered.root.findByProps({type:'file'}).props.onChange({target:{files:[{...file(),name:'wrong.csv'}],value:''}});});
    assert.equal(rendered.root.findByProps({type:'checkbox'}).props.checked,false);
    assert.ok(buttons(rendered.root,'Download CSV RTI')[0].props.disabled);
    assert.ok(content(rendered.root).includes('Preview sebelumnya tetap ditampilkan'));
  }finally{rendered.unmount();}
});
