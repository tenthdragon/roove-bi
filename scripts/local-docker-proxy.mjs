import http from 'node:http';
import net from 'node:net';
import { chmod, unlink } from 'node:fs/promises';
import { PROJECT_ID } from './local-supabase-lib.mjs';

// Supabase CLI 2.75 omits HostIp. Docker Desktop does not consistently honor
// the bridge's default binding option, so set it explicitly at container create.
// Other Docker requests pass through unchanged; no daemon settings are modified.
export function loopbackCreateBody(body) {
  const config = JSON.parse(body);
  if (config.Labels?.['com.supabase.cli.project'] !== PROJECT_ID) {
    throw new Error('Refusing container creation outside the local Roove project');
  }
  for (const bindings of Object.values(config.HostConfig?.PortBindings || {})) {
    for (const binding of bindings || []) binding.HostIp = '127.0.0.1';
  }
  return JSON.stringify(config);
}

export async function createLoopbackProxy(socketPath, upstreamPath) {
  const sockets = new Set();
  const server = http.createServer(async (request, response) => {
    try {
      let body;
      const headers = { ...request.headers };
      if (request.method === 'POST' && /^\/(?:v[\d.]+\/)?containers\/create(?:\?|$)/.test(request.url)) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        body = loopbackCreateBody(Buffer.concat(chunks).toString('utf8'));
        headers['content-length'] = Buffer.byteLength(body);
        delete headers['transfer-encoding'];
      }
      const upstream = http.request({ socketPath: upstreamPath, path: request.url, method: request.method, headers }, (result) => {
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response);
      });
      upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end('Local Docker connection failed'); });
      request.on('aborted', () => upstream.destroy());
      if (body !== undefined) upstream.end(body);
      else request.pipe(upstream);
    } catch {
      response.writeHead(400); response.end('Local Docker container guard rejected request');
    }
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  // Docker exec uses a hijacked/upgrade stream; forward it without inspection.
  server.on('upgrade', (request, socket, head) => {
    const upstream = net.createConnection(upstreamPath);
    sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
    upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
    upstream.on('connect', () => {
      const headers = [];
      for (let i = 0; i < request.rawHeaders.length; i += 2) headers.push(`${request.rawHeaders[i]}: ${request.rawHeaders[i + 1]}`);
      upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream); upstream.pipe(socket);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  return async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await unlink(socketPath).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  };
}
