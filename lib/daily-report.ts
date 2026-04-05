// lib/daily-report.ts — Daily report data & message formatting
import { createClient } from '@supabase/supabase-js';

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ── Helpers ──

function getYesterdayWIB(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600_000);
  wib.setDate(wib.getDate() - 1);
  return `${wib.getFullYear()}-${String(wib.getMonth() + 1).padStart(2, '0')}-${String(wib.getDate()).padStart(2, '0')}`;
}

function monthStart(dateStr: string): string {
  return dateStr.slice(0, 7) + '-01';
}

function prevMonthRange(dateStr: string): { from: string; to: string } {
  const d = new Date(dateStr + 'T00:00:00');
  const prevEnd = new Date(d.getFullYear(), d.getMonth(), 0);
  const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), 1);
  const fmt = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  return { from: fmt(prevStart), to: fmt(prevEnd) };
}

/** Convert WIB date range to UTC timestamps */
function wibRangeToUtc(from: string, to: string): { utcFrom: string; utcTo: string } {
  const utcFrom = new Date(from + 'T00:00:00+07:00').toISOString();
  const toDate = new Date(to + 'T00:00:00+07:00');
  toDate.setDate(toDate.getDate() + 1);
  const utcTo = toDate.toISOString();
  return { utcFrom, utcTo };
}

function fmtRp(n: number): string {
  if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `Rp ${(n / 1e3).toFixed(0)}K`;
  return `Rp ${n.toFixed(0)}`;
}

function fmtPct(n: number): string { return `${n.toFixed(1)}%`; }

function fmtDelta(val: number, avg: number, isPp: boolean): string {
  if (avg === 0) return '-';
  if (isPp) {
    const d = val - avg;
    return `${d >= 0 ? '+' : ''}${d.toFixed(1)}pp`;
  }
  const d = ((val - avg) / Math.abs(avg)) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}

function fmtNum(n: number): string { return n.toLocaleString('id-ID'); }

const SCALEV_ADS_CHANNEL = 'Scalev Ads';

// ── Data fetching (with error logging) ──

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
    .gte('shipped_time', utcFrom)
    .lt('shipped_time', utcTo);
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

  // Use or() to combine marketplace exclusions into a single filter
  // instead of chaining .not() which can cause issues
  const mpFilter = 'store_name.not.ilike.%marketplace%,store_name.not.ilike.%shopee%,store_name.not.ilike.%tiktok%,store_name.not.ilike.%lazada%,store_name.not.ilike.%tokopedia%,store_name.not.ilike.%blibli%';

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

  console.log(`[report] CR ${from}→${to}: created=${created}, shipped=${shipped}`);
  return { created: created || 0, shipped: shipped || 0 };
}

// ── Compute range totals ──

function computeRange(from: string, to: string, productRows: any[], channelRows: any[], metaByDate: Record<string, number>) {
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

// ── Main ──

export async function buildDailyReport(): Promise<string> {
  // @ts-ignore — debug info attached to return for troubleshooting
  buildDailyReport._debug = {};
  const svc = getServiceSupabase();
  const yesterday = getYesterdayWIB();
  const thisMonthFrom = monthStart(yesterday);
  const prev = prevMonthRange(yesterday);

  console.log(`[report] Building report for yesterday=${yesterday}, thisMonth=${thisMonthFrom}, prevMonth=${prev.from}→${prev.to}`);

  // Fetch all data in parallel
  const [productRows, channelRows, metaByDate, shipYd, shipThis, shipPrev, crYd, crThis, crPrev] = await Promise.all([
    fetchProductSummary(svc, prev.from, yesterday),
    fetchChannelSummary(svc, prev.from, yesterday),
    fetchMetaAdsSpend(svc, prev.from, yesterday),
    fetchShipmentCount(svc, yesterday, yesterday),
    fetchShipmentCount(svc, thisMonthFrom, yesterday),
    fetchShipmentCount(svc, prev.from, prev.to),
    fetchCRForRange(svc, yesterday, yesterday),
    fetchCRForRange(svc, thisMonthFrom, yesterday),
    fetchCRForRange(svc, prev.from, prev.to),
  ]);

  // @ts-ignore
  buildDailyReport._debug = {
    yesterday, productRows: productRows.length, channelRows: channelRows.length,
    shipYd, shipThis, shipPrev, crYd, crThis, crPrev,
  };

  // Yesterday
  const ydR = computeRange(yesterday, yesterday, productRows, channelRows, metaByDate);
  const gpm = ydR.ns > 0 ? (ydR.nam / ydR.ns) * 100 : 0;
  const aov = shipYd > 0 ? ydR.ns / shipYd : 0;
  const mktPct = ydR.ns > 0 ? (ydR.mkt / ydR.ns) * 100 : 0;
  const roas = ydR.meta > 0 ? ydR.scalev / ydR.meta : 0;
  const crPct = crYd.created > 0 ? (crYd.shipped / crYd.created) * 100 : 0;

  // This month avg
  const thisR = computeRange(thisMonthFrom, yesterday, productRows, channelRows, metaByDate);
  const tn = thisR.activeDays || 1;
  const aThis = {
    ns: thisR.ns / tn, nam: thisR.nam / tn,
    gpm: thisR.ns > 0 ? (thisR.nam / thisR.ns) * 100 : 0,
    ship: shipThis / tn, aov: shipThis > 0 ? thisR.ns / shipThis : 0,
    mktPct: thisR.ns > 0 ? (thisR.mkt / thisR.ns) * 100 : 0,
    roas: thisR.meta > 0 ? thisR.scalev / thisR.meta : 0,
    crPct: crThis.created > 0 ? (crThis.shipped / crThis.created) * 100 : 0,
  };

  // Last month avg
  const prevR = computeRange(prev.from, prev.to, productRows, channelRows, metaByDate);
  const pn = prevR.activeDays || 1;
  const aPrev = {
    ns: prevR.ns / pn, nam: prevR.nam / pn,
    gpm: prevR.ns > 0 ? (prevR.nam / prevR.ns) * 100 : 0,
    ship: shipPrev / pn, aov: shipPrev > 0 ? prevR.ns / shipPrev : 0,
    mktPct: prevR.ns > 0 ? (prevR.mkt / prevR.ns) * 100 : 0,
    roas: prevR.meta > 0 ? prevR.scalev / prevR.meta : 0,
    crPct: crPrev.created > 0 ? (crPrev.shipped / crPrev.created) * 100 : 0,
  };

  const d = new Date(yesterday + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const label = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;

  return [
    `📊 <b>Daily Report — ${label}</b>`,
    '',
    `💰 <b>Net Sales:</b> ${fmtRp(ydR.ns)} | ${fmtDelta(ydR.ns, aThis.ns, false)} avg bln ini | ${fmtDelta(ydR.ns, aPrev.ns, false)} avg bln lalu`,
    '',
    `📈 <b>GP Margin:</b> ${fmtPct(gpm)} | ${fmtDelta(gpm, aThis.gpm, true)} avg bln ini | ${fmtDelta(gpm, aPrev.gpm, true)} avg bln lalu`,
    '',
    `💵 <b>GP After Mkt+Adm:</b> ${fmtRp(ydR.nam)} | ${fmtDelta(ydR.nam, aThis.nam, false)} avg bln ini | ${fmtDelta(ydR.nam, aPrev.nam, false)} avg bln lalu`,
    '',
    `📦 <b>Shipment:</b> ${fmtNum(shipYd)} | ${fmtDelta(shipYd, aThis.ship, false)} avg bln ini | ${fmtDelta(shipYd, aPrev.ship, false)} avg bln lalu`,
    '',
    `🛒 <b>AOV:</b> ${fmtRp(aov)} | ${fmtDelta(aov, aThis.aov, false)} avg bln ini | ${fmtDelta(aov, aPrev.aov, false)} avg bln lalu`,
    '',
    `📣 <b>Mkt Fee %:</b> ${fmtPct(mktPct)} | ${fmtDelta(mktPct, aThis.mktPct, true)} avg bln ini | ${fmtDelta(mktPct, aPrev.mktPct, true)} avg bln lalu`,
    '',
    `📱 <b>ROAS Meta Ads:</b> ${roas.toFixed(2)}x | ${fmtDelta(roas, aThis.roas, false)} avg bln ini | ${fmtDelta(roas, aPrev.roas, false)} avg bln lalu`,
    '',
    `✅ <b>CR Scalev *):</b> ${fmtNum(crYd.shipped)}/${fmtNum(crYd.created)} (${fmtPct(crPct)}) | ${fmtDelta(crPct, aThis.crPct, true)} avg bln ini | ${fmtDelta(crPct, aPrev.crPct, true)} avg bln lalu`,
  ].join('\n');
}
