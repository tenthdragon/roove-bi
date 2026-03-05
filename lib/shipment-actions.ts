// lib/shipment-actions.ts
'use server';

import { createServiceSupabase } from '@/lib/supabase-server';

export interface ShipmentChannelRow {
  sales_channel: string;
  completed_orders: number;
  completed_revenue: number;
  in_transit_orders: number;
  in_transit_revenue: number;
  returned_orders: number;
  returned_revenue: number;
}

export async function fetchShipmentStatus(from: string, to: string): Promise<ShipmentChannelRow[]> {
  const svc = createServiceSupabase();

  // Try RPC first
  const { data, error } = await svc.rpc('get_shipment_status', {
    p_from: from,
    p_to: to,
  });

  // If RPC fails (schema cache), fallback to direct query
  if (error) {
    console.error('[ShipmentStatus] RPC failed, trying fallback:', error.message);
    return fetchShipmentStatusFallback(from, to);
  }

  if (!data || data.length === 0) {
    console.log('[ShipmentStatus] RPC returned 0 rows, trying fallback');
    return fetchShipmentStatusFallback(from, to);
  }

  return (data || []).map((row: any) => ({
    sales_channel: row.sales_channel || 'Unknown',
    completed_orders: Number(row.completed_orders) || 0,
    completed_revenue: Number(row.completed_revenue) || 0,
    in_transit_orders: Number(row.in_transit_orders) || 0,
    in_transit_revenue: Number(row.in_transit_revenue) || 0,
    returned_orders: Number(row.returned_orders) || 0,
    returned_revenue: Number(row.returned_revenue) || 0,
  }));
}

// Fallback: query scalev_orders + scalev_order_lines directly
// Uses pagination to bypass Supabase default 1000-row limit
async function fetchShipmentStatusFallback(from: string, to: string): Promise<ShipmentChannelRow[]> {
  const svc = createServiceSupabase();

  // Fetch ALL shipped orders in date range (paginated to avoid 1000-row limit)
  const allOrders: any[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data: batch, error: batchErr } = await svc
      .from('scalev_orders')
      .select('id, net_revenue, completed_time, status')
      .not('shipped_time', 'is', null)
      .gte('shipped_time', from)
      .lte('shipped_time', to + 'T23:59:59')
      .not('status', 'in', '(deleted)')
      .range(offset, offset + PAGE_SIZE - 1);

    if (batchErr) {
      console.error('[ShipmentStatus] Fallback orders query error:', batchErr.message);
      return [];
    }

    const rows = batch || [];
    allOrders.push(...rows);
    hasMore = rows.length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  if (allOrders.length === 0) return [];

  console.log(`[ShipmentStatus] Fallback fetched ${allOrders.length} orders`);

  // Fetch sales_channel in batches (avoid URL length limits with .in())
  const channelMap: Record<number, string> = {};
  const BATCH_SIZE = 500;

  for (let i = 0; i < allOrders.length; i += BATCH_SIZE) {
    const batchIds = allOrders.slice(i, i + BATCH_SIZE).map(o => o.id);

    const { data: lines, error: linesErr } = await svc
      .from('scalev_order_lines')
      .select('scalev_order_id, sales_channel')
      .in('scalev_order_id', batchIds)
      .limit(5000);

    if (linesErr) {
      console.error('[ShipmentStatus] Fallback lines query error:', linesErr.message);
      continue;
    }

    (lines || []).forEach((l: any) => {
      if (!channelMap[l.scalev_order_id]) {
        channelMap[l.scalev_order_id] = l.sales_channel || 'Unknown';
      }
    });
  }

  // Aggregate by channel
  const byChannel: Record<string, ShipmentChannelRow> = {};

  for (const o of allOrders) {
    const ch = channelMap[o.id] || 'Unknown';
    if (!byChannel[ch]) {
      byChannel[ch] = {
        sales_channel: ch,
        completed_orders: 0, completed_revenue: 0,
        in_transit_orders: 0, in_transit_revenue: 0,
        returned_orders: 0, returned_revenue: 0,
      };
    }

    const rev = Math.abs(Number(o.net_revenue) || 0);
    const isCanceled = ['canceled', 'cancelled', 'failed', 'returned'].includes(o.status);

    if (isCanceled) {
      byChannel[ch].returned_orders++;
      byChannel[ch].returned_revenue += rev;
    } else if (o.completed_time) {
      byChannel[ch].completed_orders++;
      byChannel[ch].completed_revenue += rev;
    } else {
      byChannel[ch].in_transit_orders++;
      byChannel[ch].in_transit_revenue += rev;
    }
  }

  // Sort by total orders desc
  return Object.values(byChannel).sort((a, b) => {
    const aTotal = a.completed_orders + a.in_transit_orders + a.returned_orders;
    const bTotal = b.completed_orders + b.in_transit_orders + b.returned_orders;
    return bTotal - aTotal;
  });
}
