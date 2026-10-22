// Cloudflare Worker entry: serves the Roove BI MCP server over Streamable HTTP.
// Same read-only tools as the local stdio entry (see server.ts).
//
// Endpoint:  POST /mcp   (requires  Authorization: Bearer <MCP_AUTH_TOKEN>)
// Health:    GET  /health
//
// One deployment serves exactly one workspace (MCP_WORKSPACE_ID), mirroring the
// "one instance per workspace" rule of the stdio server.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import { createRooveServer, WORKSPACE_ID_PATTERN } from "./server.js";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string; // secret
  MCP_WORKSPACE_ID: string;
  MCP_AUTH_TOKEN: string; // secret: shared with trusted callers only
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Constant-time comparison so the token can't be guessed byte by byte from timing.
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

function configError(env: Env): string | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return "Supabase credentials are not configured";
  if (!env.MCP_WORKSPACE_ID || !WORKSPACE_ID_PATTERN.test(env.MCP_WORKSPACE_ID.trim())) {
    return "MCP_WORKSPACE_ID must be a valid workspace UUID";
  }
  if (!env.MCP_AUTH_TOKEN || env.MCP_AUTH_TOKEN.length < 32) {
    return "MCP_AUTH_TOKEN must be set (at least 32 characters)";
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const problem = configError(env);
      return json(problem ? 500 : 200, { ok: !problem, error: problem ?? undefined });
    }

    if (url.pathname !== "/mcp") return json(404, { error: "Not found" });

    const problem = configError(env);
    if (problem) return json(500, { error: problem });

    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token || !safeEqual(token, env.MCP_AUTH_TOKEN)) {
      return json(401, { error: "Unauthorized" });
    }

    // Stateless mode: a fresh server and transport per request. The tools hold no
    // session state, so nothing is lost between calls.
    const svc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const server = createRooveServer(svc, env.MCP_WORKSPACE_ID.trim());
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
