import { NextRequest, NextResponse } from 'next/server';

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  ok: boolean;
  retryAfterSeconds: number;
  remaining: number;
};

type RateLimitOptions = {
  key: string;
  max: number;
  windowMs: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __rooveRateLimitBuckets: Map<string, RateLimitBucket> | undefined;
}

const rateLimitBuckets = globalThis.__rooveRateLimitBuckets ?? new Map<string, RateLimitBucket>();
globalThis.__rooveRateLimitBuckets = rateLimitBuckets;

function getExpectedOrigins(req: NextRequest) {
  const origins = new Set<string>();
  const forwardedHost = req.headers.get('x-forwarded-host');
  const host = forwardedHost || req.headers.get('host');
  const forwardedProto = req.headers.get('x-forwarded-proto');
  const proto = forwardedProto || (host?.includes('localhost') ? 'http' : 'https');

  if (host) origins.add(`${proto}://${host}`);
  if (process.env.NEXT_PUBLIC_SITE_URL) origins.add(process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, ''));

  origins.add('http://localhost:3000');
  origins.add('http://127.0.0.1:3000');

  return origins;
}

function normalizeOrigin(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).origin.replace(/\/$/, '');
  } catch {
    return value.replace(/\/$/, '');
  }
}

export function getClientIp(req: NextRequest) {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0].trim();

  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  const cfIp = req.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  return 'unknown';
}

export function consumeRateLimit({ key, max, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const existing = rateLimitBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      ok: true,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
      remaining: Math.max(max - 1, 0),
    };
  }

  if (existing.count >= max) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      remaining: 0,
    };
  }

  existing.count += 1;
  rateLimitBuckets.set(key, existing);
  return {
    ok: true,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    remaining: Math.max(max - existing.count, 0),
  };
}

export function buildRateLimitResponse(message: string, retryAfterSeconds: number) {
  return NextResponse.json(
    { error: message, retry_after_seconds: retryAfterSeconds },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
      },
    },
  );
}

export function hasSupabaseAuthCookie(req: NextRequest) {
  return req.cookies.getAll().some((cookie) => cookie.name.includes('-auth-token'));
}

export function isTrustedOrigin(req: NextRequest) {
  const expectedOrigins = getExpectedOrigins(req);
  const origin = normalizeOrigin(req.headers.get('origin'));
  if (origin) return expectedOrigins.has(origin);

  const referer = normalizeOrigin(req.headers.get('referer'));
  if (referer) return expectedOrigins.has(referer);

  return false;
}

export function rejectUntrustedOrigin(req: NextRequest) {
  if (isTrustedOrigin(req)) return null;
  return NextResponse.json({ error: 'Origin request tidak diizinkan.' }, { status: 403 });
}

export function rejectMissingDashboardSession(req: NextRequest) {
  if (hasSupabaseAuthCookie(req)) return null;
  return NextResponse.json({ error: 'Sesi login tidak ditemukan. Silakan login ulang.' }, { status: 401 });
}

export function limitByIp(
  req: NextRequest,
  scope: string,
  max: number,
  windowMs: number,
  message: string,
) {
  const ip = getClientIp(req);
  const result = consumeRateLimit({ key: `${scope}:${ip}`, max, windowMs });
  if (result.ok) return null;
  return buildRateLimitResponse(message, result.retryAfterSeconds);
}

export function limitByIpAndValue(
  req: NextRequest,
  scope: string,
  value: string,
  max: number,
  windowMs: number,
  message: string,
) {
  const ip = getClientIp(req);
  const normalizedValue = value.trim().toLowerCase();
  const result = consumeRateLimit({ key: `${scope}:${ip}:${normalizedValue}`, max, windowMs });
  if (result.ok) return null;
  return buildRateLimitResponse(message, result.retryAfterSeconds);
}
