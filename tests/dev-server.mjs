// Local dev server: static files + the same API with an in-memory store.
// node tests/dev-server.mjs [port]   (password: ADMIN_PASSWORD env, default "dev")
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../netlify/lib/core.mjs';
import { memStore } from './memstore.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
const store = memStore(), env = { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'dev' };
const port = Number(process.argv[2]) || 8787;
http.createServer(async (rq, rs) => {
  const url = new URL(rq.url, 'http://localhost');
  if (url.pathname.startsWith('/api/') && process.env.NO_API !== '1') {
    const chunks = []; for await (const c of rq) chunks.push(c);
    const body = chunks.length && !/GET|HEAD/.test(rq.method) ? Buffer.concat(chunks) : undefined;
    const r = await handle(new Request(url, { method: rq.method, headers: rq.headers, body }), store, env, rq.socket.remoteAddress);
    rs.writeHead(r.status, Object.fromEntries(r.headers)); rs.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const p = normalize(join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { rs.writeHead(403); rs.end(); return; }
  try { const d = await readFile(p); rs.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); rs.end(d); }
  catch { rs.writeHead(404, { 'content-type': 'text/html' }); rs.end('not found'); }
}).listen(port, () => console.log('http://localhost:' + port));
