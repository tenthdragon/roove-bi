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

  // Direct SQL query via Supabase — avoids PostgREST schema cache issues with new RPC functions
  const { data, error } = await svc.rpc('get_shipment_status', {
    p_from: from,
    p_to: to,
  });

  // If RPC fails (schema cache), fallback to raw SQL via .from() approach
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
async function fetchShipmentStatusFallback(from: string, to: string): Promise<ShipmentChannelRow[]> {
  const svc = createServiceSupabase();

  // Fetch shipped orders in date range
  const { data: orders, error: ordersErr } = await svc
    .from('scalev_orders')
    .select('id, net_revenue, completed_time, status')
    .not('shipped_time', 'is', null)
    .gte('shipped_time', from)
    .lte('shipped_time', to + 'T23:59:59')
    .not('status', 'in', '(deleted)');

  if (ordersErr) {
    console.error('[ShipmentStatus] Fallback orders query error:', ordersErr.message);
    return [];
  }

  if (!orders || orders.length === 0) return [];

  // Fetch sales_channel for each order (first line per order)
  const orderIds = orders.map(o => o.id);

  // Batch fetch order lines — get sales_channel per scalev_order_id
  const { data: lines, error: linesErr } = await svc
    .from('scalev_order_lines')
    .select('scalev_order_id, sales_channel')
    .in('scalev_order_id', orderIds);

  if (linesErr) {
    console.error('[ShipmentStatus] Fallback lines query error:', linesErr.message);
    return [];
  }

  // Build map: order id → sales_channel (first line wins)
  const channelMap: Record<number, string> = {};
  (lines || []).forEach((l: any) => {
    if (!channelMap[l.scalev_order_id]) {
      channelMap[l.scalev_order_id] = l.sales_channel || 'Unknown';
    }
  });

  // Aggregate by channel
  const byChannel: Record<string, ShipmentChannelRow> = {};

  for (const o of orders) {
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
