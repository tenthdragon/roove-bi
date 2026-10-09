// Staging has no integration egress. Only its own Supabase API is reachable.
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
export function assertStagingRequest(input, options) {
  let url;
  if (typeof input === 'string' || input instanceof URL) url = new URL(input);
  else if (input?.url) url = new URL(input.url);
  else {
    const config = input || options || {};
    const host = config.hostname || config.host || 'localhost';
    url = new URL(`${config.protocol || 'http:'}//${host}${config.port ? `:${config.port}` : ''}${config.path || '/'}`);
  }
  if (options) {
    if (options.protocol) url.protocol = options.protocol;
    if (options.hostname || options.host) url.host = options.hostname || options.host;
    if (options.port) url.port = String(options.port);
    if (options.path) { const path = new URL(options.path, url); url.pathname = path.pathname; url.search = path.search; }
  }
  const hostHeader = new Headers(options?.headers || input?.headers || {}).get('host');
  if (hostHeader && hostHeader !== url.host) throw new Error('Staging refuses a different Host header.');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && ['3001', '55431', '55432', '55433'].includes(url.port);
  const stagingApi = url.origin === 'https://staging-app.rti-hq.com' && url.pathname.startsWith('/supabase/');
  if (!['http:', 'https:'].includes(url.protocol) || (!loopback && !stagingApi)) throw new Error('Staging blocks external integrations.');
  return url;
}
if (process.env.ROOVE_ENVIRONMENT === 'staging') {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://staging-app.rti-hq.com/supabase') throw new Error('Staging must use its isolated database API.');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function(input, options) {
    try { assertStagingRequest(input, options); } catch (error) { return Promise.reject(error); }
    return originalFetch.call(this, input, options);
  };
  for (const module of [http, https]) for (const name of ['request', 'get']) {
    const original = module[name];
    module[name] = function(input, ...args) {
      const options = typeof args[0] === 'object' ? args[0] : undefined;
      assertStagingRequest(input, options);
      if (options?.hostname || options?.host) assertStagingRequest(options);
      return original.call(this, input, ...args);
    };
  }
  syncBuiltinESMExports();
}
