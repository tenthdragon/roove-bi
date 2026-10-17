export type SyncWorkerOptions = { loop: boolean; pollMs: number; staleAfterMinutes: number; maxJobs: number | null; maxRuntimeSeconds: number | null };
const positive = (v: string, fallback: number) => { const n = Math.floor(Number(v)); return Number.isSafeInteger(n) && n > 0 ? n : fallback; };
export function parseSyncWorkerArgs(argv: string[]): SyncWorkerOptions {
  const options: SyncWorkerOptions = { loop: false, pollMs: 5000, staleAfterMinutes: 30, maxJobs: null, maxRuntimeSeconds: null };
  for (const arg of argv) {
    if (arg === '--loop') options.loop = true;
    if (arg.startsWith('--poll-ms=')) options.pollMs = positive(arg.split('=')[1], 5000);
    if (arg.startsWith('--stale-after-minutes=')) options.staleAfterMinutes = positive(arg.split('=')[1], 30);
    if (arg.startsWith('--max-jobs=')) options.maxJobs = positive(arg.split('=')[1], 1);
    if (arg.startsWith('--max-runtime-seconds=')) options.maxRuntimeSeconds = positive(arg.split('=')[1], 240);
  }
  return options;
}
/** Budget is checked between jobs: never interrupts an active provider request. */
export async function drainSyncQueue(options: SyncWorkerOptions, next: () => Promise<boolean>,
  now = Date.now, pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  const started = now(); let processed = 0;
  while ((!options.maxJobs || processed < options.maxJobs)
    && (!options.maxRuntimeSeconds || now() - started < options.maxRuntimeSeconds * 1000)) {
    if (await next()) processed++;
    else if (options.loop) await pause(options.pollMs);
    else break;
  }
  return processed;
}
