type ErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

export type ScalevLineRetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
  onRetry?: (args: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
};

export type PersistScalevOrderLinesOptions = {
  workspaceId: string;
  dbOrderId: number;
  lines: Array<Record<string, any>>;
  replaceExisting?: boolean;
  retry?: ScalevLineRetryOptions;
};

const TRANSIENT_POSTGRES_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '57014', // query_canceled / statement timeout
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
]);

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const value = error as ErrorLike;
    return [value.message, value.details, value.hint]
      .filter(Boolean)
      .join(' ');
  }
  return String(error ?? 'Unknown ScaleV order-line error');
}

export function getScalevLineErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = String((error as ErrorLike).code || '').trim().toUpperCase();
  return code || null;
}

export function isTransientScalevLineError(error: unknown): boolean {
  const code = getScalevLineErrorCode(error);
  if (code && TRANSIENT_POSTGRES_CODES.has(code)) return true;

  const message = errorText(error).toLowerCase();
  return [
    'deadlock detected',
    'could not serialize access',
    'lock timeout',
    'lock not available',
    'statement timeout',
    'canceling statement due to conflict',
    'connection reset',
    'connection terminated',
    'fetch failed',
    'network error',
    'temporarily unavailable',
  ].some((fragment) => message.includes(fragment));
}

export class ScalevLinePersistenceError extends Error {
  readonly code: string | null;
  readonly attempts: number;
  readonly causeValue: unknown;

  constructor(error: unknown, attempts: number) {
    const code = getScalevLineErrorCode(error);
    super(
      `ScaleV order-line persistence failed after ${attempts} attempt${attempts === 1 ? '' : 's'}`
      + `${code ? ` [${code}]` : ''}: ${errorText(error)}`,
    );
    this.name = 'ScalevLinePersistenceError';
    this.code = code;
    this.attempts = attempts;
    this.causeValue = error;
  }
}

export async function withScalevLineRetry<T>(
  operation: () => Promise<T>,
  options: ScalevLineRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 4));
  const baseDelayMs = Math.max(0, Math.trunc(options.baseDelayMs ?? 50));
  const maxDelayMs = Math.max(baseDelayMs, Math.trunc(options.maxDelayMs ?? 750));
  const sleep = options.sleep ?? ((delayMs: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  }));
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientScalevLineError(error) || attempt >= maxAttempts) {
        throw new ScalevLinePersistenceError(error, attempt);
      }

      const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const jitterMultiplier = 0.75 + (Math.max(0, Math.min(1, random())) * 0.5);
      const delayMs = Math.max(0, Math.round(exponentialDelay * jitterMultiplier));
      options.onRetry?.({ attempt, delayMs, error });
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  throw new ScalevLinePersistenceError(lastError, maxAttempts);
}

export async function persistScalevOrderLines(
  svc: any,
  options: PersistScalevOrderLinesOptions,
): Promise<number> {
  if (options.lines.length === 0) return 0;

  await withScalevLineRetry(async () => {
    const { error } = await svc
      .from('scalev_order_lines')
      .upsert(options.lines, { onConflict: 'scalev_order_id,product_name' });
    if (error) throw error;
  }, options.retry);

  if (!options.replaceExisting) return options.lines.length;

  // Upsert first so a failed replacement can never erase the last good lines.
  // Stale rows are removed only after every incoming row is durable.
  const desiredNames = new Set(options.lines.map((line) => String(line.product_name ?? '')));
  const currentLines = await withScalevLineRetry(async () => {
    const { data, error } = await svc
      .from('scalev_order_lines')
      .select('id, product_name')
      .eq('workspace_id', options.workspaceId)
      .eq('scalev_order_id', options.dbOrderId);
    if (error) throw error;
    return data || [];
  }, options.retry);
  const staleIds = currentLines
    .filter((line: any) => !desiredNames.has(String(line.product_name ?? '')))
    .map((line: any) => line.id);

  if (staleIds.length > 0) {
    await withScalevLineRetry(async () => {
      const { error } = await svc
        .from('scalev_order_lines')
        .delete()
        .eq('workspace_id', options.workspaceId)
        .eq('scalev_order_id', options.dbOrderId)
        .in('id', staleIds);
      if (error) throw error;
    }, options.retry);
  }

  return options.lines.length;
}
