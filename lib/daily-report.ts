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
  return fmtDate(new Date(Date.now() + 7 * 3600_000));
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
  return fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function prevMonthRange(dateStr: string): { from: string; to: string } {
  const d = new Date(dateStr + 'T00:00:00');
  const prevEnd = new Date(d.getFullYear(), d.getMonth(), 0);
  const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1);
  return { from: fmtDate(prevStart), to: fmtDate(prevEnd) };
}

/** Count calendar days between two YYYY-MM-DD dates (inclusive) */
function calendarDays(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86400_000) + 1;
}

function daysInMonth(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
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

function fmtDelta(val: number, ref: number, isPp: boolean, invertColor: boolean = false): string {
  if (ref === 0) return '-';
  let d: number, suffix: string;
  if (isPp) { d = val - ref; suffix = 'pp'; }
  else { d = ((val - ref) / Math.abs(ref)) * 100; suffix = '%'; }
  const isPositive = invertColor ? d <= 0 : d >= 0;
  const arrow = d === 0 ? '▸' : isPositive ? '🟢' : '🔴';
  return `${arrow} ${d >= 0 ? '+' : ''}${d.toFixed(1)}${suffix}`;
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

async function fetchCRForRange(svc: any, from: string, to: string): Promise<{ created: number; shipped: number }> {
  const { utcFrom, utcTo } = wibRangeToUtc(from, to);

  // Query total, then subtract marketplace (avoids .not() chaining issues on Vercel)
  const { count: totalCreated, error: cErr1 } = await svc.from('scalev_orders')
    .select('id', { count: 'exact', head: true })
    .gte('draft_time', utcFrom).lt('draft_time', utcTo);
  if (cErr1) console.error('[report] CR totalCreated error:', cErr1);

  const { count: mpCreated, error: cErr2 } = await svc.from('scalev_orders')
    .select('id', { count: 'exact', head: true })
    .gte('draft_time', utcFrom).lt('draft_time', utcTo)
    .or('store_name.ilike.%marketplace%,store_name.ilike.%shopee%,store_name.ilike.%tiktok%');
  if (cErr2) console.error('[report] CR mpCreated error:', cErr2);

  const { count: totalShipped, error: sErr1 } = await svc.from('scalev_orders')
    .select('id', { count: 'exact', head: true })
    .gte('shipped_time', utcFrom).lt('shipped_time', utcTo)
    .in('status', ['shipped', 'completed']);
  if (sErr1) console.error('[report] CR totalShipped error:', sErr1);

  const { count: mpShipped, error: sErr2 } = await svc.from('scalev_orders')
    .select('id', { count: 'exact', head: true })
    .gte('shipped_time', utcFrom).lt('shipped_time', utcTo)
    .in('status', ['shipped', 'completed'])
    .or('store_name.ilike.%marketplace%,store_name.ilike.%shopee%,store_name.ilike.%tiktok%');
  if (sErr2) console.error('[report] CR mpShipped error:', sErr2);

  const created = (totalCreated || 0) - (mpCreated || 0);
  const shipped = (totalShipped || 0) - (mpShipped || 0);
  return { created, shipped };
}

// ── Compute range totals ──

interface RangeTotals { ns: number; nam: number; mkt: number; meta: number; scalev: number }

function computeRange(from: string, to: string, productRows: any[], channelRows: any[], metaByDate: Record<string, number>): RangeTotals {
  const rows = productRows.filter(r => r.date >= from && r.date <= to);
  let tns = 0, tnam = 0, tmkt = 0, tmeta = 0, tscalev = 0;
  const dates = [...new Set(rows.map(r => r.date))];
  for (const d of dates) {
    const dp = rows.filter(r => r.date === d);
    const dc = channelRows.filter(r => r.date === d);
    tns += dp.reduce((a: number, r: any) => a + Number(r.net_sales), 0);
    tnam += dp.reduce((a: number, r: any) => a + Number(r.net_after_mkt), 0);
    tmkt += dp.reduce((a: number, r: any) => a + Number(r.mkt_cost), 0);
    tmeta += metaByDate[d] || 0;
    tscalev += dc.filter((r: any) => r.channel === SCALEV_ADS_CHANNEL).reduce((a: number, r: any) => a + Number(r.net_sales), 0);
  }
  return { ns: tns, nam: tnam, mkt: tmkt, meta: tmeta, scalev: tscalev };
}

// ════════════════════════════════════════════
//  /report — Daily report (yesterday vs daily avg this month)
// ════════════════════════════════════════════

export async function buildDailyReport(): Promise<string> {
  // @ts-ignore
  buildDailyReport._debug = {};
  const svc = getServiceSupabase();
  const yd = yesterdayWIB();
  const mFrom = monthStart(yd);
  const days = calendarDays(mFrom, yd); // calendar days in MTD

  // Batch 1: summary tables (lightweight)
  const [productRows, channelRows, metaByDate] = await Promise.all([
    fetchProductSummary(svc, mFrom, yd),
    fetchChannelSummary(svc, mFrom, yd),
    fetchMetaAdsSpend(svc, mFrom, yd),
  ]);

  // Batch 2: shipment counts
  const [shipYd, shipMtd] = await Promise.all([
    fetchShipmentCount(svc, yd, yd),
    fetchShipmentCount(svc, mFrom, yd),
  ]);

  // Batch 3: CR counts (each does 2 internal queries — run sequentially)
  const crYd = await fetchCRForRange(svc, yd, yd);
  const crMtd = await fetchCRForRange(svc, mFrom, yd);

  // @ts-ignore
  buildDailyReport._debug = { yesterday: yd, days, shipYd, shipMtd, crYd, crMtd };

  const ydR = computeRange(yd, yd, productRows, channelRows, metaByDate);
  const mtdR = computeRange(mFrom, yd, productRows, channelRows, metaByDate);

  // Yesterday KPIs
  const gpm = ydR.ns > 0 ? (ydR.nam / ydR.ns) * 100 : 0;
  const aov = shipYd > 0 ? ydR.ns / shipYd : 0;
  const mktPct = ydR.ns > 0 ? (ydR.mkt / ydR.ns) * 100 : 0;
  const roas = ydR.meta > 0 ? ydR.scalev / ydR.meta : 0;
  const crPct = crYd.created > 0 ? (crYd.shipped / crYd.created) * 100 : 0;

  // MTD daily avg (calendar days)
  const avg = {
    ns: mtdR.ns / days, nam: mtdR.nam / days,
    gpm: mtdR.ns > 0 ? (mtdR.nam / mtdR.ns) * 100 : 0,
    ship: shipMtd / days, aov: shipMtd > 0 ? mtdR.ns / shipMtd : 0,
    mktPct: mtdR.ns > 0 ? (mtdR.mkt / mtdR.ns) * 100 : 0,
    roas: mtdR.meta > 0 ? mtdR.scalev / mtdR.meta : 0,
    crPct: crMtd.created > 0 ? (crMtd.shipped / crMtd.created) * 100 : 0,
  };

  return [
    `📊 <b>Daily Report — ${dateLabel(yd)}</b>`,
    `<i>vs daily avg ${monthLabel(mFrom)} (${days} days)</i>`,
    '',
    `💰 <b>Net Sales:</b> ${fmtRp(ydR.ns)} ${fmtDelta(ydR.ns, avg.ns, false)}`,
    `📈 <b>GP Margin:</b> ${fmtPct(gpm)} ${fmtDelta(gpm, avg.gpm, true)}`,
    `💵 <b>GP AMA:</b> ${fmtRp(ydR.nam)} ${fmtDelta(ydR.nam, avg.nam, false)}`,
    `📦 <b>Shipment:</b> ${fmtNum(shipYd)} ${fmtDelta(shipYd, avg.ship, false)}`,
    `🛒 <b>AOV:</b> ${fmtRp(aov)} ${fmtDelta(aov, avg.aov, false)}`,
    `📣 <b>Mkt Fee %:</b> ${fmtPct(mktPct)} ${fmtDelta(mktPct, avg.mktPct, true, true)}`,
    `📱 <b>ROAS Meta:</b> ${roas.toFixed(2)}x ${fmtDelta(roas, avg.roas, false)}`,
    `✅ <b>CR Scalev *):</b> ${fmtNum(crYd.shipped)}/${fmtNum(crYd.created)} (${fmtPct(crPct)}) ${fmtDelta(crPct, avg.crPct, true)}`,
    '',
    `<i>*) same-day proxy</i>`,
  ].join('\n');
}

// ════════════════════════════════════════════
//  /monthly — This month MTD vs last month full
// ════════════════════════════════════════════

export interface MonthlyReportResult {
  message: string;
  thisMonthFrom: string;
  thisMonthTo: string;
  prevMonthFrom: string;
  prevMonthTo: string;
}

export async function buildMonthlyReport(): Promise<MonthlyReportResult> {
  const svc = getServiceSupabase();
  const mTo = yesterdayWIB();
  const mFrom = monthStart(mTo);
  const prev = prevMonthRange(mTo);
  const mtdDays = calendarDays(mFrom, mTo);
  const prevDays = calendarDays(prev.from, prev.to);
  const totalDaysThisMonth = daysInMonth(mFrom);

  // Fetch summary data first (lightweight)
  const [productRows, channelRows, metaByDate] = await Promise.all([
    fetchProductSummary(svc, prev.from, mTo),
    fetchChannelSummary(svc, prev.from, mTo),
    fetchMetaAdsSpend(svc, prev.from, mTo),
  ]);

  // Fetch counts separately to avoid concurrent connection limits
  const [shipThis, shipPrev] = await Promise.all([
    fetchShipmentCount(svc, mFrom, mTo),
    fetchShipmentCount(svc, prev.from, prev.to),
  ]);
  // CR queries each do 2 internal parallel calls — run sequentially to avoid connection limits
  const crThis = await fetchCRForRange(svc, mFrom, mTo);
  const crPrev = await fetchCRForRange(svc, prev.from, prev.to);

  const thisR = computeRange(mFrom, mTo, productRows, channelRows, metaByDate);
  const prevR = computeRange(prev.from, prev.to, productRows, channelRows, metaByDate);

  // Avg per calendar day
  const thisAvg = { ns: thisR.ns / mtdDays, nam: thisR.nam / mtdDays, ship: shipThis / mtdDays };
  const prevAvg = { ns: prevR.ns / prevDays, nam: prevR.nam / prevDays, ship: shipPrev / prevDays };

  // Projections (based on calendar day avg)
  const projNs = thisAvg.ns * totalDaysThisMonth;
  const projNam = thisAvg.nam * totalDaysThisMonth;
  const projShip = Math.round(thisAvg.ship * totalDaysThisMonth);

  // Ratio KPIs
  const thisGpm = thisR.ns > 0 ? (thisR.nam / thisR.ns) * 100 : 0;
  const prevGpm = prevR.ns > 0 ? (prevR.nam / prevR.ns) * 100 : 0;
  const thisAov = shipThis > 0 ? thisR.ns / shipThis : 0;
  const prevAov = shipPrev > 0 ? prevR.ns / shipPrev : 0;
  const thisMktPct = thisR.ns > 0 ? (thisR.mkt / thisR.ns) * 100 : 0;
  const prevMktPct = prevR.ns > 0 ? (prevR.mkt / prevR.ns) * 100 : 0;
  const thisRoas = thisR.meta > 0 ? thisR.scalev / thisR.meta : 0;
  const prevRoas = prevR.meta > 0 ? prevR.scalev / prevR.meta : 0;
  const thisCr = crThis.created > 0 ? (crThis.shipped / crThis.created) * 100 : 0;
  const prevCr = crPrev.created > 0 ? (crPrev.shipped / crPrev.created) * 100 : 0;

  const msg = [
    `📅 <b>Monthly Report — ${monthLabel(mFrom)}</b>`,
    `<i>MTD: ${dateLabel(mFrom)} – ${dateLabel(mTo)} (${mtdDays} days)</i>`,
    `<i>vs ${monthLabel(prev.from)} (${prevDays} days)</i>`,
    '',
    `<b>━━ Revenue & Profit ━━</b>`,
    '',
    `💰 <b>Net Sales</b>`,
    `     MTD  ${fmtRp(thisR.ns)}  ·  Prev  ${fmtRp(prevR.ns)}`,
    `     Avg/day  ${fmtRp(thisAvg.ns)}  ${fmtDelta(thisAvg.ns, prevAvg.ns, false)}`,
    `     Proyeksi  ${fmtRp(projNs)}  ${fmtDelta(projNs, prevR.ns, false)}`,
    '',
    `💵 <b>GP AMA</b>`,
    `     MTD  ${fmtRp(thisR.nam)}  ·  Prev  ${fmtRp(prevR.nam)}`,
    `     Avg/day  ${fmtRp(thisAvg.nam)}  ${fmtDelta(thisAvg.nam, prevAvg.nam, false)}`,
    `     Proyeksi  ${fmtRp(projNam)}  ${fmtDelta(projNam, prevR.nam, false)}`,
    '',
    `📈 <b>GP Margin</b>  ${fmtPct(thisGpm)}  ${fmtDelta(thisGpm, prevGpm, true)}`,
    '',
    `<b>━━ Operations ━━</b>`,
    '',
    `📦 <b>Shipment</b>`,
    `     MTD  ${fmtNum(shipThis)}  ·  Prev  ${fmtNum(shipPrev)}`,
    `     Avg/day  ${fmtNum(Math.round(thisAvg.ship))}  ${fmtDelta(thisAvg.ship, prevAvg.ship, false)}`,
    `     Proyeksi  ${fmtNum(projShip)}  ${fmtDelta(projShip, shipPrev, false)}`,
    '',
    `🛒 <b>AOV</b>  ${fmtRp(thisAov)}  ${fmtDelta(thisAov, prevAov, false)}`,
    `✅ <b>CR Scalev *)</b>  ${fmtNum(crThis.shipped)}/${fmtNum(crThis.created)} (${fmtPct(thisCr)})  ${fmtDelta(thisCr, prevCr, true)}`,
    '',
    `<b>━━ Marketing ━━</b>`,
    '',
    `📣 <b>Mkt Fee %</b>  ${fmtPct(thisMktPct)}  ${fmtDelta(thisMktPct, prevMktPct, true, true)}`,
    `📱 <b>ROAS Meta</b>  ${thisRoas.toFixed(2)}x  ${fmtDelta(thisRoas, prevRoas, false)}`,
    '',
    `<i>*) same-day proxy</i>`,
  ].join('\n');

  return {
    message: msg,
    thisMonthFrom: mFrom,
    thisMonthTo: mTo,
    prevMonthFrom: prev.from,
    prevMonthTo: prev.to,
  };
}
