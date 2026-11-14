import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { defaultParserConfig, migrateParserConfig, validateParserConfig, validateCatalogConfig } from '../lib/marketplace-parser/config';
import { parseWorkbook } from '../lib/marketplace-parser/read';
import { projectMarketplace, exportBusinessCsv, orderReady } from '../lib/marketplace-parser/project';
import { centsText, moneyCents } from '../lib/marketplace-parser/money';
import { CSV_HEADERS, type Catalog, type ParserConfig, type ParsedFile, type Edits } from '../lib/marketplace-parser/types';
import { buildVisibleTabs } from '../lib/dashboard-navigation';
import { dashboardTabPermissionKeys } from '../lib/dashboard-permissions';
import { catalogFixture,configFixture,book,shopee,tiktok } from './marketplace-parser-fixtures';
const file = (...skus: string[]) => parseWorkbook(book({ orders: skus.map(sku => shopee({ 'Nomor Referensi SKU': sku })) }));
function projection(f: ParsedFile,c = configFixture(),catalog = catalogFixture(),account?: string,edits?: Edits) { return projectMarketplace({ file: f,account: account || (f.orders[0].platform === 'shopee' ? 'roove' : f.orders[0].platform === 'tiktokshop' ? 'tiktok-roove' : 'lazada-roove'),date: '2026-11-09',config: c,revision: 3,catalog,edits }); }
const blocked = (p: ReturnType<typeof projection>) => { assert.ok(p.orders.some(o => !orderReady(o))); assert.throws(() => exportBusinessCsv(p,p.orders[0].business)); };

test('source account fixes Business; the same marketplace SKU resolves to the correct Business bundle',() => {
  const f = file('PLV20-245');
  const rti = projection(f), jhn = projection(f,configFixture(),catalogFixture(),'pluve');
  assert.equal(rti.orders[0].business,'RTI'); assert.equal(rti.orders[0].storeId,11); assert.equal(rti.orders[0].lines[0].bundleId,102);
  assert.equal(jhn.orders[0].business,'JHN'); assert.equal(jhn.orders[0].storeId,20); assert.equal(jhn.orders[0].lines[0].bundleId,201);
  assert.ok(orderReady(rti.orders[0]) && orderReady(jhn.orders[0]));
});
test('a source account cannot route or fall back into another Business',() => {
  const c = configFixture(); c.routes.find(r => r.account === 'roove' && r.productId === 'pluve')!.storeId = 20;
  assert.throws(() => validateCatalogConfig(c,catalogFixture()),/Business RTI/);
  blocked(projection(file('PLV20-245'),c));
  const catalog = catalogFixture(); catalog.bundles = catalog.bundles.filter(b => b.business !== 'RTI');
  blocked(projection(file('PLV20-245'),configFixture(),catalog));
});
test('two SKU items remain two different Scalev bundles in one order, with exact quantity and CSV continuation rows',() => {
  const p = projection(parseWorkbook(book({ orders: [shopee(),shopee({ 'Nomor Referensi SKU': 'PLV20-245','Jumlah': 3,'Harga Setelah Diskon': 245000 })] })));
  assert.ok(orderReady(p.orders[0])); assert.equal(p.orders[0].storeId,10);
  assert.deepEqual(p.orders[0].lines.map(l => l.bundleId),[101,102]); assert.deepEqual(p.orders[0].rows.map(r => r.quantity),['2','3']);
  assert.deepEqual(p.orders[0].rows.map(r => r.id),['1','1']); assert.equal(p.orders[0].rows[1].external_id,'');
  const csv = exportBusinessCsv(p,'RTI'), rows = XLSX.utils.sheet_to_json(XLSX.read(csv,{ type: 'string',raw: true }).Sheets.Sheet1,{ defval: '' });
  assert.deepEqual(rows,p.orders[0].rows); assert.equal(Object.keys(rows[0] as object).length,28);
});
test('contains rule routes any order with the configured Product, without a hardcoded Roove condition',() => {
  const c = configFixture(); c.combinations[0] = { id: 'custom',account: 'roove',productIds: ['globite'],match: 'contains',priority: 50,storeId: 12 };
  const p = projection(file('GLB-150','OGD-100'),c); assert.equal(p.orders[0].storeId,12); assert.ok(orderReady(p.orders[0]));
  c.combinations[0].storeId = 11; assert.ok(orderReady(projection(file('GLB-150','OGD-100'),c).orders[0]));
});
test('exact combination does not match an order containing an extra Product',() => {
  const c = configFixture(); c.combinations = [{ id: 'pair',account: 'roove',productIds: ['globite','pluve'],match: 'exact',priority: 10,storeId: 11 }];
  assert.ok(orderReady(projection(file('GLB-150','PLV20-245'),c).orders[0]));
  blocked(projection(file('GLB-150','PLV20-245','OGD-100'),c));
});
test('priority picks one combination; tied different destinations block the whole batch',() => {
  const c = configFixture(); c.combinations.push({ id: 'pair',account: 'roove',productIds: ['roove','pluve'],match: 'exact',priority: 200,storeId: 11 });
  const catalog = catalogFixture();
  assert.equal(projection(file('ROV20-295','PLV20-245'),c,catalog).orders[0].storeId,11);
  c.combinations[1].priority = 100; blocked(projection(file('ROV20-295','PLV20-245'),c,catalog));
});
test('two distinct SKU variants in the same Product use a single Product route',() => {
  const c = configFixture(); c.combinations = [];
  const p = projection(file('ROV20-295','ROV10-150'),c); assert.ok(orderReady(p.orders[0])); assert.deepEqual(p.orders[0].lines.map(l => l.bundleId),[101,105]);
});
test('one selected Store alone is not evidence without a bundle relation or approved rule',() => {
  const c = configFixture(); c.routes = []; c.combinations = []; c.stores = [{storeId: 10,warehouseId: 1}];
  blocked(projection(file('ROV20-295'),c));
  c.products = []; blocked(projection(file('ROV20-295'),c));
});
test('an unmapped Product cannot bypass a potentially applicable combination',() => {
  const c = configFixture(); c.products = c.products.filter(r => r.value !== 'PLV');
  blocked(projection(file('ROV20-295','PLV20-245'),c));
});
test('selected Store universe is enforced even if broader catalog data is provided',() => {
  const c = configFixture(); c.stores = c.stores.filter(s => s.storeId !== 10);
  c.routes = c.routes.filter(r => r.storeId !== 10); c.combinations = [];
  blocked(projection(file('ROV20-295'),c));
});
test('Business availability is sufficient regardless of Store membership and catalog prices',() => {
  const catalog = catalogFixture();
  const p = projection(parseWorkbook(book({ orders: [shopee({'Harga Setelah Diskon': 281234.56}),shopee({'Nomor Referensi SKU': 'PLV20-245','Harga Setelah Diskon': 0})] })),configFixture(),catalog);
  assert.equal(p.orders[0].storeId,10); assert.ok(orderReady(p.orders[0]));
  assert.deepEqual(p.orders[0].rows.map(r => r.price),['281234.56','0']);
  assert.equal(p.orders[0].totalCents,56246912);
  assert.match(exportBusinessCsv(p,'RTI'),/281234.56/);
});
test('duplicate identifier anywhere in receiving Business blocks, regardless of Store membership',() => {
  const catalog = catalogFixture(); catalog.bundles.push({ id: 999,business: 'RTI',sku: 'ROV20-295',name: 'Duplicate',syncedAt: null });
  blocked(projection(file('ROV20-295'),configFixture(),catalog));
});
test('missing bundle, blank SKU, changed case and old alias never fall back to product names',() => {
  for (const sku of ['NEW-CODE','','rov20-295','SRTARM-250']) { const p = projection(file(sku)); blocked(p); assert.equal(p.orders[0].lines[0].sku,sku); }
});
test('a failed or unloaded Business catalog blocks download even when matching bundles are cached',() => {
  const catalog = catalogFixture(); catalog.businessSyncs[0].status = 'failed'; blocked(projection(file('ROV20-295'),configFixture(),catalog));
  catalog.businessSyncs[0].status = 'ready'; catalog.loadedBusinessCodes = ['JHN']; blocked(projection(file('ROV20-295'),configFixture(),catalog));
});
test('manual overrides of Business, Store, Warehouse or SKU are rejected',() => {
  for (const field of ['business','store','warehouse']) assert.throws(() => projection(file('ROV20-295'),configFixture(),catalogFixture(),undefined,{ lines: {},orders: { 'shopee:order:ORDER-TEST-1': { [field]: 'OTHER',reason: 'test' } } } as Edits),/tidak boleh/);
  assert.throws(() => projection(file('ROV20-295'),configFixture(),catalogFixture(),undefined,{ orders: {},lines: { 'orders:2': { sku: 'PLV20-245',reason: 'test' } } } as Edits),/tidak boleh/);
});
test('Warehouse follows global Store setting and must be connected to its Business',() => {
  const c = configFixture(); c.stores[0].warehouseId = 2; blocked(projection(file('ROV20-295'),c)); assert.throws(() => validateCatalogConfig(c,catalogFixture()),/Warehouse/);
  const catalog = catalogFixture(); catalog.warehouses[1].businesses.push('RTI'); const p = projection(file('ROV20-295'),c,catalog); assert.equal(p.orders[0].rows[0].warehouse,'Warehouse B'); assert.ok(orderReady(p.orders[0]));
});
test('a wrong Marketplace account blocks upload results instead of changing Business',() => { blocked(projection(parseWorkbook(book({ TikTok: [tiktok()] })),configFixture(),catalogFixture(),'roove')); });
test('one invalid order prevents downloading all other valid orders',() => {
  const f = parseWorkbook(book({ orders: [shopee(),shopee({ 'No. Pesanan': 'OTHER','No. Resi': 'OTHER-TRACK','Nomor Referensi SKU': 'MISSING' })] }));
  const p = projection(f); assert.ok(orderReady(p.orders[0])); blocked(p);
});
test('TikTok seller discount determines price; platform subsidy stays separate and long IDs stay exact',() => {
  const p = projection(parseWorkbook(book({ TikTok: [tiktok()] }))); assert.ok(orderReady(p.orders[0])); assert.equal(p.orders[0].lines[0].unitCents,24500000); assert.equal(p.orders[0].totalCents,49000000); assert.equal(p.orders[0].rows[0].external_id,'583648045861405949');
});
test('TikTok exports the original address fields once per order, including masks and CSV punctuation', () => {
  const destination = { 'Detail Address': '  ***, "Blok A"\n***  ', Districts: '*******', 'Regency and City': 'Kota Contoh' };
  const f = parseWorkbook(book({ TikTok: [tiktok(destination), tiktok({ ...destination, Quantity: 1, 'SKU Subtotal Before Discount': 295000 })] }));
  const csv = exportBusinessCsv(projection(f), 'RTI');
  const sheet = XLSX.read(csv, { type: 'string', raw: true }).Sheets.Sheet1;
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
  assert.deepEqual(rows.map(r => [r.address, r.subdistrict, r.city]), [
    [destination['Detail Address'], '*******', 'Kota Contoh'],
    ['', '', ''],
  ]);
});

test('Shopee preserves the source address and city and only extracts a uniquely identifiable district', () => {
  const cases = [
    ['***, KOTA CONTOH, Kec. Utara, JAWA BARAT, ID, 12345', 'Kec. Utara'],
    ['***, Kota Contoh, Buahbatu (Margacinta), Jawa Barat, ID, 12345', 'Buahbatu (Margacinta)'],
    ['***, Kota Lain, Utara, Jawa Barat, ID, 12345', ''],
    ['***, Kota Contoh, ***, Jawa Barat, ID, 12345', ''],
    ['***, Kota Contoh, , Jawa Barat, ID, 12345', ''],
    ['***, Kota Contoh, X, Jawa Barat, Kota Contoh, Y, Jawa Barat', ''],
    ['', ''],
  ];
  for (const [address, expected] of cases) {
    const f = parseWorkbook(book({ orders: [shopee({ 'Alamat Pengiriman': address, 'Kota/Kabupaten': 'Kota Contoh', Provinsi: 'Jawa Barat' })] }));
    const row = projection(f).orders[0].rows[0];
    assert.deepEqual([row.address, row.subdistrict, row.city], [address, expected, 'Kota Contoh']);
  }
});
test('zero-priced items stay zero; SKU suffix never sets price',() => {
  const p = projection(file('SMini-0')); assert.equal(p.orders[0].rows[0].price,'295000');
  const free = projection(parseWorkbook(book({ orders: [shopee({ 'Harga Setelah Diskon': 0 })] }))); assert.ok(orderReady(free.orders[0])); assert.equal(free.orders[0].rows[0].price,'0');
});
test('decimal cents are exact; partial TikTok unit cents and missing quantity block',() => {
  assert.equal(moneyCents('Rp 1.234,56'),123456); assert.equal(centsText(123456),'1234.56');
  blocked(projection(parseWorkbook(book({ TikTok: [tiktok({ Quantity: 3,'SKU Unit Original Price': 100,'SKU Subtotal Before Discount': 300,'SKU Seller Discount': 100 })] }))));
  blocked(projection(parseWorkbook(book({ orders: [shopee({ Jumlah: '' })] }))));
});
test('Advance Fulfilment incomplete item remains present; empty auxiliary sheet does not hide valid orders',() => {
  const w = book({ 'Advance Fulfilment': [{ 'Booking SN': 'BOOK','No. Resi': 'ADV','Nama Produk': 'Roove' }],orders: [shopee()] });
  assert.equal(projection(parseWorkbook(w)).orders.length,2); blocked(projection(parseWorkbook(w)));
  w.Sheets['Advance Fulfilment'] = XLSX.utils.aoa_to_sheet([['Booking SN','No. Resi']]); assert.equal(parseWorkbook(w).orders.length,1);
});
test('Lazada keeps account Business and existing multi-item external ID guard',() => {
  const row = { orderNumber: 'LAZ-1',orderItemId: 'ITEM-1',unitPrice: '245000.00',sellerSku: 'PLV20-245',trackingCode: 'TRACK',shippingProvider: 'J&T',customerName: 'test' };
  const p = projection(parseWorkbook(book({ Lazada: [row] }))); assert.equal(p.orders[0].business,'RTI'); assert.ok(orderReady(p.orders[0]));
  blocked(projection(parseWorkbook(book({ Lazada: [row,{ ...row,orderItemId: 'ITEM-2' }] }))));
});
test('duplicate receipt, cancellation, formula text and unknown courier remain blocking',() => {
  for (const extra of [{ 'Status Pesanan': 'Dibatalkan' },{ 'Username (Pembeli)': '=SUM(A1)' },{ 'Opsi Pengiriman': 'NEW' }]) blocked(projection(parseWorkbook(book({ orders: [shopee(extra)] }))));
  blocked(projection(parseWorkbook(book({ orders: [shopee(),shopee({ 'No. Pesanan': 'DUP' })] }))));
});
test('financial corrections are rejected even with a reason; incomplete source remains blocked',()=> {
 const file=parseWorkbook(book({Orders:[shopee()]}));
 assert.throws(()=>projectMarketplace({file,account:'roove',date:'2026-11-11',config:configFixture(),revision:3,catalog:catalogFixture(),edits:{lines:{[file.orders[0].lines[0].key]:{price:'1',quantity:'1',reason:'test'}},orders:{}}}),/tidak boleh dikoreksi/);
});
test('no customer-specific accounts, routes, products or warehouse names are hardcoded in new defaults',() => {
  const c = defaultParserConfig(); for (const key of ['accounts','stores','groups','products','routes','combinations'] as const) assert.deepEqual(c[key],[]); validateParserConfig(c);
});
test('legacy migration preserves history input, derives Business only from consistent data, and discards SKU replacement',() => {
  const legacy = { schemaVersion: 1,rooveBusiness: 'RTI',lazadaBusiness: 'JHN',accounts: [{ id: 'old',label: 'MP Example' }],routes: [{ id: 'r',account: 'old',family: 'pluve',business: '$roove',store: 'Pluve Main Store - Marketplace',warehouse: 'Warehouse A' }],products: [{ id: 'p',account: '*',sourceSku: 'OLD',targetSku: 'PLV20-245',family: 'pluve' }],couriers: defaultParserConfig().couriers };
  const before = structuredClone(legacy), migrated = migrateParserConfig(legacy,catalogFixture());
  assert.deepEqual(legacy,before); assert.equal(migrated.config.accounts.length,3); assert.ok(migrated.config.accounts.every(a => a.business === 'RTI')); assert.equal(migrated.config.products[0].value,'OLD'); assert.equal('targetSku' in migrated.config.products[0],false); assert.ok(migrated.notes.length); validateCatalogConfig(migrated.config,catalogFixture());
  legacy.routes.push({ ...legacy.routes[0],id: 'other',business: 'JHN' }); const conflict = migrateParserConfig(legacy,catalogFixture()); assert.ok(conflict.config.accounts.every(a => !a.business)); assert.throws(() => validateParserConfig(conflict.config));
});
test('duplicate product routes, malformed combinations and stale config schemas are rejected',() => {
  const c = configFixture(); c.routes.push({ ...c.routes[0],id: 'dup' }); assert.throws(() => validateParserConfig(c),/satu routing/);
  const invalid = configFixture(); invalid.combinations[0].productIds = ['unknown']; assert.throws(() => validateParserConfig(invalid),/kombinasi/);
  assert.throws(() => validateParserConfig({ schemaVersion: 2 }),/Muat ulang/);
});
test('menu remains under Sales Channel with its permission gate and 28-column CSV format',() => {
  assert.deepEqual(dashboardTabPermissionKeys('marketplace-data-parser'),['tab:channels']);
  assert.ok(buildVisibleTabs('sales_manager',new Set(['tab:channels'])).find(t => t?.id === 'channels')?.children?.some(c => c.id === 'marketplace-data-parser'));
  assert.ok(!buildVisibleTabs('advertiser',new Set(['tab:marketing'])).some(t => t?.children?.some(c => c.id === 'marketplace-data-parser'))); assert.equal(CSV_HEADERS.length,28);
});

test('a Warehouse without a verified CSV integration label blocks export instead of inventing its name', () => {
  const catalog = catalogFixture(); catalog.warehouses[0].exportName = null;
  const p = projection(file('ROV20-295'), configFixture(), catalog);
  blocked(p); assert.equal(p.orders[0].rows[0].warehouse, '');
  assert.match(p.orders[0].errors.join(' '), /Nama ekspor/);
});
