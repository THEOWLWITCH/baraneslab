import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('search build: content in the HTML, a page per language, sitemap and robots', () => {
  const out = mkdtempSync(join(tmpdir(), 'seo-'));
  execFileSync(process.execPath, [new URL('../tools/build-seo.mjs', import.meta.url).pathname, '--out', out], { env: { ...process.env, SITE_URL: 'https://lab.example', NETLIFY: '' } });
  const en = readFileSync(join(out, 'index.html'), 'utf8'), he = readFileSync(join(out, 'he', 'index.html'), 'utf8');
  assert.match(en, /<link rel="canonical" href="https:\/\/lab\.example\/">/);
  assert.match(he, /<link rel="canonical" href="https:\/\/lab\.example\/he\/">/);
  assert.match(he, /<html lang="he" dir="rtl">/);
  assert.match(en, /hreflang="he" href="https:\/\/lab\.example\/he\/"/);
  assert.match(en, /<h1 id="title">Network Architecture &amp; Information Lab<\/h1>/);
  assert.match(en, /Coral Skeleton/);
  assert.doesNotMatch(en, /<p class="loading">/);
  const ld = JSON.parse(en.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.ok(ld['@graph'].some((n) => n['@type'] === 'ResearchOrganization'));
  assert.ok(ld['@graph'].filter((n) => n['@type'] === 'ScholarlyArticle').length >= 10);
  const sm = readFileSync(join(out, 'sitemap.xml'), 'utf8');
  assert.match(sm, /<loc>https:\/\/lab\.example\/he\/<\/loc>/);
  const rb = readFileSync(join(out, 'robots.txt'), 'utf8');
  assert.match(rb, /Disallow: \/admin/);
  assert.match(rb, /Sitemap: https:\/\/lab\.example\/sitemap\.xml/);
});
