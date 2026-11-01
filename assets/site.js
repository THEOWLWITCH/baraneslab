/* Network Architecture & Information Lab · public site renderer.
   Content comes from /api/content (saved in the admin page), falls back to content.json,
   and in preview mode (?preview=1) from the admin draft in this browser. */
(function () {
  'use strict';
  var B = window.BL, esc = B.esc, rich = B.rich, safeUrl = B.safeUrl;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var PREVIEW = /[?&]preview=1/.test(location.search);
  var STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var T = B.ui('en');
  var ALL = null, PUBHL = '';
  var LANG_NAME = { en: 'English', he: 'עברית', ar: 'العربية' };

  // Content may hold several languages: {languages:['en','he'], defaultLang, en:{site,sections}, he:{...}}
  function langs(c) { return c && Array.isArray(c.languages) ? c.languages.filter(function (l) { return c[l] && c[l].site; }) : []; }
  function pickLang(c) {
    var ls = langs(c); if (!ls.length) return '';
    var q = (location.search.match(/[?&]lang=(\w+)/) || [])[1];
    var saved = ''; try { saved = localStorage.getItem('bl.lang') || ''; } catch (e) { /* ignore */ }
    return [q, saved, c.defaultLang, ls[0]].filter(function (l) { return l && ls.indexOf(l) >= 0; })[0];
  }
  function load() {
    if (PREVIEW) {
      try { var d = JSON.parse(localStorage.getItem('bl.preview') || 'null'); if (d) return Promise.resolve(d); } catch (e) { /* ignore */ }
    }
    return fetch('/api/content', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () { return fetch('content.json', { cache: 'no-store' }).then(function (r) { return r.json(); }); });
  }

  var img = function (u) { u = safeUrl(u); return u ? 'url("' + u.replace(/["\\]/g, '') + '")' : ''; };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var initials = function (n) {
    var w = String(n || '').replace(/^(prof|professor|dr|mr|ms|mrs)\.?\s+/i, '').replace(/^(פרופ[׳']?|פרופסור|ד["״]ר|דר[׳'])\s+/, '').replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean);
    return esc(((w[0] || '')[0] || '') + ((w[1] || '')[0] || ''));
  };
  var linkAttrs = function (u) { u = safeUrl(u); return u ? 'href="' + esc(u) + '"' + (/^https?:/i.test(u) ? ' target="_blank" rel="noopener"' : '') : ''; };
  var visibleSections = function (c) { return (c.sections || []).filter(function (s) { return s.visible !== false; }); };
  function hlName(h) {
    var n = PUBHL.trim(); if (!n) return h;
    var re = new RegExp('(' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^,;]*?)(?=,| and |$)', 'g');
    return h.replace(re, '<b class="me">$1</b>');
  }

  // ── section renderers
  var R = {
    text: function (s) {
      var body = '<div class="prose">' + rich(s.body) + '</div>';
      var media = '';
      if (safeUrl(s.image)) media += '<div class="frame"><span class="fig">FIG. 01</span><img src="' + esc(safeUrl(s.image)) + '" alt="' + esc(s.imageAlt || s.title || '') + '" loading="lazy"></div>';
      if (safeUrl(s.video)) media += '<div class="frame"><span class="fig">FIG. ' + (media ? '02' : '01') + '</span><video src="' + esc(safeUrl(s.video)) + '" muted loop playsinline preload="metadata"' + (STILL ? ' controls' : ' autoplay') + '></video></div>';
      return media ? '<div class="split">' + body + '<figure class="rv">' + media + '</figure></div>' : body;
    },
    cards: function (s) {
      return '<div class="grid">' + (s.items || []).map(function (it, i) {
        var l = linkAttrs(it.link), no = '<span class="no' + (it.image ? '' : ' plain') + '">' + pad(i + 1) + ' / ' + pad(s.items.length) + '</span>';
        return '<article class="card glass rv">' + (it.image ? '<div class="ph" style="background-image:' + esc(img(it.image)) + '">' + no + '</div>' : '') +
          '<div class="bd">' + (it.image ? '' : no) + '<h3>' + esc(it.title) + '</h3>' + (it.subtitle ? '<p class="cs">' + esc(it.subtitle) + '</p>' : '') +
          '<div class="tx">' + rich(it.text) + '</div>' + (l ? '<a class="go" ' + l + '>' + esc(it.linkText || T.more) + ' →</a>' : '') + '</div></article>';
      }).join('') + '</div>';
    },
    people: function (s) {
      var groups = [], by = {};
      (s.items || []).forEach(function (p) {
        var g = (p.group || '').trim();
        if (!by[g]) { by[g] = []; groups.push(g); }
        by[g].push(p);
      });
      return groups.map(function (g) {
        return (g && groups.length > 1 ? '<h3 class="group-t">' + esc(g) + '</h3>' : '') + '<div class="people">' + by[g].map(function (p) {
          var l = linkAttrs(p.link), mail = /@/.test(p.email || '') ? 'mailto:' + p.email : '';
          var av = p.image ? '<div class="avatar" style="background-image:' + esc(img(p.image)) + '" role="img" aria-label="' + esc(p.name) + '"></div>' : '<div class="avatar" aria-hidden="true">' + initials(p.name) + '</div>';
          return '<article class="person glass rv' + (p.lead ? ' lead' : '') + '">' + av + '<div><h3>' + esc(p.name) + '</h3>' +
            (p.role ? '<div class="role">' + esc(p.role) + '</div>' : '') + (p.bio ? '<div class="bio">' + rich(p.bio) + '</div>' : '') +
            ((l || mail) ? '<div class="links">' + (mail ? '<a href="' + esc(mail) + '">' + esc(T.email) + '</a>' : '') + (l ? '<a ' + l + '>' + esc(p.linkText || T.more) + ' →</a>' : '') + '</div>' : '') +
            '</div></article>';
        }).join('') + '</div>';
      }).join('');
    },
    publications: function (s) {
      var years = [];
      (s.items || []).forEach(function (p) { if (p.year && years.indexOf(String(p.year)) < 0) years.push(String(p.year)); });
      years.sort().reverse();
      var tools = (s.items || []).length > 6 ? '<div class="ptools rv"><input type="search" placeholder="' + esc(T.search) + '" aria-label="' + esc(T.search) + '"><select aria-label="' + esc(T.all) + '"><option value="">' + esc(T.all) + '</option>' +
        years.map(function (y) { return '<option>' + esc(y) + '</option>'; }).join('') + '</select></div>' : '';
      return tools + '<div class="timeline" data-pubs></div><p class="empty" hidden>' + esc(T.none) + '</p>';
    },
    news: function (s) {
      return '<div class="news">' + (s.items || []).map(function (n) {
        var l = linkAttrs(n.link);
        return '<article class="news-it glass rv"><time>' + esc(n.date) + '</time><div><h3>' + (l ? '<a ' + l + '>' + esc(n.title) + '</a>' : esc(n.title)) + '</h3><div class="tx">' + rich(n.text) + '</div></div>' +
          (n.image ? '<div class="th" style="background-image:' + esc(img(n.image)) + '"></div>' : '<span></span>') + '</article>';
      }).join('') + '</div>';
    },
    gallery: function (s) {
      return '<div class="gal">' + (s.items || []).filter(function (g) { return g.image; }).map(function (g) {
        return '<figure class="rv" tabindex="0" data-cap="' + esc(g.caption) + '"><img src="' + esc(safeUrl(g.image)) + '" alt="' + esc(g.caption || '') + '" loading="lazy">' + (g.caption ? '<figcaption>' + esc(g.caption) + '</figcaption>' : '') + '</figure>';
      }).join('') + '</div>';
    },
    contact: function (s) {
      var lines = [];
      if (s.email) lines.push('<div class="cline"><b>' + esc(T.email) + '</b><a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a></div>');
      if (s.phone) lines.push('<div class="cline"><b>' + esc(T.phone) + '</b><a href="tel:' + esc(String(s.phone).replace(/[^\d+]/g, '')) + '" dir="ltr">' + esc(s.phone) + '</a></div>');
      var wa = String(s.whatsapp || '').replace(/[^\d]/g, '');
      if (wa) lines.push('<div class="cline"><b>WhatsApp</b><a href="https://wa.me/' + wa + '" target="_blank" rel="noopener" dir="ltr">' + esc(s.whatsapp) + '</a></div>');
      if (s.address) lines.push('<div class="cline"><b>' + esc(T.address) + '</b><span>' + esc(s.address) + '</span></div>');
      var links = (s.items || []).filter(function (l) { return safeUrl(l.url); }).map(function (l) { return '<a class="btn" ' + linkAttrs(l.url) + '>' + esc(l.label || l.url) + '</a>'; }).join('');
      var mapSrc = '';
      if (/^https:\/\/(www\.)?(google\.[a-z.]+\/maps\/embed|maps\.google\.[a-z.]+\/maps\?.*output=embed|www\.openstreetmap\.org\/export\/embed)/i.test(s.mapUrl || '')) mapSrc = s.mapUrl;
      else if (s.address && s.showMap !== false) mapSrc = 'https://maps.google.com/maps?q=' + encodeURIComponent(s.address) + '&output=embed';
      return '<div class="contact' + (mapSrc ? '' : ' solo') + '"><div class="cbox glass rv">' + (s.name ? '<h3 class="cname">' + esc(s.name) + '</h3>' : '') +
        (s.body ? '<div class="prose">' + rich(s.body) + '</div>' : '') + lines.join('') + (links ? '<div class="clinks">' + links + '</div>' : '') + '</div>' +
        (mapSrc ? '<iframe class="map rv" src="' + esc(mapSrc) + '" title="' + esc(T.map) + '" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>' : '') + '</div>';
    },
  };
  var COUNT = { cards: 1, people: 1, publications: 1, news: 1, gallery: 1 };

  function render(all, lang) {
    ALL = all;
    var c = lang ? all[lang] : all;
    var site = c.site || {};
    lang = lang || site.lang || 'en';
    T = B.ui(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = B.isRtl(lang) ? 'rtl' : 'ltr';
    if (/^#[0-9a-f]{3,8}$/i.test(site.accent || '')) document.documentElement.style.setProperty('--accent', site.accent);
    document.title = [site.title, site.subtitle].filter(Boolean).join(' · ');
    var md = $('meta[name=description]'); if (md && site.seoDescription) md.setAttribute('content', site.seoDescription);

    $('#brandName').textContent = site.name || site.title || '';
    var logo = $('#logo');
    if (site.logo && safeUrl(site.logo)) { logo.src = safeUrl(site.logo); logo.alt = site.name || ''; logo.hidden = false; $('.brand .mark').hidden = true; }
    else { logo.hidden = true; $('.brand .mark').hidden = false; }
    $('#eyebrow').textContent = site.eyebrow || '';
    $('.eyebrow').hidden = !site.eyebrow;
    $('#title').textContent = site.title || '';
    $('#subtitle').textContent = site.subtitle || '';
    $('#tagline').innerHTML = B.inline(site.tagline || '');
    $('#heroImg').style.backgroundImage = img(site.heroImage);
    var hl = $('#highlight');
    if (site.highlight) { hl.textContent = site.highlight; hl.setAttribute('href', safeUrl(site.highlightLink) || '#main'); hl.hidden = false; } else hl.hidden = true;
    var ctas = '';
    if (site.ctaText) ctas += '<a class="btn primary" ' + (linkAttrs(site.ctaLink) || 'href="#main"') + '>' + esc(site.ctaText) + '</a>';
    if (site.cta2Text) ctas += '<a class="btn" ' + (linkAttrs(site.cta2Link) || 'href="#main"') + '>' + esc(site.cta2Text) + '</a>';
    $('#ctas').innerHTML = ctas;
    $('#nodes').innerHTML = [site.hero1, site.hero2, site.hero3, site.hero4].filter(function (u) { return safeUrl(u); })
      .map(function (u) { return '<span style="background-image:' + esc(img(u)) + '"></span>'; }).join('');

    // keywords ticker (repeated twice for a seamless loop)
    var kw = String(site.keywords || '').split(/[,،\n]/).map(function (k) { return k.trim(); }).filter(Boolean);
    $('#ticker').hidden = !kw.length;
    if (kw.length) { var once = kw.map(function (k) { return '<span>' + esc(k) + '</span>'; }).join(''); $('#track').innerHTML = once + once + once + once; }

    $('#footer').innerHTML = B.inline(site.footer || '');
    $('#credit').innerHTML = B.inline(site.credit || '');
    $('#toTop').textContent = T.top + ' ↑';
    $('#menuLabel').textContent = T.menu;
    $('#lbClose').setAttribute('aria-label', T.close);
    PUBHL = site.pubHighlight || '';

    var ls = langs(all), lb = $('#langBtn');
    if (ls.length > 1) {
      var other = ls[(ls.indexOf(lang) + 1) % ls.length];
      lb.textContent = LANG_NAME[other] || other; lb.lang = other; lb.hidden = false;
      lb.onclick = function (e) { e.preventDefault(); try { localStorage.setItem('bl.lang', other); } catch (x) { /* ignore */ } var y = scrollY; render(ALL, other); scrollTo(0, y); };
    } else lb.hidden = true;

    var secs = visibleSections(c);
    $('#nav').innerHTML = secs.filter(function (s) { return s.nav !== false; }).map(function (s) {
      return '<a href="#' + esc(s.id) + '">' + esc(s.navTitle || s.title) + '</a>';
    }).join('');
    $('#main').innerHTML = secs.map(function (s, i) {
      var fn = R[s.type] || R.text, n = (s.items || []).length;
      var bg = safeUrl(s.bg) ? '<div class="sec-bg" style="background-image:' + esc(img(s.bg)) + '"></div>' : '';
      return '<section class="sec sec-' + esc(s.type) + (bg ? ' with-bg' : '') + '" id="' + esc(s.id) + '">' + bg +
        '<div class="sec-head rv"><span class="idx">' + pad(i + 1) + '</span><h2>' + esc(s.title) + '</h2><span class="rule"></span>' +
        '<span class="meta">' + (COUNT[s.type] && n ? 'N = ' + pad(n) : '') + '</span></div>' +
        (s.intro && s.type !== 'text' ? '<p class="intro rv">' + B.inline(s.intro) + '</p>' : '') + fn(s) + '</section>';
    }).join('');

    secs.forEach(function (s) { if (s.type === 'publications') pubs(s); });
    wire();
    if (PREVIEW && !$('.preview-bar')) document.body.insertAdjacentHTML('beforeend', '<div class="preview-bar">תצוגה מקדימה · עוד לא נשמר באתר</div>');
    if (location.hash && !render.done) { var t = document.getElementById(location.hash.slice(1)); if (t) setTimeout(function () { t.scrollIntoView(); }, 60); }
    render.done = true;
  }

  // publications grouped by year, on a vertical timeline
  function pubs(s) {
    var root = document.getElementById(s.id), box = root.querySelector('[data-pubs]'), empty = root.querySelector('.empty');
    var q = root.querySelector('.ptools input'), y = root.querySelector('.ptools select');
    var items = (s.items || []).slice().sort(function (a, b) { return String(b.year || '').localeCompare(String(a.year || '')); });
    var draw = function () {
      var text = q ? q.value.trim().toLowerCase() : '', year = y ? y.value : '';
      var out = items.filter(function (p) {
        return (!year || String(p.year) === year) && (!text || [p.title, p.authors, p.venue, p.year, p.note].join(' ').toLowerCase().indexOf(text) >= 0);
      });
      var groups = [];
      out.forEach(function (p) { var g = groups[groups.length - 1]; if (!g || g.y !== String(p.year || '')) groups.push(g = { y: String(p.year || ''), p: [] }); g.p.push(p); });
      box.innerHTML = groups.map(function (g) {
        return '<div class="yr-g"><div class="yl">' + esc(g.y || '—') + '<small>' + pad(g.p.length) + '</small></div><ol class="pubs">' + g.p.map(function (p) {
          var l = linkAttrs(p.link);
          return '<li class="pub" dir="auto">' + (l ? '<a class="pt" ' + l + '>' + esc(p.title) + '</a>' : '<span class="pt">' + esc(p.title) + '</span>') +
            '<div class="au">' + hlName(B.inline(p.authors || '')) + '</div>' + (p.venue ? '<div class="ve">' + esc(p.venue) + '</div>' : '') +
            (p.note ? '<div class="pn">' + esc(p.note) + '</div>' : '') + '</li>';
        }).join('') + '</ol></div>';
      }).join('');
      empty.hidden = out.length > 0;
    };
    if (q) q.addEventListener('input', draw);
    if (y) y.addEventListener('change', draw);
    draw();
  }

  var wired = false;
  function wire() {
    var els = $$('.rv');
    if ('IntersectionObserver' in window && !STILL) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
      els.forEach(function (e) { io.observe(e); });
    } else els.forEach(function (e) { e.classList.add('in'); });
    var links = $$('#nav a');
    if ('IntersectionObserver' in window) {
      var so = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id); }); });
      }, { rootMargin: '-45% 0px -50% 0px' });
      $$('main .sec').forEach(function (s) { so.observe(s); });
    }
    $$('.gal figure').forEach(function (f) {
      var open = function () { var lb = $('#lightbox'); lb.querySelector('img').src = f.querySelector('img').src; lb.querySelector('p').textContent = f.getAttribute('data-cap') || ''; lb.hidden = false; $('#lbClose').focus(); };
      f.addEventListener('click', open);
      f.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    if (wired) return;
    wired = true;
    var lb = $('#lightbox');
    lb.addEventListener('click', function (e) { if (e.target === lb || e.target.id === 'lbClose') lb.hidden = true; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') lb.hidden = true; });
    var top = $('.top'), prog = $('#progress');
    var onScroll = function () {
      top.classList.toggle('solid', scrollY > 30);
      var h = document.documentElement.scrollHeight - innerHeight;
      prog.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, scrollY / h) : 0) + ')';
    };
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    var burger = $('#burger'), nav = $('#nav');
    burger.addEventListener('click', function () { var o = nav.classList.toggle('open'); burger.setAttribute('aria-expanded', o); });
    nav.addEventListener('click', function (e) { if (e.target.tagName === 'A') { nav.classList.remove('open'); burger.setAttribute('aria-expanded', false); } });
    // soft light that follows the cursor on glass panels
    document.addEventListener('pointermove', function (e) {
      var g = e.target.closest && e.target.closest('.glass');
      if (!g) return;
      var r = g.getBoundingClientRect();
      g.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      g.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }, { passive: true });
  }

  var accentRGB = function () {
    var hex = (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8fd3ff').replace('#', '');
    if (hex.length === 3) hex = hex.replace(/./g, '$&$&');
    var n = parseInt(hex.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  // ── background: a quiet star field that drifts and twinkles
  function stars() {
    var cv = $('#stars'), ctx = cv.getContext('2d'); if (!ctx) return;
    var W, H, dpr, S = [], t0 = performance.now();
    function size() {
      dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.round(Math.min(200, W * H / 8500));
      S = Array.from({ length: n }, function () { return { x: Math.random() * W, y: Math.random() * H, z: Math.random(), p: Math.random() * 6.28 }; });
    }
    function frame(t) {
      var dt = (t - t0) / 1000, sy = scrollY;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < S.length; i++) {
        var s = S[i], r = .3 + s.z * 1.1;
        var y = ((s.y - sy * (0.02 + s.z * 0.06)) % H + H) % H;
        var a = (.25 + s.z * .55) * (STILL ? 1 : (.65 + .35 * Math.sin(dt * (0.6 + s.z) + s.p)));
        ctx.fillStyle = s.z > .92 ? 'rgba(200,190,255,' + a + ')' : 'rgba(210,230,255,' + a + ')';
        ctx.beginPath(); ctx.arc(s.x, y, r, 0, 6.283); ctx.fill();
      }
      if (!STILL) requestAnimationFrame(frame);
    }
    addEventListener('resize', function () { size(); if (STILL) frame(performance.now()); });
    if (STILL) addEventListener('scroll', function () { frame(performance.now()); }, { passive: true });
    size(); requestAnimationFrame(frame);
  }

  // ── hero: a 3D neural sphere. Points on a sphere, linked to their nearest neighbours,
  // slowly rotating, with signals travelling along the links. The hero images are nodes linked to it.
  function sphere() {
    var cv = $('#sphere'), box = $('#heroArt'), ctx = cv.getContext('2d'); if (!ctx) return;
    var N = innerWidth < 700 ? 120 : 190, P = [], E = [], pulses = [];
    var gold = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < N; i++) {
      var y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), th = gold * i;
      var j = 1 + (Math.random() - .5) * .08;
      P.push([Math.cos(th) * rr * j, y * j, Math.sin(th) * rr * j]);
    }
    for (var a = 0; a < N; a++) {
      var d = [];
      for (var b = 0; b < N; b++) if (a !== b) { var dx = P[a][0] - P[b][0], dy = P[a][1] - P[b][1], dz = P[a][2] - P[b][2]; d.push([dx * dx + dy * dy + dz * dz, b]); }
      d.sort(function (u, v) { return u[0] - v[0]; });
      for (var k = 0; k < 3; k++) if (a < d[k][1]) E.push([a, d[k][1]]);
    }
    // a few long-range "axons" for structure
    for (var q = 0; q < 14; q++) E.push([Math.floor(Math.random() * N), Math.floor(Math.random() * N), 1]);
    var anchors = [12, Math.floor(N * .3), Math.floor(N * .62), N - 14];
    var W, H, dpr, rotY = 0, rotX = -.35, tx = 0, ty = 0, mx = 0, my = 0, visible = true, t0 = performance.now();
    function size() { dpr = Math.min(devicePixelRatio || 1, 2); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    box.addEventListener('pointermove', function (e) { var r = box.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width - .5; my = (e.clientY - r.top) / r.height - .5; });
    box.addEventListener('pointerleave', function () { mx = my = 0; });
    function proj(p) {
      var cy = Math.cos(rotY), sy = Math.sin(rotY), cx = Math.cos(rotX + ty), sx = Math.sin(rotX + ty);
      var x = p[0] * cy - p[2] * sy, z = p[0] * sy + p[2] * cy, y = p[1] * cx - z * sx; z = p[1] * sx + z * cx;
      var R = Math.min(W, H) * .33, f = 2.6 / (2.6 + z);
      return [W / 2 + x * R * f, H / 2 + y * R * f, z, f];
    }
    function frame(t) {
      var dt = Math.min(.05, (t - t0) / 1000); t0 = t;
      if (!STILL) rotY += dt * .12 + mx * dt * .6;
      ty += ((my * .5) - ty) * .05;
      var c = accentRGB(), C = c.join(','), V = '180,165,255';
      ctx.clearRect(0, 0, W, H);
      var R = Math.min(W, H) * .33;
      // halo and orbit rings
      var g = ctx.createRadialGradient(W / 2, H / 2, R * .2, W / 2, H / 2, R * 1.5);
      g.addColorStop(0, 'rgba(' + C + ',.10)'); g.addColorStop(.55, 'rgba(120,110,255,.05)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = 1;
      [[1.28, .32, .14], [1.45, .18, -.3]].forEach(function (o, k) {
        ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(o[2] + (STILL ? 0 : rotY * (k ? -.15 : .1)));
        ctx.strokeStyle = 'rgba(' + (k ? V : C) + ',' + (k ? .16 : .22) + ')';
        ctx.setLineDash(k ? [2, 6] : []);
        ctx.beginPath(); ctx.ellipse(0, 0, R * o[0], R * o[0] * o[1], 0, 0, 6.283); ctx.stroke();
        ctx.restore();
      });
      ctx.setLineDash([]);
      var Q = P.map(proj);
      // links: back first, faint; front brighter
      for (var e = 0; e < E.length; e++) {
        var A = Q[E[e][0]], Bq = Q[E[e][1]], depth = (2 - (A[2] + Bq[2])) / 4;
        ctx.strokeStyle = 'rgba(' + (E[e][2] ? V : C) + ',' + (E[e][2] ? .05 + depth * .1 : .04 + depth * .26).toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(Bq[0], Bq[1]); ctx.stroke();
        if (!STILL && Math.random() < .0009) pulses.push({ e: e, t: 0, v: .6 + Math.random() * .8 });
      }
      for (var n = 0; n < Q.length; n++) {
        var p = Q[n], dd = (1 - p[2]) / 2, r = (.7 + dd * 1.5) * p[3];
        ctx.fillStyle = 'rgba(' + (n % 17 === 0 ? V : C) + ',' + (.25 + dd * .7).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.283); ctx.fill();
        if (n % 23 === 0 && dd > .6) { ctx.fillStyle = 'rgba(' + C + ',.12)'; ctx.beginPath(); ctx.arc(p[0], p[1], r * 4, 0, 6.283); ctx.fill(); }
      }
      pulses = pulses.filter(function (s) {
        s.t += dt * s.v; if (s.t > 1) return false;
        var A = Q[E[s.e][0]], Bq = Q[E[s.e][1]], x = A[0] + (Bq[0] - A[0]) * s.t, y = A[1] + (Bq[1] - A[1]) * s.t;
        var gg = ctx.createRadialGradient(x, y, 0, x, y, 8); gg.addColorStop(0, 'rgba(' + C + ',.95)'); gg.addColorStop(1, 'rgba(' + C + ',0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(x, y, 8, 0, 6.283); ctx.fill();
        return true;
      });
      // links from the image nodes to the sphere
      var nodes = $$('#nodes span'), br = cv.getBoundingClientRect();
      nodes.forEach(function (el, i) {
        var r2 = el.getBoundingClientRect(), x = r2.left + r2.width / 2 - br.left, y = r2.top + r2.height / 2 - br.top, A = Q[anchors[i % 4]];
        var lg = ctx.createLinearGradient(x, y, A[0], A[1]);
        lg.addColorStop(0, 'rgba(' + C + ',.0)'); lg.addColorStop(.35, 'rgba(' + C + ',.35)'); lg.addColorStop(1, 'rgba(' + C + ',.6)');
        ctx.strokeStyle = lg; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo((x + W / 2) / 2, (y + H / 2) / 2, A[0], A[1]); ctx.stroke();
        ctx.fillStyle = 'rgba(' + C + ',.9)'; ctx.beginPath(); ctx.arc(A[0], A[1], 2.4, 0, 6.283); ctx.fill();
      });
      var ro = $('#readout');
      if (ro) ro.textContent = 'NODES ' + N + '   LINKS ' + E.length + '   θ ' + ((rotY * 57.3) % 360).toFixed(1).padStart(5, '0') + '°';
      if (!STILL && visible) requestAnimationFrame(frame);
    }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { var v = es[0].isIntersecting; if (v && !visible) { visible = true; t0 = performance.now(); requestAnimationFrame(frame); } visible = v; }).observe(cv);
    addEventListener('resize', function () { size(); if (STILL) frame(performance.now()); });
    size(); requestAnimationFrame(frame);
  }

  load().then(function (c) { render(c, pickLang(c)); stars(); sphere(); }).catch(function (e) {
    $('#main').innerHTML = '<p class="loading">Content could not be loaded.</p>';
    console.error(e);
  });
})();
