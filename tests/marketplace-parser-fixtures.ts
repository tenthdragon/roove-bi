import * as XLSX from 'xlsx';
import { defaultParserConfig } from '../lib/marketplace-parser/config';
import type { Catalog, ParserConfig, ParserContext } from '../lib/marketplace-parser/types';
export function catalogFixture(): Catalog {
  return {
    version: 'synthetic-catalog-v3', businesses: [{ id: 4,code: 'RTI',name: 'Roove Tijara Internasional' },{ id: 2,code: 'JHN',name: 'Jejak Herba Nusantara' }],
    stores: [{ id: 10,business: 'RTI',name: 'Roove Main Store - Marketplace' },{ id: 11,business: 'RTI',name: 'Pluve Main Store - Marketplace' },{ id: 12,business: 'RTI',name: 'Globite Store - Marketplace' },{ id: 20,business: 'JHN',name: 'Pluve Main Store JHN' }],
    warehouses: [{ id: 1,name: 'Warehouse A',exportName: 'Warehouse A',businesses: ['RTI','JHN'] },{ id: 2,name: 'Warehouse B',exportName: 'Warehouse B',businesses: ['JHN'] }],
    loadedStoreIds: [10,11,12,20],storeSyncs: [10,11,12,20].map(storeId => ({ storeId,checkedAt: '2026-11-09T00:00:00Z',bundleCount: 4,status: 'ready' })),
    bundles: [
      { id: 101,business: 'RTI',sku: 'ROV20-295',name: 'Roove A',storeIds: [10],syncedAt: null },
      { id: 102,business: 'RTI',sku: 'PLV20-245',name: 'Pluve RTI',storeIds: [10,11],syncedAt: null },
      { id: 103,business: 'RTI',sku: 'GLB-150',name: 'Globite',storeIds: [10,11,12],syncedAt: null },
      { id: 104,business: 'RTI',sku: 'OGD-100',name: 'Osgard',storeIds: [10,12],syncedAt: null },
      { id: 105,business: 'RTI',sku: 'ROV10-150',name: 'Roove B',storeIds: [10],syncedAt: null },
      { id: 106,business: 'RTI',sku: 'SMini-0',name: 'Shaker',storeIds: [10],syncedAt: null },
      { id: 107,business: 'RTI',sku: 'SRTARM-185',name: 'Arum',storeIds: [10],syncedAt: null },
      { id: 201,business: 'JHN',sku: 'PLV20-245',name: 'Pluve JHN',storeIds: [20],syncedAt: null },
    ],
  };
}
export function configFixture(): ParserConfig {
  const c = defaultParserConfig();
  c.accounts = [{ id: 'roove',label: 'Shopee Roove',marketplace: 'shopee',business: 'RTI' },{ id: 'pluve',label: 'Shopee Pluve',marketplace: 'shopee',business: 'JHN' },{ id: 'tiktok-roove',label: 'TikTok Roove',marketplace: 'tiktokshop',business: 'RTI' },{ id: 'lazada-roove',label: 'Lazada Roove',marketplace: 'lazada',business: 'RTI' }];
  c.stores = [10,11,12,20].map(storeId => ({ storeId,warehouseId: 1 }));
  c.groups = ['roove','pluve','globite','osgard','accessory','purvu'].map(id => ({ id,name: id }));
  c.products = [['ROV','roove'],['PLV','pluve'],['GLB','globite'],['OGD','osgard'],['SMini','accessory'],['SRT','purvu']].map(([value,product]) => ({ id: value,account: '*',match: 'prefix',value,productIds: [product] }));
  c.routes = c.accounts.flatMap(a => a.business === 'RTI' ? [['roove',10],['pluve',11],['globite',12],['osgard',12],['purvu',10]].map(([productId,storeId]) => ({ id: `${a.id}:${productId}`,account: a.id,productId: String(productId),storeId: Number(storeId) })) : [{ id: 'jhn-pluve',account: a.id,productId: 'pluve',storeId: 20 }]);
  c.combinations = [{ id: 'contains-roove',account: 'roove',productIds: ['roove'],match: 'contains',priority: 100,storeId: 10 }];
  return c;
}
export function contextFixture(): ParserContext { return { workspaceId: 'synthetic-test',config: configFixture(),revision: 3,catalog: catalogFixture(),canSave: true,canSync: true,migrationNotes: [] }; }
export function book(sheets: Record<string,Record<string,unknown>[]>) { const w = XLSX.utils.book_new(); for (const [name,rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(w,XLSX.utils.json_to_sheet(rows),name); return w; }
export function shopee(extra: Record<string,unknown> = {}) { return { 'No. Pesanan': 'ORDER-TEST-1','Nomor Referensi SKU': 'ROV20-295','Nama Produk': 'Roove','Jumlah': 2,'Harga Setelah Diskon': 295000,'No. Resi': '00012345','Opsi Pengiriman': 'SPX Standard','Username (Pembeli)': 'pembeli-test',...extra }; }
export function tiktok(extra: Record<string,unknown> = {}) { return { 'Order ID': '583648045861405949','Seller SKU': 'ROV20-295','Product Name': 'Roove','Quantity': 2,'SKU Unit Original Price': 295000,'SKU Subtotal Before Discount': 590000,'SKU Seller Discount': 100000,'SKU Platform Discount': 30000,'Tracking ID': '00012345','Shipping Provider Name': 'J&T Express','Buyer Username': 'pembeli-test',...extra }; }
