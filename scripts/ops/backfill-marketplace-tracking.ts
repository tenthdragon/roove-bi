import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

import {
  extractMarketplaceTrackingFromScalevOrderRawData,
  shipmentDateToScalevOrderPrefix,
} from '../lib/marketplace-tracking';

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
  const batchSize = Math.max(
    1,
    Number(
      process.argv.find((arg) => arg.startsWith('--batch-size='))?.split('=')[1]
      || '200',
    ) || 200,
  );
  const startId = Math.max(
    0,
    Number(
      process.argv.find((arg) => arg.startsWith('--start-id='))?.split('=')[1]
      || '0',
    ) || 0,
  );
  const maxBatches = Math.max(
    0,
    Number(
      process.argv.find((arg) => arg.startsWith('--max-batches='))?.split('=')[1]
      || '0',
    ) || 0,
  );
  const concurrency = Math.max(
    1,
    Number(
      process.argv.find((arg) => arg.startsWith('--concurrency='))?.split('=')[1]
      || '10',
    ) || 10,
  );
  const throughDate = process.argv.find((arg) => arg.startsWith('--through-date='))?.split('=')[1] || null;

  if (throughDate && !/^\d{4}-\d{2}-\d{2}$/.test(throughDate)) {
    throw new Error('Gunakan format tanggal YYYY-MM-DD untuk --through-date.');
  }

  return {
    apply: process.argv.includes('--apply'),
    batchSize,
    concurrency,
    maxBatches,
    startId,
    throughDate,
  };
}

function nextDayPrefix(date: string): string {
  const parsed = new Date(`${date}T00:00:00+07:00`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  const nextDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed);
  const prefix = shipmentDateToScalevOrderPrefix(nextDate);
  if (!prefix) {
    throw new Error(`Tidak bisa menghitung prefix order untuk tanggal ${date}.`);
  }
  return prefix;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function withRetries<T>(label: string, fn: () => Promise<T>, maxAttempts = 5): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      const delayMs = Math.min(10_000, attempt * 1_000);
      console.warn(JSON.stringify({
        label,
        attempt,
        delayMs,
        error: formatError(error),
      }));
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
    maxBatches: config.maxBatches,
    startId: config.startId,
    throughDate: config.throughDate,
    batches: 0,
    scanned: 0,
    changed: 0,
    updated: 0,
    lastId: config.startId,
  };

  let lastId = config.startId;
  const throughOrderIdExclusive = config.throughDate ? nextDayPrefix(config.throughDate) : null;
  for (;;) {
    if (config.maxBatches > 0 && summary.batches >= config.maxBatches) break;

    let query = supabase
      .from('scalev_orders')
      .select('id, order_id, raw_data, marketplace_tracking_number')
      .gt('id', lastId)
      .is('marketplace_tracking_number', null)
      .not('raw_data', 'is', null)
      .order('id', { ascending: true })
      .limit(config.batchSize);

    if (throughOrderIdExclusive) {
      query = query.lt('order_id', throughOrderIdExclusive);
    }

    const { data: rows, error } = await withSupabaseRetries(
      'fetch-batch',
      async () => await query,
    );

    if (error) throw error;
    if (!rows || rows.length === 0) break;

    summary.batches++;
    const pendingUpdates: Array<{ id: number; tracking: string }> = [];

    for (const row of rows) {
      summary.scanned++;
      const tracking = extractMarketplaceTrackingFromScalevOrderRawData(row.raw_data);
      if (!tracking) continue;

      summary.changed++;
      if (config.apply) pendingUpdates.push({ id: Number(row.id), tracking });
    }

    if (config.apply && pendingUpdates.length > 0) {
      for (let i = 0; i < pendingUpdates.length; i += config.concurrency) {
        const slice = pendingUpdates.slice(i, i + config.concurrency);
        await Promise.all(
          slice.map(async (entry) => {
            const { error: updateError } = await withSupabaseRetries(
              `update:${entry.id}`,
              async () => await supabase
                .from('scalev_orders')
                .update({ marketplace_tracking_number: entry.tracking })
                .eq('id', entry.id),
            );
            if (updateError) throw updateError;
          }),
        );
        summary.updated += slice.length;
      }
    }

    lastId = Number(rows[rows.length - 1]?.id || lastId);
    summary.lastId = lastId;
    console.log(JSON.stringify({
      batch: summary.batches,
      lastId,
      scanned: summary.scanned,
      changed: summary.changed,
      updated: summary.updated,
    }));

    if (rows.length < config.batchSize) break;
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
