/* Baranes Lab · admin editor: edit, add, delete and reorder everything on the site. */
(function () {
  'use strict';
  var B = window.BL, esc = B.esc;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var TOKEN_KEY = 'bl.token', DRAFT_KEY = 'bl.draft.v2', PREVIEW_KEY = 'bl.preview';

  var C = null;            // all content: {languages, defaultLang, en:{site,sections}, he:{...}}
  var D = null;            // the language being edited (C[LANG])
  var LANG = 'en';
  var LANG_NAME = { en: 'English', he: 'עברית', ar: 'العربية', fr: 'Français', de: 'Deutsch' };
  var savedJSON = '';      // last saved/published content, to know if there are changes
  var LOCAL = false;       // no Netlify functions (local preview)
  var view = 'site';       // 'site' | 'history' | 'help' | section index
  var token = sessionStorage.getItem(TOKEN_KEY) || '';

  // ── schemas: what can be edited in each part
  var SITE_FIELDS = [
    { k: 'name', l: 'שם האתר (בפינה העליונה)' },
    { k: 'accent', l: 'צבע הדגשה', t: 'color', h: 'הרקע תמיד כחול כהה מאוד. הצבע הזה לכפתורים, לקישורים ולרשת בפתיח.' },
    { k: 'eyebrow', l: 'שורה קטנה מעל הכותרת', h: 'למשל: Welcome to the' },
    { k: 'title', l: 'כותרת ראשית בפתיח' },
    { k: 'subtitle', l: 'שורה מתחת לכותרת', w: 1 },
    { k: 'tagline', l: 'משפט פתיחה', t: 'area', w: 1 },
    { k: 'highlight', l: 'הודעה מודגשת בצהוב (רשות)', h: 'למשל: משרות מחקר פתוחות' }, { k: 'highlightLink', l: 'קישור ההודעה', t: 'url', h: 'למשל #join' },
    { k: 'ctaText', l: 'כפתור ראשי: טקסט' }, { k: 'ctaLink', l: 'כפתור ראשי: קישור', t: 'url', h: 'למשל #projects לחלק באתר' },
    { k: 'cta2Text', l: 'כפתור שני: טקסט' }, { k: 'cta2Link', l: 'כפתור שני: קישור', t: 'url' },
    { k: 'heroImage', l: 'תמונת רקע לפתיח (רשות)', t: 'image', w: 1, h: 'מוצגת בעדינות מאחורי רשת הנוירונים.' },
    { k: 'hero1', l: 'תמונה בפתיח 1 (עיגול סביב הרשת)', t: 'image', w: 1 }, { k: 'hero2', l: 'תמונה בפתיח 2', t: 'image', w: 1 },
    { k: 'hero3', l: 'תמונה בפתיח 3', t: 'image', w: 1 }, { k: 'hero4', l: 'תמונה בפתיח 4', t: 'image', w: 1 },
    { k: 'keywords', l: 'מילות מפתח (הפס שנע מתחת לפתיח)', t: 'area', w: 1, h: 'מופרדות בפסיק' },
    { k: 'logo', l: 'לוגו (רשות)', t: 'image', w: 1 },
    { k: 'pubHighlight', l: 'שם להדגשה ברשימת הפרסומים', h: 'למשל: Baranes' },
    { k: 'footer', l: 'שורת התחתית', w: 1 },
    { k: 'credit', l: 'שורת קרדיט בתחתית', w: 1 },
    { k: 'seoDescription', l: 'תיאור לגוגל ולשיתוף', t: 'area', w: 1 },
    { k: 'gsc', l: 'קוד אימות של Google Search Console (רשות)', t: 'url', w: 1, h: 'אפשר להדביק את התג כולו או רק את הקוד. השינוי נכנס לאתר בבנייה הבאה.' },
  ];
  var TYPES = {
    text: { n: 'טקסט ותמונה', d: 'אודות, חזון, כל טקסט חופשי', fields: [{ k: 'body', l: 'הטקסט', t: 'rich', w: 1 }, { k: 'image', l: 'תמונה בצד (רשות)', t: 'image', w: 1 }, { k: 'imageAlt', l: 'תיאור התמונה (לנגישות)', w: 1 }, { k: 'video', l: 'סרטון קצר בצד (רשות)', t: 'url', w: 1, h: 'כתובת לקובץ mp4. מתנגן בלי קול, בלולאה.' }] },
    cards: { n: 'כרטיסים', d: 'תחומי מחקר, פרויקטים, שיתופי פעולה', item: 'כרטיס', label: 'title', thumb: 'image',
      fields: [{ k: 'intro', l: 'משפט פתיחה (רשות)', t: 'area', w: 1 }],
      itemFields: [{ k: 'title', l: 'כותרת', w: 1 }, { k: 'subtitle', l: 'כותרת משנה (רשות)', w: 1 }, { k: 'text', l: 'תיאור', t: 'rich', w: 1 }, { k: 'image', l: 'תמונה', t: 'image', w: 1 }, { k: 'link', l: 'קישור (רשות)', t: 'url' }, { k: 'linkText', l: 'טקסט הקישור', h: 'ברירת מחדל: More' }],
      blank: { title: 'כותרת חדשה', text: '', image: '', link: '' } },
    people: { n: 'צוות', d: 'חברי וחברות המעבדה, בוגרים', item: 'איש/אשת צוות', label: 'name', thumb: 'image',
      fields: [{ k: 'intro', l: 'משפט פתיחה (רשות)', t: 'area', w: 1 }],
      itemFields: [{ k: 'name', l: 'שם' }, { k: 'role', l: 'תפקיד' }, { k: 'group', l: 'קבוצה', h: 'למשל: Lab members, Alumni. אנשים עם אותה קבוצה מוצגים יחד.', list: 'groups' },
        { k: 'email', l: 'דוא״ל', t: 'email' }, { k: 'bio', l: 'כמה מילים', t: 'rich', w: 1 }, { k: 'image', l: 'תמונה', t: 'image', w: 1 },
        { k: 'link', l: 'קישור (רשות)', t: 'url' }, { k: 'linkText', l: 'טקסט הקישור' }, { k: 'lead', l: 'כרטיס רחב (לראש המעבדה)', t: 'check', w: 1 }],
      blank: { name: 'שם חדש', role: '', group: '', bio: '', image: '', email: '', link: '' } },
    publications: { n: 'פרסומים', d: 'מאמרים, ספרים, כנסים', item: 'פרסום', label: 'title', sub: 'year', import: true,
      fields: [{ k: 'intro', l: 'משפט פתיחה (רשות)', t: 'area', w: 1 }],
      itemFields: [{ k: 'year', l: 'שנה' }, { k: 'venue', l: 'כתב עת / הוצאה' }, { k: 'title', l: 'כותרת', w: 1 }, { k: 'authors', l: 'מחברים', w: 1, h: 'אפשר להדגיש שם: **Baranes D**' }, { k: 'note', l: 'הערה קטנה (רשות)', w: 1, h: 'למשל: IF 3.5 · Q1' }, { k: 'link', l: 'קישור (DOI / PubMed)', t: 'url', w: 1 }],
      blank: { year: String(new Date().getFullYear()), title: 'פרסום חדש', authors: '', venue: '', link: '' } },
    news: { n: 'חדשות', d: 'עדכונים, הרצאות, פרסים', item: 'עדכון', label: 'title', sub: 'date', thumb: 'image',
      fields: [{ k: 'intro', l: 'משפט פתיחה (רשות)', t: 'area', w: 1 }],
      itemFields: [{ k: 'date', l: 'תאריך', h: 'כפי שיוצג, למשל: November 2026' }, { k: 'title', l: 'כותרת' }, { k: 'text', l: 'טקסט', t: 'rich', w: 1 }, { k: 'image', l: 'תמונה (רשות)', t: 'image', w: 1 }, { k: 'link', l: 'קישור (רשות)', t: 'url', w: 1 }],
      blank: { date: '', title: 'עדכון חדש', text: '', image: '', link: '' }, newFirst: true },
    gallery: { n: 'גלריה', d: 'תמונות מהמעבדה ומהמחקר', item: 'תמונה', label: 'caption', thumb: 'image', multi: true,
      fields: [{ k: 'intro', l: 'משפט פתיחה (רשות)', t: 'area', w: 1 }],
      itemFields: [{ k: 'image', l: 'תמונה', t: 'image', w: 1 }, { k: 'caption', l: 'כיתוב', w: 1 }],
      blank: { image: '', caption: '' } },
    contact: { n: 'יצירת קשר', d: 'דוא״ל, טלפון, כתובת, מפה וקישורים', item: 'קישור', label: 'label',
      fields: [{ k: 'name', l: 'שם (כותרת בכרטיס)', w: 1 }, { k: 'body', l: 'טקסט', t: 'rich', w: 1 }, { k: 'email', l: 'דוא״ל', t: 'email' }, { k: 'phone', l: 'טלפון' }, { k: 'whatsapp', l: 'וואטסאפ (מספר)', h: 'למשל +972541234567' }, { k: 'address', l: 'כתובת', w: 1 },
        { k: 'showMap', l: 'להציג מפה לפי הכתובת', t: 'check' }, { k: 'mapUrl', l: 'קישור הטמעה למפה (רשות)', t: 'url', h: 'מגוגל מפות: שיתוף › הטמעת מפה › הכתובת שבתוך src' }],
      itemFields: [{ k: 'label', l: 'טקסט הכפתור' }, { k: 'url', l: 'קישור', t: 'url' }],
      itemsTitle: 'קישורים (Google Scholar, ORCID, האוניברסיטה...)', blank: { label: 'קישור חדש', url: '' } },
  };

  // ── utils
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var toast = function (msg, bad) { var t = $('#toast'); t.textContent = msg; t.className = 'toast on' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(function () { t.className = 'toast'; }, 2600); };
  var dirty = function () { return JSON.stringify(C) !== savedJSON; };
  function changed() {
    var d = dirty(), s = $('#status');
    s.textContent = d ? '● יש שינויים שלא פורסמו' : (LOCAL ? 'מצב מקומי' : '✓ הכול פורסם');
    s.className = 'status ' + (d ? 'dirty' : 'ok');
    $('#saveBtn').disabled = !d || LOCAL;
    try { if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), base: savedJSON.length, c: C })); else localStorage.removeItem(DRAFT_KEY); } catch (e) { /* storage full */ }
  }
  var slug = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9֐-׿]+/g, '-').replace(/^-|-$/g, '').replace(/[֐-׿]/g, '') || 'section'; };
  // Older single-language content becomes {languages:[x], x:{site,sections}}
  function normalize(c) {
    if (c && c.site && !c.languages) { var l = (c.site.lang || 'en').slice(0, 2), n = { languages: [l], defaultLang: l }; n[l] = { site: c.site, sections: c.sections || [] }; c = n; }
    c.languages = (c.languages || []).filter(function (l) { return c[l]; });
    c.languages.forEach(function (l) { c[l].site = c[l].site || {}; c[l].sections = c[l].sections || []; c[l].site.lang = l; });
    if (c.languages.indexOf(c.defaultLang) < 0) c.defaultLang = c.languages[0];
    return c;
  }
  function setContent(c) {
    C = normalize(c);
    if (C.languages.indexOf(LANG) < 0) LANG = C.defaultLang;
    D = C[LANG];
    drawLangs();
  }
  function drawLangs() {
    $('#langTabs').innerHTML = C.languages.map(function (l) {
      return '<button type="button" class="lt' + (l === LANG ? ' on' : '') + '" data-lang="' + esc(l) + '">' + esc(LANG_NAME[l] || l) + (l === C.defaultLang ? ' <small>ברירת מחדל</small>' : '') + '</button>';
    }).join('');
  }
  var uniqueId = function (base, skip) { var id = base, n = 2; while (D.sections.some(function (s) { return s !== skip && s.id === id; })) id = base + '-' + n++; return id; };

  function api(path, opts) {
    opts = opts || {};
    var h = { 'content-type': 'application/json' };
    if (token) h.authorization = 'Bearer ' + token;
    return fetch(path, { method: opts.method || 'GET', headers: h, body: opts.body }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path !== '/api/login') { token = ''; sessionStorage.removeItem(TOKEN_KEY); showLogin('פג תוקף הכניסה. אפשר להיכנס שוב, השינויים נשמרו בדפדפן.'); }
        if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }

  // ── start
  function start() {
    fetch('/api/session', { headers: token ? { authorization: 'Bearer ' + token } : {} }).then(function (r) {
      var isJson = /json/.test(r.headers.get('content-type') || '');
      if (!isJson) { LOCAL = true; return open(); }
      if (r.ok) return open();
      showLogin();
    }).catch(function () { LOCAL = true; open(); });
  }
  function showLogin(msg) {
    $('#app').hidden = true; $('#login').hidden = false; $('#loginErr').textContent = msg || ''; setTimeout(function () { $('#pw').focus(); }, 30);
  }
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('#loginErr').textContent = '';
    api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#pw').value }) }).then(function (j) {
      token = j.token; sessionStorage.setItem(TOKEN_KEY, token); $('#pw').value = '';
      if (C) { $('#login').hidden = true; $('#app').hidden = false; } else open();
    }).catch(function (err) {
      $('#loginErr').textContent = err.status === 401 ? 'הסיסמה לא נכונה.' : err.status === 429 ? 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד רבע שעה.' : err.status === 503 ? 'עוד לא הוגדרה סיסמה (ADMIN_PASSWORD ב-Netlify).' : 'אין חיבור לשרת: ' + err.message;
    });
  });

  function open() {
    $('#login').hidden = true; $('#app').hidden = false; $('#localNote').hidden = !LOCAL;
    var get = LOCAL ? Promise.reject() : fetch('/api/content', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; return r.json(); });
    get.catch(function () { return fetch('content.json', { cache: 'no-store' }).then(function (r) { return r.json(); }); }).then(function (c) {
      setContent(c);
      savedJSON = JSON.stringify(C);
      var draft = null;
      try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { /* ignore */ }
      if (draft && draft.c && JSON.stringify(draft.c) !== savedJSON &&
        confirm('נמצאו בדפדפן שינויים שלא פורסמו (מ-' + new Date(draft.at).toLocaleString('he-IL') + '). להמשיך מהם?')) setContent(draft.c);
      drawSide(); go('site'); changed();
    });
  }

  // ── side list of sections
  function drawSide() {
    $('#secList').innerHTML = D.sections.map(function (s, i) {
      return '<div class="sec-row"><button class="nav-it" data-go="' + i + '" type="button"><span class="t">' + esc(s.title || '(ללא שם)') + '</span>' +
        (s.visible === false ? '<span class="off">מוסתר</span>' : '') + '</button>' +
        '<button class="ic" data-mv="' + i + ',-1" title="למעלה" aria-label="להעלות" type="button"' + (i ? '' : ' disabled') + '>▲</button>' +
        '<button class="ic" data-mv="' + i + ',1" title="למטה" aria-label="להוריד" type="button"' + (i < D.sections.length - 1 ? '' : ' disabled') + '>▼</button></div>';
    }).join('');
    $$('.side [data-go]').forEach(function (b) { b.classList.toggle('on', String(view) === b.getAttribute('data-go')); });
  }
  $('.side').addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]'), mv = e.target.closest('[data-mv]');
    if (mv) {
      var p = mv.getAttribute('data-mv').split(','), i = +p[0], j = i + +p[1];
      var s = D.sections.splice(i, 1)[0]; D.sections.splice(j, 0, s);
      if (view === i) view = j; else if (view === j) view = i;
      drawSide(); if (typeof view === 'number') go(view); changed(); return;
    }
    if (g) go(/^\d+$/.test(g.getAttribute('data-go')) ? +g.getAttribute('data-go') : g.getAttribute('data-go'));
  });

  function go(v) {
    view = v; drawSide();
    var p = $('#panel');
    if (v === 'site') p.innerHTML = siteView();
    else if (v === 'history') { p.innerHTML = historyView(); loadHistory(); }
    else if (v === 'help') p.innerHTML = helpView();
    else p.innerHTML = sectionView(D.sections[v], v);
    p.scrollTop = 0; window.scrollTo(0, 0);
  }

  // ── field rendering. Each input carries data-path, a JSON path into C.
  var uid = 0;
  function field(f, obj, path) {
    var id = 'f' + (++uid), v = obj[f.k], p = esc(JSON.stringify(path.concat(f.k)));
    var hint = f.h ? '<span class="hint">' + esc(f.h) + '</span>' : '';
    var wide = f.w ? ' wide' : '';
    var ltr = /^(url|email)$/.test(f.t) || !/^(he|ar)/.test(LANG);
    var dirAttr = ltr ? ' dir="auto"' : '';
    if (f.t === 'check') return '<div class="f' + wide + '"><label class="chk"><input type="checkbox" data-path="' + p + '"' + (v || (v == null && /^(showMap|visible|nav)$/.test(f.k)) ? ' checked' : '') + '> ' + esc(f.l) + '</label>' + hint + '</div>';
    if (f.t === 'select') return '<div class="f' + wide + '"><label for="' + id + '">' + esc(f.l) + '</label><select id="' + id + '" data-path="' + p + '">' +
      f.o.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(v || f.o[0][0]) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>' + hint + '</div>';
    if (f.t === 'color') return '<div class="f' + wide + '"><label for="' + id + '">' + esc(f.l) + '</label><div class="color"><input type="color" id="' + id + '" data-path="' + p + '" value="' + esc(/^#[0-9a-f]{6}$/i.test(v || '') ? v : '#8fd3ff') + '"><button class="b sm" type="button" data-reset-color="' + p + '">ברירת מחדל</button></div>' + hint + '</div>';
    if (f.t === 'area' || f.t === 'rich') return '<div class="f' + wide + '"><label for="' + id + '">' + esc(f.l) + '</label><textarea id="' + id + '" data-path="' + p + '"' + dirAttr + (f.t === 'area' ? ' rows="3" style="min-height:70px"' : '') + '>' + esc(v || '') + '</textarea>' +
      (f.t === 'rich' ? '<span class="hint">שורה ריקה = פסקה חדשה · ‎- ‎ בתחילת שורה = תבליט · ‎**מודגש**‎ · ‎[טקסט](קישור)‎</span>' : '') + hint + '</div>';
    if (f.t === 'image') return '<div class="f' + wide + '"><span class="lbl">' + esc(f.l) + '</span><div class="img-f"><div class="pv" style="' + (v ? 'background-image:url(&quot;' + esc(B.safeUrl(v)) + '&quot;)' : '') + '">' + (v ? '' : 'אין תמונה') + '</div><div class="ctl">' +
      '<input type="url" dir="ltr" placeholder="כתובת תמונה, או העלאה מהמחשב" data-path="' + p + '" value="' + esc(v || '') + '"><div class="row">' +
      '<label class="b sm">⬆ העלאה מהמחשב<input type="file" accept="image/*" data-upload="' + p + '" hidden></label>' +
      (v ? '<button class="b sm danger" type="button" data-clear="' + p + '">הסרה</button>' : '') + '</div></div></div>' + hint + '</div>';
    var list = f.list === 'groups' ? ' list="groupsList"' : '';
    return '<div class="f' + wide + '"><label for="' + id + '">' + esc(f.l) + '</label><input type="' + (f.t === 'url' ? 'text' : f.t || 'text') + '" id="' + id + '" data-path="' + p + '" value="' + esc(v == null ? '' : v) + '"' + (ltr ? ' dir="' + (f.t ? 'ltr' : 'auto') + '"' : '') + list + '>' + hint + '</div>';
  }
  var fields = function (list, obj, path) { return '<div class="fields">' + list.map(function (f) { return field(f, obj, path); }).join('') + '</div>'; };

  function getPath(path) { var o = D; for (var i = 0; i < path.length - 1; i++) o = o[path[i]]; return { o: o, k: path[path.length - 1] }; }
  function setPath(path, v) { var t = getPath(path); t.o[t.k] = v; }

  // ── views
  function siteView() {
    return '<h2>הגדרות כלליות ופתיח</h2><p class="lead">השם, הכותרת, משפט הפתיחה, הכפתורים, הלוגו והצבע. מה שמופיע בראש האתר ובתחתית.</p>' +
      '<div class="box">' + fields(SITE_FIELDS, D.site, ['site']) + '</div>' +
      '<div class="box"><h3>שפות האתר</h3><p class="lead" style="margin:0 0 12px">לכל שפה יש תוכן משלה, והאתר מציג כפתור מעבר בין השפות. עורכים כל שפה בלשונית שלה למעלה.</p>' +
      '<div class="f"><label for="defLang">השפה שהאתר נפתח בה</label><select id="defLang" data-root="defaultLang">' +
      C.languages.map(function (l) { return '<option value="' + esc(l) + '"' + (l === C.defaultLang ? ' selected' : '') + '>' + esc(LANG_NAME[l] || l) + '</option>'; }).join('') + '</select></div></div>';
  }

  function sectionView(s, i) {
    var T = TYPES[s.type] || TYPES.text, items = s.items || [];
    var groups = s.type === 'people' ? '<datalist id="groupsList">' + Array.from(new Set(items.map(function (x) { return x.group; }).filter(Boolean))).map(function (g) { return '<option value="' + esc(g) + '">'; }).join('') + '</datalist>' : '';
    var head = '<h2>' + esc(s.title || '(ללא שם)') + '</h2><p class="lead">סוג החלק: ' + esc(T.n) + '. ' + esc(T.d) + '.</p>';
    var basics = '<div class="box"><h3>הגדרות החלק</h3>' + fields([
      { k: 'title', l: 'כותרת החלק' }, { k: 'navTitle', l: 'שם בתפריט (רשות)', h: 'אם ריק, הכותרת' },
      { k: 'visible', l: 'מוצג באתר', t: 'check' }, { k: 'nav', l: 'מופיע בתפריט העליון', t: 'check' },
      { k: 'id', l: 'עוגן (לקישור ישיר)', t: 'url', h: 'אותיות באנגלית, ספרות ומקף. הקישור: #' + (s.id || '') },
      { k: 'bg', l: 'תמונת רקע עדינה לחלק (רשות)', t: 'image', w: 1 },
    ], s, ['sections', i]) + '</div>';
    var own = T.fields && T.fields.length ? '<div class="box"><h3>תוכן</h3>' + fields(T.fields, s, ['sections', i]) + '</div>' : '';
    var list = '';
    if (T.itemFields) {
      list = '<div class="box"><div class="items-head"><h3>' + esc(T.itemsTitle || 'פריטים') + ' (' + items.length + ')</h3><div class="row">' +
        (T.multi ? '<label class="b sm">⬆ העלאת כמה תמונות<input type="file" accept="image/*" multiple data-multi="' + i + '" hidden></label> ' : '') +
        (T.import ? '<button class="b sm" type="button" data-import="' + i + '">ייבוא רשימה</button> ' : '') +
        '<button class="b sm primary" type="button" data-add="' + i + '">＋ הוספת ' + esc(T.item) + '</button></div></div>' +
        (items.length ? '<div class="items">' + items.map(function (it, j) { return itemView(T, it, i, j, items.length); }).join('') + '</div>' : '<p class="empty">אין עדיין פריטים.</p>') + '</div>';
    }
    var danger = '<div class="box danger-zone"><h3>פעולות על החלק</h3><div class="row" style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="b sm" type="button" data-dup-sec="' + i + '">שכפול החלק</button>' +
      C.languages.filter(function (l) { return l !== LANG; }).map(function (l) { return '<button class="b sm" type="button" data-copy-sec="' + i + '" data-to="' + esc(l) + '">העתקת החלק ללשונית ' + esc(LANG_NAME[l] || l) + ' (בלי תרגום)</button>'; }).join('') +
      '<button class="b sm danger" type="button" data-del-sec="' + i + '">מחיקת החלק</button></div></div>';
    return head + groups + basics + own + list + danger;
  }

  function itemView(T, it, i, j, n) {
    var label = it[T.label] || '(ללא כותרת)', sub = T.sub && it[T.sub] ? ' · ' + it[T.sub] : '';
    var th = T.thumb && it[T.thumb] ? '<span class="thumb" style="background-image:url(&quot;' + esc(B.safeUrl(it[T.thumb])) + '&quot;)"></span>' : '';
    return '<details class="item" data-item="' + i + ',' + j + '"><summary><span class="n">' + (j + 1) + '</span>' + th + '<span class="t" data-label>' + esc(label + sub) + '</span>' +
      '<button class="ic" type="button" data-imv="' + i + ',' + j + ',-1" title="למעלה" aria-label="להעלות"' + (j ? '' : ' disabled') + '>▲</button>' +
      '<button class="ic" type="button" data-imv="' + i + ',' + j + ',1" title="למטה" aria-label="להוריד"' + (j < n - 1 ? '' : ' disabled') + '>▼</button>' +
      '<button class="ic" type="button" data-idup="' + i + ',' + j + '" title="שכפול" aria-label="שכפול">⧉</button>' +
      '<button class="ic del" type="button" data-idel="' + i + ',' + j + '" title="מחיקה" aria-label="מחיקה">🗑</button></summary>' +
      '<div class="body">' + fields(T.itemFields, it, ['sections', i, 'items', j]) + '</div></details>';
  }

  function historyView() {
    return '<h2>גרסאות קודמות וגיבוי</h2><p class="lead">בכל פרסום נשמרת הגרסה הקודמת (עד 30). אפשר לטעון גרסה לעריכה, ואז לפרסם אותה.</p>' +
      '<div class="box"><h3>גיבוי לקובץ</h3><div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="b sm" type="button" id="exportBtn">⬇ הורדת התוכן (JSON)</button>' +
      '<label class="b sm">⬆ טעינת תוכן מקובץ<input type="file" accept="application/json,.json" id="importFile" hidden></label>' +
      '<button class="b sm" type="button" id="resetBtn">חזרה לתוכן ההתחלתי</button></div></div>' +
      '<div class="box"><h3>גרסאות שפורסמו</h3><ul class="hist" id="hist"><li class="empty">' + (LOCAL ? 'זמין רק באתר ב-Netlify.' : 'טוען…') + '</li></ul></div>';
  }
  function loadHistory() {
    if (LOCAL) return;
    api('/api/history').then(function (j) {
      var ul = $('#hist'); if (!ul) return;
      ul.innerHTML = j.items.length ? j.items.map(function (h) {
        var d = new Date(h.at);
        return '<li><span>' + esc(isNaN(d) ? h.key : d.toLocaleString('he-IL')) + '</span><button class="b sm" type="button" data-restore="' + esc(h.key) + '">טעינה לעריכה</button></li>';
      }).join('') : '<li class="empty">עוד אין גרסאות קודמות.</li>';
    }).catch(function (e) { var ul = $('#hist'); if (ul) ul.innerHTML = '<li class="empty">לא נטען: ' + esc(e.message) + '</li>'; });
  }

  function helpView() {
    return '<h2>איך עורכים</h2><div class="box help">' +
      '<ol><li>בוחרים בצד ימין חלק באתר, או "הגדרות כלליות ופתיח".</li>' +
      '<li>עורכים בשדות. כל פריט (כרטיס, איש צוות, פרסום) נפתח בלחיצה על השורה שלו.</li>' +
      '<li>▲ ▼ משנים סדר, ⧉ משכפל, 🗑 מוחק. "＋ הוספת חלק" מוסיף חלק חדש, ובתוך כל חלק אפשר להסתיר אותו או למחוק אותו.</li>' +
      '<li>"תצוגה מקדימה" פותחת את האתר עם השינויים, לפני שהם מתפרסמים.</li>' +
      '<li>"שמירה ופרסום" מעדכן את האתר לכולם. השינויים נשמרים גם בדפדפן עד הפרסום, כך ששום דבר לא הולך לאיבוד.</li></ol>' +
      '<p><b>עיצוב טקסט:</b> שורה ריקה מתחילה פסקה חדשה; שורה שמתחילה ב-<code>- </code> היא תבליט; <code>**מודגש**</code>; <code>[טקסט](https://...)</code> לקישור.</p>' +
      '<p><b>תמונות:</b> "העלאה מהמחשב" מקטינה את התמונה לגודל מתאים ושומרת אותה באתר. אפשר גם להדביק כתובת של תמונה.</p>' +
      '<p><b>ייבוא פרסומים:</b> בחלק הפרסומים, "ייבוא רשימה": מדביקים רשימת מאמרים, מאמר בכל שורה, והשנה מזוהה לבד.</p></div>';
  }

  // ── events on the panel
  var panel = $('#panel');
  panel.addEventListener('input', function (e) {
    var el = e.target, ps = el.getAttribute('data-path');
    if (el.hasAttribute('data-root')) { C[el.getAttribute('data-root')] = el.value; drawLangs(); changed(); return; }
    if (!ps) return;
    var path = JSON.parse(ps), v = el.type === 'checkbox' ? el.checked : el.value;
    if (path[0] === 'sections' && path.length === 3 && path[2] === 'id') {
      v = v.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (v !== el.value) el.value = v;
    }
    setPath(path, v);
    if (path.length === 3 && path[2] === 'title') { drawSide(); var h = $('#panel h2'); if (h) h.textContent = v || '(ללא שם)'; }
    if (path.length === 3 && path[2] === 'visible') drawSide();
    if (path.length === 5) { // item label
      var det = el.closest('.item'), T = TYPES[D.sections[path[1]].type], it = D.sections[path[1]].items[path[3]];
      if (det && T) det.querySelector('[data-label]').textContent = (it[T.label] || '(ללא כותרת)') + (T.sub && it[T.sub] ? ' · ' + it[T.sub] : '');
    }
    var pv = el.closest('.img-f');
    if (pv) { pv.querySelector('.pv').style.backgroundImage = v ? 'url("' + B.safeUrl(v) + '")' : ''; pv.querySelector('.pv').textContent = v ? '' : 'אין תמונה'; }
    changed();
  });
  panel.addEventListener('change', function (e) {
    var el = e.target;
    if (el.matches('[data-path]') && el.type !== 'file') {
      var path = JSON.parse(el.getAttribute('data-path'));
      if (path[0] === 'sections' && path.length === 3 && path[2] === 'id') { var s = D.sections[path[1]]; s.id = uniqueId(s.id || slug(s.title), s); el.value = s.id; changed(); }
    }
    if (el.matches('[data-upload]')) {
      var p = JSON.parse(el.getAttribute('data-upload')), f = el.files[0];
      if (!f) return;
      upload(f).then(function (url) { setPath(p, url); go(view); reopen(p); changed(); toast('התמונה עלתה'); }).catch(function (err) { toast('ההעלאה לא הצליחה: ' + err.message, true); });
    }
    if (el.matches('[data-multi]')) {
      var i = +el.getAttribute('data-multi'), files = Array.prototype.slice.call(el.files), s2 = D.sections[i];
      s2.items = s2.items || [];
      toast('מעלה ' + files.length + ' תמונות…');
      files.reduce(function (pr, file) { return pr.then(function () { return upload(file).then(function (url) { s2.items.push({ image: url, caption: '' }); }); }); }, Promise.resolve())
        .then(function () { go(view); changed(); toast('התמונות עלו'); }).catch(function (err) { go(view); changed(); toast('חלק מהתמונות לא עלו: ' + err.message, true); });
    }
    if (el.id === 'importFile' && el.files[0]) {
      el.files[0].text().then(function (t) {
        var c = JSON.parse(t);
        if (!c || !((c.site && Array.isArray(c.sections)) || Array.isArray(c.languages))) throw new Error('הקובץ לא נראה כמו תוכן של האתר');
        setContent(c); drawSide(); go('site'); changed(); toast('התוכן נטען. כדי שיופיע באתר: שמירה ופרסום.');
      }).catch(function (err) { toast(err.message, true); });
    }
  });
  function reopen(path) { // keep the edited item open after a redraw
    if (path.length >= 5) { var d = $('[data-item="' + path[1] + ',' + path[3] + '"]'); if (d) { d.open = true; d.scrollIntoView({ block: 'center' }); } }
  }

  panel.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var a = function (n) { return (b.getAttribute(n) || '').split(',').map(Number); };
    if (b.hasAttribute('data-clear')) { var p = JSON.parse(b.getAttribute('data-clear')); setPath(p, ''); go(view); reopen(p); changed(); return; }
    if (b.hasAttribute('data-reset-color')) { var pc = JSON.parse(b.getAttribute('data-reset-color')); setPath(pc, '#8fd3ff'); go(view); changed(); return; }
    if (b.hasAttribute('data-add')) {
      var i = a('data-add')[0], s = D.sections[i], T = TYPES[s.type];
      s.items = s.items || [];
      var idx = T.newFirst ? 0 : s.items.length;
      s.items.splice(idx, 0, clone(T.blank));
      go(view); reopen(['sections', i, 'items', idx, 'x']); changed();
      var d = $('[data-item="' + i + ',' + idx + '"] input, [data-item="' + i + ',' + idx + '"] textarea'); if (d) d.focus();
      return;
    }
    if (b.hasAttribute('data-imv')) {
      e.preventDefault();
      var m = a('data-imv'), arr = D.sections[m[0]].items, it = arr.splice(m[1], 1)[0];
      arr.splice(m[1] + m[2], 0, it); go(view); changed(); return;
    }
    if (b.hasAttribute('data-idup')) {
      e.preventDefault();
      var dd = a('data-idup'), arr2 = D.sections[dd[0]].items;
      arr2.splice(dd[1] + 1, 0, clone(arr2[dd[1]])); go(view); reopen(['sections', dd[0], 'items', dd[1] + 1, 'x']); changed(); return;
    }
    if (b.hasAttribute('data-idel')) {
      e.preventDefault();
      var dl = a('data-idel'), sec = D.sections[dl[0]], T2 = TYPES[sec.type], name = sec.items[dl[1]][T2.label] || T2.item;
      if (!confirm('למחוק את "' + name + '"?')) return;
      sec.items.splice(dl[1], 1); go(view); changed(); toast('נמחק. אפשר לבטל עד הפרסום דרך "גרסאות קודמות".'); return;
    }
    if (b.hasAttribute('data-del-sec')) {
      var di = a('data-del-sec')[0];
      if (!confirm('למחוק את כל החלק "' + (D.sections[di].title || '') + '" עם כל מה שבתוכו?\nאפשר במקום זה רק להסתיר אותו (מוצג באתר).')) return;
      D.sections.splice(di, 1); drawSide(); go('site'); changed(); return;
    }
    if (b.hasAttribute('data-dup-sec')) {
      var si = a('data-dup-sec')[0], cp = clone(D.sections[si]);
      cp.title = (cp.title || '') + ' (עותק)'; cp.id = uniqueId(cp.id || 'section');
      D.sections.splice(si + 1, 0, cp); drawSide(); go(si + 1); changed(); return;
    }
    if (b.hasAttribute('data-copy-sec')) {
      var ci = a('data-copy-sec')[0], to = b.getAttribute('data-to'), src = clone(D.sections[ci]), dst = C[to].sections;
      var at = dst.findIndex(function (x) { return x.id === src.id; });
      var where = LANG_NAME[to] || to;
      if (!confirm('ההעתקה מעבירה את החלק כמו שהוא, בשפה של הלשונית הזאת, ללשונית ' + where + '. הטקסט לא מתורגם.\n' +
        (at >= 0 ? 'החלק "' + dst[at].title + '" בלשונית ' + where + ' יוחלף בעותק הזה.' : 'החלק יתווסף בסוף הלשונית ' + where + '.') + '\n\nלהמשיך?')) return;
      if (at >= 0) dst[at] = src; else dst.push(src);
      changed(); toast('הועתק. עכשיו אפשר לתרגם אותו בלשונית ' + (LANG_NAME[to] || to) + '.'); return;
    }
    if (b.hasAttribute('data-import')) return importPubs(a('data-import')[0]);
    if (b.hasAttribute('data-restore')) {
      if (dirty() && !confirm('השינויים שלא פורסמו יוחלפו בגרסה הזאת. להמשיך?')) return;
      api('/api/history?key=' + encodeURIComponent(b.getAttribute('data-restore'))).then(function (c) {
        delete c.updatedAt; setContent(c); drawSide(); go('site'); changed(); toast('הגרסה נטענה. כדי שתופיע באתר: שמירה ופרסום.');
      }).catch(function (err) { toast(err.message, true); });
      return;
    }
    if (b.id === 'exportBtn') {
      var blob = new Blob([JSON.stringify(C, null, 2)], { type: 'application/json' }), u = URL.createObjectURL(blob), l = document.createElement('a');
      l.href = u; l.download = 'baraneslab-content-' + new Date().toISOString().slice(0, 10) + '.json'; l.click(); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); return;
    }
    if (b.id === 'resetBtn') {
      if (!confirm('לטעון את התוכן ההתחלתי במקום מה שיש עכשיו? (האתר לא ישתנה עד הפרסום)')) return;
      fetch('content.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) { setContent(c); drawSide(); go('site'); changed(); });
    }
  });

  $('#langTabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-lang]'); if (!b) return;
    LANG = b.getAttribute('data-lang'); D = C[LANG]; drawLangs(); drawSide();
    go(typeof view === 'number' ? (D.sections[view] ? view : 'site') : view);
  });

  // ── add section dialog
  $('#addSecBtn').addEventListener('click', function () {
    var f = $('#dlgForm');
    f.innerHTML = '<h3>הוספת חלק לאתר</h3><div class="f"><label for="nsTitle">כותרת</label><input id="nsTitle" type="text" required></div>' +
      '<div class="types">' + Object.keys(TYPES).map(function (k, i) { return '<label><input type="radio" name="t" value="' + k + '"' + (i ? '' : ' checked') + '><span><b>' + esc(TYPES[k].n) + '</b><small>' + esc(TYPES[k].d) + '</small></span></label>'; }).join('') + '</div>' +
      '<div class="dlg-acts"><button class="b primary" value="ok">הוספה</button><button class="b ghost" value="cancel" formnovalidate>ביטול</button></div>';
    var dlg = $('#dlg'); dlg.returnValue = ''; dlg.showModal(); $('#nsTitle').focus();
    dlg.onclose = function () {
      if (dlg.returnValue !== 'ok') return;
      var t = f.querySelector('input[name=t]:checked').value, title = $('#nsTitle').value.trim() || TYPES[t].n;
      var s = { id: uniqueId(slug(title) === 'section' ? t : slug(title)), type: t, title: title, nav: true, visible: true };
      if (TYPES[t].itemFields) s.items = [];
      if (t === 'contact') s.showMap = true;
      D.sections.push(s); drawSide(); go(D.sections.length - 1); changed();
    };
  });

  // ── publications import: one per line, year detected
  function importPubs(i) {
    var f = $('#dlgForm');
    f.innerHTML = '<h3>ייבוא רשימת פרסומים</h3><p class="lead" style="margin:0 0 10px">מדביקים רשימה, פרסום אחד בכל שורה (למשל מ-Google Scholar או מקורות חיים). השנה מזוהה לבד; אפשר לערוך כל פרסום אחר כך.</p>' +
      '<textarea id="impText" dir="ltr" style="min-height:220px"></textarea><div class="dlg-acts"><button class="b primary" value="ok">ייבוא</button><button class="b ghost" value="cancel">ביטול</button></div>';
    var dlg = $('#dlg'); dlg.returnValue = ''; dlg.showModal();
    dlg.onclose = function () {
      if (dlg.returnValue !== 'ok') return;
      var lines = $('#impText').value.split(/\n+/).map(function (l) { return l.trim().replace(/^\d+[.)]\s+/, ''); }).filter(function (l) { return l.length > 8; });
      var s = D.sections[i]; s.items = s.items || [];
      lines.forEach(function (l) {
        var y = (l.match(/\((19|20)\d{2}\)/) || l.match(/\b(19|20)\d{2}\b/) || [''])[0].replace(/[()]/g, '');
        var doi = (l.match(/\b10\.\d{4,9}\/\S+[^\s.,;]/) || [''])[0];
        var url = (l.match(/https?:\/\/\S+/) || [''])[0];
        s.items.push({ year: y, title: l.replace(/https?:\/\/\S+/, '').trim(), authors: '', venue: '', link: url || (doi ? 'https://doi.org/' + doi : '') });
      });
      go(view); changed(); toast(lines.length + ' פרסומים נוספו');
    };
  }

  // ── images: shrink in the browser, then upload
  function shrink(file) {
    return new Promise(function (res, rej) {
      if (!/^image\//.test(file.type)) return rej(new Error('זה לא קובץ תמונה'));
      var rd = new FileReader();
      rd.onerror = function () { rej(new Error('לא נקרא')); };
      rd.onload = function () {
        if (/svg|gif/.test(file.type)) return res(rd.result);
        var im = new Image();
        im.onerror = function () { rej(new Error('התמונה לא נפתחה')); };
        im.onload = function () {
          var max = 2000, r = Math.min(1, max / Math.max(im.width, im.height));
          var cv = document.createElement('canvas'); cv.width = Math.round(im.width * r); cv.height = Math.round(im.height * r);
          cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
          var out = cv.toDataURL('image/webp', 0.86);
          if (!/^data:image\/webp/.test(out)) out = cv.toDataURL('image/jpeg', 0.88);
          res(out);
        };
        im.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }
  function upload(file) {
    return shrink(file).then(function (dataUrl) {
      if (LOCAL) return dataUrl; // local preview only: kept inside the content
      return api('/api/img', { method: 'POST', body: JSON.stringify({ dataUrl: dataUrl }) }).then(function (j) { return j.url; });
    });
  }

  // ── top bar
  $('#saveBtn').addEventListener('click', function () {
    var btn = this; btn.disabled = true; btn.textContent = 'שומר…';
    api('/api/content', { method: 'PUT', body: JSON.stringify(C) }).then(function (j) {
      C.updatedAt = j.updatedAt; savedJSON = JSON.stringify(C); changed(); toast('פורסם באתר ✓');
      if (view === 'history') loadHistory();
    }).catch(function (err) { toast('לא נשמר: ' + err.message, true); changed(); }).then(function () { btn.textContent = 'שמירה ופרסום'; });
  });
  $('#previewBtn').addEventListener('click', function () {
    try { localStorage.setItem(PREVIEW_KEY, JSON.stringify(C)); } catch (e) { toast('התוכן גדול מדי לתצוגה מקדימה', true); return; }
    window.open('index.html?preview=1&lang=' + encodeURIComponent(LANG), '_blank', 'noopener');
  });
  $('#logoutBtn').addEventListener('click', function () {
    if (dirty() && !confirm('יש שינויים שלא פורסמו. הם יישמרו בדפדפן הזה. לצאת?')) return;
    token = ''; sessionStorage.removeItem(TOKEN_KEY); showLogin();
  });
  addEventListener('beforeunload', function (e) { if (C && dirty()) { e.preventDefault(); e.returnValue = ''; } });
  addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (!$('#saveBtn').disabled) $('#saveBtn').click(); } });

  start();
})();
