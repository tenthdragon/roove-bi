import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

import { extractMarketplaceTrackingFromScalevOrderRawData } from '../lib/marketplace-tracking';

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

  return {
    apply: process.argv.includes('--apply'),
    batchSize,
    maxBatches,
    startId,
  };
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
    maxBatches: config.maxBatches,
    startId: config.startId,
    batches: 0,
    scanned: 0,
    changed: 0,
    updated: 0,
    lastId: config.startId,
  };

  let lastId = config.startId;
  for (;;) {
    if (config.maxBatches > 0 && summary.batches >= config.maxBatches) break;

    const { data: rows, error } = await supabase
      .from('scalev_orders')
      .select('id, order_id, raw_data, marketplace_tracking_number')
      .gt('id', lastId)
      .is('marketplace_tracking_number', null)
      .not('raw_data', 'is', null)
      .order('id', { ascending: true })
      .limit(config.batchSize);

    if (error) throw error;
    if (!rows || rows.length === 0) break;

    summary.batches++;

    for (const row of rows) {
      summary.scanned++;
      const tracking = extractMarketplaceTrackingFromScalevOrderRawData(row.raw_data);
      if (!tracking) continue;

      summary.changed++;
      if (config.apply) {
        const { error: updateError } = await supabase
          .from('scalev_orders')
          .update({ marketplace_tracking_number: tracking })
          .eq('id', row.id);
        if (updateError) throw updateError;
        summary.updated++;
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
