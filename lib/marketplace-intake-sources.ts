export type MarketplaceIntakeSourceKey =
  | 'shopee_rlt'
  | 'shopee_jhn'
  | 'tiktok_rti'
  | 'tiktok_jhn'
  | 'blibli_rti'
  | 'lazada_rlt';
export type MarketplaceIntakePlatform = 'shopee' | 'tiktok' | 'blibli' | 'lazada';
export type MarketplaceIntakeParserFamily = 'shopee' | 'tiktok' | 'none';

export type MarketplaceIntakeSourceConfig = {
  id: number | null;
  sourceKey: MarketplaceIntakeSourceKey;
  sourceLabel: string;
  platform: MarketplaceIntakePlatform;
  parserFamily: MarketplaceIntakeParserFamily;
  uploadEnabled: boolean;
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

export const JHN_ALLOWED_STORE_NAMES = [
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

export const BLIBLI_RTI_ALLOWED_STORE_NAMES = [
  'Roove Main Store - Marketplace',
  'Globite Store - Marketplace',
  'Pluve Main Store - Marketplace',
  'Purvu Store - Marketplace',
  'Purvu The Secret Store - Markerplace',
];

export const LAZADA_RLT_ALLOWED_STORE_NAMES = [
  'Roove Main Store - Marketplace',
  'Globite Store - Marketplace',
  'Pluve Main Store - Marketplace',
  'Purvu Store - Marketplace',
  'Purvu The Secret Store - Markerplace',
  'Osgard Oil Store',
];

const MARKETPLACE_INTAKE_SOURCE_CONFIGS: Record<MarketplaceIntakeSourceKey, MarketplaceIntakeSourceConfig> = {
  shopee_rlt: {
    id: null,
    sourceKey: 'shopee_rlt',
    sourceLabel: 'Shopee RLT',
    platform: 'shopee',
    parserFamily: 'shopee',
    uploadEnabled: true,
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
    parserFamily: 'shopee',
    uploadEnabled: true,
    businessCode: 'JHN',
    allowedStores: JHN_ALLOWED_STORE_NAMES,
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
    parserFamily: 'tiktok',
    uploadEnabled: true,
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
  tiktok_jhn: {
    id: null,
    sourceKey: 'tiktok_jhn',
    sourceLabel: 'Tiktok JHN',
    platform: 'tiktok',
    parserFamily: 'tiktok',
    uploadEnabled: true,
    businessCode: 'JHN',
    allowedStores: JHN_ALLOWED_STORE_NAMES,
    uploadTitle: 'Upload Tiktok JHN',
    uploadDescription: 'Halaman ini membaca export TikTok Shop seller center JHN. App akan match SKU workbook ke bundle custom_id di business JHN, lalu menebak store final dari nama bundle/produk. Jika belum yakin, warehouse bisa memilih store manual langsung di preview.',
    dragDropTitle: 'Drag & drop file Tiktok JHN di sini',
    readingLabel: 'Membaca file Tiktok JHN…',
    previewLabel: 'Preview Mapping Tiktok JHN',
    searchPlaceholder: 'Cari bundle JHN…',
    pageDescription: 'Tahap pertama untuk jalur baru marketplace TikTok JHN. Upload workbook seller center, lalu app akan match SKU workbook ke bundle custom_id di business JHN, mencari store final dari nama bundle/produk, dan menaruh hasilnya ke workspace warehouse. Data baru dianggap valid downstream setelah warehouse memberi shipment date.',
  },
  blibli_rti: {
    id: null,
    sourceKey: 'blibli_rti',
    sourceLabel: 'Blibli RTI',
    platform: 'blibli',
    parserFamily: 'none',
    uploadEnabled: false,
    businessCode: 'RTI',
    allowedStores: BLIBLI_RTI_ALLOWED_STORE_NAMES,
    uploadTitle: 'Upload Blibli RTI',
    uploadDescription: 'Source ini sudah terdaftar untuk reference dan store scope RTI, tetapi parser upload intake belum diaktifkan.',
    dragDropTitle: 'Upload Blibli RTI belum aktif',
    readingLabel: 'Parser Blibli RTI belum aktif…',
    previewLabel: 'Preview Mapping Blibli RTI',
    searchPlaceholder: 'Cari bundle RTI…',
    pageDescription: 'Source Blibli RTI sudah terdaftar untuk kebutuhan reference, store scope, dan resolver rules. Jalur parsing upload akan diaktifkan menyusul.',
  },
  lazada_rlt: {
    id: null,
    sourceKey: 'lazada_rlt',
    sourceLabel: 'Lazada RLT',
    platform: 'lazada',
    parserFamily: 'none',
    uploadEnabled: false,
    businessCode: 'RLT',
    allowedStores: LAZADA_RLT_ALLOWED_STORE_NAMES,
    uploadTitle: 'Upload Lazada RLT',
    uploadDescription: 'Source ini sudah terdaftar untuk reference dan store scope RLT, tetapi parser upload intake belum diaktifkan.',
    dragDropTitle: 'Upload Lazada RLT belum aktif',
    readingLabel: 'Parser Lazada RLT belum aktif…',
    previewLabel: 'Preview Mapping Lazada RLT',
    searchPlaceholder: 'Cari bundle RLT…',
    pageDescription: 'Source Lazada RLT sudah terdaftar untuk kebutuhan reference, store scope, dan resolver rules. Jalur parsing upload akan diaktifkan menyusul.',
  },
};

export function getMarketplaceIntakeSourceConfig(sourceKey?: string | null): MarketplaceIntakeSourceConfig {
  const normalizedKey = String(sourceKey || '').trim().toLowerCase() as MarketplaceIntakeSourceKey;
  return MARKETPLACE_INTAKE_SOURCE_CONFIGS[normalizedKey] || MARKETPLACE_INTAKE_SOURCE_CONFIGS.shopee_rlt;
}

export function listMarketplaceIntakeSourceConfigs(): MarketplaceIntakeSourceConfig[] {
  return Object.values(MARKETPLACE_INTAKE_SOURCE_CONFIGS);
}

export function listMarketplaceIntakeUploadSourceConfigs(): MarketplaceIntakeSourceConfig[] {
  return listMarketplaceIntakeSourceConfigs().filter((config) => config.uploadEnabled);
}
