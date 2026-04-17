import crypto from 'crypto';

type LogStatus = 'start' | 'success' | 'partial' | 'failed' | 'denied';
type LogValue = string | number | boolean | null | undefined;

type RouteLogPayload = {
  route: string;
  job: string;
  mode: string;
  status: LogStatus;
  request_id: string;
  duration_ms?: number;
  rows_processed?: number;
  extra?: Record<string, LogValue>;
};

type RequestLike = {
  headers: {
    get(name: string): string | null;
  };
};

export function getRequestId(req: RequestLike): string {
  return req.headers.get('x-request-id')?.trim() || crypto.randomUUID();
}

export function logRouteEvent(payload: RouteLogPayload) {
  const entry = {
    ts: new Date().toISOString(),
    route: payload.route,
    job: payload.job,
    mode: payload.mode,
    status: payload.status,
    request_id: payload.request_id,
    duration_ms: payload.duration_ms,
    rows_processed: payload.rows_processed,
    ...payload.extra,
  };

  if (payload.status === 'failed' || payload.status === 'denied') {
    console.error(JSON.stringify(entry));
    return;
  }

  if (payload.status === 'partial') {
    console.warn(JSON.stringify(entry));
    return;
  }

  console.log(JSON.stringify(entry));
}
