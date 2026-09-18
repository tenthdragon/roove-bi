import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

async function main() {
  const job = process.argv[2];
  const routes: Record<string, string> = {
    orders: '/api/scalev-sync',
    ads: '/api/meta-sync',
  };
  if (!routes[job]) throw new Error('Expected orders or ads');
  if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET is required');
  const baseUrl = process.env.SYNC_BASE_URL || 'http://127.0.0.1:3000';
  const response = await fetch(new URL(routes[job], baseUrl), {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error(`${job} enqueue failed: HTTP ${response.status}`);
  console.log(JSON.stringify({ at: new Date().toISOString(), job, result: await response.json() }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
