#!/usr/bin/env node
// Mints the long-lived Supabase JWT used by the Roove BI MCP Worker.
//
//   SUPABASE_JWT_SECRET=... node mcp-server/scripts/mint-mcp-jwt.mjs \
//     --workspace 00000000-0000-4000-8000-000000000001 [--days 365]
//
// The secret is the project's legacy JWT secret (Dashboard → Settings → API →
// JWT Settings). It is read from the environment only, never written anywhere.
// The printed token carries { role: "mcp_marketing_reader", workspace_id } and is
// stored on Cloudflare as the SUPABASE_MCP_JWT secret.
import { createHmac } from 'node:crypto';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const workspace = option('workspace');
const days = Number(option('days', '365'));
const secret = process.env.SUPABASE_JWT_SECRET;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!secret) fail('SUPABASE_JWT_SECRET is not set in the environment.');
if (!workspace || !uuid.test(workspace)) fail('--workspace must be a workspace UUID.');
if (!Number.isInteger(days) || days < 1 || days > 730) fail('--days must be between 1 and 730.');

const b64url = (input) => Buffer.from(input).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const payload = b64url(JSON.stringify({
  role: 'mcp_marketing_reader',
  workspace_id: workspace,
  iss: 'roove-bi-mcp',
  iat: now,
  exp: now + days * 86400,
}));
const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');

process.stdout.write(`${header}.${payload}.${signature}\n`);
process.stderr.write(`Expires ${new Date((now + days * 86400) * 1000).toISOString()} — store it with: npx wrangler secret put SUPABASE_MCP_JWT\n`);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
