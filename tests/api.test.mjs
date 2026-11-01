import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle, makeToken, checkToken, validContent } from '../netlify/lib/core.mjs';
import { memStore } from './memstore.mjs';

const env = { ADMIN_PASSWORD: 'secret-pass' };
const U = 'https://lab.example';
const req = (path, opts = {}) => new Request(U + path, opts);
const auth = (t) => ({ authorization: 'Bearer ' + t });
const content = JSON.parse(readFileSync(new URL('../content.json', import.meta.url)));

test('default content is valid', () => assert.equal(validContent(content), ''));

test('login: wrong password, right password, rate limit', async () => {
  const s = memStore();
  let r = await handle(req('/api/login', { method: 'POST', body: JSON.stringify({ password: 'x' }) }), s, env, '1.1.1.1');
  assert.equal(r.status, 401);
  r = await handle(req('/api/login', { method: 'POST', body: JSON.stringify({ password: 'secret-pass' }) }), s, env, '1.1.1.1');
  assert.equal(r.status, 200);
  const { token } = await r.json();
  assert.ok(checkToken(env, token));
  assert.ok(!checkToken({ ADMIN_PASSWORD: 'other' }, token), 'changing the password invalidates tokens');
  for (let i = 0; i < 8; i++) await handle(req('/api/login', { method: 'POST', body: '{"password":"no"}' }), s, env, '2.2.2.2');
  r = await handle(req('/api/login', { method: 'POST', body: JSON.stringify({ password: 'secret-pass' }) }), s, env, '2.2.2.2');
  assert.equal(r.status, 429);
});

test('no password configured: login says so, nothing is writable', async () => {
  const s = memStore();
  const r = await handle(req('/api/login', { method: 'POST', body: '{}' }), s, {}, '');
  assert.equal(r.status, 503);
  assert.ok(!checkToken({}, makeToken({ ADMIN_PASSWORD: '' })));
});

test('content: public read, write needs a token, history kept', async () => {
  const s = memStore();
  assert.equal((await handle(req('/api/content'), s, env)).status, 404);
  assert.equal((await handle(req('/api/content', { method: 'PUT', body: JSON.stringify(content) }), s, env)).status, 401);
  assert.equal((await handle(req('/api/content', { method: 'PUT', headers: auth('bad.token'), body: JSON.stringify(content) }), s, env)).status, 401);
  const t = makeToken(env);
  let r = await handle(req('/api/content', { method: 'PUT', headers: auth(t), body: JSON.stringify(content) }), s, env);
  assert.equal(r.status, 200);
  const c2 = structuredClone(content); c2.en.site.title = 'Changed';
  r = await handle(req('/api/content', { method: 'PUT', headers: auth(t), body: JSON.stringify(c2) }), s, env);
  assert.equal(r.status, 200);
  r = await handle(req('/api/content'), s, env);
  assert.equal((await r.json()).en.site.title, 'Changed');
  r = await handle(req('/api/history', { headers: auth(t) }), s, env);
  const h = await r.json();
  assert.equal(h.items.length, 1);
  r = await handle(req('/api/history?key=' + encodeURIComponent(h.items[0].key), { headers: auth(t) }), s, env);
  assert.equal((await r.json()).en.site.title, content.en.site.title);
  assert.equal((await handle(req('/api/history?key=content', { headers: auth(t) }), s, env)).status, 400);
  assert.equal((await handle(req('/api/content', { method: 'PUT', headers: auth(t), body: '{"site":{}}' }), s, env)).status, 400);
  assert.equal((await handle(req('/api/content', { method: 'PUT', headers: auth(t), body: 'x'.repeat(1_600_000) }), s, env)).status, 413);
});

test('images: upload needs a token, served publicly, only image types', async () => {
  const s = memStore(), t = makeToken(env);
  const png = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71]).toString('base64');
  assert.equal((await handle(req('/api/img', { method: 'POST', body: JSON.stringify({ dataUrl: png }) }), s, env)).status, 401);
  assert.equal((await handle(req('/api/img', { method: 'POST', headers: auth(t), body: JSON.stringify({ dataUrl: 'data:text/html;base64,PGI+' }) }), s, env)).status, 400);
  let r = await handle(req('/api/img', { method: 'POST', headers: auth(t), body: JSON.stringify({ dataUrl: png }) }), s, env);
  const { url } = await r.json();
  assert.match(url, /^\/api\/img\/[\w-]+\.png$/);
  r = await handle(req(url), s, env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal((await handle(req(url, { method: 'DELETE' }), s, env)).status, 401);
  assert.equal((await handle(req(url, { method: 'DELETE', headers: auth(t) }), s, env)).status, 200);
  assert.equal((await handle(req(url), s, env)).status, 404);
});

test('languages: every language is checked, single-language content still works', () => {
  assert.equal(validContent({ languages: ['en', 'he'], en: content.en, he: { site: {} } }), 'he: missing sections');
  assert.equal(validContent({ languages: ['xx1'], xx1: content.en }), 'bad language code');
  assert.equal(validContent(content.en), '');
  assert.deepEqual(content.languages, ['en', 'he']);
  assert.equal(content.en.sections.length, content.he.sections.length);
});
