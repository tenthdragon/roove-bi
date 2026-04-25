import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { runScalevSourceClassBackfill } from '../lib/scalev-source-class-backfill';

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
  const dateArg = process.argv.find((arg) => arg.startsWith('--date='))?.split('=')[1] || null;
  const fromArg = process.argv.find((arg) => arg.startsWith('--from='))?.split('=')[1] || null;
  const toArg = process.argv.find((arg) => arg.startsWith('--to='))?.split('=')[1] || null;
  const batchSize = Math.max(
    1,
    Number(
      process.argv.find((arg) => arg.startsWith('--batch-size='))?.split('=')[1]
      || '1000',
    ) || 1000,
  );

  const fromDate = dateArg || fromArg || DEFAULT_FROM_DATE;
  const toDate = dateArg || toArg || getTodayJakartaDate();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    throw new Error('Gunakan format tanggal YYYY-MM-DD untuk --date, --from, dan --to.');
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

const env = parseEnvFile('.env.local');
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const config = parseArgs();
  const summary = await runScalevSourceClassBackfill({
    supabase,
    apply: config.apply,
    batchSize: config.batchSize,
    fromDate: config.fromDate,
    toDate: config.toDate,
    onProgress(progress) {
      console.log(JSON.stringify(progress));
    },
  });

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
