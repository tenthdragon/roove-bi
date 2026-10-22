// Cloudflare Worker entry: serves the Roove BI MCP server over Streamable HTTP,
// scoped to marketing data (Meta Ads + marketing spend).
//
// Endpoint:  POST /mcp   (requires  Authorization: Bearer <MCP_AUTH_TOKEN>)
// Health:    GET  /health
//
// Database access goes through the read-only role `mcp_marketing_reader` and the
// `mcp_marketing` schema (supabase/migrations/237_mcp_marketing_reader.sql):
//  * SUPABASE_ANON_KEY identifies the project to the API gateway (public key).
//  * SUPABASE_MCP_JWT is a long-lived token signed with the project's JWT secret,
//    carrying { role: "mcp_marketing_reader", workspace_id: <uuid> }. It can only
//    read the views and the report wrapper in mcp_marketing, for that workspace.
// The service role key is never present in this Worker.
//
// One deployment serves exactly one workspace (MCP_WORKSPACE_ID must match the
// workspace_id claim inside SUPABASE_MCP_JWT).

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import { createRooveServer, MARKETING_TOOLS, WORKSPACE_ID_PATTERN } from "./server.js";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_MCP_JWT: string; // secret
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

// Reads the (unverified) payload of a JWT so the Worker can refuse a token whose
// role or workspace does not match its configuration. Supabase verifies the signature.
function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function configError(env: Env): string | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return "SUPABASE_URL and SUPABASE_ANON_KEY are not configured";
  if (!env.MCP_WORKSPACE_ID || !WORKSPACE_ID_PATTERN.test(env.MCP_WORKSPACE_ID.trim())) {
    return "MCP_WORKSPACE_ID must be a valid workspace UUID";
  }
  if (!env.MCP_AUTH_TOKEN || env.MCP_AUTH_TOKEN.length < 32) {
    return "MCP_AUTH_TOKEN must be set (at least 32 characters)";
  }
  if (!env.SUPABASE_MCP_JWT) return "SUPABASE_MCP_JWT is not configured";
  const claims = jwtPayload(env.SUPABASE_MCP_JWT);
  if (!claims) return "SUPABASE_MCP_JWT is not a JWT";
  if (claims.role !== "mcp_marketing_reader") return "SUPABASE_MCP_JWT must carry role mcp_marketing_reader";
  if (claims.workspace_id !== env.MCP_WORKSPACE_ID.trim()) {
    return "SUPABASE_MCP_JWT workspace_id does not match MCP_WORKSPACE_ID";
  }
  if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return "SUPABASE_MCP_JWT has expired";
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const problem = configError(env);
      return json(problem ? 500 : 200, { ok: !problem, scope: "marketing", error: problem ?? undefined });
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
    const db = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { schema: "mcp_marketing" },
      global: { headers: { Authorization: `Bearer ${env.SUPABASE_MCP_JWT}` } },
    });
    const server = createRooveServer(db, env.MCP_WORKSPACE_ID.trim(), {
      includePii: false,
      onlyTools: MARKETING_TOOLS,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
