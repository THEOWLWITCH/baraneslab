// Search-engine build step (runs on every Netlify deploy, see netlify.toml).
// Writes the real content into index.html (so it is readable without JavaScript),
// adds canonical, hreflang, Open Graph, Twitter and schema.org data, and creates sitemap.xml and robots.txt.
// Content: the version published from the admin page (Netlify Blobs) when available, otherwise content.json.
// Local test: SITE_URL=https://example.org node tools/build-seo.mjs --out /tmp/seo
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? process.argv[outArg + 1] : ROOT;
const SITE = String(process.env.SITE_URL || process.env.URL || 'https://baraneslab.netlify.app').replace(/\/+$/, '');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (s) => String(s == null ? '' : s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^#+\s*/gm, '').replace(/^\s*[-•]\s+/gm, '').trim();
const paras = (s) => plain(s).split(/\n{2,}/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean);
const abs = (u) => (!u ? '' : /^https?:/i.test(u) ? u : SITE + '/' + String(u).replace(/^\/+/, ''));
const clip = (s, n) => { s = plain(s).replace(/\s+/g, ' '); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };

async function loadContent() {
  try {
    if (process.env.NETLIFY && !process.env.SEO_SKIP_BLOBS) {
      const { getStore } = await import('@netlify/blobs');
      const c = await getStore({ name: 'baraneslab', consistency: 'strong' }).get('content', { type: 'json' });
      if (c && c.languages) { console.log('[seo] using content published from the admin page'); return c; }
    }
  } catch (e) { console.log('[seo] published content not available in the build (' + e.message + '), using content.json'); }
  return JSON.parse(readFileSync(join(ROOT, 'content.json'), 'utf8'));
}

function staticBody(doc) {
  const out = [];
  for (const s of (doc.sections || []).filter((x) => x.visible !== false)) {
    out.push(`<section class="sec" id="${esc(s.id)}"><h2>${esc(s.title)}</h2>`);
    if (s.intro) out.push(`<p>${esc(plain(s.intro))}</p>`);
    if (s.type === 'text' || s.type === 'contact') for (const p of paras(s.body)) out.push(`<p>${esc(p)}</p>`);
    if (s.type === 'cards') for (const it of s.items || []) out.push(`<article><h3>${esc(it.title)}</h3>${it.subtitle ? `<p>${esc(it.subtitle)}</p>` : ''}${paras(it.text).map((p) => `<p>${esc(p)}</p>`).join('')}</article>`);
    if (s.type === 'people') for (const p of s.items || []) out.push(`<article><h3>${esc(p.name)}</h3><p>${esc(p.role)}</p>${p.bio ? `<p>${esc(plain(p.bio))}</p>` : ''}${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" width="120" height="120" loading="lazy">` : ''}</article>`);
    if (s.type === 'publications') out.push('<ol>' + (s.items || []).map((p) => `<li>${esc(p.authors)} (${esc(p.year)}). ${p.link ? `<a href="${esc(p.link)}">${esc(p.title)}</a>` : esc(p.title)}. <em>${esc(p.venue)}</em></li>`).join('') + '</ol>');
    if (s.type === 'news') for (const n of s.items || []) out.push(`<article><h3>${esc(n.title)}</h3><p>${esc(n.date)}</p>${paras(n.text).map((p) => `<p>${esc(p)}</p>`).join('')}</article>`);
    if (s.type === 'contact') {
      if (s.name) out.push(`<p>${esc(s.name)}</p>`);
      if (s.email) out.push(`<p><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>`);
      if (s.phone) out.push(`<p>${esc(s.phone)}</p>`);
      if (s.address) out.push(`<p>${esc(s.address)}</p>`);
    }
    out.push('</section>');
  }
  return out.join('\n');
}

function schema(c) {
  const en = c[c.defaultLang] || c[c.languages[0]], site = en.site || {};
  const people = (en.sections || []).filter((s) => s.type === 'people' && s.visible !== false).flatMap((s) => s.items || []);
  const pi = people.find((p) => p.lead) || people[0];
  const contact = (en.sections || []).find((s) => s.type === 'contact') || {};
  const pubs = (en.sections || []).filter((s) => s.type === 'publications').flatMap((s) => s.items || []);
  const uni = { '@type': 'CollegeOrUniversity', name: 'Ariel University', url: 'https://www.ariel.ac.il' };
  const piNode = pi && {
    '@type': 'Person', '@id': SITE + '/#pi', name: pi.name.replace(/^Professor\s+/i, 'Prof. '), jobTitle: pi.role || undefined,
    description: clip(pi.bio, 300) || undefined, image: pi.image ? abs(pi.image) : undefined, affiliation: uni, worksFor: uni,
    email: contact.email ? 'mailto:' + contact.email : undefined, url: SITE + '/',
  };
  const graph = [
    { '@type': 'WebSite', '@id': SITE + '/#website', url: SITE + '/', name: site.title, inLanguage: c.languages, publisher: { '@id': SITE + '/#lab' } },
    {
      '@type': 'ResearchOrganization', '@id': SITE + '/#lab', name: site.title, alternateName: [site.name, c.he && c.he.site && c.he.site.title].filter(Boolean),
      url: SITE + '/', description: clip(site.seoDescription || site.tagline, 300), parentOrganization: uni, logo: abs('assets/favicon.svg'), image: abs('assets/og.jpg'),
      email: contact.email || undefined, telephone: contact.phone || undefined,
      address: contact.address ? { '@type': 'PostalAddress', streetAddress: contact.address, addressCountry: 'IL' } : undefined,
      founder: pi ? { '@id': SITE + '/#pi' } : undefined,
      member: people.filter((p) => p !== pi).map((p) => ({ '@type': 'Person', name: p.name, jobTitle: p.role || undefined })),
      knowsAbout: String(site.keywords || '').split(',').map((k) => k.trim()).filter(Boolean),
    },
    ...(piNode ? [piNode] : []),
    ...pubs.map((p) => ({
      '@type': 'ScholarlyArticle', headline: clip(p.title, 110), name: p.title, datePublished: p.year || undefined,
      author: String(p.authors || '').replace(/\*/g, '').split(/,\s*|\s+and\s+/).map((a) => a.trim()).filter((a) => a && a !== 'et al.').map((a) => ({ '@type': 'Person', name: a })),
      isPartOf: p.venue ? { '@type': 'Periodical', name: p.venue } : undefined, url: p.link || undefined, sameAs: p.link || undefined,
    })),
  ];
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, (k, v) => (v === undefined || (Array.isArray(v) && !v.length) ? undefined : v)).replace(/</g, '\\u003c');
}

const c = await loadContent();
if (!c.languages) throw new Error('content.json: expected {languages, en, he}');
const DEF = c.defaultLang || c.languages[0];
const urlOf = (l) => SITE + (l === DEF ? '/' : '/' + l + '/');
// Search Console code: Netlify env var, or the admin field (site.gsc in any language), or the code verified on 01.11.2026
const VERIFIED = 'gOB2t1Hw_MrHIpl6-DvWI_T3t_qE8EmjLk2fQv_WbGs';
const verify = String(process.env.GOOGLE_SITE_VERIFICATION || c.languages.map((l) => c[l].site && c[l].site.gsc).find((v) => v && String(v).trim()) || VERIFIED)
  .trim().replace(/^.*content=["']([^"']+)["'].*$/s, '$1'); // a whole pasted <meta> tag works too
const template = readFileSync(join(ROOT, 'index.html'), 'utf8');
const LOCALE = { he: 'he_IL', en: 'en_US', ar: 'ar_AR' };

function page(L) {
  const doc = c[L], site = doc.site || {};
  const title = [site.title, site.subtitle].filter(Boolean).join(' · ');
  const desc = clip(site.seoDescription || site.tagline, 160);
  const head = [
    `<link rel="canonical" href="${urlOf(L)}">`,
    ...c.languages.map((l) => `<link rel="alternate" hreflang="${l}" href="${urlOf(l)}">`),
    `<link rel="alternate" hreflang="x-default" href="${urlOf(DEF)}">`,
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    `<meta name="keywords" content="${esc(site.keywords || '')}">`,
    `<meta name="author" content="${esc((site.subtitle || '').split('·')[0].trim())}">`,
    '<meta property="og:type" content="website">', `<meta property="og:url" content="${urlOf(L)}">`,
    `<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:image" content="${SITE}/assets/og.jpg">`, '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
    `<meta property="og:site_name" content="${esc(site.title)}">`, `<meta property="og:locale" content="${LOCALE[L] || L}">`,
    ...c.languages.filter((l) => l !== L).map((l) => `<meta property="og:locale:alternate" content="${LOCALE[l] || l}">`),
    '<meta name="twitter:card" content="summary_large_image">', `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`, `<meta name="twitter:image" content="${SITE}/assets/og.jpg">`,
    verify ? `<meta name="google-site-verification" content="${esc(verify)}">` : '',
    `<script type="application/ld+json">${schema(c)}</script>`,
  ].filter(Boolean).join('\n');
  const rtl = /^(he|ar)/.test(L);
  return template
    .replace(/<html lang="[^"]*" dir="[^"]*">/, `<html lang="${L}" dir="${rtl ? 'rtl' : 'ltr'}">`)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace(/<!--SEO-HEAD-->[\s\S]*?(?=<link rel="preconnect")/, '<!--SEO-HEAD-->\n' + head + '\n')
    .replace(/<!--SEO-BODY-->[\s\S]*?<!--\/SEO-BODY-->/, '<!--SEO-BODY-->\n' + staticBody(doc) + '\n<!--/SEO-BODY-->')
    .replace(/<span id="eyebrow">[^<]*<\/span>/, `<span id="eyebrow">${esc(site.eyebrow)}</span>`)
    .replace(/<span id="brandName">[^<]*<\/span>/, `<span id="brandName">${esc(site.name)}</span>`)
    .replace(/<h1 id="title">[^<]*<\/h1>/, `<h1 id="title">${esc(site.title)}</h1>`)
    .replace(/<p class="sub" id="subtitle">[^<]*<\/p>/, `<p class="sub" id="subtitle">${esc(site.subtitle)}</p>`)
    .replace(/<p class="tagline" id="tagline">[^<]*<\/p>/, `<p class="tagline" id="tagline">${esc(plain(site.tagline))}</p>`);
}

mkdirSync(OUT, { recursive: true });
for (const l of c.languages) {
  const dir = l === DEF ? OUT : join(OUT, l);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), page(l));
}
const today = new Date().toISOString().slice(0, 10);
const links = c.languages.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${urlOf(l)}"/>`).join('\n');
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${c.languages.map((l) => `  <url>
    <loc>${urlOf(l)}</loc>
    <lastmod>${today}</lastmod>
${links}
    <xhtml:link rel="alternate" hreflang="x-default" href="${urlOf(DEF)}"/>
  </url>`).join('\n')}
</urlset>
`);
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin.html

Sitemap: ${SITE}/sitemap.xml
`);
console.log(`[seo] ${SITE}: ${c.languages.map(urlOf).join(' ')} · sitemap.xml · robots.txt`);

// IndexNow: on a production deploy, tell Bing, Yandex and other engines that the pages changed.
// (Google does not use IndexNow; for Google the sitemap is found through robots.txt and Search Console.)
const INDEXNOW_KEY = '441946cd9b0ef7ad3ae23a9da6e775d4';
if (process.env.CONTEXT === 'production' || process.env.INDEXNOW_FORCE) {
  try {
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ host: new URL(SITE).hostname, key: INDEXNOW_KEY, keyLocation: SITE + '/' + INDEXNOW_KEY + '.txt', urlList: c.languages.map(urlOf) }),
    });
    console.log('[seo] IndexNow:', r.status);
  } catch (e) { console.log('[seo] IndexNow skipped:', e.message); }
} else console.log('[seo] IndexNow: not a production deploy, skipped');
