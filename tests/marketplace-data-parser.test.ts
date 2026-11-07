import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { defaultParserConfig, loadParserConfig, validateParserConfig } from '../lib/marketplace-parser/config';
import { parseWorkbook } from '../lib/marketplace-parser/read';
import { projectMarketplace, exportBusinessCsv, orderReady } from '../lib/marketplace-parser/project';
import { centsText, moneyCents } from '../lib/marketplace-parser/money';
import { CSV_HEADERS, type Catalog, type ParserConfig, type ParsedFile, type Edits } from '../lib/marketplace-parser/types';
import { buildVisibleTabs } from '../lib/dashboard-navigation';
import { dashboardTabPermissionKeys } from '../lib/dashboard-permissions';

const catalog:Catalog={businesses:[{code:'RTI',name:'Roove'},{code:'JHN',name:'JHN'},{code:'RLT',name:'RLT'}],stores:[{business:'RTI',name:'Roove Main Store - Marketplace'},{business:'RTI',name:'Pluve Main Store - Marketplace'},{business:'JHN',name:'Pluve Main Store JHN'},{business:'RLT',name:'Pluve Main Store - Marketplace'},{business:'RTI',name:'Purvu The Secret Store - Markerplace'}],bundles:[{business:'RTI',sku:'ROV20-295',name:'Roove'},{business:'RTI',sku:'SMini-0',name:'Shaker'},{business:'RTI',sku:'SRTARM-185',name:'Arum'},{business:'RTI',sku:'PLV20-245',name:'Pluve'},{business:'JHN',sku:'PLV20-245',name:'Pluve'},{business:'RLT',sku:'PLV20-245',name:'Pluve'}],warehouses:['Test warehouse']};
function config():ParserConfig {const c=defaultParserConfig();c.routes=c.routes.map(r=>({...r,business:r.business||'RTI'}));return c;}
function book(sheets:Record<string,Record<string,unknown>[]>) {const w=XLSX.utils.book_new();for(const [name,rows] of Object.entries(sheets))XLSX.utils.book_append_sheet(w,XLSX.utils.json_to_sheet(rows),name);return w;}
function shopee(extra:Record<string,unknown>={}) {return {'No. Pesanan':'ORDER-TEST-1','Nomor Referensi SKU':'ROV20-295','Nama Produk':'Roove','Jumlah':2,'Harga Setelah Diskon':295000,'No. Resi':'00012345','Opsi Pengiriman':'SPX Standard','Username (Pembeli)':'pembeli-test',...extra};}
function tiktok(extra:Record<string,unknown>={}) {return {'Order ID':'583648045861405949','Seller SKU':'ROV20-295','Product Name':'Roove','Quantity':2,'SKU Unit Original Price':295000,'SKU Subtotal Before Discount':590000,'SKU Seller Discount':100000,'SKU Platform Discount':30000,'Tracking ID':'00012345','Shipping Provider Name':'J&T Express','Buyer Username':'pembeli-test',...extra};}
function projection(file:ParsedFile,c=config(),edits?:Edits,account='roove') {return projectMarketplace({file,account,date:'2026-11-07',config:c,revision:2,catalog,edits});}

test('TikTok price is unit original minus seller line discount / quantity; platform subsidy stays separate',()=>{
  const p=projection(parseWorkbook(book({OrderSKUList:[tiktok()]})));
  assert.equal(p.orders[0].lines[0].unitCents,24500000);assert.equal(p.orders[0].totalCents,49000000);assert.ok(orderReady(p.orders[0]));
  assert.equal(p.orders[0].rows[0].price,'245000');assert.equal(p.orders[0].rows[0].quantity,'2');
});
test('multi-item order repeats CSV group id, header only once, and download serializes the preview rows',()=>{
  const p=projection(parseWorkbook(book({orders:[shopee(),shopee({'Nomor Referensi SKU':'SMini-0','Nama Produk':'Shaker Mini Roove','Jumlah':1,'Harga Setelah Diskon':17900})]})));
  assert.equal(p.orders.length,1);assert.ok(orderReady(p.orders[0]));
  assert.deepEqual(p.orders[0].rows.map(r=>r.id),['1','1']);assert.equal(p.orders[0].rows[1].external_id,'');
  const csv=exportBusinessCsv(p,'RTI');const rows=XLSX.utils.sheet_to_json(XLSX.read(csv,{type:'string',raw:true}).Sheets.Sheet1,{defval:''});
  assert.deepEqual(rows,p.orders[0].rows);assert.equal(Object.keys(rows[0] as object).length,28);
});
test('zero-priced items remain zero, and suffix -0 is not used to price a paid accessory',()=>{
  const free=projection(parseWorkbook(book({OrderSKUList:[tiktok({'Seller SKU':'SRTARM-250','SKU Unit Original Price':185000,'Quantity':1,'SKU Subtotal Before Discount':185000,'SKU Seller Discount':185000})]})));
  assert.equal(free.orders[0].rows[0].price,'0');assert.equal(free.orders[0].rows[0].sku,'SRTARM-185');assert.ok(orderReady(free.orders[0]));
});
test('header-only first sheet is ignored, real Advance Fulfilment rows are retained and blocked',()=>{
  const w=book({'Advance Fulfilment':[{'Booking SN':'BOOKING-TEST','No. Resi':'ADV-01','Nama Produk':'Arum'}],orders:[shopee()]});
  const p=projection(parseWorkbook(w));assert.equal(p.orders.length,2);assert.equal(p.orders[0].source.idKind,'booking');assert.equal(p.orders[0].lines[0].quantity,null);assert.equal(p.orders[0].lines[0].unitCents,null);assert.ok(!orderReady(p.orders[0]));
  assert.throws(()=>exportBusinessCsv(p,'RTI')); // No silent partial download inside a business.
  const header=XLSX.utils.aoa_to_sheet([['Booking SN','No. Resi']]);w.Sheets['Advance Fulfilment']=header;
  assert.equal(parseWorkbook(w).orders.length,1);
});
test('source name+variation can resolve a blank SKU; unexpected variants stay unresolved',()=>{
  const f=parseWorkbook(book({OrderSKUList:[tiktok({'Seller SKU':'','Product Name':'Roove Collagen Drink Kemasan 20 Sachet',Variation:'BLUEBERRY'})]}));
  assert.equal(projection(f).orders[0].rows[0].sku,'ROV20-295');
  f.orders[0].lines[0].variation='NEW';assert.ok(!orderReady(projection(f).orders[0]));
});
test('routing uses source account plus product; Pluve in MP Roove never goes to JHN automatically',()=>{
  const f=parseWorkbook(book({orders:[shopee({'Nomor Referensi SKU':'PLV20-245'})]}));
  assert.equal(projection(f).orders[0].business,'RTI');assert.equal(projection(f).orders[0].store,'Pluve Main Store - Marketplace');
  assert.equal(projection(f,config(),undefined,'pluve').orders[0].business,'JHN');
});
test('conflicting routes, wrong-business SKU and an unknown source provider block export',()=>{
  const f=parseWorkbook(book({orders:[shopee({'Opsi Pengiriman':'NEW CARRIER'})]}));assert.ok(projection(f).orders[0].errors.some(e=>e.includes('kurir')));
  const c=config();c.routes.push({...c.routes[1],id:'duplicate'});assert.ok(projection(f,c).orders[0].errors.some(e=>e.includes('ganda')));
  const unknown=parseWorkbook(book({orders:[shopee({'Nomor Referensi SKU':'ROV99-NEW'})]}));assert.ok(projection(unknown).orders[0].lines[0].errors.some(e=>e.includes('katalog')));
});
test('Lazada uses the selected account route and unitPrice; multi-item identity is blocked',()=>{
  const row={orderNumber:'2771297423401190',orderItemId:'2771297423501190',unitPrice:'245000.00',paidPrice:'269950.00',sellerSku:'PLV20-245',trackingCode:'JZ-TEST',shippingProvider:'J&T',customerName:'test'};
  const file=parseWorkbook(book({sheet1:[row]}));
  const p=projection(file);assert.equal(p.orders[0].business,'RTI');assert.equal(p.orders[0].rows[0].price,'245000');assert.ok(orderReady(p.orders[0]));
  const c=config();c.accounts.push({id:'lazada-pluve',label:'Lazada Pluve'});
  c.routes.push({id:'lazada-pluve',account:'lazada-pluve',family:'pluve',business:'RLT',store:'Pluve Main Store - Marketplace',warehouse:'Test warehouse'});
  const mapped=projection(file,c,undefined,'lazada-pluve');assert.equal(mapped.orders[0].business,'RLT');assert.ok(orderReady(mapped.orders[0]));
  assert.ok(exportBusinessCsv(mapped,'RLT').includes('2771297423501190'));
  assert.equal(projection(file,c,undefined,'pluve').orders[0].business,'JHN');
  assert.equal(projection(file,c).orders[0].business,'RTI');
  assert.ok(!orderReady(projection(parseWorkbook(book({sheet1:[row,{...row,orderItemId:'2771297423501191'}]}))).orders[0]));
});
test('legacy config resolves only shared business references and preserves custom rules without mutation',()=>{
  const current=config();
  const legacy={...current,schemaVersion:1,rooveBusiness:'RTI',lazadaBusiness:'RLT',routes:current.routes.map(r=>({...r,business:r.account==='roove'?'$roove':r.business}))};
  const before=structuredClone(legacy);const loaded=loadParserConfig(legacy);
  assert.deepEqual(loaded,current);assert.deepEqual(legacy,before);
  assert.equal('rooveBusiness' in loaded,false);assert.equal('lazadaBusiness' in loaded,false);
  loaded.accounts[0].label='Changed';assert.equal(legacy.accounts[0].label,'MP Roove');
  assert.throws(()=>validateParserConfig(legacy),/Muat ulang/);
});
test('unassigned legacy and default businesses remain editable and block saving/export until selected',()=>{
  const defaults=defaultParserConfig();const loaded=loadParserConfig(defaults);
  assert.equal(loaded.routes[1].business,'');assert.throws(()=>validateParserConfig(loaded),/setiap baris/);
  const legacy={...defaults,schemaVersion:1,rooveBusiness:'',lazadaBusiness:'RLT',routes:defaults.routes.map(r=>({...r,business:r.business||'$roove'}))};
  assert.deepEqual(loadParserConfig(legacy),defaults);
  const p=projection(parseWorkbook(book({orders:[shopee()]})),loaded);
  assert.ok(!orderReady(p.orders[0]));assert.throws(()=>exportBusinessCsv(p,'RTI'));
  const invalid=config();invalid.routes[1].business='$roove';assert.throws(()=>validateParserConfig(invalid),/setiap baris/);
});
test('business is independent per route even within one source account',()=>{
  const c=config();const route=c.routes.find(r=>r.account==='roove'&&r.family==='pluve')!;route.business='RLT';
  const f=parseWorkbook(book({orders:[shopee(),shopee({'No. Pesanan':'PLUVE-2','No. Resi':'PLUVE-RECEIPT','Nomor Referensi SKU':'PLV20-245'})]}));
  const p=projection(f,c);assert.deepEqual(p.orders.map(o=>o.business),['RTI','RLT']);assert.ok(p.orders.every(orderReady));
  assert.ok(exportBusinessCsv(p,'RTI').includes('ORDER-TEST-1'));assert.ok(!exportBusinessCsv(p,'RTI').includes('PLUVE-2'));
  assert.ok(exportBusinessCsv(p,'RLT').includes('PLUVE-2'));
});
test('missing values do not become zero/one, and corrections need a reason',()=>{
  const f=parseWorkbook(book({orders:[shopee({Jumlah:'','Harga Setelah Diskon':''})]}));
  const key=f.orders[0].lines[0].key;assert.ok(!orderReady(projection(f).orders[0]));
  const edits:Edits={orders:{},lines:{[key]:{quantity:'1',price:'245000'}}};assert.ok(!orderReady(projection(f,config(),edits).orders[0]));
  edits.lines[key].reason='Dikonfirmasi dari laporan pesanan';assert.ok(orderReady(projection(f,config(),edits).orders[0]));
});
test('malformed source financials require a full, reasoned quantity and price correction',()=>{
  const f=parseWorkbook(book({orders:[shopee({'Harga Setelah Diskon':'invalid'})]}));const key=f.orders[0].lines[0].key;
  const edits:Edits={orders:{},lines:{[key]:{quantity:'2',price:'295000',reason:'Confirmed against order detail'}}};
  const p=projection(f,config(),edits);assert.ok(orderReady(p.orders[0]));assert.ok(p.orders[0].warnings.some(w=>w.includes('diganti')));
  assert.ok(p.orders[0].source.lines[0].errors.length); // Original evidence is retained.
});
test('duplicate lines, duplicate order/booking receipt, canceled status and unsafe numeric IDs are rejected',()=>{
  const dup=projection(parseWorkbook(book({orders:[shopee(),shopee()]})));assert.ok(dup.orders[0].errors.some(e=>e.includes('identik')));
  const same=projection(parseWorkbook(book({orders:[shopee()],Advance:[{'Booking SN':'OTHER','No. Resi':'00012345'}]})));assert.ok(same.orders.every(o=>o.errors.some(e=>e.includes('Resi'))));
  assert.ok(!orderReady(projection(parseWorkbook(book({orders:[shopee({'Status Pesanan':'Dibatalkan'})]}))).orders[0]));
  assert.throws(()=>parseWorkbook(book({OrderSKUList:[tiktok({'Order ID':583648045861405949})]})),/presisi/);
});
test('ID strings and leading zero receipts survive; CSV escapes quotes and rejects formula prefixes',()=>{
  const p=projection(parseWorkbook(book({OrderSKUList:[tiktok({'Buyer Username':'User, "test"'})]})));
  const csv=exportBusinessCsv(p,'RTI');assert.ok(csv.includes('583648045861405949'));assert.ok(csv.includes('00012345'));assert.ok(csv.includes('"User, ""test"""'));
  assert.ok(!orderReady(projection(parseWorkbook(book({orders:[shopee({'Username (Pembeli)':'=1+1'})]}))).orders[0]));
});
test('money is exact; ambiguous malformed values and fractional cents cannot silently round',()=>{
  assert.equal(moneyCents('Rp 245.000'),24500000);assert.equal(moneyCents('245000.00'),24500000);assert.equal(moneyCents('245.000,50'),24500050);assert.equal(moneyCents(''),null);assert.equal(moneyCents('0'),0);
  assert.equal(centsText(12345),'123.45');assert.throws(()=>moneyCents('oops'));assert.throws(()=>moneyCents('1.2345'));
  assert.throws(()=>moneyCents(1.234),/desimal/);assert.equal(moneyCents('1.234'),123400);assert.equal(moneyCents(0.29),29);
  const f=parseWorkbook(book({OrderSKUList:[tiktok({Quantity:3,'SKU Unit Original Price':100,'SKU Subtotal Before Discount':300,'SKU Seller Discount':1})]}));assert.equal(f.orders[0].lines[0].unitCents,null);assert.ok(!orderReady(projection(f).orders[0]));
});
test('unsupported courier/service cross-pairs cannot become ready through an order correction',()=>{
  const f=parseWorkbook(book({orders:[shopee()]}));
  const edits:Edits={lines:{},orders:{[f.orders[0].key]:{courier:'Shopee Express',service:'EZ',reason:'test invalid pair'}}};
  assert.ok(projection(f,config(),edits).orders[0].errors.some(e=>e.includes('Pasangan kurir')));
});
test('config validation rejects malformed/incomplete mappings and duplicate identifiers',()=>{
  const c=config();validateParserConfig(c);c.routes.push({...c.routes[0]});assert.throws(()=>validateParserConfig(c),/unik/);
  assert.throws(()=>validateParserConfig({schemaVersion:2}),/Format/);
});
test('confirmed Gojek and Grab policy maps to Shopee Express REGULER while keeping source provider',()=>{
  for(const provider of ['Gojek','Grab']) {
    const p=projection(parseWorkbook(book({OrderSKUList:[tiktok({'Shipping Provider Name':provider})]})));
    assert.equal(p.orders[0].rows[0].courier,'Shopee Express');assert.equal(p.orders[0].rows[0].courier_service,'REGULER');
    assert.equal(p.orders[0].source.provider,provider);assert.ok(orderReady(p.orders[0]));
  }
});
test('preview snapshot stays fixed when source config is edited afterwards',()=>{
  const c=config();const p=projection(parseWorkbook(book({orders:[shopee()]})),c);const before=exportBusinessCsv(p,'RTI');c.routes[1].store='Changed';
  assert.equal(exportBusinessCsv(p,'RTI'),before);assert.equal(p.configSnapshot.routes[1].store,'Roove Main Store - Marketplace');
});
test('menu is under Sales Channel and follows its permission for sales managers',()=>{
  assert.deepEqual(dashboardTabPermissionKeys('marketplace-data-parser'),['tab:channels']);
  const tabs=buildVisibleTabs('sales_manager',new Set(['tab:channels']));assert.ok(tabs.find(t=>t?.id==='channels')?.children?.some(c=>c.id==='marketplace-data-parser'));
  assert.ok(!buildVisibleTabs('advertiser',new Set(['tab:marketing'])).some(t=>t?.children?.some(c=>c.id==='marketplace-data-parser')));
  assert.equal(CSV_HEADERS.length,28);
});
