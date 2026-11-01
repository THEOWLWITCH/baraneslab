/* Baranes Lab · public site renderer. Content comes from /api/content (saved in the admin page),
   falls back to content.json, and in preview mode (?preview=1) from the admin draft in this browser. */
(function () {
  'use strict';
  var B = window.BL, esc = B.esc, rich = B.rich, safeUrl = B.safeUrl;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var PREVIEW = /[?&]preview=1/.test(location.search);
  var T = B.ui('en');
  var ALL = null;       // whole content (all languages)
  // Content may hold several languages: {languages:['en','he'], defaultLang, en:{site,sections}, he:{...}}
  function langs(c) { return c && Array.isArray(c.languages) ? c.languages.filter(function (l) { return c[l] && c[l].site; }) : []; }
  function pickLang(c) {
    var ls = langs(c); if (!ls.length) return '';
    var q = (location.search.match(/[?&]lang=(\w+)/) || [])[1];
    var saved = ''; try { saved = localStorage.getItem('bl.lang') || ''; } catch (e) { /* ignore */ }
    return [q, saved, c.defaultLang, ls[0]].filter(function (l) { return l && ls.indexOf(l) >= 0; })[0];
  }
  var LANG_NAME = { en: 'English', he: 'עברית', ar: 'العربية' };

  function load() {
    if (PREVIEW) {
      try { var d = JSON.parse(localStorage.getItem('bl.preview') || 'null'); if (d) return Promise.resolve(d); } catch (e) { /* ignore */ }
    }
    return fetch('/api/content', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(function () { return fetch('content.json', { cache: 'no-store' }).then(function (r) { return r.json(); }); });
  }

  var img = function (u) { u = safeUrl(u); return u ? 'url("' + u.replace(/["\\]/g, '') + '")' : ''; };
  var initials = function (n) {
    var w = String(n || '').replace(/^(prof|dr|mr|ms|mrs)\.?\s+/i, '').replace(/^(פרופ[׳']?|ד״ר|דר[׳'])\s+/, '').replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean);
    return esc(((w[0] || '')[0] || '') + ((w[1] || '')[0] || ''));
  };
  var linkAttrs = function (u) { u = safeUrl(u); return u ? 'href="' + esc(u) + '"' + (/^https?:/i.test(u) ? ' target="_blank" rel="noopener"' : '') : ''; };
  var visibleSections = function (c) { return (c.sections || []).filter(function (s) { return s.visible !== false; }); };

  // ── section renderers
  var R = {
    text: function (s) {
      var body = '<div class="prose">' + rich(s.body) + '</div>';
      return s.image ? '<div class="split">' + body + '<figure><img class="frame" src="' + esc(safeUrl(s.image)) + '" alt="' + esc(s.imageAlt || s.title || '') + '" loading="lazy"></figure></div>' : body;
    },
    cards: function (s) {
      return '<div class="grid">' + (s.items || []).map(function (it) {
        var l = linkAttrs(it.link);
        return '<article class="card rv">' + (it.image ? '<div class="ph" style="background-image:' + esc(img(it.image)) + '"></div>' : '') +
          '<div class="bd"><h3>' + esc(it.title) + '</h3>' + (it.subtitle ? '<p class="cs">' + esc(it.subtitle) + '</p>' : '') + '<div class="tx">' + rich(it.text) + '</div>' +
          (l ? '<a class="go" ' + l + '>' + esc(it.linkText || T.more) + ' →</a>' : '') + '</div></article>';
      }).join('') + '</div>';
    },
    people: function (s) {
      var groups = [], by = {};
      (s.items || []).forEach(function (p, i) {
        var g = (p.group || '').trim();
        if (!by[g]) { by[g] = []; groups.push(g); }
        by[g].push(p);
      });
      return groups.map(function (g, gi) {
        return (g && groups.length > 1 ? '<h3 class="group-t">' + esc(g) + '</h3>' : '') + '<div class="people">' + by[g].map(function (p) {
          var lead = !!p.lead, l = linkAttrs(p.link), mail = /@/.test(p.email || '') ? 'mailto:' + p.email : '';
          var av = p.image ? '<div class="avatar" style="background-image:' + esc(img(p.image)) + '" role="img" aria-label="' + esc(p.name) + '"></div>' : '<div class="avatar" aria-hidden="true">' + initials(p.name) + '</div>';
          return '<article class="person rv' + (lead ? ' lead' : '') + '">' + av + '<div><h3>' + esc(p.name) + '</h3>' +
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
      var tools = (s.items || []).length > 6 ? '<div class="ptools"><input type="search" placeholder="' + esc(T.search) + '" aria-label="' + esc(T.search) + '"><select aria-label="' + esc(T.all) + '"><option value="">' + esc(T.all) + '</option>' +
        years.map(function (y) { return '<option>' + esc(y) + '</option>'; }).join('') + '</select></div>' : '';
      return tools + '<ol class="pubs" data-pubs></ol><p class="empty" hidden>' + esc(T.none) + '</p>';
    },
    news: function (s) {
      return '<div class="news">' + (s.items || []).map(function (n) {
        var l = linkAttrs(n.link);
        return '<article class="news-it rv"><time>' + esc(n.date) + '</time><div><h3>' + (l ? '<a ' + l + '>' + esc(n.title) + '</a>' : esc(n.title)) + '</h3><div class="tx">' + rich(n.text) + '</div></div>' +
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
      if (s.name) lines.push('<h3 class="cname">' + esc(s.name) + '</h3>');
      if (s.email) lines.push('<div class="cline"><b>' + esc(T.email) + '</b><a href="mailto:' + esc(s.email) + '">' + esc(s.email) + '</a></div>');
      if (s.phone) lines.push('<div class="cline"><b>' + esc(T.phone) + '</b><a href="tel:' + esc(String(s.phone).replace(/[^\d+]/g, '')) + '" dir="ltr">' + esc(s.phone) + '</a></div>');
      var wa = String(s.whatsapp || '').replace(/[^\d]/g, '');
      if (wa) lines.push('<div class="cline"><b>WhatsApp</b><a href="https://wa.me/' + wa + '" target="_blank" rel="noopener" dir="ltr">' + esc(s.whatsapp) + '</a></div>');
      if (s.address) lines.push('<div class="cline"><b>' + esc(T.address) + '</b><span>' + esc(s.address) + '</span></div>');
      var links = (s.items || []).filter(function (l) { return safeUrl(l.url); }).map(function (l) { return '<a class="btn" ' + linkAttrs(l.url) + '>' + esc(l.label || l.url) + '</a>'; }).join('');
      var mapSrc = '';
      if (/^https:\/\/(www\.)?(google\.[a-z.]+\/maps\/embed|maps\.google\.[a-z.]+\/maps\?.*output=embed|www\.openstreetmap\.org\/export\/embed)/i.test(s.mapUrl || '')) mapSrc = s.mapUrl;
      else if (s.address && s.showMap !== false) mapSrc = 'https://maps.google.com/maps?q=' + encodeURIComponent(s.address) + '&output=embed';
      var nm = lines.length && /cname/.test(lines[0]) ? lines.shift() : '';
      return '<div class="contact' + (mapSrc ? '' : ' solo') + '"><div class="cbox rv">' + nm + (s.body ? '<div class="prose">' + rich(s.body) + '</div>' : '') + lines.join('') +
        (links ? '<div class="clinks">' + links + '</div>' : '') + '</div>' +
        (mapSrc ? '<iframe class="map rv" src="' + esc(mapSrc) + '" title="' + esc(T.map) + '" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>' : '') + '</div>';
    },
  };

  function render(all, lang) {
    ALL = all;
    var c = lang ? all[lang] : all;
    var site = c.site || {};
    var lang = site.lang || 'en';
    T = B.ui(lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = B.isRtl(lang) ? 'rtl' : 'ltr';
    if (/^#[0-9a-f]{3,8}$/i.test(site.accent || '')) document.documentElement.style.setProperty('--accent', site.accent);
    document.title = [site.title, site.name].filter(Boolean).join(' · ');
    var md = $('meta[name=description]'); if (md && site.seoDescription) md.setAttribute('content', site.seoDescription);

    $('#brandName').textContent = site.name || site.title || '';
    var logo = $('#logo');
    if (site.logo && safeUrl(site.logo)) { logo.src = safeUrl(site.logo); logo.alt = site.name || ''; logo.hidden = false; } else logo.hidden = true;
    $('#eyebrow').textContent = site.eyebrow || '';
    $('#subtitle').textContent = site.subtitle || '';
    $('#title').textContent = site.title || '';
    $('#tagline').innerHTML = B.inline(site.tagline || '');
    $('#heroImg').style.backgroundImage = img(site.heroImage);
    var hl = $('#highlight');
    if (site.highlight) { hl.textContent = site.highlight; hl.setAttribute('href', safeUrl(site.highlightLink) || '#main'); hl.hidden = false; } else hl.hidden = true;
    var tiles = [site.hero1, site.hero2, site.hero3, site.hero4].filter(function (u) { return safeUrl(u); });
    var vid = safeUrl(site.heroVideo);
    $('#heroArt').innerHTML = (tiles.length ? '<div class="tiles">' + tiles.map(function (u) { return '<span style="background-image:' + esc(img(u)) + '"></span>'; }).join('') + '</div>' : '') +
      (vid ? '<video class="hv" src="' + esc(vid) + '" autoplay muted loop playsinline preload="metadata"></video>' : '');
    $('#heroArt').hidden = !tiles.length && !vid;
    document.querySelector('.hero').classList.toggle('has-art', !!(tiles.length || vid));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { var v = $('#heroArt video'); if (v) { v.removeAttribute('autoplay'); v.pause(); } }
    $('#credit').innerHTML = B.inline(site.credit || '');
    var ls = langs(all), lb = $('#langBtn');
    if (lang && ls.length > 1) {
      var other = ls[(ls.indexOf(lang) + 1) % ls.length];
      lb.textContent = LANG_NAME[other] || other; lb.lang = other; lb.hidden = false;
      lb.onclick = function (e) { e.preventDefault(); try { localStorage.setItem('bl.lang', other); } catch (x) { /* ignore */ } var y = scrollY; render(ALL, other); scrollTo(0, y); };
    } else lb.hidden = true;
    PUBHL = site.pubHighlight || '';
    var ctas = '';
    if (site.ctaText) ctas += '<a class="btn primary" ' + (linkAttrs(site.ctaLink) || 'href="#main"') + '>' + esc(site.ctaText) + '</a>';
    if (site.cta2Text) ctas += '<a class="btn" ' + (linkAttrs(site.cta2Link) || 'href="#main"') + '>' + esc(site.cta2Text) + '</a>';
    $('#ctas').innerHTML = ctas;
    $('#footer').innerHTML = B.inline(site.footer || '');
    $('#toTop').textContent = T.top + ' ↑';
    $('#menuLabel').textContent = T.menu;
    $('#lbClose').setAttribute('aria-label', T.close);

    var secs = visibleSections(c);
    $('#nav').innerHTML = secs.filter(function (s) { return s.nav !== false; }).map(function (s) {
      return '<a href="#' + esc(s.id) + '">' + esc(s.navTitle || s.title) + '</a>';
    }).join('');
    $('#main').innerHTML = secs.map(function (s, i) {
      var fn = R[s.type] || R.text;
      var bg = safeUrl(s.bg) ? '<div class="sec-bg" style="background-image:' + esc(img(s.bg)) + '"></div>' : '';
      return '<section class="sec sec-' + esc(s.type) + (bg ? ' with-bg' : '') + '" id="' + esc(s.id) + '">' + bg + '<div class="sec-head rv"><span class="num">' + String(i + 1).padStart(2, '0') + '</span><h2>' + esc(s.title) + '</h2></div>' +
        (s.intro && s.type !== 'text' ? '<p class="intro rv">' + B.inline(s.intro) + '</p>' : '') + fn(s) + '</section>';
    }).join('');

    secs.forEach(function (s) { if (s.type === 'publications') pubs(s); });
    wire();
    if (PREVIEW) document.body.insertAdjacentHTML('beforeend', '<div class="preview-bar">תצוגה מקדימה · עוד לא נשמר באתר</div>');
    if (location.hash) { var t = document.getElementById(location.hash.slice(1)); if (t) setTimeout(function () { t.scrollIntoView(); }, 50); }
  }

  var PUBHL = '';
  function hlName(h) {
    var n = PUBHL.trim(); if (!n) return h;
    var re = new RegExp('(' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^,;]*?)(?=,| and |$)', 'g');
    return h.replace(re, '<b class="me">$1</b>');
  }
  function pubs(s) {
    var root = document.getElementById(s.id), list = root.querySelector('[data-pubs]'), empty = root.querySelector('.empty');
    var q = root.querySelector('.ptools input'), y = root.querySelector('.ptools select');
    var items = (s.items || []).slice().sort(function (a, b) { return String(b.year || '').localeCompare(String(a.year || '')); });
    var draw = function () {
      var text = q ? q.value.trim().toLowerCase() : '', year = y ? y.value : '';
      var out = items.filter(function (p) {
        return (!year || String(p.year) === year) && (!text || [p.title, p.authors, p.venue, p.year, p.note].join(' ').toLowerCase().indexOf(text) >= 0);
      });
      list.innerHTML = out.map(function (p) {
        var l = linkAttrs(p.link);
        return '<li class="pub" dir="auto"><div class="yr">' + esc(p.year) + '</div><div>' + (l ? '<a class="pt" ' + l + '>' + esc(p.title) + '</a>' : '<span class="pt">' + esc(p.title) + '</span>') +
          '<div class="au">' + hlName(B.inline(p.authors || '')) + '</div>' + (p.venue ? '<div class="ve">' + esc(p.venue) + '</div>' : '') +
          (p.note ? '<div class="pn">' + esc(p.note) + '</div>' : '') + '</div></li>';
      }).join('');
      empty.hidden = out.length > 0;
    };
    if (q) q.addEventListener('input', draw);
    if (y) y.addEventListener('change', draw);
    draw();
  }

  var wired = false;
  function wire() {
    // reveal on scroll
    var els = document.querySelectorAll('.rv');
    if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
      els.forEach(function (e) { io.observe(e); });
    } else els.forEach(function (e) { e.classList.add('in'); });
    // nav highlight
    var links = document.querySelectorAll('#nav a');
    if ('IntersectionObserver' in window) {
      var so = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id); }); });
      }, { rootMargin: '-45% 0px -50% 0px' });
      document.querySelectorAll('main .sec').forEach(function (s) { so.observe(s); });
    }
    // gallery lightbox
    document.querySelectorAll('.gal figure').forEach(function (f) {
      var open = function () { var lb = $('#lightbox'); lb.querySelector('img').src = f.querySelector('img').src; lb.querySelector('p').textContent = f.getAttribute('data-cap') || ''; lb.hidden = false; $('#lbClose').focus(); };
      f.addEventListener('click', open);
      f.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    if (wired) return;
    wired = true;
    var lb = $('#lightbox');
    lb.addEventListener('click', function (e) { if (e.target === lb || e.target.id === 'lbClose') lb.hidden = true; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') lb.hidden = true; });
    var top = $('.top'), onScroll = function () { top.classList.toggle('solid', scrollY > 30); };
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
    var burger = $('#burger'), nav = $('#nav');
    burger.addEventListener('click', function () { var o = nav.classList.toggle('open'); burger.setAttribute('aria-expanded', o); });
    nav.addEventListener('click', function (e) { if (e.target.tagName === 'A') { nav.classList.remove('open'); burger.setAttribute('aria-expanded', false); } });
  }

  // ── hero: a slow, quiet neural network (nodes and synapses)
  function network() {
    var cv = $('#net'), ctx = cv.getContext('2d');
    if (!ctx) return;
    var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var W, H, dpr, nodes = [], pulses = [];
    var accent = function () { return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8fd3ff'; };
    var rgb = function (hex) { hex = hex.replace('#', ''); if (hex.length === 3) hex = hex.replace(/./g, '$&$&'); var n = parseInt(hex.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(','); };
    function size() {
      dpr = Math.min(devicePixelRatio || 1, 2); W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.round(Math.min(110, W * H / 14000));
      nodes = Array.from({ length: n }, function () { return { x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .18, vy: (Math.random() - .5) * .18, r: Math.random() * 1.8 + .8 }; });
    }
    var LINK = 150;
    function frame() {
      var c = rgb(accent());
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        if (!still) { a.x += a.vx; a.y += a.vy; if (a.x < 0 || a.x > W) a.vx *= -1; if (a.y < 0 || a.y > H) a.vy *= -1; }
        for (var j = i + 1; j < nodes.length; j++) {
          var b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d = Math.sqrt(dx * dx + dy * dy);
          if (d < LINK) {
            ctx.strokeStyle = 'rgba(' + c + ',' + (0.16 * (1 - d / LINK)).toFixed(3) + ')';
            ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            if (!still && Math.random() < 0.00025) pulses.push({ a: a, b: b, t: 0 });
          }
        }
      }
      nodes.forEach(function (n) { ctx.fillStyle = 'rgba(' + c + ',.55)'; ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.283); ctx.fill(); });
      pulses = pulses.filter(function (p) {
        p.t += 0.02; if (p.t > 1) return false;
        var x = p.a.x + (p.b.x - p.a.x) * p.t, y = p.a.y + (p.b.y - p.a.y) * p.t;
        var g = ctx.createRadialGradient(x, y, 0, x, y, 7); g.addColorStop(0, 'rgba(' + c + ',.9)'); g.addColorStop(1, 'rgba(' + c + ',0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.283); ctx.fill();
        return true;
      });
      if (!still && visible) requestAnimationFrame(frame);
    }
    var visible = true;
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { var v = es[0].isIntersecting; if (v && !visible) { visible = true; requestAnimationFrame(frame); } visible = v; }).observe(cv);
    addEventListener('resize', function () { size(); if (still) frame(); });
    size(); frame();
  }

  load().then(function (c) { render(c, pickLang(c)); network(); }).catch(function (e) {
    $('#main').innerHTML = '<p class="loading">Content could not be loaded.</p>';
    console.error(e);
  });
})();
