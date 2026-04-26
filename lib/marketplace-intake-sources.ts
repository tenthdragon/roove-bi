export type MarketplaceIntakeSourceKey = 'shopee_rlt' | 'shopee_jhn' | 'tiktok_rti';
export type MarketplaceIntakePlatform = 'shopee' | 'tiktok';

export type MarketplaceIntakeSourceConfig = {
  id: number | null;
  sourceKey: MarketplaceIntakeSourceKey;
  sourceLabel: string;
  platform: MarketplaceIntakePlatform;
  businessCode: 'RLT' | 'JHN' | 'RTI';
  allowedStores: string[];
  uploadTitle: string;
  uploadDescription: string;
  dragDropTitle: string;
  readingLabel: string;
  previewLabel: string;
  searchPlaceholder: string;
  pageDescription: string;
};

export const SHOPEE_RLT_ALLOWED_STORE_NAMES = [
  'Roove Main Store - Marketplace',
  'Globite Store - Marketplace',
  'Pluve Main Store - Marketplace',
  'Purvu Store - Marketplace',
  'Purvu The Secret Store - Markerplace',
  'YUV Deodorant Serum Store - Marketplace',
  'Osgard Oil Store',
  'drHyun Main Store - Marketplace',
  'Calmara Main Store - Marketplace',
];

export const SHOPEE_JHN_ALLOWED_STORE_NAMES = [
  'Purvu Store',
  'Purvu The Secret Store',
  'drHyun Main Store',
  'Calmara Main Store',
];

export const TIKTOK_RTI_ALLOWED_STORE_NAMES = [
  'Roove Main Store - Marketplace',
  'Globite Store - Marketplace',
  'Pluve Main Store - Marketplace',
  'Purvu Store - Marketplace',
  'Purvu The Secret Store - Markerplace',
  'YUV Deodorant Serum Store - Marketplace',
  'Osgard Oil Store - Marketplace',
  'drHyun Main Store - Marketplace',
];

const MARKETPLACE_INTAKE_SOURCE_CONFIGS: Record<MarketplaceIntakeSourceKey, MarketplaceIntakeSourceConfig> = {
  shopee_rlt: {
    id: null,
    sourceKey: 'shopee_rlt',
    sourceLabel: 'Shopee RLT',
    platform: 'shopee',
    businessCode: 'RLT',
    allowedStores: SHOPEE_RLT_ALLOWED_STORE_NAMES,
    uploadTitle: 'Upload Shopee RLT',
    uploadDescription: 'Halaman ini hanya membaca export Shopee RLT. File yang namanya mengandung SPX tetap diperlakukan sebagai Shopee. App akan match exact SKU Excel ke bundle custom_id di business RLT, lalu menebak store dari nama bundle/produk. Jika belum yakin, warehouse bisa memilih store manual langsung di preview.',
    dragDropTitle: 'Drag & drop file Shopee RLT di sini',
    readingLabel: 'Membaca file Shopee RLT…',
    previewLabel: 'Preview Mapping Shopee RLT',
    searchPlaceholder: 'Cari bundle RLT…',
    pageDescription: 'Tahap pertama untuk jalur baru marketplace. Upload file Shopee RLT, lalu app akan match exact SKU Excel ke bundle custom_id di business RLT, lalu mencari store dari nama bundle/produk dan menaruh hasilnya ke workspace warehouse. Data baru dianggap valid downstream setelah warehouse memberi shipment date.',
  },
  shopee_jhn: {
    id: null,
    sourceKey: 'shopee_jhn',
    sourceLabel: 'Shopee JHN',
    platform: 'shopee',
    businessCode: 'JHN',
    allowedStores: SHOPEE_JHN_ALLOWED_STORE_NAMES,
    uploadTitle: 'Upload Shopee JHN',
    uploadDescription: 'Halaman ini hanya membaca export Shopee JHN. File yang namanya mengandung SPX tetap diperlakukan sebagai Shopee. App akan match exact SKU Excel ke bundle custom_id di business JHN, lalu menebak store dari nama bundle/produk. Jika belum yakin, warehouse bisa memilih store manual langsung di preview.',
    dragDropTitle: 'Drag & drop file Shopee JHN di sini',
    readingLabel: 'Membaca file Shopee JHN…',
    previewLabel: 'Preview Mapping Shopee JHN',
    searchPlaceholder: 'Cari bundle JHN…',
    pageDescription: 'Tahap pertama untuk jalur baru marketplace. Upload file Shopee JHN, lalu app akan match exact SKU Excel ke bundle custom_id di business JHN, lalu mencari store dari nama bundle/produk dan menaruh hasilnya ke workspace warehouse. Data baru dianggap valid downstream setelah warehouse memberi shipment date.',
  },
  tiktok_rti: {
    id: null,
    sourceKey: 'tiktok_rti',
    sourceLabel: 'Tiktok RTI',
    platform: 'tiktok',
    businessCode: 'RTI',
    allowedStores: TIKTOK_RTI_ALLOWED_STORE_NAMES,
    uploadTitle: 'Upload Tiktok RTI',
    uploadDescription: 'Halaman ini membaca export TikTok Shop/Tokopedia dari seller center RTI. App akan match SKU workbook ke bundle custom_id di business RTI, lalu menebak store final dari nama bundle/produk. Jika belum yakin, warehouse bisa memilih store manual langsung di preview.',
    dragDropTitle: 'Drag & drop file Tiktok RTI di sini',
    readingLabel: 'Membaca file Tiktok RTI…',
    previewLabel: 'Preview Mapping Tiktok RTI',
    searchPlaceholder: 'Cari bundle RTI…',
    pageDescription: 'Tahap pertama untuk jalur baru marketplace TikTok RTI. Upload workbook seller center, lalu app akan match SKU workbook ke bundle custom_id di business RTI, mencari store final dari nama bundle/produk, dan menaruh hasilnya ke workspace warehouse. Data baru dianggap valid downstream setelah warehouse memberi shipment date.',
  },
};

export function getMarketplaceIntakeSourceConfig(sourceKey?: string | null): MarketplaceIntakeSourceConfig {
  const normalizedKey = String(sourceKey || '').trim().toLowerCase() as MarketplaceIntakeSourceKey;
  return MARKETPLACE_INTAKE_SOURCE_CONFIGS[normalizedKey] || MARKETPLACE_INTAKE_SOURCE_CONFIGS.shopee_rlt;
}

export function listMarketplaceIntakeSourceConfigs(): MarketplaceIntakeSourceConfig[] {
  return Object.values(MARKETPLACE_INTAKE_SOURCE_CONFIGS);
}
