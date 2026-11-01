// Baranes Lab API: /api/* (content, login, history, images). Data lives in Netlify Blobs (store "baraneslab").
import { handle } from '../lib/core.mjs';

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
    return await handle(req, store, env, ip);
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: 'server error' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};

export const config = { path: '/api/*' };
