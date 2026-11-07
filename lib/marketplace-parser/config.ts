import type { ParserConfig, ProductRule } from './types';

const warehouse = "Roove Lautan Barat's Warehouse";
const jhnWarehouse = "Jejak Herba Nusantara's Warehouse";
// User-supplied Scalev names, including the intentional REGULAR/REGULER distinction.
export const COURIER_SERVICE_OPTIONS = [
  {courier:'SiCepat Express Cashless',service:'REG'},
  {courier:'SiCepat Express Cashless (halu)',service:'HALU'},
  {courier:'J&T Express Cashless',service:'EZ'},
  {courier:'J&T Express Cashless',service:'ECONOMY'},
  {courier:'J&T Cargo Cashless',service:'KARGO'},
  {courier:'JNE Express Cashless',service:'REG'},
  {courier:'LEX ID',service:'STANDARD'},
  {courier:'Ninja Xpress Cashless',service:'STANDARD'},
  {courier:'Shopee Express',service:'REGULER'},
  {courier:'Shopee Express',service:'HEMAT'},
  {courier:'AnterAja Cashless',service:'REGULAR'},
];
export function defaultParserConfig(): ParserConfig {
  const product = (id: string, values: Partial<ProductRule>): ProductRule => ({ id, account: '*', sourceSku: '', name: '', variation: '', prefix: '', targetSku: '', family: '', ...values });
  return {
    schemaVersion: 2,
    accounts: [{ id: 'roove', label: 'MP Roove' }, { id: 'pluve', label: 'MP Pluve' }, { id: 'purvu', label: 'MP Purvu' }],
    routes: [
      { id: 'pluve-pluve', account: 'pluve', family: 'pluve', business: 'JHN', store: 'Pluve Main Store JHN', warehouse },
      ...[
        ['roove','Roove Main Store - Marketplace'], ['globite','Globite Store - Marketplace'],
        ['osgard','Osgard Oil Store'], ['pluve','Pluve Main Store - Marketplace'],
        ['purvu','Purvu Store - Marketplace'], ['purvu_the_secret','Purvu The Secret Store - Markerplace'],
      ].map(([family,store]) => ({ id: `roove-${family}`, account: 'roove', family, business: '', store, warehouse: family === 'purvu_the_secret' ? jhnWarehouse : warehouse })),
    ],
    products: [
      ...[['ROV','roove'],['GLB','globite'],['2GLB','globite'],['OGD','osgard'],['PLV','pluve'],['SRT','purvu_the_secret'],['PRVA-ARM','purvu_the_secret'],['PRVA-ASH','purvu_the_secret'],['PRVA-AM','purvu'],['PAM','purvu'],['PMS','purvu'],['DHF','drhyun']].map(([prefix,family]) => product(`prefix-${prefix}`,{ prefix, family })),
      product('arum-alias',{ sourceSku:'SRTARM-250',targetSku:'SRTARM-185',family:'purvu_the_secret' }),
      product('mini-sku',{ sourceSku:'SMini-0',family:'accessory' }),
      ...[
        ['Shaker Mini Roove','','SMini-0','accessory'], ['Shaker Mini Roove Collagen','Default','SMini-0','accessory'],
        ['DR HYUN Minuman Tinggi Serat Rasa Jeruk Isi 30 Sachet','Default','DHF-305','drhyun'],
        ['Roove Collagen Drink Kemasan 20 Sachet','BLUEBERRY','ROV20-295','roove'],
        ['Mini Pack Purvu The Secret Series: Arum','Default','SRTARM3-40','purvu_the_secret'],
        ['The Secret Series: Arum by Purvu','Default','SRTARM-185','purvu_the_secret'],
        ['Parfum Aroma Aquatic Premium yang Sophisticated, Aman untuk Ngantor & Santai | Parfum Purvu Mediterranean Sea','Default','PMS30-155','purvu'],
      ].map(([name,variation,targetSku,family],i) => product(`name-${i}`,{name,variation,targetSku,family})),
    ],
    couriers: [
      ...['J&T Express','J&T'].map(source => ({ platform:'tiktokshop' as const,source,courier:'J&T Express Cashless',service:'EZ' })),
      { platform:'lazada',source:'J&T',courier:'J&T Express Cashless',service:'EZ' },
      ...(['shopee','tiktokshop','lazada'] as const).flatMap(platform => [
        ...['Gojek','Grab'].map(source=>({platform,source,courier:'Shopee Express',service:'REGULER'})),
      ]),
      ...['SPX Standard','Reguler (Cashless)-SPX Standard','Hemat Kargo-SPX Hemat','Instant Prioritas-SPX Instant Prioritas','Instant-SPX Instant','SPX Ambil di Tempat'].map(source => ({ platform:'shopee' as const,source,courier:'Shopee Express',service:'REGULER' })),
      { platform:'shopee',source:'SPX Hemat',courier:'Shopee Express',service:'HEMAT' },
      ...['JNE Reguler','Reguler (Cashless)-JNE Reguler'].map(source => ({ platform:'shopee' as const,source,courier:'JNE Express Cashless',service:'REG' })),
      ...['SiCepat REG','Reguler (Cashless)-SiCepat REG'].map(source => ({ platform:'shopee' as const,source,courier:'SiCepat Express Cashless',service:'REG' })),
    ],
  };
}

// Resolve saved v1 references in memory. Loading never writes configuration or
// history; the next explicit team save persists the new shape with a revision.
export function loadParserConfig(input: unknown): ParserConfig {
  let config = input;
  if (input && typeof input === 'object' && 'schemaVersion' in input && input.schemaVersion === 1) {
    const legacy = input as Record<string, unknown>;
    if (typeof legacy.rooveBusiness !== 'string' || !Array.isArray(legacy.routes)) throw new Error('Format konfigurasi parser tidak valid.');
    config = {
      schemaVersion: 2,
      accounts: legacy.accounts,
      routes: legacy.routes.map(route => route && typeof route === 'object'
        ? { ...route, business: route.business === '$roove' ? legacy.rooveBusiness : route.business }
        : route),
      products: legacy.products,
      couriers: legacy.couriers,
    };
  }
  validateParserConfig(config, { allowUnassignedBusiness: true });
  return structuredClone(config);
}

export function validateParserConfig(input: unknown, options: { allowUnassignedBusiness?: boolean } = {}): asserts input is ParserConfig {
  const c = input as ParserConfig;
  if ((input as {schemaVersion?:number})?.schemaVersion === 1) throw new Error('Pengaturan routing telah diperbarui. Muat ulang halaman sebelum menyimpan konfigurasi.');
  if (!c || c.schemaVersion !== 2 || !Array.isArray(c.accounts) || !Array.isArray(c.routes) || !Array.isArray(c.products) || !Array.isArray(c.couriers)) throw new Error('Format konfigurasi parser tidak valid.');
  const text = (v: unknown) => typeof v === 'string' && v.length <= 500 && !/[\u0000-\u001f]/.test(v);
  for (const rows of [c.accounts,c.routes,c.products,c.couriers]) {
    if (rows.length > 2000) throw new Error('Konfigurasi terlalu besar (maksimal 2.000 aturan per jenis).');
    if (rows.some(row => !row || Object.values(row).some(v => !text(v)))) throw new Error('Setiap nilai konfigurasi harus berupa teks tanpa karakter kontrol.');
  }
  for (const rows of [c.accounts,c.routes,c.products]) {
    if (rows.some(r => !r.id) || new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('ID aturan harus unik dan tidak kosong.');
  }
  const fields = (o: object, keys: string[]) => keys.every(k => text((o as Record<string, unknown>)[k]));
  if (c.accounts.some(r => !fields(r,['id','label']) || !r.label.trim()) || c.routes.some(r => !fields(r,['id','account','family','business','store','warehouse'])) || c.products.some(r => !fields(r,['id','account','sourceSku','name','variation','prefix','targetSku','family'])) || c.couriers.some(r => !fields(r,['platform','source','courier','service']) || !['shopee','tiktokshop','lazada'].includes(r.platform))) throw new Error('Kolom konfigurasi tidak lengkap.');
  const accounts = new Set(c.accounts.map(a => a.id));
  if (c.routes.some(r => !accounts.has(r.account) || !r.family.trim() || !r.store.trim() || !r.warehouse.trim())) throw new Error('Routing membutuhkan akun, kelompok produk, business, store, dan gudang.');
  if (c.routes.some(r => r.business === '$roove' || (!options.allowUnassignedBusiness && !r.business.trim()))) throw new Error('Pilih business langsung pada setiap baris routing.');
  if (c.products.some(r => (r.account !== '*' && !accounts.has(r.account)) || !r.family.trim() || [r.sourceSku,r.name,r.prefix].filter(s=>s.trim()).length !== 1)) throw new Error('Aturan produk membutuhkan satu pencocokan (SKU, nama, atau prefix), akun, dan kelompok produk.');
  if (c.couriers.some(r => !r.source.trim() || !r.courier.trim() || !r.service.trim())) throw new Error('Aturan kurir harus lengkap.');
  if (c.couriers.some(r=>!COURIER_SERVICE_OPTIONS.some(p=>p.courier===r.courier && p.service===r.service))) throw new Error('Pasangan kurir/layanan harus sesuai daftar Scalev.');
}
