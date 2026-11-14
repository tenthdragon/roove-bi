import type { Catalog, ParserConfig, Platform } from './types';

export const MARKETPLACE_LABELS: Record<Platform, string> = { shopee: 'Shopee', tiktokshop: 'TikTok Shop', lazada: 'Lazada' };
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
  return { schemaVersion: 3, accounts: [], stores: [], groups: [], products: [], routes: [], combinations: [],
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

function fail(message: string): never { throw new Error(message); }
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 500 && !/[\u0000-\u001f]/.test(value);
const filled = (value: unknown): value is string => text(value) && !!value.trim();
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const list = (value: unknown): value is unknown[] => Array.isArray(value) && value.length <= 2000;
const unique = (values: unknown[]) => new Set(values).size === values.length;
export const normalizeCourierText = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('id');
export function validateParserConfig(input: unknown, options: { allowIncomplete?: boolean } = {}): asserts input is ParserConfig {
  const c = input as ParserConfig;
  if ([1,2].includes(Number((input as { schemaVersion?: number })?.schemaVersion))) fail('Aturan parsing telah diperbarui. Muat ulang halaman sebelum menyimpan.');
  if (!c || c.schemaVersion !== 3 || !['accounts','stores','groups','products','routes','combinations','couriers'].every(k => list((c as unknown as Record<string, unknown>)[k]))) fail('Format konfigurasi parser tidak valid.');
  for (const rows of [c.accounts,c.groups,c.products,c.routes,c.combinations]) {
    if (rows.some(r => !r || !filled(r.id)) || !unique(rows.map(r => r.id))) fail('ID pengaturan harus unik dan tidak kosong.');
  }
  if (c.accounts.some(a => !filled(a.label) || !Object.hasOwn(MARKETPLACE_LABELS,a.marketplace) || !text(a.business) || (!options.allowIncomplete && !a.business))) fail('Lengkapi nama akun, Marketplace, dan Business pada setiap akun.');
  if (!unique(c.accounts.map(a => a.marketplace + ':' + a.label.trim().toLowerCase()))) fail('Nama akun dalam Marketplace yang sama harus unik.');
  if (c.groups.some(g => !filled(g.name)) || !unique(c.groups.map(g => g.name.trim().toLowerCase()))) fail('Nama Produk harus terisi dan unik.');
  if (c.stores.some(s => !s || !id(s.storeId) || (s.warehouseId !== null && !id(s.warehouseId))) || !unique(c.stores.map(s => s.storeId))) fail('Pilihan Store tidak valid atau ganda.');
  const accounts = new Set(c.accounts.map(a => a.id)), groups = new Set(c.groups.map(g => g.id)), stores = new Set(c.stores.map(s => s.storeId));
  const products = (values: unknown): values is string[] => Array.isArray(values) && values.length > 0 && values.length <= 200 && unique(values) && values.every(v => groups.has(v));
  if (c.products.some(r => !['sku','prefix'].includes(r.match) || !filled(r.value) || !products(r.productIds) || (r.account !== '*' && !accounts.has(r.account)))) fail('Pengenalan Produk membutuhkan kode SKU atau awalan kode, Produk, dan akun yang valid.');
  if (c.routes.some(r => !accounts.has(r.account) || !groups.has(r.productId) || (!stores.has(r.storeId) && !(options.allowIncomplete && r.storeId === 0)))) fail('Routing Produk membutuhkan akun, Produk, dan Store yang digunakan.');
  if (!unique(c.routes.map((r: any) => r.account + ':' + r.productId))) fail('Satu akun + Produk hanya boleh memiliki satu routing Store.');
  if (c.combinations.some(r => !accounts.has(r.account) || !products(r.productIds) || !['contains','exact'].includes(r.match) || !Number.isSafeInteger(r.priority) || r.priority < 0 || r.priority > 9999 || !stores.has(r.storeId))) fail('Lengkapi akun, kondisi Produk, prioritas, dan Store pada aturan kombinasi.');
  if (c.couriers.some(r => !r || !Object.hasOwn(MARKETPLACE_LABELS,r.platform) || !filled(r.source) || !filled(r.courier) || !filled(r.service) || !COURIER_SERVICE_OPTIONS.some(p => p.courier === r.courier && p.service === r.service))) fail('Lengkapi mapping kurir dengan pasangan kurir/layanan Scalev yang valid.');
  if (c.couriers.some(r => r.deliveryOption !== undefined && (r.platform !== 'tiktokshop' || !text(r.deliveryOption)))) fail('Delivery Option hanya tersedia untuk kurir TikTok Shop.');
  const optionKeys = c.couriers.filter(r => r.deliveryOption?.trim()).map(r => JSON.stringify([normalizeCourierText(r.source), normalizeCourierText(r.deliveryOption!)]));
  if (!unique(optionKeys)) fail('Setiap pasangan provider dan Delivery Option TikTok Shop hanya boleh memiliki satu aturan.');
}

export function validateCatalogConfig(config: ParserConfig, catalog: Catalog) {
  validateParserConfig(config);
  for (const account of config.accounts) if (!catalog.businesses.some(b => b.code === account.business)) fail(`Business akun ${account.label} tidak aktif atau tidak tersedia.`);
  for (const scope of config.stores) {
    const store = catalog.stores.find(s => s.id === scope.storeId);
    if (!store || !config.accounts.some(a => a.business === store.business)) fail('Pilih Store dari Business yang digunakan oleh akun asal.');
    if (!catalog.warehouses.some(w => w.id === scope.warehouseId && w.businesses.includes(store.business))) fail(`Pilih Warehouse yang terhubung dengan Business ${store.business} untuk ${store.name}.`);
  }
  for (const route of [...config.routes,...config.combinations]) {
    const account = config.accounts.find(a => a.id === route.account)!;
    if (!catalog.stores.some(s => s.id === route.storeId && s.business === account.business)) fail(`Store routing ${account.label} harus berada dalam Business ${account.business}.`);
  }
}

// Legacy references are resolved from the actual catalog, never from invented
// Store/Business names. Reading never rewrites configuration or audit history.
export function migrateParserConfig(input: unknown, catalog: Catalog): { config: ParserConfig; notes: string[] } {
  if (!input) return { config: defaultParserConfig(), notes: [] };
  const legacy = input as Record<string, any>;
  if (legacy.schemaVersion === 3) { validateParserConfig(input, { allowIncomplete: true }); return { config: structuredClone(input), notes: [] }; }
  if (![1,2].includes(legacy.schemaVersion) || !Array.isArray(legacy.accounts) || !Array.isArray(legacy.routes) || !Array.isArray(legacy.products) || !Array.isArray(legacy.couriers)) fail('Konfigurasi tersimpan tidak dikenali.');
  const config = defaultParserConfig(); config.couriers = structuredClone(legacy.couriers);
  const notes = ['Konfigurasi lama disiapkan sebagai rancangan. Periksa akun, Store, Warehouse, dan Produk lalu simpan untuk mengaktifkannya. Penggantian SKU dan pencocokan nama tidak digunakan lagi.'];
  const familyNames = [...new Set<string>([...legacy.products,...legacy.routes].map(r => String(r.family || '').trim()).filter(Boolean))];
  config.groups = familyNames.map(name => ({ id: name, name }));
  for (const a of legacy.accounts) {
    if (!a || !filled(a.id) || !filled(a.label)) continue;
    const routes = legacy.routes.filter((r: any) => r.account === a.id);
    const codes = [...new Set<string>(routes.map((r: any) => String(r.business === '$roove' ? legacy.rooveBusiness || '' : r.business || '')).filter(Boolean))];
    const business = codes.length === 1 ? codes[0] : '';
    if (!business) notes.push(`Tentukan satu Business untuk akun ${a.label}; aturan lama belum memiliki satu Business yang konsisten.`);
    for (const marketplace of Object.keys(MARKETPLACE_LABELS) as Platform[]) {
      const accountId = `${a.id}:${marketplace}`;
      config.accounts.push({ id: accountId, label: `${MARKETPLACE_LABELS[marketplace]} ${a.label.replace(/^MP\s+/i,'')}`, marketplace, business });
      for (const route of routes) {
        const store = catalog.stores.find(s => s.business === business && s.name === route.store);
        if (store && !config.stores.some(s => s.storeId === store.id)) {
          const warehouse = catalog.warehouses.find(w => w.businesses.includes(business) && w.name === route.warehouse);
          config.stores.push({ storeId: store.id, warehouseId: warehouse?.id || null });
        }
        if (route.family) config.routes.push({ id: `${route.id}:${marketplace}`, account: accountId, productId: route.family, storeId: store?.id || 0 });
      }
      for (const rule of legacy.products.filter((r: any) => r.account === a.id || r.account === '*')) {
        const value = String(rule.sourceSku || rule.prefix || '').trim();
        if (value && rule.family) config.products.push({ id: `${rule.id}:${accountId}`, account: accountId, match: rule.sourceSku ? 'sku' : 'prefix', value, productIds: [rule.family] });
      }
    }
  }
  // Conflicting legacy routes remain visibly incomplete rather than selecting a winner.
  const seen = new Set<string>();
  config.routes = config.routes.filter(route => { const key = route.account + ':' + route.productId; if (seen.has(key)) { const prior = config.routes.find(r => r.account === route.account && r.productId === route.productId); if (prior) prior.storeId = 0; notes.push('Routing lama ganda perlu diperiksa kembali.'); return false; } seen.add(key); return true; });
  validateParserConfig(config, { allowIncomplete: true });
  return { config, notes: [...new Set(notes)] };
}
export function loadParserConfig(input: unknown, catalog: Catalog): ParserConfig { return migrateParserConfig(input,catalog).config; }
