// lib/ppic-actions.ts
'use server';

import { createServiceSupabase, createServerSupabase } from './supabase-server';
import { requireDashboardTabAccess } from './dashboard-access';
import { createBatchInternal, recordStockInInternal } from './warehouse-ledger-actions';
import { sendTelegramToChat } from './telegram';

// ============================================================
// AUTH HELPER (same pattern as warehouse-ledger-actions)
// ============================================================

async function getCurrentUserId(): Promise<string | null> {
  try {
    const supabase = createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id || null;
  } catch {
    return null;
  }
}

async function requirePPICAccess(label: string = 'PPIC') {
  await requireDashboardTabAccess('ppic', label);
}

function toYearMonthKey(year: number, month: number) {
  return year * 100 + month;
}

function getJakartaCurrentMonthYear() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date());

  const year = Number(parts.find(part => part.type === 'year')?.value || new Date().getFullYear());
  const month = Number(parts.find(part => part.type === 'month')?.value || new Date().getMonth() + 1);

  return { year, month };
}

function getDemandHistoryWindowMonths(targetMonth: number, targetYear: number, lookbackMonths: number = 6) {
  const { year: currentYear, month: currentMonth } = getJakartaCurrentMonthYear();
  const monthDiff = (currentYear - targetYear) * 12 + (currentMonth - targetMonth);

  return Math.max(lookbackMonths + 1, Math.max(monthDiff, 0) + lookbackMonths + 1);
}

interface MonthlyDemandRow {
  warehouse_product_id: number;
  yr: number;
  mn: number;
  total_qty: number;
}

interface ScalevOrderWindowRow {
  id: number;
  shipped_time: string;
}

interface ScalevOrderLineDemandRow {
  scalev_order_id: number;
  product_name: string;
  quantity: number;
}

interface LegacyScalevDemandMappingRow {
  scalev_product_name: string;
  warehouse_product_id: number | null;
  deduct_qty_multiplier: number | null;
  is_ignored: boolean | null;
}

interface SummaryScalevDailyDemandRow {
  demand_date: string;
  scalev_product_name: string;
  total_qty: number;
}

interface MappedScalevDailyDemandRow {
  demand_date: string;
  warehouse_product_id: number;
  total_qty: number;
}

function isStatementTimeoutError(error: any) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('statement timeout') || message.includes('canceling statement due to statement timeout');
}

function isMissingPpicDemandSummaryError(error: any) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === 'PGRST205' || code === '42P01' || /does not exist/i.test(message) || /schema cache/i.test(message);
}

function getJakartaCurrentDateParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());

  return {
    year: Number(parts.find(part => part.type === 'year')?.value || new Date().getFullYear()),
    month: Number(parts.find(part => part.type === 'month')?.value || new Date().getMonth() + 1),
    day: Number(parts.find(part => part.type === 'day')?.value || new Date().getDate()),
  };
}

function createUtcDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day));
}

function shiftUtcDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function shiftYearMonth(year: number, month: number, deltaMonths: number) {
  const shifted = new Date(Date.UTC(year, month - 1 + deltaMonths, 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
  };
}

function formatUtcDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateParts(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function normalizeMonthlyDemandRows(rows: any[]): MonthlyDemandRow[] {
  return (rows || []).map((row: any) => ({
    warehouse_product_id: Number(row.warehouse_product_id),
    yr: Number(row.yr),
    mn: Number(row.mn),
    total_qty: Number(row.total_qty ?? row.total_out ?? 0),
  }));
}

function buildDemandSnapshotFromRows(rows: MonthlyDemandRow[], targetMonth: number, targetYear: number) {
  const targetYm = toYearMonthKey(targetYear, targetMonth);
  const demandMonthsByProduct = new Map<number, { ym: number; qty: number }[]>();
  const actualOutMap = new Map<number, number>();

  for (const row of rows) {
    const productId = Number(row.warehouse_product_id);
    const ym = toYearMonthKey(Number(row.yr), Number(row.mn));
    const qty = Number(row.total_qty || 0);

    if (ym === targetYm) {
      actualOutMap.set(productId, qty);
    }

    if (ym >= targetYm) {
      continue;
    }

    if (!demandMonthsByProduct.has(productId)) {
      demandMonthsByProduct.set(productId, []);
    }

    demandMonthsByProduct.get(productId)!.push({ ym, qty });
  }

  const productDemand = new Map<number, number>();

  for (const [productId, months] of Array.from(demandMonthsByProduct.entries())) {
    months.sort((a: { ym: number; qty: number }, b: { ym: number; qty: number }) => a.ym - b.ym);
    const recentMonths = months.slice(-6);

    let weightedTotal = 0;
    let totalWeight = 0;

    recentMonths.forEach((entry: { ym: number; qty: number }, index: number) => {
      const weight = index + 1;
      weightedTotal += entry.qty * weight;
      totalWeight += weight;
    });

    productDemand.set(productId, totalWeight > 0 ? Math.round(weightedTotal / totalWeight) : 0);
  }

  return { productDemand, actualOutMap };
}

async function getMappedScalevDailyDemandRows(
  svc: any,
  startDate: string,
  endDate: string,
): Promise<MappedScalevDailyDemandRow[]> {
  const { data: summaryData, error: summaryErr } = await svc
    .from('summary_scalev_daily_product_demand')
    .select('demand_date, scalev_product_name, total_qty')
    .gte('demand_date', startDate)
    .lte('demand_date', endDate)
    .order('demand_date', { ascending: true });

  if (summaryErr) throw summaryErr;

  const rows = (summaryData || []).map((row: any): SummaryScalevDailyDemandRow => ({
    demand_date: String(row.demand_date),
    scalev_product_name: String(row.scalev_product_name || ''),
    total_qty: Number(row.total_qty || 0),
  })).filter((row) => row.scalev_product_name && Number.isFinite(row.total_qty) && row.total_qty !== 0);

  if (rows.length === 0) {
    return [];
  }

  const mappings: LegacyScalevDemandMappingRow[] = [];
  const uniqueNames = Array.from(new Set(rows.map(row => row.scalev_product_name)));

  for (const chunk of chunkArray(uniqueNames, 500)) {
    const { data, error } = await svc
      .from('warehouse_scalev_mapping')
      .select('scalev_product_name, warehouse_product_id, deduct_qty_multiplier, is_ignored')
      .in('scalev_product_name', chunk);

    if (error) throw error;
    mappings.push(...((data || []) as LegacyScalevDemandMappingRow[]));
  }

  const mappingByName = new Map<string, LegacyScalevDemandMappingRow>();
  for (const mapping of mappings) {
    if (!mapping.scalev_product_name || mappingByName.has(mapping.scalev_product_name)) continue;
    mappingByName.set(mapping.scalev_product_name, mapping);
  }

  const mappedRows: MappedScalevDailyDemandRow[] = [];

  for (const row of rows) {
    const mapping = mappingByName.get(row.scalev_product_name);
    if (!mapping || mapping.is_ignored || !mapping.warehouse_product_id) continue;

    mappedRows.push({
      demand_date: row.demand_date,
      warehouse_product_id: Number(mapping.warehouse_product_id),
      total_qty: row.total_qty * Number(mapping.deduct_qty_multiplier || 1),
    });
  }

  return mappedRows;
}

async function getMonthlyDemandRowsFromDailySummary(
  svc: any,
  month: number,
  year: number,
): Promise<MonthlyDemandRow[]> {
  const startWindow = shiftYearMonth(year, month, -6);
  const startDate = formatDateParts(startWindow.year, startWindow.month, 1);
  const endDate = formatDateParts(year, month, getDaysInMonth(year, month));
  const mappedRows = await getMappedScalevDailyDemandRows(svc, startDate, endDate);
  const totals = new Map<string, number>();

  for (const row of mappedRows) {
    const [yrStr, mnStr] = row.demand_date.split('-');
    const yr = Number(yrStr);
    const mn = Number(mnStr);
    const key = `${row.warehouse_product_id}:${yr}:${mn}`;
    totals.set(key, (totals.get(key) || 0) + row.total_qty);
  }

  return Array.from(totals.entries()).map(([key, total_qty]) => {
    const [warehouseProductId, yr, mn] = key.split(':').map(Number);
    return {
      warehouse_product_id: warehouseProductId,
      yr,
      mn,
      total_qty: Math.round(total_qty * 100) / 100,
    };
  });
}

async function getMonthlyDemandRowsWithFallback(
  svc: any,
  month: number,
  year: number,
  historyWindowMonths: number,
) {
  const { data, error } = await svc.rpc('ppic_monthly_demand', { p_months: historyWindowMonths });
  if (!error) {
    return normalizeMonthlyDemandRows(data || []);
  }

  if (!isStatementTimeoutError(error)) {
    throw error;
  }

  console.warn(`[ppic] ppic_monthly_demand timed out for ${month}/${year}; falling back to summary tables`);

  try {
    return await getMonthlyDemandRowsFromDailySummary(svc, month, year);
  } catch (summaryError) {
    if (!isMissingPpicDemandSummaryError(summaryError)) {
      throw summaryError;
    }
  }

  const startWindow = shiftYearMonth(year, month, -6);
  const startYm = toYearMonthKey(startWindow.year, startWindow.month);
  const endYm = toYearMonthKey(year, month);

  const { data: summaryData, error: summaryErr } = await svc
    .from('summary_scalev_monthly_movements')
    .select('warehouse_product_id, yr, mn, total_out')
    .gte('yr', startWindow.year)
    .lte('yr', year);

  if (summaryErr) throw summaryErr;

  return normalizeMonthlyDemandRows(
    (summaryData || []).filter((row: any) => {
      const ym = toYearMonthKey(Number(row.yr), Number(row.mn));
      return ym >= startYm && ym <= endYm;
    }),
  );
}

async function getExactDailyDemandMapRawFallback(svc: any, demandDays: number): Promise<Map<number, number>> {
  const safeDays = Math.max(Number(demandDays) || 0, 1);
  const today = getJakartaCurrentDateParts();
  const endDate = createUtcDate(today.year, today.month, today.day);
  const startDate = shiftUtcDays(endDate, -(safeDays - 1));
  const startIso = `${formatUtcDate(startDate)}T00:00:00+07:00`;
  const endIso = `${formatUtcDate(endDate)}T23:59:59.999+07:00`;

  const orders: ScalevOrderWindowRow[] = [];
  let orderOffset = 0;

  while (true) {
    const { data, error } = await svc
      .from('scalev_orders')
      .select('id, shipped_time')
      .in('status', ['shipped', 'completed'])
      .not('shipped_time', 'is', null)
      .gte('shipped_time', startIso)
      .lte('shipped_time', endIso)
      .order('id', { ascending: true })
      .range(orderOffset, orderOffset + 999);

    if (error) throw error;
    if (!data || data.length === 0) break;

    orders.push(...(data as any[]).map((row) => ({
      id: Number(row.id),
      shipped_time: String(row.shipped_time),
    })));

    if (data.length < 1000) break;
    orderOffset += 1000;
  }

  if (orders.length === 0) {
    return new Map<number, number>();
  }

  const lines: ScalevOrderLineDemandRow[] = [];

  for (const chunk of chunkArray(orders.map(order => order.id), 500)) {
    let lineOffset = 0;

    while (true) {
      const { data, error } = await svc
        .from('scalev_order_lines')
        .select('scalev_order_id, product_name, quantity')
        .in('scalev_order_id', chunk)
        .range(lineOffset, lineOffset + 999);

      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const row of data as any[]) {
        if (!row.product_name || Number(row.quantity) <= 0) continue;
        lines.push({
          scalev_order_id: Number(row.scalev_order_id),
          product_name: String(row.product_name),
          quantity: Number(row.quantity),
        });
      }

      if (data.length < 1000) break;
      lineOffset += 1000;
    }
  }

  if (lines.length === 0) {
    return new Map<number, number>();
  }

  const mappings: LegacyScalevDemandMappingRow[] = [];
  const uniqueNames = Array.from(new Set(lines.map(line => line.product_name)));

  for (const chunk of chunkArray(uniqueNames, 500)) {
    const { data, error } = await svc
      .from('warehouse_scalev_mapping')
      .select('scalev_product_name, warehouse_product_id, deduct_qty_multiplier, is_ignored')
      .in('scalev_product_name', chunk);

    if (error) throw error;
    mappings.push(...((data || []) as LegacyScalevDemandMappingRow[]));
  }

  const mappingByName = new Map<string, LegacyScalevDemandMappingRow>();
  for (const mapping of mappings) {
    if (!mapping.scalev_product_name || mappingByName.has(mapping.scalev_product_name)) continue;
    mappingByName.set(mapping.scalev_product_name, mapping);
  }

  const totals = new Map<number, number>();

  for (const line of lines) {
    const mapping = mappingByName.get(line.product_name);
    if (!mapping || mapping.is_ignored || !mapping.warehouse_product_id) continue;

    const multiplier = Number(mapping.deduct_qty_multiplier || 1);
    const quantity = Number(line.quantity || 0) * multiplier;
    totals.set(
      Number(mapping.warehouse_product_id),
      (totals.get(Number(mapping.warehouse_product_id)) || 0) + quantity,
    );
  }

  const avgDailyMap = new Map<number, number>();
  for (const [productId, totalQty] of Array.from(totals.entries())) {
    avgDailyMap.set(productId, Math.round((totalQty / safeDays) * 100) / 100);
  }

  return avgDailyMap;
}

async function getExactDailyDemandMapFallback(svc: any, demandDays: number): Promise<Map<number, number>> {
  const safeDays = Math.max(Number(demandDays) || 0, 1);
  const today = getJakartaCurrentDateParts();
  const todayUtc = createUtcDate(today.year, today.month, today.day);
  const startDateValue = shiftUtcDays(todayUtc, -(safeDays - 1));
  const endDate = formatDateParts(today.year, today.month, today.day);
  const startDate = formatDateParts(
    startDateValue.getUTCFullYear(),
    startDateValue.getUTCMonth() + 1,
    startDateValue.getUTCDate(),
  );

  try {
    const mappedRows = await getMappedScalevDailyDemandRows(svc, startDate, endDate);
    const totals = new Map<number, number>();

    for (const row of mappedRows) {
      totals.set(row.warehouse_product_id, (totals.get(row.warehouse_product_id) || 0) + row.total_qty);
    }

    const avgDailyMap = new Map<number, number>();
    for (const [productId, totalQty] of Array.from(totals.entries())) {
      avgDailyMap.set(productId, Math.round((totalQty / safeDays) * 100) / 100);
    }

    return avgDailyMap;
  } catch (error) {
    if (!isMissingPpicDemandSummaryError(error)) {
      throw error;
    }
  }

  return getExactDailyDemandMapRawFallback(svc, demandDays);
}

async function getAverageDailyDemandMap(svc: any, demandDays: number): Promise<Map<number, number>> {
  const { data, error } = await svc.rpc('ppic_avg_daily_demand', { p_days: demandDays });
  if (!error) {
    return new Map<number, number>((data || []).map((row: any): [number, number] => [Number(row.warehouse_product_id), Number(row.avg_daily)]));
  }

  if (!isStatementTimeoutError(error)) {
    throw error;
  }

  console.warn(`[ppic] ppic_avg_daily_demand timed out for ${demandDays} days; using summary fallback`);
  return getExactDailyDemandMapFallback(svc, demandDays);
}

async function getWeeklyDemandDataFallback(svc: any, month: number, year: number) {
  const startDate = formatDateParts(year, month, 1);
  const endDate = formatDateParts(year, month, getDaysInMonth(year, month));

  try {
    const mappedRows = await getMappedScalevDailyDemandRows(svc, startDate, endDate);
    const result: Record<number, any> = {};

    for (const row of mappedRows) {
      const day = Number(row.demand_date.slice(8, 10));
      const weekNum = day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4;
      if (!result[row.warehouse_product_id]) {
        result[row.warehouse_product_id] = { w1_out: 0, w2_out: 0, w3_out: 0, w4_out: 0 };
      }
      result[row.warehouse_product_id][`w${weekNum}_out`] += row.total_qty;
    }

    return result;
  } catch (summaryError) {
    if (!isMissingPpicDemandSummaryError(summaryError)) {
      throw summaryError;
    }
  }

  const { data: summaryData } = await svc
    .from('summary_scalev_monthly_movements')
    .select('warehouse_product_id, total_out')
    .eq('yr', year).eq('mn', month);

  if (!summaryData || summaryData.length === 0) return {};

  const result: Record<number, any> = {};
  for (const s of summaryData) {
    const weekly = Math.round(Number(s.total_out) / 4);
    result[Number(s.warehouse_product_id)] = { w1_out: weekly, w2_out: weekly, w3_out: weekly, w4_out: weekly };
  }

  return result;
}

async function getDemandPlanningSnapshot(svc: any, month: number, year: number) {
  const targetYm = toYearMonthKey(year, month);
  const historyWindowMonths = getDemandHistoryWindowMonths(month, year, 6);

  const [
    { data: demandData, error: demandErr },
    { data: movData, error: movErr },
  ] = await Promise.all([
    svc.rpc('ppic_monthly_demand', { p_months: historyWindowMonths }),
    svc.rpc('ppic_monthly_movements', { p_months: historyWindowMonths }),
  ]);

  const normalizedDemandRows = demandErr
    ? await getMonthlyDemandRowsWithFallback(svc, month, year, historyWindowMonths)
    : normalizeMonthlyDemandRows(demandData || []);
  if (movErr) throw movErr;
  const { productDemand, actualOutMap } = buildDemandSnapshotFromRows(normalizedDemandRows, month, year);

  const actualInMap = new Map<number, number>();

  for (const row of (movData || [])) {
    const ym = toYearMonthKey(Number(row.yr), Number(row.mn));
    if (ym !== targetYm) continue;
    actualInMap.set(Number(row.warehouse_product_id), Number(row.total_in || 0));
  }

  return { productDemand, actualInMap, actualOutMap };
}

// ============================================================
// TAX / PPN HELPER
// ============================================================

export async function getCurrentPPNRate(): Promise<number> {
  await requirePPICAccess();
  const svc = createServiceSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await svc
    .from('tax_rates')
    .select('rate')
    .eq('name', 'PPN')
    .lte('effective_from', today)
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.rate ? Number(data.rate) : 0;
}

// ============================================================
// PURCHASE ORDER — CRUD
// ============================================================

export interface POItem {
  warehouseProductId: number;
  quantityRequested: number;
  unitPrice?: number;
  notes?: string;
}

export interface CreatePOParams {
  vendorId: number;
  entity: string;
  poDate?: string;
  expectedDate?: string;
  notes?: string;
  shippingCost?: number;
  otherCost?: number;
  items: POItem[];
}

export async function createPurchaseOrder(params: CreatePOParams) {
  await requirePPICAccess('Purchase Orders');
  const { vendorId, entity, poDate, expectedDate, notes, shippingCost, otherCost, items } = params;
  if (!items || items.length === 0) throw new Error('PO harus memiliki minimal 1 item');

  const svc = createServiceSupabase();
  const userId = await getCurrentUserId();

  // Insert PO header (po_number auto-generated by trigger)
  const { data: po, error: poErr } = await svc
    .from('warehouse_purchase_orders')
    .insert({
      po_number: '', // trigger will fill
      vendor_id: vendorId,
      entity,
      po_date: poDate || new Date().toISOString().slice(0, 10),
      expected_date: expectedDate || null,
      status: 'draft',
      notes: notes || null,
      shipping_cost: shippingCost || 0,
      other_cost: otherCost || 0,
      created_by: userId,
    })
    .select('id, po_number')
    .single();
  if (poErr) throw poErr;

  // Insert items
  const itemRows = items.map(item => ({
    po_id: po.id,
    warehouse_product_id: item.warehouseProductId,
    quantity_requested: item.quantityRequested,
    quantity_received: 0,
    unit_price: item.unitPrice || 0,
    notes: item.notes || null,
  }));

  const { error: itemErr } = await svc
    .from('warehouse_po_items')
    .insert(itemRows);
  if (itemErr) throw itemErr;

  return po;
}

export async function getPurchaseOrders(filters?: {
  status?: string;
  vendorId?: number;
  entity?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}) {
  await requirePPICAccess('Purchase Orders');
  const svc = createServiceSupabase();
  let query = svc
    .from('warehouse_purchase_orders')
    .select(`
      *,
      warehouse_vendors!inner(id, name),
      warehouse_po_items(
        id, warehouse_product_id, quantity_requested, quantity_received, unit_price, notes,
        warehouse_products(id, name, category, entity, unit)
      )
    `)
    .order('po_date', { ascending: false });

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.vendorId) query = query.eq('vendor_id', filters.vendorId);
  if (filters?.entity) query = query.eq('entity', filters.entity);
  if (filters?.dateFrom) query = query.gte('po_date', filters.dateFrom);
  if (filters?.dateTo) query = query.lte('po_date', filters.dateTo);
  query = query.limit(filters?.limit || 100);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function savePOCosts(poId: number, shippingCost: number, otherCost: number) {
  await requirePPICAccess('Purchase Orders');
  const svc = createServiceSupabase();
  const { error } = await svc
    .from('warehouse_purchase_orders')
    .update({ shipping_cost: shippingCost, other_cost: otherCost })
    .eq('id', poId);
  if (error) throw error;
}

export async function getPurchaseOrderDetail(poId: number) {
  await requirePPICAccess('Purchase Orders');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_purchase_orders')
    .select(`
      *,
      warehouse_vendors(id, name, pic_name, phone, is_pkp),
      warehouse_po_items(
        id, warehouse_product_id, quantity_requested, quantity_received, unit_price, notes,
        warehouse_products(id, name, category, entity, unit, hpp)
      )
    `)
    .eq('id', poId)
    .single();
  if (error) throw error;

  // Fetch creator profile separately (avoids FK constraint name dependency)
  if (data?.created_by) {
    const { data: profile } = await svc.from('profiles').select('full_name, email').eq('id', data.created_by).single();
    (data as any).profiles = profile;
  }
  return data;
}

export async function submitPurchaseOrder(poId: number) {
  await requirePPICAccess('Purchase Orders');
  const svc = createServiceSupabase();

  const { data: po } = await svc
    .from('warehouse_purchase_orders')
    .select('id, status')
    .eq('id', poId)
    .single();
  if (!po) throw new Error('PO tidak ditemukan');
  if (po.status !== 'draft') throw new Error('Hanya PO draft yang bisa disubmit');

  // Ensure PO has items
  const { count } = await svc
    .from('warehouse_po_items')
    .select('id', { count: 'exact', head: true })
    .eq('po_id', poId);
  if (!count || count === 0) throw new Error('PO harus memiliki minimal 1 item');

  const { data, error } = await svc
    .from('warehouse_purchase_orders')
    .update({ status: 'submitted' })
    .eq('id', poId)
    .select()
    .single();
  if (error) throw error;

  // Send Telegram notification to Dir Ops (fire-and-forget)
  notifyPOSubmitted(svc, poId).catch(e => console.warn('[ppic] telegram PO notify failed:', e));

  return data;
}

// ── Telegram notification for PO submission ──
async function notifyPOSubmitted(svc: any, poId: number) {
  // Fetch full PO data
  const { data: po } = await svc
    .from('warehouse_purchase_orders')
    .select(`
      *, warehouse_vendors(name, is_pkp),
      warehouse_po_items(warehouse_product_id, quantity_requested, unit_price, warehouse_products(id, name))
    `)
    .eq('id', poId)
    .single();
  if (!po) return;

  // Fetch stock balance + avg daily demand for DOI
  const { data: stockData } = await svc.from('v_warehouse_stock_balance').select('product_id, current_stock');
  const stockMap = new Map<number, number>((stockData || []).map((s: any): [number, number] => [Number(s.product_id), Number(s.current_stock)]));

  const demandMap = await getAverageDailyDemandMap(svc, 90);

  const fmtRp = (n: number) => 'Rp ' + Math.round(n).toLocaleString('id-ID');
  const poDate = po.po_date ? new Date(po.po_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
  const expDate = po.expected_date ? new Date(po.expected_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

  let itemsText = '';
  let itemsTotal = 0;
  (po.warehouse_po_items || []).forEach((item: any, i: number) => {
    const name = item.warehouse_products?.name || '-';
    const qty = Number(item.quantity_requested);
    const price = Number(item.unit_price);
    const subtotal = qty * price;
    itemsTotal += subtotal;
    const productId = Number(item.warehouse_product_id);
    const stock = Number(stockMap.get(productId) || 0);
    const avgDaily = Number(demandMap.get(productId) || 0);
    const doi = avgDaily > 0 ? `~${Math.round(stock / avgDaily)} hari` : '-';
    itemsText += `\n${i + 1}. <b>${name}</b>\n   Qty: ${qty} | Harga: ${fmtRp(price)} | Subtotal: ${fmtRp(subtotal)}\n   Stok saat ini: ${stock.toLocaleString('id-ID')} | DOI: ${doi}\n`;
  });

  const shippingCost = Number(po.shipping_cost || 0);
  const otherCost = Number(po.other_cost || 0);
  const subtotalBeforePPN = itemsTotal + shippingCost + otherCost;

  // Check if vendor is PKP and calculate PPN
  const isVendorPKP = !!po.warehouse_vendors?.is_pkp;
  let ppnLine = '';
  let grandTotal = subtotalBeforePPN;
  if (isVendorPKP) {
    const ppnRate = await getCurrentPPNRate();
    const ppnAmount = Math.round(subtotalBeforePPN * ppnRate / 100);
    grandTotal = subtotalBeforePPN + ppnAmount;
    ppnLine = `\nPPN (${ppnRate}%): ${fmtRp(ppnAmount)}`;
  }

  const vendorLabel = (po.warehouse_vendors?.name || '-') + (isVendorPKP ? ' [PKP]' : '');
  const msg = `\u{1F4CB} <b>Purchase Order Submitted</b>\n\nNo PO: <b>${po.po_number}</b>\nVendor: ${vendorLabel}\nTanggal PO: ${poDate}\nGudang: ${po.entity}\nExp. Delivery: ${expDate}\n${itemsText}\nOngkir: ${fmtRp(shippingCost)}\nBiaya Lain: ${fmtRp(otherCost)}${ppnLine}\n<b>Total: ${fmtRp(grandTotal)}</b>`;

  // Send to all direktur_ops (and legacy direktur_operasional)
  const { data: direkturs } = await svc
    .from('profiles')
    .select('telegram_chat_id')
    .in('role', ['direktur_ops', 'direktur_operasional'])
    .not('telegram_chat_id', 'is', null);

  if (direkturs && direkturs.length > 0) {
    await Promise.allSettled(
      direkturs.map((d: any) => sendTelegramToChat(d.telegram_chat_id, msg))
    );
  }
}

export async function cancelPurchaseOrder(poId: number) {
  await requirePPICAccess('Purchase Orders');
  const svc = createServiceSupabase();

  const { data: po } = await svc
    .from('warehouse_purchase_orders')
    .select('id, status')
    .eq('id', poId)
    .single();
  if (!po) throw new Error('PO tidak ditemukan');
  if (!['draft', 'submitted'].includes(po.status)) throw new Error('Hanya PO draft/submitted yang bisa dibatalkan');

  const { data, error } = await svc
    .from('warehouse_purchase_orders')
    .update({ status: 'cancelled' })
    .eq('id', poId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ============================================================
// PURCHASE ORDER — RECEIVE ITEMS
// ============================================================

export interface ReceiveItem {
  poItemId: number;
  quantityReceived: number;
  batchCode: string;
  expiredDate?: string | null;
}

export async function receivePOItems(poId: number, receivedItems: ReceiveItem[]) {
  await requirePPICAccess('Purchase Orders');
  if (!receivedItems || receivedItems.length === 0) throw new Error('Tidak ada item yang diterima');

  const svc = createServiceSupabase();

  // Get PO with items (include unit_price + PO-level costs)
  const { data: po } = await svc
    .from('warehouse_purchase_orders')
    .select(`
      id, status, po_number, shipping_cost, other_cost,
      warehouse_po_items(id, warehouse_product_id, quantity_requested, quantity_received, unit_price)
    `)
    .eq('id', poId)
    .single();
  if (!po) throw new Error('PO tidak ditemukan');
  if (!['submitted', 'partial'].includes(po.status)) throw new Error('PO harus berstatus submitted atau partial');

  // Calculate proportional extra cost distribution
  const poExtraCost = Number(po.shipping_cost || 0) + Number(po.other_cost || 0);
  const poItems = po.warehouse_po_items || [];
  const totalPoValue = poItems.reduce((s: number, pi: any) =>
    s + Number(pi.unit_price || 0) * Number(pi.quantity_requested), 0);

  const results: any[] = [];
  const affectedProductIds = new Set<number>();
  const receivedByPoItem = new Map<number, number>();

  for (const item of receivedItems) {
    if (item.quantityReceived <= 0) continue;

    // Find matching PO item
    const poItem = poItems.find((pi: any) => pi.id === item.poItemId);
    if (!poItem) throw new Error(`PO item #${item.poItemId} tidak ditemukan`);

    const remaining = Number(poItem.quantity_requested) - Number(poItem.quantity_received);
    const cumulativeReceived = (receivedByPoItem.get(item.poItemId) || 0) + item.quantityReceived;
    if (cumulativeReceived > remaining) {
      throw new Error(`Qty melebihi sisa (${remaining}) untuk item #${item.poItemId}`);
    }

    // Calculate landed cost per unit for this batch
    const unitPrice = Number(poItem.unit_price || 0);
    let costPerUnit = unitPrice;
    if (poExtraCost > 0 && totalPoValue > 0) {
      const itemValue = unitPrice * Number(poItem.quantity_requested);
      const itemShare = itemValue / totalPoValue;
      const itemExtraCost = poExtraCost * itemShare;
      costPerUnit = unitPrice + itemExtraCost / Number(poItem.quantity_requested);
    }

    // Create batch
    const batch = await createBatchInternal(
      poItem.warehouse_product_id,
      item.batchCode,
      item.expiredDate || null,
      0, // initial qty 0 — we'll use recordStockIn for the ledger entry
    );

    // Set cost_per_unit on batch
    await svc
      .from('warehouse_batches')
      .update({ cost_per_unit: Math.round(costPerUnit * 100) / 100 })
      .eq('id', batch.id);

    // Record stock in (creates ledger entry + updates batch qty)
    await recordStockInInternal(
      poItem.warehouse_product_id,
      batch.id,
      item.quantityReceived,
      'purchase_order',
      String(poId),
      `PO ${po.po_number} - batch ${item.batchCode} (HPP: ${Math.round(costPerUnit).toLocaleString()}/unit)`,
    );

    // Update PO item received qty
    const newReceived = Number(poItem.quantity_received) + cumulativeReceived;
    await svc
      .from('warehouse_po_items')
      .update({ quantity_received: newReceived })
      .eq('id', item.poItemId);

    receivedByPoItem.set(item.poItemId, cumulativeReceived);
    poItem.quantity_received = newReceived;
    affectedProductIds.add(poItem.warehouse_product_id);
    results.push({ poItemId: item.poItemId, batchId: batch.id, received: item.quantityReceived, costPerUnit });
  }

  // Recalculate weighted avg HPP for each affected product
  for (const productId of Array.from(affectedProductIds)) {
    await recalculateProductHpp(svc, productId);
  }

  // Check if all items fully received → set PO status
  const { data: allItems } = await svc
    .from('warehouse_po_items')
    .select('quantity_requested, quantity_received')
    .eq('po_id', poId);

  const allFullyReceived = (allItems || []).every(
    (i: any) => Number(i.quantity_received) >= Number(i.quantity_requested)
  );
  const anyReceived = (allItems || []).some(
    (i: any) => Number(i.quantity_received) > 0
  );

  const newStatus = allFullyReceived ? 'completed' : anyReceived ? 'partial' : po.status;
  await svc
    .from('warehouse_purchase_orders')
    .update({ status: newStatus })
    .eq('id', poId);

  return { poId, status: newStatus, items: results };
}

// Recalculate product-level HPP from weighted average of active batches
async function recalculateProductHpp(svc: any, productId: number) {
  const { data: batches } = await svc
    .from('warehouse_batches')
    .select('current_qty, cost_per_unit')
    .eq('warehouse_product_id', productId)
    .eq('is_active', true)
    .gt('current_qty', 0);

  if (!batches || batches.length === 0) return;

  const batchesWithCost = batches.filter((b: any) => Number(b.cost_per_unit) > 0);
  if (batchesWithCost.length === 0) return;

  const totalQty = batchesWithCost.reduce((s: number, b: any) => s + Number(b.current_qty), 0);
  if (totalQty <= 0) return;

  const weightedSum = batchesWithCost.reduce((s: number, b: any) =>
    s + Number(b.current_qty) * Number(b.cost_per_unit), 0);
  const avgHpp = Math.round((weightedSum / totalQty) * 100) / 100;

  await svc
    .from('warehouse_products')
    .update({ hpp: avgHpp })
    .eq('id', productId);
}

// ============================================================
// DEMAND PLANNING
// ============================================================

export async function getWeeklyDemandData(month: number, year: number) {
  await requirePPICAccess('Demand Planning');
  const svc = createServiceSupabase();
  const daysInMonth = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  const monthStart = `${year}-${mm}-01T00:00:00+07:00`;
  const monthEnd = `${year}-${mm}-${daysInMonth}T23:59:59+07:00`;

  // Use single RPC to get weekly breakdown (much faster than multiple paginated queries)
  const { data, error } = await svc.rpc('ppic_weekly_demand_scalev', {
    p_month_start: monthStart,
    p_month_end: monthEnd,
  });

  if (error) {
    return getWeeklyDemandDataFallback(svc, month, year);
  }

  // Build result from RPC
  const result: Record<number, any> = {};
  for (const row of (data || [])) {
    if (!result[row.warehouse_product_id]) {
      result[row.warehouse_product_id] = { w1_out: 0, w2_out: 0, w3_out: 0, w4_out: 0 };
    }
    (result[row.warehouse_product_id] as any)[`w${row.week_num}_out`] = Number(row.total_out);
  }
  return result;
}

export async function getDemandPlans(month: number, year: number) {
  await requirePPICAccess('Demand Planning');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_demand_plans')
    .select(`
      *,
      warehouse_products(id, name, category, entity, unit)
    `)
    .eq('month', month)
    .eq('year', year)
    .order('warehouse_product_id');
  if (error) throw error;

  const { actualInMap, actualOutMap } = await getDemandPlanningSnapshot(svc, month, year);

  return (data || []).map((plan: any) => ({
    ...plan,
    actual_in: actualInMap.get(plan.warehouse_product_id) ?? Number(plan.actual_in || 0),
    actual_out: actualOutMap.get(plan.warehouse_product_id) ?? Number(plan.actual_out || 0),
  }));
}

export async function initDemandPlans(month: number, year: number) {
  await requirePPICAccess('Demand Planning');
  const svc = createServiceSupabase();
  const { productDemand, actualInMap, actualOutMap } = await getDemandPlanningSnapshot(svc, month, year);

  // Get all active products
  const { data: products } = await svc
    .from('warehouse_products')
    .select('id')
    .eq('is_active', true);

  // Upsert demand plans
  const rows = (products || []).map(p => {
    return {
      warehouse_product_id: p.id,
      month,
      year,
      auto_demand: productDemand.get(p.id) || 0,
      actual_in: actualInMap.get(p.id) || 0,
      actual_out: actualOutMap.get(p.id) || 0,
    };
  });

  // Upsert in batches
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await svc
      .from('warehouse_demand_plans')
      .upsert(batch, { onConflict: 'warehouse_product_id,month,year' });
    if (error) throw error;
  }

  return { count: rows.length };
}

export async function updateDemandPlan(
  productId: number,
  month: number,
  year: number,
  manualDemand: number | null,
  notes?: string,
) {
  await requirePPICAccess('Demand Planning');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_demand_plans')
    .upsert({
      warehouse_product_id: productId,
      month,
      year,
      manual_demand: manualDemand,
      notes: notes || null,
    }, { onConflict: 'warehouse_product_id,month,year' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ============================================================
// ITO (Inventory Turn Over)
// ============================================================

export async function getITOData(months: number = 6, source: 'warehouse' | 'scalev' = 'warehouse') {
  await requirePPICAccess('Inventory Turn Over');
  const svc = createServiceSupabase();

  // Get monthly movements (from warehouse ledger or Scalev orders)
  const rpcName = source === 'scalev' ? 'ppic_monthly_movements_scalev' : 'ppic_monthly_movements';
  const { data: movements, error: movErr } = await svc.rpc(rpcName, { p_months: months });
  if (movErr) throw movErr;

  // Get current stock balance
  const { data: stockData } = await svc.from('v_warehouse_stock_balance').select('*');

  // Get products with HPP
  const { data: products } = await svc
    .from('warehouse_products')
    .select('id, name, category, entity, hpp, price_list, unit')
    .eq('is_active', true)
    .order('name');

  // Build product map
  const productMap = new Map<number, any>();
  for (const p of (products || [])) {
    productMap.set(p.id, { ...p, months: [] as any[] });
  }

  // Group movements by product + month
  for (const m of (movements || [])) {
    const prod = productMap.get(m.warehouse_product_id);
    if (prod) {
      prod.months.push({
        year: m.yr,
        month: m.mn,
        total_in: Number(m.total_in),
        total_out: Number(m.total_out),
      });
    }
  }

  // Map stock balances
  const stockMap = new Map<number, number>();
  for (const s of (stockData || [])) {
    stockMap.set(s.product_id, Number(s.current_stock || 0));
  }

  // Calculate ITO per product
  const result = Array.from(productMap.values()).map(prod => {
    const currentStock = stockMap.get(prod.id) || 0;
    const hpp = Number(prod.hpp) || 0;
    const priceList = Number(prod.price_list) || 0;

    // Calculate ITO per month
    const monthlyITO = prod.months.map((m: any) => ({
      year: m.year,
      month: m.month,
      total_out: m.total_out,
      total_in: m.total_in,
      ito: currentStock > 0 ? Math.round((m.total_out * 12 / currentStock) * 100) / 100 : 0,
    }));

    // Avg daily out = total out across all months / total days
    const totalOut = prod.months.reduce((s: number, m: any) => s + Number(m.total_out), 0);
    const totalDays = prod.months.length * 30; // approximate days
    const avgOutPerDay = totalDays > 0 ? Math.round((totalOut / totalDays) * 100) / 100 : 0;
    const daysOfStock = avgOutPerDay > 0 ? Math.round(currentStock / avgOutPerDay) : currentStock > 0 ? 999 : 0;

    return {
      product_id: prod.id,
      product_name: prod.name,
      category: prod.category,
      entity: prod.entity,
      unit: prod.unit,
      hpp,
      price_list: priceList,
      stock_value_hpp: currentStock * hpp,
      stock_value_price: currentStock * priceList,
      current_stock: currentStock,
      avg_out_per_day: avgOutPerDay,
      days_of_stock: daysOfStock,
      months: monthlyITO,
    };
  });

  return result;
}

// ============================================================
// ROP (Reorder Point)
// ============================================================

export async function getROPAnalysis(demandDays: number = 90) {
  await requirePPICAccess('Reorder Point');
  const svc = createServiceSupabase();

  const demandMap = await getAverageDailyDemandMap(svc, demandDays);

  // Get current stock
  const { data: stockData } = await svc.from('v_warehouse_stock_balance').select('*');
  const stockMap = new Map<number, number>();
  for (const s of (stockData || [])) {
    stockMap.set(s.product_id, Number(s.current_stock || 0));
  }

  // Get product ROP config
  const { data: products } = await svc
    .from('warehouse_products')
    .select('id, name, category, entity, unit, lead_time_days, safety_stock_days')
    .eq('is_active', true);

  const result = (products || []).map(p => {
    const avgDaily = demandMap.get(p.id) || 0;
    const currentStock = stockMap.get(p.id) || 0;
    const leadTime = p.lead_time_days || 7;
    const safetyDays = p.safety_stock_days || 3;
    const safetyStockQty = Math.ceil(avgDaily * safetyDays);
    const rop = Math.ceil(avgDaily * leadTime) + safetyStockQty;
    const daysOfStock = avgDaily > 0 ? Math.round(currentStock / avgDaily) : 999;

    let status: 'critical' | 'reorder' | 'ok' = 'ok';
    if (currentStock <= safetyStockQty) status = 'critical';
    else if (currentStock <= rop) status = 'reorder';

    return {
      product_id: p.id,
      product_name: p.name,
      category: p.category,
      entity: p.entity,
      unit: p.unit,
      current_stock: currentStock,
      avg_daily: avgDaily,
      lead_time_days: leadTime,
      safety_stock_days: safetyDays,
      safety_stock_qty: safetyStockQty,
      rop,
      days_of_stock: daysOfStock,
      status,
    };
  });

  return result.sort((a, b) => {
    const statusOrder = { critical: 0, reorder: 1, ok: 2 };
    return statusOrder[a.status] - statusOrder[b.status] || a.product_name.localeCompare(b.product_name);
  });
}

export async function updateProductROPConfig(
  productId: number,
  leadTimeDays: number,
  safetyStockDays: number,
) {
  await requirePPICAccess('Reorder Point');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_products')
    .update({ lead_time_days: leadTimeDays, safety_stock_days: safetyStockDays })
    .eq('id', productId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ============================================================
// VENDOR HELPER (re-export for convenience)
// ============================================================

export async function getVendors() {
  await requirePPICAccess('Purchase Orders');
  const svc = createServiceSupabase();
  const { data, error } = await svc
    .from('warehouse_vendors')
    .select('*')
    .order('name');
  if (error) throw error;
  return data || [];
}
