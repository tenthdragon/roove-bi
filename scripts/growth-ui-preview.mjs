import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const root = process.cwd(),
  output = "/private/tmp/roove-growth-ui-preview";
await build({
  entryPoints: [path.join(root, "tests/fixtures/growth-preview.tsx")],
  bundle: true,
  outdir: output,
  entryNames: "preview",
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  alias: {
    "@/lib/growth-actions": path.join(root, "tests/fixtures/growth-actions.ts"),
    "next/navigation": path.join(root, "tests/fixtures/growth-navigation.tsx"),
    "next/link": path.join(root, "tests/fixtures/growth-navigation.tsx"),
  },
  loader: { ".css": "local-css" },
});
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/theme.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(await readFile(path.join(root, "app/globals.css")));
    } else if (req.url?.startsWith("/preview.")) {
      const name = req.url.split("?")[0];
      res.setHeader(
        "Content-Type",
        name.endsWith(".css") ? "text/css" : "application/javascript",
      );
      res.end(await readFile(path.join(output, name)));
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!DOCTYPE html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Growth Execution · Preview</title><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/preview.css"><div id="root"></div><script src="/preview.js"></script></html>',
      );
    }
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
});
server.listen(3127, "127.0.0.1", () =>
  console.log(
    "Growth fixture preview: http://127.0.0.1:3127/dashboard/growth-work",
  ),
);
