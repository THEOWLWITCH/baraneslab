// Baranes Lab API: /api/* (content, login, history, images). Data lives in Netlify Blobs (store "baraneslab").
import { handle } from '../lib/core.mjs';
import { runOnce } from '../lib/migrate.mjs';

let migrated = false;
async function runMigration(store, req) {
  if (migrated) return;
  migrated = await runOnce(store, async () => {
    const res = await fetch(new URL('/content.json', req.url), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error('content.json ' + res.status);
    return res.json();
  }, async () => {
    const hook = process.env.BUILD_HOOK_URL;
    if (hook) try { await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(4000) }); } catch (e) { /* the next deploy will do */ }
  });
}

export default async (req, context) => {
  const { getStore } = await import('@netlify/blobs');
  const blobs = getStore({ name: 'baraneslab', consistency: 'strong' });
  const store = {
    getJSON: (k) => blobs.get(k, { type: 'json' }),
    setJSON: (k, v) => blobs.setJSON(k, v),
    getBin: async (k) => {
      const r = await blobs.getWithMetadata(k, { type: 'arrayBuffer' });
      return r ? { data: r.data, type: r.metadata && r.metadata.type } : null;
    },
    setBin: (k, data, type) => blobs.set(k, data, { metadata: { type } }),
    del: (k) => blobs.delete(k),
    list: async (prefix) => (await blobs.list({ prefix })).blobs.map((b) => b.key),
  };
  const env = { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, SESSION_SECRET: process.env.SESSION_SECRET };
  const ip = (context && context.ip) || req.headers.get('x-nf-client-connection-ip') || '';
  try {
    try { await runMigration(store, req); } catch (e) { console.error('migration', e.message); }
    const res = await handle(req, store, env, ip);
    // After publishing from the admin page, rebuild the site so the pages Google reads (and sitemap) match.
    const hook = process.env.BUILD_HOOK_URL;
    if (hook && req.method === 'PUT' && new URL(req.url).pathname === '/api/content' && res.status === 200) {
      try { await fetch(hook, { method: 'POST', signal: AbortSignal.timeout(4000) }); } catch (e) { console.error('build hook', e.message); }
    }
    return res;
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: 'server error' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};

export const config = { path: '/api/*' };
