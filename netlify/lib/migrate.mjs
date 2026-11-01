// One-time content fixes, applied on the server to the content published from the admin page.
// Pure function: migrate(content, defaults) → { content, changes[] }. Safe to run more than once.
//
// 2026-11-01:
//  1. A Hebrew section that holds no Hebrew at all (copied from English by mistake) gets its Hebrew text back
//     from the default content (content.json); its images, video, background and visibility are kept.
//  2. "Alumni" section in every language, right after Team: Shreyasi Mitra and Olcay Akgün move there.
//     Hila Goldman and Gilad Lavi are removed (asked on 01.11.2026).
//  3. Fields added in the redesign, if missing: keywords (ticker), Search Console code, the vision video.

const HEB = /[֐-׿]/;
const TEXT_KEYS = ['title', 'navTitle', 'body', 'intro', 'imageAlt', 'name'];
const ALUMNI = /mitra|מיטרה|akg[uü]n|אקגון|אקוגן|אולצ/i;
const REMOVE = /goldman|גולדמן|\blavi\b|לביא/i;
const clone = (o) => JSON.parse(JSON.stringify(o));
// all human-readable text in a section, without links and file names
const textOf = (s) => JSON.stringify(s, (k, v) => (/^(image|bg|video|link|url|mapUrl|id|type)$/.test(k) ? undefined : v));

export function migrate(input, defaults) {
  const c = clone(input), changes = [];
  if (!c || !Array.isArray(c.languages) || !defaults || !Array.isArray(defaults.languages)) return { content: input, changes };

  // 1. Hebrew (or Arabic) sections with no Hebrew/Arabic text get their own language back
  for (const L of c.languages.filter((l) => /^(he|ar)$/.test(l))) {
    const def = defaults[L];
    if (!def || !c[L]) continue;
    c[L].sections = c[L].sections.map((s) => {
      const d = def.sections.find((x) => x.id === s.id);
      if (!d || HEB.test(textOf(s)) || !HEB.test(textOf(d))) return s;
      const fixed = clone(d);
      for (const k of ['image', 'video', 'bg', 'visible', 'nav']) if (s[k] !== undefined && s[k] !== '') fixed[k] = s[k];
      changes.push(`${L}: restored the ${L === 'he' ? 'Hebrew' : 'Arabic'} text of "${d.title}"`);
      return fixed;
    });
    for (const k of TEXT_KEYS) {
      const v = c[L].site && c[L].site[k];
      if (typeof v === 'string' && v && !HEB.test(v) && def.site && HEB.test(def.site[k] || '')) { c[L].site[k] = def.site[k]; changes.push(`${L}: restored site ${k}`); }
    }
  }

  for (const L of c.languages) {
    const doc = c[L], def = defaults[L] || defaults[defaults.defaultLang];
    if (!doc || !Array.isArray(doc.sections)) continue;
    const team = doc.sections.find((s) => s.id === 'team') || doc.sections.find((s) => s.type === 'people');

    // 2. alumni
    if (team && Array.isArray(team.items)) {
      const before = team.items.length;
      team.items = team.items.filter((p) => !REMOVE.test(p.name || ''));
      if (team.items.length < before) changes.push(`${L}: removed ${before - team.items.length} people (Goldman, Lavi)`);
      let alumni = doc.sections.find((s) => s.id === 'alumni');
      const moving = team.items.filter((p) => ALUMNI.test(p.name || ''));
      if (moving.length || !alumni) {
        if (!alumni) {
          const d = def && def.sections.find((s) => s.id === 'alumni');
          alumni = d ? Object.assign(clone(d), { items: (d.items || []).filter((x) => !team.items.some((p) => p.name === x.name) && !moving.some((p) => p.name === x.name)) }) : { id: 'alumni', type: 'people', title: L === 'he' ? 'בוגרי המעבדה' : 'Alumni', nav: true, visible: true, intro: '', bg: '', items: [] };
          doc.sections.splice(doc.sections.indexOf(team) + 1, 0, alumni);
          changes.push(`${L}: added the "${alumni.title}" section`);
        }
        alumni.items = alumni.items || [];
        for (const p of moving) {
          team.items.splice(team.items.indexOf(p), 1);
          if (!alumni.items.some((x) => x.name === p.name)) alumni.items.push(p);
          changes.push(`${L}: moved ${p.name} to ${alumni.title}`);
        }
      }
      if (alumni && Array.isArray(alumni.items)) {
        const n = alumni.items.length;
        alumni.items = alumni.items.filter((p) => !REMOVE.test(p.name || ''));
        if (alumni.items.length < n) changes.push(`${L}: removed ${n - alumni.items.length} people from alumni`);
      }
    }

    // 3. fields added in the redesign
    if (doc.site && def && def.site) {
      for (const k of ['keywords', 'gsc']) if (!doc.site[k] && def.site[k]) { doc.site[k] = def.site[k]; changes.push(`${L}: added ${k}`); }
    }
    const vis = doc.sections.find((s) => s.id === 'vision'), dvis = def && def.sections.find((s) => s.id === 'vision');
    if (vis && dvis && dvis.video && !doc.sections.some((s) => s.video)) { vis.video = (doc.site && doc.site.heroVideo) || dvis.video; changes.push(`${L}: added the vision video`); }
  }
  return { content: changes.length ? c : input, changes };
}

// Runs migrate() once on the published content. A backup goes to the version history first.
// store: same interface as in core.mjs · loadDefaults(): content.json · onChange(): e.g. trigger a rebuild
export const MIGRATION = 'migrations/2026-11-01';
export async function runOnce(store, loadDefaults, onChange) {
  if (await store.getJSON(MIGRATION)) return true;
  const current = await store.getJSON('content');
  let changes = [];
  if (current) {
    const out = migrate(current, await loadDefaults());
    changes = out.changes;
    if (changes.length) {
      await store.setJSON('history/' + new Date().toISOString().replace(/[:.]/g, '-'), current);
      out.content.updatedAt = new Date().toISOString();
      await store.setJSON('content', out.content);
      if (onChange) await onChange(changes);
    }
  }
  await store.setJSON(MIGRATION, { at: new Date().toISOString(), changes });
  console.log('migration', MIGRATION, changes);
  return true;
}
