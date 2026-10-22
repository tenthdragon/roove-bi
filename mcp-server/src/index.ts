#!/usr/bin/env node

// Local entry: runs the Roove BI MCP server over stdio for Claude Desktop / Codex.
// Tool definitions live in server.ts and are shared with the Cloudflare Worker entry.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRooveServer, WORKSPACE_ID_PATTERN } from "./server.js";

// ── Load env from parent .env.local ──
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const workspaceId = String(process.env.MCP_WORKSPACE_ID || "").trim();

if (!supabaseUrl || !supabaseKey || !workspaceId) {
  console.error("Missing Supabase credentials or MCP_WORKSPACE_ID in .env.local");
  process.exit(1);
}
if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
  console.error("MCP_WORKSPACE_ID must be a valid workspace UUID");
  process.exit(1);
}

const svc: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const server = createRooveServer(svc, workspaceId, { includePii: true });

// ── Start ──
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
