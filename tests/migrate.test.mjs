import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrate } from '../netlify/lib/migrate.mjs';

const defaults = JSON.parse(readFileSync(new URL('../content.json', import.meta.url)));
// published before the alumni change, with the English vision copied into the Hebrew tab
function published() {
  const c = JSON.parse(JSON.stringify(defaults));
  for (const L of c.languages) {
    const secs = c[L].sections, al = secs.find((s) => s.id === 'alumni'), team = secs.find((s) => s.id === 'team');
    team.items.push(...al.items, { name: L === 'he' ? 'הילה גולדמן' : 'Hila Goldman', role: '' }, { name: L === 'he' ? 'גלעד לביא' : 'Gilad Lavi', role: '' });
    secs.splice(secs.indexOf(al), 1);
    delete c[L].site.keywords;
  }
  const en = c.en.sections.find((s) => s.id === 'vision');
  c.he.sections[c.he.sections.findIndex((s) => s.id === 'vision')] = JSON.parse(JSON.stringify(en));
  c.he.sections.find((s) => s.id === 'team').items[1].bio = 'ביו שנערך בניהול';
  return c;
}

test('migration: Hebrew text back, alumni section, removed people, kept edits', () => {
  const { content: c, changes } = migrate(published(), defaults);
  assert.ok(changes.length > 0);
  const hv = c.he.sections.find((s) => s.id === 'vision');
  assert.equal(hv.title, 'חזון מדעי');
  assert.match(hv.body, /נקודת מבט מבנית/);
  for (const L of ['en', 'he']) {
    const ids = c[L].sections.map((s) => s.id);
    assert.equal(ids.indexOf('alumni'), ids.indexOf('team') + 1, L + ': alumni right after team');
    const team = c[L].sections.find((s) => s.id === 'team').items.map((p) => p.name).join(' ');
    const alumni = c[L].sections.find((s) => s.id === 'alumni').items.map((p) => p.name).join(' ');
    assert.doesNotMatch(team, /Mitra|מיטרה|Akg|אקגון|Goldman|גולדמן|Lavi|לביא/);
    assert.match(alumni, /Mitra|מיטרה/); assert.match(alumni, /Akg|אקגון/);
    assert.equal(c[L].sections.find((s) => s.id === 'alumni').items.length, 2);
    assert.ok(c[L].site.keywords);
  }
  assert.equal(c.he.sections.find((s) => s.id === 'team').items[1].bio, 'ביו שנערך בניהול', 'edits made in the admin page are kept');
  assert.deepEqual(c.en.sections.find((s) => s.id === 'vision'), defaults.en.sections.find((s) => s.id === 'vision'), 'English untouched');
});

test('migration is safe to run again, and leaves current content alone', () => {
  const once = migrate(published(), defaults).content;
  assert.equal(migrate(once, defaults).changes.length, 0);
  assert.equal(migrate(defaults, defaults).changes.length, 0);
});

test('server: runs once, keeps a backup in the history, then leaves the content alone', async () => {
  const { runOnce } = await import('../netlify/lib/migrate.mjs');
  const { memStore } = await import('./memstore.mjs');
  const s = memStore(), old = published();
  await s.setJSON('content', old);
  let hooks = 0;
  await runOnce(s, async () => defaults, async () => { hooks++; });
  const now = await s.getJSON('content');
  assert.ok(now.he.sections.some((x) => x.id === 'alumni'));
  const hist = await s.list('history/');
  assert.equal(hist.length, 1);
  assert.deepEqual(await s.getJSON(hist[0]), old);
  assert.equal(hooks, 1);
  now.en.site.title = 'Edited after the fix';
  await s.setJSON('content', now);
  await runOnce(s, async () => { throw new Error('should not load again'); });
  assert.equal((await s.getJSON('content')).en.site.title, 'Edited after the fix');
});

test('server: nothing published yet, nothing changes', async () => {
  const { runOnce } = await import('../netlify/lib/migrate.mjs');
  const { memStore } = await import('./memstore.mjs');
  const s = memStore();
  await runOnce(s, async () => defaults);
  assert.equal(await s.getJSON('content'), null);
});
