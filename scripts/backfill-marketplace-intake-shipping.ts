import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

import { resolveMarketplaceIntakeShippingFinancials } from '../lib/marketplace-intake-shipping';

type ScalevOrderRow = {
  id: number;
  order_id: string | null;
  external_id: string | null;
  shipping_cost: number | null;
  shipping_discount: number | null;
  raw_data: Record<string, unknown> | null;
  marketplace_intake_order_id: number | null;
  marketplace_intake_batch_id: number | null;
};

type IntakeBatchRow = {
  id: number;
  business_code: string;
  raw_snapshot?: Record<string, unknown> | null;
};

type IntakeOrderRow = {
  id: number;
  batch_id: number | null;
  raw_meta: Record<string, unknown> | null;
};

type IntakeLineRow = {
  intake_order_id: number;
  line_index: number;
  raw_row: Record<string, unknown> | null;
};

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

function parseArgs() {
  const fromShippedDate = process.argv.find((arg) => arg.startsWith('--from-shipped-date='))?.split('=')[1] || null;
  const toShippedDate = process.argv.find((arg) => arg.startsWith('--to-shipped-date='))?.split('=')[1] || null;
  const intakeBatchIds = (process.argv.find((arg) => arg.startsWith('--intake-batch-ids='))?.split('=')[1] || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (fromShippedDate && !/^\d{4}-\d{2}-\d{2}$/.test(fromShippedDate)) {
    throw new Error('Gunakan format YYYY-MM-DD untuk --from-shipped-date.');
  }
  if (toShippedDate && !/^\d{4}-\d{2}-\d{2}$/.test(toShippedDate)) {
    throw new Error('Gunakan format YYYY-MM-DD untuk --to-shipped-date.');
  }

  return {
    apply: process.argv.includes('--apply'),
    batchSize: Math.max(
      1,
      Number(process.argv.find((arg) => arg.startsWith('--batch-size='))?.split('=')[1] || '100') || 100,
    ),
    concurrency: Math.max(
      1,
      Number(process.argv.find((arg) => arg.startsWith('--concurrency='))?.split('=')[1] || '10') || 10,
    ),
    maxBatches: Math.max(
      0,
      Number(process.argv.find((arg) => arg.startsWith('--max-batches='))?.split('=')[1] || '0') || 0,
    ),
    intakeBatchIds,
    startId: Math.max(
      0,
      Number(process.argv.find((arg) => arg.startsWith('--start-id='))?.split('=')[1] || '0') || 0,
    ),
    scalevIdStart: Math.max(
      0,
      Number(process.argv.find((arg) => arg.startsWith('--scalev-id-start='))?.split('=')[1] || '0') || 0,
    ),
    scalevIdEnd: Math.max(
      0,
      Number(process.argv.find((arg) => arg.startsWith('--scalev-id-end='))?.split('=')[1] || '0') || 0,
    ),
    fromShippedDate,
    toShippedDate,
  };
}

function buildDayStart(date: string) {
  return `${date}T00:00:00+07:00`;
}

function buildNextDayStart(date: string) {
  const parsed = new Date(`${date}T00:00:00+07:00`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  const nextYear = parsed.getUTCFullYear();
  const nextMonth = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(parsed.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}T00:00:00+07:00`;
}

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function withRetries<T>(label: string, fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      const delayMs = Math.min(10_000, attempt * 1_000);
      console.warn(JSON.stringify({ label, attempt, delayMs, error: formatError(error) }));
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function shouldRetrySupabaseResponse(result: any): boolean {
  const code = String(result?.error?.code || '');
  const message = String(result?.error?.message || '').toLowerCase();
  return (
    code === '57014'
    || code === 'PGRST003'
    || message.includes('statement timeout')
    || message.includes('timed out acquiring connection')
    || message.includes('fetch failed')
  );
}

async function withSupabaseRetries<T extends { error?: any }>(
  label: string,
  fn: () => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  return withRetries(label, async () => {
    const result = await fn();
    if (result?.error && shouldRetrySupabaseResponse(result)) {
      throw new Error(`${result.error.code || 'supabase_error'}:${result.error.message || 'unknown error'}`);
    }
    return result;
  }, maxAttempts);
}

function parseNullableAmount(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function resolveIntakeOrderId(row: ScalevOrderRow): number | null {
  const topLevel = Number(row.marketplace_intake_order_id || 0);
  if (Number.isFinite(topLevel) && topLevel > 0) return topLevel;

  const rawValue = row.raw_data && typeof row.raw_data === 'object'
    ? (row.raw_data as Record<string, unknown>).marketplace_intake_order_id
    : null;
  const fromRawData = Number(rawValue || 0);
  return Number.isFinite(fromRawData) && fromRawData > 0 ? fromRawData : null;
}

function normalizeProjectionRows(value: unknown, shippingCost: number) {
  if (!Array.isArray(value)) return value;
  return value.map((row, index) => (
    index === 0 && row && typeof row === 'object'
      ? { ...(row as Record<string, unknown>), shipping_cost: String(shippingCost) }
      : row
  ));
}

function hasMeaningfulChange(input: {
  row: ScalevOrderRow;
  nextShippingCost: number;
  nextShippingDiscount: number | null;
  nextIntakeOrderId: number;
  nextIntakeBatchId: number | null;
}) {
  const currentShippingCost = parseNullableAmount(input.row.shipping_cost) || 0;
  const currentShippingDiscount = parseNullableAmount(input.row.shipping_discount);
  const currentIntakeOrderId = Number(input.row.marketplace_intake_order_id || 0) || null;
  const currentIntakeBatchId = Number(input.row.marketplace_intake_batch_id || 0) || null;

  return (
    currentShippingCost !== input.nextShippingCost
    || currentShippingDiscount !== input.nextShippingDiscount
    || currentIntakeOrderId !== input.nextIntakeOrderId
    || currentIntakeBatchId !== input.nextIntakeBatchId
  );
}

const env = parseEnvFile('.env.local');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const config = parseArgs();
  const summary = {
    apply: config.apply,
    batchSize: config.batchSize,
    concurrency: config.concurrency,
    intakeBatchIds: config.intakeBatchIds,
    maxBatches: config.maxBatches,
    scalevIdStart: config.scalevIdStart,
    scalevIdEnd: config.scalevIdEnd,
    startId: config.startId,
    fromShippedDate: config.fromShippedDate,
    toShippedDate: config.toShippedDate,
    batches: 0,
    scanned: 0,
    foundIntake: 0,
    changed: 0,
    updated: 0,
    unresolved: 0,
    lastId: config.startId,
  };

  let lastId = config.startId;
  const samples: Array<Record<string, unknown>> = [];

  if (config.scalevIdStart > 0 && config.scalevIdEnd >= config.scalevIdStart) {
    const explicitIds = Array.from(
      { length: config.scalevIdEnd - config.scalevIdStart + 1 },
      (_, index) => config.scalevIdStart + index,
    );
    const scalevRows: ScalevOrderRow[] = [];
    for (const chunk of chunkValues(explicitIds, 20)) {
      const { data, error } = await withSupabaseRetries(
        'fetch-scalev-explicit-ids',
        async () => await supabase
          .from('scalev_orders')
          .select([
            'id',
            'order_id',
            'external_id',
            'shipping_cost',
            'shipping_discount',
            'raw_data',
            'marketplace_intake_order_id',
            'marketplace_intake_batch_id',
            'source',
          ].join(','))
          .in('id', chunk),
      );
      if (error) throw error;
      scalevRows.push(...((data || []) as ScalevOrderRow[]));
    }

    const rows = scalevRows
      .filter((row) => row.source === 'marketplace_api_upload')
      .sort((left, right) => Number(left.id) - Number(right.id));
    summary.batches = 1;
    summary.scanned = rows.length;

    const intakeOrderIds = Array.from(new Set(
      rows
        .map((row) => resolveIntakeOrderId(row))
        .filter((value): value is number => Number.isFinite(value) && value > 0),
    ));
    const intakeOrdersById = new Map<number, IntakeOrderRow>();
    const linesByOrderId = new Map<number, IntakeLineRow[]>();

    if (intakeOrderIds.length > 0) {
      const { data: intakeOrders, error: intakeOrdersError } = await withSupabaseRetries(
        'fetch-intake-orders-by-id',
        async () => await supabase
          .from('marketplace_intake_orders')
          .select('id, batch_id, raw_meta')
          .in('id', intakeOrderIds),
      );
      if (intakeOrdersError) throw intakeOrdersError;

      for (const row of (intakeOrders || []) as IntakeOrderRow[]) {
        intakeOrdersById.set(Number(row.id), row);
      }

      const { data: intakeLines, error: intakeLinesError } = await withSupabaseRetries(
        'fetch-intake-lines-by-id',
        async () => await supabase
          .from('marketplace_intake_order_lines')
          .select('intake_order_id, line_index, raw_row')
          .in('intake_order_id', intakeOrderIds)
          .order('intake_order_id', { ascending: true })
          .order('line_index', { ascending: true }),
      );
      if (intakeLinesError) throw intakeLinesError;

      for (const row of (intakeLines || []) as IntakeLineRow[]) {
        const orderId = Number(row.intake_order_id);
        if (!linesByOrderId.has(orderId)) linesByOrderId.set(orderId, []);
        linesByOrderId.get(orderId)!.push(row);
      }
    }

    const pendingUpdates: Array<{ id: number; payload: Record<string, unknown> }> = [];
    for (const row of rows) {
      const intakeOrderId = resolveIntakeOrderId(row);
      if (!intakeOrderId) {
        summary.unresolved += 1;
        continue;
      }

      const intakeOrder = intakeOrdersById.get(intakeOrderId);
      if (!intakeOrder) {
        summary.unresolved += 1;
        continue;
      }

      summary.foundIntake += 1;
      const intakeLines = linesByOrderId.get(intakeOrderId) || [];
      const shipping = resolveMarketplaceIntakeShippingFinancials({
        rawMeta: intakeOrder.raw_meta || {},
        rawRows: intakeLines.map((line) => line.raw_row || {}),
      });

      if (!shipping.present) {
        summary.unresolved += 1;
        continue;
      }

      const nextShippingCost = shipping.grossAmount;
      const nextShippingDiscount = nextShippingCost === 0
        ? 0
        : (shipping.companyDiscountPresent ? Math.min(shipping.companyDiscountAmount, nextShippingCost) : null);

      if (!hasMeaningfulChange({
        row,
        nextShippingCost,
        nextShippingDiscount,
        nextIntakeOrderId: intakeOrderId,
        nextIntakeBatchId: intakeOrder.batch_id,
      })) {
        continue;
      }

      summary.changed += 1;
      const nextRawData = {
        ...(row.raw_data || {}),
        marketplace_intake_batch_id: intakeOrder.batch_id,
        marketplace_intake_order_id: intakeOrderId,
        shipping_cost: nextShippingCost,
        shipping_discount: nextShippingDiscount,
        shipping_financials: shipping,
        projection_rows: normalizeProjectionRows(row.raw_data?.projection_rows, nextShippingCost),
      };
      const payload = {
        shipping_cost: nextShippingCost,
        shipping_discount: nextShippingDiscount,
        marketplace_intake_batch_id: intakeOrder.batch_id,
        marketplace_intake_order_id: intakeOrderId,
        raw_data: nextRawData,
        synced_at: new Date().toISOString(),
      };

      if (samples.length < 20) {
        samples.push({
          id: row.id,
          order_id: row.order_id,
          external_id: row.external_id,
          intake_batch_id: intakeOrder.batch_id,
          intake_order_id: intakeOrderId,
          shipping_cost_before: row.shipping_cost,
          shipping_cost_after: nextShippingCost,
          shipping_discount_before: row.shipping_discount,
          shipping_discount_after: nextShippingDiscount,
          shipping_platform: shipping.platform,
          shipping_source: shipping.grossSource,
        });
      }

      if (config.apply) {
        pendingUpdates.push({ id: Number(row.id), payload });
      }
    }

    if (config.apply && pendingUpdates.length > 0) {
      for (let index = 0; index < pendingUpdates.length; index += config.concurrency) {
        const slice = pendingUpdates.slice(index, index + config.concurrency);
        await Promise.all(slice.map(async (entry) => {
          const { error: updateError } = await withSupabaseRetries(
            `update:${entry.id}`,
            async () => await supabase
              .from('scalev_orders')
              .update(entry.payload)
              .eq('id', entry.id),
          );
          if (updateError) throw updateError;
        }));
        summary.updated += slice.length;
      }
    }

    console.log(JSON.stringify({ summary, samples }, null, 2));
    return;
  }

  if (config.intakeBatchIds.length > 0) {
    for (const batchId of config.intakeBatchIds) {
      const { data: intakeBatch, error: intakeBatchError } = await withSupabaseRetries(
        `fetch-intake-batch:${batchId}`,
        async () => await supabase
          .from('marketplace_intake_batches')
          .select('id, business_code, raw_snapshot')
          .eq('id', batchId)
          .single(),
      );
      if (intakeBatchError) throw intakeBatchError;
      const snapshotOrders = Array.isArray((intakeBatch as IntakeBatchRow).raw_snapshot?.orders)
        ? (intakeBatch as IntakeBatchRow).raw_snapshot?.orders as Array<Record<string, unknown>>
        : [];
      const snapshotByExternalId = new Map<string, {
        rawMeta: Record<string, unknown>;
        rawRows: Array<Record<string, unknown>>;
      }>();
      for (const snapshotOrder of snapshotOrders) {
        const externalId = String(snapshotOrder.externalOrderId || '').trim();
        if (!externalId) continue;
        const lines = Array.isArray(snapshotOrder.lines) ? snapshotOrder.lines : [];
        snapshotByExternalId.set(externalId, {
          rawMeta: (snapshotOrder.rawMeta && typeof snapshotOrder.rawMeta === 'object'
            ? snapshotOrder.rawMeta as Record<string, unknown>
            : {}),
          rawRows: lines
            .map((line) => (line && typeof line === 'object' ? (line as Record<string, unknown>).rawRow : null))
            .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object'),
        });
      }

      const externalIds = Array.from(snapshotByExternalId.keys());

      const scalevRows: ScalevOrderRow[] = [];
      for (const chunk of chunkValues(externalIds, 20)) {
        const { data, error } = await withSupabaseRetries(
          `fetch-scalev-batch:${batchId}`,
          async () => await supabase
            .from('scalev_orders')
            .select([
              'id',
              'order_id',
              'external_id',
              'shipping_cost',
              'shipping_discount',
              'raw_data',
              'marketplace_intake_order_id',
              'marketplace_intake_batch_id',
            ].join(','))
            .eq('source', 'marketplace_api_upload')
            .eq('business_code', (intakeBatch as IntakeBatchRow).business_code)
            .in('external_id', chunk),
        );
        if (error) throw error;
        scalevRows.push(...((data || []) as ScalevOrderRow[]));
      }

      summary.batches += 1;
      summary.scanned += scalevRows.length;

      const pendingUpdates: Array<{ id: number; payload: Record<string, unknown> }> = [];
      for (const row of scalevRows) {
        const externalId = String(row.external_id || '').trim();
        const snapshotOrder = snapshotByExternalId.get(externalId);
        if (!snapshotOrder) {
          summary.unresolved += 1;
          continue;
        }

        const intakeOrderId = resolveIntakeOrderId(row);
        summary.foundIntake += 1;
        const shipping = resolveMarketplaceIntakeShippingFinancials({
          rawMeta: snapshotOrder.rawMeta,
          rawRows: snapshotOrder.rawRows,
        });

        if (!shipping.present) {
          summary.unresolved += 1;
          continue;
        }

        const nextShippingCost = shipping.grossAmount;
        const nextShippingDiscount = nextShippingCost === 0
          ? 0
          : (shipping.companyDiscountPresent ? Math.min(shipping.companyDiscountAmount, nextShippingCost) : null);

        if (!hasMeaningfulChange({
          row,
          nextShippingCost,
          nextShippingDiscount,
          nextIntakeOrderId: intakeOrderId || 0,
          nextIntakeBatchId: batchId,
        })) {
          continue;
        }

        summary.changed += 1;
        const nextRawData = {
          ...(row.raw_data || {}),
          marketplace_intake_batch_id: batchId,
          marketplace_intake_order_id: intakeOrderId,
          shipping_cost: nextShippingCost,
          shipping_discount: nextShippingDiscount,
          shipping_financials: shipping,
          projection_rows: normalizeProjectionRows(row.raw_data?.projection_rows, nextShippingCost),
        };
        const payload = {
          shipping_cost: nextShippingCost,
          shipping_discount: nextShippingDiscount,
          marketplace_intake_batch_id: batchId,
          marketplace_intake_order_id: intakeOrderId,
          raw_data: nextRawData,
          synced_at: new Date().toISOString(),
        };

        if (samples.length < 20) {
          samples.push({
            id: row.id,
            order_id: row.order_id,
            external_id: row.external_id,
            intake_batch_id: batchId,
            intake_order_id: intakeOrderId,
            shipping_cost_before: row.shipping_cost,
            shipping_cost_after: nextShippingCost,
            shipping_discount_before: row.shipping_discount,
            shipping_discount_after: nextShippingDiscount,
            shipping_platform: shipping.platform,
            shipping_source: shipping.grossSource,
          });
        }

        if (config.apply) {
          pendingUpdates.push({ id: Number(row.id), payload });
        }
      }

      if (config.apply && pendingUpdates.length > 0) {
        for (let index = 0; index < pendingUpdates.length; index += config.concurrency) {
          const slice = pendingUpdates.slice(index, index + config.concurrency);
          await Promise.all(slice.map(async (entry) => {
            const { error: updateError } = await withSupabaseRetries(
              `update:${entry.id}`,
              async () => await supabase
                .from('scalev_orders')
                .update(entry.payload)
                .eq('id', entry.id),
            );
            if (updateError) throw updateError;
          }));
          summary.updated += slice.length;
        }
      }

      console.log(JSON.stringify({
        intakeBatchId: batchId,
        scanned: summary.scanned,
        foundIntake: summary.foundIntake,
        changed: summary.changed,
        updated: summary.updated,
        unresolved: summary.unresolved,
      }));
    }

    console.log(JSON.stringify({ summary, samples }, null, 2));
    return;
  }

  for (;;) {
    if (config.maxBatches > 0 && summary.batches >= config.maxBatches) break;

    const { data: rows, error } = await withSupabaseRetries(
      'fetch-scalev-orders',
      async () => {
        let query = supabase
          .from('scalev_orders')
          .select([
            'id',
            'order_id',
            'external_id',
            'shipping_cost',
            'shipping_discount',
            'raw_data',
            'marketplace_intake_order_id',
            'marketplace_intake_batch_id',
          ].join(','))
          .eq('source', 'marketplace_api_upload')
          .eq('shipping_cost', 0)
          .gt('id', lastId)
          .order('id', { ascending: true })
          .limit(config.batchSize);

        if (config.fromShippedDate) {
          query = query.gte('shipped_time', buildDayStart(config.fromShippedDate));
        }
        if (config.toShippedDate) {
          query = query.lt('shipped_time', buildNextDayStart(config.toShippedDate));
        }

        return await query;
      },
    );

    if (error) throw error;
    if (!rows || rows.length === 0) break;

    summary.batches += 1;
    summary.scanned += rows.length;

    const intakeOrderIds = Array.from(new Set(
      (rows as ScalevOrderRow[])
        .map((row) => resolveIntakeOrderId(row))
        .filter((value): value is number => Number.isFinite(value) && value > 0),
    ));

    const intakeOrdersById = new Map<number, IntakeOrderRow>();
    const linesByOrderId = new Map<number, IntakeLineRow[]>();

    if (intakeOrderIds.length > 0) {
      const { data: intakeOrders, error: intakeOrdersError } = await withSupabaseRetries(
        'fetch-intake-orders',
        async () => await supabase
          .from('marketplace_intake_orders')
          .select('id, batch_id, raw_meta')
          .in('id', intakeOrderIds),
      );
      if (intakeOrdersError) throw intakeOrdersError;

      for (const row of (intakeOrders || []) as IntakeOrderRow[]) {
        intakeOrdersById.set(Number(row.id), row);
      }

      const { data: intakeLines, error: intakeLinesError } = await withSupabaseRetries(
        'fetch-intake-lines',
        async () => await supabase
          .from('marketplace_intake_order_lines')
          .select('intake_order_id, line_index, raw_row')
          .in('intake_order_id', intakeOrderIds)
          .order('intake_order_id', { ascending: true })
          .order('line_index', { ascending: true }),
      );
      if (intakeLinesError) throw intakeLinesError;

      for (const row of (intakeLines || []) as IntakeLineRow[]) {
        const orderId = Number(row.intake_order_id);
        if (!linesByOrderId.has(orderId)) linesByOrderId.set(orderId, []);
        linesByOrderId.get(orderId)!.push(row);
      }
    }

    const pendingUpdates: Array<{
      id: number;
      payload: Record<string, unknown>;
      sample: Record<string, unknown>;
    }> = [];

    for (const row of rows as ScalevOrderRow[]) {
      lastId = Number(row.id || lastId);
      summary.lastId = lastId;

      const intakeOrderId = resolveIntakeOrderId(row);
      if (!intakeOrderId) {
        summary.unresolved += 1;
        continue;
      }

      const intakeOrder = intakeOrdersById.get(intakeOrderId);
      if (!intakeOrder) {
        summary.unresolved += 1;
        continue;
      }

      summary.foundIntake += 1;
      const intakeLines = linesByOrderId.get(intakeOrderId) || [];
      const shipping = resolveMarketplaceIntakeShippingFinancials({
        rawMeta: intakeOrder.raw_meta || {},
        rawRows: intakeLines.map((line) => line.raw_row || {}),
      });

      if (!shipping.present) {
        summary.unresolved += 1;
        continue;
      }

      const nextShippingCost = shipping.grossAmount;
      const nextShippingDiscount = nextShippingCost === 0
        ? 0
        : (shipping.companyDiscountPresent ? Math.min(shipping.companyDiscountAmount, nextShippingCost) : null);

      if (!hasMeaningfulChange({
        row,
        nextShippingCost,
        nextShippingDiscount,
        nextIntakeOrderId: intakeOrderId,
        nextIntakeBatchId: intakeOrder.batch_id,
      })) {
        continue;
      }

      summary.changed += 1;
      const nextRawData = {
        ...(row.raw_data || {}),
        marketplace_intake_batch_id: intakeOrder.batch_id,
        marketplace_intake_order_id: intakeOrderId,
        shipping_cost: nextShippingCost,
        shipping_discount: nextShippingDiscount,
        shipping_financials: shipping,
        projection_rows: normalizeProjectionRows(row.raw_data?.projection_rows, nextShippingCost),
      };

      const payload = {
        shipping_cost: nextShippingCost,
        shipping_discount: nextShippingDiscount,
        marketplace_intake_batch_id: intakeOrder.batch_id,
        marketplace_intake_order_id: intakeOrderId,
        raw_data: nextRawData,
        synced_at: new Date().toISOString(),
      };

      const sample = {
        id: row.id,
        order_id: row.order_id,
        external_id: row.external_id,
        intake_order_id: intakeOrderId,
        shipping_cost_before: row.shipping_cost,
        shipping_cost_after: nextShippingCost,
        shipping_discount_before: row.shipping_discount,
        shipping_discount_after: nextShippingDiscount,
        shipping_platform: shipping.platform,
        shipping_source: shipping.grossSource,
      };
      if (samples.length < 20) samples.push(sample);

      if (config.apply) {
        pendingUpdates.push({
          id: Number(row.id),
          payload,
          sample,
        });
      }
    }

    if (config.apply && pendingUpdates.length > 0) {
      for (let index = 0; index < pendingUpdates.length; index += config.concurrency) {
        const slice = pendingUpdates.slice(index, index + config.concurrency);
        await Promise.all(slice.map(async (entry) => {
          const { error: updateError } = await withSupabaseRetries(
            `update:${entry.id}`,
            async () => await supabase
              .from('scalev_orders')
              .update(entry.payload)
              .eq('id', entry.id),
          );
          if (updateError) throw updateError;
        }));
        summary.updated += slice.length;
      }
    }

    console.log(JSON.stringify({
      batch: summary.batches,
      lastId,
      scanned: summary.scanned,
      foundIntake: summary.foundIntake,
      changed: summary.changed,
      updated: summary.updated,
      unresolved: summary.unresolved,
    }));

    if (rows.length < config.batchSize) break;
  }

  console.log(JSON.stringify({ summary, samples }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
