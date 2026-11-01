// Baranes Lab · server logic (pure, testable). The Netlify function wraps it with Netlify Blobs.
// store interface:
//   getJSON(key) → object|null · setJSON(key, obj) · getBin(key) → {data:ArrayBuffer, type}|null
//   setBin(key, ArrayBuffer, type) · del(key) · list(prefix) → [key]
// env: { ADMIN_PASSWORD, SESSION_SECRET? }
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const MAX_CONTENT = 1_500_000;      // bytes of JSON
export const MAX_IMAGE = 4_000_000;        // bytes after decoding
export const KEEP_HISTORY = 30;
const TOKEN_HOURS = 12;
const LOGIN_TRIES = 8;                     // per IP per 15 minutes
const IMG_TYPES = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

const json = (status, body, extra = {}) => new Response(status === 204 ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
});
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const secretOf = (env) => createHash('sha256').update('baraneslab:' + String(env.ADMIN_PASSWORD) + ':' + String(env.SESSION_SECRET || '')).digest();
const sign = (env, payload) => b64u(createHmac('sha256', secretOf(env)).update(payload).digest());
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function makeToken(env, now = Date.now()) {
  const payload = b64u(JSON.stringify({ exp: now + TOKEN_HOURS * 3600e3, n: b64u(randomBytes(6)) }));
  return payload + '.' + sign(env, payload);
}
export function checkToken(env, token, now = Date.now()) {
  if (!env.ADMIN_PASSWORD || !token || typeof token !== 'string') return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !eq(sig, sign(env, payload))) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > now; } catch (e) { return false; }
}
const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

// Content must be an object with a site object and a sections array. Keeps anything else the editor adds.
export function validContent(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'content must be an object';
  if (Array.isArray(c.languages)) { // several languages: {languages:['en','he'], en:{site,sections}, ...}
    if (!c.languages.length || c.languages.length > 6) return 'bad languages';
    for (const l of c.languages) {
      if (!/^[a-z]{2}$/.test(l)) return 'bad language code';
      const bad = validContent(c[l]);
      if (bad) return l + ': ' + bad;
    }
    return '';
  }
  if (!c.site || typeof c.site !== 'object') return 'missing site';
  if (!Array.isArray(c.sections)) return 'missing sections';
  for (const s of c.sections) {
    if (!s || typeof s !== 'object' || typeof s.type !== 'string' || typeof s.id !== 'string') return 'bad section';
    if (s.items != null && !Array.isArray(s.items)) return 'bad items in ' + s.id;
  }
  return '';
}

export async function handle(req, store, env, ip = '') {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  const authed = () => checkToken(env, bearer(req));
  if (m === 'OPTIONS') return json(204);

  // ── public content
  if (path === '/api/content' && m === 'GET') {
    const c = await store.getJSON('content');
    if (!c) return json(404, { error: 'no saved content' });
    return json(200, c, { 'cache-control': 'public, max-age=0, must-revalidate' });
  }

  // ── public images
  const im = path.match(/^\/api\/img\/([A-Za-z0-9_-]{8,40}\.(webp|jpg|png|gif|svg|avif))$/);
  if (im && m === 'GET') {
    const f = await store.getBin('img/' + im[1]);
    if (!f) return new Response('not found', { status: 404 });
    const h = { 'content-type': f.type || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' };
    if (f.type === 'image/svg+xml') h['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    return new Response(f.data, { status: 200, headers: h });
  }

  // ── login
  if (path === '/api/login' && m === 'POST') {
    if (!env.ADMIN_PASSWORD) return json(503, { error: 'ADMIN_PASSWORD is not set in Netlify' });
    const win = Math.floor(Date.now() / 900e3), rk = 'rl/login/' + win + '/' + String(ip).replace(/[^0-9a-fA-F:.]/g, '').slice(0, 64);
    const used = Number(((await store.getJSON(rk)) || {}).n) || 0;
    if (used >= LOGIN_TRIES) return json(429, { error: 'too many attempts, try again in 15 minutes' });
    let body = {};
    try { body = await req.json(); } catch (e) { /* empty */ }
    if (!eq(createHash('sha256').update(String(body.password || '')).digest('hex'), createHash('sha256').update(String(env.ADMIN_PASSWORD)).digest('hex'))) {
      await store.setJSON(rk, { n: used + 1 });
      return json(401, { error: 'wrong password' });
    }
    return json(200, { token: makeToken(env), hours: TOKEN_HOURS });
  }

  // ── everything below needs a token
  if (!path.startsWith('/api/')) return json(404, { error: 'not found' });
  if (!authed()) return json(401, { error: 'not signed in' });

  if (path === '/api/session' && m === 'GET') return json(200, { ok: true });

  if (path === '/api/content' && m === 'PUT') {
    const raw = await req.text();
    if (raw.length > MAX_CONTENT) return json(413, { error: 'content too large' });
    let c;
    try { c = JSON.parse(raw); } catch (e) { return json(400, { error: 'invalid JSON' }); }
    const bad = validContent(c);
    if (bad) return json(400, { error: bad });
    const old = await store.getJSON('content');
    if (old) {
      await store.setJSON('history/' + new Date().toISOString().replace(/[:.]/g, '-'), old);
      const keys = (await store.list('history/')).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_HISTORY))) await store.del(k);
    }
    c.updatedAt = new Date().toISOString();
    await store.setJSON('content', c);
    return json(200, { ok: true, updatedAt: c.updatedAt });
  }

  if (path === '/api/history' && m === 'GET') {
    const key = url.searchParams.get('key');
    if (key) {
      if (!/^history\/[0-9TZ-]+$/.test(key)) return json(400, { error: 'bad key' });
      const c = await store.getJSON(key);
      return c ? json(200, c) : json(404, { error: 'not found' });
    }
    const keys = (await store.list('history/')).sort().reverse();
    return json(200, { items: keys.map((k) => ({ key: k, at: k.slice(8).replace(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, '$1T$2:$3:$4.$5Z') })) });
  }

  if (path === '/api/img' && m === 'POST') {
    let body;
    try { body = await req.json(); } catch (e) { return json(400, { error: 'invalid JSON' }); }
    const mm = String(body.dataUrl || '').match(/^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/i);
    if (!mm || !IMG_TYPES[mm[1].toLowerCase()]) return json(400, { error: 'unsupported image' });
    const type = mm[1].toLowerCase(), data = Buffer.from(mm[2], 'base64');
    if (data.length > MAX_IMAGE) return json(413, { error: 'image too large (max 4MB)' });
    const name = b64u(randomBytes(12)) + '.' + IMG_TYPES[type];
    await store.setBin('img/' + name, data.buffer.slice(data.byteOffset, data.byteOffset + data.length), type);
    return json(200, { url: '/api/img/' + name });
  }

  if (im && m === 'DELETE') {
    await store.del('img/' + im[1]);
    return json(200, { ok: true });
  }

  if (path === '/api/images' && m === 'GET') {
    const keys = await store.list('img/');
    return json(200, { items: keys.map((k) => '/api/' + k) });
  }

  return json(404, { error: 'not found' });
}
