import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

import { resolveWarehouseOrderContextFromLookups } from '../lib/warehouse-order-context';
import {
  fetchWarehouseBusinessDirectoryRows,
  fetchWarehouseOriginRegistryRows,
} from '../lib/warehouse-domain-helpers';

const DEFAULT_FROM_DATE = '2026-04-21';

function parseEnvFile(path: string) {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const idx = line.indexOf('=');
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        return [line.slice(0, idx), value];
      }),
  );
}

function getTodayJakartaDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function parseArgs() {
  const fromDate = process.argv.find((arg) => arg.startsWith('--from='))?.split('=')[1] || DEFAULT_FROM_DATE;
  const toDate = process.argv.find((arg) => arg.startsWith('--to='))?.split('=')[1] || getTodayJakartaDate();
  const batchSize = Math.max(
    1,
    Number(
      process.argv.find((arg) => arg.startsWith('--batch-size='))?.split('=')[1]
      || '200',
    ) || 200,
  );

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new Error('Gunakan format tanggal YYYY-MM-DD untuk --from dan --to.');
  }
  if (fromDate > toDate) {
    throw new Error(`Tanggal awal ${fromDate} tidak boleh lebih besar dari tanggal akhir ${toDate}.`);
  }

  return {
    apply: process.argv.includes('--apply'),
    batchSize,
    fromDate,
    toDate,
  };
}

function nextDayStart(date: string) {
  const parsed = new Date(`${date}T00:00:00+07:00`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString();
}

function toOrderIdPrefix(date: string) {
  const [year, month, day] = date.split('-');
  return `${year.slice(2)}${month}${day}`;
}

const env = parseEnvFile('.env.local');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const config = parseArgs();
  const [businessDirectoryRows, originRegistryRows] = await Promise.all([
    fetchWarehouseBusinessDirectoryRows(supabase as any),
    fetchWarehouseOriginRegistryRows(supabase as any),
  ]);
  const summary = {
    apply: config.apply,
    fromDate: config.fromDate,
    toDate: config.toDate,
    scanned: 0,
    changed: 0,
    updated: 0,
  };

  let lastOrderId = '';
  const fromOrderIdPrefix = toOrderIdPrefix(config.fromDate);
  const toOrderIdPrefixExclusive = toOrderIdPrefix(nextDayStart(config.toDate).slice(0, 10));
  for (;;) {
    let idQuery = supabase
      .from('scalev_orders')
      .select('id, order_id')
      .gte('order_id', fromOrderIdPrefix)
      .lt('order_id', toOrderIdPrefixExclusive)
      .order('order_id', { ascending: true })
      .limit(config.batchSize);
    if (lastOrderId) {
      idQuery = idQuery.gt('order_id', lastOrderId);
    }
    const { data: idRows, error: idError } = await idQuery;

    if (idError) throw idError;
    const ids = (idRows || []).map((row) => Number(row.id)).filter(Boolean);
    if (ids.length === 0) break;

    const { data: rows, error } = await supabase
      .from('scalev_orders')
      .select(`
        id,
        order_id,
        business_code,
        raw_data,
        business_name_raw,
        origin_business_name_raw,
        origin_raw,
        seller_business_code,
        origin_operator_business_code,
        origin_registry_id,
        synced_at
      `)
      .in('id', ids)
      .order('id', { ascending: true });

    if (error) throw error;
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      summary.scanned++;
      const context = resolveWarehouseOrderContextFromLookups({
        data: row.raw_data || {},
        businessCode: row.business_code || '',
        businessDirectoryRows,
        originRegistryRows,
      });
      const updateData: Record<string, any> = {
        business_name_raw: context.businessNameRaw,
        origin_business_name_raw: context.originBusinessNameRaw,
        origin_raw: context.originRaw,
        seller_business_code: context.sellerBusinessCode,
        origin_operator_business_code: context.originOperatorBusinessCode,
        origin_registry_id: context.originRegistryId,
      };

      const changed = (
        (row.business_name_raw || null) !== (updateData.business_name_raw || null)
        || (row.origin_business_name_raw || null) !== (updateData.origin_business_name_raw || null)
        || (row.origin_raw || null) !== (updateData.origin_raw || null)
        || (row.seller_business_code || null) !== (updateData.seller_business_code || null)
        || (row.origin_operator_business_code || null) !== (updateData.origin_operator_business_code || null)
        || Number(row.origin_registry_id || 0) !== Number(updateData.origin_registry_id || 0)
      );

      if (!changed) continue;
      summary.changed++;

      if (config.apply) {
        const { error: updateError } = await supabase
          .from('scalev_orders')
          .update(updateData)
          .eq('id', row.id);
        if (updateError) throw updateError;
        summary.updated++;
      }
    }

    console.log(JSON.stringify({
      lastOrderId,
      scanned: summary.scanned,
      changed: summary.changed,
      updated: summary.updated,
    }));

    if (rows.length < config.batchSize) break;
    lastOrderId = String(idRows[idRows.length - 1]?.order_id || lastOrderId);
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
