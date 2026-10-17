// Display formatting shared by the Meta Ads pages. Pure and locale-fixed (id-ID).
import type { FunnelMetric } from './meta-funnel-domain';

export function formatMetric(value: number | null | undefined, kind: FunnelMetric['format'], currency: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (kind === 'percent') return `${(value * 100).toFixed(2)}%`;
  if (kind === 'multiple') return `${value.toFixed(2)}×`;
  return new Intl.NumberFormat('id-ID', kind === 'money' ? { style: 'currency', currency, maximumFractionDigits: 0 } : { maximumFractionDigits: 1 }).format(value);
}
/** Rp 142,5 jt style amounts for dense tables; other currencies use compact Intl notation. */
export function formatCompactMoney(value: number | null | undefined, currency: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (currency !== 'IDR') return new Intl.NumberFormat('id-ID', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value);
  const abs = Math.abs(value);
  const unit = abs >= 1e9 ? ['M', 1e9] as const : abs >= 1e6 ? ['jt', 1e6] as const : abs >= 1e3 ? ['rb', 1e3] as const : null;
  if (!unit) return `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value)}`;
  const scaled = value / unit[1];
  return `Rp ${new Intl.NumberFormat('id-ID', { maximumFractionDigits: abs / unit[1] >= 100 ? 0 : 1 }).format(scaled)} ${unit[0]}`;
}
export function formatChange(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}
export function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value);
}
export function formatDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}
