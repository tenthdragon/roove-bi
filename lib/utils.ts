// ============================================================
// Types
// ============================================================
export type UserRole = 'owner' | 'admin' | 'brand_manager' | 'pending';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  allowed_tabs: string[];
  allowed_products: string[];
}

export interface DailyProductSummary {
  date: string;
  product: string;
  net_sales: number;
  gross_profit: number;
  net_after_mkt: number;
  mkt_cost: number;
}

export interface DailyChannelData {
  date: string;
  product: string;
  channel: string;
  net_sales: number;
  gross_profit: number;
}

export interface DailyAdsSpend {
  date: string;
  ad_account: string;
  spent: number;
  source: string;
  store: string;
}

export interface MonthlyProductSummary {
  period_month: number;
  period_year: number;
  product: string;
  sales_after_disc: number;
  sales_pct: number;
  gross_profit: number;
  gross_profit_pct: number;
  gross_after_mkt: number;
  gmp_real: number;
  mkt_pct: number;
  mkt_share_pct: number;
}

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
}

// ============================================================
// Formatting
// ============================================================
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e9) return sign + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return sign + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return sign + (a / 1e3).toFixed(0) + 'K';
  return sign + a.toFixed(0);
}

export function fmtRupiah(n: number): string {
  return 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));
}

export function fmtPct(n: number, decimals = 1): string {
  return n.toFixed(decimals) + '%';
}

export function shortDate(d: string): string {
  const p = d.split('-');
  return `${parseInt(p[2])}/${parseInt(p[1])}`;
}

// ============================================================
// Constants
// ============================================================
export const CHANNEL_COLORS: Record<string, string> = {
  'Shopee': '#ee4d2d',
  'TikTok Shop': '#00f2ea',
  'Facebook Ads': '#1877f2',
  'Organik': '#10b981',
  'Reseller': '#f59e0b',
  'Lazada': '#0f1689',
  'Google Ads': '#ea4335',
  'Tokopedia': '#42b549',
  'BliBli': '#0066cc',
  'SnackVideo Ads': '#ff6600',
  'WhatsApp': '#25d366',
};

export const PRODUCT_COLORS: Record<string, string> = {
  'Roove': '#3b82f6',
  'Purvu': '#8b5cf6',
  'Pluve': '#06b6d4',
  'Osgard': '#f97316',
  'Dr Hyun': '#ec4899',
  'Globite': '#10b981',
  'Calmara': '#f59e0b',
  'Others': '#64748b',
  'Yuv': '#a78bfa',
  'Almona': '#94a3b8',
  'Orelif': '#fb923c',
  'Veminine': '#f472b6',
};

export interface TabDef {
  id: string;
  label: string;
  icon: string;
  ownerOnly?: boolean;
}

export const ALL_TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: 'LayoutDashboard' },
  { id: 'products', label: 'Produk', icon: 'Package' },
  { id: 'channels', label: 'Channel', icon: 'Share2' },
  { id: 'marketing', label: 'Marketing', icon: 'Megaphone' },
  { id: 'finance', label: 'Finance', icon: 'DollarSign' },
  { id: 'admin', label: 'Admin', icon: 'Settings', ownerOnly: true },
];

export type TabId = string;

// Check if user can access a tab
export function canAccessTab(profile: Profile, tabId: string): boolean {
  if (profile.role === 'pending') return false;
  if (profile.role === 'owner' || profile.role === 'admin') return true;
  if (tabId === 'admin') return false;
  if (profile.allowed_tabs.length === 0) return true; // no restriction = all tabs
  return profile.allowed_tabs.includes(tabId);
}

// Check if user can access a product
export function canAccessProduct(profile: Profile, product: string): boolean {
  if (profile.role === 'owner' || profile.role === 'admin') return true;
  if (profile.allowed_products.length === 0) return true;
  return profile.allowed_products.includes(product);
}

// Preset date ranges
export function getPresetRanges() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const todayStr = `${yyyy}-${mm}-${dd}`;

  const d7 = new Date(today);
  d7.setDate(d7.getDate() - 7);
  const d30 = new Date(today);
  d30.setDate(d30.getDate() - 30);
  const d90 = new Date(today);
  d90.setDate(d90.getDate() - 90);

  const fmtD = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const monthStart = `${yyyy}-${mm}-01`;

  return [
    { label: 'Hari Ini', from: todayStr, to: todayStr },
    { label: '7 Hari', from: fmtD(d7), to: todayStr },
    { label: 'Bulan Ini', from: monthStart, to: todayStr },
    { label: '30 Hari', from: fmtD(d30), to: todayStr },
    { label: '90 Hari', from: fmtD(d90), to: todayStr },
  ];
}
