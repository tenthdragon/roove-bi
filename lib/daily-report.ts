// lib/daily-report.ts — Telegram report builders (daily + monthly)
import { createClient } from '@supabase/supabase-js';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ── Helpers ──

function todayWIB(): string {
  const wib = new Date(Date.now() + 7 * 3600_000);
  return fmtDate(wib);
}

function yesterdayWIB(): string {
  const wib = new Date(Date.now() + 7 * 3600_000);
  wib.setDate(wib.getDate() - 1);
  return fmtDate(wib);
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function monthStart(dateStr: string): string { return dateStr.slice(0, 7) + '-01'; }

function monthEnd(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return fmtDate(end);
}

function prevMonthRange(dateStr: string): { from: string; to: string } {
  const d = new Date(dateStr + 'T00:00:00');
  const prevEnd = new Date(d.getFullYear(), d.getMonth(), 0);
  const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1);
  return { from: fmtDate(prevStart), to: fmtDate(prevEnd) };
}

function wibRangeToUtc(from: string, to: string): { utcFrom: string; utcTo: string } {
  const utcFrom = new Date(from + 'T00:00:00+07:00').toISOString();
  const toDate = new Date(to + 'T00:00:00+07:00');
  toDate.setDate(toDate.getDate() + 1);
  return { utcFrom, utcTo: toDate.toISOString() };
}

function fmtRp(n: number): string {
  if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `Rp ${(n / 1e3).toFixed(0)}K`;
  return `Rp ${n.toFixed(0)}`;
}

function fmtPct(n: number): string { return `${n.toFixed(1)}%`; }

function fmtDelta(val: number, ref: number, isPp: boolean): string {
  if (ref === 0) return '-';
  if (isPp) {
    const d = val - ref;
    return `${d >= 0 ? '+' : ''}${d.toFixed(1)}pp`;
  }
  const d = ((val - ref) / Math.abs(ref)) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}

function fmtNum(n: number): string { return n.toLocaleString('id-ID'); }

const SCALEV_ADS_CHANNEL = 'Scalev Ads';
const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
}

function monthLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return `${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
}

// ── Data fetching ──

async function fetchProductSummary(svc: any, from: string, to: string) {
  const { data, error } = await svc.from('summary_daily_product_complete')
    .select('date, net_sales, net_after_mkt, mkt_cost').gte('date', from).lte('date', to).limit(5000);
  if (error) console.error('[report] fetchProductSummary error:', error);
  return data || [];
}

async function fetchChannelSummary(svc: any, from: string, to: string) {
  const { data, error } = await svc.from('summary_daily_order_channel')
    .select('date, channel, net_sales').gte('date', from).lte('date', to).limit(5000);
  if (error) console.error('[report] fetchChannelSummary error:', error);
  return data || [];
}

async function fetchShipmentCount(svc: any, from: string, to: string): Promise<number> {
  const { utcFrom, utcTo } = wibRangeToUtc(from, to);
  const { count, error } = await svc.from('scalev_orders')
    .select('id', { count: 'exact', head: true })
    .in('status', ['shipped', 'completed'])
    .gte('shipped_time', utcFrom).lt('shipped_time', utcTo);
  if (error) console.error('[report] fetchShipmentCount error:', error);
  return count || 0;
}

async function fetchMetaAdsSpend(svc: any, from: string, to: string) {
  const { data, error } = await svc.from('daily_ads_spend')
    .select('date, spent').gte('date', from).lte('date', to)
    .eq('source', 'Facebook Ads').limit(5000);
  if (error) console.error('[report] fetchMetaAdsSpend error:', error);
  const byDate: Record<string, number> = {};
  for (const r of data || []) byDate[r.date] = (byDate[r.date] || 0) + Number(r.spent);
  return byDate;
}

async function fetchMetaAdsTotal(svc: any, from: string, to: string): Promise<number> {
  const { data, error } = await svc.from('daily_ads_spend')
    .select('spent').gte('date', from).lte('date', to)
    .eq('source', 'Facebook Ads').limit(5000);
  if (error) console.error('[report] fetchMetaAdsTotal error:', error);
  return (data || []).reduce((a: number, r: any) => a + Number(r.spent), 0);
}

async function fetchCRForRange(svc: any, from: string, to: string): Promise<{ created: number; shipped: number }> {
  const { utcFrom, utcTo } = wibRangeToUtc(from, to);

  const { count: created, error: cErr } = await svc.from('scalev_orders')
    .select('id', { count: 'exact', head: true })
    .gte('pending_time', utcFrom).lt('pending_time', utcTo)
    .in('status', ['pending', 'draft', 'confirmed', 'paid', 'in_process', 'ready', 'shipped', 'completed', 'rts'])
    .not('store_name', 'ilike', '%marketplace%')
    .not('store_name', 'ilike', '%shopee%')
    .not('store_name', 'ilike', '%tiktok%');
  if (cErr) console.error('[report] CR created error:', cErr);

  const { count: shipped, error: sErr } = await svc.from('scalev_orders')
    .select('id', { count: 'exact', head: true })
    .gte('shipped_time', utcFrom).lt('shipped_time', utcTo)
    .in('status', ['shipped', 'completed'])
    .not('store_name', 'ilike', '%marketplace%')
    .not('store_name', 'ilike', '%shopee%')
    .not('store_name', 'ilike', '%tiktok%');
  if (sErr) console.error('[report] CR shipped error:', sErr);

  return { created: created || 0, shipped: shipped || 0 };
}

// ── Compute range totals ──

interface RangeTotals { ns: number; nam: number; mkt: number; meta: number; scalev: number; activeDays: number }

function computeRange(from: string, to: string, productRows: any[], channelRows: any[], metaByDate: Record<string, number>): RangeTotals {
  const dates = [...new Set(productRows.filter(r => r.date >= from && r.date <= to && Number(r.net_sales) > 0).map(r => r.date))].sort();
  const n = dates.length;
  if (!n) return { ns: 0, nam: 0, mkt: 0, meta: 0, scalev: 0, activeDays: 0 };

  let tns = 0, tnam = 0, tmkt = 0, tmeta = 0, tscalev = 0;
  for (const d of dates) {
    const dp = productRows.filter(r => r.date === d);
    const dc = channelRows.filter(r => r.date === d);
    tns += dp.reduce((a: number, r: any) => a + Number(r.net_sales), 0);
    tnam += dp.reduce((a: number, r: any) => a + Number(r.net_after_mkt), 0);
    tmkt += dp.reduce((a: number, r: any) => a + Number(r.mkt_cost), 0);
    tmeta += metaByDate[d] || 0;
    tscalev += dc.filter((r: any) => r.channel === SCALEV_ADS_CHANNEL).reduce((a: number, r: any) => a + Number(r.net_sales), 0);
  }
  return { ns: tns, nam: tnam, mkt: tmkt, meta: tmeta, scalev: tscalev, activeDays: n };
}

// ── KPI struct ──

interface KPIs {
  ns: number; nam: number; gpm: number; ship: number; aov: number;
  mktPct: number; roas: number; crPct: number; crShipped: number; crCreated: number;
  activeDays: number;
}

function deriveKPIs(r: RangeTotals, ship: number, cr: { created: number; shipped: number }): KPIs {
  return {
    ns: r.ns, nam: r.nam,
    gpm: r.ns > 0 ? (r.nam / r.ns) * 100 : 0,
    ship,
    aov: ship > 0 ? r.ns / ship : 0,
    mktPct: r.ns > 0 ? (r.mkt / r.ns) * 100 : 0,
    roas: r.meta > 0 ? r.scalev / r.meta : 0,
    crPct: cr.created > 0 ? (cr.shipped / cr.created) * 100 : 0,
    crShipped: cr.shipped, crCreated: cr.created,
    activeDays: r.activeDays,
  };
}

function avgKPIs(k: KPIs): { ns: number; nam: number; gpm: number; ship: number; aov: number; mktPct: number; roas: number; crPct: number } {
  const n = k.activeDays || 1;
  return {
    ns: k.ns / n, nam: k.nam / n, gpm: k.gpm, ship: k.ship / n, aov: k.aov,
    mktPct: k.mktPct, roas: k.roas, crPct: k.crPct,
  };
}

// ════════════════════════════════════════════
//  /report — Daily report (yesterday vs avg this month)
// ════════════════════════════════════════════

export async function buildDailyReport(): Promise<string> {
  // @ts-ignore
  buildDailyReport._debug = {};
  const svc = getServiceSupabase();
  const yesterday = yesterdayWIB();
  const mFrom = monthStart(yesterday);

  const [productRows, channelRows, metaByDate, shipYd, shipThis, crYd, crThis] = await Promise.all([
    fetchProductSummary(svc, mFrom, yesterday),
    fetchChannelSummary(svc, mFrom, yesterday),
    fetchMetaAdsSpend(svc, mFrom, yesterday),
    fetchShipmentCount(svc, yesterday, yesterday),
    fetchShipmentCount(svc, mFrom, yesterday),
    fetchCRForRange(svc, yesterday, yesterday),
    fetchCRForRange(svc, mFrom, yesterday),
  ]);

  // @ts-ignore
  buildDailyReport._debug = { yesterday, shipYd, shipThis, crYd, crThis };

  const ydR = computeRange(yesterday, yesterday, productRows, channelRows, metaByDate);
  const yd = deriveKPIs(ydR, shipYd, crYd);

  const thisR = computeRange(mFrom, yesterday, productRows, channelRows, metaByDate);
  const avg = avgKPIs(deriveKPIs(thisR, shipThis, crThis));

  return [
    `📊 <b>Daily Report — ${dateLabel(yesterday)}</b>`,
    '',
    `💰 <b>Net Sales:</b> ${fmtRp(yd.ns)} | ${fmtDelta(yd.ns, avg.ns, false)} vs avg`,
    `📈 <b>GP Margin:</b> ${fmtPct(yd.gpm)} | ${fmtDelta(yd.gpm, avg.gpm, true)} vs avg`,
    `💵 <b>GP AMA:</b> ${fmtRp(yd.nam)} | ${fmtDelta(yd.nam, avg.nam, false)} vs avg`,
    `📦 <b>Shipment:</b> ${fmtNum(yd.ship)} | ${fmtDelta(yd.ship, avg.ship, false)} vs avg`,
    `🛒 <b>AOV:</b> ${fmtRp(yd.aov)} | ${fmtDelta(yd.aov, avg.aov, false)} vs avg`,
    `📣 <b>Mkt Fee %:</b> ${fmtPct(yd.mktPct)} | ${fmtDelta(yd.mktPct, avg.mktPct, true)} vs avg`,
    `📱 <b>ROAS Meta Ads:</b> ${yd.roas.toFixed(2)}x | ${fmtDelta(yd.roas, avg.roas, false)} vs avg`,
    `✅ <b>CR Scalev *):</b> ${fmtNum(yd.crShipped)}/${fmtNum(yd.crCreated)} (${fmtPct(yd.crPct)}) | ${fmtDelta(yd.crPct, avg.crPct, true)} vs avg`,
    '',
    `<i>*) same-day proxy | avg = avg active daily ${monthLabel(mFrom)}</i>`,
  ].join('\n');
}

// ════════════════════════════════════════════
//  /monthly — This month MTD vs last month full
// ════════════════════════════════════════════

export async function buildMonthlyReport(): Promise<string> {
  const svc = getServiceSupabase();
  const today = todayWIB();
  const mFrom = monthStart(today);
  const mEnd = monthEnd(today);
  const mTo = yesterdayWIB(); // MTD = up to yesterday
  const prev = prevMonthRange(today);
  const prevDaysTotal = new Date(prev.to + 'T00:00:00').getDate(); // total days in prev month

  const [productRows, channelRows, metaByDate, shipThis, shipPrev, crThis, crPrev] = await Promise.all([
    fetchProductSummary(svc, prev.from, mTo),
    fetchChannelSummary(svc, prev.from, mTo),
    fetchMetaAdsSpend(svc, prev.from, mTo),
    fetchShipmentCount(svc, mFrom, mTo),
    fetchShipmentCount(svc, prev.from, prev.to),
    fetchCRForRange(svc, mFrom, mTo),
    fetchCRForRange(svc, prev.from, prev.to),
  ]);

  const thisR = computeRange(mFrom, mTo, productRows, channelRows, metaByDate);
  const thisK = deriveKPIs(thisR, shipThis, crThis);
  const thisAvg = avgKPIs(thisK);

  const prevR = computeRange(prev.from, prev.to, productRows, channelRows, metaByDate);
  const prevK = deriveKPIs(prevR, shipPrev, crPrev);
  const prevAvg = avgKPIs(prevK);

  // Projection: (MTD total / active days) * total days in this month
  const totalDaysThisMonth = new Date(new Date(mFrom + 'T00:00:00').getFullYear(), new Date(mFrom + 'T00:00:00').getMonth() + 1, 0).getDate();
  const projNs = thisK.activeDays > 0 ? (thisK.ns / thisK.activeDays) * totalDaysThisMonth : 0;
  const projNam = thisK.activeDays > 0 ? (thisK.nam / thisK.activeDays) * totalDaysThisMonth : 0;

  return [
    `📅 <b>Monthly Report — ${monthLabel(mFrom)}</b>`,
    `<i>MTD: ${dateLabel(mFrom)} s/d ${dateLabel(mTo)} (${thisK.activeDays} active days)</i>`,
    '',
    `<b>── MTD vs ${monthLabel(prev.from)} (full ${prevK.activeDays} days) ──</b>`,
    '',
    `💰 <b>Net Sales</b>`,
    `   MTD: ${fmtRp(thisK.ns)} | Prev: ${fmtRp(prevK.ns)}`,
    `   Avg/day: ${fmtRp(thisAvg.ns)} | ${fmtDelta(thisAvg.ns, prevAvg.ns, false)} vs prev avg`,
    `   Proyeksi: ${fmtRp(projNs)} (${fmtDelta(projNs, prevK.ns, false)} vs prev full)`,
    '',
    `📈 <b>GP Margin:</b> ${fmtPct(thisK.gpm)} | ${fmtDelta(thisK.gpm, prevK.gpm, true)} vs prev`,
    '',
    `💵 <b>GP After Mkt+Adm</b>`,
    `   MTD: ${fmtRp(thisK.nam)} | Prev: ${fmtRp(prevK.nam)}`,
    `   Avg/day: ${fmtRp(thisAvg.nam)} | ${fmtDelta(thisAvg.nam, prevAvg.nam, false)} vs prev avg`,
    `   Proyeksi: ${fmtRp(projNam)} (${fmtDelta(projNam, prevK.nam, false)} vs prev full)`,
    '',
    `📦 <b>Shipment</b>`,
    `   MTD: ${fmtNum(thisK.ship)} | Prev: ${fmtNum(prevK.ship)}`,
    `   Avg/day: ${fmtNum(Math.round(thisAvg.ship))} | ${fmtDelta(thisAvg.ship, prevAvg.ship, false)} vs prev avg`,
    '',
    `🛒 <b>AOV:</b> ${fmtRp(thisK.aov)} | ${fmtDelta(thisK.aov, prevK.aov, false)} vs prev`,
    '',
    `📣 <b>Mkt Fee %:</b> ${fmtPct(thisK.mktPct)} | ${fmtDelta(thisK.mktPct, prevK.mktPct, true)} vs prev`,
    '',
    `📱 <b>ROAS Meta Ads:</b> ${thisK.roas.toFixed(2)}x | ${fmtDelta(thisK.roas, prevK.roas, false)} vs prev`,
    '',
    `✅ <b>CR Scalev *):</b> ${fmtNum(thisK.crShipped)}/${fmtNum(thisK.crCreated)} (${fmtPct(thisK.crPct)}) | ${fmtDelta(thisK.crPct, prevK.crPct, true)} vs prev`,
  ].join('\n');
}
