import { existsSync, readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

import { runScalevSync } from '../../lib/scalev-sync-runner';

type Args = {
  workspace: string;
  from: string;
  to: string;
  platform: string;
  business: string | null;
  apply: boolean;
};

function loadLocalEnv() {
  const path = '.env.local';
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const separator = line.indexOf('=');
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function argValue(name: string) {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
}

function parseArgs(): Args {
  const workspace = argValue('workspace');
  const from = argValue('from');
  const to = argValue('to');
  const platform = (argValue('platform') || 'shopee').toLowerCase();
  const business = argValue('business');

  if (!workspace) throw new Error('Use --workspace=roove (or a workspace UUID).');
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error('Use --from=YYYY-MM-DD and --to=YYYY-MM-DD.');
  }
  if (from > to) throw new Error('--from must not be after --to.');

  return {
    workspace,
    from,
    to,
    platform,
    business,
    apply: process.argv.includes('--apply'),
  };
}

function jakartaDate(value: unknown) {
  const parsed = new Date(String(value || ''));
  if (Number.isNaN(parsed.getTime())) return 'unknown';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
}

async function resolveWorkspaceId(svc: any, workspace: string) {
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(workspace)) return workspace;
  const { data, error } = await svc
    .from('workspaces')
    .select('id, slug')
    .eq('slug', workspace)
    .single();
  if (error) throw error;
  return String(data.id);
}

async function loadMissingOrders(svc: any, workspaceId: string, args: Args) {
  const orders: any[] = [];
  const pageSize = 1000;

  for (let fromRow = 0; ; fromRow += pageSize) {
    let query = svc
      .from('scalev_orders')
      .select('id, order_id, business_code, platform, shipped_time, raw_data')
      .eq('workspace_id', workspaceId)
      .in('status', ['shipped', 'completed'])
      .gte('shipped_time', `${args.from}T00:00:00+07:00`)
      .lte('shipped_time', `${args.to}T23:59:59.999+07:00`)
      .eq('platform', args.platform)
      .order('id', { ascending: true })
      .range(fromRow, fromRow + pageSize - 1);
    if (args.business) query = query.eq('business_code', args.business);

    const { data, error } = await query;
    if (error) throw error;
    orders.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  const idsWithLines = new Set<number>();
  for (let index = 0; index < orders.length; index += 200) {
    const ids = orders.slice(index, index + 200).map((order) => order.id);
    const { data, error } = await svc
      .from('scalev_order_lines')
      .select('scalev_order_id')
      .eq('workspace_id', workspaceId)
      .in('scalev_order_id', ids)
      .limit(10000);
    if (error) throw error;
    (data || []).forEach((row: any) => idsWithLines.add(Number(row.scalev_order_id)));
  }

  return orders.filter((order) => !idsWithLines.has(order.id));
}

function summarizeMissing(orders: any[]) {
  const byDate: Record<string, { orders: number; raw_lines: number; gross_line_value: number }> = {};
  let repairable = 0;
  let grossLineValue = 0;

  for (const order of orders) {
    const date = jakartaDate(order.shipped_time);
    const rawLines = Array.isArray(order.raw_data?.orderlines) ? order.raw_data.orderlines : [];
    const orderGross = rawLines.reduce((sum: number, line: any) => (
      sum + (Number(line.product_price) || 0) - (Number(line.discount) || 0)
    ), 0);
    if (rawLines.length > 0) repairable++;
    grossLineValue += orderGross;
    byDate[date] ||= { orders: 0, raw_lines: 0, gross_line_value: 0 };
    byDate[date].orders++;
    byDate[date].raw_lines += rawLines.length;
    byDate[date].gross_line_value += orderGross;
  }

  return {
    missing_orders: orders.length,
    repairable_from_raw_data: repairable,
    gross_line_value: Math.round(grossLineValue),
    by_date: byDate,
  };
}

async function main() {
  loadLocalEnv();
  const args = parseArgs();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Missing Supabase service environment variables.');

  const svc = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const workspaceId = await resolveWorkspaceId(svc, args.workspace);
  const missingBefore = await loadMissingOrders(svc, workspaceId, args);

  console.log(JSON.stringify({
    mode: args.apply ? 'apply' : 'dry-run',
    workspace_id: workspaceId,
    filters: {
      from: args.from,
      to: args.to,
      platform: args.platform,
      business: args.business,
    },
    before: summarizeMissing(missingBefore),
  }, null, 2));

  if (!args.apply || missingBefore.length === 0) return;
  const notRepairable = missingBefore.filter((order) => !Array.isArray(order.raw_data?.orderlines) || order.raw_data.orderlines.length === 0);
  if (notRepairable.length > 0) {
    throw new Error(`${notRepairable.length} missing order(s) have no raw_data.orderlines; aborting before changes.`);
  }

  const results = [];
  const repairErrors: Array<Record<string, any>> = [];
  for (let index = 0; index < missingBefore.length; index += 25) {
    const orderIds = missingBefore.slice(index, index + 25).map((order) => String(order.order_id));
    const result = await runScalevSync({
      workspaceId,
      syncMode: 'repair',
      targetOrderIds: orderIds,
      skipWarehouseReconcile: true,
    });
    results.push(result);
    if (result.orders_errored > 0) {
      repairErrors.push(...result.details.filter((detail) => detail.error));
    }
  }

  const missingAfter = await loadMissingOrders(svc, workspaceId, args);
  console.log(JSON.stringify({
    applied_batches: results.length,
    repaired_reported: results.reduce((sum, result) => sum + result.orders_repaired, 0),
    repair_errors: repairErrors,
    after: summarizeMissing(missingAfter),
  }, null, 2));

  if (missingAfter.length > 0) {
    throw new Error(`${missingAfter.length} order(s) still have no order lines after repair.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
