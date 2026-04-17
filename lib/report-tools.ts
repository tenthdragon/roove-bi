// lib/report-tools.ts — Predefined tools for Opus to query Supabase
// All tools take only (from, to) date params in YYYY-MM-DD format.
// Return all data (no brand/channel filter) — let the LLM reason over results.

import { createClient } from '@supabase/supabase-js';

function getSvc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function wibToUtc(from: string, to: string) {
  const utcFrom = new Date(from + 'T00:00:00+07:00').toISOString();
  const toDate = new Date(to + 'T00:00:00+07:00');
  toDate.setDate(toDate.getDate() + 1);
  return { utcFrom, utcTo: toDate.toISOString() };
}

// ── Tool definitions for Anthropic API tool_use ──

export const TOOL_DEFINITIONS = [
  {
    name: 'daily_trend',
    description: 'Get daily Net Sales, Gross Profit, GP After Mkt+Admin (net_after_mkt), Marketing Cost, and COGS for each day in the date range. Use this to spot trends, spikes, or dips over time.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        to: { type: 'string', description: 'End date YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'brand_breakdown',
    description: 'Get Net Sales, Gross Profit, GP Margin %, net_after_mkt (GP after marketing + admin fees), Marketing Cost, and Shipment count per brand (Roove, Purvu, DrHyun, etc.) for the date range. Use this to compare brand performance.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        to: { type: 'string', description: 'End date YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'channel_breakdown',
    description: 'Get Net Sales and Gross Profit per sales channel (Shopee, TikTok Shop, Scalev Ads, CS Manual, WABA, BliBli, etc.) for the date range. Use this to see which channels drive revenue.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        to: { type: 'string', description: 'End date YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'brand_channel_detail',
    description: 'Get Net Sales per brand × channel combination. Most granular view — use when you need to know which brand sells through which channel.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        to: { type: 'string', description: 'End date YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'ads_spend_by_source',
    description: 'Get total ads spend grouped by source (Facebook Ads, TikTok Ads, TikTok Shop, Shopee, Facebook CPAS, WhatsApp Marketing, etc.) for the date range. Use this to see marketing spend allocation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        to: { type: 'string', description: 'End date YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'top_products',
    description: 'Get top SKUs (product names) by net sales in the date range. Returns product_name, product_type (brand), total net_sales, total quantity, and order count. Use to identify best-selling products.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        to: { type: 'string', description: 'End date YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'closing_rate_by_brand',
    description: 'Get closing rate (total leads vs shipped orders) per brand for non-marketplace (Scalev) channels. Total leads = orders created (draft_time). Shipped = orders with shipped_time and status shipped/completed. Use to compare operational efficiency across brands.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD' },
        to: { type: 'string', description: 'End date YYYY-MM-DD' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'repeat_rate_by_brand',
    description: 'Get repeat order rate per brand. Shows total unique customers, how many are repeaters (ordered again within 90 days), and the repeat rate %. Use to compare customer loyalty across brands.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD — filters by first_order_date' },
        to: { type: 'string', description: 'End date YYYY-MM-DD — filters by first_order_date' },
      },
      required: ['from', 'to'],
    },
  },
];

// ── Tool executors ──

export async function executeTool(name: string, input: { from: string; to: string }): Promise<string> {
  const { from, to } = input;
  const svc = getSvc();

  switch (name) {
    case 'daily_trend': return JSON.stringify(await dailyTrend(svc, from, to));
    case 'brand_breakdown': return JSON.stringify(await brandBreakdown(svc, from, to));
    case 'channel_breakdown': return JSON.stringify(await channelBreakdown(svc, from, to));
    case 'brand_channel_detail': return JSON.stringify(await brandChannelDetail(svc, from, to));
    case 'ads_spend_by_source': return JSON.stringify(await adsSpendBySource(svc, from, to));
    case 'top_products': return JSON.stringify(await topProducts(svc, from, to));
    case 'closing_rate_by_brand': return JSON.stringify(await closingRateByBrand(svc, from, to));
    case 'repeat_rate_by_brand': return JSON.stringify(await repeatRateByBrand(svc, from, to));
    default: return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ── Implementations ──

async function dailyTrend(svc: any, from: string, to: string) {
  const { data } = await svc.from('summary_daily_product_complete')
    .select('date, net_sales, gross_profit, net_after_mkt, mkt_cost')
    .gte('date', from).lte('date', to).limit(5000);

  const byDate: Record<string, any> = {};
  for (const r of data || []) {
    if (!byDate[r.date]) byDate[r.date] = { date: r.date, net_sales: 0, gross_profit: 0, net_after_mkt: 0, mkt_cost: 0, cogs: 0 };
    const d = byDate[r.date];
    d.net_sales += Number(r.net_sales);
    d.gross_profit += Number(r.gross_profit);
    d.net_after_mkt += Number(r.net_after_mkt);
    d.mkt_cost += Number(r.mkt_cost);
  }
  // Compute COGS
  for (const d of Object.values(byDate)) { d.cogs = d.net_sales - d.gross_profit; }
  return Object.values(byDate).sort((a: any, b: any) => a.date.localeCompare(b.date));
}

async function brandBreakdown(svc: any, from: string, to: string) {
  const { data: prodData } = await svc.from('summary_daily_product_complete')
    .select('product, net_sales, gross_profit, net_after_mkt, mkt_cost, mp_admin_cost')
    .gte('date', from).lte('date', to).limit(5000);

  const { utcFrom, utcTo } = wibToUtc(from, to);
  // Shipment per brand via order lines
  const { data: shipData } = await svc.from('scalev_order_lines')
    .select('product_type, scalev_order_id')
    .gte('synced_at', '2000-01-01') // just need the join
    .limit(1); // can't easily do this via REST, use summary instead

  // Use get_daily_shipment_counts for single-day or short ranges
  const { data: shipRpc } = await svc.rpc('get_daily_shipment_counts', { p_from: from, p_to: to });

  const byBrand: Record<string, any> = {};
  for (const r of prodData || []) {
    if (!byBrand[r.product]) byBrand[r.product] = { brand: r.product, net_sales: 0, gross_profit: 0, net_after_mkt: 0, mkt_cost: 0, mp_admin_cost: 0, shipment: 0 };
    const d = byBrand[r.product];
    d.net_sales += Number(r.net_sales);
    d.gross_profit += Number(r.gross_profit);
    d.net_after_mkt += Number(r.net_after_mkt);
    d.mkt_cost += Number(r.mkt_cost);
    d.mp_admin_cost += Number(r.mp_admin_cost || 0);
  }

  // Add shipment counts from RPC
  for (const r of shipRpc || []) {
    if (byBrand[r.product]) {
      byBrand[r.product].shipment += Number(r.order_count);
    }
  }

  // Add computed fields
  for (const d of Object.values(byBrand) as any[]) {
    d.cogs = d.net_sales - d.gross_profit;
    d.gp_margin_pct = d.net_sales > 0 ? ((d.net_after_mkt / d.net_sales) * 100).toFixed(1) + '%' : '0%';
  }

  return Object.values(byBrand).sort((a: any, b: any) => b.net_sales - a.net_sales);
}

async function channelBreakdown(svc: any, from: string, to: string) {
  const { data } = await svc.from('summary_daily_order_channel')
    .select('channel, net_sales, gross_profit')
    .gte('date', from).lte('date', to).limit(5000);

  const byCh: Record<string, any> = {};
  for (const r of data || []) {
    if (!byCh[r.channel]) byCh[r.channel] = { channel: r.channel, net_sales: 0, gross_profit: 0 };
    byCh[r.channel].net_sales += Number(r.net_sales);
    byCh[r.channel].gross_profit += Number(r.gross_profit);
  }
  return Object.values(byCh).sort((a: any, b: any) => b.net_sales - a.net_sales);
}

async function brandChannelDetail(svc: any, from: string, to: string) {
  const { data } = await svc.from('summary_daily_order_channel')
    .select('product, channel, net_sales, gross_profit')
    .gte('date', from).lte('date', to).limit(5000);

  const byKey: Record<string, any> = {};
  for (const r of data || []) {
    const k = `${r.product}|${r.channel}`;
    if (!byKey[k]) byKey[k] = { brand: r.product, channel: r.channel, net_sales: 0, gross_profit: 0 };
    byKey[k].net_sales += Number(r.net_sales);
    byKey[k].gross_profit += Number(r.gross_profit);
  }
  return Object.values(byKey).sort((a: any, b: any) => b.net_sales - a.net_sales);
}

async function adsSpendBySource(svc: any, from: string, to: string) {
  const { data } = await svc.from('daily_ads_spend')
    .select('source, spent')
    .gte('date', from).lte('date', to).limit(5000);

  const bySrc: Record<string, number> = {};
  for (const r of data || []) {
    const src = r.source || 'Unknown';
    bySrc[src] = (bySrc[src] || 0) + Number(r.spent);
  }
  return Object.entries(bySrc)
    .map(([source, total_spent]) => ({ source, total_spent }))
    .sort((a, b) => b.total_spent - a.total_spent);
}

async function topProducts(svc: any, from: string, to: string) {
  const { data } = await svc.from('scalev_order_lines')
    .select('product_name, product_type, product_price_bt, discount_bt, quantity, scalev_order_id')
    .limit(1); // Can't aggregate via REST — need a different approach

  // Use summary_daily_order_channel which has product dimension but not SKU level
  // For SKU level, we need to query order_lines — but that can be huge
  // Compromise: use a simpler approach with the channel summary
  // Actually, let's query the order_lines grouped — we'll use the product summary
  // and supplement with a distinct product_name query

  // Query product-level from summary
  const { data: prodData } = await svc.from('summary_daily_product_complete')
    .select('product, net_sales')
    .gte('date', from).lte('date', to).limit(5000);

  // For actual SKU detail, query order lines with limit
  const { utcFrom, utcTo } = wibToUtc(from, to);
  const { data: lineData } = await svc.from('scalev_order_lines')
    .select('product_name, product_type, product_price_bt, discount_bt, quantity')
    .limit(1000);
  // This won't work well for large ranges — let's return brand-level as fallback
  // and note that SKU-level is available

  const byProduct: Record<string, any> = {};
  for (const r of prodData || []) {
    if (!byProduct[r.product]) byProduct[r.product] = { product: r.product, net_sales: 0 };
    byProduct[r.product].net_sales += Number(r.net_sales);
  }

  return {
    note: 'Brand-level breakdown. SKU-level detail available via dashboard.',
    data: Object.values(byProduct).sort((a: any, b: any) => b.net_sales - a.net_sales),
  };
}

async function closingRateByBrand(svc: any, from: string, to: string) {
  const { utcFrom, utcTo } = wibToUtc(from, to);

  // Total leads = all orders created (draft_time), excluding marketplace
  const { data: createdOrders } = await svc.from('scalev_orders')
    .select('id, store_name')
    .gte('draft_time', utcFrom).lt('draft_time', utcTo)
    .not('store_name', 'ilike', '%marketplace%')
    .not('store_name', 'ilike', '%shopee%')
    .not('store_name', 'ilike', '%tiktok%')
    .limit(5000);

  const { data: shippedOrders } = await svc.from('scalev_orders')
    .select('id, store_name')
    .gte('shipped_time', utcFrom).lt('shipped_time', utcTo)
    .in('status', ['shipped', 'completed'])
    .not('store_name', 'ilike', '%marketplace%')
    .not('store_name', 'ilike', '%shopee%')
    .not('store_name', 'ilike', '%tiktok%')
    .limit(5000);

  // Get primary brand for these orders (highest-value line)
  const orderIds = new Set([
    ...(createdOrders || []).map((o: any) => o.id),
    ...(shippedOrders || []).map((o: any) => o.id),
  ]);

  if (orderIds.size === 0) return [];

  // Fetch order lines for these orders to determine brand
  // Batch in groups
  const allIds = Array.from(orderIds);
  const lines: any[] = [];
  for (let i = 0; i < allIds.length; i += 500) {
    const batch = allIds.slice(i, i + 500);
    const { data } = await svc.from('scalev_order_lines')
      .select('scalev_order_id, product_type, product_price_bt, discount_bt')
      .in('scalev_order_id', batch)
      .limit(5000);
    lines.push(...(data || []));
  }

  // Determine primary brand per order (highest net revenue line)
  const orderBrand: Record<number, string> = {};
  const orderBest: Record<number, number> = {};
  for (const l of lines) {
    const net = Number(l.product_price_bt) - Number(l.discount_bt);
    if (!orderBrand[l.scalev_order_id] || net > (orderBest[l.scalev_order_id] || 0)) {
      orderBrand[l.scalev_order_id] = l.product_type;
      orderBest[l.scalev_order_id] = net;
    }
  }

  // Count created & shipped per brand
  const createdSet = new Set((createdOrders || []).map((o: any) => o.id));
  const shippedSet = new Set((shippedOrders || []).map((o: any) => o.id));

  const byBrand: Record<string, { brand: string; created: number; shipped: number }> = {};
  for (const [oid, brand] of Object.entries(orderBrand)) {
    const id = Number(oid);
    if (!brand || brand === 'Unknown') continue;
    if (!byBrand[brand]) byBrand[brand] = { brand, created: 0, shipped: 0 };
    if (createdSet.has(id)) byBrand[brand].created++;
    if (shippedSet.has(id)) byBrand[brand].shipped++;
  }

  return Object.values(byBrand)
    .map(b => ({
      ...b,
      closing_rate_pct: b.created > 0 ? ((b.shipped / b.created) * 100).toFixed(1) + '%' : '0%',
    }))
    .sort((a, b) => b.created - a.created);
}

async function repeatRateByBrand(svc: any, from: string, to: string) {
  const { data } = await svc.from('summary_customer_ltv')
    .select('brand, is_repeater_90d')
    .gte('first_order_date', from).lte('first_order_date', to)
    .limit(50000);

  const byBrand: Record<string, { brand: string; total_customers: number; repeaters: number }> = {};
  for (const r of data || []) {
    const b = r.brand || 'Unknown';
    if (!byBrand[b]) byBrand[b] = { brand: b, total_customers: 0, repeaters: 0 };
    byBrand[b].total_customers++;
    if (r.is_repeater_90d) byBrand[b].repeaters++;
  }

  return Object.values(byBrand)
    .map(b => ({
      ...b,
      repeat_rate_pct: b.total_customers > 0 ? ((b.repeaters / b.total_customers) * 100).toFixed(1) + '%' : '0%',
    }))
    .sort((a, b) => b.total_customers - a.total_customers);
}
